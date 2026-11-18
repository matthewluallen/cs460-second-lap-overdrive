import test from 'node:test';
import assert from 'node:assert/strict';
import {Recorder, TRACE_FORMAT, validate} from './trace.mjs';
import {decode, encode, hex, ID} from './protocol.mjs';
import {readFileSync} from 'node:fs';
import {summarizeTrace} from './tools/inspect_trace.mjs';

// Hand-written native-layout examples, not observations from physical hardware.
test('supercode diagnostics preserve unsigned code and raw tag without inventing position', () => {
  const packets = Uint8Array.of(6,0x4f,0x78,0x56,0x34,0xf2,0xff,6,0x53,4,3,2,1,0x80,1,0x2b);
  const [a,b,c] = decode(packets);
  assert.equal(a.type,'supercode'); assert.equal(a.code,0xf2345678); assert.equal(a.rawTag,255);
  assert.equal(b.type,'zoneSupercode'); assert.equal(b.code,0x01020304); assert.equal(b.rawTag,128);
  assert.equal(a.pieceId,undefined); assert.equal(b.pieceId,undefined); assert.equal(c.type,'delocalized');
});

test('short supercodes retain raw bytes and do not discard a following stop event', () => {
  for (const id of [0x4f,0x53]) for (let size=1;size<6;size++) {
    const p = new Uint8Array(size+3);p[0]=size;p[1]=id;p[size+1]=1;p[size+2]=0x2b;
    assert.deepEqual(decode(p).map(m=>m.type),['other','delocalized']);
  }
});

test('recordings distinguish empty, mixed and real sessions and retain firmware replies', () => {
  const r = new Recorder(()=>0), real={car:{name:'Car',model:1,simulated:false,version:null}}, sim={car:{simulated:true}};
  r.start([]);assert.equal(r.toJSON().source,'unknown');
  r.start([real,sim]);assert.equal(r.toJSON().source,'mixed');
  real.car.tap('rx',Uint8Array.of(3,0x19,0x34,0x12));assert.equal(r.toJSON().cars[0].firmware,0x1234);
  r.stop();real.car.tap('rx',Uint8Array.of(3,0x19,0,0));assert.equal(r.toJSON().cars[0].firmware,0x1234);
  r.start([real]);assert.equal(r.toJSON().source,'hardware');
});

test('trace report keeps separate car and message identities, counting malformed notifications', () => {
  const trace={format:TRACE_FORMAT,source:'hardware',cars:[{name:'Same'},{name:'Same'}],events:[
    [0,0,'rx','06 4f 04 03 02 01 80'],[1,0,'rx','06 53 04 03 02 01 80'],
    [2,1,'rx','06 53 04 03 02 01 80'],[3,0,'rx','06 53 04 03 02 01 80'],
    [4,0,'rx','06 53'],[5,0,'tx','01 16'],[6,1,'rx','03 19 34 12']]};
  const out=summarizeTrace(trace);assert.equal(out.physicalValidation,false);
  assert.equal(out.cars[0].supercodes.length,2);assert.equal(out.cars[0].supercodes[1].count,2);
  assert.equal(out.cars[1].supercodes[0].count,1);assert.equal(out.cars[1].firmware,0x1234);
  assert.equal(out.cars[0].malformedNotifications,1);assert.equal(out.cars[0].tx,1);
});

test('negative trace times cannot be replayed as valid capture events', () => {
  assert.throws(()=>validate({format:TRACE_FORMAT,cars:[{}],events:[[-.5,0,'rx','01 17']]}));
});

test('callbacks from an earlier recording cannot contaminate a new session', () => {
  const r=new Recorder(()=>0), a={car:{name:'A',simulated:false}}, b={car:{name:'B',simulated:true}};
  r.start([a]); const oldTap=a.car.tap; r.stop(); r.start([b]);r.add(b);
  oldTap('rx',Uint8Array.of(1,0x17));
  b.car.tap('rx',Uint8Array.of(1,0x17));
  assert.equal(r.toJSON().cars.length,1);assert.equal(r.toJSON().events.length,1);
  assert.equal(r.toJSON().cars[0].name,'B');assert.equal(r.toJSON().source,'simulator');
});


const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name+'.json',import.meta.url)));
const traceOf=(events,cars=[{}])=>({format:TRACE_FORMAT,cars,events});
const positionPacket=()=>{const p=new Uint8Array(17),v=new DataView(p.buffer);p[0]=16;p[1]=ID.POSITION;p[2]=5;p[3]=33;v.setFloat32(4,-22.5,true);v.setUint16(8,300,true);return p;};
const transitionPacket=(left=7,right=37,offset=654321)=>{const p=new Uint8Array(18),v=new DataView(p.buffer);p[0]=17;p[1]=ID.TRANSITION;v.setFloat32(4,offset,true);p[16]=left;p[17]=right;return p;};
const packed=(...packets)=>Uint8Array.from(packets.flatMap(p=>[...p]));
const event=(at,car,dir,packet)=>[at,car,dir,hex(packet)];

test('acquisition report distinguishes the failed cold scan from the successful optical scan without diagnosing a physical cause',()=>{
  const failed=summarizeTrace(fixture('groundshock-sdk-cold-curve-scan-no-position'));
  const successful=summarizeTrace(fixture('groundshock-sdk-repaired-scan'));
  const failedCar=failed.cars[0],goodCar=successful.cars[0],a=failedCar.acquisition.intervals[0],b=goodCar.acquisition.intervals[0];
  assert.equal(failed.physicalValidation,false);assert.match(failedCar.acquisition.limitation,/not physical motion/);
  assert.equal(failedCar.acquisition.intervalCount,1);assert.equal(goodCar.acquisition.intervalCount,1);
  assert.deepEqual([a.startMs,a.stopRequestedMs,a.initialRequestedSpeedMmS,a.positiveSpeedCommandCount],[25104,29504,300,1]);
  assert.equal(a.firstRawPositionFrame,null);assert.equal(a.firstDecodedPosition,null);assert.equal(a.firstRawPositionAfterTransition,null);
  assert.deepEqual(a.firstTransition,{atMs:26431,afterStartMs:1327});
  assert.deepEqual([a.rawPositionFrames,a.positions,a.transitions,a.unknownOffsetTransitions,a.offsetCommands,a.lateralCommands],[0,0,3,3,0,0]);
  assert.deepEqual(a.transitionSamples.map(s=>[s.leftCm,s.rightCm,s.offsetMm]),[[24,28,654321],[7,37,654195],[0,21,654195]]);
  assert.deepEqual([failedCar.acquisition.rawTransitionFrames,failedCar.acquisition.unknownOffsetTransitions],[4,4]);
  assert.deepEqual([a.lateTrack.transitions,a.lateTrack.positions,a.lateTrack.unknownOffsetTransitions],[1,0,1]);
  assert.deepEqual(a.lateTrack.samples,[{type:'transition',atMs:121177,afterStopMs:91673,offsetMm:654231,offsetKnown:false,leftCm:3,rightCm:235}]);
  assert.deepEqual([b.startMs,b.initialRequestedSpeedMmS,b.positions,b.offsetCommands,b.lateralCommands],[22328,300,24,1,0]);
  assert.deepEqual(b.firstRawPositionFrame,{atMs:23146,afterStartMs:818,decoded:true,afterFirstTransitionMs:null});
  assert.deepEqual(b.firstTransition,{atMs:23206,afterStartMs:878});
  assert.deepEqual(b.firstRawPositionAfterTransition,{atMs:23896,afterStartMs:1568,decoded:true,afterTransitionMs:690});
  assert.equal(b.transitionSamples.length,8);assert.equal(b.transitionSamplesOmitted,4);assert.equal(b.lateTrack.samples.length,0);
  assert.equal(failedCar.messages.position,undefined);assert.equal(failedCar.messages.transition,4,'existing summary counts remain unchanged');
});

test('command intervals keep cars and repeated runs separate and never attribute pre-start readings or commands to a later run',()=>{
  const p=positionPacket(),t=transitionPacket();
  const out=summarizeTrace(traceOf([
    event(0,0,'rx',p),event(1,0,'tx',encode.speed(0)),event(2,0,'rx',t),event(3,0,'tx',encode.setOffset(0)),
    event(4,0,'tx',encode.speed(300)),event(4,1,'rx',p),event(5,1,'tx',encode.speed(200)),
    event(6,0,'rx',t),event(7,1,'rx',p),event(8,0,'tx',encode.speed(150)),event(9,0,'rx',p),
    event(10,0,'tx',encode.speed(0)),event(11,0,'rx',t),event(12,1,'tx',encode.speed(0)),
    event(13,0,'tx',encode.turn()),event(14,0,'tx',encode.speed(250)),event(15,0,'rx',p),
    event(16,0,'tx',encode.changeLane(22.5)),event(17,0,'tx',encode.setOffset(-22.5)),event(18,0,'tx',encode.cancelLaneChange())
  ],[{name:'Same'},{name:'Same'}]));
  const first=out.cars[0].acquisition,other=out.cars[1].acquisition;
  assert.equal(first.intervalCount,2);assert.equal(other.intervalCount,1);assert.equal(first.trackMessagesOutsideIntervals,2);
  assert.equal(first.offsetCommandsOutsideIntervals,1);assert.equal(first.lateralCommandsOutsideIntervals,1);
  const [a,b]=first.intervals;
  assert.deepEqual([a.startMs,a.stopRequestedMs,a.positiveSpeedCommandCount,a.initialRequestedSpeedMmS,a.latestRequestedSpeedMmS,a.maximumRequestedSpeedMmS],[4,10,2,300,150,300]);
  assert.deepEqual(a.firstRawPositionFrame,{atMs:9,afterStartMs:5,decoded:true,afterFirstTransitionMs:3});
  assert.deepEqual(a.firstRawPositionAfterTransition,{atMs:9,afterStartMs:5,decoded:true,afterTransitionMs:3});
  assert.deepEqual([a.positions,a.transitions,a.lateTrack.transitions,a.lateralCommands,a.offsetCommands],[1,1,1,0,0]);
  assert.deepEqual([b.startMs,b.stopRequestedMs,b.positions,b.transitions,b.lateralCommands,b.offsetCommands],[14,null,1,0,2,1]);
  assert.equal(b.firstRawPositionFrame.afterFirstTransitionMs,null);assert.equal(b.firstRawPositionAfterTransition,null);
  assert.equal(other.trackMessagesOutsideIntervals,1);assert.equal(other.intervals[0].firstRawPositionFrame.atMs,7);
  assert.equal(other.intervals[0].lateTrack.samples.length,0);
});

test('packed notification order, raw undecodable positions and malformed TX cannot manufacture a STOP or lose a valid following command',()=>{
  const shortPosition=Uint8Array.of(1,ID.POSITION),shortStop=Uint8Array.of(1,ID.SPEED);
  const negativeSpeed=Uint8Array.of(6,ID.SPEED,255,255,0xe8,3,0);
  const invalidOffset=Uint8Array.of(5,ID.SET_OFFSET,0,0,0xc0,0x7f); // NaN, not a usable reference
  const t=transitionPacket(),p=positionPacket();
  const out=summarizeTrace(traceOf([
    event(0,0,'rx',p),event(0,0,'tx',negativeSpeed),event(0,0,'tx',encode.speed(300)),
    event(1,0,'rx',packed(t,shortPosition,p)),
    event(2,0,'tx',packed(shortStop,invalidOffset,encode.changeLane(22.5))),
    [3,0,'tx','06 24 00'], // truncated alleged STOP is not a STOP
    event(3,0,'tx',negativeSpeed),
    event(4,0,'tx',packed(encode.speed(150),encode.speed(0),encode.speed(250))),
    event(5,0,'rx',packed(p,t)),event(6,0,'tx',encode.speed(0)),event(7,0,'rx',packed(p,t))
  ]));
  const car=out.cars[0],report=car.acquisition,[a,b]=report.intervals;
  assert.equal(report.malformedCommandFrames,3);assert.equal(report.unsupportedSpeedCommands,2);assert.equal(a.unsupportedSpeedCommands,1);assert.equal(report.intervalCount,2);assert.equal(report.trackMessagesOutsideIntervals,1);
  assert.deepEqual([a.startMs,a.stopRequestedMs,a.rawPositionFrames,a.positions,a.lateralCommands,a.offsetCommands,a.positiveSpeedCommandCount],[0,4,2,1,1,0,2]);
  assert.deepEqual(a.firstRawPositionFrame,{atMs:1,afterStartMs:1,decoded:false,afterFirstTransitionMs:0});
  assert.equal(a.firstDecodedPosition.pieceId,33);assert.equal(car.messages.other,1);
  assert.deepEqual([b.startMs,b.stopRequestedMs,b.initialRequestedSpeedMmS],[4,6,250]);
  assert.equal(b.unsupportedSpeedCommands,0);
  assert.equal(b.firstRawPositionFrame.afterFirstTransitionMs,null,'within a packed frame, the position arrived before the transition');
  assert.equal(b.firstRawPositionAfterTransition,null,'a later position after STOP does not become an in-interval position');
  assert.deepEqual([b.lateTrack.positions,b.lateTrack.transitions],[1,1]);
  assert.equal(car.malformedNotifications,0,'malformed commands remain separate from malformed notifications');
});

test('acquisition output bounds intervals and samples while retaining counts and preventing omitted runs from contaminating earlier samples',()=>{
  const events=[];let at=0;
  for(let run=0;run<40;run++) {
    events.push(event(at++,0,'tx',encode.speed(300)));
    for(let i=0;i<12;i++)events.push(event(at++,0,'rx',transitionPacket(i,i+1)));
    events.push(event(at++,0,'tx',encode.speed(0)));
    for(let i=0;i<11;i++)events.push(event(at++,0,'rx',transitionPacket(i,i+2)));
  }
  const report=summarizeTrace(traceOf(events)).cars[0].acquisition;
  assert.deepEqual(report.limits,{intervals:32,transitionSamples:8,lateTrackSamples:8});
  assert.equal(report.intervalCount,40);assert.equal(report.intervals.length,32);assert.equal(report.intervalsOmitted,8);
  assert.equal(report.rawTransitionFrames,40*23);assert.equal(report.unknownOffsetTransitions,40*23);
  for(const interval of report.intervals) {
    assert.equal(interval.transitions,12);assert.equal(interval.transitionSamples.length,8);assert.equal(interval.transitionSamplesOmitted,4);
    assert.equal(interval.lateTrack.transitions,11);assert.equal(interval.lateTrack.samples.length,8);assert.equal(interval.lateTrack.samplesOmitted,3);
    assert.equal(interval.lateTrack.lastAtMs-interval.stopRequestedMs,11);
  }
});
