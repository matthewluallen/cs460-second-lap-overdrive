// Game orchestration with no DOM: drivers, scanning, battle and the control loop.
import {Car, LANE_STEP} from './car.mjs';
import {Pieces, Track, TrackMapper, traversal, trackFromPlan, LANE_LIMIT} from './track.mjs';
import {Battle, Bot, loadout} from './battle.mjs';

export const MAX_CARS = 4;
export const TEAM_COLORS = [[0, 1, 0], [0, 0.4, 1], [1, 0.5, 0], [1, 0, 1], [0, 1, 1], [1, 1, 0], [1, 1, 1], [1, 0, 0.3]];
export const emptyInput = () => ({throttle: 0, lane: null, attack: false, support: false, special: false});

export class Game {
  constructor({pieces, weapons, vehicles, clock = () => performance.now(), log = () => {}, safety = {}, schedule = (fn,ms) => setTimeout(fn,ms), unschedule = timer => clearTimeout(timer)}) {
    this.pieces = new Pieces(pieces); this.weapons = weapons; this.vehicles = vehicles;
    this.clock = clock; this.log = log; this.schedule = schedule; this.unschedule = unschedule; this.diagnostic = null;
    this.laneCancellationComparison=null;
    this.safety = {firstTrackMs:5000, trackGapMs:2000, stopGraceMs:1000, scanMs:45000, scanLaps:3, ...safety};
    for (const value of Object.values(this.safety)) if (!Number.isFinite(value) || value <= 0) throw new Error("Invalid safety limit");
    this.drivers = []; this.track = null; this.battle = null; this.mapper = null; this.scanner = null;
    this.phase = 'garage'; this.halted = false; this.pitReason = null; this.topSpeed = 700; this.scanSpeed = 450; this.nextId = 1;
  }
  modelName(model) { return this.vehicles.models[String(model)]?.name ?? 'Unknown'; }
  addCar(transport, {name, model = 8, simulated = false, control = 'none', beforeStart} = {}) {
    if (this.laneCancellationComparison) this.stopAll();
    if (this.drivers.length >= MAX_CARS) throw new Error('A session supports at most four cars');
    if (typeof transport.id === 'string' && this.drivers.some(d => d.car.connected && d.car.transport.id === transport.id)) throw new Error('This car is already in the garage');
    const color = TEAM_COLORS.find(color => !this.drivers.some(d => d.car.color === color));
    const car = new Car(transport, {name: name || this.modelName(model), model, color, pieces: this.pieces, simulated, clock: this.clock});
    const driver = {id: this.nextId++, car, input: emptyInput(), control, bot: null, previous: emptyInput()};
    car.on(message => this.#message(driver, message));
    this.drivers.push(driver);
    if (this.track) car.useTrack(this.track);
    if (this.battle) this.battle.add(car);
    beforeStart?.(driver);
    car.initialization = car.start();
    return driver;
  }
  async removeCar(driver) {
    if (this.diagnostic || this.laneCancellationComparison) this.stopAll();
    this.drivers = this.drivers.filter(d => d !== driver);
    this.battle?.remove(driver.car);
    if (this.scanner === driver) this.cancelScan();
    await driver.car.close();
  }
  setModel(driver, model) {
    if (this.diagnostic || this.laneCancellationComparison) this.stopAll();
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
    if (this.diagnostic || this.laneCancellationComparison) this.stopAll();
    driver.gamepadBinding = null; driver.cpuArmed = false; driver.armed = false; driver.control = control; driver.gamepadArmed = false; driver.input = emptyInput(); driver.level = 0; driver.car.stop();
    driver.bot = control === 'bot' && this.battle ? new Bot(driver.car, this.battle) : null;
  }
  #message(driver, message) {
    if (message.type==='hostStopped') { if(this.laneCancellationComparison?.driver===driver)this.stopAll(); return; }
    if (this.diagnostic?.driver === driver && !this.diagnostic.steering && message.type === 'collision') { this.requestPit(driver, 'Collision during diagnostic'); return; }
    if (message.type === 'laneChange' && message.cancelled) {
      driver.input.lane = null;
      const comparison=this.laneCancellationComparison;
      if (comparison?.driver===driver && driver.car.speed>0) {
        comparison.cancelled=true;
        driver.car.lockSteering('Lane cancelled during supervised comparison');
        Object.assign(driver.car.telemetry.laneCancellationComparison,{cancelled:true,at:this.clock(),reason:'Lane cancellation: steering locked; forward comparison continues',count:(driver.car.telemetry.laneCancellationComparison.count??0)+1});
        this.log(driver.car.name+': LANE CANCELLED — STEERING LOCKED; supervised forward comparison continues at no more than 300 mm/s. STOP ends comparison.');
        return;
      }
      // Continuous phone/CPU input must not silently retry a rejected command.
      // Reuse the shared recovery flow when the cancellation occurs in motion.
      if (driver.car.speed > 0) { this.requestPit(driver, 'Lane change cancelled by car'); return; }
    }
    if (message.type === 'closed') { if(message.wasMoving) this.requestPit(driver, 'Connection lost while moving: ' + message.reason); else if(this.laneCancellationComparison?.driver===driver)this.stopAll(); this.log(driver.car.name + ' disconnected: ' + message.reason); return; }
    const trial=this.diagnostic;
    if (trial?.steering && trial.driver===driver && message.type==='position' && !trial.laneRequested) {
      const now=this.clock(), car=driver.car, definition=this.pieces.get(message.pieceId);
      const spot=definition?.kind==='straight' && !definition.unverified ? this.pieces.locate(message.pieceId,message.locationId,message.reverse) : null;
      const target=spot ? spot.lateral+LANE_STEP : Infinity;
      if (now>trial.started && now<trial.until && trial.until-now>=750 && message.speed>0 && spot && (1-spot.progress)*definition.length>=250 && Math.abs(target)<=LANE_LIMIT && car.lateralEstimate?.source==='printed-code' && car.lateralEstimate.at===now) {
        // Commit the single attempt before any queued write can produce a reply.
        trial.laneRequested=true; trial.until=Math.min(trial.until,now+750); car.diagnosticUntil=trial.until;
        trial.laneTimer=this.schedule(()=>{if(this.diagnostic===trial){this.stopAll();this.log('Steering test completed: STOP requested; confirm physical stop');}},trial.until-now);
        if (!car.steerDiagnosticOnce(target)) { this.stopAll(); this.log('Steering test stopped: lane request unavailable'); return; }
        this.log('Steering test: one left request from fresh printed lane '+spot.lateral+' to '+target+' mm');
      }
    }
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
    if (this.laneCancellationComparison) {
      const c=this.laneCancellationComparison.driver.car;
      Object.assign(c.telemetry.laneCancellationComparison,{active:false,ended:this.clock()});
      this.laneCancellationComparison=null;
    }
    if (this.diagnostic) { this.unschedule(this.diagnostic.timer); if(this.diagnostic.laneTimer)this.unschedule(this.diagnostic.laneTimer); this.diagnostic = null; }
    for (const d of this.drivers) {
      d.car.diagnosticMotion = false; d.car.diagnosticSteering = false; d.car.diagnosticLaneSent = false;
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
  startScan(driver = this.drivers.find(d => d.car.connected), {startingLateral = null} = {}) {
    if (startingLateral !== null && (!Number.isFinite(startingLateral) || Math.abs(startingLateral)>68)) throw new Error('Starting lane must be within 68 mm of track centre');
    if (!driver) throw new Error('Connect a car first');
    if (driver.car.initializing || !driver.car.connected || driver.car.closing || driver.car.faulted) throw new Error('Wait for car initialization to complete');
    if (driver.car.safetyReason === 'Off track') throw new Error('Return the car to the track and recover it before scanning');
    if(this.pitReason) throw new Error('Pit stop: complete shared recovery before scanning');
    this.stopAll(); this.halted=false; if(driver.car.safetyReason==='Host stopped')driver.car.recover(); this.stopBattle();
    this.scanStarted = this.clock(); this.scanLaps = 0; this.scanAnchor = undefined; this.scanLastPiece = undefined;
    this.mapper = new TrackMapper(this.pieces); this.scanner = driver; this.phase = 'scanning';
    this.track = null; for (const d of this.drivers) d.car.useTrack(null);
    // Physical acquisition follows the operator-placed lane. An unlocalized
    // lane request was cancelled even in the formerly successful scan capture.
    // Keep simulated placement on a readable strip; it is not hardware parity.
    if (startingLateral !== null) driver.car.calibrateScanStart(startingLateral);
    driver.car.beginScanDelocalization();
    const ceiling = driver.car.transport.initializationProfile === 'fast-furious' ? 300 : this.scanSpeed;
    if (driver.car.simulated) driver.car.steerTo(LANE_STEP);
    driver.car.setSpeed(Math.min(this.topSpeed, this.scanSpeed, ceiling));
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
    if (this.laneCancellationComparison) this.stopAll();
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
    if (this.laneCancellationComparison) this.stopAll();
    if (!this.track) throw new Error('Map the track first');
    if (this.track.unverifiedCount) throw new Error('Special track pieces are unverified; scored rounds are blocked');
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
    if (this.laneCancellationComparison) throw new Error('Stop the supervised comparison before resuming normal driving');
    if (this.diagnostic) throw new Error('Finish or stop the diagnostic first');
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
  // Explicit operator-authorized comparison only. A lane cancellation locks all
  // further host steering while forward driving continues; every other stop and
  // watchdog remains active. This is not the default driving or race policy.
  startLaneCancellationComparison(driver) {
    if (this.laneCancellationComparison || this.diagnostic || this.pitReason || this.phase==='scanning' || this.battle?.active) throw new Error('Stop and clear the pit before the comparison');
    if (!this.drivers.includes(driver) || !driver.car.connected || driver.car.initializing || driver.car.faulted || driver.car.closing || driver.control!=='bot' || !driver.bot) throw new Error('Select a ready Computer driver for the comparison');
    if (this.drivers.filter(d=>d.car.connected).length!==1) throw new Error('Use exactly one connected car for the comparison');
    if (this.drivers.some(d=>d.car.speed>0)) throw new Error('Stop all cars first');
    if (!this.track?.closed || this.track.inferredCount) throw new Error('Map a complete identified track before the comparison');
    const c=driver.car,d=c.diagnostics();
    if (c.safetyReason && c.safetyReason!=='Host stopped') throw new Error('Recover the car first');
    if (d.batteryAgeMs===null || d.batteryAgeMs>30000) throw new Error('Refresh the battery reading before the comparison');
    if (d.status.onCharger || d.status.lowBattery) throw new Error('Car reports charging or low battery');
    this.stopAll();this.resume();
    const started=this.clock();
    this.laneCancellationComparison={driver,cancelled:false,started};
    c.telemetry.laneCancellationComparison={active:true,cancelled:false,started};
    driver.input=emptyInput();driver.cpuArmed=true;driver.armed=true;
    this.log('Supervised lane-cancellation comparison armed: forward ceiling 300 mm/s; a cancellation locks steering but does not stop forward driving. STOP ends comparison.');
  }
  // One supervised pulse, bounded independently of the animation/control loop.
  // This is a host deadline, never a guarantee across suspension or BLE loss.
  startDiagnostic(driver, {steering=false} = {}) {
    if (this.laneCancellationComparison || this.diagnostic || this.pitReason || this.phase === 'scanning' || this.battle?.active) throw new Error('Stop and clear the pit before a diagnostic');
    if (!this.drivers.includes(driver) || !driver.car.connected || driver.car.initializing || driver.car.faulted || driver.car.closing) throw new Error('Car is not ready');
    if (this.drivers.some(d => d.car.speed > 0)) throw new Error('Stop all cars first');
    if (steering && (!this.track?.closed || this.track.inferredCount)) throw new Error('Map a complete identified track before the steering test');
    const c = driver.car, d = c.diagnostics();
    if (c.safetyReason && c.safetyReason !== 'Host stopped') throw new Error('Recover the car first');
    if (d.batteryAgeMs === null || d.batteryAgeMs > 30000) throw new Error('Refresh the battery reading before the diagnostic');
    if (d.status.onCharger || d.status.lowBattery) throw new Error('Car reports charging or low battery');
    this.stopAll(); c.recover();
    const duration=steering?4000:500;
    const pulse = {driver, steering:!!steering, started:this.clock(), until:this.clock()+duration, timer:null, laneTimer:null, laneRequested:false};
    this.diagnostic = pulse; c.diagnosticMotion = true; c.diagnosticSteering=!!steering; c.diagnosticLaneSent=false; c.diagnosticUntil = pulse.until;
    pulse.timer = this.schedule(() => {
      if (this.diagnostic !== pulse) return;
      this.stopAll(); this.log('Diagnostic deadline: STOP requested; confirm physical stop');
    },duration);
    c.setSpeed(Math.min(steering?300:150,this.topSpeed));
    this.log(steering?'Experimental steering test: at most 300 mm/s, 4 s total; one left request only after a fresh ordinary straight code; raw collision packets follow ordinary driving policy':'Diagnostic: at most 150 mm/s requested for a 500 ms host window; no steering');
  }
  // --- control loop ------------------------------------------------------------
  tick(dt, now = this.clock()) {
    if (this.laneCancellationComparison) {
      const d=this.laneCancellationComparison.driver,c=d.car;
      if (!c.connected || c.closing || c.faulted || d.control!=='bot' || this.battle?.active) this.stopAll();
    }
    if (this.diagnostic) {
      const {driver,until} = this.diagnostic;
      if (now >= until || !driver.car.connected || driver.car.safetyReason || driver.car.speed === 0) this.stopAll();
      else if (this.diagnostic.steering) {
        const car=driver.car, hasTrack=car.lastTrackAt!==undefined && car.lastTrackAt>=car.motionSince;
        if(now-(hasTrack?car.lastTrackAt:car.motionSince)>(hasTrack?this.safety.trackGapMs:this.safety.firstTrackMs)) this.requestPit(driver,'Telemetry timeout');
      }
      return; // no human, phone, CPU or gameplay commands during the pulse
    }
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
      let cpuTrackCeiling=1;
      if (d.bot && this.track) {
        d.bot.drive(now, d.input);
        // Session objectives guide CPU throttle/lane only. They cannot bypass
        // safety latches, weapon rules, or the operator's final speed ceiling.
        if (d.objectiveInput) {
          if (Number.isFinite(d.objectiveInput.throttle)) d.input.throttle = Math.max(0, Math.min(1, d.objectiveInput.throttle));
          if (Number.isFinite(d.objectiveInput.lane)) d.input.lane = Math.max(-68, Math.min(68, d.objectiveInput.lane));
        }
        cpuTrackCeiling=d.bot.applyTrackPolicy?.(now,d.input,{objective:!!d.objectiveInput,topSpeed:this.topSpeed}) ?? 1;
      }
      const input = d.input, truck = this.vehicles.models[String(car.model)]?.truck;
      const wanted = Math.max(0, Math.min(1, input.throttle || 0)) * this.topSpeed * (truck ? 0.85 : 1);
      const limited = this.battle ? this.battle.limit(car, wanted, now) : {speed: wanted, accel: 1000};
      const finalSpeed=Math.min(this.topSpeed*cpuTrackCeiling, limited.speed,this.laneCancellationComparison?300:Infinity);
      if (d.bot && this.track) d.bot.confirmTrackLane?.(now,input,finalSpeed,limited.accel);
      car.setSpeed(finalSpeed, limited.accel);
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
