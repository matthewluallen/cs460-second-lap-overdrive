// One car: command queue, lane calibration, localisation and light helpers.
// The transport is either a Bluetooth link (ble.mjs) or a SimCar (sim.mjs); both
// expose write(bytes), onNotify(fn) and close().
import {encode, decode, rgb, EFFECT, TURN, MAX_SPEED, offsetIsKnown} from './protocol.mjs';
import {initializationPhases} from './initialization.mjs';
import {Localizer, LANE_LIMIT, POSITION_MAX_AGE_MS} from './track.mjs';

const lateralCommand = bytes => [0x25,0x2c,0x32,0x34].includes(bytes[1]);
const offsetCommand = bytes => [0x2c,0x34].includes(bytes[1]);
const driveCommand = bytes => lateralCommand(bytes) || ([0x24,0x37].includes(bytes[1]) && (bytes[2] || bytes[3]));

export const LANE_STEP = 22.5;

export class Car {
  constructor(transport, {name = 'Car', model = 0, color = [0, 1, 0], pieces, simulated = false, clock = () => performance.now(), writeTimeoutMs = 1000} = {}) {
    this.initializing = !!transport.initializationProfile; this.initializationStatus = this.initializing ? 'Connecting' : '';
    this.transport = transport; this.name = name; this.model = model; this.color = color;
    this.pieces = pieces; this.simulated = simulated; this.clock = clock;
    this.writeTimeoutMs = writeTimeoutMs; this.closing = false; this.faulted = false; this.safetyReason = null;
    this.connected = true; this.pending = new Map(); this.pumping = false;
    this.queuedAt=new WeakMap();
    this.transportHealth={completed:0,failed:0,timeouts:0,lateCompletions:0,suppressed:0,coalesced:0,
      lastQueueWaitMs:null,maxQueueWaitMs:0,lastCompletedApiMs:null,maxCompletedApiMs:null};
    this.listeners = new Set(); this.localizer = null;
    this.speed = 0; this.reportedSpeed = 0; this.targetLateral = 0; this.lateral = 0; this.forceLane = true;
    this.offsetSign = -1;               // car offset = sign * lateral(left +); learned below
    this.laneCommandId = 0;
    this.steeringLocked = false; this.steeringLockVersion = 0; this.driveEpoch = 0;
    this.maneuversLocked = false; this.maneuverLockVersion = 0; this.maneuverPackets = new WeakSet();
    this.telemetryGuardVersion = 0; this.telemetryGraceUntil = undefined; this.telemetrySpeedCeiling = undefined;
    this.physicalLaneReference = null; this.physicalLanePackets = new WeakMap();
    this.opticalCalibrationReference = null; this.opticalCalibrationPackets = new WeakMap();
    this.signVotes = 0; this.lastPair = null; this.lastCalibration = -1e9;
    this.scanDelocalizationAllowance = false; this.scanDelocalizationUsed = false;
    this.firmwareInitialization = null;
    this.sdkPlasticTrack = {requested:transport.initializationOptions?.plasticTrack===true,sequenceComplete:false,firmwareApplied:null};
    this.millivolts = null; this.version = null; this.status = {};
    this.lightKey = ''; this.lastSpeedSent = -1; this.delocalized = false; this.rx = 0; this.tx = 0;
    this.telemetry = {counts:{},malformed:0,positions:0,transitions:0,unknown:0,maxPositionGapMs:0,lastWriteMs:null,maxWriteMs:0};
    this.unsubscribe = transport.onNotify(bytes => this.#receive(bytes));
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async start() {
    if (this.transport.initializationProfile) {
      const options={...this.transport.initializationOptions};
      this.sdkPlasticTrack={requested:options.plasticTrack===true,sequenceComplete:false,firmwareApplied:null};
      try {
        this.transport.drainNotifications?.();
        for (const phase of initializationPhases(this.transport.initializationProfile,options)) {
          if (!this.connected || this.closing || this.faulted) throw new Error('Connection closed during initialization');
          this.initializationStatus = phase.name;
          await this.#initializationPhase(phase);
          if (phase.sdkPlasticTrack) this.sdkPlasticTrack.sequenceComplete=true;
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
        this.sdkPlasticTrack.sequenceComplete=false;
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
      let timer,finished=false;
      const until=this.clock()+(this.transport.initializationTimeoutMs??3000);
      const request=phase.reply==='ping'?encode.ping():phase.reply==='version'?phase.packets.find(packet=>packet[1]===0x18):null;
      if(phase.reply==='version' && !request) { reject(new Error('Firmware version phase has no request')); return; }
      const replyGate=request?{request,entered:false}:null;
      if (replyGate) this.initializationReplyGate=replyGate;
      const finish = error => { if(finished)return;finished=true; if(!error && this.clock()>=until)error=new Error(phase.name+' response timed out'); clearTimeout(timer); off(); if(this.initializationReplyGate===replyGate)this.initializationReplyGate=null; error ? reject(error) : resolve(); };
      const off = this.on(message => {
        if (message.type === phase.reply && (!replyGate || replyGate.entered)) finish();
        else if (message.type === 'closed') finish(new Error(message.reason));
      });
      timer = setTimeout(() => finish(new Error(phase.name + ' response timed out')), this.transport.initializationTimeoutMs ?? 3000);
      for (let i=0;i<phase.packets.length;i++) this.send('init-'+i, phase.packets[i]);
      if (phase.reply === 'ping') this.send('init-ping', request);
    });
  }
  // Latest command per key wins, so a slow radio never builds a backlog.
  send(key, bytes) {
    if (!this.connected || this.closing || this.faulted) return;
    if (this.steeringLocked && [0x25,0x2c,0x32,0x34].includes(bytes[1])) return;
    // The SDK lane preamble is a maneuver even though it shares the offset
    // opcode with optical calibration. Preserve that distinction in the queue.
    if (key==='lane-offset') this.maneuverPackets.add(bytes);
    if (this.maneuversLocked && this.#isManeuver(bytes)) return;
    if (offsetCommand(bytes)) this.lastPair=null;
    const queueKey=bytes[1]===0x24 && !bytes[2] && !bytes[3]?'stop':key;
    if(this.pending.has(queueKey))this.transportHealth.coalesced++;
    this.queuedAt.set(bytes,this.clock());
    if (bytes[1]===0x24 && !bytes[2] && !bytes[3]) {
      // A restart is a later intention, never a replacement for an undelivered
      // STOP. Keep the barrier first, independent of the coalesced speed key.
      this.pending.delete('stop'); this.pending=new Map([['stop',bytes],...this.pending]);
    } else { this.pending.delete(key); this.pending.set(key, bytes); }
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
    const lateral=lateralCommand(bytes), lockVersion=this.steeringLockVersion, driveEpoch=this.driveEpoch;
    const maneuver=this.#isManeuver(bytes), maneuverVersion=this.maneuverLockVersion;
    const positiveSpeed=bytes[1]===0x24 && (bytes[2] || bytes[3]);
    const telemetryVersion=this.telemetryGuardVersion,telemetryDeadline=positiveSpeed?this.telemetryGraceUntil:undefined;
    this.activeWrite=bytes;this.activeWriteAt=null;
    let suppressed=false,apiStarted=null;
    const trialMotion = (bytes[1] === 0x24 && (bytes[2] || bytes[3])) || (this.diagnosticSteering && [0x25,0x2c].includes(bytes[1]));
    const deadline = this.diagnosticMotion && trialMotion ? this.diagnosticUntil : undefined;
    const baselineDeadline = bytes[1]===0x24 && (bytes[2] || bytes[3]) ? this.forwardBaselineUntil : undefined;
    this.telemetry.lastWriteAttempt={at:writeStarted,id:bytes[1],bytes:[...bytes],status:'pending'};
    // A timeout is NOT completion of the browser's GATT operation. Callers must
    // close the link rather than start another write when this deadline fires.
    try {
      await Promise.race([Promise.resolve().then(() => {
        // Dequeueing is not entry into the radio. STOP may run before this
        // microtask; an explicit restart must not revive that older command.
        if (driveCommand(bytes) && this.beforeMotionWrite?.(this.clock())===false) { suppressed=true; return; }
        if (driveCommand(bytes) && (driveEpoch!==this.driveEpoch || this.closing || this.faulted || !this.connected || this.safetyReason)) { suppressed=true; return; }
        if (lateral && (this.steeringLocked || lockVersion!==this.steeringLockVersion)) { suppressed=true; return; }
        if (maneuver && (this.maneuversLocked || maneuverVersion!==this.maneuverLockVersion)) { suppressed=true; return; }
        if (positiveSpeed && (telemetryVersion!==this.telemetryGuardVersion ||
            (this.telemetrySpeedCeiling!==undefined && bytes[2]+256*bytes[3]>this.telemetrySpeedCeiling))) { suppressed=true; return; }
        // A ready GATT promise can run before an overdue timer callback.
        // Check the captured deadline at the last host boundary before motion.
        if (deadline !== undefined && this.clock() >= deadline) throw new Error('Diagnostic motion expired before write');
        if (baselineDeadline !== undefined && this.clock() >= baselineDeadline) throw new Error('Forward-only baseline expired before write');
        if (telemetryDeadline !== undefined && this.clock() >= telemetryDeadline) throw new Error('Telemetry recovery window expired before write');
        const reference=this.physicalLanePackets.get(bytes);
        if (reference && !this.#laneReferenceReady(reference)) { this.forceLane=true; suppressed=true; return; }
        const calibration=this.opticalCalibrationPackets.get(bytes), now=this.clock();
        if (calibration && (calibration!==this.opticalCalibrationReference || now<calibration.at || now-calibration.at>POSITION_MAX_AGE_MS)) {
          suppressed=true; return;
        }
        // An unsent correction must not consume the throttle for a newer code.
        // Entry into the transport is still not firmware measurement or ACK.
        if (calibration) this.lastCalibration=now;
        // A premature pong/version cannot confirm a phase before its own
        // request enters the serialized radio. Replies have no correlation ID:
        // a later pong remains a sequence barrier, not semantic acceptance.
        if(this.clock()-writeStarted>=this.writeTimeoutMs)throw Object.assign(new Error('Car write timed out before transport entry'),{writeTimedOut:true});
        if (this.initializationReplyGate?.request===bytes) this.initializationReplyGate.entered=true;
        apiStarted=this.clock();this.activeWriteAt=apiStarted;
        const wait=Math.max(0,apiStarted-(this.queuedAt.get(bytes)??writeStarted));
        this.transportHealth.lastQueueWaitMs=wait;this.transportHealth.maxQueueWaitMs=Math.max(this.transportHealth.maxQueueWaitMs,wait);
        return this.transport.write(bytes);
      }), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('Car write timed out'), {writeTimedOut: true})), this.writeTimeoutMs);
      })]);
      if (suppressed) { this.transportHealth.suppressed++; this.telemetry.lastWriteAttempt.status='suppressed'; return; }
      // Promise continuations can run before an overdue timeout task after a
      // browser stall. Settlement is not timely success just because it won.
      const duration=Math.max(0,this.clock()-apiStarted);
      this.transportHealth.completed++;this.transportHealth.lastCompletedApiMs=duration;
      this.transportHealth.maxCompletedApiMs=Math.max(this.transportHealth.maxCompletedApiMs,duration);
      this.telemetry.lastWriteAttempt.status='completed';
      this.telemetry.lastWriteMs = Math.max(0,this.clock()-writeStarted);
      this.telemetry.maxWriteMs = Math.max(this.telemetry.maxWriteMs,this.telemetry.lastWriteMs);
      this.tx++; this.tap?.('tx', bytes);
      if(this.clock()-writeStarted>=this.writeTimeoutMs){
        this.transportHealth.lateCompletions++;
        throw Object.assign(new Error('Car write completed after its deadline'),{writeTimedOut:true,writeSettled:true});
      }
    } catch (error) {
      this.telemetry.lastWriteAttempt.status=error.writeTimedOut?'timed-out':'failed';
      if(error.writeTimedOut)this.transportHealth.timeouts++;else if(apiStarted!==null)this.transportHealth.failed++;
      this.telemetry.lastWriteFailure={at:this.clock(),id:bytes[1],error:String(error.message??error).slice(0,200)};
      this.telemetry.firstWriteFailure??={...this.telemetry.lastWriteFailure};
      throw error;
    } finally { clearTimeout(timer); if(this.activeWrite===bytes){this.activeWrite=null;this.activeWriteAt=null;} }
  }
  async #failSafe(error) {
    const wasMoving = this.speed > 0;
    this.#invalidateDriveCommands();
    this.faulted = true; this.safetyReason = 'Connection fault'; this.speed = 0; this.pending.clear();
    // A rejected, settled command may leave a perfectly live radio and a moving
    // car. Try STOP once before releasing the link; never retry motion.
    if (!error.writeTimedOut || error.writeSettled) {
      try {
        await this.#write(encode.speed(0, 2500));
        if (this.scanDelocalizationUsed) await this.#write(encode.maxDelocalizedSpeed(0));
      } catch {}
    }
    this.#finishClose(error, wasMoving);
  }
  #finishClose(error, wasMoving = false) {
    this.sdkPlasticTrack.sequenceComplete=false;
    this.scanDelocalizationAllowance = false;
    this.forwardBaselineUntil=undefined; this.unlockManeuvers();
    this.endTelemetryGrace();
    this.diagnosticMotion = false; this.diagnosticSteering = false; this.diagnosticLaneSent = false;
    const wasConnected = this.connected;
    this.connected = false; this.localizer?.invalidate('Disconnected'); this.pending.clear(); this.unsubscribe?.();
    try { this.transport.close(); } catch {}
    if (wasConnected && error) for (const fn of this.listeners) fn({type: 'closed', wasMoving, reason: error.message ?? 'disconnected'}, this);
  }
  connectionLost(reason = 'Bluetooth link lost') {
    if (!this.connected) return;
    this.#invalidateDriveCommands();
    const wasMoving=this.speed>0;this.faulted=true;this.safetyReason='Connection fault';this.speed=0;
    this.#finishClose(new Error(reason),wasMoving);
  }
  #receive(bytes) {
    this.tap?.('rx', bytes);
    const now = this.clock(); this.telemetry.lastNotificationAt = now;
    this.telemetry.lastRaw = [...bytes].slice(0,64).map(b=>b.toString(16).padStart(2,'0')).join(' ');
    let messages;
    try { messages = decode(bytes); } catch {
      this.telemetry.malformed++;
      // A complete safety frame must survive a malformed concatenated tail.
      // Never guess offsets or reassemble fragments; no optical/init evidence
      // is accepted from an otherwise malformed notification.
      messages=[];
      for(let at=0;at<bytes.length;){
        const end=at+1+bytes[at];if(bytes[at]<1 || end>bytes.length)break;
        try { for(const message of decode(bytes.subarray(at,end))) {
          if(['delocalized','delocRecoveryEntered','collision'].includes(message.type) ||
              (message.type==='laneChange' && message.cancelled) ||
              (message.type==='status' && (!message.onTrack || message.lowBattery || message.onCharger)))messages.push(message);
        } } catch {break;}
        at=end;
      }
      if(!messages.length)return;
    }
    this.rx++;
    for (let at=0;at<bytes.length;at+=bytes[at]+1) {
      if(bytes[at]<1 || at+1+bytes[at]>bytes.length)break;
      const key = '0x'+bytes[at+1].toString(16).padStart(2,'0')+'/'+(bytes[at]+1);
      // Protocol bounds limit possible keys; retain a smaller fixed diagnostic budget.
      if (key in this.telemetry.counts || Object.keys(this.telemetry.counts).length<128) this.telemetry.counts[key]=(this.telemetry.counts[key]??0)+1;
    }
    let rejectedOpticalBatch=false;
    for (const m of messages) {
      if ((m.type==='position' || m.type==='transition') && (rejectedOpticalBatch || this.beforeTrackObservation?.(m,now)===false)) {
        rejectedOpticalBatch=true;
        this.telemetry.rejectedTrackObservations=(this.telemetry.rejectedTrackObservations??0)+1;continue;
      }
      if (m.type === 'position') {
        // Every optical observation supersedes the prior calibration basis,
        // including unreadable/special codes and positions during diagnostics.
        this.opticalCalibrationReference={at:now};
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
          this.pending.delete('lane-offset');
          this.steeringLockVersion++; this.lastPair=null;
          this.targetLateral = m.offsetKnown && Math.abs(m.currentOffset) <= LANE_LIMIT
            ? this.offsetSign * m.currentOffset : this.lateral;
          this.forceLane = true;
        }
      }
      else if(m.type==='delocRecoveryEntered' || m.type==='delocRecoverySucceeded') {
        const key=m.type==='delocRecoveryEntered'?'recoveryEntered':'recoverySucceeded';
        this.telemetry[key]=(this.telemetry[key]??0)+1; this.telemetry.lastRecoveryEvent={type:m.type,at:now};
      }
      else if(m.type==='collision') { this.telemetry.collisions=(this.telemetry.collisions??0)+1; this.telemetry.lastCollision={...m,at:now}; }
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
      else if (m.type === 'battery') { this.millivolts = m.millivolts; this.telemetry.batteryAt = now; }
      else if (m.type === 'version') this.version = m.version;
      else if (m.type === 'status') { this.status = m; this.telemetry.statusAt = now; }
      else if (m.type === 'delocalized') this.delocalized = true;
      else if (m.type === 'position') { this.endScanDelocalization(); this.delocalized = false; this.reportedSpeed = m.speed; this.lastPosition = now; if (!this.diagnosticMotion || (this.diagnosticSteering && now < this.diagnosticUntil)) this.#lane(m, now); }
      else if (m.type === 'speed') { this.telemetry.speedReport={...m,at:now}; this.reportedSpeed = Math.max(0, m.actual); this.lastPosition = now; }
      if (m.type==='delocalized' || m.type==='delocRecoveryEntered' || (m.type==='status' && !m.onTrack)) {
        this.lastPair=null; this.physicalLaneReference=null; this.opticalCalibrationReference=null;
      }
      this.localizer?.feed(m, now);
      if (this.safetyReason==='Off track') this.localizer?.invalidate('Off track; recover before acquiring a new reference');
      // Consumers can match state derived from this observation without
      // comparing it to a later, independently sampled host clock.
      for (const fn of this.listeners) fn(m, this, now);
    }
  }
  // Verified piece geometry maps a printed code to a lateral estimate. Use that
  // estimate for offset calibration and same-frame sign-learning evidence.
  #lane(m, now) {
    this.physicalLaneReference=null;
    const definition = this.pieces?.get(m.pieceId);
    if (!definition || definition.unverified) {
      this.lastPair = null;
      this.telemetry.calibrationBlocked = {pieceId:m.pieceId,at:now,reason:'Unverified piece geometry'};
      return;
    }
    const spot = this.pieces?.locate(m.pieceId, m.locationId, m.reverse);
    if (!spot) { this.lastPair = null; return; }
    this.telemetry.calibrationBlocked = null;
    this.lateral = spot.lateral; this.lateralEstimate = {source:'printed-code',at:now,signVerified:false};
    if (Number.isFinite(spot.lateral) && Math.abs(spot.lateral)<=LANE_LIMIT && Number.isFinite(m.speed) && m.speed>0 && this.speed>0 &&
        Number.isFinite(this.motionSince) && now>=this.motionSince && !this.safetyReason && !this.initializing && !this.closing && !this.faulted) {
      this.physicalLaneReference={lateral:spot.lateral,at:now,epoch:this.driveEpoch};
    }
    if (this.steeringLocked || this.safetyReason || this.initializing || this.closing || this.faulted) { this.lastPair=null; return; }
    const offsetBusy=offsetCommand(this.activeWrite??[]) || [...this.pending.values()].some(offsetCommand);
    const known=offsetIsKnown(m.offset), previous=this.lastPair;
    const comparable=previous && known && !offsetBusy && previous.pieceId===m.pieceId && previous.reverse===m.reverse && now>=previous.at && now-previous.at<=POSITION_MAX_AGE_MS;
    if (comparable) {
      const dTruth = spot.lateral - this.lastPair.lateral, dCar = m.offset - this.lastPair.offset;
      // A clear move the wrong way round means our assumed sign is wrong: with the
      // wrong sign every lane command drives the car away from its target.
      if (Math.abs(dTruth) > 14 && Math.abs(dCar) > 14) {
        this.signVotes += Math.sign(dTruth * dCar) === this.offsetSign ? 1 : -2;
        this.signVotes = Math.max(-2, Math.min(4, this.signVotes));
        if (this.signVotes < 0) { this.offsetSign = -this.offsetSign; this.signVotes = 0; this.lastCalibration = -1e9; this.forceLane = true; }
      }
    }
    this.lastPair = known && !offsetBusy ? {lateral:spot.lateral,offset:m.offset,pieceId:m.pieceId,reverse:m.reverse,at:now} : null;
    const expected = this.offsetSign * spot.lateral;
    if (Math.abs(m.offset - expected) > 9 && now - this.lastCalibration > 700) {
      const packet=encode.setOffset(expected);
      this.opticalCalibrationPackets.set(packet,this.opticalCalibrationReference);
      this.send('offset', packet);
      // Calibration changes the reported coordinate reference. This packet alone
      // requests no lane change; its effect on an existing target is unverified.
      // Queuing a correction is not a firmware measurement or confirmation.
      // Start a new comparison pair only from a later reported offset.
      this.lastPair = null;
    }
  }
  useTrack(track) { this.lastPair=null; this.physicalLaneReference=null; this.opticalCalibrationReference=null; this.localizer = track ? new Localizer(track, this.pieces) : null; }
  calibrateScanStart(lateral) {
    if (!Number.isFinite(lateral) || Math.abs(lateral)>LANE_LIMIT) throw new Error('Starting lane must be within 68 mm of track centre');
    if (this.steeringLocked || this.diagnosticMotion || this.speed || this.initializing || !this.connected || this.closing || this.faulted || this.safetyReason) throw new Error('Stop and recover the car before calibration');
    const offset=this.offsetSign*lateral;
    this.startingCalibration={source:'operator',lateral,offset,at:this.clock(),signVerified:false};
    this.lateral=lateral; this.lateralEstimate={source:'operator',at:this.clock(),signVerified:false};
    this.lastPair=null; this.forceLane=true;
    this.send('offset',encode.setOffset(offset));
  }
  diagnostics(now=this.clock()) {
    const age=at=>at===undefined?null:Math.max(0,Math.round(now-at));
    const pendingTimes=[...this.pending.values()].map(bytes=>this.queuedAt.get(bytes)).filter(Number.isFinite);
    const writeMode=this.simulated?'simulator':typeof this.transport.fast==='boolean'?(this.transport.fast?'without-response':'with-response'):'unknown';
    const transportHealth={writeMode,...this.transportHealth,pendingCount:this.pending.size,
      pendingAgeMs:pendingTimes.length?age(Math.min(...pendingTimes)):null,
      inFlightAgeMs:this.activeWriteAt!==null?age(this.activeWriteAt):null};
    return {transportHealth,bluetooth:this.transport.diagnostics?.()??null,name:this.name,profile:this.transport.initializationProfile??'simulator/legacy',firmware:this.version,
      startupNotifications:{buffered:this.transport.earlyDelivered??0,dropped:this.transport.earlyDropped??0,timestampBasis:'buffered packets timestamped on drain'},
      connected:this.connected,initialization:this.initializationStatus,sdkPlasticTrack:{...this.sdkPlasticTrack},safetyReason:this.safetyReason,steeringLocked:this.steeringLocked,maneuversLocked:this.maneuversLocked,forwardBaselineUntil:this.forwardBaselineUntil??null,
      localization:this.localizer?.diagnostics(now)??{state:'unknown',trusted:false,reason:'No map',reference:null},
      requestedSpeed:this.speed,reportedSpeed:this.reportedSpeed,reportedSpeedAgeMs:age(this.lastPosition),
      collisionAgeMs:age(this.telemetry.lastCollision?.at),
      batteryAgeMs:age(this.telemetry.batteryAt),statusAgeMs:age(this.telemetry.statusAt),status:{...this.status},
      millivolts:this.millivolts,notificationAgeMs:age(this.telemetry.lastNotificationAt),positionAgeMs:age(this.telemetry.lastPositionAt),
      lateralEstimate:this.lateralEstimate?{...this.lateralEstimate}:null,diagnosticMotion:!!this.diagnosticMotion,diagnosticSteering:!!this.diagnosticSteering,
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
    const graceCap=this.telemetrySpeedCeiling===undefined?Infinity:Math.min(this.speed,this.telemetrySpeedCeiling);
    const speed = this.initializing || this.safetyReason || this.closing || this.faulted ? 0 : Math.max(0, Math.min(MAX_SPEED, graceCap, Math.round(mmPerSec)));
    if (speed === 0) { this.#invalidateDriveCommands(); this.endScanDelocalization(); }
    if (speed > 0 && this.speed === 0) { this.motionSince = this.clock(); this.stopRequestedAt = null; }
    if (speed === 0 && this.speed > 0) this.stopRequestedAt = this.clock();
    this.speed = speed;
    if (speed === this.lastSpeedSent && accel === this.lastAccel) return;
    this.lastSpeedSent = speed; this.lastAccel = accel;
    this.telemetry.speedCommand={at:this.clock(),speed,accel};
    this.send('speed', encode.speed(speed, accel));
    if (speed===0) for (const fn of this.listeners) fn({type:'hostStopped'},this);
  }
  // Lateral target, mm, positive to the left of travel.
  steerTo(lateral, speed = 350) {
    if (this.steeringLocked || this.maneuversLocked || this.diagnosticMotion || this.initializing || this.safetyReason || this.closing || this.faulted) return;
    return this.#steerTo(lateral,speed);
  }
  // Only the bounded trial may authorize one steering request. Ordinary controls
  // still use steerTo(), which remains blocked throughout any diagnostic.
  steerDiagnosticOnce(lateral, speed = 350) {
    if (this.steeringLocked || this.maneuversLocked || !this.diagnosticMotion || !this.diagnosticSteering || this.diagnosticLaneSent || this.clock() >= this.diagnosticUntil || this.initializing || this.safetyReason || this.closing || this.faulted || !this.connected || !Number.isFinite(lateral) || Math.abs(lateral)>LANE_LIMIT) return false;
    this.forceLane = true;
    if (!this.#steerTo(lateral,speed)) return false;
    this.diagnosticLaneSent = true; return true;
  }
  // Native VehicleState::ChangeLane refuses invalid localization. Its state
  // flag is cleared on loss; it has no equivalent 2 s age test. Here the existing
  // optical freshness limit additionally protects our absolute SDK reference.
  #laneReferenceReady(reference=this.physicalLaneReference) {
    if (this.simulated || !['sdk','fast-furious'].includes(this.transport.initializationProfile)) return true;
    const now=this.clock();
    if (!reference || reference!==this.physicalLaneReference || reference.epoch!==this.driveEpoch ||
        this.speed<=0 || !Number.isFinite(this.motionSince) || reference.at<this.motionSince ||
        now<reference.at || now-reference.at>POSITION_MAX_AGE_MS) {
      this.telemetry.steeringBlocked={at:now,reason:'Waiting for a fresh ordinary printed-code lane reference during this drive'};
      return false;
    }
    this.telemetry.steeringBlocked=null; return true;
  }
  #steerTo(lateral, speed) {
    if (!this.#laneReferenceReady()) return false;
    const target = Math.max(-LANE_LIMIT, Math.min(LANE_LIMIT, lateral));
    if (Math.abs(target - this.targetLateral) < 2 && !this.forceLane) return false;
    this.forceLane = false; this.targetLateral = target;
    // F&F VehicleState::IncrementLaneChangeID (007bd20e): 7-bit sequence.
    // The upper bit is reserved for cancellation in car reports. An ACK is
    // evidence of command processing, never proof of physical lane completion.
    this.laneCommandId = (this.laneCommandId + 1) & 0x7f;
    const absolute = this.offsetSign * target;
    this.telemetry.laneRequest = {id:this.laneCommandId,at:this.clock(),target,
      offset:absolute,horizontalSpeed:speed,acceleration:1000};
    // Experimental SDK reference-before-lane sequence. The reference tool uses
    // a zero reference for relative movement; that does not prove our absolute
    // coordinate strategy. Hardware calls require a fresh printed-code estimate;
    // an operator estimate or initial zero cannot supply this reference.
    const reference=this.physicalLaneReference;
    const lane=encode.changeLane(absolute, speed, 1000, this.laneCommandId);
    if (reference) this.physicalLanePackets.set(lane,reference);
    if (this.transport.initializationProfile === 'sdk') {
      const offset = this.offsetSign * (reference?.lateral??this.lateral) || 0; // normalise -0
      const packet=encode.setOffset(offset);
      if (reference) this.physicalLanePackets.set(packet,reference);
      this.telemetry.laneReference = {offset,at:this.clock()};
      this.send('lane-offset', packet);
    }
    this.send('lane', lane); return true;
  }
  nudge(direction) {   // +1 left, -1 right
    const lanes = Math.round(this.targetLateral / LANE_STEP) + direction;
    this.steerTo(lanes * LANE_STEP);
  }
  uturn() { if (this.steeringLocked || this.maneuversLocked || this.diagnosticMotion || this.initializing || this.safetyReason || this.closing || this.faulted) return; this.targetLateral = -this.targetLateral; this.lastPair = null; this.send('turn', encode.turn(TURN.UTURN, 0)); }
  #isManeuver(bytes) { return [0x25,0x32].includes(bytes[1]) || this.maneuverPackets.has(bytes); }
  // A forward-only baseline retains the ordinary optical correction policy.
  // This is deliberately separate from lockSteering's acquisition lock, which
  // also suppresses calibration. No firmware command is added by either lock.
  lockManeuvers(reason) {
    this.maneuversLocked=true; this.maneuverLockVersion++;
    for (const [key,bytes] of this.pending) if (this.#isManeuver(bytes)) this.pending.delete(key);
    this.forceLane=true;
    this.telemetry.maneuverLock={active:true,at:this.clock(),reason};
  }
  unlockManeuvers() {
    this.maneuversLocked=false; this.forceLane=true;
    if (this.telemetry.maneuverLock?.active) Object.assign(this.telemetry.maneuverLock,{active:false,ended:this.clock()});
  }
  beginTelemetryGrace(until, ceiling) {
    if (!Number.isFinite(until) || until<=this.clock() || !Number.isFinite(ceiling) || ceiling<=0 || this.speed<=0) return false;
    this.telemetryGuardVersion++; this.pending.delete('speed');
    this.telemetryGraceUntil=until; this.telemetrySpeedCeiling=Math.min(300,ceiling,this.speed);
    this.lockManeuvers('Optical telemetry delayed: maneuvers disabled during bounded recovery');
    this.setSpeed(this.telemetrySpeedCeiling); return true;
  }
  endTelemetryGrace() {
    if (this.telemetryGraceUntil===undefined) return;
    this.telemetryGuardVersion++; this.pending.delete('speed');
    this.telemetryGraceUntil=undefined; this.telemetrySpeedCeiling=undefined; this.unlockManeuvers();
  }
  lockSteering(reason) {
    this.steeringLocked=true; this.steeringLockVersion++;
    for (const key of ['lane','lane-offset','offset','turn']) this.pending.delete(key);
    for (const [key,bytes] of this.pending) if ([0x25,0x2c,0x32,0x34].includes(bytes[1])) this.pending.delete(key);
    this.lastPair=null;this.forceLane=true;
    this.telemetry.steeringLock={at:this.clock(),reason};
  }
  // Releasing an acquisition lock cannot revive commands discarded while locked.
  unlockSteering() { this.steeringLocked=false; this.lastPair=null; this.forceLane=true; }
  #invalidateDriveCommands() {
    this.driveEpoch++; this.lastPair=null; this.physicalLaneReference=null; this.opticalCalibrationReference=null;
    for (const [key,bytes] of this.pending) if (driveCommand(bytes)) this.pending.delete(key);
  }
  stop() {
    // A pending lane request may be discarded below, or the car may be moved
    // during recovery. The next steering target must reach the vehicle.
    if (this.speed > 0) this.stopRequestedAt = this.clock();
    this.#invalidateDriveCommands(); this.forceLane = true;
    this.forwardBaselineUntil=undefined; this.unlockManeuvers();
    this.endTelemetryGrace();
    this.scanDelocalizationAllowance = false;
    this.pending.delete('scan-delocalization');
    for (const key of ['speed', 'lane', 'lane-offset', 'offset', 'turn']) this.pending.delete(key);
    // STOP is the next command after any already-running write.
    if(this.pending.has('stop'))this.transportHealth.coalesced++;
    this.pending.delete('stop');
    const stop=encode.speed(0,2500),restore=this.scanDelocalizationUsed?encode.maxDelocalizedSpeed(0):null;
    this.queuedAt.set(stop,this.clock());if(restore)this.queuedAt.set(restore,this.clock());
    this.pending = new Map([['stop',stop],...(restore?[['scan-delocalization',restore]]:[]),...this.pending]);
    this.speed = 0; this.lastSpeedSent = 0; this.lastAccel = 2500;
    this.telemetry.speedCommand={at:this.clock(),speed:0,accel:2500};
    this.diagnosticMotion = false; this.diagnosticSteering = false; this.diagnosticLaneSent = false;
    this.steeringLocked=false;
    for (const fn of this.listeners) fn({type:'hostStopped'},this);
    if (!this.connected || this.closing || this.faulted) { this.pending.clear(); return; }
    if (!this.pumping) this.pumpPromise = this.#pump();
  }
  safetyStop(reason) { this.safetyReason = reason; if(reason==='Off track')this.localizer?.invalidate('Off track; recover before acquiring a new reference'); this.stop(); }
  recover() {
    if (!this.connected || this.closing || this.faulted) return false;
    this.lastPair=null; this.physicalLaneReference=null; this.opticalCalibrationReference=null; this.safetyReason = null; this.lastSpeedSent = -1; return true;
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
    this.#invalidateDriveCommands();
    this.forwardBaselineUntil=undefined; this.unlockManeuvers();
    this.endTelemetryGrace();
    this.closing = true; this.scanDelocalizationAllowance = false; this.pending.clear(); this.speed = 0;
    this.diagnosticMotion = false; this.diagnosticSteering = false; this.diagnosticLaneSent = false;
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
