import {packet,replies,LEGACY_FIRMWARE,PULSE_MS} from './protocol.mjs';

// No simulator API feeds this controller. Every motion is one explicit short pulse.
export class DriveController {
  constructor(transport,{enabled=false,note=()=>true,changed=()=>{},setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
    this.transport=transport;this.enabled=enabled===true;this.note=note;this.changed=changed;
    this.setTimer=setTimer;this.clearTimer=clearTimer;this.state='DISCONNECTED';this.epoch=0;
    this.queue=Promise.resolve();this.waiters=new Map();
    transport.receive=bytes=>this.receive(bytes);
    transport.lost=()=>this.connectionLost();
    transport.progress=()=>this.stateTo(this.state);
  }
  connectionLost(){
    if(this.state==='WAITING_POWER_OFF' && this.powerTarget && !this.transport.connected){
      ++this.epoch;this.clearTimer(this.powerTimer);this.transport.close();
      this.identity=null;this.label=null;this.signalled=false;
      try{
        this.emit('Expected disconnect observed during operator power-button trial. Switch the same labeled car on, then explicitly reconnect its exact browser ID.');
        this.stateTo('POWER_OFF_SEEN');
      }catch(error){void this.stop(error.message,true);}
    }else void this.stop('Connection lost; switch the physical car off',true);
  }
  beginPowerCheck({safe=false}={}){
    if(this.state!=='SELECTED'||safe!==true)throw new Error('Select one candidate and confirm wheels-clear precautions first');
    this.signalled=false;this.identityMethod=null;this.powerTarget={...this.identity};
    this.emit('Operator started power-button identity trial for '+JSON.stringify(this.powerTarget)+'; no command sent. Press the button ONCE on the labeled physical car to switch it off.');
    this.stateTo('WAITING_POWER_OFF');
    this.powerTimer=this.setTimer(()=>void this.stop('No expected disconnect within 2 minutes; physical identity not established',true),120000);
  }
  emit(message){
    const kept=this.note(this.transport.mode,message);
    if(kept===false)throw new Error('Evidence capture full; motion blocked');
  }
  stateTo(value){this.state=value;try{this.changed(this);}catch{}}
  current(epoch){if(epoch!==this.epoch)throw new Error('Operation cancelled');}
  async deadline(promise,ms,message){
    let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{
      timer=this.setTimer(()=>reject(new Error(message)),ms);
    })]);}finally{this.clearTimer(timer);}
  }
  // Keep the actual wire promise in the queue even when its caller times out.
  // STOP can follow a late write, but no new nonzero command can overtake STOP.
  async write(bytes,epoch,{emergency=false}={}){
    const task=this.queue.catch(()=>{}).then(async()=>{
      this.current(epoch);
      if(!this.transport.connected)throw new Error('Radio unavailable');
      if(!emergency)this.emit('TX request '+[...bytes].map(x=>x.toString(16).padStart(2,'0')).join(' '));
      await this.transport.write(bytes);
      this.current(epoch);
      if(!emergency)this.emit('Write completed; physical result unverified');
    });
    this.queue=task;
    return this.deadline(task,600,'Write timed out; delivery unknown');
  }
  receive(bytes){
    try{
      this.emit('RX '+[...bytes].map(x=>x.toString(16).padStart(2,'0')).join(' '));
      for(const row of replies(bytes))this.waiters.get(row.id)?.resolve(row.value);
    }catch(error){void this.stop(error.message,true);}
  }
  async request(action,id,epoch){
    const response=new Promise((resolve,reject)=>this.waiters.set(id,{resolve,reject}));
    // Attach a rejection handler before a disconnect can reject a pending reply.
    const reply=this.deadline(response,1000,action+' reply timed out');
    reply.catch(()=>{});
    try{
      await this.write(packet(action),epoch);
      const value=await reply;this.current(epoch);return value;
    }finally{this.waiters.delete(id);}
  }
  async select(options={}){
    if(!this.enabled)throw new Error('Instructor opt-in is disabled');
    const target=this.state==='POWER_OFF_SEEN'?this.powerTarget:null;
    if(this.state!=='DISCONNECTED'&&!target)throw new Error('Disconnect before selecting another car');
    const epoch=++this.epoch;this.stopResult='';this.stopReason='';this.firmware=null;this.battery=null;this.stateTo('SELECTING');
    try{
      // Browser chooser must retain its user gesture. No timer cancels the picker.
      const identity=await this.transport.open({...options,expectedBrowserId:target?.browserId??null});this.current(epoch);
      if(target&&identity.browserId!==target.browserId)throw new Error('Selected device does not match the power-checked car');
      if(!identity.browserId)throw new Error('Selected device has no browser ID');
      this.identity=Object.freeze({...identity});this.label=null;this.signalled=false;
      this.identityMethod=target?'power-cycle':null;this.powerTarget=null;
      this.emit('Selected '+JSON.stringify(identity)+'; NOT physical identity proof');
      this.stateTo('SELECTED');
    }catch(error){
      if(epoch===this.epoch){
        const recover=target&&error.name==='SetupTimeoutError'&&this.transport.retryBrowserId===target.browserId;
        await this.stop(error.message,true);
        // stop/disconnect advances twice. A later user cancellation must never
        // resurrect this partial witness. Retry still requires exact-ID setup
        // and the operator's separate physical observation confirmation.
        if(recover&&this.epoch===epoch+2&&this.state==='DISCONNECTED'){
          this.powerTarget=target;this.stateTo('POWER_OFF_SEEN');
        }
      }else if(this.state==='DISCONNECTED')this.transport.close();
      throw error;
    }
  }
  async identify({safe=false}={}){
    if(this.state!=='SELECTED'||safe!==true)throw new Error('Confirm wheels clear and isolation first');
    const epoch=this.epoch;this.stateTo('IDENTIFYING');
    try{
      await this.deadline(this.transport.identify(),11000,'Light identification timed out');
      this.current(epoch);this.signalled=true;this.stateTo('SELECTED');
      this.emit('Light sequence writes completed. Operator must observe the exact physical car.');
    }catch(error){if(epoch===this.epoch)await this.stop(error.message,true);throw error;}
  }
  confirm({label,typedLabel,browserId,observed=false,safe=false}={}){
    if(this.state!=='SELECTED'||(!this.signalled&&this.identityMethod!=='power-cycle'))throw new Error('Complete the light trial or the power-button identity check first');
    if(typeof label!=='string'||!label.trim()||label.length>80||typedLabel!==label||browserId!==this.identity.browserId||observed!==true||safe!==true)
      throw new Error('Exact physical label, browser ID, observed physical identity check and safety confirmation required');
    this.label=label;this.emit('Operator physically confirmed '+JSON.stringify({label,...this.identity,method:this.identityMethod||'observed-light-signal'}));
    this.stateTo('CONFIRMED');
  }
  async arm(){
    if(this.state!=='CONFIRMED')throw new Error('Confirm this physical car first');
    const epoch=this.epoch;this.stopResult='';this.stateTo('ARMING');
    try{
      this.firmware=await this.request('version',0x19,epoch);
      if(!LEGACY_FIRMWARE.includes(this.firmware))throw new Error('Unreviewed firmware '+this.firmware+'; no motor/SDK drive command sent');
      this.battery=await this.request('battery',0x1b,epoch);
      if(this.battery<3500||this.battery>4500)throw new Error('Battery outside provisional 3500–4500 mV bench gate; inspect/charge before retry');
      await this.request('ping',0x17,epoch);
      this.drivePrepared=true;
      await this.write(packet('sdkOn'),epoch);
      await this.write(packet('speed',0),epoch);
      this.emit('Armed for one pulse; firmware '+this.firmware+', battery '+this.battery+' mV; physical stop NOT verified');
      this.stateTo('ARMED');
      this.armTimer=this.setTimer(()=>void this.stop('Arm expired'),5000);
    }catch(error){if(epoch===this.epoch)await this.stop(error.message,true);throw error;}
  }
  async pulse(speed){
    const bytes=packet('speed',speed); // reject unsafe inputs before any state change
    if(speed===0) return this.stop('Operator STOP');
    if(this.state!=='ARMED')throw new Error('Arm this confirmed car for one pulse first');
    this.clearTimer(this.armTimer);const epoch=this.epoch;this.stateTo('CHECKING');
    try{
      await this.request('ping',0x17,epoch);this.current(epoch);
      this.stateTo('MOVING');
      // Start the budget before dispatch, including time spent in the BLE write.
      this.motionTimer=this.setTimer(()=>void this.stop('750 ms pulse limit'),PULSE_MS);
      await this.write(bytes,epoch);
    }catch(error){if(epoch===this.epoch)await this.stop(error.message,true);throw error;}
  }
  stop(reason='Emergency STOP',disconnect=false){
    // Repeated stop callers share one operation; escalate to disconnect if needed.
    if(this.stopping){this.disconnectAfterStop ||= disconnect;return this.stopping;}
    const epoch=++this.epoch;this.stopReason=reason;
    this.clearTimer(this.armTimer);this.clearTimer(this.motionTimer);this.clearTimer(this.powerTimer);this.powerTarget=null;
    for(const waiter of this.waiters.values())waiter.reject(new Error(reason));
    this.waiters.clear();this.disconnectAfterStop=disconnect;
    this.stateTo('STOPPING');
    const operation=Promise.resolve().then(async()=>{
      let delivered=false;
      try{
        // Logging capacity must NEVER veto an emergency speed-zero write.
        try{this.note(this.transport.mode,'STOP requested: '+reason);}catch{}
        if(this.drivePrepared && this.transport.connected){
          try{this.note(this.transport.mode,'STOP TX request 06 24 00 00 e8 03 01');}catch{}
          await this.write(packet('speed',0),epoch,{emergency:true});delivered=true;
        }
      }catch(error){this.disconnectAfterStop=true;}
      finally{
        const status=delivered?'STOP write completed; physical stop unverified':this.drivePrepared?'STOP delivery unavailable/unverified; physically switch car off if moving':'Disarmed; this page sent no motor command in this session. Physical state unverified.';
        try{this.note(this.transport.mode,status);}catch{}
        this.stopResult=status;
        if(this.disconnectAfterStop||!this.transport.connected||!this.label){
          // Invalidate queued work before closing. A hung wire can never resume setup.
          ++this.epoch;try{this.transport.close();}catch{}this.identity=null;this.label=null;this.signalled=false;this.drivePrepared=false;this.identityMethod=null;
          this.stateTo('DISCONNECTED');
        }else this.stateTo('CONFIRMED');
      }
    });
    this.stopping=operation;
    return operation.finally(()=>{if(this.stopping===operation)this.stopping=null;});
  }
}
