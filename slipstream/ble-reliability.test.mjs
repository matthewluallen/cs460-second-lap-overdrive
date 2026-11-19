import test from 'node:test';
import assert from 'node:assert/strict';
import {BleLink} from './ble.mjs';
import {UUIDS,MANUFACTURER_KEY} from './protocol.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const settle=async()=>{for(let n=0;n<25;n++)await Promise.resolve();};
function target(){const listeners=new Map();return{
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
  removeEventListener(type,fn){listeners.get(type)?.delete(fn);},
  emit(type,event={}){for(const fn of [...(listeners.get(type)??[])])fn(event);},
  count(type){return listeners.get(type)?.size??0;}
};}
function rig({hold,clock}={}){
  const gate=deferred(),entered=deferred(),calls={connect:0,service:0,characteristics:0,notifications:0,disconnect:0,writes:0};
  const wait=async name=>{if(hold===name){entered.resolve();await gate.promise;}};
  const rx={...target(),properties:{notify:true},async startNotifications(){calls.notifications++;await wait('notifications');return this;}};
  const tx={properties:{writeWithoutResponse:true,write:true},async writeValueWithoutResponse(){calls.writes++;},async writeValueWithResponse(){calls.writes++;}};
  const service={async getCharacteristic(id){calls.characteristics++;await wait(id===UUIDS.notify?'rx':'tx');return id===UUIDS.notify?rx:tx;}};
  const device={...target(),id:'fake-only',name:'Z. Drive',gatt:{connected:false,
    async connect(){calls.connect++;await wait('connect');this.connected=true;return this;},
    async getPrimaryService(){calls.service++;await wait('service');return service;},
    disconnect(){calls.disconnect++;this.connected=false;device.emit('gattserverdisconnected');}
  }};
  const link=new BleLink(device,clock?{clock}:undefined);
  const emit=value=>rx.emit('characteristicvaluechanged',{target:{value}});
  const bytes=b=>new DataView(Uint8Array.from(b).buffer);
  return{link,device,rx,tx,calls,gate,entered,emit,bytes};
}

test('closing during connection cannot finish setup or leave a late GATT connection alive',async()=>{
  const r=rig({hold:'connect'}),opening=r.link.open();await r.entered.promise;
  r.link.close();r.gate.resolve();await assert.rejects(opening,/closed|disconnect/i);
  assert.equal(r.calls.service,0);assert.equal(r.device.gatt.connected,false);
  assert.equal(r.device.count('gattserverdisconnected'),0);
});

test('disconnect during discovery cancels later setup and reports closure once',async()=>{
  const r=rig({hold:'service'});let closed=0;r.link.onClose(()=>closed++);
  const opening=r.link.open();await r.entered.promise;
  r.device.gatt.connected=false;r.device.emit('gattserverdisconnected');r.device.emit('gattserverdisconnected');
  r.gate.resolve();await assert.rejects(opening,/closed|disconnect/i);
  assert.equal(closed,1);assert.equal(r.calls.characteristics,0);assert.equal(r.calls.notifications,0);
});

test('close while notifications start removes the callback and cannot resolve as open',async()=>{
  const r=rig({hold:'notifications'}),opening=r.link.open();await r.entered.promise;
  assert.equal(r.rx.count('characteristicvaluechanged'),1);
  r.link.close();r.gate.resolve();await assert.rejects(opening,/closed|disconnect/i);
  assert.equal(r.rx.count('characteristicvaluechanged'),0);
});

test('failed notification setup cleans up both device and characteristic listeners',async()=>{
  const r=rig();r.rx.startNotifications=async()=>{throw new Error('Notifications denied');};
  await assert.rejects(r.link.open(),/Notifications denied/);
  assert.equal(r.rx.count('characteristicvaluechanged'),0);
  assert.equal(r.device.count('gattserverdisconnected'),0);assert.equal(r.device.gatt.connected,false);
});

test('repeated open calls share one setup and a closed link cannot be reopened or written',async()=>{
  const r=rig();await Promise.all([r.link.open(),r.link.open()]);await r.link.open();
  assert.equal(r.calls.connect,1);assert.equal(r.calls.notifications,1);
  let delivered=0;r.link.onNotify(()=>delivered++);r.link.drainNotifications();r.emit(r.bytes([1,0x17]));
  assert.equal(delivered,1);r.link.close();
  r.device.gatt.connected=true; // A separate owner cannot reactivate this object.
  await assert.rejects(r.link.write(Uint8Array.of(1,0x16)),/closed|disconnect/i);
  await assert.rejects(r.link.open(),/closed|disconnect/i);assert.equal(r.calls.writes,0);
});

test('unsupported GATT capabilities fail before initialization, with an available response-write fallback',async()=>{
  for(const invalid of ['notify','write']){
    const r=rig();if(invalid==='notify')r.rx.properties={notify:false,indicate:false};else r.tx.properties={write:false,writeWithoutResponse:false};
    await assert.rejects(r.link.open(),/notification|writ/i);assert.equal(r.device.gatt.connected,false);
  }
  const r=rig();delete r.tx.writeValueWithoutResponse;await r.link.open();
  await r.link.write(Uint8Array.of(1,0x16));assert.equal(r.calls.writes,1);assert.equal(r.link.fast,false);r.link.close();
});

test('invalid notification values cannot crash delivery or become telemetry',async()=>{
  const r=rig();await r.link.open();const seen=[];r.link.onNotify(bytes=>seen.push([...bytes]));r.link.drainNotifications();
  for(const value of [null,undefined,'bad',new DataView(new ArrayBuffer(0)),new DataView(new ArrayBuffer(513))])assert.doesNotThrow(()=>r.emit(value));
  const buffer=Uint8Array.of(99,1,0x17,99),view=new DataView(buffer.buffer,1,2);r.emit(view);buffer[1]=0;
  assert.deepEqual(seen,[[1,0x17]]);r.link.close();
});

test('oversized startup notifications retain the existing fail-closed overflow behavior',async()=>{
  const r=rig();await r.link.open();r.link.onNotify(()=>{});
  r.emit(new DataView(new ArrayBuffer(513)));
  assert.throws(()=>r.link.drainNotifications(),/overflow/);
  assert.equal(r.link.diagnostics().droppedNotifications,1);assert.equal(r.link.diagnostics().invalidNotifications,1);r.link.close();
});

test('advertisement listeners are removed after a model match and after watch rejection',async()=>{
  for(const reject of [false,true]){
    const r=rig();r.device.watchAdvertisements=async()=>{
      if(reject)throw new Error('Unsupported');
      r.device.emit('advertisementreceived',{manufacturerData:new Map([[MANUFACTURER_KEY,new DataView(Uint8Array.of(0,19).buffer)]])});
    };
    await r.link.open();assert.equal(r.device.count('advertisementreceived'),0);
    assert.equal(r.link.model,reject?null:19);r.link.close();
  }
});

test('closing while advertisement watching is pending cancels setup immediately',async()=>{
  const r=rig(),watching=deferred();r.device.watchAdvertisements=async()=>{watching.resolve();await new Promise(()=>{});};
  const opening=r.link.open();await watching.promise;r.link.close();await settle();
  assert.equal(r.device.count('advertisementreceived'),0);await assert.rejects(opening,/closed|disconnect/i);
  assert.equal(r.calls.connect,0);
});

test('a disconnect in the open-to-subscribe gap is visible to the late close subscriber',async()=>{
  const r=rig();await r.link.open();r.device.gatt.connected=false;r.device.emit('gattserverdisconnected');
  let closed=0;const unsubscribe=r.link.onClose(()=>closed++);
  assert.equal(closed,1);assert.equal(typeof unsubscribe,'function');unsubscribe();r.link.close();assert.equal(closed,1);
});

test('diagnostics measure browser callback receipt gaps only and do not count invalid data as delivered',async()=>{
  let now=10;const r=rig({clock:()=>now});await r.link.open();const seen=[];r.link.onNotify(bytes=>seen.push([...bytes]));
  r.emit(r.bytes([1,0x17]));now=40;r.emit(null);now=60;r.link.drainNotifications();
  assert.deepEqual(r.link.diagnostics(),{state:'open',notificationsReceived:2,notificationsDelivered:1,invalidNotifications:1,bufferedNotifications:0,droppedNotifications:0,lastCallbackAgeMs:20,maxCallbackGapMs:30});
  now=70;r.emit(r.bytes([1,0x17]));assert.equal(r.link.diagnostics().notificationsDelivered,2);
  r.link.close();r.emit(r.bytes([1,0x17]));assert.equal(r.link.diagnostics().notificationsReceived,3);
  assert.equal(r.link.diagnostics().state,'closed');
});
