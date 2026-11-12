// One car: command queue, lane calibration, localisation and light helpers.
// The transport is either a Bluetooth link (ble.mjs) or a SimCar (sim.mjs); both
// expose write(bytes), onNotify(fn) and close().
import {encode, decode, rgb, EFFECT, TURN, MAX_SPEED} from './protocol.mjs';
import {Localizer, LANE_LIMIT} from './track.mjs';

export const LANE_STEP = 22.5;

export class Car {
  constructor(transport, {name = 'Car', model = 0, color = [0, 1, 0], pieces, simulated = false, clock = () => performance.now(), writeTimeoutMs = 1000} = {}) {
    this.transport = transport; this.name = name; this.model = model; this.color = color;
    this.pieces = pieces; this.simulated = simulated; this.clock = clock;
    this.writeTimeoutMs = writeTimeoutMs; this.closing = false; this.faulted = false; this.safetyReason = null;
    this.connected = true; this.pending = new Map(); this.pumping = false;
    this.listeners = new Set(); this.localizer = null;
    this.speed = 0; this.reportedSpeed = 0; this.targetLateral = 0; this.lateral = 0; this.forceLane = true;
    this.offsetSign = -1;               // car offset = sign * lateral(left +); learned below
    this.signVotes = 0; this.lastPair = null; this.lastCalibration = -1e9;
    this.millivolts = null; this.version = null; this.status = {};
    this.lightKey = ''; this.lastSpeedSent = -1; this.delocalized = false; this.rx = 0; this.tx = 0;
    this.unsubscribe = transport.onNotify(bytes => this.#receive(bytes));
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async start() {
    this.send('sdk', encode.sdkMode(true, 1));
    this.send('version', encode.version());
    this.send('battery', encode.battery());
    this.setLights(...this.color);
  }
  // Latest command per key wins, so a slow radio never builds a backlog.
  send(key, bytes) {
    if (!this.connected || this.closing || this.faulted) return;
    this.pending.delete(key); this.pending.set(key, bytes);
    if (!this.pumping) this.pumpPromise = this.#pump();
  }
  async #pump() {
    this.pumping = true;
    try {
      while (this.pending.size && this.connected && !this.closing) {
        const [key, bytes] = this.pending.entries().next().value;
        this.pending.delete(key);
        await this.#write(bytes);
      }
    } catch (error) { await this.#failSafe(error); }
    finally { this.pumping = false; }
  }
  async #write(bytes) {
    let timer;
    // A timeout is NOT completion of the browser's GATT operation. Callers must
    // close the link rather than start another write when this deadline fires.
    try {
      await Promise.race([Promise.resolve().then(() => this.transport.write(bytes)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Car write timed out'), {writeTimedOut: true})), this.writeTimeoutMs);
      })]);
      this.tx++; this.tap?.('tx', bytes);
    } finally { clearTimeout(timer); }
  }
  async #failSafe(error) {
    const wasMoving = this.speed > 0;
    this.faulted = true; this.safetyReason = 'Connection fault'; this.speed = 0; this.pending.clear();
    // A rejected, settled command may leave a perfectly live radio and a moving
    // car. Try STOP once before releasing the link; never retry motion.
    if (!error.writeTimedOut) {
      try { await this.#write(encode.speed(0, 2500)); } catch {}
    }
    this.#finishClose(error, wasMoving);
  }
  #finishClose(error, wasMoving = false) {
    const wasConnected = this.connected;
    this.connected = false; this.pending.clear(); this.unsubscribe?.();
    try { this.transport.close(); } catch {}
    if (wasConnected && error) for (const fn of this.listeners) fn({type: 'closed', wasMoving, reason: error.message ?? 'disconnected'}, this);
  }
  connectionLost(reason = 'Bluetooth link lost') {
    if (!this.connected) return;
    const wasMoving=this.speed>0;this.faulted=true;this.safetyReason='Connection fault';this.speed=0;
    this.#finishClose(new Error(reason),wasMoving);
  }
  #receive(bytes) {
    this.tap?.('rx', bytes);
    let messages;
    try { messages = decode(bytes); } catch { return; }
    const now = this.clock(); this.rx++;
    for (const m of messages) {
      if (m.type === 'position' || m.type === 'transition') this.lastTrackAt = now;
      if (m.type === 'battery') this.millivolts = m.millivolts;
      else if (m.type === 'version') this.version = m.version;
      else if (m.type === 'status') this.status = m;
      else if (m.type === 'delocalized') this.delocalized = true;
      else if (m.type === 'position') { this.delocalized = false; this.reportedSpeed = m.speed; this.lastPosition = now; this.#lane(m, now); }
      else if (m.type === 'speed') { this.reportedSpeed = Math.max(0, m.actual); this.lastPosition = now; }
      this.localizer?.feed(m, now);
      for (const fn of this.listeners) fn(m, this);
    }
  }
  // The printed code says exactly which lane the car is in. Use it to (a) tell the
  // car its true offset and (b) learn which sign the car uses for left and right.
  #lane(m, now) {
    const spot = this.pieces?.locate(m.pieceId, m.locationId, m.reverse);
    if (!spot) return;
    this.lateral = spot.lateral;
    if (this.lastPair) {
      const dTruth = spot.lateral - this.lastPair.lateral, dCar = m.offset - this.lastPair.offset;
      // A clear move the wrong way round means our assumed sign is wrong: with the
      // wrong sign every lane command drives the car away from its target.
      if (Math.abs(dTruth) > 14 && Math.abs(dCar) > 14) {
        this.signVotes += Math.sign(dTruth * dCar) === this.offsetSign ? 1 : -2;
        this.signVotes = Math.max(-2, Math.min(4, this.signVotes));
        if (this.signVotes < 0) { this.offsetSign = -this.offsetSign; this.signVotes = 0; this.lastCalibration = -1e9; this.forceLane = true; }
      }
    }
    this.lastPair = {lateral: spot.lateral, offset: m.offset};
    const expected = this.offsetSign * spot.lateral;
    if (Math.abs(m.offset - expected) > 9 && now - this.lastCalibration > 700) {
      this.send('offset', encode.setOffset(expected));
      // The car's reading jumps to "expected" without the car moving.
      this.lastCalibration = now; this.lastPair = {lateral: spot.lateral, offset: expected};
    }
  }
  useTrack(track) { this.localizer = track ? new Localizer(track, this.pieces) : null; }
  setSpeed(mmPerSec, accel = 1000) {
    const speed = this.safetyReason || this.closing || this.faulted ? 0 : Math.max(0, Math.min(MAX_SPEED, Math.round(mmPerSec)));
    if (speed > 0 && this.speed === 0) { this.motionSince = this.clock(); this.stopRequestedAt = null; }
    if (speed === 0 && this.speed > 0) this.stopRequestedAt = this.clock();
    this.speed = speed;
    if (speed === this.lastSpeedSent && accel === this.lastAccel) return;
    this.lastSpeedSent = speed; this.lastAccel = accel;
    this.send('speed', encode.speed(speed, accel));
  }
  // Lateral target, mm, positive to the left of travel.
  steerTo(lateral, speed = 350) {
    if (this.safetyReason || this.closing || this.faulted) return;
    const target = Math.max(-LANE_LIMIT, Math.min(LANE_LIMIT, lateral));
    if (Math.abs(target - this.targetLateral) < 2 && !this.forceLane) return;
    this.forceLane = false; this.targetLateral = target;
    this.send('lane', encode.changeLane(this.offsetSign * target, speed, 1000));
  }
  nudge(direction) {   // +1 left, -1 right
    const lanes = Math.round(this.targetLateral / LANE_STEP) + direction;
    this.steerTo(lanes * LANE_STEP);
  }
  uturn() { if (this.safetyReason || this.closing || this.faulted) return; this.targetLateral = -this.targetLateral; this.lastPair = null; this.send('turn', encode.turn(TURN.UTURN, 0)); }
  stop() {
    // A pending lane request may be discarded below, or the car may be moved
    // during recovery. The next steering target must reach the vehicle.
    if (this.speed > 0) this.stopRequestedAt = this.clock();
    this.forceLane = true;
    for (const key of ['speed', 'lane', 'turn']) this.pending.delete(key);
    // STOP is the next command after any already-running write.
    this.pending = new Map([['speed', encode.speed(0, 2500)], ...this.pending]);
    this.speed = 0; this.lastSpeedSent = 0; this.lastAccel = 2500;
    if (!this.connected || this.closing || this.faulted) { this.pending.clear(); return; }
    if (!this.pumping) this.pumpPromise = this.#pump();
  }
  safetyStop(reason) { this.safetyReason = reason; this.stop(); }
  recover() {
    if (!this.connected || this.closing || this.faulted) return false;
    this.safetyReason = null; this.lastSpeedSent = -1; return true;
  }
  setLights(r, g, b, effect = EFFECT.STEADY, cycles = 0) {
    const key = [r, g, b, effect, cycles].join();
    if (key === this.lightKey) return;
    this.lightKey = key; this.send('lights', rgb(r, g, b, effect, cycles));
  }
  refreshBattery() { this.send('battery', encode.battery()); }
  // Position updates stop when the car does, so an old reading means stationary.
  get liveSpeed() { return this.clock() - (this.lastPosition ?? -1e9) > 900 ? Math.min(this.reportedSpeed, this.speed) : this.reportedSpeed; }
  pose(now = this.clock()) { return this.localizer?.pose(now) ?? null; }
  close() {
    if (this.closePromise) return this.closePromise;
    this.closing = true; this.pending.clear(); this.speed = 0;
    return this.closePromise = (async () => {
      // The queue owns the radio until its current operation settles or times
      // out. Disconnect must never race a light, speed, or calibration write.
      await this.pumpPromise;
      if (this.connected) {
        try { await this.#write(encode.speed(0, 2500)); await this.#write(encode.disconnect()); }
        catch (error) { await this.#failSafe(error); }
      }
      this.#finishClose();
    })();
  }
}
