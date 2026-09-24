import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {CarLink,Replay} from './link.mjs';
import {Records} from './records.mjs';
import {uuids} from './protocol.mjs';

// A minimal DOM runs the actual UI and transport without a browser, radio, or
// dependencies. It rejects HTML sinks so hostile names/notes stay literal text.
const html=await readFile(new URL('./index.html',import.meta.url),'utf8');
const ui=(await readFile(new URL('./ui.mjs',import.meta.url),'utf8'))
  .replace(/^import .* from '\.\/(?:link|records)\.mjs';\n/gm,'');
class Element {
  value='';textContent='';disabled=false;checked=false;dataset={};children=[];
  append(option){this.children.push(option);if(this.children.length===1)this.value=option.value;}
  set innerHTML(_){throw new Error('HTML rendering is forbidden in this fixture');}
}
function mockCar(){
  const device=new EventTarget(),rx=new EventTarget(),writes=[],choices=[];
  device.name='Course car';device.id='browser-scoped-mock-id';
  rx.startNotifications=async()=>rx;
  const tx={properties:{writeWithoutResponse:true},writeValueWithoutResponse:async bytes=>{writes.push([...bytes]);}};
  const service={getCharacteristic:async id=>{if(id===uuids.notify)return rx;if(id===uuids.write)return tx;throw Error('unexpected characteristic');}};
  device.gatt={connected:false,connect:async()=>{device.gatt.connected=true;return device.gatt;},
    disconnect:()=>{device.gatt.connected=false;},getPrimaryService:async id=>{assert.equal(id,uuids.service);return service;}};
  const bluetooth={requestDevice:async options=>{choices.push(options);return device;}};
  return {device,rx,tx,writes,choices,bluetooth,
    notify(bytes){rx.value=new DataView(Uint8Array.from(bytes).buffer);rx.dispatchEvent(new Event('characteristicvaluechanged'));},
    lose(){device.gatt.connected=false;device.dispatchEvent(new Event('gattserverdisconnected'));}};
}
function harness(bluetooth){
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  const operations=new Map([...html.matchAll(/data-op="([^"]+)"/g)].map(([,op])=>{const b=new Element();b.dataset.op=op;return [op,b];}));
  elements.get('rid').value='101';elements.get('trace').textContent='No traffic yet.';
  const timers=new Map(),events=new Map(),downloads=[];let timerId=0;
  const window={isSecureContext:true,addEventListener:(name,fn)=>events.set(name,fn)};window.top=window.self=window;
  const blobs=new Map();
  const document={getElementById:id=>{assert.ok(elements.has(id),'Unknown DOM id '+id);return elements.get(id);},
    querySelectorAll:selector=>{assert.equal(selector,'[data-op]');return [...operations.values()];},
    createElement:tag=>{assert.equal(tag,'a');const a={click:()=>downloads.push({name:a.download,blob:blobs.get(a.href)})};return a;}};
  const context={CarLink,Replay,Records,window,document,navigator:{bluetooth,userAgent:'MOCK Chrome / TestOS'},Blob,
    Option:class {constructor(text,value){this.text=text;this.value=value;}},
    URL:{createObjectURL:blob=>{const key='blob:mock-'+blobs.size;blobs.set(key,blob);return key;},revokeObjectURL:key=>blobs.delete(key)},
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  vm.runInNewContext(ui,context,{filename:'bench/ui.mjs'});
  return {elements,operations,timers,downloads,
    el:id=>elements.get(id),op:id=>operations.get(id),
    click:async id=>{const element=elements.get(id)??operations.get(id);if(!element.disabled)await element.onclick();},
    set:(id,value)=>{const element=elements.get(id);element.value=value;element.oninput?.();},
    expire:ms=>{const ready=[...timers].filter(([,t])=>t.ms===ms);assert.ok(ready.length,'Expected timer '+ms);for(const [id,t] of ready){timers.delete(id);t.fn();}},
    event:name=>events.get(name)?.()};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
async function connect(h){h.set('assignedCar','kit-red-1');await h.click('live');}

test('MOCK UI replay rehearses battery and lamp with no radio and exports labelled evidence',async()=>{
  let radioCalls=0;const h=harness({requestDevice:()=>{radioCalls++;throw Error('Replay touched Bluetooth');}});
  assert.equal(h.el('live').disabled,true);await h.click('replay');assert.equal(h.el('status').textContent,'Replay fixture');
  await h.click('battery');assert.match(h.el('batteryResult').textContent,/REPLAY RX: battery 3700 mV/);
  assert.equal(h.timers.size,0);await h.click('lampOn');assert.match(h.el('lampResult').textContent,/REPLAY: command rehearsed; no physical LED/);
  assert.equal(h.el('recordObservation').disabled,true);assert.equal(h.el('clear').disabled,true);
  const trace=h.el('trace').textContent;h.el('clear').onclick();assert.equal(h.el('trace').textContent,trace);
  await h.click('save');assert.equal(h.downloads.length,1);assert.match(h.downloads[0].name,/^second-lap-bench-trace-.*\.txt$/);
  assert.match(await h.downloads[0].blob.text(),/REPLAY RX.*battery 3700 mV/);assert.equal(radioCalls,0);
  await h.click('close');await h.click('clear');assert.equal(h.el('trace').textContent,'No traffic yet.');
  assert.equal(h.el('batteryResult').textContent,'No battery request this session.');
});
test('MOCK UI live commands stay gated until assigned-car confirmation, then reset on reconnect',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await connect(h);
  assert.equal(h.el('status').textContent,'Live car connected');assert.equal(m.writes.length,0);
  assert.deepEqual(m.choices,[{filters:[{services:[uuids.service]}]}]);
  assert.match(h.el('selection').textContent,/browser device ID: browser-scoped-mock-id/);
  for(const op of ['lampOn','lampOff','sdkOn','sdkOff']){assert.equal(h.op(op).disabled,true);await h.op(op).onclick();}
  assert.equal(m.writes.length,0);assert.equal(h.op('battery').disabled,false);
  await h.click('confirm');await h.click('lampOn');assert.deepEqual(m.writes,[[2,0x1d,0x11]]);
  assert.match(h.el('lampResult').textContent,/write completed\. Observe/);
  assert.match(h.el('trace').textContent,/LIVE operator.*not an automatic identity check/);
  await h.click('close');await h.click('live');assert.equal(h.op('lampOn').disabled,true);assert.equal(h.el('confirm').disabled,false);
});
test('MOCK UI clears replay results for live work and accepts only a pending matching live battery RX',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await h.click('replay');await h.click('battery');await h.click('close');
  await connect(h);assert.equal(h.el('batteryResult').textContent,'No battery request this session.');
  m.notify([3,0x1b,0x74,0x0e]);assert.equal(h.el('batteryResult').textContent,'No battery request this session.');
  await h.click('battery');assert.match(h.el('batteryResult').textContent,/LIVE: waiting/);
  assert.equal(h.op('ping').disabled,true);m.notify([1,0x17]);assert.match(h.el('batteryResult').textContent,/waiting/);
  m.notify([3,0x1b,0x74]);assert.match(h.el('batteryResult').textContent,/waiting/);
  m.notify([3,0x1b,0x10,0x0e]);assert.match(h.el('batteryResult').textContent,/LIVE decoded: battery 3600 mV/);
  assert.equal(h.timers.size,0);assert.equal(h.op('ping').disabled,false);
  assert.match(h.el('trace').textContent,/REPLAY RX/);assert.match(h.el('trace').textContent,/LIVE RX/);
});
test('MOCK UI timeout and disconnect preserve distinct battery outcomes and unblock controls',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await connect(h);await h.click('battery');h.expire(5000);
  assert.match(h.el('batteryResult').textContent,/LIVE: no battery reply within five seconds/);
  m.notify([3,0x1b,0x74,0x0e]);assert.match(h.el('batteryResult').textContent,/no battery reply/);
  assert.equal(h.op('battery').disabled,false);await h.click('battery');m.lose();
  assert.match(h.el('batteryResult').textContent,/LIVE: disconnected before a battery reply/);
  assert.equal(h.timers.size,0);assert.equal(h.el('status').textContent,'Disconnected');assert.equal(h.el('clear').disabled,false);
  assert.equal(h.op('battery').disabled,true);assert.match(h.el('trace').textContent,/LIVE GATT.*disconnected/);
});
test('MOCK UI failed write keeps requested bytes and error without fabricating a response',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);m.tx.writeValueWithoutResponse=async()=>{throw Error('mock write denied');};
  await connect(h);await h.click('battery');
  assert.match(h.el('batteryResult').textContent,/LIVE: battery write failed: mock write denied/);
  assert.match(h.el('trace').textContent,/LIVE TX attempt \| 01 1a/);assert.match(h.el('trace').textContent,/LIVE error \| mock write denied/);
  assert.doesNotMatch(h.el('trace').textContent,/\| LIVE TX \|/);assert.doesNotMatch(h.el('trace').textContent,/LIVE decoded/);
  assert.equal(h.timers.size,0);assert.equal(h.op('battery').disabled,false);
});
test('MOCK UI records LED observations as operator reports and renders hostile text literally',async()=>{
  const m=mockCar(),h=harness(m.bluetooth),hostile='<img src=x onerror=alert(1)>';
  m.device.name=hostile;h.set('assignedCar','kit-red-1');h.set('sessionNotes',hostile);await h.click('live');
  assert.ok(h.el('selection').textContent.includes(hostile));await h.click('confirm');await h.click('lampOn');
  h.set('observation','No visible change');h.set('observationNote',hostile);await h.click('recordObservation');
  assert.match(h.el('trace').textContent,/LIVE observation \| operator reports: No visible change/);
  assert.ok(h.el('trace').textContent.includes(hostile));assert.match(h.el('lampResult').textContent,/not telemetry/);
  assert.doesNotMatch(h.el('trace').textContent,/LIVE decoded.*Light/);
  const before=m.writes.length;h.set('entry',hostile);await h.click('add');assert.equal(m.writes.length,before);
});
test('MOCK UI all-device fallback is explicit and resets after disconnect',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);h.el('allDevices').checked=true;await connect(h);
  assert.deepEqual(m.choices,[{acceptAllDevices:true,optionalServices:[uuids.service]}]);
  await h.click('close');assert.equal(h.el('allDevices').checked,false);await h.click('live');
  assert.deepEqual(m.choices[1],{filters:[{services:[uuids.service]}]});
});
test('MOCK UI setup failure reports its stage and leaves the page usable',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);m.rx.startNotifications=async()=>{throw Error('mock notifications denied');};
  await connect(h);assert.equal(h.el('status').textContent,'Disconnected');assert.equal(h.el('live').disabled,false);
  assert.equal(h.el('clear').disabled,false);assert.equal(m.device.gatt.connected,false);
  assert.match(h.el('trace').textContent,/LIVE setup error.*notification setup.*mock notifications denied/);
  assert.equal(m.writes.length,0);
});
test('MOCK UI disconnect during lamp write reports an unknown outcome, never a completed observation',async()=>{
  const m=mockCar(),h=harness(m.bluetooth),gate=deferred();await connect(h);await h.click('confirm');
  m.tx.writeValueWithoutResponse=async()=>gate.promise;
  const sending=h.click('lampOn');assert.match(h.el('lampResult').textContent,/pending/);
  await h.click('close');gate.resolve();await sending;
  assert.match(h.el('lampResult').textContent,/disconnected.*unknown/i);
  assert.doesNotMatch(h.el('trace').textContent,/\| LIVE TX \|/);
});
test('MOCK UI pagehide cancels a pending connection and releases any late GATT connection',async()=>{
  const m=mockCar(),h=harness(m.bluetooth),gate=deferred(),started=deferred();
  m.device.gatt.connect=async()=>{started.resolve();await gate.promise;m.device.gatt.connected=true;return m.device.gatt;};
  h.set('assignedCar','kit-red-1');const connecting=h.click('live');await started.promise;h.event('pagehide');gate.resolve();await connecting;
  assert.equal(m.device.gatt.connected,false);assert.notEqual(h.el('status').textContent,'Live car connected');assert.equal(m.writes.length,0);
});
test('MOCK UI late cancelled setup cannot contaminate a new replay trace or status',async()=>{
  const m=mockCar(),h=harness(m.bluetooth),gate=deferred(),started=deferred();
  m.device.gatt.connect=async()=>{started.resolve();await gate.promise;m.device.gatt.connected=true;return m.device.gatt;};
  h.set('assignedCar','kit-red-1');const connecting=h.click('live');await started.promise;
  await h.click('close');await h.click('clear');await h.click('replay');await h.click('battery');
  const before=h.el('trace').textContent;gate.resolve();await connecting;
  assert.equal(m.device.gatt.connected,false);assert.equal(h.el('status').textContent,'Replay fixture');
  assert.equal(h.el('trace').textContent,before);assert.match(h.el('batteryResult').textContent,/REPLAY RX: battery 3700 mV/);
});
test('MOCK UI absent Bluetooth remains a reported failure with replay available',async()=>{
  const h=harness(undefined);await connect(h);
  assert.equal(h.el('status').textContent,'Disconnected');assert.equal(h.el('replay').disabled,false);
  assert.match(h.el('context').textContent,/Web Bluetooth API unavailable/);
  assert.match(h.el('trace').textContent,/LIVE error.*Web Bluetooth unavailable/);
  await h.click('replay');await h.click('battery');assert.match(h.el('batteryResult').textContent,/REPLAY RX: battery 3700 mV/);
});
test('MOCK UI blocks same-device reconnect until cancelled setup settles, while replay remains usable',async()=>{
  const m=mockCar(),h=harness(m.bluetooth),gate=deferred(),started=deferred();
  m.rx.startNotifications=()=>{started.resolve();return gate.promise;};
  h.set('assignedCar','kit-red-1');const connecting=h.click('live');await started.promise;
  assert.equal(m.device.gatt.connected,true);await h.click('close');
  assert.equal(m.device.gatt.connected,false);assert.equal(h.el('live').disabled,true);
  assert.match(h.el('status').textContent,/finishing the previous Bluetooth attempt/);
  // Exercise the handler guard as well as the disabled-button presentation.
  await h.el('live').onclick();assert.equal(m.choices.length,1);
  assert.equal(h.el('replay').disabled,false);await h.click('replay');await h.click('battery');
  assert.match(h.el('batteryResult').textContent,/REPLAY RX: battery 3700 mV/);
  await h.click('close');assert.equal(h.el('live').disabled,true);
  const before=h.el('trace').textContent;
  m.rx.startNotifications=async()=>m.rx;gate.resolve(m.rx);await connecting;
  assert.equal(h.el('trace').textContent,before);assert.equal(h.el('status').textContent,'Disconnected');
  assert.equal(h.el('live').disabled,false);await h.click('live');
  assert.equal(m.choices.length,2);assert.equal(m.device.gatt.connected,true);
  assert.equal(h.el('status').textContent,'Live car connected');assert.equal(m.writes.length,0);
  await h.click('battery');m.notify([3,0x1b,0x10,0x0e]);
  assert.match(h.el('batteryResult').textContent,/LIVE decoded: battery 3600 mV/);
  assert.equal(m.device.gatt.connected,true);await h.click('close');
});
