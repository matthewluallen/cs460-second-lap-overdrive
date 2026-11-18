import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Car} from './car.mjs';
import {Pieces, POSITION_MAX_AGE_MS} from './track.mjs';
import {encode} from './protocol.mjs';

const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function position({piece=36,code=15,speed=300,offset=-22.5}={}) {
  const b=new Uint8Array(17),v=new DataView(b.buffer);b[0]=16;b[1]=0x27;b[2]=code;b[3]=piece;
  v.setFloat32(4,offset,true);v.setUint16(8,speed,true);b[10]=7;b[11]=b[12]=255;return b;
}
function rig(profile='sdk',options={}) {
  let now=100,receive;
  const radio={initializationProfile:profile,sent:[],onNotify(fn){receive=fn;return()=>{};},close(){},emit(b){receive(b);},
    async write(b){await radio.block?.(b);radio.sent.push([...b]);}};
  const car=new Car(radio,{pieces,clock:()=>now,...options});car.initializing=false;
  return {car,radio,time:t=>{now=t;},async reference(){car.setSpeed(300);await car.pumpPromise;now++;radio.emit(position());await car.pumpPromise;radio.sent=[];}};
}
const lateral=radio=>radio.sent.filter(b=>[0x25,0x2c].includes(b[1]));

test('physical SDK and F&F lane calls refuse initial, operator-only and missing geometry references',async()=>{
  for(const profile of ['sdk','fast-furious'])for(const state of ['initial','operator','no-pieces']){
    const r=rig(profile,state==='no-pieces'?{pieces:undefined}:{}),{car,radio}=r;
    if(state==='operator'){car.calibrateScanStart(22.5);await car.pumpPromise;radio.sent=[];}
    car.setSpeed(300);await car.pumpPromise;if(state==='no-pieces')radio.emit(position());
    car.steerTo(45);await car.pumpPromise;
    assert.equal(lateral(radio).length,0,profile+'/'+state);assert.equal(car.laneCommandId,0);
    assert.match(car.diagnostics().steeringBlocked.reason,/printed|reference|geometry/i);
  }
});

test('physical steering needs fresh optical data in the current motion epoch, not speed or transition telemetry',async()=>{
  for(const state of ['expired','future','stopped','recovered','delocalized','recovery','off-track','unknown','special','zero-speed','new-map','pre-motion']){
    const r=rig(),{car,radio}=r;await r.reference();
    if(state==='expired')r.time(102+POSITION_MAX_AGE_MS);
    if(state==='future')r.time(100);
    if(state==='stopped'){car.stop();car.setSpeed(300);}
    if(state==='recovered')car.recover();
    if(state==='delocalized')radio.emit(Uint8Array.of(1,0x2b));
    if(state==='recovery')radio.emit(Uint8Array.of(1,0x43));
    if(state==='off-track')radio.emit(Uint8Array.of(5,0x3f,0,0,0,0));
    if(state==='unknown')radio.emit(position({code:255}));
    if(state==='special')radio.emit(position({piece:57}));
    if(state==='zero-speed')radio.emit(position({speed:0}));
    if(state==='new-map')car.useTrack(null);
    if(state==='pre-motion'){car.stop();radio.emit(position());r.time(102);car.setSpeed(300);}
    // Neither message provides a printed-code lateral reference.
    radio.emit(Uint8Array.of(7,0x36,44,1,232,3,44,1));
    radio.emit(Uint8Array.of(17,0x29,0,0,0,0,0,0,255,255,0,0,44,1,0,0,0,0));
    await car.pumpPromise;radio.sent=[];car.steerTo(45);await car.pumpPromise;
    assert.equal(lateral(radio).length,0,state);assert.equal(car.laneCommandId,0,state);
  }
});

test('valid ordinary code authorizes exact SDK offset/lane bytes and fresh optical reacquisition after STOP',async()=>{
  const r=rig(),{car,radio}=r;await r.reference();car.steerTo(45);await car.pumpPromise;
  assert.deepEqual(lateral(radio),[[...encode.setOffset(-22.5)],[...encode.changeLane(-45,350,1000,1)]]);
  car.stop();car.recover();await r.reference();car.steerTo(-22.5);await car.pumpPromise;
  assert.deepEqual(lateral(radio),[[...encode.setOffset(-22.5)],[...encode.changeLane(22.5,350,1000,2)]]);
  assert.equal(car.telemetry.steeringBlocked,null);
});

test('queued physical lane pair rechecks reference age and invalidation before entering the radio',async()=>{
  for(const state of ['expired','loss','new-position']){
    const r=rig(),{car,radio}=r;await r.reference();let release;
    radio.block=b=>b[1]===0x1a?new Promise(resolve=>{release=resolve;}):undefined;
    car.refreshBattery();await settle();car.steerTo(45);
    if(state==='expired')r.time(102+POSITION_MAX_AGE_MS);
    if(state==='loss')radio.emit(Uint8Array.of(1,0x43));
    if(state==='new-position'){r.time(102);radio.emit(position({code:18,offset:-13.5}));}
    release();await car.pumpPromise;
    assert.equal(lateral(radio).length,0,state);assert.match(car.telemetry.steeringBlocked.reason,/reference|printed/i);
  }
});

test('new physical guard leaves ordinary scan calibration and simulated lane transport behavior intact',async()=>{
  const r=rig();r.radio.emit(position({offset:654321}));await r.car.pumpPromise;
  assert.deepEqual(lateral(r.radio),[[...encode.setOffset(-22.5)]],'scan calibration does not need an existing lane reference');
  for(const [profile,simulated] of [[null,false],['simulator',false],['sdk',true]]){
    const {car,radio}=rig(profile,{simulated});car.steerTo(45);await car.pumpPromise;
    assert.equal(radio.sent.filter(b=>b[1]===0x25).length,1);
  }
});
