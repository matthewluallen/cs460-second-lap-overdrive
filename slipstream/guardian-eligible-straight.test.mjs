import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {decode} from './protocol.mjs';
import {Pieces} from './track.mjs';
import {validate} from './trace.mjs';

// Frozen observed behavior, not desired repaired behavior. Fixed-clock replay
// can miss an advancing-clock race, so this test does not claim byte-equivalence
// between the physical capture and replay. Later physical acceptance is recorded
// separately; the immutable export itself cannot verify a physical stop.
const file=readFileSync(new URL('./fixtures/guardian-sdk-eligible-straight-no-attempt-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const previous=JSON.parse(readFileSync(new URL('./fixtures/guardian-sdk-unsolicited-lane-cancel-2026-11-18.json',import.meta.url)));
const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)}));
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));

test('watched Guardian repeat had two eligible straight codes but issued no lane command before deadline STOP',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'7d88e6b51d74530c03f21cbcd5f230a133c8b92008fe7e731d28f79cf7a2f4e6');
  assert.equal(trace.events.length,72);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual(trace.events.slice(0,52),previous.events);
  assert.deepEqual([trace.cars[0].profile,trace.cars[0].firmware],['sdk',11866]);
  const optical=rx.filter(e=>e.at>=1306568&&e.message.type==='position');
  assert.deepEqual(optical.map(e=>[e.index,e.at,e.message.pieceId,e.message.locationId,e.message.reverse,e.message.speed]),[
    [61,1307439,39,20,true,306],[63,1307948,39,19,true,316],[64,1308489,39,18,true,294],
    [66,1309388,17,18,false,288],[67,1309929,17,19,false,297]
  ]);
  const geometry=optical.map(e=>{
    const {pieceId,locationId,reverse}=e.message,spot=pieces.locate(pieceId,locationId,reverse),piece=pieces.get(pieceId);
    return {kind:piece.kind,progress:spot.progress,lateral:spot.lateral,remaining:(1-spot.progress)*piece.length,leftTarget:spot.lateral+22.5,timeLeft:1310568-e.at};
  });
  for(const g of geometry.slice(0,2)){
    assert.equal(g.kind,'straight');assert.equal(g.lateral,-13.5);assert.equal(g.leftTarget,9);
    assert.ok(g.remaining>=250);assert.ok(g.timeLeft>=750);
  }
  assert.ok(Math.abs(geometry[0].remaining-440.16)<1e-6);assert.equal(geometry[1].remaining,280);
  assert.deepEqual(geometry.slice(0,2).map(g=>g.timeLeft),[3129,2620]);
  assert.ok(Math.abs(geometry[2].remaining-119.84)<1e-6);assert.ok(geometry.slice(3).every(g=>g.kind==='curve'));
  assert.deepEqual(tx.filter(e=>e.at>=1306568).map(e=>[e.index,e.at,e.text]),[
    [57,1306568,'06 24 00 00 c4 09 00'],[58,1306569,'06 24 2c 01 e8 03 00'],
    [62,1307450,'05 2c 00 00 58 41'],[69,1310569,'06 24 00 00 c4 09 00']
  ]);
  assert.equal(tx.some(e=>[0x25,0x26,0x32,0x34].includes(e.packet[1])),false);
  assert.equal(1310569-1306569,4000);
  assert.equal(rx.filter(e=>e.message.type==='battery').at(-1).message.millivolts,3814);
  assert.equal(rx.filter(e=>e.at>=1306568).some(e=>['laneChange','delocalized','delocRecoveryEntered','delocRecoverySucceeded'].includes(e.message.type)),false);
  assert.equal(trace.diagnostics.pitReason,null);assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
  assert.ok(trace.markers.some(m=>m.timeMs===1310569&&m.details.text?.includes('no lane request sent')));
});
