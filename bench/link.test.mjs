import test from 'node:test';import assert from 'node:assert/strict';
import {CarLink,Replay} from './link.mjs';import {uuids} from './protocol.mjs';
test('fixture mode completes a battery request without access to Bluetooth',async()=>{
  const log=[];const link=new Replay((a,b)=>log.push([a,b]));await link.open();await link.send('battery');link.close();
  assert.ok(log.some(([a,b])=>a==='REPLAY RX'&&b.includes('3700 mV')));await assert.rejects(link.send('ping'));
});
test('mock GATT subscribes before a request, handles RX, and rejects writes after link loss',async()=>{
  const log=[],writes=[],device=new EventTarget(),rx=new EventTarget();
  rx.startNotifications=async()=>{log.push('notify');return rx;};
  const tx={properties:{writeWithoutResponse:true},writeValueWithoutResponse:async b=>writes.push([...b])};
  const service={getCharacteristic:async u=>{if(u===uuids.notify)return rx;if(u===uuids.write)return tx;throw Error('unexpected characteristic')}};
  device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return device.gatt;},disconnect:()=>{device.gatt.connected=false;},getPrimaryService:async u=>{assert.equal(u,uuids.service);return service;}};
  const api={requestDevice:async opts=>{assert.deepEqual(opts.optionalServices,[uuids.service]);return device;}};
  const link=new CarLink((a,b)=>log.push(a+' '+b));await link.open(api);assert.equal(writes.length,0);await link.send('version');
  assert.deepEqual(writes,[[1,24]]);rx.value=new DataView(Uint8Array.from([3,25,52,18]).buffer);rx.dispatchEvent(new Event('characteristicvaluechanged'));
  assert.ok(log.includes('LIVE decoded firmware version 4660'));device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));
  await assert.rejects(link.send('ping'));assert.ok(!link.tx);
});
