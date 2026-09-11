import test from 'node:test';
import assert from 'node:assert/strict';
import {CarLink,Replay} from './link.mjs';
import {uuids,frame} from './protocol.mjs';

function mockCar({withResponse=false,failStage=null,timers}={}) {
  const log=[],writes=[],choices=[],device=new EventTarget(),rx=new EventTarget();
  device.name='Course car';device.id='browser-scoped-test-id';
  rx.startNotifications=async()=>{if(failStage==='notify')throw Error('notify failed');log.push(['MOCK','notify']);return rx;};
  const tx={properties:withResponse?{write:true}:{writeWithoutResponse:true}};
  tx[withResponse?'writeValueWithResponse':'writeValueWithoutResponse']=async b=>writes.push([...b]);
  const service={getCharacteristic:async u=>{
    if(u===uuids.notify)return rx;
    if(u===uuids.write)return tx;
    throw Error('unexpected characteristic');
  }};
  device.gatt={connected:false,
    connect:async()=>{device.gatt.connected=true;return device.gatt;},
    disconnect:()=>{device.gatt.connected=false;},
    getPrimaryService:async u=>{assert.equal(u,uuids.service);if(failStage==='service')throw Error('service absent');return service;}
  };
  const api={requestDevice:async opts=>{choices.push(opts);return device;}};
  const link=new CarLink((...row)=>log.push(row),undefined,timers);
  const notify=bytes=>{rx.value=new DataView(Uint8Array.from(bytes).buffer);rx.dispatchEvent(new Event('characteristicvaluechanged'));};
  return {log,writes,choices,device,rx,tx,api,link,notify};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function mockTimers(){
  let now=0,next=0;const pending=new Map();
  return {setTimer:(fn,delay)=>{const id=++next;pending.set(id,{fn,at:now+delay,delay});return id;},
    clearTimer:id=>pending.delete(id),has:delay=>[...pending.values()].some(timer=>timer.delay===delay),
    advance:milliseconds=>{now+=milliseconds;for(const [id,timer] of [...pending])if(timer.at<=now){pending.delete(id);timer.fn();}},
    get size(){return pending.size;}};
}
async function until(predicate){
  for(let i=0;i<100;i++){if(predicate())return;await Promise.resolve();}
  assert.fail('MOCK operation did not reach the expected state');
}

test('fixture mode completes a battery request without access to Bluetooth',async()=>{
  const log=[];const link=new Replay((a,b)=>log.push([a,b]));await link.open();await link.send('battery');link.close();
  assert.ok(log.some(([a,b])=>a==='REPLAY RX'&&b.includes('3700 mV')));await assert.rejects(link.send('ping'));
});
test('MOCK close is harmless before open, after an unavailable browser, and when repeated',async()=>{
  const m=mockCar();
  assert.doesNotThrow(()=>m.link.close());assert.doesNotThrow(()=>m.link.close());
  await assert.rejects(m.link.open(undefined),/Web Bluetooth unavailable/);
  assert.doesNotThrow(()=>m.link.close());assert.equal(m.log.length,0);assert.equal(m.writes.length,0);
  await m.link.open(m.api);m.link.close();const count=m.log.length;
  assert.doesNotThrow(()=>m.link.close());assert.equal(m.log.length,count);
  await m.link.open(m.api);await m.link.send('battery');m.link.close();
  assert.deepEqual(m.writes,[[...frame('battery')]]);
});
test('MOCK default chooser filters Anki service; setup sends no commands and exposes browser selection',async()=>{
  const m=mockCar();await m.link.open(m.api);
  assert.deepEqual(m.choices,[{filters:[{services:[uuids.service]}]}]);
  assert.deepEqual(m.link.selection,{name:'Course car',browserId:'browser-scoped-test-id'});
  assert.equal(m.writes.length,0);
  assert.ok(m.log.some(([source,message])=>source==='LIVE selection'&&message.includes('not verified vehicle identity')));
  await m.link.send('battery');assert.deepEqual(m.writes,[[1,0x1a]]);
  m.notify([3,0x1b,0x74,0x0e]);
  assert.ok(m.log.some(([source,message])=>source==='LIVE decoded'&&message==='battery 3700 mV'));
  assert.ok(!m.log.some(([source])=>source.startsWith('REPLAY')));
  m.device.gatt.connected=false;m.device.dispatchEvent(new Event('gattserverdisconnected'));
  await assert.rejects(m.link.send('ping'));assert.ok(!m.link.tx);
});
test('MOCK broad chooser is explicit and still grants only the Anki service',async()=>{
  const m=mockCar();m.device.name=undefined;await m.link.open(m.api,{showAllDevices:true});
  assert.deepEqual(m.choices,[{acceptAllDevices:true,optionalServices:[uuids.service]}]);
  assert.equal(m.link.selection.name,'');assert.equal(m.writes.length,0);m.link.close();
});
test('MOCK chooser cancellation does not fall back, connect, or write',async()=>{
  const m=mockCar();let calls=0;
  await assert.rejects(m.link.open({requestDevice:async()=>{calls++;throw new DOMException('cancelled','NotFoundError');}}));
  assert.equal(calls,1);assert.equal(m.device.gatt.connected,false);assert.equal(m.writes.length,0);
  assert.ok(m.log.some(([source,message])=>source==='LIVE setup error'&&message.startsWith('chooser: NotFoundError')));
  await m.link.open(m.api);m.link.close();
});
test('MOCK saved car mismatch cannot touch GATT or disconnect another session, then correct ID can retry',async()=>{
  const m=mockCar();let connections=0,disconnections=0;
  const connect=m.device.gatt.connect;
  m.device.gatt.connect=async()=>{connections++;return connect();};
  m.device.gatt.connected=true; // May be connected by a different page or controller.
  m.device.gatt.disconnect=()=>{disconnections++;m.device.gatt.connected=false;};
  for(const rememberedDevice of [null,m.device]){
    await assert.rejects(m.link.open(m.api,{rememberedDevice,expectedBrowserId:'my-other-car'}),/does not match your saved car/);
    assert.equal(connections,0);assert.equal(disconnections,0);assert.equal(m.writes.length,0);
    assert.equal(m.device.gatt.connected,true);assert.ok(!m.link.device);assert.ok(!m.link.tx);
  }
  assert.ok(m.log.some(([kind,message])=>kind==='LIVE setup error'&&message.startsWith('saved car check:')));
  await m.link.open(m.api,{expectedBrowserId:m.device.id});assert.equal(connections,1);
  await assert.rejects(m.link.send('engineGreen'),/Confirm the assigned car/);
  assert.equal(m.writes.length,0);m.link.close();assert.equal(disconnections,1);
});
test('MOCK invalid saved identity fails before the chooser instead of disabling the check',async()=>{
  const m=mockCar();
  for(const expectedBrowserId of ['',0,{},false])await assert.rejects(m.link.open(m.api,{expectedBrowserId}),/nonempty browser device ID/);
  assert.equal(m.choices.length,0);assert.equal(m.writes.length,0);
});
test('MOCK concurrent chooser attempts are rejected before opening another chooser',async()=>{
  const m=mockCar(),gate=deferred();let calls=0;
  const opening=m.link.open({requestDevice:()=>{calls++;return gate.promise;}});
  await assert.rejects(m.link.open(m.api),/Already connecting/);assert.equal(calls,1);
  gate.resolve(m.device);await opening;m.link.close();
});
test('MOCK lamp and SDK writes require a nonempty operator assignment for each session',async()=>{
  const m=mockCar();await m.link.open(m.api);
  for(const action of ['lampOn','lampOff','sdkOn','sdkOff'])await assert.rejects(m.link.send(action),/Confirm the assigned car/);
  assert.throws(()=>m.link.confirmAssignedCar('  '),/physical car label/);assert.equal(m.writes.length,0);
  m.link.confirmAssignedCar(' kit-red-1 ');assert.equal(m.link.assignedLabel,'kit-red-1');
  for(const action of ['lampOn','lampOff','sdkOn','sdkOff'])await m.link.send(action);
  assert.deepEqual(m.writes,[[2,0x1d,0x11],[2,0x1d,0x01],[3,0x90,1,0],[3,0x90,0,0]]);
  m.link.close();assert.equal(m.link.assignedLabel,null);assert.equal(m.link.selection,null);
  await m.link.open(m.api);await assert.rejects(m.link.send('lampOn'),/Confirm the assigned car/);m.link.close();
});
test('MOCK write-with-response fallback works without inventing a car reply',async()=>{
  const m=mockCar({withResponse:true});await m.link.open(m.api);await m.link.send('version');
  assert.deepEqual(m.writes,[[1,0x18]]);assert.ok(!m.log.some(([source])=>source==='LIVE RX'));m.link.close();
});
for(const failStage of ['service','notify'])test('MOCK '+failStage+' failure cleans up the connection and notification listener',async()=>{
  const m=mockCar({failStage});await assert.rejects(m.link.open(m.api));
  assert.equal(m.device.gatt.connected,false);assert.equal(m.link.tx,null);assert.equal(m.writes.length,0);
  const before=m.log.length;m.notify([1,0x17]);assert.equal(m.log.length,before);
  assert.ok(m.log.some(([source,message])=>source==='LIVE setup error'&&message.includes(failStage==='service'?'Anki service':'notification setup')));
});
test('MOCK disconnect during notification setup cannot enable commands',async()=>{
  const m=mockCar(),gate=deferred(),started=deferred();
  m.rx.startNotifications=()=>{started.resolve();return gate.promise;};
  const opening=m.link.open(m.api);await started.promise;m.link.close();gate.resolve(m.rx);
  await assert.rejects(opening,/Disconnected during setup/);
  assert.ok(!m.link.tx);assert.equal(m.device.gatt.connected,false);assert.equal(m.writes.length,0);
  assert.ok(!m.log.some(([,message])=>message==='notify ready; no command sent'));
});
test('MOCK closing during connection releases a late connection',async()=>{
  const m=mockCar(),gate=deferred(),started=deferred();
  m.device.gatt.connect=async()=>{started.resolve();await gate.promise;m.device.gatt.connected=true;return m.device.gatt;};
  const opening=m.link.open(m.api);await started.promise;m.link.close();gate.resolve();
  await assert.rejects(opening,/Disconnected during setup/);assert.equal(m.device.gatt.connected,false);assert.equal(m.writes.length,0);
});
test('MOCK overlapping writes are rejected and link loss does not log a completed write',async()=>{
  const m=mockCar(),gate=deferred();await m.link.open(m.api);
  m.tx.writeValueWithoutResponse=async bytes=>{m.writes.push([...bytes]);await gate.promise;};
  const sending=m.link.send('ping');await assert.rejects(m.link.send('battery'),/already in progress/);
  m.link.close();gate.resolve();await assert.rejects(sending,/outcome unknown/);
  assert.deepEqual(m.writes,[[1,0x16]]);assert.ok(!m.log.some(([source])=>source==='LIVE TX'));
  assert.ok(m.log.some(([source,message])=>source==='LIVE TX attempt'&&message.startsWith('01 16 · ping')));
});
test('MOCK malformed RX stays raw evidence and cannot become a battery result',async()=>{
  const m=mockCar();await m.link.open(m.api);m.notify([3,0x1b,0x74]);
  assert.ok(m.log.some(([source,message])=>source==='LIVE RX'&&message==='03 1b 74'));
  assert.ok(m.log.some(([source])=>source==='LIVE parse error'));
  assert.ok(!m.log.some(([source])=>source==='LIVE decoded'));m.link.close();
});
for(const wrapper of ['same object','different object, same browser ID'])test('MOCK active device ownership rejects a second session: '+wrapper,async()=>{
  const m=mockCar(),second=new CarLink(()=>{});await m.link.open(m.api);
  const candidate=wrapper==='same object'?m.device:Object.assign(new EventTarget(),{id:m.device.id,name:m.device.name,gatt:m.device.gatt});
  await assert.rejects(second.open({requestDevice:async()=>candidate}),/already has an active bench session/);
  assert.equal(m.device.gatt.connected,true);assert.ok(m.link.tx);assert.ok(!second.tx);
  await m.link.send('battery');assert.deepEqual(m.writes,[[1,0x1a]]);
  second.close();assert.equal(m.device.gatt.connected,true);m.link.close();
  await second.open({requestDevice:async()=>candidate});assert.ok(second.tx);second.close();
});
for(const wrapper of ['same object','different object, same browser ID'])test('MOCK cancelled old setup cannot disconnect a newer owner: '+wrapper,async()=>{
  const m=mockCar(),second=new CarLink(()=>{}),gate=deferred(),started=deferred();
  m.rx.startNotifications=()=>{started.resolve();return gate.promise;};
  const opening=m.link.open(m.api);await started.promise;m.link.close();
  const candidate=wrapper==='same object'?m.device:Object.assign(new EventTarget(),{id:m.device.id,name:m.device.name,gatt:m.device.gatt});
  m.rx.startNotifications=async()=>m.rx;await second.open({requestDevice:async()=>candidate});
  gate.resolve(m.rx);await assert.rejects(opening,/Disconnected during setup/);
  assert.equal(candidate.gatt.connected,true);await second.send('battery');assert.deepEqual(m.writes,[[1,0x1a]]);second.close();
});
test('MOCK a cancelled chooser never disconnects a device subsequently claimed elsewhere',async()=>{
  const m=mockCar(),second=new CarLink(()=>{}),gate=deferred();
  const opening=m.link.open({requestDevice:()=>gate.promise});m.link.close();
  await second.open(m.api);gate.resolve(m.device);await assert.rejects(opening,/Selection cancelled/);
  assert.equal(m.device.gatt.connected,true);await second.send('ping');assert.deepEqual(m.writes,[[1,0x16]]);second.close();
});
test('MOCK setup failures release device-ID claims for another instance',async()=>{
  for(const failStage of ['service','notify']){
    const failed=mockCar({failStage});await assert.rejects(failed.link.open(failed.api));
    const replacement=mockCar();assert.equal(replacement.device.id,failed.device.id);
    await replacement.link.open(replacement.api);await replacement.link.send('ping');replacement.link.close();
  }
});
test('MOCK missing browser IDs use object ownership without conflating independent devices',async()=>{
  const first=mockCar(),second=mockCar(),duplicate=new CarLink(()=>{});delete first.device.id;delete second.device.id;
  await first.link.open(first.api);await second.link.open(second.api);
  await assert.rejects(duplicate.open(first.api),/already has an active bench session/);
  assert.equal(first.device.gatt.connected,true);assert.equal(second.device.gatt.connected,true);
  first.link.close();second.link.close();
  await duplicate.open(first.api);duplicate.close();
});
test('MOCK trace refusal blocks the wire write without blocking legacy undefined callbacks',async()=>{
  const m=mockCar();await m.link.open(m.api);
  m.link.note=source=>source==='LIVE TX attempt'?false:undefined;
  await assert.rejects(m.link.send('battery'),/Trace capture refused.*no write attempted/);
  assert.equal(m.writes.length,0);assert.equal(m.link.pendingWrite,null);
  m.link.note=()=>undefined;await m.link.send('battery');assert.deepEqual(m.writes,[[1,0x1a]]);m.link.close();
});
test('MOCK setup trace refusal prevents opening the browser chooser',async()=>{
  const m=mockCar();m.link.note=source=>source==='LIVE chooser'?false:undefined;
  await assert.rejects(m.link.open(m.api),/Trace capture refused connection setup/);
  assert.equal(m.choices.length,0);assert.equal(m.device.gatt.connected,false);assert.equal(m.writes.length,0);
  m.link.note=()=>undefined;await m.link.open(m.api);assert.equal(m.choices.length,1);m.link.close();
});
for(const refusedStage of ['selection','connecting'])test('MOCK '+refusedStage+' trace refusal avoids GATT connection and releases its claim',async()=>{
  const m=mockCar();let connects=0,disconnects=0;
  m.device.gatt.connected=true; // A connection this attempt did not create.
  m.device.gatt.connect=async()=>{connects++;m.device.gatt.connected=true;return m.device.gatt;};
  m.device.gatt.disconnect=()=>{disconnects++;m.device.gatt.connected=false;};
  m.link.note=(source,message)=>((refusedStage==='selection'&&source==='LIVE selection') || (refusedStage==='connecting'&&source==='LIVE GATT'&&message==='connecting'))?false:undefined;
  await assert.rejects(m.link.open(m.api),/Trace capture refused connection setup/);
  assert.equal(m.choices.length,1);assert.equal(connects,0);assert.equal(disconnects,0);
  assert.equal(m.device.gatt.connected,true);assert.equal(m.writes.length,0);
  const replacement=new CarLink(()=>undefined);await replacement.open(m.api);
  assert.equal(connects,1);replacement.close();assert.equal(disconnects,1);
});

test('MOCK engine trial prepares SDK once and leaves it enabled through off, with no connection-time writes',async()=>{
  const m=mockCar();await m.link.open(m.api);assert.equal(m.writes.length,0);
  await assert.rejects(m.link.send('engineGreen'),/Confirm the assigned car/);
  await assert.rejects(m.link.send('engineOff'),/Confirm the assigned car/);assert.equal(m.writes.length,0);
  m.link.confirmAssignedCar('S01-A');
  await m.link.send('engineGreen');await m.link.send('engineOff');await m.link.send('sdkOff');
  assert.deepEqual(m.writes,['sdkOn','engineGreen','engineOff','sdkOff'].map(a=>[...frame(a)]));
  await m.link.send('engineGreen');assert.deepEqual(m.writes.slice(-2),['sdkOn','engineGreen'].map(a=>[...frame(a)]));
  m.link.close();
});
test('MOCK failed SDK preparation stops the engine command and permits an explicit retry',async()=>{
  const m=mockCar();await m.link.open(m.api);m.link.confirmAssignedCar('S01-A');
  const original=m.tx.writeValueWithoutResponse;
  m.tx.writeValueWithoutResponse=async bytes=>{m.writes.push([...bytes]);throw Error('SDK write denied');};
  await assert.rejects(m.link.send('engineGreen'),/SDK write denied/);
  assert.deepEqual(m.writes,[[...frame('sdkOn')]]);assert.equal(m.link.sdkRequestedOn,false);
  m.tx.writeValueWithoutResponse=original;await m.link.send('engineGreen');
  assert.deepEqual(m.writes.slice(-2),['sdkOn','engineGreen'].map(a=>[...frame(a)]));m.link.close();
});
test('MOCK engine sequence owns the write lock across SDK preparation and stops on disconnect',async()=>{
  const m=mockCar(),gate=deferred();await m.link.open(m.api);m.link.confirmAssignedCar('S01-A');
  m.tx.writeValueWithoutResponse=async bytes=>{m.writes.push([...bytes]);await gate.promise;};
  const sending=m.link.send('engineGreen');await assert.rejects(m.link.send('sdkOff'),/already in progress/);
  m.link.close();gate.resolve();await assert.rejects(sending,/Disconnected during write/);
  assert.deepEqual(m.writes,[[...frame('sdkOn')]]);
});
test('MOCK trace refusal between SDK and engine stops the second write',async()=>{
  const m=mockCar(),log=m.link.note;m.link.note=(kind,message)=>kind==='LIVE TX attempt'&&message.includes('engineGreen')?false:log(kind,message);
  await m.link.open(m.api);m.link.confirmAssignedCar('S01-A');
  await assert.rejects(m.link.send('engineGreen'),/Trace capture refused/);
  assert.deepEqual(m.writes,[[...frame('sdkOn')]]);m.link.close();
});
test('MOCK remembered device uses its exact permission object without a new chooser or implicit writes',async()=>{
  const m=mockCar();let chooser=0;
  await m.link.open({requestDevice:async()=>{chooser++;throw Error('must not choose another car');}},{rememberedDevice:m.device});
  assert.equal(chooser,0);assert.equal(m.link.selection.browserId,m.device.id);assert.equal(m.writes.length,0);
  await assert.rejects(m.link.send('engineGreen'),/Confirm the assigned car/);m.link.close();
});

test('MOCK candidate signal uses only the fixed light sequence and never confirms assignment',async()=>{
  const timers=mockTimers(),m=mockCar({timers});await m.link.open(m.api);
  const trial=m.link.identifyCandidate();await until(()=>timers.has(400));
  assert.deepEqual(m.writes,['sdkOn','engineOff'].map(action=>[...frame(action)]));
  timers.advance(399);assert.equal(m.writes.length,2);timers.advance(1);
  await until(()=>timers.has(1200));assert.deepEqual(m.writes.at(-1),[...frame('engineGreen')]);
  timers.advance(1199);assert.equal(m.writes.length,3);timers.advance(1);await trial;
  assert.deepEqual(m.writes,['sdkOn','engineOff','engineGreen','engineOff','sdkOff'].map(action=>[...frame(action)]));
  assert.equal(m.link.assignedLabel,null);assert.equal(m.link.sdkRequestedOn,false);assert.equal(timers.size,0);
  assert.ok(m.log.some(([source,message])=>source==='LIVE identification'&&message.startsWith('started')));
  assert.ok(m.log.some(([source,message])=>source==='LIVE identification'&&message.includes('identity unverified')));
  await assert.rejects(m.link.send('engineGreen'),/Confirm the assigned car/);
  await m.link.send('battery');m.link.close();
});
test('MOCK candidate signal owns the command lock during both pauses and writes',async()=>{
  const timers=mockTimers(),m=mockCar({timers});await m.link.open(m.api);
  const trial=m.link.identifyCandidate();await until(()=>timers.has(400));
  await assert.rejects(m.link.send('battery'),/already in progress/);
  await assert.rejects(m.link.identifyCandidate(),/already in progress/);
  timers.advance(400);await until(()=>timers.has(1200));
  await assert.rejects(m.link.send('ping'),/already in progress/);
  timers.advance(1200);await trial;m.link.close();
});
test('MOCK first SDK failure prevents green and attempts explicit same-session cleanup',async()=>{
  const timers=mockTimers(),m=mockCar({timers});await m.link.open(m.api);
  m.tx.writeValueWithoutResponse=async bytes=>{m.writes.push([...bytes]);if(m.writes.length===1)throw Error('SDK refused');};
  await assert.rejects(m.link.identifyCandidate(),/SDK refused.*cleanup writes completed/);
  assert.deepEqual(m.writes,['sdkOn','engineOff','sdkOff'].map(action=>[...frame(action)]));
  assert.equal(m.link.assignedLabel,null);assert.equal(m.link.pendingWrite,null);assert.equal(timers.size,0);m.link.close();
});
test('MOCK cleanup write failures are reported without losing the original failure',async()=>{
  const timers=mockTimers(),m=mockCar({timers});await m.link.open(m.api);
  m.tx.writeValueWithoutResponse=async bytes=>{m.writes.push([...bytes]);throw Error('wire rejected');};
  await assert.rejects(m.link.identifyCandidate(),/wire rejected.*cleanup failed: engineOff: wire rejected; sdkOff: wire rejected/);
  assert.deepEqual(m.writes,['sdkOn','engineOff','sdkOff'].map(action=>[...frame(action)]));
  assert.equal(timers.size,0);m.link.close();
});
for(const delay of [400,1200])test('MOCK disconnect during candidate pause '+delay+' stops promptly without cleanup or later writes',async()=>{
  const timers=mockTimers(),m=mockCar({timers});await m.link.open(m.api);
  const trial=m.link.identifyCandidate();await until(()=>timers.has(400));
  if(delay===1200){timers.advance(400);await until(()=>timers.has(1200));}
  const written=m.writes.length;m.link.close();await assert.rejects(trial,/interrupted by disconnect.*cleanup unavailable/);
  assert.equal(timers.size,0);timers.advance(10000);assert.equal(m.writes.length,written);
  assert.equal(m.link.pendingWrite,null);
});
test('MOCK candidate hung write deadline releases caller without overlapping cleanup or harming a new owner',async()=>{
  const timers=mockTimers(),m=mockCar({timers}),gate=deferred();await m.link.open(m.api);
  const original=m.tx.writeValueWithoutResponse;
  m.tx.writeValueWithoutResponse=bytes=>{m.writes.push([...bytes]);return gate.promise;};
  const trial=m.link.identifyCandidate();await until(()=>m.writes.length===1);
  timers.advance(10000);await assert.rejects(trial,/timed out.*cleanup unavailable/);
  assert.equal(m.device.gatt.connected,false);assert.equal(m.link.pendingWrite,null);assert.equal(timers.size,0);
  assert.deepEqual(m.writes,[[...frame('sdkOn')]]);assert.ok(!m.log.some(([kind])=>kind==='LIVE TX'));
  const replacement=new CarLink(()=>{}),wrapper=Object.assign(new EventTarget(),{id:m.device.id,name:m.device.name,gatt:m.device.gatt});
  m.tx.writeValueWithoutResponse=original;await replacement.open({requestDevice:async()=>wrapper});
  const count=m.log.length;gate.resolve();await until(()=>!m.link.pendingWrite);
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(m.log.length,count);assert.equal(wrapper.gatt.connected,true);assert.equal(m.writes.length,1);
  await replacement.send('battery');assert.deepEqual(m.writes.at(-1),[...frame('battery')]);replacement.close();
});
test('MOCK candidate rejects exhausted capture before start and never writes cleanup after capture refusal',async()=>{
  const timers=mockTimers(),m=mockCar({timers});await m.link.open(m.api);
  m.link.note=kind=>kind==='LIVE identification'?false:undefined;
  await assert.rejects(m.link.identifyCandidate(),/Trace capture refused identification/);
  assert.equal(m.writes.length,0);assert.equal(timers.size,0);
  m.link.note=(kind,message)=>kind==='LIVE TX attempt'&&message.includes('engineGreen')?false:undefined;
  const trial=m.link.identifyCandidate();await until(()=>timers.has(400));timers.advance(400);
  await assert.rejects(trial,/Trace capture refused.*cleanup unavailable/);
  assert.deepEqual(m.writes,['sdkOn','engineOff'].map(action=>[...frame(action)]));
  assert.equal(timers.size,0);assert.equal(m.link.assignedLabel,null);m.link.close();
});
test('MOCK native connection loss ends a candidate trial and releases its ownership immediately',async()=>{
  const timers=mockTimers(),m=mockCar({timers});await m.link.open(m.api);
  const trial=m.link.identifyCandidate();await until(()=>timers.has(400));
  m.device.gatt.connected=false;m.device.dispatchEvent(new Event('gattserverdisconnected'));
  await assert.rejects(trial,/interrupted by disconnect/);
  assert.ok(m.log.some(([kind,message])=>kind==='LIVE identification'&&message.startsWith('ended:')));
  assert.equal(m.link.device,null);assert.equal(timers.size,0);
  const replacement=new CarLink(()=>{});await replacement.open(m.api);replacement.close();
});
test('MOCK deadline also bounds hung cleanup and never overlaps it with SDK-off',async()=>{
  const timers=mockTimers(),m=mockCar({timers}),gate=deferred();await m.link.open(m.api);
  m.tx.writeValueWithoutResponse=bytes=>{
    m.writes.push([...bytes]);
    return m.writes.length===1?Promise.reject(Error('SDK failed')):gate.promise;
  };
  const trial=m.link.identifyCandidate();await until(()=>m.writes.length===2);
  timers.advance(10000);await assert.rejects(trial,/timed out.*cleanup failed: engineOff/);
  assert.deepEqual(m.writes,['sdkOn','engineOff'].map(action=>[...frame(action)]));
  assert.equal(m.link.device,null);assert.equal(m.link.pendingWrite,null);assert.equal(timers.size,0);
  const count=m.log.length;gate.resolve();for(let i=0;i<10;i++)await Promise.resolve();
  assert.equal(m.writes.length,2);assert.equal(m.log.length,count);
});
test('MOCK capture exhaustion on a completed SDK write stops the remaining candidate sequence',async()=>{
  const timers=mockTimers(),m=mockCar({timers});await m.link.open(m.api);
  m.link.note=kind=>kind==='LIVE TX'?false:undefined;
  await assert.rejects(m.link.identifyCandidate(),/Trace capture stopped.*cleanup unavailable/);
  assert.deepEqual(m.writes,[[...frame('sdkOn')]]);assert.equal(timers.size,0);m.link.close();
});
