import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Car} from './car.mjs';
import {Pieces, POSITION_MAX_AGE_MS} from './track.mjs';
import {encode} from './protocol.mjs';

const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function position({piece=36,code=15,offset=654321}={}) {
  const p=new Uint8Array(17),v=new DataView(p.buffer);p[0]=16;p[1]=0x27;p[2]=code;p[3]=piece;
  v.setFloat32(4,offset,true);v.setUint16(8,300,true);p[10]=7;p[11]=p[12]=255;return p;
}
function rig() {
  let now=100,receive;
  const radio={initializationProfile:'sdk',attempted:[],sent:[],onNotify(fn){receive=fn;return()=>{};},close(){},emit(p){receive(p);},
    async write(p){radio.attempted.push([...p]);await radio.block?.(p);radio.sent.push([...p]);}};
  const car=new Car(radio,{pieces,clock:()=>now});car.initializing=false;
  return {car,radio,time:t=>{now=t;}};
}
const offsets=radio=>radio.attempted.filter(p=>p[1]===0x2c);

for(const queued of [false,true]) {
  test('automatic calibration rechecks the optical observation '+(queued?'behind an in-flight read':'before its transport microtask'),async()=>{
    for(const state of ['unknown-code','special-piece','new-measured-code']) {
      const {car,radio,time}=rig();let release;
      if(queued){radio.block=p=>p[1]===0x1a?new Promise(resolve=>release=resolve):undefined;car.refreshBattery();await settle();}
      radio.emit(position());assert.equal(offsets(radio).length,0);
      time(101);
      if(state==='unknown-code')radio.emit(position({code:255}));
      if(state==='special-piece')radio.emit(position({piece:57}));
      if(state==='new-measured-code')radio.emit(position({code:18,offset:-13.5}));
      release?.();await car.pumpPromise;
      assert.deepEqual(offsets(radio),[],state);
    }
  });
  test('discarded calibration does not throttle the newest needed correction '+(queued?'in the queue':'at the transport boundary'),async()=>{
    const {car,radio,time}=rig();let release;
    if(queued){radio.block=p=>p[1]===0x1a?new Promise(resolve=>release=resolve):undefined;car.refreshBattery();await settle();}
    radio.emit(position());time(200);radio.emit(position({code:18}));
    release?.();await car.pumpPromise;
    assert.deepEqual(offsets(radio),[[...encode.setOffset(-13.5)]],'only the current code supplies a reference');
    assert.equal(car.lastCalibration,200,'the throttle starts when a correction enters the transport');
    assert.equal(car.lastPair,null,'a written reference is still not a measured offset');
  });
}

test('loss, recovery, track replacement, expiry and STOP invalidate unsent automatic calibration',async()=>{
  for(const state of ['delocalized','recovery','off-track','map','recover','expired','stop','close']) {
    const {car,radio,time}=rig();radio.emit(position());let closing;
    if(state==='delocalized')radio.emit(Uint8Array.of(1,0x2b));
    if(state==='recovery')radio.emit(Uint8Array.of(1,0x43));
    if(state==='off-track')radio.emit(Uint8Array.of(5,0x3f,0,0,0,0));
    if(state==='map')car.useTrack(null);
    if(state==='recover')car.recover();
    if(state==='expired')time(101+POSITION_MAX_AGE_MS);
    if(state==='stop')car.stop();
    if(state==='close')closing=car.close();
    await closing;await car.pumpPromise;assert.deepEqual(offsets(radio),[],state);
  }
});

test('unchanged optical scan calibration and explicit operator calibration remain available while stopped',async()=>{
  const {car,radio}=rig();radio.emit(position());await car.pumpPromise;
  assert.deepEqual(offsets(radio),[[...encode.setOffset(-22.5)]]);
  assert.equal(car.speed,0,'scan bootstrap does not require a prior moving lane reference');
  radio.attempted=[];car.calibrateScanStart(45);radio.emit(position({piece:57}));await car.pumpPromise;
  assert.deepEqual(offsets(radio),[[...encode.setOffset(-45)]],'operator calibration is an explicit separate command');
});

test('an automatic calibration already inside the transport cannot be cancelled retroactively',async()=>{
  const {car,radio,time}=rig();let release;
  radio.block=p=>p[1]===0x2c?new Promise(resolve=>release=resolve):undefined;
  radio.emit(position());await settle();assert.equal(offsets(radio).length,1);assert.ok(release);
  assert.equal(car.lastCalibration,100);time(200);radio.emit(position({code:18}));
  assert.equal(car.lastPair,null,'in-flight calibration cannot fabricate an observed offset');
  radio.emit(position({piece:57}));release();await car.pumpPromise;
  assert.deepEqual(offsets(radio),[[...encode.setOffset(-22.5)]]);
  assert.deepEqual(radio.sent,offsets(radio));
});
