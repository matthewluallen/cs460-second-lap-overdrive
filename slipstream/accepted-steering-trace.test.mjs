import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decode, ID} from './protocol.mjs';
import {Pieces} from './track.mjs';
import {validate} from './trace.mjs';

// Captured ordinary free-drive trial on SDK firmware11866, not the bounded
// steering diagnostic. Firmware ACKs and code-derived geometry are evidence;
// physical movement/stop confirmation is recorded separately by the operator.
const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const trace = validate(load('./fixtures/groundshock-sdk-left-lane-accepted.json'));
const pieces = new Pieces(load('./data/pieces.json'));
const START=1443603, LANE=1453607, STOP=1462824;
const rows = trace.events.flatMap(([at,car,direction,hex], index) =>
  car===0 && at>=START ? [{at,index,direction,bytes:Uint8Array.from(hex.split(' ').map(b=>parseInt(b,16)))}] : []);
const received = rows.filter(r=>r.direction==='rx').flatMap(r=>decode(r.bytes).map(message=>({...r,message})));
const sent = rows.filter(r=>r.direction==='tx');
const signed16 = (p,offset) => new DataView(p.buffer,p.byteOffset,p.byteLength).getInt16(offset,true);
const float32 = (p,offset) => new DataView(p.buffer,p.byteOffset,p.byteLength).getFloat32(offset,true);

test('accepted steering trial sends one offset/lane pair after driving and ends with STOP',()=>{
  assert.equal(trace.dropped,0);
  const speeds=sent.filter(r=>r.bytes[1]===ID.SPEED);
  assert.deepEqual(speeds.map(r=>[r.at,signed16(r.bytes,2)]),[[START,300],[STOP,0]]);
  const lanes=sent.filter(r=>r.bytes[1]===ID.CHANGE_LANE);
  assert.equal(lanes.length,1,'earlier scan and cancelled attempts are excluded');
  const lane=lanes[0], offset=sent[sent.indexOf(lane)-1];
  assert.equal(lane.at,LANE);assert.equal(offset.at,LANE);assert.ok(offset.index<lane.index);
  assert.equal(offset.bytes[1],ID.SET_OFFSET);assert.equal(float32(offset.bytes,2),22.5);
  assert.equal(float32(lane.bytes,6),-22.5);assert.equal(signed16(lane.bytes,2),350);
  assert.equal(lane.bytes[11],1);
  assert.equal(sent.some(r=>r.at>STOP && r.bytes[1]===ID.SPEED && signed16(r.bytes,2)>0),false);
  const stopReply=received.find(r=>r.at>STOP && r.message.type==='speed');
  assert.equal(stopReply.message.desired,0);
  // Its actual-speed field is not a final stationary observation.
  assert.equal(stopReply.message.actual,312);
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
});

test('firmware reports uncancelled lane ID1 and subsequently registers and executes ID1',()=>{
  const reports=received.filter(r=>r.at>=LANE && r.message.type==='laneChange');
  assert.equal(reports.length,1);assert.equal(reports[0].at,1454540);
  assert.equal(reports[0].message.laneChangeId,1);assert.equal(reports[0].message.cancelled,false);
  assert.equal(reports[0].message.horizontalSpeed,0);assert.equal(reports[0].message.offsetKnown,true);
  const acknowledgments=received.filter(r=>r.at>=LANE && ['position','transition'].includes(r.message.type));
  assert.equal(acknowledgments[0].at,1455113);
  assert.ok(acknowledgments.length>1);
  for(const {message} of acknowledgments){
    assert.equal(message.lastReceivedLaneChangeId,1);assert.equal(message.lastExecutedLaneChangeId,1);
  }
});

test('verified piece codes show a positive-left displacement independently of the firmware ACK',()=>{
  const positions=received.filter(r=>r.message.type==='position').flatMap(r=>{
    const m=r.message, definition=pieces.get(m.pieceId);
    if(!definition || definition.unverified)return [];
    const spot=pieces.locate(m.pieceId,m.locationId,m.reverse);
    return spot?[{...r,kind:definition.kind,lateral:spot.lateral}]:[];
  });
  const before=positions.filter(r=>r.at<LANE && r.kind==='straight').at(-1);
  const after=positions.find(r=>r.at>LANE && r.kind==='straight');
  assert.deepEqual([before.at,before.message.pieceId,before.message.locationId,before.lateral],[1453310,36,32,-22.5]);
  assert.deepEqual([after.at,after.message.pieceId,after.message.locationId,after.lateral],[1460841,39,12,31.5]);
  assert.equal(after.lateral-before.lateral,54,'code-derived left-positive displacement, not guaranteed command accuracy');
  const firstAfter=positions.find(r=>r.at>LANE);
  assert.deepEqual([firstAfter.at,firstAfter.lateral],[1455784,31.5]);
  assert.equal(positions.some(r=>r.message.pieceId===57),false,'special geometry is not used as steering proof');
});
