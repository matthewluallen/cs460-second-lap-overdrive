import test from 'node:test';
import assert from 'node:assert/strict';
import {BleLink} from './ble.mjs';
import {Car} from './car.mjs';
import {Recorder} from './trace.mjs';
import {UUIDS} from './protocol.mjs';
function rig(count=1){
 let changed;const rx={addEventListener(_,fn){changed=fn;},async startNotifications(){for(let i=0;i<count;i++)this.emit([5,0x3f,0,1,0,0]);},emit(b){changed({target:{value:new DataView(Uint8Array.from(b).buffer)}});}};
 const tx={properties:{writeWithoutResponse:true},async writeValueWithoutResponse(b){if(b[1]===0x16)rx.emit([1,0x17]);if(b[1]===0x18)rx.emit([3,0x19,0x5a,0x2e]);}};
 const device={addEventListener(){},removeEventListener(){},gatt:{connected:true,async connect(){return {getPrimaryService:async()=>({getCharacteristic:async id=>id===UUIDS.notify?rx:tx})};},disconnect(){this.connected=false;}}};
 return {link:new BleLink(device),rx};
}
test('early BLE notifications are retained until recorder-ready drain, exactly once',async()=>{
 const {link,rx}=rig();await link.open();const received=[];link.onNotify(b=>received.push([...b]));
 assert.equal(received.length,0);link.drainNotifications();link.drainNotifications();rx.emit([1,0x17]);
 assert.deepEqual(received,[[5,0x3f,0,1,0,0],[1,0x17]]);
});
test('startup overflow fails closed instead of silently accepting incomplete capture',async()=>{
 const {link}=rig(65);await link.open();link.onNotify(()=>{});assert.equal(link.early.length,64);assert.throws(()=>link.drainNotifications(),/overflow/);
});
test('closed link discards buffered and later notifications',async()=>{
 const {link,rx}=rig();await link.open();link.close();let n=0;link.onNotify(()=>n++);link.drainNotifications();rx.emit([1,0x17]);assert.equal(n,0);assert.equal(link.early.length,0);
});

test('Car startup drains into attached recorder and overflow closes connection',async()=>{
 for(const count of [1,65]){
  const {link}=rig(count);await link.open();link.initializationProfile='sdk';const car=new Car(link);
  const recorder=new Recorder(()=>0);recorder.start([{car}]);await car.start();await car.pumpPromise;
  if(count===1){assert.equal(car.connected,true);assert.ok(recorder.events.some(e=>e[2]==='rx'&&e[3]==='05 3f 00 01 00 00'));assert.equal(car.diagnostics().startupNotifications.buffered,1);}
  else {assert.equal(car.connected,false);assert.match(car.initializationStatus,/overflow/);}
 }
});
