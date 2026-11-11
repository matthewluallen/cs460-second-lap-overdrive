
// Uses the existing bench discovery, stale-session guards, ownership, notifications,
// and lights-only trial. The original bench codec still cannot encode motion.
export class BrowserTransport {
  constructor(note,{enabled=false,bluetooth=globalThis.navigator?.bluetooth,Link,locks=globalThis.navigator?.locks,setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
    this.mode='LIVE';this.enabled=enabled===true;this.bluetooth=bluetooth;this.locks=locks;this.generation=0;this.setTimer=setTimer;this.clearTimer=clearTimer;
    this.link=new Link((source,message)=>{
      if(source==='LIVE RX')this.receive?.(Uint8Array.from(message.split(' ').map(x=>parseInt(x,16))));
      return note(source,message);
    },()=>{if(!this.closing)this.lost?.();},{setTimer,clearTimer});
  }
  get connected(){return !!this.link.device?.gatt?.connected;}
  async open({showAllDevices=false,expectedBrowserId=null}={}){
    if(!this.enabled)throw new Error('Instructor flag required');
    if(this.poisoned)throw new Error('Previous browser setup stalled; reload before reconnecting');
    if(!this.bluetooth)throw new Error('Web Bluetooth unavailable');
    if(!this.locks)throw new Error('Exclusive browser lock unavailable; use supported desktop Chrome on localhost');
    const generation=++this.generation;
    const current=()=>{if(generation!==this.generation)throw new Error('Connection selection cancelled');};
    // Same-origin instructor tabs share this lease. Other bench/apps must be closed.
    let acquired,timer;
    const lease={};this.lease=lease;
    const ready=new Promise((resolve,reject)=>{acquired={resolve,reject};});
    const holding=this.locks.request('cs460-instructor-drive',{ifAvailable:true},async lock=>{
      if(generation!==this.generation){acquired.reject(new Error('Connection selection cancelled'));return;}
      if(!lock){acquired.reject(new Error('Another instructor-drive tab owns the car lease'));return;}
      await new Promise(resolve=>{lease.release=resolve;acquired.resolve();});
    });
    holding.catch(error=>acquired.reject(error));
    let expire;
    const timeout=new Promise((_,reject)=>{expire=reject;});
    const setupBluetooth={requestDevice:async request=>{
      current();
      const device=await this.bluetooth.requestDevice(request);current();
      // Keep chooser gesture and give only GATT setup a ten-second deadline.
      timer=this.setTimer(()=>{
        if(generation!==this.generation)return;
        this.poisoned=true;
        expire(new Error('GATT setup timed out; reload before reconnecting'));
      },10000);
      return device;
    }};
    try{
      await ready;current();
      await Promise.race([this.link.open(setupBluetooth,{showAllDevices,expectedBrowserId}),timeout]);current();
      return this.link.selection;
    }catch(error){
      if(generation===this.generation)this.close();
      lease.release?.();throw error;
    }finally{this.clearTimer(timer);}
  }
  identify(){return this.link.identifyCandidate();}
  async write(bytes){
    const tx=this.link.tx;if(!this.connected||!tx)throw new Error('Car disconnected');
    if(tx.properties.writeWithoutResponse)await tx.writeValueWithoutResponse(bytes);
    else await tx.writeValueWithResponse(bytes);
  }
  close(){this.closing=true;++this.generation;try{this.link.close();}finally{this.lease?.release?.();this.lease=null;this.closing=false;}}
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
