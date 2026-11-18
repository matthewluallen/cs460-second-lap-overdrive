import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decode} from './protocol.mjs';
import {Pieces,trackFromPlan,Localizer} from './track.mjs';
import {RoundSession} from './session.mjs';

const trace=JSON.parse(readFileSync(new URL('./fixtures/guardian-sdk-computer-crew-2026-11-18.json',import.meta.url)));
const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
const track=trackFromPlan(pieces,trace.diagnostics.track);
const received=trace.events.filter(e=>e[2]==='rx').flatMap(([at,,,hex])=>decode(Uint8Array.from(hex.split(' ').map(x=>parseInt(x,16)))).map(message=>({at,message})));
const start=417123,stop=448858,go=417082;
const positions=received.filter(e=>e.at>=start&&e.at<=stop&&e.message.type==='position');

test('Guardian Computer optical route independently contains three complete traversals before STOP',()=>{
  assert.equal(positions.length,47);
  const visits=[];
  for(const event of positions){
    const last=visits.at(-1);
    if(last?.[0].message.pieceId===event.message.pieceId)last.push(event);else visits.push([event]);
  }
  // Piece17 occurs twice. Its following sequence23→34→33 uniquely identifies
  // the initial occurrence as index4; do not seed that identity in the live UI.
  const matches=track.pieces.flatMap((p,index)=>p.id===positions[0].message.pieceId?[index]:[])
    .filter(index=>visits.every(([e],v)=>{const p=track.pieces[(index+v)%track.count];return p.id===e.message.pieceId&&p.reverse===e.message.reverse;}));
  assert.deepEqual(matches,[4]);assert.equal(visits.length,23);
  const initial=pieces.locate(17,16,false);assert.equal(initial.progress,.321);
  const confirmed=[];
  for(const visit of [7,14,21]) {
    const crossing=visits[visit].find(e=>pieces.locate(e.message.pieceId,e.message.locationId,e.message.reverse).progress>=initial.progress);
    assert.ok(crossing,'each complete return passes the initial optical progress');confirmed.push(crossing.at);
  }
  assert.deepEqual(confirmed,[427882,436882,446903]);assert.ok(confirmed[2]<stop);
  const last=positions.at(-1);assert.equal(last.at,448492);assert.equal(last.message.pieceId,23);assert.equal(last.message.locationId,21);
  const routeCircuits=3+(track.distance(5,.5,1)-track.distance(4,initial.progress,1))/track.length;
  assert.ok(routeCircuits>3.18&&routeCircuits<3.181,'centerline-normalized optical route, not measured wheel travel');
  assert.equal(stop-start,31735);
});

test('actual Localizer and RoundSession distinguish verified finish wraps from Crew distance-based laps',()=>{
  const localizer=new Localizer(track,pieces),session=new RoundSession();
  let eventIndex=0,previousLaps=0;const roundBoundaries=[],finishWraps=[];
  const snapshot=at=>{
    const p=localizer.estimate(at);
    return [{id:1,name:'Guardian',control:'bot',connected:true,located:!!p?.located,speed:300,speedCeiling:300,
      circuitProgress:p?.located?track.distance(p.index,p.progress,p.direction)/track.length%1:undefined,circuitDirection:p?.direction}];
  };
  // The recorder preserves notification times, not every browser callback.
  // A deterministic40ms sample reproduces the count, not exact UI lap times.
  for(let at=go;at<=stop;at+=40) {
    while(eventIndex<received.length&&received[eventIndex].at<=at){
      const e=received[eventIndex++];localizer.feed(e.message,e.at);
      if(e.at>=start&&e.message.type==='transition'&&localizer.index===0)finishWraps.push([e.at,localizer.laps]);
    }
    if(at===go)session.start('team',snapshot(at),at);else session.update(snapshot(at),at);
    const row=session.view().rows[0];if(row.laps!==previousLaps){previousLaps=row.laps;roundBoundaries.push([at,row.laps]);}
    if(at<429000)assert.equal(row.laps,0,'initial map wrap cannot become a partial first lap');
  }
  assert.deepEqual(finishWraps,[[421160,0],[430552,1],[440122,2]]);
  assert.deepEqual(roundBoundaries,[[429202,1],[438762,2],[448802,3]]);
  assert.equal(session.view().reason,'goal');assert.equal(session.view().teamLaps,3);assert.equal(localizer.laps,2);
  const row=session.view().rows[0];assert.equal(row.bestLapMs,9440);assert.equal(row.lastLapMs,10040);
  // Recorded UI9.43s/10.08s depends on actual tick jitter. Its third award is
  // between optical codes: final measured23 progress.5 is before the first
  // unique23 progress.679. The independent route test above proves3 traversals
  // from the earlier17 observation; do not equate these two counting policies.
  assert.ok(roundBoundaries.at(-1)[0]>positions.at(-1).at);
  assert.ok(.5<pieces.locate(23,17,false).progress);
});
