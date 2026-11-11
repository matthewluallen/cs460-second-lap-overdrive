import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserTransport} from './transport.mjs';
import {CarLink} from '../bench/link.mjs';
import {uuids} from '../bench/protocol.mjs';
import {DriveController} from './controller.mjs';

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function timers(){
  let next=0;const pending=new Map();
  return {pending,setTimer:(fn,ms)=>{const id=++next;pending.set(id,{fn,ms});return id;},
    clearTimer:id=>pending.delete(id),fire(ms){
      const entry=[...pending].find(([,timer])=>timer.ms===ms);
      assert.ok(entry,'Expected timer '+ms);pending.delete(entry[0]);entry[1].fn();
    }};
}
function locks({pending}={}){
  const calls=[];let held=false;
  return {calls,get held(){return held;},request(name,options,callback){
    calls.push({name,options});
    return Promise.resolve().then(async()=>{
      if(pending)await pending.promise;
      if(held)return callback(null);
      held=true;
      try{return await callback({name});}finally{held=false;}
    });
  }};
}
let serial=0;
function radio({withResponse=false}={}){
  const writes=[],choices=[],stages=[],device=new EventTarget(),rx=new EventTarget();
  device.id='transport-car-'+(++serial);device.name='Course car';
  let connects=0,disconnects=0;
  rx.startNotifications=async()=>{stages.push('notifications ready');return rx;};
  const tx={properties:withResponse?{write:true}:{writeWithoutResponse:true}};
  tx[withResponse?'writeValueWithResponse':'writeValueWithoutResponse']=async bytes=>{writes.push([...bytes]);};
  const service={getCharacteristic:async uuid=>{
    stages.push(uuid);if(uuid===uuids.notify)return rx;if(uuid===uuids.write)return tx;
    throw new Error('Unknown characteristic');
  }};
  device.gatt={connected:false,
    connect:async()=>{connects++;device.gatt.connected=true;return device.gatt;},
    getPrimaryService:async uuid=>{assert.equal(uuid,uuids.service);stages.push(uuid);return service;},
    disconnect:()=>{disconnects++;device.gatt.connected=false;}
  };
  const bluetooth={requestDevice:async options=>{choices.push(options);return device;}};
  const notify=bytes=>{rx.value=new DataView(Uint8Array.from(bytes).buffer);rx.dispatchEvent(new Event('characteristicvaluechanged'));};
  return {writes,choices,stages,device,rx,tx,bluetooth,notify,
    get connects(){return connects;},get disconnects(){return disconnects;}};
}
function make(r,{gate=locks(),note=()=>true,...options}={}){
  const transport=new BrowserTransport(note,{enabled:true,Link:CarLink,bluetooth:r.bluetooth,locks:gate,...options});
  return {transport,gate};
}

test('MOCK transport requires instructor flag and exclusive-lock support before requesting a car',async()=>{
  const r=radio();
  for(const enabled of [false,'true',1]){
    const {transport}=make(r,{enabled});await assert.rejects(transport.open(),/Instructor flag/);
  }
  await assert.rejects(make(r,{locks:null}).transport.open(),/Exclusive browser lock/);
  await assert.rejects(make(r,{bluetooth:null}).transport.open(),/Web Bluetooth/);
  assert.equal(r.choices.length,0);assert.equal(r.connects,0);assert.equal(r.writes.length,0);
});

test('MOCK real CarLink transport selects exactly one car, subscribes first and sends no setup commands',async t=>{
  const r=radio(),{transport,gate}=make(r),received=[];
  t.after(()=>transport.close());transport.receive=bytes=>received.push([...bytes]);
  const identity=await transport.open();
  assert.deepEqual(identity,{name:'Course car',browserId:r.device.id});
  assert.deepEqual(r.choices,[{filters:[{services:[uuids.service]}]}]);
  assert.deepEqual(gate.calls,[{name:'cs460-instructor-drive',options:{ifAvailable:true}}]);
  assert.equal(r.stages.at(-1),'notifications ready');assert.equal(transport.connected,true);
  assert.equal(r.writes.length,0);
  await transport.write(Uint8Array.of(1,0x1a));
  assert.deepEqual(r.writes,[[1,0x1a]]);
  r.notify([3,0x1b,0x74,0x0e]);assert.deepEqual(received,[[3,0x1b,0x74,0x0e]]);
  transport.close();await flush();assert.equal(transport.connected,false);assert.equal(gate.held,false);
  await assert.rejects(transport.write(Uint8Array.of(1,0x1a)),/disconnected/);
});

test('MOCK explicit all-device fallback remains a single chooser and supports with-response writes',async t=>{
  const r=radio({withResponse:true}),{transport}=make(r);t.after(()=>transport.close());
  await transport.open({showAllDevices:true});
  assert.deepEqual(r.choices,[{acceptAllDevices:true,optionalServices:[uuids.service]}]);
  assert.equal(r.writes.length,0);await transport.write(Uint8Array.of(1,0x16));
  assert.deepEqual(r.writes,[[1,0x16]]);
});

test('MOCK cancel before lock acquisition cannot later open a chooser or hold the lease',async()=>{
  const r=radio(),pending=deferred(),{transport,gate}=make(r,{gate:locks({pending})});
  const opening=transport.open(),rejected=assert.rejects(opening,/cancelled/);
  transport.close();pending.resolve();await rejected;await flush();
  assert.equal(r.choices.length,0);assert.equal(r.connects,0);assert.equal(r.writes.length,0);assert.equal(gate.held,false);
});

test('MOCK cancel during chooser rejects a late selection before GATT without a fallback',async()=>{
  const r=radio(),pending=deferred();let choices=0;
  r.bluetooth.requestDevice=()=>{choices++;return pending.promise;};
  const {transport,gate}=make(r),opening=transport.open(),rejected=assert.rejects(opening,/cancelled/);
  await flush();assert.equal(choices,1);transport.close();pending.resolve(r.device);await rejected;await flush();
  assert.equal(choices,1);assert.equal(r.connects,0);assert.equal(r.writes.length,0);assert.equal(gate.held,false);
});

test('MOCK browser chooser denial releases the lease without connecting or writing',async()=>{
  const r=radio();r.bluetooth.requestDevice=async()=>{throw new DOMException('User cancelled','NotFoundError');};
  const {transport,gate}=make(r);await assert.rejects(transport.open(),/User cancelled/);await flush();
  assert.equal(r.connects,0);assert.equal(r.writes.length,0);assert.equal(gate.held,false);
});

test('MOCK another instructor tab cannot choose a second car while the first owns the lease',async t=>{
  const shared=locks(),a=radio(),b=radio(),first=make(a,{gate:shared}).transport,second=make(b,{gate:shared}).transport;
  t.after(()=>{first.close();second.close();});
  await first.open();await assert.rejects(second.open(),/Another instructor-drive tab/);
  assert.equal(first.connected,true);assert.equal(a.disconnects,0);assert.equal(b.choices.length,0);
  assert.equal(a.writes.length,0);assert.equal(b.writes.length,0);
  first.close();await flush();await second.open();assert.equal(second.connected,true);
});

test('MOCK intentional close suppresses loss callback; native loss is reported and rejects further writes',async()=>{
  const r=radio(),{transport,gate}=make(r);let lost=0;
  transport.lost=()=>{lost++;transport.close();};
  await transport.open();transport.close();await flush();assert.equal(lost,0);
  await transport.open();r.device.gatt.connected=false;r.device.dispatchEvent(new Event('gattserverdisconnected'));
  await flush();assert.equal(lost,1);assert.equal(transport.connected,false);assert.equal(gate.held,false);
  await assert.rejects(transport.write(Uint8Array.of(1,0x16)),/disconnected/);
  assert.equal(r.writes.length,0);
});

test('MOCK late GATT completion after cancellation is disconnected and cannot send commands',async()=>{
  const r=radio(),pending=deferred();let connected=0;
  r.device.gatt.connect=async()=>{connected++;await pending.promise;r.device.gatt.connected=true;return r.device.gatt;};
  const {transport,gate}=make(r),opening=transport.open(),rejected=assert.rejects(opening,/Disconnected|cancelled/);
  await flush();assert.equal(connected,1);transport.close();pending.resolve();await rejected;await flush();
  assert.equal(transport.connected,false);assert.equal(r.device.gatt.connected,false);
  assert.equal(r.disconnects,1);assert.equal(r.writes.length,0);assert.equal(gate.held,false);
});

test('MOCK cancelled late GATT completion cannot disconnect a replacement owning the same browser device',async t=>{
  const r=radio(),pending=deferred(),shared=locks();let connects=0;
  r.device.gatt.connect=async()=>{if(++connects===1)await pending.promise;r.device.gatt.connected=true;return r.device.gatt;};
  const first=make(r,{gate:shared}).transport,second=make(r,{gate:shared}).transport;
  t.after(()=>{first.close();second.close();});
  const opening=first.open(),rejected=assert.rejects(opening,/Disconnected|cancelled/);await flush();
  first.close();await flush();await second.open();assert.equal(second.connected,true);
  pending.resolve();await rejected;await flush();
  assert.equal(second.connected,true);assert.equal(r.disconnects,0);assert.equal(r.writes.length,0);
});

test('MOCK failed notification setup releases the lease and cannot become a usable transport',async()=>{
  const r=radio();r.rx.startNotifications=async()=>{throw Error('Notifications unavailable');};
  const {transport,gate}=make(r);await assert.rejects(transport.open(),/Notifications unavailable/);await flush();
  assert.equal(transport.connected,false);assert.equal(r.writes.length,0);assert.equal(r.disconnects,1);assert.equal(gate.held,false);
});

test('MOCK setup evidence refusal never reaches the browser chooser',async()=>{
  const r=radio(),{transport,gate}=make(r,{note:()=>false});
  await assert.rejects(transport.open(),/Trace capture refused/);await flush();
  assert.equal(r.choices.length,0);assert.equal(r.connects,0);assert.equal(r.writes.length,0);assert.equal(gate.held,false);
});

test('MOCK power-cycle reconnect rejects a different browser ID before touching its GATT',async()=>{
  const r=radio(),{transport,gate}=make(r);
  r.device.gatt.connected=true; // An unrelated car may be owned by another application.
  await assert.rejects(transport.open({expectedBrowserId:'the-physically-power-cycled-car'}),/does not match/);
  await flush();assert.equal(r.choices.length,1);assert.equal(r.connects,0);assert.equal(r.disconnects,0);
  assert.equal(r.device.gatt.connected,true);assert.equal(r.writes.length,0);assert.equal(gate.held,false);
});

test('MOCK exact power-cycle browser ID can reconnect, with no automatic command or broad fallback',async t=>{
  const r=radio(),{transport}=make(r);t.after(()=>transport.close());
  const identity=await transport.open({expectedBrowserId:r.device.id});
  assert.equal(identity.browserId,r.device.id);assert.equal(r.connects,1);assert.equal(r.writes.length,0);
  assert.deepEqual(r.choices,[{filters:[{services:[uuids.service]}]}]);
});

test('MOCK stalled GATT setup times out, frees its lease and rejects reconnect until reload',async()=>{
  const r=radio(),pending=deferred(),clock=timers();
  r.device.gatt.connect=async()=>{await pending.promise;r.device.gatt.connected=true;return r.device.gatt;};
  const {transport,gate}=make(r,clock),opening=transport.open(),rejected=assert.rejects(opening,/GATT setup timed out/);
  await flush();assert.equal(r.choices.length,1);clock.fire(10000);await rejected;await flush();
  assert.equal(transport.connected,false);assert.equal(gate.held,false);assert.equal(r.writes.length,0);
  assert.equal(clock.pending.size,0);
  await assert.rejects(transport.open(),/reload before reconnecting/);assert.equal(r.choices.length,1);
  pending.resolve();await flush();
  assert.equal(r.device.gatt.connected,false);assert.equal(r.disconnects,1);assert.equal(r.writes.length,0);
});

test('MOCK browser-style timers keep their global receiver through transport, real light trial and controller',async()=>{
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,clock=timers();
  const r=radio(),{transport}=make(r);
  const checkReceiver=receiver=>assert.ok(receiver===undefined||receiver===globalThis,'Timer invoked with a class instance receiver');
  globalThis.setTimeout=function(fn,ms){checkReceiver(this);return clock.setTimer(fn,ms);};
  globalThis.clearTimeout=function(id){checkReceiver(this);return clock.clearTimer(id);};
  try{
    await transport.open();assert.equal(clock.pending.size,0);
    const trial=transport.identify();await flush();clock.fire(400);await flush();clock.fire(1200);await trial;
    assert.deepEqual(r.writes.map(bytes=>bytes[1]),[0x90,0x33,0x33,0x33,0x90]);
    assert.equal(r.writes.some(bytes=>bytes[1]===0x24),false);assert.equal(clock.pending.size,0);
    const controller=new DriveController({mode:'SIMULATION'},{enabled:true});
    assert.equal(await controller.deadline(Promise.resolve('ready'),600,'timeout'),'ready');
    assert.equal(clock.pending.size,0);
  }finally{
    transport.close();globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;
  }
});
