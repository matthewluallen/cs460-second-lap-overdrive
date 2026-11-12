// Web Bluetooth transport. The page that calls this owns the radio; no server is involved.
import {UUIDS, MANUFACTURER_KEY, modelFromManufacturerData} from './protocol.mjs';

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

export class BleLink {
  constructor(device) { this.device = device; this.listeners = new Set(); this.closed = new Set(); this.model = null; }
  get name() { return (this.device.name || '').replace(/[^\x20-\x7e]/g, '').trim(); }
  get id() { return this.device.id; }
  onNotify(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onClose(fn) { this.closed.add(fn); }
  // Best effort: the model id is only in the advertisement, which stops on connect.
  async #sniffModel() {
    const device = this.device;
    if (typeof device.watchAdvertisements !== 'function') return;
    const stop = new AbortController();
    try {
      await new Promise(async resolve => {
        const timer = setTimeout(resolve, 1500);
        device.addEventListener('advertisementreceived', event => {
          const model = modelFromManufacturerData(event.manufacturerData?.get(MANUFACTURER_KEY));
          if (model) { this.model = model; clearTimeout(timer); resolve(); }
        });
        try { await device.watchAdvertisements({signal: stop.signal}); } catch { clearTimeout(timer); resolve(); }
      });
    } finally { stop.abort(); }
  }
  async open() {
    await this.#sniffModel();
    this.gone = () => { for (const fn of this.closed) fn(); };
    this.device.addEventListener('gattserverdisconnected', this.gone);
    const gatt = await this.device.gatt.connect();
    const service = await gatt.getPrimaryService(UUIDS.service);
    this.rx = await service.getCharacteristic(UUIDS.notify);
    this.tx = await service.getCharacteristic(UUIDS.write);
    this.rx.addEventListener('characteristicvaluechanged', event => {
      const v = event.target.value, bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice();
      for (const fn of this.listeners) fn(bytes);
    });
    await this.rx.startNotifications();
    this.fast = !!this.tx.properties.writeWithoutResponse;
  }
  async write(bytes) {
    if (!this.device.gatt?.connected) throw new Error('Car disconnected');
    if (this.fast) await this.tx.writeValueWithoutResponse(bytes); else await this.tx.writeValueWithResponse(bytes);
  }
  close() { try { this.device.removeEventListener('gattserverdisconnected', this.gone); this.device.gatt?.disconnect(); } catch {} }
}

export async function chooseCar(showAll = false) {
  if (!bluetoothAvailable()) throw new Error('Web Bluetooth is not available. Use desktop Chrome or Edge over HTTPS or localhost.');
  const options = showAll
    ? {acceptAllDevices: true, optionalServices: [UUIDS.service], optionalManufacturerData: [MANUFACTURER_KEY]}
    : {filters: [{services: [UUIDS.service]}], optionalManufacturerData: [MANUFACTURER_KEY]};
  return new BleLink(await navigator.bluetooth.requestDevice(options));
}
