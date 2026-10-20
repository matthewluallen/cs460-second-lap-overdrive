import {uuids,frame,hex,decode} from './protocol.mjs';

// The server serves static files. Only the local browser owns a GATT connection.
export class CarLink {
  constructor(note,closed=()=>{}) { this.note=note;this.closed=closed; }
  async open(bluetooth,{showAllDevices=false}={}) {
    if(this.opening || this.device) throw new Error('Already connecting or connected');
    if(!bluetooth)throw new Error('Web Bluetooth unavailable. Open the forwarded port in a separate desktop Chrome tab or use replay.');
    this.opening=true;
    const session={};this.session=session;
    this.selection=null;this.assignedLabel=null;
    let device,stage='chooser';
    const current=()=>{
      if(this.session!==session || !device.gatt.connected)throw new Error('Disconnected during setup');
    };
    try {
      const options=showAllDevices
        ? {acceptAllDevices:true,optionalServices:[uuids.service]}
        : {filters:[{services:[uuids.service]}]};
      this.note('LIVE chooser',showAllDevices?'all-device fallback; operator must isolate and identify assigned car':'Anki service filter; select only the assigned car');
      device=await bluetooth.requestDevice(options);
      if(this.session!==session)throw new Error('Selection cancelled before connection');
      this.device=device;
      this.selection=Object.freeze({name:device.name||'',browserId:device.id||''});
      this.note('LIVE selection',JSON.stringify(this.selection)+' · browser name/ID only; not verified vehicle identity');
      this.gone=()=>this.close();
      device.addEventListener('gattserverdisconnected',this.gone);
      stage='GATT connection';this.note('LIVE GATT','connecting');
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
      // A connect promise can resolve after close(); release that late connection too.
      else if(device?.gatt?.connected)device.gatt.disconnect();
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
    const bytes=frame(name);
    if(['lampOn','lampOff','sdkOn','sdkOff'].includes(name) && !this.assignedLabel)throw new Error('Confirm the assigned car before changing its headlight or SDK mode');
    if(this.pendingWrite)throw new Error('A command write is already in progress');
    const tx=this.tx,device=this.device,session=this.session,pending={};
    this.pendingWrite=pending;
    try {
      this.note('LIVE TX attempt',hex(bytes)+' · '+name+' (requested; completion and car response not yet known)');
      if(tx.properties.writeWithoutResponse) await tx.writeValueWithoutResponse(bytes);
      else await tx.writeValueWithResponse(bytes);
      if(this.session!==session || !device.gatt.connected)throw new Error('Disconnected during write; outcome unknown');
      this.note('LIVE TX',hex(bytes)+' · '+name+' (write completed; observe car or RX)');
    } finally { if(this.pendingWrite===pending)this.pendingWrite=null; }
  }
  close() {
    this.session=null;this.selection=null;this.assignedLabel=null;
    const d=this.device;if(!d)return;
    d.removeEventListener('gattserverdisconnected',this.gone);
    if(this.rx && this.receive)this.rx.removeEventListener('characteristicvaluechanged',this.receive);
    this.tx=this.rx=this.receive=this.device=null;
    if(d.gatt?.connected)d.gatt.disconnect();
    this.note('LIVE GATT','disconnected');this.closed();
  }
}
export class Replay {
  constructor(note){this.note=note;this.ready=false;}
  async open(){this.ready=true;this.note('REPLAY','fixture connected; no radio');}
  async send(name){
    if(!this.ready)throw new Error('Replay closed');
    const bytes=frame(name);this.note('REPLAY TX',hex(bytes)+' · '+name);
    const replies={ping:[1,0x17],version:[3,0x19,0x34,0x12],battery:[3,0x1b,0x74,0x0e]};
    if(replies[name])for(const row of decode(Uint8Array.from(replies[name])))this.note('REPLAY RX',row.raw+' · '+row.text,row);
  }
  close(){this.ready=false;this.note('REPLAY','closed');}
}
