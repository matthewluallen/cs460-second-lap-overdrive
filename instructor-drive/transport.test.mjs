import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserTransport,SetupTimeoutError} from './transport.mjs';
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

test('MOCK explicit power-cycle reconnect reuses only the remembered exact device and discovers fresh attributes',async t=>{
  const r=radio(),events=[],{transport}=make(r,{note:(...row)=>{events.push(row);return true;}});
  t.after(()=>transport.close());
  await transport.open();transport.close();await flush();
  assert.equal(r.connects,1);assert.equal(r.choices.length,1);
  r.bluetooth.requestDevice=async()=>{throw new DOMException('A redundant chooser was cancelled','NotFoundError');};
  const prior=events.length,identity=await transport.open({expectedBrowserId:r.device.id});
  assert.equal(identity.browserId,r.device.id);assert.equal(r.connects,2);assert.equal(r.choices.length,1);
  assert.equal(r.stages.filter(stage=>stage===uuids.service).length,2);
  assert.equal(r.stages.filter(stage=>stage==='notifications ready').length,2);
  assert.equal(events.slice(prior).some(([source])=>source==='LIVE chooser'),false);
  assert.ok(events.slice(prior).some(([source])=>source==='LIVE remembered selection'));
  assert.equal(r.writes.length,0);
});

test('MOCK generic fresh selection still opens a chooser and never silently reuses the remembered car',async t=>{
  const a=radio(),b=radio(),{transport}=make(a);t.after(()=>transport.close());
  await transport.open();transport.close();await flush();
  let choices=0;a.bluetooth.requestDevice=async()=>{choices++;return b.device;};
  const identity=await transport.open();
  assert.equal(choices,1);assert.equal(identity.browserId,b.device.id);
  assert.equal(a.connects,1);assert.equal(b.connects,1);assert.equal(a.writes.length+b.writes.length,0);
});

test('MOCK failed remembered reconnect never opens an alternative chooser or connects another car',async()=>{
  const r=radio(),other=radio(),{transport,gate}=make(r);
  await transport.open();transport.close();await flush();
  let choices=0;r.bluetooth.requestDevice=async()=>{choices++;return other.device;};
  r.device.gatt.connect=async()=>{throw new DOMException('Prior permission unavailable','SecurityError');};
  await assert.rejects(transport.open({expectedBrowserId:r.device.id}),/Prior permission unavailable/);
  await flush();assert.equal(choices,0);assert.equal(other.connects,0);assert.equal(gate.held,false);
  assert.equal(r.writes.length+other.writes.length,0);assert.equal(transport.connected,false);
});

test('MOCK selection without a usable browser ID cannot enter setup or create an ambiguous retry target',async()=>{
  const r=radio(),{transport,gate}=make(r);r.device.id='';
  await assert.rejects(transport.open(),/no usable device ID/);await flush();
  assert.equal(r.connects,0);assert.equal(r.writes.length,0);assert.equal(transport.retryBrowserId,null);assert.equal(gate.held,false);
});

test('MOCK stalled GATT setup times out, frees its lease and blocks manual retry until original operation settles',async()=>{
  const r=radio(),pending=deferred(),clock=timers();
  r.device.gatt.connect=async()=>{await pending.promise;r.device.gatt.connected=true;return r.device.gatt;};
  const {transport,gate}=make(r,clock),opening=transport.open(),rejected=assert.rejects(opening,error=>{
    assert.ok(error instanceof SetupTimeoutError);assert.equal(error.name,'SetupTimeoutError');assert.equal(error.stage,'GATT connection');return true;
  });
  await flush();assert.equal(r.choices.length,1);clock.fire(30000);await rejected;await flush();
  assert.equal(transport.connected,false);assert.equal(gate.held,false);assert.equal(r.writes.length,0);
  assert.equal(clock.pending.size,0);assert.equal(transport.poisoned,true);assert.equal(transport.setupPending,true);
  assert.equal(transport.retryBrowserId,r.device.id);
  await assert.rejects(transport.open(),/still finishing/);assert.equal(r.choices.length,1);
  pending.resolve();await flush();
  assert.equal(r.device.gatt.connected,false);assert.equal(r.disconnects,1);assert.equal(r.writes.length,0);
  assert.equal(transport.setupPending,false);assert.equal(transport.poisoned,false);
  assert.equal(r.choices.length,1,'settling does not automatically reopen the chooser');
});

test('MOCK timed-out service discovery permits an explicit same-car retry after actual rejection and obtains fresh attributes',async t=>{
  const r=radio(),pending=deferred(),clock=timers(),original=r.device.gatt.getPrimaryService;let lookups=0;
  r.device.gatt.getPrimaryService=uuid=>++lookups===1?pending.promise:original(uuid);
  const {transport,gate}=make(r,clock),progress=[];t.after(()=>transport.close());
  transport.progress=current=>progress.push({stage:current.stage,pending:current.setupPending,poisoned:current.poisoned});
  const opening=transport.open({expectedBrowserId:r.device.id});
  const rejected=assert.rejects(opening,error=>error.name==='SetupTimeoutError'&&error.stage==='service/characteristic discovery');
  await flush();assert.equal(lookups,1);assert.equal(transport.stage,'service/characteristic discovery');
  clock.fire(30000);await rejected;assert.equal(gate.held,false);assert.equal(r.disconnects,1);
  await assert.rejects(transport.open(),/still finishing/);assert.equal(r.connects,1);
  pending.reject(new Error('GATT Server is disconnected'));await flush();
  assert.equal(transport.poisoned,false);assert.equal(transport.setupPending,false);assert.equal(transport.link.opening,false);
  assert.equal(transport.retryBrowserId,r.device.id);assert.equal(r.connects,1);assert.equal(r.writes.length,0);
  assert.ok(progress.some(row=>row.stage.includes('manual retry available')&&!row.pending&&!row.poisoned));
  await transport.open();assert.equal(r.connects,2);assert.equal(lookups,2);assert.equal(transport.stage,'ready');
  assert.equal(transport.retryBrowserId,null);assert.equal(r.writes.length,0);
  assert.ok(progress.some(row=>row.stage==='notification setup'));
});

test('MOCK a recovery retry cannot change the captured car or touch a wrong car before GATT',async t=>{
  const r=radio(),wrong=radio(),pending=deferred(),clock=timers(),original=r.device.gatt.getPrimaryService;
  r.device.gatt.getPrimaryService=()=>pending.promise;
  const {transport}=make(r,clock);t.after(()=>transport.close());
  const opening=transport.open(),rejected=assert.rejects(opening,SetupTimeoutError);await flush();clock.fire(30000);await rejected;
  pending.reject(new Error('Disconnected'));await flush();
  await assert.rejects(transport.open({expectedBrowserId:wrong.device.id}),/same browser device ID/);
  assert.equal(r.choices.length,1);assert.equal(transport.retryBrowserId,r.device.id);
  let extraChoices=0;r.bluetooth.requestDevice=async()=>{extraChoices++;return wrong.device;};
  r.device.gatt.getPrimaryService=original;
  await transport.open();assert.equal(transport.connected,true);assert.equal(transport.retryBrowserId,null);
  assert.equal(extraChoices,0);assert.equal(wrong.connects,0);assert.equal(wrong.disconnects,0);
  assert.equal(wrong.writes.length,0);assert.equal(r.writes.length,0);
});

test('MOCK cancellation while an original browser operation is pending also blocks overlapping chooser/setup',async()=>{
  const r=radio(),pending=deferred();r.bluetooth.requestDevice=()=>pending.promise;
  const {transport}=make(r),opening=transport.open(),rejected=assert.rejects(opening,/cancelled/);await flush();
  transport.close();await assert.rejects(transport.open(),/still finishing/);
  assert.equal(r.connects,0);pending.resolve(r.device);await rejected;await flush();
  assert.equal(transport.setupPending,false);assert.equal(transport.poisoned,false);assert.equal(transport.retryBrowserId,null);
});

test('MOCK a throwing progress display cannot prevent timeout cleanup or settlement recovery',async()=>{
  const r=radio(),pending=deferred(),clock=timers();r.device.gatt.getPrimaryService=()=>pending.promise;
  const {transport}=make(r,clock);transport.progress=()=>{throw Error('UI unavailable');};
  const opening=transport.open(),rejected=assert.rejects(opening,SetupTimeoutError);await flush();clock.fire(30000);await rejected;
  assert.equal(transport.connected,false);pending.reject(new Error('Disconnected'));await flush();
  assert.equal(transport.setupPending,false);assert.equal(transport.poisoned,false);assert.equal(r.writes.length,0);
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


test('MOCK explicit same-ID rediscovery replaces a stale remembered handle before connecting',async t=>{
  const old=radio(),fresh=radio(),{transport}=make(old);t.after(()=>transport.close());
  await transport.open();transport.close();await flush();fresh.device.id=old.device.id;
  old.device.gatt.connect=async()=>{throw new DOMException('Bluetooth Device is no longer in range.','NetworkError');};
  let choices=0;old.bluetooth.requestDevice=async()=>{choices++;return fresh.device;};
  const identity=await transport.open({expectedBrowserId:old.device.id,rescanSavedDevice:true});
  assert.equal(identity.browserId,old.device.id);assert.equal(choices,1);assert.equal(fresh.connects,1);
  assert.equal(old.connects,1);assert.equal(old.writes.length+fresh.writes.length,0);
});

test('MOCK same-car rediscovery rejects a wrong chooser selection before GATT',async()=>{
  const old=radio(),other=radio(),{transport}=make(old);await transport.open();transport.close();await flush();
  old.bluetooth.requestDevice=async()=>other.device;
  await assert.rejects(transport.open({expectedBrowserId:old.device.id,rescanSavedDevice:true}),/does not match/);
  assert.equal(other.connects,0);assert.equal(other.writes.length,0);assert.equal(old.connects,1);
});
