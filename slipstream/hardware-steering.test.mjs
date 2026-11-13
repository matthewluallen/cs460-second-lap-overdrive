import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decode} from './protocol.mjs';
import {validate,ReplayCar} from './trace.mjs';
import {Pieces,TrackMapper} from './track.mjs';
import {Car} from './car.mjs';
const trace=validate(JSON.parse(readFileSync(new URL('./fixtures/groundshock-sdk-scan-steering.json',import.meta.url))));
const bytes=s=>Uint8Array.from(s.split(' ').map(b=>parseInt(b,16)));

test('Groundshock hardware capture maps in SDK mode and retains special-piece quarantine',()=>{
 const pieces=new Pieces(JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url))));
 const maps=[new TrackMapper(pieces),new TrackMapper(pieces)];
 for(const [,index,direction,hex] of trace.events)if(direction==='rx')for(const m of decode(bytes(hex)))if(!maps[index].done)maps[index].feed(m);
 assert.equal(maps[0].done,false);
 assert.equal(maps[1].done,true);
 assert.equal(maps[1].track.count,11);
 assert.ok(maps[1].track.unverifiedCount>0,'piece 57 is not cleared for scored rounds by scan closure');
});
test('Groundshock left request receives cancellation status, not a completed lane change',()=>{
 const request=trace.events.find(e=>e[0]===406631);
 assert.equal(request[2],'tx');
 const packet=bytes(request[3]);
 assert.equal(packet[1],0x25);
 assert.equal(new DataView(packet.buffer).getFloat32(6,true),-45);
 const reply=trace.events.find(e=>e[0]===406684);
 const [m]=decode(bytes(reply[3]));
 assert.equal(reply[0]-request[0],53);
 assert.equal(m.type,'laneChange');assert.equal(m.currentOffset,-13.5);assert.equal(m.targetOffset,-13.5);
 assert.equal(m.horizontalSpeed,0);assert.equal(m.laneChangeId,0x80);
 assert.equal(m.cancelled,true);
 // The raw frame and ID stay available for future firmware interpretation.
 const completed=bytes(reply[3]);completed[14]=0x01;
 assert.equal(decode(completed)[0].cancelled,false);
 completed[14]=0x80;completed[10]=1;assert.equal(decode(completed)[0].cancelled,false);
});
test('cancellation report alone never supplies track position or watchdog freshness',()=>{
 const r=new ReplayCar({...trace,events:trace.events.filter(e=>e[0]===406684)},1);
 const c=new Car(r,{clock:()=>406684});r.advance(406684);
 assert.equal(c.diagnostics().laneChange.cancelled,true);
 assert.equal(c.lastTrackAt,undefined);assert.equal(c.lastPosition,undefined);
 assert.equal(c.speed,0);
});
