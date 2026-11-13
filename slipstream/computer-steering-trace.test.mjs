import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decode, ID} from './protocol.mjs';
import {Pieces} from './track.mjs';
import {validate} from './trace.mjs';

// Hardware bytes are preserved verbatim. These tests verify decoded evidence,
// not physical lane completion, impact, or physical STOP.
const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const trace = validate(json('./fixtures/groundshock-sdk-computer-lanes-cancelled.json'));
const pieces = new Pieces(json('./data/pieces.json'));
const raw = text => Uint8Array.from(text.split(' ').map(b => parseInt(b,16)));
const events = trace.events.map(([at, car, direction, hex], index) => ({at,car,direction,hex,index,packet:raw(hex)}));
const rx = events.filter(e => e.direction === 'rx').flatMap(e => decode(e.packet).map(message => ({...e,message})));
const lanes = events.filter(e => e.direction === 'tx' && e.packet[1] === ID.CHANGE_LANE);
const view = packet => new DataView(packet.buffer,packet.byteOffset,packet.byteLength);
const speed = e => view(e.packet).getInt16(2,true);

for (const [index, expected] of [
  {at:36086,id:1,targetHex:'00 00 b4 41',target:22.5,cancelDelay:97,stopDelay:0,pieceId:36,positionAt:36053,displacement:-54},
  {at:166886,id:2,targetHex:'00 00 b4 c1',target:-22.5,cancelDelay:104,stopDelay:3,pieceId:39,positionAt:166863,displacement:-9}
].entries()) {
  test('computer lane attempt '+(index+1)+' preserves exact request, cancellation and STOP sequence', () => {
    const lane = lanes[index];
    assert.equal(lane.at,expected.at);
    assert.deepEqual(events.slice(lane.index-2,lane.index+1).map(e=>[e.direction,e.hex]),[
      ['tx','06 24 2c 01 e8 03 00'],
      ['tx','05 2c 00 00 fc c1'],
      ['tx','0b 25 5e 01 e8 03 '+expected.targetHex+' 00 0'+expected.id]
    ]);
    assert.equal(lane.packet[11],expected.id);
    assert.equal(view(lane.packet).getFloat32(6,true),expected.target);
    const previousSpeed = events.slice(0,lane.index-2).filter(e=>e.direction==='tx'&&e.packet[1]===ID.SPEED).at(-1);
    assert.equal(speed(previousSpeed),200,'lane request coincides with a 200→300 speed change');
    const cancel = rx.find(e=>e.index>lane.index && e.message.type==='laneChange');
    assert.equal(cancel.at-lane.at,expected.cancelDelay);
    assert.deepEqual({id:cancel.message.laneChangeId,cancelled:cancel.message.cancelled,
      current:cancel.message.currentOffset,target:cancel.message.targetOffset,
      horizontal:cancel.message.horizontalSpeed,forward:cancel.message.verticalSpeed},
      {id:0x80,cancelled:true,current:-31.5,target:-31.5,horizontal:0,forward:228});
    const stop = events.find(e=>e.index>cancel.index && e.direction==='tx');
    assert.equal(stop.hex,'06 24 00 00 c4 09 00');
    assert.equal(stop.at-cancel.at,expected.stopDelay,'recorded write timing, not physical stop latency');
    const prePosition = rx.filter(e=>e.index<lane.index && e.message.type==='position').at(-1);
    assert.deepEqual([prePosition.at,prePosition.message.pieceId,prePosition.message.locationId,prePosition.message.reverse],
      [expected.positionAt,expected.pieceId,12,false]);
    const spot = pieces.locate(prePosition.message.pieceId,prePosition.message.locationId,prePosition.message.reverse);
    assert.equal(spot.lateral,31.5);
    // Current host convention: positive lateral is left of travel; wire offset
    // has the opposite sign. This is a requested displacement, not observation.
    assert.equal(-expected.target-spot.lateral,expected.displacement);
  });
}

test('retained ACK1 predates both new requests and capture contains no ACK2 or later restart', () => {
  assert.equal(trace.events.length,68);
  assert.equal(trace.dropped,0);
  assert.equal(trace.cars[0].profile,'sdk');
  assert.equal(trace.cars[0].firmware,11866);
  assert.deepEqual(lanes.map(e=>e.packet[11]),[1,2]);
  const optical = rx.filter(e=>['position','transition'].includes(e.message.type));
  assert.ok(optical.length>0);
  const firstAck = optical[0];
  assert.equal(firstAck.at,28645);
  assert.ok(firstAck.index<lanes[0].index);
  assert.ok(optical.every(e=>e.message.lastReceivedLaneChangeId===1 && e.message.lastExecutedLaneChangeId===1));
  assert.equal(optical.some(e=>e.index>lanes[1].index),false,'no post-request optical ACK for command2');
  const lastCancel = rx.filter(e=>e.message.type==='laneChange').at(-1);
  const after = events.filter(e=>e.index>lastCancel.index && e.direction==='tx');
  assert.deepEqual(after.map(e=>e.hex),['06 24 00 00 c4 09 00']);
  const response = rx.find(e=>e.index>lastCancel.index && e.message.type==='speed');
  assert.equal(response.message.desired,0);
  assert.equal(response.message.actual,316,'last speed reply is not measured zero or physical-stop proof');
});

test('slow CPU curve capture times out on a 2116 ms optical gap without a lane or offset command', () => {
  const slow = validate(json('./fixtures/groundshock-sdk-cpu-slow-curve-timeout.json'));
  assert.equal(slow.events.length,98);
  assert.equal(slow.dropped,0);
  const sent = slow.events.filter(e=>e[2]==='tx').map(([at,,direction,hex])=>({at,direction,hex,packet:raw(hex)}));
  assert.equal(sent.some(e=>[ID.CHANGE_LANE,ID.SET_OFFSET].includes(e.packet[1])),false);
  const motion = sent.filter(e=>e.packet[1]===ID.SPEED && speed(e)>0);
  assert.deepEqual(motion.map(e=>[e.at,e.hex]),[[22081,'06 24 c8 00 e8 03 00']]);
  const received = slow.events.filter(e=>e[2]==='rx').flatMap(([at,,,hex])=>decode(raw(hex)).map(message=>({at,message})));
  const optical = received.filter(e=>['position','transition'].includes(e.message.type));
  assert.deepEqual(optical.map(e=>[e.at,e.message.type]),[
    [23191,'position'],[23460,'transition'],[25576,'transition']
  ]);
  assert.deepEqual([optical[0].message.pieceId,optical[0].message.locationId,optical[0].message.reverse],[39,17,false]);
  assert.equal(optical[2].at-optical[1].at,2116);
  const timeout = slow.markers.find(m=>m.kind==='log' && m.details.text==='Groundshock: Telemetry timeout');
  assert.equal(timeout.timeMs,25489);
  assert.equal(timeout.timeMs-optical[1].at,2029,'host watchdog triggers after its 2000 ms default');
  const stop = sent.find(e=>e.at>motion[0].at && e.packet[1]===ID.SPEED && speed(e)===0);
  assert.deepEqual([stop.at,stop.hex],[25576,'06 24 00 00 c4 09 00']);
  assert.equal(stop.at-timeout.timeMs,87,'STOP write completion follows the host timeout marker');
  assert.equal(sent.some(e=>e.at>stop.at && e.packet[1]===ID.SPEED && speed(e)>0),false);
  const stoppedResponse = received.find(e=>e.at===25651 && e.message.type==='speed');
  assert.deepEqual([stoppedResponse.message.desired,stoppedResponse.message.actual],[0,236]);
  // This is zero requested speed with a nonzero reported sample, not proof of
  // physical stopping or movement; those observations belong in the report.
});
