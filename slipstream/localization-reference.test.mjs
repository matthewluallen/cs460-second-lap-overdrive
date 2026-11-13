import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Car} from './car.mjs';
import {Pieces,Localizer,Track,traversal} from './track.mjs';
import {buildTrack,LAYOUTS} from './sim.mjs';
import {ID} from './protocol.mjs';

const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
const track=buildTrack(pieces,LAYOUTS.Capsule);
const optical={type:'position',pieceId:34,locationId:20,reverse:false,speed:300};
const transition=()=>Uint8Array.from([17,ID.TRANSITION,0,0,0,0,0,0,255,255,0,0,44,1,0,0,0,0]);
const status=onTrack=>Uint8Array.from([5,ID.STATUS,onTrack?1:0,0,0,1]);
function position({piece=34,location=20,reverse=false}={}){
  const bytes=new Uint8Array(17),v=new DataView(bytes.buffer);bytes[0]=16;bytes[1]=ID.POSITION;
  bytes[2]=location;bytes[3]=piece;v.setFloat32(4,22.5,true);v.setUint16(8,300,true);
  bytes[10]=reverse?0x47:7;bytes[11]=bytes[12]=255;return bytes;
}
function rig(){
  let now=0,notify;const radio={onNotify(fn){notify=fn;return()=>{};},async write(){},close(){},emit:p=>notify(p)};
  const car=new Car(radio,{pieces,clock:()=>now});car.useTrack(track);
  return {car,radio,time:t=>{now=t;}};
}
const located=(car,now)=>!!car.pose(now)?.located;

test('transition messages cannot renew the freshness of the last uniquely identified optical position',()=>{
  const localizer=new Localizer(track,pieces);localizer.feed(optical,100);
  assert.equal(localizer.estimate(100)?.located,true);
  localizer.feed({type:'transition'},1100);localizer.feed({type:'transition'},2100);
  assert.equal(!!localizer.estimate(2101)?.located,false,'optical reference is older than two seconds despite a recent transition');
  localizer.feed({type:'transition'},3100);
  assert.equal(!!localizer.estimate(3100)?.located,false,'more transitions cannot restore an expired reference');
  localizer.feed({...optical,pieceId:39,locationId:30},3200);
  assert.equal(localizer.estimate(3200)?.located,true,'a new unique optical code can establish location again');
});

test('negative on-track status invalidates location immediately; status true, pings and transitions do not restore it',()=>{
  const {car,radio,time}=rig();time(100);radio.emit(position());assert.equal(located(car,100),true);
  time(150);radio.emit(status(false));assert.equal(located(car,150),false,'firmware off-track status overrides a recent position');
  for(const [at,packet] of [[200,status(true)],[250,Uint8Array.from([1,ID.PING_REPLY])],[300,transition()]]){
    time(at);radio.emit(packet);assert.equal(located(car,at),false,'non-optical packet cannot re-establish location');
  }
  time(400);radio.emit(position());assert.equal(located(car,400),true);
});

test('delocalization, recovery entry and invalid optical codes discard the reference until a new valid code',()=>{
  const invalidators=[
    ['delocalized',Uint8Array.from([1,ID.DELOCALIZED])],
    ['recovery entered',Uint8Array.from([1,ID.DELOC_RECOVERY_ENTERED])],
    ['invalid location code',position({location:255})],
    ['unknown piece',position({piece:200})],
  ];
  for(const [label,packet] of invalidators){
    const {car,radio,time}=rig();time(100);radio.emit(position());assert.equal(located(car,100),true);
    time(150);radio.emit(packet);assert.equal(located(car,150),false,label);
    time(200);radio.emit(Uint8Array.from([1,ID.DELOC_RECOVERY_SUCCEEDED]));radio.emit(status(true));radio.emit(transition());
    assert.equal(located(car,200),false,label+' must not regain trust through recovery/status/transition messages');
    time(300);radio.emit(position());assert.equal(located(car,300),true,label+' can reacquire from a new valid optical code');
  }
});

test('diagnostics identify the observed reference and distinguish confirmed, estimated, stale and ambiguous locations',()=>{
  for(const reverse of [false,true]){
    const {car,radio,time}=rig();time(100);radio.emit(position({reverse}));time(150);
    const confirmed=car.diagnostics().localization;
    assert.equal(confirmed.state,'confirmed');assert.equal(confirmed.trusted,true);
    assert.deepEqual(confirmed.reference,{source:'printed-code',pieceId:34,locationId:20,reverse,
      index:0,direction:reverse?-1:1,at:100,ageMs:50,fresh:true,unverified:false});
    time(200);radio.emit(transition());const estimated=car.diagnostics().localization;
    assert.equal(estimated.state,'estimated');assert.equal(estimated.trusted,true);
    assert.equal(estimated.reference.at,100,'transition must not replace the optical reference timestamp');
    assert.equal(estimated.reference.pieceId,34);assert.equal(estimated.reference.locationId,20);
    time(2101);radio.emit(transition());const stale=car.diagnostics().localization;
    assert.equal(stale.state,'stale');assert.equal(stale.trusted,false);
    assert.equal(stale.reference.ageMs,2001);assert.equal(stale.reference.fresh,false);
    time(2200);radio.emit(Uint8Array.from([1,ID.DELOCALIZED]));const lost=car.diagnostics().localization;
    assert.equal(lost.state,'unknown');assert.equal(lost.trusted,false);assert.equal(lost.reference,null);
    assert.equal(typeof lost.reason,'string');
  }
  const {car,radio,time}=rig();
  car.useTrack(new Track([traversal(pieces,34,false),traversal(pieces,39,false),traversal(pieces,34,false)]));
  time(100);radio.emit(position());const ambiguous=car.diagnostics().localization;
  assert.equal(ambiguous.state,'ambiguous');assert.equal(ambiguous.trusted,false);
  assert.equal(ambiguous.reference.source,'printed-code');assert.equal(ambiguous.reference.pieceId,34);
  assert.equal(ambiguous.reference.index,null);assert.equal(ambiguous.reference.direction,null);
  assert.equal(ambiguous.reference.fresh,true);
  car.useTrack(null);assert.deepEqual(car.diagnostics().localization,{state:'unknown',trusted:false,reason:'No map',reference:null});
});

test('operator placement and simulator seeds are not mislabeled as observed optical references',async()=>{
  const {car,time}=rig();time(100);car.calibrateScanStart(-22.5);await car.pumpPromise;
  assert.equal(car.diagnostics().localization.reference,null,'entering a starting lane is not an optical reading');
  car.localizer.seed(0,1,100);
  const seeded=car.diagnostics().localization.reference;
  assert.equal(seeded.source,'simulator-seed');assert.equal(seeded.locationId,null);
});

test('late optical data cannot restore the displayed location through an off-track latch',async()=>{
  const {car,radio,time}=rig();time(100);radio.emit(position());car.safetyStop('Off track');
  time(150);radio.emit(position());assert.equal(car.diagnostics().localization.trusted,false);
  assert.equal(car.diagnostics().localization.reference,null);assert.equal(located(car,150),false);
  assert.equal(car.recover(),true);assert.equal(car.diagnostics().localization.trusted,false,'recovery alone is not an optical reading');
  time(200);radio.emit(position());assert.equal(car.diagnostics().localization.trusted,true);
  await car.pumpPromise;
});

test('a duplicate road code after optical expiry cannot revive an old uniquely located candidate',()=>{
  const repeated=new Track([34,18,39,18].map(id=>traversal(pieces,id,false)));
  for(const transitionAfterExpiry of [false,true]){
    const localizer=new Localizer(repeated,pieces);
    localizer.feed(optical,100);
    const duplicate={...optical,pieceId:18,locationId:9};
    localizer.feed(duplicate,200);
    assert.deepEqual(localizer.candidates,[{index:1,direction:1}]);
    assert.equal(localizer.diagnostics(2201).trusted,false);
    if(transitionAfterExpiry)localizer.feed({type:'transition'},2400);
    localizer.feed(duplicate,10000);
    assert.deepEqual(localizer.candidates,[{index:1,direction:1},{index:3,direction:1}],
      'expired route context cannot choose between two occurrences of road 18');
    assert.equal(localizer.estimate(10000)?.located,false);
    assert.equal(localizer.diagnostics(10000).state,'ambiguous');
    assert.equal(localizer.diagnostics(10000).reference.index,null);
    assert.equal(localizer.laps,0);
  }
});

test('an unexpected fresh road code cannot create a lap while re-localizing across the map boundary',()=>{
  const route=new Track([34,18,39].map(id=>traversal(pieces,id,false)));
  for(const next of [
    {pieceId:18,locationId:9,index:1,laps:0},
    {pieceId:34,locationId:20,index:0,laps:0}
  ]){
    const localizer=new Localizer(route,pieces);
    localizer.feed({...optical,pieceId:39,locationId:30},100);
    assert.equal(localizer.index,2);
    localizer.feed({...optical,pieceId:next.pieceId,locationId:next.locationId},200);
    assert.equal(localizer.index,next.index);
    assert.equal(localizer.laps,next.laps,
      'neither a contradictory code nor the initial partial wrap earns a completed lap');
  }
});

test('laps require a complete optically identified circuit after the initial boundary crossing',()=>{
  const route=new Track([34,18,39].map(id=>traversal(pieces,id,false)));
  const code={34:20,18:9,39:30};
  for(const direction of [1,-1]) {
    const l=new Localizer(route,pieces);let at=0,notified=0;l.onLap=()=>notified++;
    const feed=id=>l.feed({...optical,pieceId:id,locationId:code[id],reverse:direction<0},at+=100);
    const cycle=direction>0?[39,34,18,39,34]:[34,39,18,34,39];
    feed(cycle[0]);feed(cycle[1]);assert.equal(l.laps,0,'first crossing establishes the start');
    for(const id of cycle.slice(2))feed(id);
    assert.equal(l.laps,1);assert.equal(notified,1);
    l.feed({type:'delocalized'},at+=100);
    for(const id of cycle.slice(0,2))feed(id);
    assert.equal(l.laps,1,'recovery crossing is not another completed circuit');
  }
  const l=new Localizer(route,pieces);let at=0;
  const feed=id=>l.feed({...optical,pieceId:id,locationId:code[id]},at+=100);
  feed(39);feed(34);l.feed({type:'transition'},at+=100);l.feed({type:'transition'},at+=100);feed(39);feed(34);
  assert.equal(l.laps,0,'transition-only passage through road18 cannot earn an optically verified circuit');
});
