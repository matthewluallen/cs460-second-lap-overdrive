// Independent byte-level peer: no SimCar, encode(), or initializationPhases().
// Evidence: build 403 constructors/serializers and live startup captures.
// This is a finite protocol contract, NOT original firmware execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Car} from './car.mjs';
import {decode} from './protocol.mjs';

const fromHex = text => Uint8Array.from(text.split(' ').map(x=>parseInt(x,16)));
function peer({drop=-1, confirmation='early'}={}) {
 let receive, barriers=0;
 const writes=[];
 return {initializationProfile:'fast-furious',initializationTimeoutMs:20,writes,
  notify(bytes){receive(bytes);},
  onNotify(fn){receive=fn;return()=>{receive=()=>{};};},close(){this.closed=true;},
  async write(bytes){
   assert.equal(bytes.length,bytes[0]+1,'declared frame length');
   writes.push([...bytes]);
   const id=bytes[1];
   if(id===0x49 && confirmation==='early') queueMicrotask(()=>receive(fromHex('03 23 ff ff')));
   if(id===0x16 || id===0x18){
    const barrier=barriers++;
    if(barrier===drop) return;
    queueMicrotask(()=>receive(fromHex(id===0x18?'05 19 5a 2e 00 00':'01 17')));
    if(barrier===5 && confirmation==='late') setTimeout(()=>receive(fromHex('03 23 ff ff')),1);
   }
  }
 };
}

test('bounded startup fault matrix: every reply barrier, confirmation order and STOP latch',async()=>{
 let cases=0;
 for(const drop of [-1,0,1,2,3,4,5]) for(const confirmation of ['early','late','missing']) for(const halt of [false,true]) {
  const transport=peer({drop,confirmation});const car=new Car(transport);
  const ready=car.start();
  car.setSpeed(300);car.steerTo(22.5);car.uturn();
  if(halt) car.safetyStop('Operator STOP');
  await ready;await car.pumpPromise;
  const context=JSON.stringify({drop,confirmation,halt});
  assert.equal(car.faulted,drop!==-1 || confirmation==='missing',context);
  assert.equal(car.speed,0,context);
  assert.ok(transport.writes.filter(b=>b[1]===0x24).every(b=>b[2]===0&&b[3]===0),context);
  assert.ok(!transport.writes.some(b=>b[1]===0x25||b[1]===0x32),context);
  if(halt && !car.faulted) {
   car.setSpeed(300);await car.pumpPromise;
   assert.equal(car.speed,0,context);
   assert.equal(car.safetyReason,'Operator STOP',context);
  }
  cases++;
 }
 assert.equal(cases,42);
});

test('native init-complete is diagnostic, exact-length and never track telemetry',()=>{
 assert.deepEqual(decode(fromHex('03 23 ff ff')),[{id:0x23,type:'carInit',upgrades:65535}]);
 for(const frame of ['01 23','02 23 ff','04 23 ff ff 00']) assert.equal(decode(fromHex(frame))[0].type,'other');
 // ff ff is an upgrades bitfield, not an error code and not a position.
 const t=peer();const car=new Car(t);t.notify(fromHex('03 23 ff ff'));
 assert.equal(car.firmwareInitialization.upgrades,65535);
 assert.equal(car.lastTrackAt,undefined);
});
