import {uuids,frame,hex,decode} from './protocol.mjs';

// The server serves static files. Only the local browser owns a GATT connection.
export class CarLink {
  constructor(note,closed=()=>{}) { this.note=note;this.closed=closed; }
  async open(bluetooth) {
    if(this.device) throw new Error('Already connecting or connected');
    if(!bluetooth)throw new Error('Web Bluetooth unavailable. Open the forwarded port in a separate desktop Chrome tab or use replay.');
    const device=await bluetooth.requestDevice({acceptAllDevices:true,optionalServices:[uuids.service]});
    this.device=device;
    this.gone=()=>this.close();
    device.addEventListener('gattserverdisconnected',this.gone);
    try {
      const gatt=await device.gatt.connect();
      const service=await gatt.getPrimaryService(uuids.service);
      const rx=await service.getCharacteristic(uuids.notify);
      const tx=await service.getCharacteristic(uuids.write);
      if(!(tx.properties.writeWithoutResponse || tx.properties.write)) throw new Error('Write characteristic unavailable');
      this.rx=rx;
      this.receive=e=>{
        const d=e.target.value,bytes=new Uint8Array(d.buffer,d.byteOffset,d.byteLength);
        this.note('LIVE RX',hex(bytes));
        try { for(const row of decode(bytes))this.note('LIVE decoded',row.text,row); }
        catch(err){this.note('LIVE parse error',err.message);}
      };
      rx.addEventListener('characteristicvaluechanged',this.receive);
      await rx.startNotifications();
      if(this.device!==device || !device.gatt.connected)throw new Error('Disconnected during setup');
      this.tx=tx;this.note('LIVE GATT','notify ready; no command sent');
    } catch(err) { this.close();throw err; }
  }
  async send(name) {
    if(!this.tx || !this.device?.gatt.connected)throw new Error('Car is disconnected');
    const bytes=frame(name);
    if(this.tx.properties.writeWithoutResponse) await this.tx.writeValueWithoutResponse(bytes);
    else await this.tx.writeValueWithResponse(bytes);
    this.note('LIVE TX',hex(bytes)+' · '+name+' (write completed; observe car or RX)');
  }
  close() {
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
