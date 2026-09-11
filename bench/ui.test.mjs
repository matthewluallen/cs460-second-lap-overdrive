import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {CarLink,Replay} from './link.mjs';
import {TraceLog} from './trace.mjs';
import {CarLabels} from './car-labels.mjs';
import {EnrollmentProbe} from './detection.mjs';
import {uuids} from './protocol.mjs';

// A minimal DOM runs the actual UI and transport without a browser, radio, or
// dependencies. It rejects HTML sinks so hostile names/notes stay literal text.
const evidenceHtml=await readFile(new URL('./evidence.html',import.meta.url),'utf8');
const compactHtml=await readFile(new URL('./index.html',import.meta.url),'utf8');
const ui=(await readFile(new URL('./ui.mjs',import.meta.url),'utf8'))
  .replace(/^import .* from '\.\/(?:link|records|trace|car-labels|detection|protocol)\.mjs';\n/gm,'');
const labelsModule=(await readFile(new URL('./car-labels.mjs',import.meta.url),'utf8'))
  .replace(/^export /gm,'');
class Element {
  value='';textContent='';disabled=false;checked=false;dataset={};children=[];
  append(option){this.children.push(option);if(this.children.length===1)this.value=option.value;}
  replaceChildren(...options){this.children=[];this.value='';for(const option of options)this.append(option);}
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
const harnesses=new Set();
afterEach(()=>{for(const h of harnesses)h.event('pagehide');harnesses.clear();});
function memoryStore(){const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};}
function harness(bluetooth,traceOptions,page='evidence',storage=memoryStore()){
  const html=page==='compact'?compactHtml:evidenceHtml;
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([,id])=>[id,new Element()]));
  const operations=new Map([...html.matchAll(/data-op="([^"]+)"/g)].map(([,op])=>{const b=new Element();b.dataset.op=op;return [op,b];}));
  if(elements.has('trace'))elements.get('trace').textContent='No traffic yet.';
  const timers=new Map(),events=new Map(),downloads=[];let timerId=0,time=0;
  const setTimer=(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms,at:time+ms});return id;},clearTimer=id=>timers.delete(id);
  const window={isSecureContext:true,localStorage:storage,location:{origin:'http://localhost:8000',pathname:'/evidence.html',search:'?token=not-for-traces',hash:'#private'},addEventListener:(name,fn)=>events.set(name,fn)};window.top=window.self=window;
  const blobs=new Map();
  const document={hidden:false,addEventListener:(name,fn)=>events.set(name,fn),getElementById:id=>elements.get(id)??null,
    querySelectorAll:selector=>{assert.equal(selector,'[data-op]');return [...operations.values()];},
    createElement:tag=>{assert.equal(tag,'a');const a={click:()=>downloads.push({name:a.download,blob:blobs.get(a.href)})};return a;}};
  const context={CarLink:class extends CarLink {constructor(note,closed){super(note,closed,{setTimer,clearTimer});}},Replay,uuids,TextEncoder,
    EnrollmentProbe:class extends EnrollmentProbe {constructor(note,change){super(note,change,{now:()=>time,setTimer,clearTimer});}},
    TraceLog:traceOptions?class extends TraceLog {constructor(){super(traceOptions);}}:TraceLog,window,document,navigator:{bluetooth,userAgent:'MOCK Chrome / TestOS'},Blob,
    Option:class {constructor(text,value){this.text=text;this.value=value;}},
    URL:{createObjectURL:blob=>{const key='blob:mock-'+blobs.size;blobs.set(key,blob);return key;},revokeObjectURL:key=>blobs.delete(key)},
    setTimeout:setTimer,clearTimeout:clearTimer};
  // Plain-record validation must share the UI's realm, as it does in a browser.
  vm.runInNewContext('const CarLabels=(()=>{'+labelsModule+'\nreturn CarLabels;})();\n'+ui,context,{filename:'bench/ui.mjs'});
  const instance={elements,operations,timers,downloads,
    el:id=>elements.get(id),op:id=>operations.get(id),
    click:async id=>{const element=elements.get(id)??operations.get(id);if(!element.disabled)await element.onclick();},
    set:(id,value)=>{const element=elements.get(id);element.value=value;element.oninput?.();element.onchange?.();},
    expire:ms=>{const ready=[...timers].filter(([,t])=>t.ms===ms);assert.ok(ready.length,'Expected timer '+ms);for(const [id,t] of ready){timers.delete(id);t.fn();}},
    event:name=>events.get(name)?.(),
    hide:()=>{document.hidden=true;events.get('visibilitychange')?.();},
    tick:async ms=>{const end=time+ms;for(let i=0;i<20;i++)await Promise.resolve();for(;;){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at);if(!due.length)break;const [id,t]=due[0];time=t.at;timers.delete(id);t.fn();for(let i=0;i<12;i++)await Promise.resolve();}time=end;for(let i=0;i<12;i++)await Promise.resolve();}};
  harnesses.add(instance);return instance;
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
  assert.match(h.el('trace').textContent,/bench identify-v1; page http:\/\/localhost:8000\/evidence.html/);
  assert.doesNotMatch(h.el('trace').textContent,/not-for-traces|#private/);
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
test('MOCK UI timeout is inconclusive and requires a new connection before another battery request',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await connect(h);await h.click('battery');h.expire(5000);
  assert.match(h.el('batteryResult').textContent,/LIVE: no battery RX within five seconds; result inconclusive/);
  m.notify([3,0x1b,0x74,0x0e]);assert.match(h.el('batteryResult').textContent,/no battery RX/);
  assert.doesNotMatch(h.el('commandResult').textContent,/battery 3700/);
  assert.equal(h.op('battery').disabled,true);const writes=m.writes.length;await h.click('battery');assert.equal(m.writes.length,writes);
  await h.click('close');await h.click('live');assert.equal(h.op('battery').disabled,false);await h.click('battery');m.lose();
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
  assert.equal(h.timers.size,0);assert.equal(h.op('battery').disabled,true);
});
test('MOCK UI records LED observations as operator reports and renders hostile text literally',async()=>{
  const m=mockCar(),h=harness(m.bluetooth),hostile='<img src=x onerror=alert(1)>';
  m.device.name=hostile;h.set('assignedCar','kit-red-1');h.set('sessionNotes',hostile);await h.click('live');
  assert.ok(h.el('selection').textContent.includes(hostile));await h.click('confirm');await h.click('lampOn');
  h.set('observation','No visible change');h.set('observationNote',hostile);await h.click('recordObservation');
  assert.match(h.el('trace').textContent,/LIVE observation \| operator reports: No visible change/);
  assert.ok(h.el('trace').textContent.includes(hostile));assert.match(h.el('lampResult').textContent,/not telemetry/);
  assert.doesNotMatch(h.el('trace').textContent,/LIVE decoded.*Light/);
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

test('MOCK UI requires a fresh LED observation for each attempt and clears it after recording',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await connect(h);await h.click('confirm');
  await h.click('lampOn');h.set('observation','Light visibly on');h.set('observationNote','Old on detail');
  await h.click('lampOff');
  assert.equal(h.el('observation').value,'');assert.equal(h.el('observationNote').value,'');
  assert.equal(h.el('recordObservation').disabled,true);
  const before=h.el('trace').textContent;await h.el('recordObservation').onclick();assert.equal(h.el('trace').textContent,before);
  h.set('observation','Light visibly off');h.set('observationNote','Ari observed the off attempt');await h.click('recordObservation');
  assert.match(h.el('trace').textContent,/LIVE observation.*"number":1.*"label":"kit-red-1".*"browserId":"browser-scoped-mock-id"/);
  assert.match(h.el('trace').textContent,/LIVE observation.*"id":"1\/lamp-2","command":"lampOff".*write completed/);
  assert.equal(h.el('observation').value,'');assert.equal(h.el('observationNote').value,'');assert.equal(h.el('recordObservation').disabled,true);
});
test('MOCK UI preserves confirmed identity for post-disconnect observation, then clears it for replay',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await connect(h);await h.click('confirm');await h.click('lampOn');m.lose();
  h.set('assignedCar','next-kit');h.set('sessionNotes','Context for the NEXT connection');
  h.set('observation','Light visibly on');h.set('observationNote','Ari saw it remain on; cleanup unavailable');
  assert.equal(h.el('recordObservation').disabled,false);const writes=m.writes.length;await h.click('recordObservation');
  assert.equal(m.writes.length,writes);assert.match(h.el('lampResult').textContent,/after disconnect/);
  await h.click('save');const saved=await h.downloads[0].blob.text();
  assert.match(saved,/LIVE observation.*"label":"kit-red-1".*"browserId":"browser-scoped-mock-id".*"afterDisconnect":true.*cleanup unavailable/);
  assert.doesNotMatch(saved,/next-kit|Context for the NEXT/);
  await h.click('replay');h.set('observation','Light visibly on');assert.equal(h.el('recordObservation').disabled,true);
  await h.click('close');assert.equal(h.el('recordObservation').disabled,true);await h.click('clear');
  assert.match(h.el('observationContext').textContent,/Run a light attempt/);
});
test('MOCK UI associates observations with failed and interrupted lamp writes without fabricating success',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await connect(h);await h.click('confirm');
  m.tx.writeValueWithoutResponse=async()=>{throw Error('mock rejection');};await h.click('lampOn');
  h.set('observation','No visible change');await h.click('recordObservation');
  assert.match(h.el('trace').textContent,/LIVE observation.*"command":"lampOn".*write failed or completion unknown: mock rejection/);
  const gate=deferred();m.tx.writeValueWithoutResponse=()=>gate.promise;const sending=h.click('lampOff');m.lose();
  h.set('observation','Unable to tell');h.set('observationNote','Connection lost before observation');await h.click('recordObservation');
  assert.match(h.el('trace').textContent,/LIVE observation.*"command":"lampOff".*disconnected during write; outcome unknown.*"afterDisconnect":true/);
  gate.resolve();await sending;assert.doesNotMatch(h.el('trace').textContent,/\| LIVE TX \|/);
});
test('MOCK UI caps evidence before crediting an unretained battery result and requires export before clear',async()=>{
  const m=mockCar(),h=harness(m.bluetooth,{maxLines:13,maxChars:2000000,visibleLines:3});await connect(h);await h.click('confirm');
  await h.click('battery');m.notify([3,0x1b,0x74,0x0e]);
  assert.match(h.el('traceNotice').textContent,/Trace incomplete/);assert.match(h.el('trace').textContent,/TRACE INCOMPLETE/);
  assert.doesNotMatch(h.el('batteryResult').textContent,/battery 3700 mV/);assert.equal(h.timers.size,0);
  assert.match(h.el('commandResult').textContent,/Trace incomplete/);assert.doesNotMatch(h.el('commandResult').textContent,/battery 3700/);
  assert.equal(m.device.gatt.connected,true,'overflow must not automatically disconnect');
  for(const op of ['battery','lampOn','lampOff','sdkOff'])assert.equal(h.op(op).disabled,true);
  assert.equal(h.el('recordObservation').disabled,true);assert.equal(h.el('confirm').disabled,true);
  const writes=m.writes.length;await h.op('lampOn').onclick();assert.equal(m.writes.length,writes);
  await h.click('close');assert.equal(h.el('clear').disabled,true);await h.el('clear').onclick();assert.match(h.el('trace').textContent,/TRACE INCOMPLETE/);
  assert.equal(h.el('live').disabled,true);assert.equal(h.el('replay').disabled,true);
  await h.click('save');const saved=await h.downloads[0].blob.text();
  assert.match(saved,/local session 1/);assert.match(saved,/TRACE INCOMPLETE/);assert.ok(saved.split('\n').length>h.el('trace').textContent.split('\n').length);
  assert.equal(h.el('clear').disabled,false);await h.click('clear');assert.equal(h.el('replay').disabled,false);
  await h.click('replay');await h.click('battery');assert.match(h.el('batteryResult').textContent,/REPLAY RX: battery 3700 mV/);
});
test('MOCK UI rejects an unrecordable TX attempt before it can send bytes',async()=>{
  const m=mockCar(),h=harness(m.bluetooth,{maxLines:10,maxChars:2000000,visibleLines:200});await connect(h);await h.click('confirm');
  // The check declaration occupies the last line; the attempted packet cannot be retained.
  await h.click('battery');assert.match(h.el('traceNotice').textContent,/Trace incomplete/);assert.equal(m.writes.length,0);
});
test('MOCK UI pending write timeout remains inconclusive with Disconnect available and no concurrent retry',async()=>{
  const m=mockCar(),h=harness(m.bluetooth),gate=deferred();await connect(h);m.tx.writeValueWithoutResponse=()=>gate.promise;
  const sending=h.click('battery');h.expire(5000);
  assert.match(h.el('batteryResult').textContent,/result inconclusive.*write remains pending, Disconnect to recover/);
  assert.equal(h.el('close').disabled,false);assert.equal(h.op('battery').disabled,true);assert.equal(h.op('ping').disabled,true);
  await h.click('close');gate.resolve();await sending;assert.equal(h.el('status').textContent,'Disconnected');
});


test('MOCK compact page omits lower forms and rehearses battery and lamp without radio',async()=>{
  const h=harness({requestDevice(){throw Error('Replay touched Bluetooth');}},undefined,'compact');
  for(const id of ['observation','recordObservation','trace','traceNotice','save','clear','operator','entry','out'])assert.equal(h.el(id),undefined);
  assert.doesNotMatch(compactHtml,/Support worksheet|Visible LED observation|Fictional CS460 pilot|No traffic yet/);
  assert.match(compactHtml,/href="evidence.html"/);
  await h.click('replay');await h.click('battery');
  assert.match(h.el('batteryResult').textContent,/REPLAY RX: battery 3700 mV/);
  await h.click('lampOn');assert.match(h.el('lampResult').textContent,/no physical LED/);
  await h.click('close');assert.equal(h.el('status').textContent,'Disconnected');assert.equal(h.downloads.length,0);
});
test('MOCK compact live page retains assignment gates and distinct battery and LED outcomes',async()=>{
  const m=mockCar(),h=harness(m.bluetooth,undefined,'compact');await connect(h);
  assert.equal(m.writes.length,0);assert.equal(h.op('lampOn').disabled,true);
  await h.click('lampOn');assert.equal(m.writes.length,0);
  await h.click('battery');m.notify([3,0x1b,0x10,0x0e]);
  assert.match(h.el('batteryResult').textContent,/LIVE decoded: battery 3600 mV/);
  await h.click('confirm');await h.click('lampOn');await h.click('lampOff');
  assert.deepEqual(m.writes,[[1,0x1a],[2,0x1d,0x11],[2,0x1d,0x01]]);
  assert.match(h.el('lampResult').textContent,/write completed.*visible behavior is unverified/);
  await h.click('sdkOn');assert.match(h.el('commandResult').textContent,/LIVE: sdkOn write completed; car response unverified/);
  await h.click('sdkOff');assert.match(h.el('commandResult').textContent,/LIVE: sdkOff write completed; car response unverified/);
  h.event('pagehide');assert.equal(m.device.gatt.connected,false);
});
test('MOCK compact page exposes setup errors without a trace and keeps replay available',async()=>{
  const m=mockCar(),h=harness(m.bluetooth,undefined,'compact');
  m.rx.startNotifications=async()=>{throw Error('<mock setup failure>');};await connect(h);
  assert.equal(h.el('status').textContent,'Disconnected');assert.equal(h.el('replay').disabled,false);
  assert.match(h.el('commandResult').textContent,/notification setup.*<mock setup failure>/);
  assert.equal(m.writes.length,0);await h.click('replay');await h.click('battery');
  assert.match(h.el('batteryResult').textContent,/REPLAY RX: battery 3700/);
});
test('MOCK compact page keeps a late battery notification inconclusive until reconnect',async()=>{
  const m=mockCar(),h=harness(m.bluetooth,undefined,'compact');await connect(h);
  await h.click('battery');h.expire(5000);m.notify([3,0x1b,0x74,0x0e]);
  assert.match(h.el('batteryResult').textContent,/no battery RX/);
  assert.doesNotMatch(h.el('commandResult').textContent,/battery 3700/);
  assert.equal(h.op('battery').disabled,true);await h.click('close');await h.click('live');
  assert.equal(h.op('battery').disabled,false);await h.click('battery');m.notify([3,0x1b,0x10,0x0e]);
  assert.match(h.el('batteryResult').textContent,/battery 3600/);
});
test('MOCK compact session cap provides recovery without missing export controls or false results',async()=>{
  const m=mockCar(),h=harness(m.bluetooth,{maxLines:13,maxChars:2000000,visibleLines:3},'compact');
  await connect(h);await h.click('confirm');await h.click('battery');m.notify([3,0x1b,0x74,0x0e]);
  assert.match(h.el('commandResult').textContent,/Session limit reached.*Disconnect and reload/);
  assert.doesNotMatch(h.el('batteryResult').textContent,/battery 3700/);
  assert.equal(h.op('lampOn').disabled,true);assert.equal(h.el('close').disabled,false);
  await h.click('close');assert.equal(m.device.gatt.connected,false);assert.equal(h.el('replay').disabled,true);
  const reloaded=harness(undefined,undefined,'compact');await reloaded.click('replay');await reloaded.click('battery');
  assert.match(reloaded.el('batteryResult').textContent,/battery 3700/);
});

test('MOCK UI engine identification keeps SDK evidence separate from unrelated RX and records its context',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await connect(h);
  assert.equal(h.op('engineGreen').disabled,true);await h.click('confirm');await h.click('engineGreen');
  assert.equal(m.writes[0][1],0x90);assert.equal(m.writes[1][1],0x33);
  assert.match(h.el('sdkResult').textContent,/LIVE SDK: Enable write completed; actual mode unverified/);
  const sdk=h.el('sdkResult').textContent;m.notify([1,0x86]);assert.equal(h.el('sdkResult').textContent,sdk);
  h.set('observation','Light visibly on');await h.click('recordObservation');
  assert.match(h.el('trace').textContent,/LIVE observation.*engineGreen.*sdkContext.*Enable write completed/);
  await h.click('engineOff');assert.equal(m.writes.length,3);await h.click('sdkOff');assert.equal(m.writes.length,4);
  await h.click('close');assert.match(h.el('sdkResult').textContent,/not verified or reset/);
  await h.click('replay');assert.match(h.el('sdkResult').textContent,/No SDK request/);
  await h.click('engineGreen');assert.match(h.el('sdkResult').textContent,/REPLAY SDK.*no physical car/);
  assert.equal(m.writes.length,4);assert.match(h.el('lampResult').textContent,/no physical LED/);
});
test('MOCK UI failed SDK preparation does not send an LED command or claim a visible outcome',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await connect(h);await h.click('confirm');
  m.tx.writeValueWithoutResponse=async bytes=>{m.writes.push([...bytes]);throw Error('SDK rejected');};
  await h.click('engineGreen');assert.equal(m.writes.length,1);assert.equal(m.writes[0][1],0x90);
  assert.match(h.el('sdkResult').textContent,/failed or completion unknown/);assert.match(h.el('lampResult').textContent,/light write failed/);
});
test('MOCK UI remembers two identical names and reconnects only the selected saved ID after reload',async()=>{
  const first=mockCar(),second=mockCar(),unknown=mockCar(),storage=memoryStore();
  first.device.name=second.device.name='Ice Charger';second.device.id='same-model-second-id';unknown.device.id='unassigned-id';
  let selected=first.device,choices=0,lists=0;
  const bluetooth={requestDevice:async()=>{choices++;return selected;},getDevices:async()=>{lists++;return [unknown.device,second.device,first.device];}};
  const h=harness(bluetooth,undefined,'evidence',storage);
  h.set('assignedCar','S01-A');await h.click('live');assert.equal(h.el('rememberCar').disabled,true);
  await h.click('confirm');await h.click('rememberCar');await h.click('close');
  selected=second.device;h.set('assignedCar','S01-B');await h.click('live');await h.click('confirm');await h.click('rememberCar');await h.click('close');
  const reloaded=harness(bluetooth,undefined,'compact',storage);
  assert.equal(lists,0);await reloaded.click('refreshCars');assert.equal(lists,1);
  assert.equal(reloaded.el('rememberedCar').children.length,3);
  assert.match(reloaded.el('fleetStatus').textContent,/not a scan/);
  reloaded.set('rememberedCar',second.device.id);await reloaded.click('connectRemembered');
  assert.equal(choices,2);assert.equal(second.device.gatt.connected,true);assert.equal(first.device.gatt.connected,false);
  assert.equal(reloaded.el('assignedCar').value,'S01-B');assert.match(reloaded.el('recognition').textContent,/Remembered label: S01-B/);
  assert.equal(reloaded.op('engineGreen').disabled,true);assert.equal(first.writes.length+second.writes.length,0);
  await reloaded.click('confirm');await reloaded.click('battery');second.notify([3,0x1b,0x62,0x0e]);
  assert.match(reloaded.el('batteryResult').textContent,/3682/);assert.equal(first.writes.length,0);
});
test('MOCK UI rejects a known-car label mismatch and missing or unsupported permissions stay explicit',async()=>{
  const m=mockCar(),storage=memoryStore();new CarLabels(storage).remember({browserId:m.device.id,name:m.device.name},'S02-B');
  const h=harness(m.bluetooth,undefined,'evidence',storage);h.set('assignedCar','S01-A');await h.click('live');
  assert.match(h.el('recognition').textContent,/label differs/);assert.equal(h.el('confirm').disabled,true);
  await h.el('confirm').onclick();assert.equal(h.op('engineGreen').disabled,true);assert.equal(m.writes.length,0);
  await h.click('close');await h.click('refreshCars');assert.match(h.el('fleetStatus').textContent,/cannot list prior permissions/);
  h.set('rememberedCar',m.device.id);assert.equal(h.el('connectRemembered').disabled,false); // Granted handle retained in this page.
  m.bluetooth.getDevices=async()=>[];await h.click('refreshCars');assert.match(h.el('fleetStatus').textContent,/0 remembered/);
  assert.match(h.el('fleetStatus').textContent,/Reconnect; missing handles use a guarded Chrome chooser/);
  assert.equal(h.el('connectRemembered').disabled,false,'saved IDs remain available through the guarded chooser');await h.click('forgetRemembered');assert.equal(new CarLabels(storage).entries().length,0);
});
test('MOCK UI storage denial does not break the live battery workflow or claim a saved car',async()=>{
  const m=mockCar(),storage={getItem:()=>null,setItem:()=>{throw Error('storage denied');}},h=harness(m.bluetooth,undefined,'compact',storage);
  await connect(h);await h.click('confirm');await h.click('rememberCar');assert.match(h.el('fleetStatus').textContent,/save|storage/i);
  await h.click('battery');m.notify([3,0x1b,0x62,0x0e]);assert.match(h.el('batteryResult').textContent,/3682/);
  assert.equal(new CarLabels(storage).entries().length,0);
});
test('MOCK UI cannot connect a new device using a physical label already bound to another ID',async()=>{
  const m=mockCar(),storage=memoryStore();new CarLabels(storage).remember({browserId:'original-device-id',name:'Ice Charger'},'S01-A');
  const h=harness(m.bluetooth,undefined,'evidence',storage);h.set('assignedCar','s01-a');await h.click('live');
  assert.match(h.el('commandResult').textContent,/saved|match|different/i);assert.equal(h.el('confirm').disabled,true);
  assert.equal(h.el('status').textContent,'Disconnected');assert.equal(m.device.gatt.connected,false);
  await h.el('confirm').onclick();assert.equal(h.op('engineGreen').disabled,true);assert.equal(m.writes.length,0);
  await h.click('close');h.set('rememberedCar','original-device-id');await h.click('forgetRemembered');
  await h.click('live');assert.equal(h.el('confirm').disabled,false);
});
test('MOCK UI reconnects either enrolled car in the same open page without getDevices support',async()=>{
  const a=mockCar(),b=mockCar(),storage=memoryStore();b.device.id='second-open-page-id';a.device.name=b.device.name='International MXT';
  let selected=a.device,choosers=0;
  const bluetooth={requestDevice:async()=>{choosers++;return selected;}};
  const h=harness(bluetooth,undefined,'compact',storage);
  h.set('assignedCar','S01-A');await h.click('live');await h.click('confirm');await h.click('rememberCar');await h.click('close');
  selected=b.device;h.set('assignedCar','S01-B');await h.click('live');await h.click('confirm');await h.click('rememberCar');await h.click('close');
  await h.click('refreshCars');assert.match(h.el('fleetStatus').textContent,/2 remembered car\(s\) can reconnect in this open page/);
  h.set('rememberedCar',a.device.id);await h.click('connectRemembered');assert.equal(choosers,2);
  assert.equal(a.device.gatt.connected,true);assert.equal(b.device.gatt.connected,false);assert.equal(h.op('engineGreen').disabled,true);
  await h.click('close');h.set('rememberedCar',b.device.id);await h.click('connectRemembered');assert.equal(choosers,2);
  assert.equal(b.device.gatt.connected,true);assert.equal(a.device.gatt.connected,false);await h.click('close');
  const reload=harness(bluetooth,undefined,'compact',storage);reload.set('rememberedCar',b.device.id);assert.equal(reload.el('connectRemembered').disabled,false);
  assert.equal(a.writes.length+b.writes.length,0);
});

test('MOCK UI saves bounded escaped display names without changing the browser ID or original selection trace',async()=>{
  const cases=[
    {raw:'\u0010Ice\u0000 Charger\u202e',display:'\\u0010Ice\\u0000 Charger\\u202e'},
    {raw:'@'+'x'.repeat(200)+'\u0000tail',display:'@'+'x'.repeat(126)+'…'},
    {raw:'\u0010'+'x'.repeat(122),display:'\\u0010'+'x'.repeat(122)},
    {raw:undefined,display:''}
  ];
  for(const [index,{raw,display}] of cases.entries()){
    const m=mockCar(),storage=memoryStore();m.device.name=raw;m.device.id='opaque-original-id-'+index;
    const h=harness(m.bluetooth,undefined,'evidence',storage);await connect(h);await h.click('confirm');
    await h.click('rememberCar');
    const row=new CarLabels(storage).find(m.device.id);
    assert.ok(row,'an unusual optional name must not prevent enrollment');
    assert.equal(row.browserId,m.device.id);assert.equal(row.name,display);assert.ok(row.name.length<=128);
    assert.match(h.el('fleetStatus').textContent,/Remembered kit-red-1/);
    assert.equal(m.device.name,raw);assert.equal(m.writes.length,0);
    const selectionLine=h.el('trace').textContent.split('\n').find(line=>line.includes(' | LIVE selection | '));
    const original=JSON.parse(selectionLine.split(' | LIVE selection | ')[1].split(' · browser name/ID only;')[0]);
    assert.equal(original.name,raw??'');assert.equal(original.browserId,m.device.id);
    await h.click('close');h.set('rememberedCar',m.device.id);await h.click('connectRemembered');
    assert.equal(m.choices.length,1,'name normalization must not discard the granted device object');
    assert.equal(h.op('engineGreen').disabled,true);await h.click('close');
  }
});

test('MOCK UI reload without getDevices reconnects saved IDs through a guarded chooser and rejects the wrong car before GATT',async()=>{
  const first=mockCar(),second=mockCar(),storage=memoryStore();
  first.device.id='saved-first-id';second.device.id='saved-second-id';first.device.name=second.device.name='Ice Charger';
  let selected=first.device,choices=0,firstConnects=0,secondConnects=0;
  const connectFirst=first.device.gatt.connect,connectSecond=second.device.gatt.connect;
  first.device.gatt.connect=async()=>{firstConnects++;return connectFirst();};
  second.device.gatt.connect=async()=>{secondConnects++;return connectSecond();};
  const bluetooth={requestDevice:async()=>{choices++;return selected;}};
  const enrollment=harness(bluetooth,undefined,'evidence',storage);
  for(const [device,label] of [[first.device,'S01-A'],[second.device,'S01-B']]){
    selected=device;enrollment.set('assignedCar',label);await enrollment.click('live');await enrollment.click('confirm');await enrollment.click('rememberCar');await enrollment.click('close');
  }
  const originalRows=new CarLabels(storage).entries(),reloaded=harness(bluetooth,undefined,'evidence',storage);
  reloaded.set('rememberedCar',first.device.id);assert.equal(reloaded.el('connectRemembered').disabled,false);
  assert.match(reloaded.el('rememberedCar').children.find(option=>option.value===first.device.id).text,/chooser required/);
  await reloaded.click('refreshCars');assert.match(reloaded.el('fleetStatus').textContent,/guarded Chrome chooser/);
  selected=second.device;const before=[firstConnects,secondConnects];await reloaded.click('connectRemembered');
  assert.deepEqual([firstConnects,secondConnects],before,'wrong choice must not reach either GATT connection');
  assert.equal(first.writes.length+second.writes.length,0);assert.equal(reloaded.el('status').textContent,'Disconnected');
  assert.match(reloaded.el('commandResult').textContent,/saved|match|different/i);
  assert.equal(reloaded.op('engineGreen').disabled,true);assert.deepEqual(new CarLabels(storage).entries(),originalRows);
  selected=first.device;await reloaded.click('connectRemembered');
  assert.equal(firstConnects,before[0]+1);assert.equal(secondConnects,before[1]);
  assert.equal(reloaded.el('assignedCar').value,'S01-A');assert.equal(reloaded.op('engineGreen').disabled,true);
  await reloaded.click('confirm');assert.equal(reloaded.op('engineGreen').disabled,false);await reloaded.click('close');
  reloaded.set('rememberedCar',second.device.id);selected=second.device;await reloaded.click('connectRemembered');
  assert.equal(secondConnects,before[1]+1);assert.equal(reloaded.el('assignedCar').value,'S01-B');
  assert.equal(reloaded.op('engineGreen').disabled,true);assert.equal(first.writes.length+second.writes.length,0);
  assert.equal(choices,5);assert.match(reloaded.el('trace').textContent,/LIVE recognition guard.*Chrome chooser selection must match before GATT/);
});

function advertisements(m){
  let watches=0;
  m.device.watchingAdvertisements=false;
  m.device.watchAdvertisements=async({signal})=>{
    watches++;m.device.watchingAdvertisements=true;
    signal.addEventListener('abort',()=>{m.device.watchingAdvertisements=false;},{once:true});
  };
  return {get watches(){return watches;},emit(rssi,device=m.device){
    const event=new Event('advertisementreceived');Object.assign(event,{device,rssi});m.device.dispatchEvent(event);
  }};
}
async function chooseCandidate(h){h.set('assignedCar','S01-A');await h.click('identifyChoose');}

test('MOCK UI unsupported proximity check stays inconclusive and explicitly connects the same candidate for a gated light trial',async()=>{
  const m=mockCar(),storage=memoryStore(),h=harness(m.bluetooth,undefined,'evidence',storage);
  let connects=0;const open=m.device.gatt.connect;m.device.gatt.connect=async()=>{connects++;return open();};
  await chooseCandidate(h);assert.equal(m.choices.length,1);assert.equal(connects,0);assert.equal(m.writes.length,0);
  assert.equal(h.el('rememberCar').disabled,true);await h.click('identifyStart');
  assert.match(h.el('identifyStatus').textContent,/unavailable|unsupported|not supported|does not support|does not provide/i);
  assert.equal(h.el('identifyConnect').disabled,false);await h.click('identifyConnect');
  assert.equal(connects,1);assert.equal(m.choices.length,1);assert.equal(h.el('confirm').disabled,false);
  assert.equal(h.op('engineGreen').disabled,true);assert.equal(h.el('identifySignal').disabled,false);
  const signaling=h.click('identifySignal');await h.tick(2000);await signaling;
  assert.deepEqual(m.writes.map(bytes=>bytes[1]),[0x90,0x33,0x33,0x33,0x90]);
  assert.equal(h.op('engineGreen').disabled,true);assert.equal(h.el('rememberCar').disabled,true);
  await h.click('identifyMatch');assert.match(h.el('trace').textContent,/LIVE identification observation.*operator reports off\/green\/off/);
  assert.equal(new CarLabels(storage).entries().length,0);assert.equal(h.el('rememberCar').disabled,true);
  await h.click('confirm');await h.click('rememberCar');assert.equal(new CarLabels(storage).find(m.device.id).label,'S01-A');
});

test('MOCK UI power-off/on and three near/far cycles retain supporting evidence without auto-connection or enrollment',async()=>{
  const m=mockCar(),radio=advertisements(m),storage=memoryStore(),h=harness(m.bluetooth,undefined,'evidence',storage);
  await chooseCandidate(h);await h.click('identifyStart');assert.equal(radio.watches,1);
  assert.equal(h.el('live').disabled,true);assert.equal(h.el('replay').disabled,true);assert.equal(h.el('identifyConnect').disabled,true);
  const windows=[{ms:5000,rssi:-45},{ms:8000,rssi:null},{ms:8000,rssi:-44},
    {ms:5000,rssi:-40},{ms:5000,rssi:-65},{ms:5000,rssi:-41},{ms:5000,rssi:-66},{ms:5000,rssi:-40},{ms:5000,rssi:-67}];
  for(const {ms,rssi} of windows){
    assert.equal(h.el('identifyNext').disabled,false);await h.click('identifyNext');
    if(rssi!==null){for(let i=0;i<4;i++){await h.tick(200);radio.emit(rssi+i%2);}await h.tick(ms-800);}
    else await h.tick(ms);
  }
  assert.match(h.el('identifyStatus').textContent,/consistent/i);assert.doesNotMatch(h.el('identifyStatus').textContent,/authenticated|ownership verified/i);
  assert.equal(m.device.watchingAdvertisements,false);assert.equal(m.device.gatt.connected,false);assert.equal(m.writes.length,0);
  assert.equal(new CarLabels(storage).entries().length,0);assert.equal(h.el('confirm').disabled,true);assert.equal(h.el('rememberCar').disabled,true);
  assert.match(h.el('trace').textContent,/LIVE identification/);assert.doesNotMatch(h.el('trace').textContent,/REPLAY.*identification/);
  await h.click('identifyConnect');assert.equal(m.choices.length,1);assert.equal(h.op('engineGreen').disabled,true);
});

test('MOCK UI cancels advertisement monitoring on hidden page and ignores a cancelled late picker',async()=>{
  const m=mockCar(),radio=advertisements(m),h=harness(m.bluetooth);
  await chooseCandidate(h);await h.click('identifyStart');await h.click('identifyNext');h.hide();
  assert.equal(m.device.watchingAdvertisements,false);const trace=h.el('trace').textContent;radio.emit(-30);await h.tick(180000);
  assert.equal(h.el('trace').textContent,trace);assert.equal(h.el('identifyNext').disabled,true);assert.equal(m.writes.length,0);
  const gate=deferred(),late=harness({requestDevice:()=>gate.promise});late.set('assignedCar','S02-A');const selecting=late.click('identifyChoose');
  await late.click('identifyCancel');assert.equal(late.el('live').disabled,true);gate.resolve(m.device);await selecting;
  assert.equal(late.el('identifyConnect').disabled,true);assert.equal(late.el('live').disabled,false);assert.equal(m.device.gatt.connected,false);
});

test('MOCK UI candidate selection rejects a saved-label mismatch without monitoring or GATT',async()=>{
  const m=mockCar(),radio=advertisements(m),storage=memoryStore();new CarLabels(storage).remember({name:'Ice Charger',browserId:'my-saved-id'},'S01-A');
  const h=harness(m.bluetooth,undefined,'evidence',storage);await chooseCandidate(h);
  assert.match(h.el('identifyStatus').textContent,/does not match your saved car/);assert.equal(h.el('identifyStart').disabled,true);
  assert.equal(h.el('identifyConnect').disabled,true);assert.equal(radio.watches,0);assert.equal(m.device.gatt.connected,false);assert.equal(m.writes.length,0);
});

test('MOCK UI signal cancellation cannot confirm, persist, or write cleanup onto a later replay session',async()=>{
  const m=mockCar(),storage=memoryStore(),h=harness(m.bluetooth,undefined,'evidence',storage);await chooseCandidate(h);await h.click('identifyConnect');
  const signaling=h.click('identifySignal');await h.tick(100);await h.click('close');await signaling;
  assert.equal(h.el('identifyMatch').disabled,true);assert.equal(h.el('rememberCar').disabled,true);assert.equal(new CarLabels(storage).entries().length,0);
  const writes=m.writes.length;await h.click('replay');await h.tick(20000);assert.equal(m.writes.length,writes);
  assert.equal(h.el('identifySignal').disabled,true);await h.click('battery');assert.match(h.el('batteryResult').textContent,/REPLAY RX: battery 3700 mV/);
});

test('MOCK UI changing the physical label clears a previously selected candidate',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await chooseCandidate(h);h.set('assignedCar','S01-B');
  assert.equal(h.el('identifyConnect').disabled,true);assert.equal(h.el('identifyStart').disabled,true);
  assert.match(h.el('identifySelection').textContent,/No identification candidate/);assert.equal(m.writes.length,0);
});

test('MOCK UI hiding the page interrupts a candidate signal without affecting a later session',async()=>{
  const m=mockCar(),h=harness(m.bluetooth);await chooseCandidate(h);await h.click('identifyConnect');
  const signaling=h.click('identifySignal');await h.tick(600);h.hide();await signaling;
  assert.equal(m.device.gatt.connected,false);assert.equal(h.el('identifyMatch').disabled,true);
  assert.match(h.el('identifyLight').textContent,/Disconnected.*unknown/);
  const writes=m.writes.length;await h.tick(20000);assert.equal(m.writes.length,writes);
});

test('MOCK UI signal trial requires trace headroom before any SDK or light write',async()=>{
  const m=mockCar(),h=harness(m.bluetooth,{maxLines:32,maxChars:2000000,visibleLines:200});
  await chooseCandidate(h);assert.match(h.el('trace').textContent,/LIVE identification browser.*MOCK Chrome/);
  assert.doesNotMatch(h.el('trace').textContent,/not-for-traces|#private/);
  await h.click('identifyConnect');await h.click('identifySignal');
  assert.match(h.el('identifyLight').textContent,/Not enough trace space/);assert.equal(m.writes.length,0);
  assert.equal(h.el('identifyMatch').disabled,true);assert.equal(h.el('rememberCar').disabled,true);
});
