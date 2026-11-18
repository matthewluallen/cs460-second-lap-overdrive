import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Car} from './car.mjs';
import {Pieces} from './track.mjs';
import {encode, TURN} from './protocol.mjs';

const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function position({code=15,offset=-22.5}={}) {
  const p=new Uint8Array(17),v=new DataView(p.buffer);p[0]=16;p[1]=0x27;p[2]=code;p[3]=36;
  v.setFloat32(4,offset,true);v.setUint16(8,300,true);p[10]=7;p[11]=p[12]=255;return p;
}
function rig(profile='sdk') {
  let now=100,receive;
  const radio={initializationProfile:profile,attempted:[],sent:[],onNotify(fn){receive=fn;return()=>{};},close(){radio.closed=true;},emit(p){receive(p);},
    async write(p){radio.attempted.push([...p]);await radio.block?.(p);radio.sent.push([...p]);}};
  const car=new Car(radio,{pieces,clock:()=>now});car.initializing=false;
  return {car,radio,time:t=>{now=t;},async reference(){car.setSpeed(300);await car.pumpPromise;now++;radio.emit(position());await car.pumpPromise;radio.attempted=[];radio.sent=[];}};
}
const lateral=radio=>radio.attempted.filter(p=>[0x25,0x2c,0x32,0x34].includes(p[1]));

test('forward-only maneuver lock preserves printed-code calibration and forward speed without issuing lane or turn intent',async()=>{
  for(const profile of ['sdk','fast-furious']) {
    const {car,radio}=rig(profile);car.lockManeuvers('Supervised forward baseline');
    car.setSpeed(300);radio.emit(position({offset:654321}));await car.pumpPromise;
    car.steerTo(45);car.nudge(-1);car.uturn();
    car.send('lane',encode.changeLane(-45));car.send('lane-offset',encode.setOffset(-22.5));car.send('turn',encode.turn(TURN.UTURN,0));
    car.refreshBattery();await car.pumpPromise;
    assert.deepEqual(lateral(radio),[[...encode.setOffset(-22.5)]],profile);
    assert.equal(car.laneCommandId,0);assert.equal(car.speed,300);assert.equal(car.steeringLocked,false);
    assert.equal(car.diagnostics().maneuversLocked,true);assert.equal(car.diagnostics().maneuverLock.active,true);
    assert.ok(radio.attempted.some(p=>p[1]===0x1a),'ordinary read remains available');
  }
});

test('forward-only lock invalidates dequeued lane preamble, bare lane and turn even when immediately released',async()=>{
  for(const action of ['sdk-pair','bare-lane','turn']) {
    const r=rig(),{car,radio}=r;await r.reference();
    if(action==='sdk-pair')car.steerTo(45);
    if(action==='bare-lane')car.send('custom-lane',encode.changeLane(-45));
    if(action==='turn')car.uturn();
    car.lockManeuvers('baseline');car.unlockManeuvers();await car.pumpPromise;
    assert.deepEqual(lateral(radio),[],action);
    assert.equal(car.maneuversLocked,false);assert.equal(car.forceLane,true);
  }
});

test('forward-only queue clearing retains optical correction behind a stalled read but removes both SDK lane packets',async()=>{
  const r=rig(),{car,radio}=r;await r.reference();let release;
  radio.block=p=>p[1]===0x1a?new Promise(resolve=>release=resolve):undefined;
  car.refreshBattery();await settle();r.time(102);radio.emit(position({offset:654321}));car.steerTo(45);
  assert.ok(car.pending.has('offset'));assert.ok(car.pending.has('lane-offset'));assert.ok(car.pending.has('lane'));
  car.lockManeuvers('baseline');car.unlockManeuvers();release();await car.pumpPromise;
  assert.deepEqual(lateral(radio),[[...encode.setOffset(-22.5)]]);
  assert.equal(car.lastCalibration,102);
});

test('already-entered SDK preamble completes but a new forward-only lock discards its lane request',async()=>{
  const r=rig(),{car,radio}=r;await r.reference();let release;
  radio.block=p=>p[1]===0x2c?new Promise(resolve=>release=resolve):undefined;
  car.steerTo(45);await settle();assert.ok(release);assert.deepEqual(lateral(radio),[[...encode.setOffset(-22.5)]]);
  car.lockManeuvers('baseline');car.unlockManeuvers();release();await car.pumpPromise;
  assert.deepEqual(lateral(radio),[[...encode.setOffset(-22.5)]]);
  assert.deepEqual(radio.sent,lateral(radio),'the entered preamble is not retroactively cancellable');
});

test('strong steering lock and lane cancellation retain their existing protections during a forward-only baseline',async()=>{
  const r=rig(),{car,radio}=r;await r.reference();car.lockManeuvers('baseline');car.lockSteering('Acquisition');
  radio.emit(position({offset:654321}));await car.pumpPromise;assert.deepEqual(lateral(radio),[]);
  car.unlockSteering();r.time(102);radio.emit(position({offset:654321}));await car.pumpPromise;
  assert.deepEqual(lateral(radio),[[...encode.setOffset(-22.5)]]);radio.attempted=[];
  // Native high-bit + zero horizontal speed is cancellation, never completion.
  const cancel=new Uint8Array(15);cancel[0]=14;cancel[1]=0x41;cancel[14]=0x80;radio.emit(cancel);
  car.steerTo(45);await car.pumpPromise;
  assert.equal(car.telemetry.laneChange.cancelled,true);assert.equal(car.maneuversLocked,true);assert.deepEqual(lateral(radio),[]);
});

test('STOP and close clear forward-only state while preserving their stop barrier and invalidating old motion',async()=>{
  for(const action of ['stop','safety-stop','close','connection-loss']) {
    const r=rig(),{car,radio}=r;await r.reference();car.lockManeuvers('baseline');car.forwardBaselineUntil=1000;
    r.time(102);radio.emit(position({offset:654321}));let closing;
    if(action==='stop')car.stop();
    if(action==='safety-stop')car.safetyStop('Test stop');
    if(action==='close')closing=car.close();
    if(action==='connection-loss')car.connectionLost();
    await closing;await car.pumpPromise;
    assert.equal(car.maneuversLocked,false,action);assert.equal(car.forwardBaselineUntil,undefined,action);
    assert.deepEqual(lateral(radio),[],action);assert.equal(car.diagnostics().maneuverLock.active,false,action);
    if(action!=='connection-loss')assert.ok(radio.attempted.some(p=>p[1]===0x24 && p[2]===0 && p[3]===0),action);
  }
});

test('forward-only positive speed expires at the transport boundary even before the scheduled stop can run',async()=>{
  for(const delayed of [false,true]) {
    const {car,radio,time}=rig();let release;
    if(delayed){radio.block=p=>p[1]===0x1a?new Promise(resolve=>release=resolve):undefined;car.refreshBattery();await settle();}
    car.lockManeuvers('baseline');car.forwardBaselineUntil=200;car.setSpeed(300);time(200);
    release?.();await car.pumpPromise;
    assert.equal(radio.attempted.some(p=>p[1]===0x24 && (p[2] || p[3])),false);
    assert.ok(radio.attempted.some(p=>p[1]===0x24 && !p[2] && !p[3]));
    assert.equal(car.faulted,true);assert.equal(car.connected,false);assert.equal(car.forwardBaselineUntil,undefined);
    assert.match(car.telemetry.lastWriteFailure.error,/baseline expired/);
  }
});

test('leaving forward-only mode requires a fresh explicit lane request and a stopped restart does not inherit its deadline',async()=>{
  const r=rig(),{car,radio}=r;await r.reference();car.lockManeuvers('baseline');car.forwardBaselineUntil=200;
  car.steerTo(45);car.unlockManeuvers();await car.pumpPromise;assert.deepEqual(lateral(radio),[]);
  car.steerTo(45);await car.pumpPromise;
  assert.deepEqual(lateral(radio),[[...encode.setOffset(-22.5)],[...encode.changeLane(-45,350,1000,1)]]);
  car.stop();await car.pumpPromise;radio.attempted=[];r.time(300);car.setSpeed(150);await car.pumpPromise;
  assert.equal(car.faulted,false);assert.ok(radio.attempted.some(p=>p[1]===0x24 && p[2]===150));
});
