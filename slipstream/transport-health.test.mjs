import test from 'node:test';
import assert from 'node:assert/strict';
import {Car} from './car.mjs';
import {encode} from './protocol.mjs';

const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function rig(options={}) {
  let time=0,receive;const writes=[];
  const link={onNotify(fn){receive=fn;return()=>{};},async write(b){writes.push([...b]);},close(){this.closed=true;},...options};
  const car=new Car(link,{clock:()=>time,writeTimeoutMs:1000});
  return {car,link,writes,at(v){time=v;},emit(b){receive(Uint8Array.from(b));}};
}
test('complete off-road prefix survives a malformed coalesced tail without accepting position evidence',()=>{
  const r=rig(),seen=[];r.car.on(m=>seen.push(m.type));
  r.emit([1,0x2b,10,0x27,1]);
  assert.deepEqual(seen,['delocalized']);assert.equal(r.car.delocalized,true);
  assert.equal(r.car.telemetry.malformed,1);assert.equal(r.car.lastTrackAt,undefined);
});
test('malformed leading frame is never scanned for guessed safety or position messages',()=>{
  const r=rig(),seen=[];r.car.on(m=>seen.push(m.type));r.emit([30,0x27,1,0x2b]);
  assert.deepEqual(seen,[]);assert.equal(r.car.lastTrackAt,undefined);
});
test('expired write resolution records completion and attempts STOP before closing',async()=>{
  let release,calls=0;const r=rig({write(b){r.writes.push([...b]);if(calls++===0)return new Promise(resolve=>{release=resolve;});return Promise.resolve();}});
  const events=[];r.car.tap=(direction,b)=>events.push([direction,b[1],b[2]+256*b[3]]);
  r.car.setSpeed(300);await flush();r.at(1001);release();await r.car.pumpPromise;
  assert.equal(r.car.connected,false);assert.equal(r.car.tx,2);
  assert.deepEqual(events,[['tx',0x24,300],['tx',0x24,0]]);
  assert.deepEqual(r.writes.map(b=>[b[1],b[2]+256*b[3]]),[[0x24,300],[0x24,0]]);
  assert.equal(r.car.diagnostics().transportHealth.timeouts,1);
  assert.equal(r.car.diagnostics().transportHealth.completed,2); // late speed completion and fail-safe STOP
  assert.equal(r.car.diagnostics().transportHealth.lateCompletions,1);
  assert.equal(r.car.diagnostics().transportHealth.maxCompletedApiMs,1001);
});
test('late initialization pong cannot beat its overdue timeout callback',async()=>{
  const r=rig({initializationProfile:'sdk',initializationTimeoutMs:20,
    async write(b){if(b[1]===0x16){r.at(21);r.emit([1,0x17]);}else if(b[1]===0x18)r.emit([3,0x19,0x5a,0x2e]);}});
  await r.car.start();assert.equal(r.car.connected,false);assert.match(r.car.initializationStatus,/timed out/);
});
test('queue diagnostics distinguish coalescing, in-flight age and completed API time',async()=>{
  let release;const r=rig();r.link.write=b=>{r.writes.push([...b]);return new Promise(resolve=>{release=resolve;});};
  r.car.send('battery',encode.battery());await flush();r.at(10);r.car.setSpeed(300);r.at(20);r.car.setSpeed(400);r.at(40);
  let h=r.car.diagnostics().transportHealth;
  assert.equal(h.coalesced,1);assert.equal(h.pendingCount,1);assert.equal(h.pendingAgeMs,20);assert.equal(h.inFlightAgeMs,40);
  release();await flush();h=r.car.diagnostics().transportHealth;
  assert.equal(h.completed,1);assert.equal(h.lastCompletedApiMs,40);assert.equal(h.lastQueueWaitMs,20);
  release();await r.car.pumpPromise;
});
test('settled failures preserve initiating opcode even when fail-safe STOP rejects',async()=>{
  const r=rig({async write(){throw new Error('radio unavailable');}});
  r.car.send('battery',encode.battery());await r.car.pumpPromise;
  const d=r.car.diagnostics();assert.equal(d.transportHealth.failed,2);
  assert.equal(d.firstWriteFailure.id,0x1a);assert.equal(d.lastWriteFailure.id,0x24);
});

test('STOP queue age includes waiting behind an existing write',async()=>{
  let release;const r=rig();let first=true;
  r.link.write=()=>{if(first){first=false;return new Promise(resolve=>{release=resolve;});}return Promise.resolve();};
  r.car.refreshBattery();await flush();r.at(100);r.car.stop();r.at(500);
  assert.equal(r.car.diagnostics().transportHealth.pendingAgeMs,400);
  release();await r.car.pumpPromise;
  assert.equal(r.car.diagnostics().transportHealth.lastQueueWaitMs,400);
});
test('no completion or in-flight API duration is claimed before transport entry',async()=>{
  const r=rig();r.car.refreshBattery();
  assert.equal(r.car.diagnostics().transportHealth.maxCompletedApiMs,null);
  assert.equal(r.car.diagnostics().transportHealth.inFlightAgeMs,null);
  await r.car.pumpPromise;
});

test('aligned complete safety prefixes keep their standalone meaning before malformed tails',()=>{
  const cancelled=[14,0x41,...Array(12).fill(0),0x80];
  for(const packet of [[1,0x2b],[1,0x43],cancelled,[3,0x4d,1,0],[5,0x3f,0,0,0,0],[5,0x3f,1,1,0,0],[5,0x3f,1,0,1,0]]){
    const a=rig(),b=rig(),standalone=[],mixed=[];a.car.on(m=>standalone.push(m));b.car.on(m=>mixed.push(m));
    a.emit(packet);b.emit([1,0x17,...packet,10,0x27,1]);
    assert.deepEqual(mixed,standalone);assert.equal(b.car.telemetry.lastPongAt,undefined);
    assert.equal(b.car.lastTrackAt,undefined);assert.equal(b.car.telemetry.malformed,1);
  }
});
test('malformed notifications never establish ordinary telemetry or confirm initialization',()=>{
  const prefixes=[[1,0x17],[3,0x19,0x5a,0x2e],
    [10,0x27,1,39,0,0,0,0,0x2c,1,0],
    [17,0x29,...Array(16).fill(0)],[5,0x3f,1,0,0,0]];
  for(const packet of prefixes){const r=rig(),seen=[];r.car.on(m=>seen.push(m));r.emit([...packet,20,0x27,1]);
    assert.deepEqual(seen,[]);assert.equal(r.car.lastTrackAt,undefined);assert.equal(r.car.version,null);
    assert.equal(r.car.firmwareInitialization,null);assert.equal(r.car.opticalCalibrationReference,null);
  }
});
