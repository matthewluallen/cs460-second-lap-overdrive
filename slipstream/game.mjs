// Game orchestration with no DOM: drivers, scanning, battle and the control loop.
import {Car, LANE_STEP} from './car.mjs';
import {Pieces, Track, TrackMapper, traversal} from './track.mjs';
import {Battle, Bot, loadout} from './battle.mjs';

export const MAX_CARS = 4;
export const TEAM_COLORS = [[0, 1, 0], [0, 0.4, 1], [1, 0.5, 0], [1, 0, 1], [0, 1, 1], [1, 1, 0], [1, 1, 1], [1, 0, 0.3]];
export const emptyInput = () => ({throttle: 0, lane: null, attack: false, support: false, special: false});

export class Game {
  constructor({pieces, weapons, vehicles, clock = () => performance.now(), log = () => {}}) {
    this.pieces = new Pieces(pieces); this.weapons = weapons; this.vehicles = vehicles;
    this.clock = clock; this.log = log;
    this.drivers = []; this.track = null; this.battle = null; this.mapper = null; this.scanner = null;
    this.phase = 'garage'; this.halted = false; this.topSpeed = 700; this.scanSpeed = 450; this.nextId = 1;
  }
  modelName(model) { return this.vehicles.models[String(model)]?.name ?? 'Unknown'; }
  addCar(transport, {name, model = 8, simulated = false, control = 'none'} = {}) {
    if (this.drivers.length >= MAX_CARS) throw new Error('A session supports at most four cars');
    if (typeof transport.id === 'string' && this.drivers.some(d => d.car.connected && d.car.transport.id === transport.id)) throw new Error('This car is already in the garage');
    const color = TEAM_COLORS.find(color => !this.drivers.some(d => d.car.color === color));
    const car = new Car(transport, {name: name || this.modelName(model), model, color, pieces: this.pieces, simulated, clock: this.clock});
    const driver = {id: this.nextId++, car, input: emptyInput(), control, bot: null, previous: emptyInput()};
    car.on(message => this.#message(driver, message));
    this.drivers.push(driver);
    if (this.track) car.useTrack(this.track);
    if (this.battle) this.battle.add(car);
    car.start();
    return driver;
  }
  async removeCar(driver) {
    this.drivers = this.drivers.filter(d => d !== driver);
    this.battle?.remove(driver.car);
    if (this.scanner === driver) this.cancelScan();
    await driver.car.close();
  }
  setModel(driver, model) {
    driver.car.model = model;
    if (this.battle) { this.battle.remove(driver.car); this.battle.add(driver.car); }
  }
  setControl(driver, control) {
    driver.control = control; driver.input = emptyInput(); driver.level = 0; driver.car.stop();
    driver.bot = control === 'bot' && this.battle ? new Bot(driver.car, this.battle) : null;
  }
  #message(driver, message) {
    if (message.type === 'closed') { this.log(driver.car.name + ' disconnected: ' + message.reason); return; }
    if (this.phase === 'scanning' && driver === this.scanner) {
      const track = this.mapper.feed(message);
      if (track) this.#scanned(track);
    }
    if (message.type === 'collision' && this.battle?.active) {
      const f = this.battle.get(driver.car);
      if (f) this.battle.damage(f, 1, null, this.clock(), 'crash');
    }
    if (message.type === 'delocalized') {
      if (this.scanner === driver) this.cancelScan();
      driver.input = emptyInput(); driver.level = 0;
      driver.car.safetyStop('Off track');
      this.log(driver.car.name + ' left the track: return it to the track, then recover it');
    }
  }
  // --- track -----------------------------------------------------------------
  startScan(driver = this.drivers.find(d => d.car.connected)) {
    if (!driver) throw new Error('Connect a car first');
    if (driver.car.safetyReason === 'Off track') throw new Error('Return the car to the track and recover it before scanning');
    this.stopBattle(); this.resume();
    this.mapper = new TrackMapper(this.pieces); this.scanner = driver; this.phase = 'scanning';
    this.track = null; for (const d of this.drivers) d.car.useTrack(null);
    driver.car.steerTo(0); driver.car.setSpeed(Math.min(this.topSpeed, this.scanSpeed));
    this.log('Scanning with ' + driver.car.name + ': drive one or two laps');
  }
  cancelScan() { if (this.phase !== 'scanning') return; this.scanner?.car.stop(); this.scanner = null; this.phase = this.track ? 'ready' : 'garage'; }
  #scanned(track) {
    const scanner = this.scanner;
    scanner.car.stop(); this.scanner = null;
    this.useTrack(track);
    // The scanning car has just re-entered the first piece, so its place is known.
    scanner.car.localizer.seed(0, 1, this.clock());
    this.log('Track mapped: ' + track.count + ' pieces, ' + (track.length / 1000).toFixed(2) + ' m');
  }
  useTrack(track) {
    this.track = track; this.phase = 'ready';
    this.battle = new Battle({weapons: this.weapons, vehicles: this.vehicles, track, clock: this.clock});
    for (const d of this.drivers) { d.car.useTrack(track); this.battle.add(d.car); if (d.control === 'bot') d.bot = new Bot(d.car, this.battle); }
    this.onTrack?.(track);
  }
  loadTrack(saved) {
    const sequence = saved.map(p => ({...traversal(this.pieces, p.id, !!p.reverse, p.id < 0 ? {kind: p.kind, turn: p.turn, length: p.length} : {})}));
    const track = new Track(sequence);
    if (!track.closed) throw new Error('Saved track does not close');
    this.useTrack(track);
  }
  // --- battle ----------------------------------------------------------------
  startBattle() {
    if (!this.track) throw new Error('Map the track first');
    this.battle.start(); this.phase = 'battle'; this.resume();
    for (const d of this.drivers) if (d.control === 'bot') d.bot = new Bot(d.car, this.battle);
    this.log('Battle started');
  }
  stopBattle() { if (this.phase === 'battle') { this.battle.stop(); this.phase = 'ready'; this.log('Battle stopped'); } }
  stopAll() {
    this.cancelScan(); this.stopBattle();
    // Stays halted until resume(), a new scan or a new battle: no input can restart a car.
    this.halted = true;
    for (const d of this.drivers) { d.input = emptyInput(); d.level = 0; d.car.safetyStop(d.car.safetyReason || 'Host stopped'); }
    this.log('All cars stopped');
  }
  resume() {
    this.halted = false;
    for (const d of this.drivers) if (d.car.safetyReason === 'Host stopped') d.car.recover();
  }
  recoverCar(driver) {
    if (!this.drivers.includes(driver) || driver.car.safetyReason !== 'Off track') return false;
    driver.input = emptyInput(); driver.level = 0;
    if (driver.pad) { driver.pad.throttle = 0; driver.pad.seen = 0; }
    const recovered = driver.car.recover();
    if (recovered && this.halted) driver.car.safetyStop('Host stopped');
    return recovered;
  }
  // --- control loop ------------------------------------------------------------
  tick(dt, now = this.clock()) {
    if (this.halted) { for (const d of this.drivers) if (d.car.connected && d.car.speed !== 0) d.car.stop(); return; }
    for (const d of this.drivers) {
      const car = d.car;
      if (!car.connected || (this.phase === 'scanning' && d === this.scanner)) continue;
      if (car.safetyReason) { d.input = emptyInput(); continue; }
      if (d.bot && this.track) d.bot.drive(now, d.input);
      const input = d.input, truck = this.vehicles.models[String(car.model)]?.truck;
      const wanted = Math.max(0, Math.min(1, input.throttle || 0)) * this.topSpeed * (truck ? 0.85 : 1);
      const limited = this.battle ? this.battle.limit(car, wanted, now) : {speed: wanted, accel: 1000};
      car.setSpeed(Math.min(this.topSpeed, limited.speed), limited.accel);
      if (input.lane !== null && input.lane !== undefined && Number.isFinite(input.lane)) car.steerTo(input.lane);
      if (this.battle) for (const bay of ['attack', 'support', 'special']) this.battle.press(car, bay, !!input[bay]);
    }
    this.battle?.update(dt, now);
  }
  // Discrete controls shared by keyboard, gamepad and phone pads.
  nudge(driver, direction) {
    const lanes = Math.round((driver.input.lane ?? driver.car.targetLateral) / LANE_STEP) + direction;
    driver.input.lane = Math.max(-3, Math.min(3, lanes)) * LANE_STEP;
  }
  snapshot(now = this.clock()) {
    return this.drivers.map(d => {
      const f = this.battle?.get(d.car), max = this.vehicles.energy.max_energy;
      const bay = name => { const id = f?.item(name), w = id && this.weapons[id]; return w ? {id, type: w.type, style: w.interaction_style, ready: (f.ready[name] ?? 0) <= now, charge: f.charge[name] ?? 0} : null; };
      return {id: d.id, name: d.car.name, model: d.car.model, color: d.car.color, control: d.control, connected: d.car.connected, safetyReason: d.car.safetyReason,
        speed: d.car.liveSpeed, target: d.car.speed, millivolts: d.car.millivolts, located: !!d.car.localizer?.located, laps: d.car.localizer?.laps ?? 0,
        energy: f ? f.energy / max : 1, disabled: f ? f.disabledUntil > now : false, kills: f?.kills ?? 0, deaths: f?.deaths ?? 0,
        shield: f ? f.shield > 0 : false, attack: bay('attack'), support: bay('support'), special: bay('special')};
    });
  }
}
export {loadout};
