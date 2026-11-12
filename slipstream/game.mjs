// Game orchestration with no DOM: drivers, scanning, battle and the control loop.
import {Car, LANE_STEP} from './car.mjs';
import {Pieces, Track, TrackMapper, traversal, trackFromPlan} from './track.mjs';
import {Battle, Bot, loadout} from './battle.mjs';

export const MAX_CARS = 4;
export const TEAM_COLORS = [[0, 1, 0], [0, 0.4, 1], [1, 0.5, 0], [1, 0, 1], [0, 1, 1], [1, 1, 0], [1, 1, 1], [1, 0, 0.3]];
export const emptyInput = () => ({throttle: 0, lane: null, attack: false, support: false, special: false});

export class Game {
  constructor({pieces, weapons, vehicles, clock = () => performance.now(), log = () => {}, safety = {}}) {
    this.pieces = new Pieces(pieces); this.weapons = weapons; this.vehicles = vehicles;
    this.clock = clock; this.log = log;
    this.safety = {firstTrackMs:5000, trackGapMs:2000, stopGraceMs:1000, scanMs:45000, scanLaps:3, ...safety};
    for (const value of Object.values(this.safety)) if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid safety limit");
    this.drivers = []; this.track = null; this.battle = null; this.mapper = null; this.scanner = null;
    this.phase = 'garage'; this.halted = false; this.pitReason = null; this.topSpeed = 700; this.scanSpeed = 450; this.nextId = 1;
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
    if (this.battle) { this.battle.remove(driver.car); this.battle.add(driver.car).crew = driver.crew ?? ''; }
  }
  setCrew(driver, crew) {
    if (!['', 'sun', 'moon'].includes(crew)) throw new Error('Unknown crew');
    if (this.battle?.active) throw new Error('Finish the round before changing crews');
    driver.crew = crew;
    const f = this.battle?.get(driver.car); if (f) f.crew = crew;
  }
  setControl(driver, control) {
    driver.gamepadBinding = null; driver.cpuArmed = false; driver.armed = false; driver.control = control; driver.gamepadArmed = false; driver.input = emptyInput(); driver.level = 0; driver.car.stop();
    driver.bot = control === 'bot' && this.battle ? new Bot(driver.car, this.battle) : null;
  }
  #message(driver, message) {
    if (message.type === 'closed') { if(message.wasMoving) this.requestPit(driver, 'Connection lost while moving: ' + message.reason); this.log(driver.car.name + ' disconnected: ' + message.reason); return; }
    if (this.phase === 'scanning' && driver === this.scanner) {
      if (message.type === 'position') {
        if (message.pieceId === 34 && this.scanAnchor !== 34) { this.scanAnchor = 34; this.scanLaps = 0; this.scanLastPiece = undefined; }
        this.scanAnchor ??= message.pieceId;
        if (message.pieceId === this.scanAnchor && this.scanLastPiece !== undefined && this.scanLastPiece !== this.scanAnchor) this.scanLaps++;
        this.scanLastPiece = message.pieceId;
        if (this.scanLaps >= this.safety.scanLaps) { this.requestPit(driver, 'Scan lap budget exceeded'); return; }
      }
      const track = this.mapper.feed(message);
      if (track) this.#scanned(track);
    }
    if (message.type === 'collision' && !this.halted && this.battle?.active) {
      const f = this.battle.get(driver.car);
      if (f) this.battle.damage(f, 1, null, this.clock(), 'crash');
    }
    if (message.type === 'delocalized') {
      // Someone must reach onto the shared circuit to recover this car. Halt
      // every driver, preserving battle state so a paused round can continue.
      this.battle?.pause?.(this.clock());
      this.pitReason = driver.car.name + ' left the track';
      this.cancelScan(); this.halted = true;
      this.#stopDrivers(driver);
      this.log(this.pitReason + ': all cars stopped. Recover the car, then confirm the track is clear');
    }
  }
  #stopDrivers(offTrack = null) {
    for (const d of this.drivers) {
      d.cpuArmed = false; d.armed = false; d.gamepadArmed = false; d.input = emptyInput(); d.level = 0; d.objectiveInput = null;
      if (d.pad) { d.pad.throttle = 0; d.pad.seen = 0; d.pad.attack = d.pad.support = d.pad.special = false; }
      d.car.safetyStop(d === offTrack ? 'Off track' : d.car.safetyReason || 'Host stopped');
    }
  }
  requestPit(driver, reason) {
    this.battle?.pause?.(this.clock()); this.cancelScan(); this.halted = true;
    this.pitReason = driver.car.name + ': ' + reason;
    driver.car.safetyReason = reason; this.#stopDrivers(); this.log(this.pitReason);
  }
  get pitReady() { return !!this.pitReason && !this.drivers.some(d => d.car.safetyReason && d.car.safetyReason !== 'Host stopped'); }
  resumeFromPit() {
    if (!this.pitReason) return false;
    if (!this.pitReady) throw new Error('Return every off-track car to the circuit and recover it before clearing the pit stop');
    this.#stopDrivers();
    const pausedMs = this.battle?.resume?.(this.clock()) ?? 0;
    for (const d of this.drivers) if (d.bot) for (const field of ['nextLane', 'mineAt']) if (d.bot[field] > 0) d.bot[field] += pausedMs;
    this.pitReason = null;
    this.resume();
    return true;
  }

  // --- track -----------------------------------------------------------------
  startScan(driver = this.drivers.find(d => d.car.connected)) {
    if (!driver) throw new Error('Connect a car first');
    if (driver.car.safetyReason === 'Off track') throw new Error('Return the car to the track and recover it before scanning');
    if(this.pitReason) throw new Error('Pit stop: complete shared recovery before scanning');
    this.stopAll(); this.halted=false; if(driver.car.safetyReason==='Host stopped')driver.car.recover(); this.stopBattle();
    this.scanStarted = this.clock(); this.scanLaps = 0; this.scanAnchor = undefined; this.scanLastPiece = undefined;
    this.mapper = new TrackMapper(this.pieces); this.scanner = driver; this.phase = 'scanning';
    this.track = null; for (const d of this.drivers) d.car.useTrack(null);
    // Scan on a printed lane: intersections have strips at ±18/±54 mm,
    // so the geometric center has no localization codes to identify them.
    driver.car.steerTo(LANE_STEP); driver.car.setSpeed(Math.min(this.topSpeed, this.scanSpeed));
    this.log('Scanning with ' + driver.car.name + ': drive one or two laps');
  }
  cancelScan() { if (this.phase !== 'scanning') return; this.scanner?.car.stop(); this.scanner = null; this.phase = this.track ? 'ready' : 'garage'; }
  #scanned(track) {
    const scanner = this.scanner;
    scanner.car.stop(); this.scanner = null;
    this.useTrack(track); this.stopAll();
    // Wait for a real location code: closure is detected on leaving the anchor,
    // not entering it. Seeding index zero would invent a target position.
    this.log('Track mapped: ' + track.count + ' pieces, ' + (track.length / 1000).toFixed(2) + ' m');
  }
  useTrack(track) {
    this.track = track; this.phase = 'ready';
    this.battle = new Battle({weapons: this.weapons, vehicles: this.vehicles, track, clock: this.clock});
    for (const d of this.drivers) { d.car.useTrack(track); this.battle.add(d.car).crew = d.crew ?? ''; if (d.control === 'bot') d.bot = new Bot(d.car, this.battle); }
    this.onTrack?.(track);
  }
  loadTrack(saved) {
    const track = trackFromPlan(this.pieces, saved);
    if (!track.closed) throw new Error('Saved track does not close');
    this.useTrack(track);
  }
  armComputers() { for (const d of this.drivers) if (d.control === 'bot') { d.input = emptyInput(); d.cpuArmed = true; d.armed = true; } }
  // --- battle ----------------------------------------------------------------
  startBattle() {
    if (!this.track) throw new Error('Map the track first');
    if (this.track.inferredCount) throw new Error('Rescan: some track sections were inferred, not identified');
    this.resume(); this.armComputers(); this.battle.start();
    for (const d of this.drivers) this.battle.get(d.car).participating = d.control !== 'none';
    this.phase = 'battle';
    for (const d of this.drivers) if (d.control === 'bot') d.bot = new Bot(d.car, this.battle);
    this.log('Battle started');
  }
  stopBattle() { if (this.phase === 'battle') { this.battle.stop(); this.phase = 'ready'; this.log('Battle stopped'); } }
  stopAll() {
    this.cancelScan(); this.stopBattle();
    // Stays halted until resume(), a new scan or a new battle: no input can restart a car.
    this.halted = true;
    this.#stopDrivers();
    this.log('All cars stopped');
  }
  resume() {
    if (this.pitReason) throw new Error('Pit stop: recover every off-track car, then confirm the track is clear');
    if (this.drivers.some(d => d.car.safetyReason === 'Off track')) throw new Error('Recover every off-track car before resuming');
    this.halted = false;
    for (const d of this.drivers) if (d.car.safetyReason === 'Host stopped') d.car.recover();
  }
  recoverCar(driver) {
    if (!this.drivers.includes(driver) || (!driver.car.safetyReason || driver.car.safetyReason === 'Host stopped')) return false;
    driver.input = emptyInput(); driver.level = 0;
    if (driver.pad) { driver.pad.throttle = 0; driver.pad.seen = 0; }
    const recovered = driver.car.recover();
    if (recovered && this.halted) driver.car.safetyStop('Host stopped');
    return recovered;
  }
  // --- control loop ------------------------------------------------------------
  tick(dt, now = this.clock()) {
    for (const d of this.drivers) {
      const c=d.car;if (!c.connected) continue;
      if (c.speed > 0) {
        const hasTrack = c.lastTrackAt !== undefined && c.lastTrackAt >= c.motionSince;
        if (now - (hasTrack ? c.lastTrackAt : c.motionSince) > (hasTrack ? this.safety.trackGapMs : this.safety.firstTrackMs)) { this.requestPit(d, 'Telemetry timeout'); break; }
        if (d === this.scanner && now - this.scanStarted > this.safety.scanMs) { this.requestPit(d, 'Scan time budget exceeded'); break; }
      } else if (c.stopRequestedAt != null && c.lastTrackAt > c.stopRequestedAt + this.safety.stopGraceMs && c.lastTrackAt > (c.checkedStopTrackAt ?? -Infinity) && now - (c.lastStopRetry ?? -Infinity) >= this.safety.stopGraceMs) {
        c.lastStopRetry = now; c.checkedStopTrackAt = c.lastTrackAt; this.requestPit(d, 'STOP not confirmed: telemetry continues'); c.stop(); break;
      }
    }
    if (this.halted) { for (const d of this.drivers) if (d.car.connected && d.car.speed !== 0) d.car.stop(); return; }
    for (const d of this.drivers) {
      const car = d.car;
      if (!car.connected || (this.phase === 'scanning' && d === this.scanner)) continue;
      if (car.safetyReason) { d.input = emptyInput(); continue; }
      if (d.control === 'bot' && !d.cpuArmed) { d.input = emptyInput(); car.setSpeed(0); continue; }
      if (d.bot && this.track) {
        d.bot.drive(now, d.input);
        // Session objectives guide CPU throttle/lane only. They cannot bypass
        // safety latches, weapon rules, or the operator's final speed ceiling.
        if (d.objectiveInput) {
          if (Number.isFinite(d.objectiveInput.throttle)) d.input.throttle = Math.max(0, Math.min(1, d.objectiveInput.throttle));
          if (Number.isFinite(d.objectiveInput.lane)) d.input.lane = Math.max(-68, Math.min(68, d.objectiveInput.lane));
        }
      }
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
      const f = this.battle?.get(d.car), max = this.vehicles.energy.max_energy, battleNow = this.battle?.time?.(now) ?? now;
      const bay = name => { const id = f?.item(name), w = id && this.weapons[id]; return w ? {id, type: w.type, style: w.interaction_style, ready: (f.ready[name] ?? 0) <= battleNow, charge: f.charge[name] ?? 0} : null; };
      return {id: d.id, name: d.car.name, model: d.car.model, color: d.car.color, control: d.control, connected: d.car.connected, safetyReason: d.car.safetyReason,
        speed: d.car.liveSpeed, target: d.car.speed, millivolts: d.car.millivolts, targets: (this.battle?.associations(d.car, now) ?? []).map(car => this.drivers.find(other => other.car === car)?.id).filter(id => id !== undefined), crew: d.crew ?? '', assists: f?.assists ?? 0, located: !!d.car.localizer?.estimate(now)?.located, laps: d.car.localizer?.laps ?? 0,
        energy: f ? f.energy / max : 1, disabled: f ? f.disabledUntil > battleNow : false, kills: f?.kills ?? 0, deaths: f?.deaths ?? 0,
        shield: f ? f.shield > 0 : false, attack: bay('attack'), support: bay('support'), special: bay('special')};
    });
  }
}
export {loadout};
