import test from 'node:test';
import assert from 'node:assert/strict';
import {Car} from './car.mjs';
import {Recorder} from './trace.mjs';
import {hex} from './protocol.mjs';
import {initializationPhases} from './initialization.mjs';

function radio({replies=true, confirmation=true}={}) {
 let notify;
 const sent=[];
 return {initializationProfile:'fast-furious',initializationTimeoutMs:30,sent,
  onNotify(fn){notify=fn;return()=>{};},close(){this.closed=true;},
  async write(b){sent.push([...b]);if(confirmation && b[1]===0x49)queueMicrotask(()=>notify(Uint8Array.of(3,0x23,255,255)));if(replies && b[1]===0x16)queueMicrotask(()=>notify(Uint8Array.of(1,0x17)));
   if(replies && b[1]===0x18)queueMicrotask(()=>notify(Uint8Array.of(5,0x19,0x27,0x25,0,0)));}
 };
}
test('F&F initialization confirms ordered phases without allowing motor commands',async()=>{
 const r=radio(),car=new Car(r),rec=new Recorder();rec.start([{car}]);
 const ready=car.start();car.setSpeed(500);car.steerTo(22.5);await ready;await car.pumpPromise;
 assert.equal(car.initializing,false);assert.equal(car.faulted,false);assert.equal(car.version,9511);
 assert.equal(r.sent.some(b=>b[1]===0x25),false);
 assert.ok(r.sent.filter(b=>b[1]===0x24).every(b=>b[2]===0&&b[3]===0));
 const commands=r.sent.filter(b=>![0x24,0x1a,0x33].includes(b[1])).map(b=>b[1]);
 assert.deepEqual(commands,[0x90,0x16,0x18,0x22,0x16,0x45,0x16,0x21,0x46,0x48,0x49,0x16,0x37,0x16]);
 assert.ok(rec.events.some(e=>e[2]==='tx'&&e[3]==='03 90 00 00'),'startup recording includes mode switch');
 assert.ok(rec.events.some(e=>e[2]==='rx'&&e[3]==='01 17'));
});
test('missing initialization acknowledgment closes connection and never advances mode',async()=>{
 const r=radio({replies:false}),car=new Car(r);await car.start();
 assert.equal(car.connected,false);assert.equal(car.faulted,true);assert.equal(r.closed,true);
 assert.match(car.initializationStatus,/response timed out/);
 assert.equal(r.sent.some(b=>b[1]===0x22),false);assert.equal(car.speed,0);
});
test('STOP during initialization remains latched after acknowledgments finish',async()=>{
 const r=radio(),car=new Car(r);const ready=car.start();car.safetyStop('Host stopped');await ready;
 car.setSpeed(400);await car.pumpPromise;assert.equal(car.speed,0);assert.equal(car.safetyReason,'Host stopped');
});
test('F&F road defaults match independent native-memory extraction',()=>{
 const phase=initializationPhases('fast-furious').find(p=>p.name==='Default road network');
 assert.deepEqual(phase.packets.map(hex),['01 21',
 '13 46 01 02 01 3e 01 44 00 00 00 00 00 00 00 00 00 00 00 00',
 '13 48 01 0d 8a 0a 0a 0a 0a 0a 0b 0a 0a 4a 4b 4b 80 00 00 00',
 '08 49 01 10 00 01 02 00 0d']);
 assert.throws(()=>initializationPhases('guess'),/Unknown/);
});

test('F&F pongs alone cannot confirm firmware initialization',async()=>{
 const r=radio({confirmation:false}),car=new Car(r);await car.start();
 assert.equal(car.faulted,true);assert.equal(car.connected,false);
 assert.match(car.initializationStatus,/confirmation.*timed out/i);
});
test('F&F retains native initialization confirmation and upgrades',async()=>{
 const r=radio(),car=new Car(r);await car.start();
 assert.deepEqual(car.firmwareInitialization,{id:0x23,type:'carInit',upgrades:65535});
 assert.equal(car.faulted,false);
});
