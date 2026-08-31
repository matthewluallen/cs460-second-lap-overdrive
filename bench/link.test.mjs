import test from 'node:test';
import assert from 'node:assert/strict';
import {CarLink,Replay} from './link.mjs';
import {uuids} from './protocol.mjs';

function mockCar({withResponse=false,failStage=null}={}) {
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
  const link=new CarLink((...row)=>log.push(row));
  const notify=bytes=>{rx.value=new DataView(Uint8Array.from(bytes).buffer);rx.dispatchEvent(new Event('characteristicvaluechanged'));};
  return {log,writes,choices,device,rx,tx,api,link,notify};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}

test('fixture mode completes a battery request without access to Bluetooth',async()=>{
  const log=[];const link=new Replay((a,b)=>log.push([a,b]));await link.open();await link.send('battery');link.close();
  assert.ok(log.some(([a,b])=>a==='REPLAY RX'&&b.includes('3700 mV')));await assert.rejects(link.send('ping'));
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
