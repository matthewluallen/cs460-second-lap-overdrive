import {DriveController} from './controller.mjs';
import {packet,MAX_SPEED} from './protocol.mjs';
import {TrackRecorder} from './track.mjs';

export const MAX_SCAN_MS=45000,HEARTBEAT_MS=500,FIRST_TRACK_MS=5000,TRACK_GAP_MS=2000;

// Optional instructor-only extension: the base one-pulse controller stays intact.
// Qualification is a physical observation, never inferred from a BLE write ACK.
export class ScanController extends DriveController {
  constructor(transport,options={}){
    super(transport,options);
    this.now=options.now??(()=>globalThis.performance.now());
    this.recorder=options.recorder??new TrackRecorder({now:this.now});
    this.pulseAttempt=null;this.pulseProof=null;this.qualification=null;this.scanAttempt=null;
  }
  sameSession(proof){
    return !!proof&&this.transport.connected&&proof.identity===this.identity&&
      proof.label===this.label&&proof.mode===this.transport.mode&&proof.firmware===this.firmware;
  }
  get pulseReadyForQualification(){
    return this.state==='CONFIRMED'&&this.sameSession(this.pulseProof)&&this.pulseProof.epoch===this.epoch;
  }
  get scanQualified(){return this.sameSession(this.qualification);}
  get qualifiedSpeed(){return this.scanQualified?this.qualification.speed:0;}
  trackSnapshot(){return this.recorder.snapshot();}
  revoke(){this.qualification=null;this.pulseProof=null;}
  async select(options={}){
    this.revoke();this.pulseAttempt=null;
    try{this.recorder.finish('new device selection');}catch{}
    return super.select(options);
  }
  connectionLost(){this.revoke();this.pulseAttempt=null;super.connectionLost();}
  async pulse(speed){
    packet('speed',speed); // invalid input must not create a qualification attempt
    if(speed===0)return this.stop('Operator STOP');
    if(this.state!=='ARMED')throw new Error('Arm this confirmed car for one pulse first');
    this.revoke();
    const attempt={identity:this.identity,label:this.label,mode:this.transport.mode,firmware:this.firmware,speed,epoch:this.epoch,sent:false};
    this.pulseAttempt=attempt;
    try{
      await super.pulse(speed);
      if(this.pulseAttempt===attempt&&this.sameSession(attempt)&&this.epoch===attempt.epoch)attempt.sent=true;
    }catch(error){if(this.pulseAttempt===attempt)this.pulseAttempt=null;throw error;}
  }
  qualify({movementObserved=false,stopObserved=false}={}){
    if(!this.pulseReadyForQualification||movementObserved!==true||stopObserved!==true)
      throw new Error('Complete a successful bounded pulse, then explicitly observe movement and physical STOP on this exact car');
    this.emit('Operator observed actual movement and actual STOP after the completed '+this.pulseProof.speed+' mm/s pulse on '+JSON.stringify(this.label));
    this.qualification={...this.pulseProof};this.stateTo(this.state);
  }
  async scan({containedTrack=false,speed=100,durationMs=MAX_SCAN_MS}={}){
    const bytes=packet('speed',speed);
    if(speed===0)throw new Error('Scan speed must be positive');
    if(!Number.isSafeInteger(durationMs)||durationMs<1||durationMs>MAX_SCAN_MS)throw new RangeError('Scan duration must be 1–45000 milliseconds');
    if(this.state!=='ARMED'||!this.scanQualified||containedTrack!==true)
      throw new Error('Physically qualify movement and STOP, arm, and confirm a contained clear track before scanning');
    if(speed>this.qualification.speed||speed>MAX_SPEED)throw new Error('Scan speed cannot exceed the physically qualified pulse speed');
    this.clearTimer(this.armTimer);
    const attempt={epoch:this.epoch,identity:this.identity,label:this.label,mode:this.transport.mode,speed,durationMs};
    this.scanAttempt=attempt;this.stateTo('SCAN_STARTING');
    try{
      await this.request('ping',0x17,attempt.epoch);this.current(attempt.epoch);
      if(this.scanAttempt!==attempt)throw new Error('Scan cancelled');
      this.recorder.start({mode:this.transport.mode,physicalLabel:this.label,browserId:this.identity.browserId,firmware:this.firmware});
      this.emit('Explicit bounded track scan: '+speed+' mm/s for at most '+durationMs+' ms; no automatic retry or speed increase');
      // Both deadlines begin before the only nonzero speed dispatch.
      this.motionTimer=this.setTimer(()=>{if(this.scanAttempt===attempt)void this.stop('Scan time limit');},durationMs);
      this.trackTimer=this.setTimer(()=>{if(this.scanAttempt===attempt)void this.stop('No track position code within 5 seconds');},FIRST_TRACK_MS);
      this.stateTo('SCANNING');
      attempt.startedAt=this.now();
      await this.write(bytes,attempt.epoch);this.current(attempt.epoch);
      if(this.scanAttempt===attempt)this.scheduleHeartbeat(attempt,this.heartbeatDelay(attempt.startedAt));
    }catch(error){
      if(this.scanAttempt===attempt&&attempt.epoch===this.epoch)await this.stop(error.message,true);
      throw error;
    }
  }
  scheduleHeartbeat(attempt,delay){
    if(this.scanAttempt!==attempt)return;
    this.heartbeatTimer=this.setTimer(()=>void this.heartbeat(attempt),delay);
  }
  heartbeatDelay(started){
    const elapsed=this.now()-started;
    return Number.isFinite(elapsed)?Math.min(HEARTBEAT_MS,Math.max(0,HEARTBEAT_MS-elapsed)):0;
  }
  async heartbeat(attempt){
    if(this.scanAttempt!==attempt||this.state!=='SCANNING')return;
    const started=this.now();
    try{
      // Base request gives the reply a 1000 ms deadline. Never overlap the
      // same-ID waiter; a slow successful reply starts the next ping immediately.
      await this.request('ping',0x17,attempt.epoch);this.current(attempt.epoch);
      this.scheduleHeartbeat(attempt,this.heartbeatDelay(started));
    }catch(error){if(this.scanAttempt===attempt)await this.stop('Scan heartbeat failed: '+error.message,true);}
  }
  receive(bytes){
    const attempt=this.scanAttempt;
    let result,recordingError=null;
    try{
      if(this.recorder?.status==='RECORDING'){
        const before=this.recorder.observations.length;
        result=this.recorder.ingest(bytes);
        if(attempt&&this.scanAttempt===attempt&&result.observations.slice(before).some(o=>o.type==='position')){
          this.clearTimer(this.trackTimer);
          this.trackTimer=this.setTimer(()=>{if(this.scanAttempt===attempt)void this.stop('Track position codes absent for 2 seconds');},TRACK_GAP_MS);
        }
      }
    }catch(error){recordingError=error;}
    super.receive(bytes);
    // Base receive can synchronously initiate STOP after a trace/framing error.
    if(attempt&&this.scanAttempt===attempt){
      if(recordingError)void this.stop('Track recorder failed: '+recordingError.message,true);
      else if(this.recorder.invalid)void this.stop('Track evidence invalid or ambiguous; scan stopped');
      else if(result?.status==='COMPLETE')void this.stop('Observed track loop complete');
      else if(result&&result.status!=='RECORDING')void this.stop('Track recording ended: '+result.reason);
    }
    this.stateTo(this.state);
  }
  stop(reason='Emergency STOP',disconnect=false){
    const pulse=this.pulseAttempt;
    if(reason!=='750 ms pulse limit'||disconnect)this.pulseAttempt=null;
    this.scanAttempt=null;this.revoke();
    this.clearTimer(this.heartbeatTimer);this.clearTimer(this.trackTimer);
    const operation=super.stop(reason,disconnect);
    // Invalidate queued work and enter STOPPING before recorder/export work.
    try{this.recorder?.finish(reason);}catch{}
    return operation.then(()=>{
      // The expected pulse-limit STOP must finish successfully; emergency,
      // cancellation, errors and late nonzero writes never qualify a scan.
      if(pulse&&this.pulseAttempt===pulse&&pulse.sent&&reason==='750 ms pulse limit'&&!disconnect&&
        this.epoch===pulse.epoch+1&&this.state==='CONFIRMED'&&this.sameSession(pulse)&&this.stopResult==='STOP write completed; physical stop unverified'){
        this.pulseProof={...pulse,epoch:this.epoch};
      }
      if(this.pulseAttempt===pulse)this.pulseAttempt=null;
      this.stateTo(this.state);
    });
  }
}
