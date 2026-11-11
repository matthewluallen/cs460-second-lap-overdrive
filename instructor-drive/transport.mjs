export class SetupTimeoutError extends Error {
  constructor(stage){
    super('GATT setup timed out after 30 seconds during '+stage+'. Wait for the browser operation to finish, then explicitly retry the same car.');
    this.name='SetupTimeoutError';this.stage=stage;
  }
}

// Uses the existing bench discovery, stale-session guards, ownership, notifications,
// and lights-only trial. The original bench codec still cannot encode motion.
export class BrowserTransport {
  constructor(note,{enabled=false,bluetooth=globalThis.navigator?.bluetooth,Link,locks=globalThis.navigator?.locks,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
    this.mode='LIVE';this.enabled=enabled===true;this.bluetooth=bluetooth;this.locks=locks;this.generation=0;this.setTimer=setTimer;this.clearTimer=clearTimer;
    this.note=note;this.stage='disconnected';this.retryBrowserId=null;this.poisoned=false;
    this.link=new Link((source,message)=>{
      if(source==='LIVE chooser'&&this.openAttempt?.rememberedDevice){
        return note('LIVE remembered selection','Explicit same-car reconnect using the previously selected browser device; no chooser and no new physical identity proof');
      }
      if(source==='LIVE GATT'){
        if(message==='connecting')this.updateStage('GATT connection');
        // CarLink does not report individual characteristic-discovery progress.
        else if(message==='connected; finding Anki service')this.updateStage('service/characteristic discovery');
        else if(message==='service and characteristics found; starting notifications')this.updateStage('notification setup');
        else if(message==='notify ready; no command sent')this.updateStage('ready');
      }
      if(source==='LIVE RX')this.receive?.(Uint8Array.from(message.split(' ').map(x=>parseInt(x,16))));
      return note(source,message);
    },()=>{if(!this.closing)this.lost?.();},{setTimer,clearTimer});
  }
  get connected(){return !!this.link.device?.gatt?.connected;}
  get setupPending(){return !!this.setupOperation&&!this.setupOperation.settled;}
  updateStage(stage){this.stage=stage;try{this.progress?.(this);}catch{}}
  async open({showAllDevices=false,expectedBrowserId=null,rescanSavedDevice=false}={}){
    if(!this.enabled)throw new Error('Instructor flag required');
    if(this.setupPending||this.openAttempt)throw new Error('Previous browser operation is still finishing; wait before manually retrying');
    if(this.connected)throw new Error('Disconnect before selecting another car');
    if(!this.bluetooth)throw new Error('Web Bluetooth unavailable');
    if(!this.locks)throw new Error('Exclusive browser lock unavailable; use supported desktop Chrome on localhost');
    if(this.retryBrowserId&&expectedBrowserId!==null&&expectedBrowserId!==this.retryBrowserId)
      throw new Error('Manual recovery is restricted to the same browser device ID');
    const requiredBrowserId=this.retryBrowserId||expectedBrowserId;
    // Reuse only an exact, already permitted device after another explicit open.
    // A generic fresh selection still uses the chooser; no reconnect is automatic.
    const rememberedDevice=rescanSavedDevice!==true&&requiredBrowserId&&this.rememberedDevice?.id===requiredBrowserId?this.rememberedDevice:null;
    const generation=++this.generation;
    const attempt={generation,rememberedDevice};this.openAttempt=attempt;
    const current=()=>{if(generation!==this.generation)throw new Error('Connection selection cancelled');};
    // Same-origin instructor tabs share this lease. Other bench/apps must be closed.
    let acquired,timer;
    const lease={};this.lease=lease;
    const ready=new Promise((resolve,reject)=>{acquired={resolve,reject};});
    const holding=Promise.resolve().then(()=>this.locks.request('cs460-instructor-drive',{ifAvailable:true},async lock=>{
      if(generation!==this.generation){acquired.reject(new Error('Connection selection cancelled'));return;}
      if(!lock){acquired.reject(new Error('Another instructor-drive tab owns the car lease'));return;}
      await new Promise(resolve=>{lease.release=resolve;acquired.resolve();});
    }));
    holding.catch(error=>acquired.reject(error));
    let expire,operation;
    const timeout=new Promise((_,reject)=>{expire=reject;});
    const setupBluetooth={requestDevice:async request=>{
      current();
      const device=rememberedDevice??await this.bluetooth.requestDevice(request);current();
      if(typeof device.id!=='string'||!device.id)throw new Error('Browser selection has no usable device ID; no GATT connection attempted');
      if(requiredBrowserId!==null&&device.id!==requiredBrowserId)
        throw new Error('Selected device does not match the expected browser device ID; no GATT connection attempted');
      this.rememberedDevice=device;
      operation.browserId=device.id;
      // The chooser has no deadline. Only discovery/notification setup gets 30s;
      // drive command deadlines are owned separately by DriveController.
      timer=this.setTimer(()=>{
        if(generation!==this.generation||operation.settled)return;
        operation.timedOut=true;this.poisoned=true;
        this.retryBrowserId=requiredBrowserId||operation.browserId;
        const error=new SetupTimeoutError(this.stage);
        this.updateStage('setup timed out; waiting for browser cleanup');
        expire(error);
      },30000);
      return device;
    }};
    try{
      await ready;current();this.updateStage(rememberedDevice?'reconnecting the previously selected exact car':'browser chooser');
      operation={generation,settled:false,timedOut:false,browserId:null};this.setupOperation=operation;
      // Keep the ORIGINAL promise. A race timeout is not completion of the
      // browser operation and must never permit overlapping GATT discovery.
      operation.promise=this.link.open(setupBluetooth,{showAllDevices,expectedBrowserId:requiredBrowserId});
      const settled=()=>{
        operation.settled=true;
        if(this.setupOperation!==operation)return;
        if(operation.timedOut){
          this.poisoned=false;
          try{this.note('LIVE setup recovery','Previous browser setup settled; no reconnect performed. Manual retry remains restricted to the same browser ID.');}catch{}
          this.updateStage('disconnected; same-car manual retry available');
        }else try{this.progress?.(this);}catch{}
      };
      operation.promise.then(settled,settled);
      await Promise.race([operation.promise,timeout]);current();
      this.retryBrowserId=null;this.poisoned=false;this.updateStage('ready');
      return this.link.selection;
    }catch(error){
      if(generation===this.generation)this.close();
      lease.release?.();throw error;
    }finally{this.clearTimer(timer);if(this.openAttempt===attempt)this.openAttempt=null;try{this.progress?.(this);}catch{}}
  }
  identify(){return this.link.identifyCandidate();}
  async write(bytes){
    const tx=this.link.tx;if(!this.connected||!tx)throw new Error('Car disconnected');
    if(tx.properties.writeWithoutResponse)await tx.writeValueWithoutResponse(bytes);
    else await tx.writeValueWithResponse(bytes);
  }
  close(){this.closing=true;++this.generation;try{this.link.close();}finally{
    this.lease?.release?.();this.lease=null;this.closing=false;
    this.updateStage(this.setupPending?'disconnected; waiting for browser operation to finish':'disconnected');
  }}
}

export class SimulationTransport {
  mode='SIMULATION';connected=false;
  async open(){this.connected=true;return {name:'Synthetic car — no radio',browserId:'SIMULATION-ONLY'};}
  async identify(){if(!this.connected)throw new Error('Simulation closed');}
  async write(bytes){
    if(!this.connected)throw new Error('Simulation closed');
    const fixture={0x16:[1,0x17],0x18:[3,0x19,0x27,0x25],0x1a:[3,0x1b,0x74,0x0e]}[bytes[1]];
    if(fixture)queueMicrotask(()=>this.receive?.(Uint8Array.from(fixture)));
  }
  close(){this.connected=false;}
}
