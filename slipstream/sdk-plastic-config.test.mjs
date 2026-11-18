import test from 'node:test';
import assert from 'node:assert/strict';
import {Car} from './car.mjs';
import {initializationPhases} from './initialization.mjs';
import {hex, ID} from './protocol.mjs';

// Independent C oracle: tools/sdk_vectors.c, compiled with manufacturer SDK
// revision410352617b8660338746a6bb2b2dd173afb1b91a, emits these literal bytes.
// Compiling source establishes packet layout, not11866 setting acceptance.
const PLASTIC='03 45 00 00';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function rig({profile='sdk',options={plasticTrack:true},autoReply=false,missingConfigPong=false,missingVersion=false,failConfig=false}={}) {
  let notify,pings=0;
  const radio={initializationProfile:profile,initializationOptions:options,initializationTimeoutMs:40,sent:[],onNotify(fn){notify=fn;return()=>{};},close(){radio.closed=true;},
    emit(bytes){notify(Uint8Array.from(bytes));},async write(bytes){
      radio.sent.push([...bytes]);await radio.block?.(bytes);
      if(bytes[1]===ID.CONFIG && failConfig)throw new Error('Injected configuration write failure');
      if(bytes[1]===ID.PING){pings++;if(autoReply && !(missingConfigPong && pings===2))queueMicrotask(()=>radio.emit([1,ID.PING_REPLY]));}
      if(bytes[1]===ID.VERSION && autoReply && !missingVersion)queueMicrotask(()=>radio.emit([5,ID.VERSION_REPLY,0x5a,0x2e,0,0]));
      if(bytes[1]===0x49 && autoReply)queueMicrotask(()=>radio.emit([3,0x23,255,255]));
    }};
  const car=new Car(radio);return {car,radio};
}
const positive=radio=>radio.sent.some(p=>p[1]===ID.SPEED && (p[2] || p[3]));

test('default SDK sequence and all existing F&F phases remain unchanged without explicit plastic opt-in',()=>{
  const sdk=initializationPhases('sdk');
  assert.deepEqual(sdk.map(p=>({packets:p.packets.map(hex),reply:p.reply})),[
    {packets:['06 24 00 00 c4 09 00','03 90 01 01'],reply:'ping'},
    {packets:['01 18'],reply:'version'}]);
  assert.deepEqual(initializationPhases('sdk',{plasticTrack:false}),sdk);
  assert.deepEqual(initializationPhases('fast-furious',{plasticTrack:false}),initializationPhases('fast-furious'));
  assert.deepEqual(initializationPhases('fast-furious').flatMap(p=>p.packets).map(hex),[
    '06 24 00 00 c4 09 00','03 90 00 00','01 18','02 22 01',PLASTIC,'01 21',
    '13 46 01 02 01 3e 01 44 00 00 00 00 00 00 00 00 00 00 00 00',
    '13 48 01 0d 8a 0a 0a 0a 0a 0a 0b 0a 0a 4a 4b 4b 80 00 00 00',
    '08 49 01 10 00 01 02 00 0d','03 37 00 00','06 24 00 00 c4 09 00']);
});

test('explicit SDK plastic phase matches the independently compiled C vector between SDK and version barriers',()=>{
  const phases=initializationPhases('sdk',{plasticTrack:true});
  assert.equal(phases.length,3);assert.deepEqual(phases[1].packets.map(hex),[PLASTIC]);assert.equal(phases[1].reply,'ping');
  assert.equal(phases[0].packets[1][1],ID.SDK_MODE);assert.equal(phases[2].packets[0][1],ID.VERSION);
  assert.equal(phases.flatMap(p=>p.packets).some(p=>[0x35,0x37,0x2c].includes(p[1])),false);
});

test('plastic option accepts literal booleans only and is refused on other initialization profiles',()=>{
  for(const plasticTrack of ['true',1,{},null])assert.throws(()=>initializationPhases('sdk',{plasticTrack}),/boolean|literal|true/i);
  assert.throws(()=>initializationPhases('fast-furious',{plasticTrack:true}),/SDK|sdk/);
});

test('SDK plastic diagnostic completes only after its ping and never asserts that firmware applied the setting',async()=>{
  const {car,radio}=rig();const ready=car.start();
  try {
    await settle();assert.deepEqual(radio.sent.map(hex),['06 24 00 00 c4 09 00','03 90 01 01','01 16']);
    assert.deepEqual(car.diagnostics().sdkPlasticTrack,{requested:true,sequenceComplete:false,firmwareApplied:null});
    radio.emit([1,ID.PING_REPLY]);await settle();
    assert.deepEqual(radio.sent.slice(-2).map(hex),[PLASTIC,'01 16']);assert.equal(car.diagnostics().sdkPlasticTrack.sequenceComplete,false);
    assert.equal(radio.sent.some(p=>p[1]===ID.VERSION),false,'version cannot pass config barrier');
    radio.emit([1,ID.PING_REPLY]);await settle();
    assert.equal(car.diagnostics().sdkPlasticTrack.sequenceComplete,true);assert.equal(car.initializing,true);
    assert.equal(hex(radio.sent.at(-1)),'01 18');
    radio.emit([5,ID.VERSION_REPLY,0x5a,0x2e,0,0]);await ready;await car.pumpPromise;
    assert.equal(car.initializing,false);assert.equal(car.faulted,false);assert.equal(positive(radio),false);
    assert.equal(car.diagnostics().sdkPlasticTrack.firmwareApplied,null);
    car.connectionLost();assert.equal(car.diagnostics().sdkPlasticTrack.sequenceComplete,false);
  } finally {radio.emit([1,ID.PING_REPLY]);radio.emit([5,ID.VERSION_REPLY,0x5a,0x2e,0,0]);await car.close();await ready;}
});

test('an early pong cannot confirm a queued plastic phase before its own ping enters the transport',async()=>{
  const {car,radio}=rig();let release;
  radio.block=p=>p[1]===ID.CONFIG?new Promise(resolve=>release=resolve):undefined;
  const ready=car.start();
  try {
    await settle();radio.emit([1,ID.PING_REPLY]);await settle();assert.ok(release);
    radio.emit([1,ID.PING_REPLY]);await settle();
    assert.equal(car.diagnostics().sdkPlasticTrack.sequenceComplete,false);assert.equal(radio.sent.some(p=>p[1]===ID.VERSION),false);
    release();await settle();assert.equal(hex(radio.sent.at(-1)),'01 16');
    assert.equal(car.diagnostics().sdkPlasticTrack.sequenceComplete,false);
    radio.emit([1,ID.PING_REPLY]);await settle();radio.emit([5,ID.VERSION_REPLY,0x5a,0x2e,0,0]);await ready;await car.pumpPromise;
    assert.equal(car.diagnostics().sdkPlasticTrack.sequenceComplete,true);
  } finally {release?.();radio.emit([1,ID.PING_REPLY]);radio.emit([5,ID.VERSION_REPLY,0x5a,0x2e,0,0]);await car.close();await ready;}
});

test('optional phase failure or later initialization failure closes stopped without a completed-setting claim',async()=>{
  for(const fault of ['missing-pong','write-failure','missing-version']) {
    const {car,radio}=rig({autoReply:true,missingConfigPong:fault==='missing-pong',failConfig:fault==='write-failure',missingVersion:fault==='missing-version'});
    const ready=car.start();car.setSpeed(300);car.steerTo(45);await ready;await car.pumpPromise;
    assert.equal(car.faulted,true,fault);assert.equal(car.connected,false,fault);assert.equal(positive(radio),false,fault);
    assert.deepEqual(car.diagnostics().sdkPlasticTrack,{requested:true,sequenceComplete:false,firmwareApplied:null},fault);
    if(fault!=='missing-version')assert.equal(radio.sent.some(p=>p[1]===ID.VERSION),false,fault);
  }
});

test('explicit STOP during opted-in initialization remains latched after configuration completes',async()=>{
  const {car,radio}=rig({autoReply:true});const ready=car.start();car.safetyStop('Host stopped');await ready;await car.pumpPromise;
  car.setSpeed(300);car.steerTo(45);await car.pumpPromise;
  assert.equal(car.connected,true);assert.equal(car.speed,0);assert.equal(car.safetyReason,'Host stopped');assert.equal(positive(radio),false);
  assert.deepEqual(car.diagnostics().sdkPlasticTrack,{requested:true,sequenceComplete:true,firmwareApplied:null});
});

test('ordinary SDK connection reports no plastic request and does not send the optional packet',async()=>{
  const {car,radio}=rig({options:{},autoReply:true});await car.start();await car.pumpPromise;
  assert.equal(radio.sent.some(p=>p[1]===ID.CONFIG),false);
  assert.deepEqual(car.diagnostics().sdkPlasticTrack,{requested:false,sequenceComplete:false,firmwareApplied:null});
});
