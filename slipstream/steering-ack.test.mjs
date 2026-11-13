import test from 'node:test';
import assert from 'node:assert/strict';
import {decode} from './protocol.mjs';
import {Car} from './car.mjs';
function frame(id,size){const b=new Uint8Array(size+1);b[0]=size;b[1]=id;return b;}
function rig(){let receive;const r={sent:[],onNotify(fn){receive=fn;return()=>{};},async write(b){this.sent.push([...b]);},emit(b){receive(b);},close(){}};return {r,c:new Car(r)};}
test('SDK position ACK fields preserve distinct received/executed IDs and sideways speed',()=>{
 const b=frame(0x27,16);b[11]=5;b[12]=4;new DataView(b.buffer).setUint16(13,350,true);
 const m=decode(b)[0];assert.equal(m.lastReceivedLaneChangeId,5);assert.equal(m.lastExecutedLaneChangeId,4);assert.equal(m.desiredLaneSpeed,350);
 for(let n=10;n<16;n++){
  const short=b.slice(0,n+1);short[0]=n;const d=decode(short)[0];
  assert.equal(d.lastReceivedLaneChangeId,n>=11?5:null);assert.equal(d.lastExecutedLaneChangeId,n>=12?4:null);assert.equal(d.desiredLaneSpeed,n>=14?350:null);
 }
});
test('SDK transition ACK layout is independent of position layout',()=>{
 const b=frame(0x29,17);b[8]=9;b[9]=8;b[13]=1;new DataView(b.buffer).setUint16(10,100,true);
 const m=decode(b)[0];assert.equal(m.lastReceivedLaneChangeId,9);assert.equal(m.lastExecutedLaneChangeId,8);assert.equal(m.desiredLaneSpeed,100);assert.equal(m.laneChangeActivity,1);
});
test('steering IDs advance on new requests, wrap seven bits, and deduplication consumes no ID',async()=>{
 const {r,c}=rig();
 for(let i=1;i<=130;i++){
  c.steerTo(i%2?22.5:-22.5);await c.pumpPromise;
  assert.equal(r.sent.at(-1)[11],i&127);
  const count=r.sent.length;c.steerTo(i%2?22.5:-22.5);await c.pumpPromise;assert.equal(r.sent.length,count);
 }
 c.safetyStop('Host stopped');await c.pumpPromise;const id=c.laneCommandId;c.steerTo(0);assert.equal(c.laneCommandId,id);
});
test('received/executed ACK remains diagnostic and never retries or overrides a stop',async()=>{
 const {r,c}=rig();c.steerTo(22.5);await c.pumpPromise;c.safetyStop('Host stopped');await c.pumpPromise;
 const count=r.sent.length,b=frame(0x27,16);b[11]=1;b[12]=1;new DataView(b.buffer).setUint16(13,350,true);r.emit(b);await c.pumpPromise;
 assert.equal(c.telemetry.laneAcknowledgment.executed,1);assert.equal(c.telemetry.laneRequest.id,1);
 assert.equal(c.speed,0);assert.equal(c.safetyReason,'Host stopped');assert.equal(r.sent.length,count);
});
