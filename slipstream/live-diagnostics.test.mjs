import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Car} from './car.mjs';
import {decode} from './protocol.mjs';
import {Recorder,ReplayCar,validate} from './trace.mjs';
const bytes=s=>Uint8Array.from(s.split(' ').map(x=>parseInt(x,16)));
function rig(){let now=0,notify;const r={sent:[],onNotify(fn){notify=fn;},write:async b=>r.sent.push([...b]),close(){},emit:b=>notify(b)};return {r,c:new Car(r,{clock:()=>now}),time:t=>now=t};}
test('real Groundshock lane report exposes unknown offset without satisfying watchdog or reporting movement',()=>{
 const trace=JSON.parse(readFileSync(new URL('./fixtures/groundshock-app-init-timeout.json',import.meta.url)));
 const r=new ReplayCar(trace,0),c=new Car(r,{clock:()=>70000});r.advance(70000);
 const d=c.diagnostics();assert.equal(d.laneChange.currentOffset,654321);assert.equal(d.laneChange.targetOffset,654321);
 assert.equal(d.laneChange.offsetKnown,false);assert.equal(d.positions,0);assert.equal(c.lastTrackAt,undefined);assert.equal(c.lastPosition,undefined);
 assert.equal(d.counts['0x41/15'],1);
});
test('malformed and unknown packets remain diagnostic only; notification and position ages differ',()=>{
 const {r,c,time}=rig();time(100);r.emit(bytes('07 29 00 10 bf 1f 49 00'));time(200);r.emit(bytes('04 27 00'));
 time(400);const d=c.diagnostics();assert.equal(d.unknown,1);assert.equal(d.malformed,1);assert.equal(d.notificationAgeMs,200);assert.equal(d.positionAgeMs,null);assert.equal(c.lastTrackAt,undefined);
 for(const value of [NaN,Infinity]){const p=bytes('0e 41 00 00 00 00 00 00 00 00 00 00 00 00 00');new DataView(p.buffer).setFloat32(2,value,true);assert.equal(decode(p)[0].type,'other');}
 assert.equal(decode(bytes('01 41'))[0].type,'other');
});
test('explicit scan calibration sends a bounded offset while stopped without inventing position telemetry',async()=>{
 const {r,c}=rig();c.calibrateScanStart(22.5);await c.pumpPromise;
 assert.equal(r.sent[0][1],0x2c);assert.equal(new DataView(Uint8Array.from(r.sent[0]).buffer).getFloat32(2,true),-22.5);
 assert.equal(c.startingCalibration.source,'operator');assert.equal(c.startingCalibration.signVerified,false);
 assert.equal(c.lastTrackAt,undefined);assert.equal(c.lastPosition,undefined);assert.equal(c.speed,0);
 for(const invalid of [NaN,Infinity,69,-69,'0'])assert.throws(()=>c.calibrateScanStart(invalid));
 c.setSpeed(100);assert.throws(()=>c.calibrateScanStart(0),/Stop/);await c.pumpPromise;c.safetyStop('Host stopped');assert.throws(()=>c.calibrateScanStart(0),/Stop/);await c.pumpPromise;
});
test('live exports preserve profile, bounded annotations and replay compatibility without stopping capture',()=>{
 const {r,c}=rig();r.initializationProfile='fast-furious';const rec=new Recorder(()=>10);rec.start([{car:c}]);
 rec.mark('scan-start',{startingLateral:22.5});r.emit(bytes('01 17'));
 for(let i=0;i<1005;i++)rec.mark('observation',{i});
 const snapshot=JSON.parse(JSON.stringify(rec.toJSON()));assert.equal(rec.active,true);assert.equal(snapshot.cars[0].profile,'fast-furious');assert.equal(snapshot.markers.length,1000);assert.equal(snapshot.markersDropped,6);assert.equal(validate(snapshot),snapshot);
 r.emit(bytes('01 17'));assert.equal(snapshot.events.length,1);assert.equal(rec.events.length,2);
});

test('Power Zone observations remain bounded diagnostics and never refresh track watchdog',()=>{
 const {r,c,time}=rig();time(100);
 for(let i=0;i<200;i++)r.emit(bytes('06 53 f9 75 00 00 01'));
 r.emit(bytes('06 4f db 27 00 00 02'));
 const d=c.diagnostics();assert.equal(d.zoneCodes,200);assert.equal(d.supercodes,1);
 assert.deepEqual(d.lastSpecialCode,{type:'supercode',code:0x27db,rawTag:2,at:100});
 assert.equal(c.lastTrackAt,undefined);assert.equal(c.lastPosition,undefined);
 assert.equal(c.speed,0);assert.equal(r.sent.length,0);assert.equal(d.physicalStopVerified,false);
});

test('native delocalization recovery packets remain diagnostic and never restart motion',()=>{
 const {r,c,time}=rig();time(100);r.emit(bytes('01 43'));time(200);r.emit(bytes('01 44'));
 assert.equal(decode(bytes('01 43'))[0].type,'delocRecoveryEntered');
 assert.equal(decode(bytes('01 44'))[0].type,'delocRecoverySucceeded');
 assert.equal(decode(bytes('02 43 00'))[0].type,'other');
 const d=c.diagnostics();assert.equal(d.recoveryEntered,1);assert.equal(d.recoverySucceeded,1);
 assert.equal(d.lastRecoveryEvent.type,'delocRecoverySucceeded');assert.equal(c.lastTrackAt,undefined);
 assert.equal(c.speed,0);assert.equal(r.sent.length,0);
});
