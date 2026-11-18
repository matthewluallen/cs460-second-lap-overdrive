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

const piecesData=JSON.parse(readFileSync(new URL('./data/pieces.json',import.meta.url)));
function radio(){let receive;return {sent:[],onNotify(fn){receive=fn;return()=>{};},async write(b){this.sent.push([...b]);},emit(b){receive(b);},close(){}};}
const cancellation=()=>bytes(trace.events.find(e=>e[0]===406684)[3]);

test('special piece 57 never calibrates offset or contributes sign-learning evidence',async()=>{
 const r=radio(),c=new Car(r,{pieces:new Pieces(piecesData),clock:()=>277195});
 c.lastPair={lateral:50,offset:-50};c.signVotes=2;
 r.emit(bytes(trace.events.find(e=>e[0]===277195&&e[2]==='rx')[3]));await c.pumpPromise;
 assert.equal(r.sent.filter(b=>b[1]===0x2c).length,0);
 assert.equal(c.lastPair,null);assert.equal(c.signVotes,2);assert.equal(c.offsetSign,-1);
 assert.equal(c.telemetry.calibrationBlocked.pieceId,57);
 assert.equal(c.lastTrackAt,277195,'raw position still feeds the existing watchdog');
});
test('cancelled steering clears unachieved target and permits a fresh explicit request',async()=>{
 const r=radio(),c=new Car(r);c.steerTo(45);await c.pumpPromise;
 r.emit(cancellation());await c.pumpPromise;
 assert.equal(c.targetLateral,13.5);assert.equal(c.forceLane,true);
 assert.equal(r.sent.length,1,'cancellation itself never retries');
 c.steerTo(45);await c.pumpPromise;assert.equal(r.sent.length,2);
 r.emit(cancellation());c.nudge(1);await c.pumpPromise;
 assert.equal(c.targetLateral,45,'next nudge uses reported offset, not cancelled 45 mm target');
});

test('moving cancellation opens shared pit for browser, phone, gamepad and CPU without retry',async()=>{
 const {Game}=await import('./game.mjs');
 const data=n=>JSON.parse(readFileSync(new URL('./data/'+n+'.json',import.meta.url)));
 for(const control of ['browser','phone','gamepad','bot']) {
  const g=new Game({pieces:piecesData,weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>100});
  const r=radio(),d=g.addCar(r,{control}),other=g.addCar(radio(),{control:'browser'});
  await d.car.pumpPromise;await other.car.pumpPromise;
  d.input={throttle:1,lane:45};d.car.setSpeed(240);d.car.steerTo(45);other.car.setSpeed(200);await d.car.pumpPromise;
  r.emit(cancellation());await d.car.pumpPromise;await other.car.pumpPromise;
  assert.equal(g.halted,true);assert.match(g.pitReason,/Lane change cancelled/);
  assert.equal(d.input.lane,null);assert.equal(d.car.speed,0);assert.equal(other.car.speed,0);
  const lanes=r.sent.filter(b=>b[1]===0x25).length;g.tick(0.1,200);await d.car.pumpPromise;
  assert.equal(r.sent.filter(b=>b[1]===0x25).length,lanes);
 }
});
