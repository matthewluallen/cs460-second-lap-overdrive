import test from 'node:test';
import assert from 'node:assert/strict';
import {Car} from './car.mjs';
import {encode} from './protocol.mjs';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function rig(){
  let now=0;const sent=[];
  const radio={onNotify(){return()=>{};},close(){},async write(packet){await radio.block?.(packet);sent.push({at:now,packet:[...packet]});}};
  const car=new Car(radio,{clock:()=>now});
  return{car,radio,sent,time:t=>{now=t;}};
}
const speeds=sent=>sent.filter(e=>e.packet[1]===0x24).map(e=>e.packet[2]+256*e.packet[3]);

test('telemetry degradation invalidates queued acceleration and maneuver preambles',async()=>{
  const{car,radio,sent,time}=rig();car.setSpeed(600);await car.pumpPromise;
  let release;radio.block=async p=>{if(p[1]===0x1a)await new Promise(resolve=>{release=resolve;});};
  car.refreshBattery();while(!release)await settle();
  car.setSpeed(900);car.send('lane-offset',encode.setOffset(22.5));car.steerTo(45);
  time(2100);assert.equal(car.beginTelemetryGrace(3000,300),true);release();await car.pumpPromise;
  assert.deepEqual(speeds(sent),[600,300]);assert.equal(sent.some(e=>[0x25,0x2c,0x32].includes(e.packet[1])),false);
  car.setSpeed(100);await car.pumpPromise;car.setSpeed(300);await car.pumpPromise;
  assert.equal(car.speed,100,'a lower command cannot be raised again inside the degraded window');
});

test('telemetry lock invalidates a dequeued positive write before its final radio microtask',async()=>{
  const{car,sent}=rig();car.setSpeed(900);car.beginTelemetryGrace(3000,300);await car.pumpPromise;
  assert.deepEqual(speeds(sent),[300]);
});

test('a queued grace-period write cannot enter transport after the deadline even before its timer runs',async()=>{
  const{car,radio,sent,time}=rig();car.setSpeed(600);await car.pumpPromise;
  let release;radio.block=async p=>{if(p[1]===0x1a)await new Promise(resolve=>{release=resolve;});};
  car.refreshBattery();while(!release)await settle();time(2100);car.beginTelemetryGrace(3000,300);
  time(3000);release();await car.pumpPromise;
  assert.deepEqual(speeds(sent),[600,0]);assert.equal(car.connected,false);assert.equal(car.faulted,true);
  assert.equal(sent.filter(e=>e.at>=3000).some(e=>e.packet[1]===0x24&&(e.packet[2]||e.packet[3])),false);
});

test('STOP and an explicit restart never revive queued pre-stop degraded commands',async()=>{
  const{car,radio,sent,time}=rig();car.setSpeed(600);await car.pumpPromise;
  let release;radio.block=async p=>{if(p[1]===0x1a)await new Promise(resolve=>{release=resolve;});};
  car.refreshBattery();while(!release)await settle();time(2100);car.beginTelemetryGrace(3000,300);
  car.stop();car.setSpeed(150);release();await car.pumpPromise;
  assert.deepEqual(speeds(sent),[600,0,150]);assert.equal(car.telemetryGraceUntil,undefined);
});
