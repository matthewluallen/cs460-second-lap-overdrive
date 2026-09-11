import {uuids,frame,hex,decode} from './protocol.mjs';

// Instances in one page share the same browser device. Keep ownership outside
// the instance so a cancelled setup cannot disconnect a replacement session.
const deviceOwners=new Map(),anonymousOwners=new WeakMap();
function ownership(device) {
  return typeof device.id==='string' && device.id
    ? {store:deviceOwners,key:device.id}
    : {store:anonymousOwners,key:device};
}
function ownerOf(device) { const {store,key}=ownership(device);return store.get(key); }
function claimDevice(device) {
  const {store,key}=ownership(device);
  if(store.has(key))throw new Error('This browser device already has an active bench session');
  const claim={store,key};store.set(key,claim);return claim;
}
function releaseDevice(claim) {
  if(claim && claim.store.get(claim.key)===claim)claim.store.delete(claim.key);
}

// The server serves static files. Only the local browser owns a GATT connection.
export class CarLink {
  constructor(note,closed=()=>{}) { this.note=note;this.closed=closed; }
  async open(bluetooth,{showAllDevices=false,rememberedDevice=null,expectedBrowserId=null}={}) {
    if(this.opening || this.device) throw new Error('Already connecting or connected');
    if(expectedBrowserId!==null && (typeof expectedBrowserId!=='string' || !expectedBrowserId))throw new Error('A saved car check requires its nonempty browser device ID');
    if(!bluetooth)throw new Error('Web Bluetooth unavailable. Open the forwarded port in a separate desktop Chrome tab or use replay.');
    this.opening=true;
    const session={};this.session=session;
    this.selection=null;this.assignedLabel=null;this.connectStarted=false;this.sdkRequestedOn=false;
    let device,claim,connectStarted=false,stage='chooser';
    const recordSetup=(source,message)=>{
      if(this.note(source,message)===false)throw new Error('Trace capture refused connection setup; no further connection operation attempted');
    };
    const current=()=>{
      if(this.session!==session || !device.gatt.connected)throw new Error('Disconnected during setup');
    };
    try {
      const options=showAllDevices
        ? {acceptAllDevices:true,optionalServices:[uuids.service]}
        : {filters:[{services:[uuids.service]}]};
      if(rememberedDevice){
        recordSetup('LIVE remembered selection','operator selected an already authorized browser device; saved label is not a new physical identity check');
        device=rememberedDevice;
      }else{
        recordSetup('LIVE chooser',showAllDevices?'all-device fallback; operator must isolate and identify assigned car':'Anki service filter; select only the assigned car');
        device=await bluetooth.requestDevice(options);
      }
      if(this.session!==session)throw new Error('Selection cancelled before connection');
      // A model name is shared by many students' cars. Check a saved assignment
      // before claiming or touching GATT, including when the chooser is needed.
      if(expectedBrowserId!==null){
        stage='saved car check';
        if(device.id!==expectedBrowserId){
          recordSetup('LIVE identity check','selected browser device does not match the saved car; no GATT connection attempted');
          throw new Error('Selected device does not match your saved car. Cancel if the picker is ambiguous. If permissions changed, enroll your physically isolated car again.');
        }
      }
      stage='device ownership';claim=claimDevice(device);this.claim=claim;
      this.device=device;
      this.selection=Object.freeze({name:device.name||'',browserId:device.id||''});
      recordSetup('LIVE selection',JSON.stringify(this.selection)+' · browser name/ID only; not verified vehicle identity');
      this.gone=()=>this.close();
      device.addEventListener('gattserverdisconnected',this.gone);
      stage='GATT connection';recordSetup('LIVE GATT','connecting');
      connectStarted=this.connectStarted=true;
      const gatt=await device.gatt.connect();current();
      stage='Anki service';this.note('LIVE GATT','connected; finding Anki service');
      const service=await gatt.getPrimaryService(uuids.service);current();
      stage='notify characteristic';
      const rx=await service.getCharacteristic(uuids.notify);current();
      stage='write characteristic';
      const tx=await service.getCharacteristic(uuids.write);current();
      if(!(tx.properties.writeWithoutResponse || tx.properties.write)) throw new Error('Write characteristic unavailable');
      this.rx=rx;
      this.receive=e=>{
        if(this.session!==session)return;
        const d=e.target.value,bytes=new Uint8Array(d.buffer,d.byteOffset,d.byteLength);
        this.note('LIVE RX',hex(bytes));
        try { for(const row of decode(bytes))this.note('LIVE decoded',row.text,row); }
        catch(err){this.note('LIVE parse error',err.message);}
      };
      rx.addEventListener('characteristicvaluechanged',this.receive);
      stage='notification setup';this.note('LIVE GATT','service and characteristics found; starting notifications');
      await rx.startNotifications();current();
      this.tx=tx;this.note('LIVE GATT','notify ready; no command sent');
    } catch(err) {
      this.note('LIVE setup error',stage+': '+err.name+': '+err.message);
      if(this.session===session)this.close();
      // Release our late connection only when a newer instance has not adopted
      // this device. A cancelled chooser never acquired a connection to release.
      else if(connectStarted && device?.gatt?.connected && !ownerOf(device))device.gatt.disconnect();
      releaseDevice(claim);
      throw err;
    } finally { this.opening=false; }
  }
  confirmAssignedCar(label) {
    if(!this.tx || !this.device?.gatt.connected)throw new Error('Car is disconnected');
    if(typeof label!=='string' || !label.trim())throw new Error('Enter the assigned physical car label');
    this.assignedLabel=label.trim();
    this.note('LIVE operator','assigned car confirmed by operator: '+JSON.stringify(this.assignedLabel)+'; not an automatic identity check');
  }
  async send(name) {
    if(!this.tx || !this.device?.gatt.connected)throw new Error('Car is disconnected');
    frame(name); // Reject unknown operations before any SDK preparation.
    if(['lampOn','lampOff','engineGreen','engineOff','sdkOn','sdkOff'].includes(name) && !this.assignedLabel)throw new Error('Confirm the assigned car before changing its lights or SDK mode');
    if(this.pendingWrite)throw new Error('A command write is already in progress');
    const tx=this.tx,device=this.device,session=this.session,pending={};
    this.pendingWrite=pending;
    const write=async action=>{
      if(this.session!==session || !device.gatt.connected)throw new Error('Disconnected before write; no further command sent');
      const bytes=frame(action),sdk=action==='sdkOn'||action==='sdkOff';
      if(this.note('LIVE TX attempt',hex(bytes)+' · '+action+' (requested; completion and car response not yet known)')===false) {
        throw new Error('Trace capture refused the command; no write attempted');
      }
      if(sdk){
        this.sdkRequestedOn=false;
        if(this.note('LIVE SDK',(action==='sdkOn'?'Enable':'Leave')+' write pending; actual mode unverified')===false)throw new Error('Trace capture refused SDK preparation; no write attempted');
      }
      try{
      if(tx.properties.writeWithoutResponse) await tx.writeValueWithoutResponse(bytes);
      else await tx.writeValueWithResponse(bytes);
      if(this.session!==session || !device.gatt.connected)throw new Error('Disconnected during write; outcome unknown');
      this.note('LIVE TX',hex(bytes)+' · '+action+' (write completed; observe car or RX)');
      if(sdk){
        this.sdkRequestedOn=action==='sdkOn';
        this.note('LIVE SDK',(this.sdkRequestedOn?'Enable':'Leave')+' write completed; actual mode unverified');
      }
      }catch(error){
        if(sdk&&this.session===session){this.sdkRequestedOn=false;this.note('LIVE SDK','Write failed or completion unknown; actual mode unverified');}
        throw error;
      }
    };
    try {
      // Explicit engine-light actions prepare SDK mode, then keep it on for
      // the visual trial. The whole sequence owns the pending-write lock.
      if((name==='engineGreen'||name==='engineOff')&&!this.sdkRequestedOn)await write('sdkOn');
      await write(name);
    } finally { if(this.pendingWrite===pending)this.pendingWrite=null; }
  }
  close() {
    this.session=null;this.selection=null;this.assignedLabel=null;this.sdkRequestedOn=false;
    const d=this.device;if(!d)return;
    const ownsDevice=ownerOf(d)===this.claim;
    const started=this.connectStarted;this.connectStarted=false;
    releaseDevice(this.claim);this.claim=null;
    if(this.gone)d.removeEventListener('gattserverdisconnected',this.gone);
    if(this.rx && this.receive)this.rx.removeEventListener('characteristicvaluechanged',this.receive);
    this.tx=this.rx=this.receive=this.device=null;
    if(ownsDevice && started && d.gatt?.connected)d.gatt.disconnect();
    this.note('LIVE GATT','disconnected');this.closed();
  }
}
export class Replay {
  constructor(note){this.note=note;this.ready=false;}
  async open(){this.ready=true;this.sdkRequestedOn=false;this.note('REPLAY','fixture connected; no radio');}
  async send(name){
    if(!this.ready)throw new Error('Replay closed');
    if((name==='engineGreen'||name==='engineOff')&&!this.sdkRequestedOn)await this.send('sdkOn');
    const bytes=frame(name);this.note('REPLAY TX',hex(bytes)+' · '+name);
    if(name==='sdkOn'||name==='sdkOff'){this.sdkRequestedOn=name==='sdkOn';this.note('REPLAY SDK',(this.sdkRequestedOn?'Enable':'Leave')+' rehearsed; no physical car');}
    const replies={ping:[1,0x17],version:[3,0x19,0x34,0x12],battery:[3,0x1b,0x74,0x0e]};
    if(replies[name])for(const row of decode(Uint8Array.from(replies[name])))this.note('REPLAY RX',row.raw+' · '+row.text,row);
  }
  close(){this.ready=false;this.note('REPLAY','closed');}
}
