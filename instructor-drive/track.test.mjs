import test from 'node:test';
import assert from 'node:assert/strict';
import {TrackRecorder} from './track.mjs';

// All packet builders and loops in this file are SYNTHETIC SIMULATION fixtures.
// They are not captured radio evidence and do not establish physical-car behavior.
function position(id,{location=7,flags=0,offset=0,speed=100}={}){
  const b=Uint8Array.of(16,0x27,location,id,0,0,0,0,0,0,flags,11,12,0x34,0x12,0x78,0x56);
  const v=new DataView(b.buffer);v.setFloat32(4,offset,true);v.setUint16(8,speed,true);return b;
}
function transition({left=56,right=56,current=-1,previous=-2,offset=0,up=0,down=0}={}){
  const b=Uint8Array.of(17,0x29,current&255,previous&255,0,0,0,0,3,4,0x34,0x12,0xfb,1,up,down,left,right);
  new DataView(b.buffer).setFloat32(4,offset,true);return b;
}
function recorder(options={}){
  const r=new TrackRecorder(options);r.start({mode:'SIMULATION',physicalLabel:'SYNTHETIC-A',browserId:'simulation-only',firmware:11866});return r;
}
function tile(r,id,{turn=null,flags=0,...rest}={}){
  r.ingest(position(id,{flags}));
  return r.ingest(transition({left:turn==='R'?48:turn==='L'?40:56,right:turn==='R'?40:turn==='L'?48:56,...rest}));
}
// A start straight, two right curves, another straight, then two right curves.
// The second start optical half is merged, and a later start closes the loop.
function oval(r,{start=34,finish=33,curve=17,straight=36,flags=0}={}){
  tile(r,start,{flags});tile(r,finish,{flags});
  tile(r,curve,{turn:'R',flags});tile(r,curve,{turn:'R',flags});tile(r,straight,{flags});
  tile(r,curve,{turn:'R',flags});tile(r,curve,{turn:'R',flags});return tile(r,start,{flags});
}

test('synthetic loop completion requires a later start and closes position plus heading',()=>{
  const r=recorder();const result=oval(r);
  assert.equal(result.status,'COMPLETE');assert.equal(result.mode,'SIMULATION');
  assert.equal(result.pieces.length,6);assert.deepEqual(result.pieces[0].observedIds,[34,33]);
  assert.equal(result.returnAnchor.pieceId,34);
  assert.deepEqual(result.geometry.path.at(-1),{xMm:0,yMm:0,heading:0});
  assert.match(result.geometry.basis,/inferred.*physical layout unverified/);
  assert.ok(result.warnings.some(s=>s.includes('SIMULATION')));
  assert.ok(result.warnings.some(s=>s.includes('One observed loop')));
});

test('opposite start-half order is merged and reverse parsing is not reverse driving',()=>{
  const result=oval(recorder(),{start:33,finish:34,flags:0x40});
  assert.equal(result.status,'COMPLETE');assert.deepEqual(result.pieces[0].observedIds,[33,34]);
  assert.equal(result.pieces[1].reverseParsing,true);assert.equal(result.pieces[1].turn,'R');
});

test('left-hand loop uses measured wheel asymmetry, not the parsing flag',()=>{
  const r=recorder();tile(r,34);
  tile(r,17,{turn:'L'});tile(r,18,{turn:'L'});tile(r,36);
  tile(r,20,{turn:'L'});tile(r,23,{turn:'L'});
  const result=tile(r,34);
  assert.equal(result.status,'COMPLETE');assert.equal(result.pieces[1].turn,'L');
  assert.deepEqual(result.geometry.path.at(-1),{xMm:0,yMm:0,heading:0});
});

test('position and transition decode official byte offsets including signed drift and indexes',()=>{
  const r=recorder();r.ingest(position(39,{flags:0x8b,offset:-22.5,speed:65500}));
  r.ingest(transition({offset:12.5,current:-1,previous:-128,left:42,right:34,up:8,down:9}));
  const [p,t]=r.snapshot().observations;
  assert.equal(p.pieceId,39);assert.equal(p.locationId,7);assert.equal(p.offsetMm,-22.5);
  assert.equal(p.speedMmPerSec,65500);assert.equal(p.codeBits,11);assert.equal(p.invertedColor,true);
  assert.equal(p.lastReceivedLaneCommandId,11);assert.equal(p.lastExecutedLaneCommandId,12);
  assert.equal(p.desiredLaneSpeedMmPerSec,0x1234);assert.equal(p.desiredSpeedMmPerSec,0x5678);
  assert.equal(t.currentSegmentIndex,-1);assert.equal(t.previousSegmentIndex,-128);assert.equal(t.offsetMm,12.5);
  assert.equal(t.averageLineDriftPixels,-5);assert.equal(t.hadLaneChangeActivity,1);
  assert.equal(t.desiredLaneSpeedMmPerSec,0x1234);assert.equal(t.uphillCounter,8);assert.equal(t.downhillCounter,9);
  assert.equal(t.leftWheelDistanceCm,42);assert.equal(t.rightWheelDistanceCm,34);
  assert.equal(Object.hasOwn(t,'pieceId'),false);assert.equal(Object.hasOwn(t,'desiredSpeedMmPerSec'),false);
});

test('multiple frames in a notification decode in order; offset DataView does not read outside its slice',()=>{
  const r=recorder(),p=position(34),t=transition(),joined=new Uint8Array(p.length+t.length+4);
  joined.fill(255);joined.set(p,2);joined.set(t,2+p.length);
  r.ingest(new DataView(joined.buffer,2,p.length+t.length));
  assert.equal(r.snapshot().observations.length,2);assert.equal(r.snapshot().pieces[0].pieceId,34);
});

test('malformed envelope invalidates the whole notification, including an otherwise valid prefix',()=>{
  const r=recorder(),good=position(34);
  r.ingest(Uint8Array.from([...good,4,0x29,0]));
  assert.equal(r.snapshot().observations.length,1);assert.equal(r.snapshot().observations[0].type,'invalid-envelope');
  assert.equal(r.snapshot().pendingPositionCount,0);
  const result=oval(r);assert.equal(result.status,'INCOMPLETE');assert.equal(result.geometry,undefined);
  assert.ok(result.warnings.some(s=>s.includes('Malformed')));
});

test('short position/transition frames and nonfinite offsets cannot contribute to a complete map',()=>{
  for(const invalid of [Uint8Array.of(2,0x27,34),Uint8Array.of(2,0x29,0),position(34,{offset:NaN}),position(34,{offset:Infinity}),transition({offset:-Infinity})]){
    const r=recorder();r.ingest(invalid);const result=oval(r);
    assert.equal(result.status,'INCOMPLETE');assert.equal(result.geometry,undefined);
    assert.equal(result.observations[0].type,'invalid');
  }
});

test('repeated physical piece IDs remain separate when each has a transition',()=>{
  const result=oval(recorder());
  assert.deepEqual(result.pieces.map(p=>p.pieceId),[34,17,17,36,17,17]);
  assert.equal(result.pieces.filter(p=>p.pieceId===17).length,4);
});

test('conflicting IDs without a transition are retained as ambiguous instead of majority-voted',()=>{
  const r=recorder();tile(r,34);
  r.ingest(position(17));r.ingest(position(17));r.ingest(position(18));r.ingest(transition({left:48,right:40}));
  tile(r,17,{turn:'R'});tile(r,36);tile(r,17,{turn:'R'});tile(r,17,{turn:'R'});
  const result=tile(r,34);
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.pieces[1].pieceId,null);
  assert.deepEqual(result.pieces[1].observedIds,[17,18]);assert.equal(result.pieces[1].ambiguous,true);
  assert.equal(result.geometry,undefined);
});

test('a transition without position codes remains an unknown piece rather than a guessed straight',()=>{
  const r=recorder();tile(r,34);r.ingest(transition());tile(r,36);
  const result=tile(r,34);
  assert.equal(result.status,'INCOMPLETE');assert.equal(result.pieces[1].kind,'unknown');
  assert.equal(result.pieces[1].pieceId,null);assert.deepEqual(result.pieces[1].observedIds,[]);
});

test('unknown, F&F special, crossing and jump pieces never become known simple geometry',()=>{
  for(const id of [255,53,54,57,10,43,58,46,63]){
    const r=recorder();tile(r,34);tile(r,id);tile(r,36);const result=tile(r,34);
    assert.equal(result.status,'INCOMPLETE',String(id));assert.equal(result.geometry,undefined);
    assert.equal(result.pieces[1].pieceId,id);
    assert.ok(result.warnings.some(s=>s.includes('Unsupported layout piece')));
  }
});

test('missing curve orientation and nonclosing geometry are incomplete',()=>{
  const r=recorder();tile(r,34);tile(r,17);tile(r,18);const missing=tile(r,34);
  assert.equal(missing.status,'INCOMPLETE');assert.ok(missing.warnings.some(s=>s.includes('Curve direction')));
  const s=recorder();tile(s,34);tile(s,36);tile(s,39);const open=tile(s,34);
  assert.equal(open.status,'INCOMPLETE');assert.equal(open.geometry,undefined);
});

test('zero net position with a different heading does not qualify as closed',()=>{
  // S,L,L,L,R returns to (0,0) in nominal geometry but faces west, not east.
  const r=recorder();tile(r,34);tile(r,17,{turn:'L'});tile(r,17,{turn:'L'});
  tile(r,17,{turn:'L'});tile(r,17,{turn:'R'});
  const result=tile(r,34);assert.equal(result.status,'INCOMPLETE');assert.equal(result.geometry,undefined);
});

test('start halves, repeated anchors and fewer than three physical pieces do not form a lap',()=>{
  const r=recorder();tile(r,34);tile(r,33);tile(r,34);
  assert.equal(r.snapshot().status,'RECORDING');assert.equal(r.snapshot().pieces.length,1);
  tile(r,36);const result=tile(r,34);assert.equal(result.status,'INCOMPLETE');assert.equal(result.geometry,undefined);
});

test('no anchor, no return anchor and trailing unclosed positions have explicit incomplete evidence',()=>{
  const noAnchor=recorder();tile(noAnchor,36);assert.equal(noAnchor.finish().status,'INCOMPLETE');
  assert.ok(noAnchor.snapshot().warnings.some(s=>s.includes('No observed start/finish')));
  const noReturn=recorder();tile(noReturn,34);noReturn.ingest(position(36));
  const result=noReturn.finish();assert.equal(result.status,'INCOMPLETE');assert.equal(result.pendingPositionCount,1);
  assert.ok(result.warnings.some(s=>s.includes('No observed return')));
  assert.ok(result.warnings.some(s=>s.includes('Trailing')));
});

test('reverse driving, inconsistent return direction and graded track cannot be certified',()=>{
  assert.equal(oval(recorder(),{flags:0x20}).status,'INCOMPLETE');
  const r=recorder();tile(r,34);tile(r,17,{turn:'R'});tile(r,17,{turn:'R'});tile(r,36);
  tile(r,17,{turn:'R'});tile(r,17,{turn:'R'});assert.equal(tile(r,34,{flags:0x40}).status,'INCOMPLETE');
  const grade=recorder();tile(grade,34,{up:1});
  tile(grade,17,{turn:'R'});tile(grade,17,{turn:'R'});tile(grade,36);tile(grade,17,{turn:'R'});tile(grade,17,{turn:'R'});
  assert.equal(tile(grade,34).status,'INCOMPLETE');
});

test('unknown firmware can retain classic observations but cannot certify a complete loop',()=>{
  const r=new TrackRecorder();r.start({mode:'LIVE',physicalLabel:'A',browserId:'opaque',firmware:12386});
  const result=oval(r);assert.equal(result.status,'INCOMPLETE');assert.equal(result.mode,'LIVE');
  assert.equal(result.observations.length,16);assert.equal(result.geometry,undefined);
});

test('timeouts and capture limits stop recording without further data growth',()=>{
  let now=0;const r=recorder({now:()=>now,timeoutMs:50});tile(r,34);now=50;
  assert.equal(r.snapshot().status,'INCOMPLETE');assert.equal(r.snapshot().reason,'timeout');
  const count=r.snapshot().observations.length;r.ingest(position(17));assert.equal(r.snapshot().observations.length,count);
  const capped=recorder({maxFrames:2});tile(capped,34);capped.ingest(position(17));
  assert.equal(capped.snapshot().reason,'observation limit');assert.equal(capped.snapshot().observations.length,2);
  const pieces=recorder({maxPieces:3});tile(pieces,34);tile(pieces,36);tile(pieces,39);tile(pieces,40);
  assert.equal(pieces.snapshot().reason,'piece limit');assert.equal(pieces.snapshot().pieces.length,3);
});

test('delocalized evidence ends passive recording; unrelated packets do not create track pieces',()=>{
  const r=recorder();r.ingest(Uint8Array.of(1,0x17,3,0x1b,0xa0,0x0f));
  assert.equal(r.snapshot().pieces.length,0);r.ingest(Uint8Array.of(1,0x2b));
  assert.equal(r.snapshot().status,'INCOMPLETE');assert.equal(r.snapshot().reason,'car delocalized');
});

test('finish freezes evidence and explicit start clears mode, session and previous geometry',()=>{
  const r=recorder();oval(r);const prior=r.snapshot();
  r.finish('disconnect');assert.equal(r.snapshot().status,'COMPLETE');
  r.ingest(position(255));assert.equal(r.snapshot().observations.length,prior.observations.length);
  const next=r.start({mode:'LIVE',physicalLabel:'B',browserId:'different',firmware:9511});
  assert.equal(next.mode,'LIVE');assert.equal(next.session.physicalLabel,'B');assert.equal(next.geometry,undefined);
  assert.deepEqual(next.pieces,[]);assert.deepEqual(next.observations,[]);assert.deepEqual(next.warnings,[]);
});

test('snapshots and caller buffers cannot mutate internal evidence',()=>{
  const r=recorder(),bytes=position(34);r.ingest(bytes);bytes[3]=255;r.ingest(transition());
  const first=r.snapshot();first.pieces[0].observedIds[0]=255;first.observations[0].pieceId=255;first.session.firmware=12386;
  const next=r.snapshot();assert.equal(next.pieces[0].pieceId,34);assert.equal(next.observations[0].pieceId,34);
  assert.equal(next.session.firmware,11866);
});

test('configuration and input validation do not coerce ambiguous modes or unbounded buffers',()=>{
  for(const options of [{maxFrames:0},{maxFrames:10001},{maxPieces:2},{maxPieces:Infinity},{timeoutMs:-1},{now:3}])assert.throws(()=>new TrackRecorder(options));
  const r=new TrackRecorder();assert.equal(r.snapshot().status,'IDLE');assert.throws(()=>r.start({mode:'live'}));
  assert.throws(()=>r.start({firmware:'11866'}));r.start();assert.throws(()=>r.ingest([16,0x27]));
});
