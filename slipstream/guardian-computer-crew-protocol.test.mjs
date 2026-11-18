import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {decode} from './protocol.mjs';
import {Pieces} from './track.mjs';
import {validate} from './trace.mjs';

const file=readFileSync(new URL('./fixtures/guardian-sdk-computer-crew-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const previous=JSON.parse(readFileSync(new URL('./fixtures/guardian-sdk-left-right-shifts-accepted-2026-11-18.json',import.meta.url)));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)}));
const tx=events.filter(e=>e.direction==='tx'&&e.at>=417123);
const rx=events.filter(e=>e.direction==='rx'&&e.at>=417123).flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
const lateral=e=>pieces.locate(e.message.pieceId,e.message.locationId,e.message.reverse).lateral;

test('frozen Computer Crew run preserves constant forward pace and exactly two SDK maneuver sequences',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'e4021edf2b7607c414cce747b324d0d3464e7b322af4df584d0ee50098de8aae');
  assert.equal(trace.events.length,136);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual(trace.events.slice(0,48),previous.events);
  assert.deepEqual([trace.cars[0].profile,trace.cars[0].firmware],['sdk',11866]);
  assert.deepEqual(tx.map(e=>[e.index,e.at,e.text]),[
    [53,417123,'06 24 2c 01 e8 03 00'],
    [73,425482,'05 2c 00 00 90 40'],[74,425483,'0b 25 5e 01 e8 03 00 00 b4 c1 00 03'],
    [97,435162,'05 2c 00 00 b4 c1'],[98,435162,'0b 25 5e 01 e8 03 00 00 b4 41 00 04'],
    [134,448858,'06 24 00 00 c4 09 00']
  ]);
  assert.equal(448858-417123,31735);
  const optical=rx.filter(e=>e.message.type==='position');
  assert.equal(optical.length,47);assert.equal(rx.filter(e=>e.message.type==='transition').length,22);
  assert.equal(optical[0].at-417123,587);
  assert.equal(Math.max(...optical.slice(1).map((e,i)=>e.at-optical[i].at)),1501);
  assert.equal(rx.some(e=>e.message.cancelled||['delocalized','delocRecoveryEntered','delocRecoverySucceeded'].includes(e.message.type)),false);
  assert.equal(rx.filter(e=>e.message.type==='collision').length,4,'raw collision reports are retained, not interpreted as proven physical impacts');
  assert.equal(trace.diagnostics.pitReason,null);assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
  // This export predates the later operator confirmation. Scored laps and
  // physical completion are independently assessed, not inferred from a STOP.
  assert.match(trace.diagnostics.operatorNotes,/physicalstop\/path\/laneobservation requested andpending/);
});

test('Computer requests alternate left then right with registration and subsequent printed-lane evidence',()=>{
  const firstBefore=rx.find(e=>e.index===72),firstAfter=rx.find(e=>e.index===76);
  const secondBefore=rx.find(e=>e.index===96),secondAfter=rx.find(e=>e.index===103);
  assert.deepEqual([firstBefore.message.pieceId,firstBefore.message.locationId,firstBefore.message.reverse],[39,23,true]);
  assert.deepEqual([secondBefore.message.pieceId,secondBefore.message.locationId,secondBefore.message.reverse],[39,31,true]);
  assert.deepEqual([lateral(firstBefore),lateral(firstAfter),lateral(secondBefore),lateral(secondAfter)],[-4.5,22.5,22.5,-22.5]);
  const requests=tx.filter(e=>e.packet[1]===0x25);
  const targets=requests.map(e=>-new DataView(e.packet.buffer,e.packet.byteOffset,e.packet.byteLength).getFloat32(6,true));
  assert.deepEqual(targets,[22.5,-22.5]);
  assert.deepEqual([targets[0]-lateral(firstBefore),targets[1]-lateral(secondBefore)],[27,-45],
    'these are alternating absolute Computer targets, not two adjacent 22.5 mm nudges');
  const replies=rx.filter(e=>e.message.type==='laneChange');
  assert.deepEqual(replies.map(e=>[e.index,e.at,e.message.laneChangeId,e.message.cancelled,e.message.horizontalSpeed]),[
    [75,425961,3,false,0],[101,435651,4,false,0]
  ]);
  assert.deepEqual(replies.map((e,i)=>e.at-requests[i].at),[478,489]);
  const firstAck=firstAfter.message,secondAck=rx.find(e=>e.index===102).message;
  assert.deepEqual([firstAck.lastReceivedLaneChangeId,firstAck.lastExecutedLaneChangeId,secondAck.lastReceivedLaneChangeId,secondAck.lastExecutedLaneChangeId],[3,3,4,4]);
  assert.ok(firstAfter.at>requests[0].at&&secondAfter.at>requests[1].at);
});
