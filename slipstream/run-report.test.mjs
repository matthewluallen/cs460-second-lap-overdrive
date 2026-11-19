import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildRunReport,renderRunReportText,RUN_REPORT_SCHEMA} from './run-report.mjs';
import {encode,hex} from './protocol.mjs';

function position(speed=300,piece=39,code=1){
  const b=new Uint8Array(11),v=new DataView(b.buffer);b[0]=10;b[1]=0x27;b[2]=code;b[3]=piece;v.setFloat32(4,0,true);v.setUint16(8,speed,true);return hex(b);
}
const tx=(t,speed,car=0)=>[t,car,'tx',hex(encode.speed(speed))];
const rx=(t,speed=300,car=0)=>[t,car,'rx',position(speed)];
const trace=(events,extra={})=>({format:'slipstream-trace-v1',recorded:'2026-11-18T20:00:00Z',cars:[{driverId:7,name:'Guardian',model:4,simulated:true,profile:'sdk',firmware:11866}],events,dropped:0,markers:[],markersDropped:0,...extra});

test('retained Guardian scan and forward laps report excludes the long parked telemetry interval',()=>{
  const source=JSON.parse(readFileSync(new URL('./fixtures/guardian-sdk-three-forward-laps-2026-11-18.json',import.meta.url))),before=JSON.stringify(source);
  const result=buildRunReport(source),guardian=result.cars.find(c=>c.driverId===4);
  assert.equal(result.schema,RUN_REPORT_SCHEMA);assert.equal(result.coverage.processedEvents,184);assert.equal(result.source,'hardware');
  assert.equal(guardian.name,'Guardian');assert.equal(guardian.firmware,11866);assert.equal(guardian.events.positions,67);
  assert.equal(guardian.commandedWindows.count,2);assert.equal(guardian.commandedWindows.closedByStop,2);assert.equal(guardian.positionGaps.samples,65);
  assert.equal(guardian.positionGaps.maxMs,1290);assert.equal(guardian.requestedSpeed.max,300);
  assert.equal(guardian.controllerLaps.count,3);assert.match(guardian.controllerLaps.source,/controller-reported/);
  assert.equal(result.track.pieceCount,7);assert.equal(guardian.stop.physicalStopVerified,false);
  assert.equal(result.cars.find(c=>c.driverId===2).controllerLaps,null,'final Guardian snapshot is not attached by array position');
  assert.equal(JSON.stringify(source),before,'report never mutates evidence');
  const output=renderRunReportText(result);assert.match(output,/Physical stop: unverified/);assert.match(output,/OPERATOR OBSERVATIONS \(unverified/);
});

test('only same-window optical gaps enter the histogram; first reading and tail silence are separate',()=>{
  const r=buildRunReport(trace([tx(0,300),rx(100),[300,0,'rx','01 29'],rx(600),rx(2600),tx(3000,0),rx(9000,0),tx(10000,600),rx(10100,580),tx(10200,0)]));
  const c=r.cars[0];assert.equal(c.positionGaps.samples,2);assert.equal(c.positionGaps.maxMs,2000);
  assert.deepEqual(c.positionGaps.buckets.map(b=>b.count),[0,1,0,1,0]);
  assert.equal(c.commandedWindows.maximumFirstPositionDelayMs,100);assert.equal(c.commandedWindows.maximumTailSilenceMs,400);
  assert.equal(c.commandedWindows.observedDurationMs,3200);assert.equal(c.events.positionsOutsideCommands,1);
});

test('silent and unfinished command windows remain visible without invented position gaps or stop proof',()=>{
  const r=buildRunReport(trace([tx(10,300),tx(5010,0),tx(6000,300),[7000,0,'rx','01 17']])),c=r.cars[0];
  assert.equal(c.commandedWindows.withoutPosition,2);assert.equal(c.commandedWindows.openAtEnd,1);assert.equal(c.positionGaps.samples,0);
  assert.equal(c.positionGaps.maxMs,null);assert.equal(c.commandedWindows.maximumFirstPositionDelayMs,null);
  assert.match(r.warnings.join(' '),/no recorded following STOP/);assert.equal(c.stop.physicalStopVerified,false);
});

test('multiple cars have independent requested speeds, windows, positions and controller lap evidence',()=>{
  const r=buildRunReport(trace([tx(0,300),tx(10,600,1),rx(100),rx(200,580,1),rx(700),tx(800,0),rx(1200,600,1),tx(1300,0,1)],{
    cars:[{driverId:7,name:'One',simulated:true},{driverId:9,name:'Two',simulated:false}],
    diagnostics:{cars:[{carId:9,name:'Guardian',model:4,firmware:11866,requestedSpeed:0,reportedSpeed:600,reportedSpeedAgeMs:8500}],round:{rows:[{id:9,laps:2},{id:7,laps:0}]}}
  }));
  assert.equal(r.source,'mixed');assert.equal(r.cars[0].requestedSpeed.max,300);assert.equal(r.cars[1].requestedSpeed.max,600);
  assert.equal(r.cars[0].positionGaps.maxMs,600);assert.equal(r.cars[1].positionGaps.maxMs,1000);
  assert.equal(r.cars[0].controllerLaps.count,0);assert.equal(r.cars[1].controllerLaps.count,2);
  assert.equal(r.cars[1].finalSnapshot.reportedSpeedAgeMs,8500);assert.equal(r.cars[0].finalSnapshot,null);
});

test('clock discontinuities split windows and cannot produce cross-epoch gaps or an elapsed-time claim',()=>{
  const r=buildRunReport(trace([tx(1000,300),rx(1100),rx(1500),rx(100),tx(200,300),rx(300),rx(600),tx(700,0)])),c=r.cars[0];
  assert.equal(r.coverage.clockDiscontinuities,1);assert.equal(r.coverage.elapsedMs,null);assert.equal(c.commandedWindows.splitByClock,1);
  assert.equal(c.events.positionsOutsideCommands,1);assert.equal(c.positionGaps.samples,2);assert.equal(c.positionGaps.maxMs,400);
  assert.match(r.warnings.join(' '),/time moved backwards/);
});

test('malformed records, dropped data and unsupported negative speed commands are disclosed',()=>{
  const negative=new Uint8Array([6,0x24,255,255,232,3,0]);
  const r=buildRunReport(trace([null,[0,50,'rx',position()],tx(1,300),[2,0,'rx','ff 27'],[3,0,'rx','0a 27 00'],[4,0,'tx',hex(negative)],rx(10),tx(20,0)],{dropped:4,markersDropped:2}));
  assert.equal(r.coverage.invalidEvents,2);assert.equal(r.cars[0].events.malformedPackets,3);assert.equal(r.cars[0].requestedSpeed.min,0);
  assert.equal(r.coverage.droppedEvents,4);assert.match(r.warnings.join(' '),/coverage is partial/);assert.match(r.warnings.join(' '),/Invalid events/);
  assert.equal(buildRunReport({}).coverage.droppedEvents,null,'missing is not zero');
});

test('snapshot-only reports retain observation ages but do not manufacture packets, laps or physical acceptance',()=>{
  const r=buildRunReport({diagnostics:{cars:[{carId:2,name:'Guardian',model:4,firmware:11866,requestedSpeed:0,reportedSpeed:300,reportedSpeedAgeMs:10000,physicalStopVerified:true}],trackChecks:{pieceCount:11,geometricClosure:true,physicalValidation:true,special:[{id:57}]},operatorNotes:'I saw it stop.'}});
  assert.equal(r.cars[0].snapshotOnly,true);assert.equal(r.cars[0].events.positions,0);assert.equal(r.cars[0].controllerLaps,null);
  assert.equal(r.cars[0].stop.physicalStopVerified,false);assert.equal(r.track.physicalValidation,false);
  assert.equal(r.track.pieceCount,11);assert.deepEqual(r.track.specialPieceIds,[57]);assert.match(r.warnings.join(' '),/No recorded packet evidence/);
  assert.match(renderRunReportText(r),/report age 10.00 s/);assert.match(renderRunReportText(r),/I saw it stop/);
});

test('report uses allowlisted identity and policy fields and never exports connection secrets or raw frames',()=>{
  const r=buildRunReport(trace([tx(0,300),rx(10),tx(20,0)],{hostKey:'DO-NOT-EXPORT',joinKey:'ALSO-SECRET',cars:[{driverId:7,name:'<b>Guardian</b>',model:4,simulated:true,deviceId:'PRIVATE-ID',transport:{url:'https://private.invalid'}}],
    diagnostics:{driving:{maximumSpeed:900,rampMs:2000,telemetryGraceMs:1000,powerZoneMode:'boost',secret:'PRIVATE-SETTING'},cars:[{carId:7,name:'<img src=x>',physicalStopVerified:true,bluetoothId:'PRIVATE-BLUETOOTH'}],operatorNotes:'<script>observation</script>'}}));
  const json=JSON.stringify(r),out=renderRunReportText(r);
  for(const secret of ['DO-NOT-EXPORT','ALSO-SECRET','PRIVATE-ID','private.invalid','PRIVATE-SETTING','PRIVATE-BLUETOOTH',hex(encode.speed(300))]){assert.equal(json.includes(secret),false);assert.equal(out.includes(secret),false);}
  assert.equal(r.policies.maximumSpeed,900);assert.equal(r.policies.rampMs,2000);
  assert.match(out,/<script>observation<\/script>/,'output is explicitly plain text; host must use textContent rather than HTML');
});

test('speed-update notifications are not mixed into optical-position speed averages',()=>{
  const speed=new Uint8Array([7,0x36,44,1,232,3,54,1]);
  const r=buildRunReport(trace([tx(0,300),rx(100,290),[110,0,'rx',hex(speed)],tx(120,0)])),c=r.cars[0];
  assert.equal(c.reportedPositionSpeed.samples,1);assert.equal(c.reportedPositionSpeed.mean,290);
  assert.equal(c.reportedSpeedUpdates.samples,1);assert.equal(c.reportedSpeedUpdates.mean,310);
  assert.equal(c.requestedSpeed.mean,150,'command sample mean is not a time-weighted speed');
});


test('duplicate recording driver IDs cannot duplicate final snapshot identity or lap claims',()=>{
  const r=buildRunReport(trace([tx(0,300),tx(0,300,1),rx(50),tx(100,0)],{
    cars:[{driverId:7,name:'Old',simulated:false},{driverId:7,name:'Other',simulated:false}],
    diagnostics:{phase:'ready',halted:true,pitReason:'Guardian: telemetry timeout',cars:[{carId:7,name:'Guardian',firmware:11866}],round:{rows:[{id:7,laps:3}]}}
  }));
  assert.equal(r.cars.length,3);assert.equal(r.cars[0].name,'Old');assert.equal(r.cars[1].name,'Other');
  assert.equal(r.cars[0].controllerLaps,null);assert.equal(r.cars[1].controllerLaps,null);assert.equal(r.cars[2].snapshotOnly,true);
  assert.equal(r.cars[2].controllerLaps.count,3);assert.match(r.warnings.join(' '),/Duplicate recording driver IDs/);
  assert.match(renderRunReportText(r),/shared pit: Guardian: telemetry timeout/);
});
