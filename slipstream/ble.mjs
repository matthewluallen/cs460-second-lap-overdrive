// Web Bluetooth transport. The page that calls this owns the radio; no server is involved.
import {UUIDS, MANUFACTURER_KEY, modelFromManufacturerData} from './protocol.mjs';

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;
const bounded = value => Number.isFinite(value) ? Math.max(0,Math.min(Number.MAX_SAFE_INTEGER,value)) : 0;

export class BleLink {
  constructor(device,{clock=()=>performance.now()}={}) {
    this.device=device;this.clock=clock;this.listeners=new Set();this.closed=new Set();this.model=null;
    this.early=[];this.earlyDropped=0;this.earlyDelivered=0;this.active=true;this.notificationsReady=false;
    this.state='new';this.openPromise=null;this.unexpectedClose=false;
    this.notificationsReceived=0;this.notificationsDelivered=0;this.invalidNotifications=0;
    this.lastCallbackAt=null;this.maxCallbackGapMs=0;
  }
  get name() { return (this.device.name || '').replace(/[^\x20-\x7e]/g, '').trim(); }
  get id() { return this.device.id; }
  onNotify(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  drainNotifications() {
    if (!this.active || !this.listeners.size) return;
    if (this.earlyDropped) throw new Error('Startup notification overflow; reconnect before driving');
    this.notificationsReady = true;
    for (const bytes of this.early.splice(0)) if(this.#deliver(bytes))this.earlyDelivered=bounded(this.earlyDelivered+1);
  }
  onClose(fn) {
    // Disconnect can arrive after open resolves but before Car subscribes.
    if(this.unexpectedClose){fn();return()=>{};}
    if(!this.active)return()=>{};
    this.closed.add(fn);return()=>this.closed.delete(fn);
  }
  diagnostics() {
    return {state:this.state,notificationsReceived:this.notificationsReceived,notificationsDelivered:this.notificationsDelivered,
      invalidNotifications:this.invalidNotifications,bufferedNotifications:this.early.length,droppedNotifications:this.earlyDropped,
      lastCallbackAgeMs:this.lastCallbackAt===null?null:bounded(this.clock()-this.lastCallbackAt),maxCallbackGapMs:this.maxCallbackGapMs};
  }
  #deliver(bytes) {
    if(!this.active || !this.listeners.size)return false;
    this.notificationsDelivered=bounded(this.notificationsDelivered+1);
    for(const fn of this.listeners){if(!this.active)break;fn(bytes);}
    return true;
  }
  #receive(event) {
    if(!this.active)return;
    this.notificationsReceived=bounded(this.notificationsReceived+1);
    // This measures browser callback receipt only, never sensor time or RF loss.
    // DOM event.timeStamp is deliberately not used for control or freshness.
    const now=this.clock();
    if(Number.isFinite(now)){
      if(this.lastCallbackAt!==null)this.maxCallbackGapMs=Math.max(this.maxCallbackGapMs,bounded(now-this.lastCallbackAt));
      this.lastCallbackAt=now;
    }
    let bytes;
    try {
      const value=event?.target?.value;
      // Preserve startup capture's fail-closed size limit as well as its count
      // limit; malformed live callbacks still never reach control consumers.
      if(ArrayBuffer.isView(value) && value.byteLength>512 && !this.notificationsReady)this.earlyDropped=bounded(this.earlyDropped+1);
      if(!ArrayBuffer.isView(value) || value.byteLength===0 || value.byteLength>512)throw new Error('Invalid notification value');
      bytes=new Uint8Array(value.buffer,value.byteOffset,value.byteLength).slice();
    } catch {this.invalidNotifications=bounded(this.invalidNotifications+1);return;}
    if(!this.notificationsReady){
      if(this.early.length<64)this.early.push(bytes);
      else this.earlyDropped=bounded(this.earlyDropped+1);
      return;
    }
    this.#deliver(bytes);
  }
  // Best effort: the model id is only in the advertisement, which stops on connect.
  async #sniffModel() {
    const device = this.device;
    if (typeof device.watchAdvertisements !== 'function') return;
    const stop = new AbortController();
    await new Promise(resolve=>{
      let timer,finished=false;
      const finish=()=>{
        if(finished)return;finished=true;clearTimeout(timer);
        device.removeEventListener('advertisementreceived',advertised);stop.abort();
        if(this.cancelSniff===finish)this.cancelSniff=null;
        resolve();
      };
      const advertised=event=>{
        if(!this.active)return;
        try {
          const model=modelFromManufacturerData(event.manufacturerData?.get(MANUFACTURER_KEY));
          if(model){this.model=model;finish();}
        } catch {} // Unsupported advertisement data must not crash connection setup.
      };
      this.cancelSniff=finish;timer=setTimeout(finish,1500);
      device.addEventListener('advertisementreceived',advertised);
      try {Promise.resolve(device.watchAdvertisements({signal:stop.signal})).catch(finish);} catch {finish();}
    });
  }
  open() {
    if(!this.active)return Promise.reject(new Error('Car connection closed; choose the car again'));
    if(!this.openPromise)this.openPromise=this.#open();
    return this.openPromise;
  }
  #assertActive(connected=false) {
    if(!this.active || (connected && this.device.gatt?.connected===false))throw new Error('Car disconnected during connection setup');
  }
  async #open() {
    this.state='opening';
    try {
      if(typeof this.device.gatt?.connect!=='function')throw new Error('Bluetooth GATT connection is unavailable');
      await this.#sniffModel();this.#assertActive();
      this.gone=()=>{
        if(!this.active)return;
        this.unexpectedClose=true;const callbacks=[...this.closed];this.#shutdown('closed');
        for(const fn of callbacks)fn();
      };
      this.device.addEventListener('gattserverdisconnected',this.gone);
      const gatt=await this.device.gatt.connect();this.#assertActive(true);
      const service=await gatt.getPrimaryService(UUIDS.service);this.#assertActive(true);
      this.rx=await service.getCharacteristic(UUIDS.notify);this.#assertActive(true);
      this.tx=await service.getCharacteristic(UUIDS.write);this.#assertActive(true);
      if(typeof this.rx?.startNotifications!=='function' || (this.rx.properties && !this.rx.properties.notify && !this.rx.properties.indicate))throw new Error('Car characteristic does not support notifications');
      this.fast=!!this.tx?.properties?.writeWithoutResponse && typeof this.tx.writeValueWithoutResponse==='function';
      if(!this.fast && !(this.tx?.properties?.write && typeof this.tx.writeValueWithResponse==='function'))throw new Error('Car characteristic does not support an available write method');
      this.changed=event=>this.#receive(event);
      this.rx.addEventListener('characteristicvaluechanged',this.changed);
      await this.rx.startNotifications();this.#assertActive(true);
      this.state='open';
    } catch(error) {
      if(this.active)this.#shutdown('failed');
      // A connect promise may resolve after close. Disconnect that late result.
      this.#disconnect();throw error;
    }
  }
  async write(bytes) {
    if (!this.active || this.state!=='open' || !this.device.gatt?.connected) throw new Error('Car disconnected or connection closed');
    if (this.fast) await this.tx.writeValueWithoutResponse(bytes); else await this.tx.writeValueWithResponse(bytes);
  }
  #shutdown(state) {
    this.active=false;this.state=state;this.early=[];this.notificationsReady=false;this.cancelSniff?.();
    this.device.removeEventListener('gattserverdisconnected',this.gone);
    this.rx?.removeEventListener?.('characteristicvaluechanged',this.changed);
    this.listeners.clear();this.closed.clear();
  }
  #disconnect() {try{this.device.gatt?.disconnect();}catch{}}
  close() {this.#shutdown('closed');this.#disconnect();}
}

export async function chooseCar(showAll = false) {
  if (!bluetoothAvailable()) throw new Error('Web Bluetooth is not available. Use desktop Chrome or Edge over HTTPS or localhost.');
  const options = showAll
    ? {acceptAllDevices: true, optionalServices: [UUIDS.service], optionalManufacturerData: [MANUFACTURER_KEY]}
    : {filters: [{services: [UUIDS.service]}], optionalManufacturerData: [MANUFACTURER_KEY]};
  return new BleLink(await navigator.bluetooth.requestDevice(options));
}
