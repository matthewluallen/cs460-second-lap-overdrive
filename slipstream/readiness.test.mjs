import test from 'node:test';
import assert from 'node:assert/strict';
import {drivingReadiness} from './readiness.mjs';
const driver=(id,control='browser',extra={})=>({id,control,pad:null,car:{name:'Car '+id,connected:true,simulated:true,...extra}});
const game=(drivers=[])=>({drivers,track:{},halted:true,phase:'ready'});
test('readiness names the unapproved phone without hiding other ready cars',()=>{
 const g=game([driver(1),driver(2,'phone')]);const r=drivingReadiness(g);
 assert.equal(r.ready,false);assert.deepEqual(r.blockers,['Car 2: waiting for a phone. Scan its QR and choose Let in on this laptop.']);
 g.drivers[1].pad={};assert.equal(drivingReadiness(g).ready,true);
});
test('readiness explains every existing host gate and preserves parked/disconnected behavior',()=>{
 for(const patch of [{track:null},{pitReason:'Car 1 telemetry timeout'},{phase:'scanning'},{diagnostic:{}},{forwardBaseline:{}},{laneCancellationComparison:{}}]){
  const r=drivingReadiness({...game([driver(1)]),...patch});assert.equal(r.ready,false);assert.ok(r.blockers.length);
 }
 assert.equal(drivingReadiness(game([driver(1)]),{countdown:{}}).ready,false);
 for(const patch of [{initializing:true},{faulted:true},{safetyReason:'Off track'}])assert.equal(drivingReadiness(game([driver(1,'browser',patch)])).ready,false);
 assert.equal(drivingReadiness(game([driver(1,'browser',{safetyReason:'Host stopped'})])).ready,true);
 assert.match(drivingReadiness(game([driver(1,'none')])).blockers.join(' '),/parked/);
 assert.match(drivingReadiness(game([driver(1,'browser',{connected:false})])).blockers.join(' '),/disconnected/);
 assert.equal(drivingReadiness(game([driver(1),driver(2,'browser',{connected:false})])).ready,true,'a disconnected inactive car did not gate the existing host');
});
test('battery and identity reminders are explicit observations, not new arming rules',()=>{
 const d=driver(1,'browser',{simulated:false,model:0,millivolts:null});const r=drivingReadiness(game([d]),{now:40000});
 assert.equal(r.ready,true);assert.equal(r.notes.length,2);
 assert.equal(drivingReadiness({...game([d]),halted:false}).state,'enabled');
 assert.equal(drivingReadiness({...game([d]),halted:false}).ready,false);
});
