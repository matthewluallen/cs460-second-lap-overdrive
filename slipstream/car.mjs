// One car: command queue, lane calibration, localisation and light helpers.
// The transport is either a Bluetooth link (ble.mjs) or a SimCar (sim.mjs); both
// expose write(bytes), onNotify(fn) and close().
import {encode, decode, rgb, EFFECT, TURN, MAX_SPEED} from './protocol.mjs';
import {initializationPhases} from './initialization.mjs';
import {Localizer, LANE_LIMIT} from './track.mjs';

export const LANE_STEP = 22.5;

export class Car {
  constructor(transport, {name = 'Car', model = 0, color = [0, 1, 0], pieces, simulated = false, clock = () => performance.now(), writeTimeoutMs = 1000} = {}) {
    this.initializing = !!transport.initializationProfile; this.initializationStatus = this.initializing ? 'Connecting' : '';
    this.transport = transport; this.name = name; this.model = model; this.color = color;
    this.pieces = pieces; this.simulated = simulated; this.clock = clock;
    this.writeTimeoutMs = writeTimeoutMs; this.closing = false; this.faulted = false; this.safetyReason = null;
    this.connected = true; this.pending = new Map(); this.pumping = false;
    this.listeners = new Set(); this.localizer = null;
    this.speed = 0; this.reportedSpeed = 0; this.targetLateral = 0; this.lateral = 0; this.forceLane = true;
    this.offsetSign = -1;               // car offset = sign * lateral(left +); learned below
    this.laneCommandId = 0;
    this.signVotes = 0; this.lastPair = null; this.lastCalibration = -1e9;
    this.scanDelocalizationAllowance = false; this.scanDelocalizationUsed = false;
    this.firmwareInitialization = null;
    this.millivolts = null; this.version = null; this.status = {};
    this.lightKey = ''; this.lastSpeedSent = -1; this.delocalized = false; this.rx = 0; this.tx = 0;
    this.telemetry = {counts:{},malformed:0,positions:0,transitions:0,unknown:0,maxPositionGapMs:0,lastWriteMs:null,maxWriteMs:0};
    this.unsubscribe = transport.onNotify(bytes => this.#receive(bytes));
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async start() {
    if (this.transport.initializationProfile) {
      try {
        for (const phase of initializationPhases(this.transport.initializationProfile)) {
          if (!this.connected || this.closing || this.faulted) throw new Error('Connection closed during initialization');
          this.initializationStatus = phase.name;
          await this.#initializationPhase(phase);
        }
        // The native app requires its distinct 0x23 confirmation as well as phase pongs.
        // It may arrive during network setup, before the last ping barrier.
        if (this.transport.initializationProfile === 'fast-furious' && !this.firmwareInitialization) {
          this.initializationStatus = 'Waiting for firmware initialization confirmation';
          await this.#initializationPhase({name:'Firmware initialization confirmation',packets:[],reply:'carInit'});
        }
        if (!this.connected || this.closing || this.faulted) throw new Error('Connection closed during initialization');
        this.initializationStatus = 'Connected; track telemetry not yet verified';
        this.initializing = false; this.stop();
        this.send('battery', encode.battery()); this.setLights(...this.color);
      } catch (error) {
        this.initializationStatus = 'Initialization failed: ' + error.message;
        this.initializing = false;
        if (!this.faulted && !this.closing) await this.#failSafe(error);
      }
      return;
    }
    this.send('sdk', encode.sdkMode(true, 1));
    this.send('version', encode.version());
    this.send('battery', encode.battery());
    this.setLights(...this.color);
  }
  async #initializationPhase(phase) {
    // Install the listener before queueing the request; some transports reply immediately.
    await new Promise((resolve, reject) => {
      let timer;
      const finish = error => { clearTimeout(timer); off(); error ? reject(error) : resolve(); };
      const off = this.on(message => {
        if (message.type === phase.reply) finish();
        else if (message.type === 'closed') finish(new Error(message.reason));
      });
      timer = setTimeout(() => finish(new Error(phase.name + ' response timed out')), this.transport.initializationTimeoutMs ?? 3000);
      for (let i=0;i<phase.packets.length;i++) this.send('init-'+i, phase.packets[i]);
      if (phase.reply === 'ping') this.send('init-ping', encode.ping());
    });
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
    let timer; const writeStarted = this.clock();
    this.telemetry.lastWriteAttempt={at:writeStarted,id:bytes[1],bytes:[...bytes],status:'pending'};
    // A timeout is NOT completion of the browser's GATT operation. Callers must
    // close the link rather than start another write when this deadline fires.
    try {
      await Promise.race([Promise.resolve().then(() => this.transport.write(bytes)), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Car write timed out'), {writeTimedOut: true})), this.writeTimeoutMs);
      })]);
      this.telemetry.lastWriteAttempt.status='completed';
      this.telemetry.lastWriteMs = Math.max(0,this.clock()-writeStarted);
      this.telemetry.maxWriteMs = Math.max(this.telemetry.maxWriteMs,this.telemetry.lastWriteMs);
      this.tx++; this.tap?.('tx', bytes);
    } catch (error) {
      this.telemetry.lastWriteAttempt.status='failed';
      this.telemetry.lastWriteFailure={at:this.clock(),id:bytes[1],error:String(error.message??error).slice(0,200)};
      throw error;
    } finally { clearTimeout(timer); }
  }
  async #failSafe(error) {
    const wasMoving = this.speed > 0;
    this.faulted = true; this.safetyReason = 'Connection fault'; this.speed = 0; this.pending.clear();
    // A rejected, settled command may leave a perfectly live radio and a moving
    // car. Try STOP once before releasing the link; never retry motion.
    if (!error.writeTimedOut) {
      try {
        await this.#write(encode.speed(0, 2500));
        if (this.scanDelocalizationUsed) await this.#write(encode.maxDelocalizedSpeed(0));
      } catch {}
    }
    this.#finishClose(error, wasMoving);
  }
  #finishClose(error, wasMoving = false) {
    this.scanDelocalizationAllowance = false;
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
    const now = this.clock(); this.telemetry.lastNotificationAt = now;
    this.telemetry.lastRaw = [...bytes].slice(0,64).map(b=>b.toString(16).padStart(2,'0')).join(' ');
    let messages;
    try { messages = decode(bytes); } catch { this.telemetry.malformed++; return; }
    this.rx++;
    for (let at=0;at<bytes.length;at+=bytes[at]+1) {
      const key = '0x'+bytes[at+1].toString(16).padStart(2,'0')+'/'+(bytes[at]+1);
      // Protocol bounds limit possible keys; retain a smaller fixed diagnostic budget.
      if (key in this.telemetry.counts || Object.keys(this.telemetry.counts).length<128) this.telemetry.counts[key]=(this.telemetry.counts[key]??0)+1;
    }
    for (const m of messages) {
      if (m.type === 'position') {
        this.telemetry.positions++;
        if (this.telemetry.lastPositionAt !== undefined) this.telemetry.maxPositionGapMs=Math.max(this.telemetry.maxPositionGapMs,now-this.telemetry.lastPositionAt);
        this.telemetry.lastPositionAt=now;
      } else if(m.type==='transition') this.telemetry.transitions++;
      else if(m.type==='other') this.telemetry.unknown++;
      else if(m.type==='laneChange') {
        this.telemetry.laneChange={...m,at:now};
        if (m.cancelled) {
          // The requested target was not reached. Drop queued steering; the
          // reported offset is an estimate, not newly verified track geometry.
          this.pending.delete('lane');
          this.targetLateral = m.offsetKnown && Math.abs(m.currentOffset) <= LANE_LIMIT
            ? this.offsetSign * m.currentOffset : this.lateral;
          this.forceLane = true;
        }
      }
      else if(m.type==='ping') this.telemetry.lastPongAt=now;
      else if(m.type==='supercode' || m.type==='zoneSupercode') {
        // Observation only: a code is not a validated attack, location or heartbeat.
        const key = m.type === 'zoneSupercode' ? 'zoneCodes' : 'supercodes';
        this.telemetry[key] = (this.telemetry[key] ?? 0) + 1;
        this.telemetry.lastSpecialCode = {type:m.type,code:m.code,rawTag:m.rawTag,at:now};
      }
      if (m.type === 'position' || m.type === 'transition') {
        this.lastTrackAt = now;
        if (m.lastReceivedLaneChangeId !== null && m.lastReceivedLaneChangeId !== undefined) {
          this.telemetry.laneAcknowledgment = {at:now,source:m.type,
            received:m.lastReceivedLaneChangeId,executed:m.lastExecutedLaneChangeId,
            desiredLaneSpeed:m.desiredLaneSpeed,activity:m.laneChangeActivity??null};
        }
      }
      if (m.type === 'carInit') this.firmwareInitialization = m;
      else if (m.type === 'battery') this.millivolts = m.millivolts;
      else if (m.type === 'version') this.version = m.version;
      else if (m.type === 'status') this.status = m;
      else if (m.type === 'delocalized') this.delocalized = true;
      else if (m.type === 'position') { this.endScanDelocalization(); this.delocalized = false; this.reportedSpeed = m.speed; this.lastPosition = now; this.#lane(m, now); }
      else if (m.type === 'speed') { this.reportedSpeed = Math.max(0, m.actual); this.lastPosition = now; }
      this.localizer?.feed(m, now);
      for (const fn of this.listeners) fn(m, this);
    }
  }
  // The printed code says exactly which lane the car is in. Use it to (a) tell the
  // car its true offset and (b) learn which sign the car uses for left and right.
  #lane(m, now) {
    const definition = this.pieces?.get(m.pieceId);
    if (!definition || definition.unverified) {
      this.lastPair = null;
      this.telemetry.calibrationBlocked = {pieceId:m.pieceId,at:now,reason:'Unverified piece geometry'};
      return;
    }
    const spot = this.pieces?.locate(m.pieceId, m.locationId, m.reverse);
    if (!spot) { this.lastPair = null; return; }
    this.telemetry.calibrationBlocked = null;
    this.lateral = spot.lateral;
    if (this.lastPair && m.offset !== 654321) {
      const dTruth = spot.lateral - this.lastPair.lateral, dCar = m.offset - this.lastPair.offset;
      // A clear move the wrong way round means our assumed sign is wrong: with the
      // wrong sign every lane command drives the car away from its target.
      if (Math.abs(dTruth) > 14 && Math.abs(dCar) > 14) {
        this.signVotes += Math.sign(dTruth * dCar) === this.offsetSign ? 1 : -2;
        this.signVotes = Math.max(-2, Math.min(4, this.signVotes));
        if (this.signVotes < 0) { this.offsetSign = -this.offsetSign; this.signVotes = 0; this.lastCalibration = -1e9; this.forceLane = true; }
      }
    }
    this.lastPair = m.offset === 654321 ? null : {lateral: spot.lateral, offset: m.offset};
    const expected = this.offsetSign * spot.lateral;
    if (Math.abs(m.offset - expected) > 9 && now - this.lastCalibration > 700) {
      this.send('offset', encode.setOffset(expected));
      // The car's reading jumps to "expected" without the car moving.
      this.lastCalibration = now; this.lastPair = {lateral: spot.lateral, offset: expected};
    }
  }
  useTrack(track) { this.localizer = track ? new Localizer(track, this.pieces) : null; }
  calibrateScanStart(lateral) {
    if (!Number.isFinite(lateral) || Math.abs(lateral)>LANE_LIMIT) throw new Error('Starting lane must be within 68 mm of track centre');
    if (this.speed || this.initializing || !this.connected || this.closing || this.faulted || this.safetyReason) throw new Error('Stop and recover the car before calibration');
    const offset=this.offsetSign*lateral;
    this.startingCalibration={source:'operator',lateral,offset,at:this.clock(),signVerified:false};
    this.lastPair=null; this.forceLane=true;
    this.send('offset',encode.setOffset(offset));
  }
  diagnostics(now=this.clock()) {
    const age=at=>at===undefined?null:Math.max(0,Math.round(now-at));
    return {name:this.name,profile:this.transport.initializationProfile??'simulator/legacy',firmware:this.version,
      connected:this.connected,initialization:this.initializationStatus,safetyReason:this.safetyReason,
      requestedSpeed:this.speed,reportedSpeed:this.reportedSpeed,reportedSpeedAgeMs:age(this.lastPosition),
      millivolts:this.millivolts,notificationAgeMs:age(this.telemetry.lastNotificationAt),positionAgeMs:age(this.telemetry.lastPositionAt),
      ...this.telemetry,counts:{...this.telemetry.counts},startingCalibration:this.startingCalibration??null,
      scanAllowanceRequested:this.scanDelocalizationAllowance,physicalStopVerified:false};
  }
  beginScanDelocalization() {
    if (this.transport.initializationProfile !== 'fast-furious') return false;
    if (this.initializing || !this.connected || this.closing || this.faulted || this.safetyReason) return false;
    this.scanDelocalizationAllowance = true; this.scanDelocalizationUsed = true;
    this.send('scan-delocalization', encode.maxDelocalizedSpeed(300));
    return true;
  }
  endScanDelocalization() {
    if (!this.scanDelocalizationAllowance) return;
    this.scanDelocalizationAllowance = false;
    this.send('scan-delocalization', encode.maxDelocalizedSpeed(0));
  }
  setSpeed(mmPerSec, accel = 1000) {
    const speed = this.initializing || this.safetyReason || this.closing || this.faulted ? 0 : Math.max(0, Math.min(MAX_SPEED, Math.round(mmPerSec)));
    if (speed === 0) this.endScanDelocalization();
    if (speed > 0 && this.speed === 0) { this.motionSince = this.clock(); this.stopRequestedAt = null; }
    if (speed === 0 && this.speed > 0) this.stopRequestedAt = this.clock();
    this.speed = speed;
    if (speed === this.lastSpeedSent && accel === this.lastAccel) return;
    this.lastSpeedSent = speed; this.lastAccel = accel;
    this.send('speed', encode.speed(speed, accel));
  }
  // Lateral target, mm, positive to the left of travel.
  steerTo(lateral, speed = 350) {
    if (this.initializing || this.safetyReason || this.closing || this.faulted) return;
    const target = Math.max(-LANE_LIMIT, Math.min(LANE_LIMIT, lateral));
    if (Math.abs(target - this.targetLateral) < 2 && !this.forceLane) return;
    this.forceLane = false; this.targetLateral = target;
    // F&F VehicleState::IncrementLaneChangeID (007bd20e): 7-bit sequence.
    // The upper bit is reserved for cancellation in car reports. An ACK is
    // evidence of command processing, never proof of physical lane completion.
    this.laneCommandId = (this.laneCommandId + 1) & 0x7f;
    this.telemetry.laneRequest = {id:this.laneCommandId,at:this.clock(),target,
      offset:this.offsetSign*target,horizontalSpeed:speed,acceleration:1000};
    this.send('lane', encode.changeLane(this.offsetSign * target, speed, 1000, this.laneCommandId));
  }
  nudge(direction) {   // +1 left, -1 right
    const lanes = Math.round(this.targetLateral / LANE_STEP) + direction;
    this.steerTo(lanes * LANE_STEP);
  }
  uturn() { if (this.initializing || this.safetyReason || this.closing || this.faulted) return; this.targetLateral = -this.targetLateral; this.lastPair = null; this.send('turn', encode.turn(TURN.UTURN, 0)); }
  stop() {
    // A pending lane request may be discarded below, or the car may be moved
    // during recovery. The next steering target must reach the vehicle.
    if (this.speed > 0) this.stopRequestedAt = this.clock();
    this.forceLane = true;
    this.scanDelocalizationAllowance = false;
    this.pending.delete('scan-delocalization');
    for (const key of ['speed', 'lane', 'turn']) this.pending.delete(key);
    // STOP is the next command after any already-running write.
    this.pending = new Map([['speed', encode.speed(0, 2500)],
      ...(this.scanDelocalizationUsed ? [['scan-delocalization', encode.maxDelocalizedSpeed(0)]] : []), ...this.pending]);
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
    this.closing = true; this.scanDelocalizationAllowance = false; this.pending.clear(); this.speed = 0;
    return this.closePromise = (async () => {
      // The queue owns the radio until its current operation settles or times
      // out. Disconnect must never race a light, speed, or calibration write.
      await this.pumpPromise;
      if (this.connected) {
        try {
          await this.#write(encode.speed(0, 2500));
          if (this.scanDelocalizationUsed) await this.#write(encode.maxDelocalizedSpeed(0));
          await this.#write(encode.disconnect());
        }
        catch (error) { await this.#failSafe(error); }
      }
      this.#finishClose();
    })();
  }
}
