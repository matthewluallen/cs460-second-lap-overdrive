import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {decode,hex} from './protocol.mjs';
import {ReplayCar,validate} from './trace.mjs';

const file=readFileSync(new URL('./fixtures/guardian-sdk-lane-no-attempt-low-battery-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)})).filter(e=>e.car===1);
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const moving=packet=>packet[1]===0x24&&(packet[2]||packet[3]);
const stopping=packet=>packet[1]===0x24&&!packet[2]&&!packet[3];
const settle=()=>new Promise(resolve=>setImmediate(resolve));
// Synthetic ordinary-straight sample for a counterfactual late maneuver. This
// is not part of the captured seven-piece run or new hardware evidence.
const lateStraight=raw('10 27 0f 24 00 00 b4 c1 2c 01 07 ff ff 00 00 2c 01');

function makeGame(clock,timers,logs=[]) {
  return new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock,log:message=>logs.push(message),
    schedule:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},unschedule:t=>{t.cancelled=true;}});
}
async function rig() {
  let now=0,notify;const timers=[],logs=[];
  const radio={initializationProfile:'sdk',sent:[],onNotify(fn){notify=fn;return()=>{};},close(){},emit(bytes){notify(Uint8Array.from(bytes));},async write(bytes){
    this.sent.push([...bytes]);
    if(bytes[1]===0x16)queueMicrotask(()=>this.emit([1,0x17]));
    if(bytes[1]===0x18)queueMicrotask(()=>this.emit([3,0x19,0x5a,0x2e]));
  }};
  const game=makeGame(()=>now,timers,logs),driver=game.addCar(radio,{name:'Guardian',model:12,control:'browser'});
  await driver.car.initialization;await driver.car.pumpPromise;
  game.loadTrack(trace.diagnostics.track);game.stopAll();await driver.car.pumpPromise;
  radio.emit([3,0x1b,0,16]);radio.emit([5,0x3f,1,0,0,1]);game.topSpeed=300;radio.sent=[];
  return {game,driver,radio,timers,logs,time:t=>{now=t;}};
}

test('frozen Guardian trial reports low battery before deadline STOP and never attempted a lane change',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'3c2dc7aec7e200b6b203a425c73523cb6e36d823c38de93aa39c12ef0fc3947d');
  assert.equal(trace.events.length,46);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual([trace.cars[1].driverId,trace.cars[1].profile,trace.cars[1].firmware],[2,'sdk',11866]);
  assert.deepEqual(tx.filter(e=>moving(e.packet)).map(e=>[e.index,e.at,e.text]),[[31,80795,'06 24 2c 01 e8 03 00']]);
  const health=rx.find(e=>e.message.type==='status'&&e.message.lowBattery);
  assert.deepEqual([health.index,health.at,health.at-80795,health.message.onCharger],[34,81154,359,false]);
  assert.deepEqual(tx.filter(e=>e.at>health.at).map(e=>[e.at,e.text]),[[84790,'06 24 00 00 c4 09 00']]);
  assert.equal(84790-80795,3995);
  assert.equal(tx.some(e=>[0x25,0x2c,0x32,0x34].includes(e.packet[1])),false);
  const optical=rx.filter(e=>e.message.type==='position');
  assert.deepEqual(optical.map(e=>e.message.pieceId),[33,17,17,20,20]);
  assert.equal(optical.length,5);assert.equal(rx.filter(e=>e.message.type==='transition').length,3);
  const g=makeGame(()=>0,[]);
  assert.ok(optical.every(e=>g.pieces.get(e.message.pieceId)?.kind!=='straight'));
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
  // Recorded behavior is evidence of the gap, not the repaired outcome below.
});

test('actual Game replay stops immediately on captured low-battery status and later optical traffic cannot send a lane or restart',async()=>{
  let now=0;const radio=new ReplayCar(trace,1);radio.initializationProfile='sdk';
  const timers=[],game=makeGame(()=>now,timers),driver=game.addCar(radio,{name:'Guardian',model:12,control:'browser'});
  const writes=[];driver.car.tap=(direction,packet)=>{if(direction==='tx')writes.push({at:now,packet:Uint8Array.from(packet),text:hex(packet)});};
  await settle();
  for(const at of [...new Set(events.filter(e=>e.at<=62343).map(e=>e.at))]){now=at;radio.advance(now);await settle();}
  await driver.car.initialization;await driver.car.pumpPromise;
  game.loadTrack(trace.diagnostics.track);game.stopAll();await driver.car.pumpPromise;game.topSpeed=300;
  now=80789;radio.advance(now);game.startDiagnostic(driver,{steering:true,direction:1});await driver.car.pumpPromise;
  for(const event of rx.filter(e=>e.at>=80855&&e.at<=81154)){now=event.at;radio.advance(now);await driver.car.pumpPromise;}
  assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);assert.match(game.pitReason,/low battery/i);
  assert.ok(writes.some(e=>e.at===81154&&stopping(e.packet)),'repaired STOP is queued by status handling without waiting for a game tick or deadline');
  assert.ok(timers.every(t=>t.cancelled));
  const afterHealth=writes.length;
  now=81200;for(const notify of radio.listeners)notify(lateStraight);await driver.car.pumpPromise;
  for(const event of rx.filter(e=>e.at>81154)){now=event.at;radio.advance(now);game.tick(.04);await driver.car.pumpPromise;}
  for(const timer of timers)timer.fn();driver.input={throttle:1,lane:45,attack:true};now=90000;game.tick(.04);await driver.car.pumpPromise;
  assert.equal(game.halted,true);assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);assert.ok(game.pitReason);
  assert.ok(writes.slice(afterHealth).every(e=>stopping(e.packet)));
  assert.equal(writes.filter(e=>moving(e.packet)).length,1);
  assert.equal(writes.some(e=>[0x25,0x2c,0x32,0x34].includes(e.packet[1])),false);
});

for(const steering of [false,true])for(const flag of ['lowBattery','onCharger'])test((steering?'steering':'straight')+' diagnostic latches immediate STOP for a new '+flag+' report',async()=>{
  const {game,driver,radio,timers,time}=await rig();game.startDiagnostic(driver,{steering,direction:-1});await driver.car.pumpPromise;
  time(100);radio.emit(flag==='lowBattery'?[5,0x3f,1,0,1,0]:[5,0x3f,1,1,0,0]);await driver.car.pumpPromise;
  assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);assert.match(game.pitReason,/charging|low battery/i);
  assert.ok(timers.every(t=>t.cancelled));const atStop=radio.sent.length;
  time(200);radio.emit(lateStraight);radio.emit([5,0x3f,1,0,0,1]);await driver.car.pumpPromise;
  for(const timer of timers)timer.fn();game.tick(.04,5000);await driver.car.pumpPromise;
  assert.equal(driver.car.speed,0);assert.equal(game.halted,true);assert.ok(game.pitReason);
  assert.ok(radio.sent.slice(atStop).every(stopping));assert.equal(radio.sent.filter(moving).length,1);
  assert.throws(()=>game.startDiagnostic(driver,{steering}),/clear the pit/);
});

test('diagnostic health guard does not reinterpret an ordinary onTrack:false startup status as a new stop policy',async()=>{
  for(const steering of [false,true]){
    const {game,driver,radio,time}=await rig();game.startDiagnostic(driver,{steering});await driver.car.pumpPromise;
    time(100);radio.emit([5,0x3f,0,0,0,0]);await driver.car.pumpPromise;
    assert.equal(driver.car.speed,steering?300:150);assert.ok(game.diagnostic);assert.equal(game.pitReason,null);
    game.stopAll();await driver.car.pumpPromise;
  }
});

test('expired steering acquisition explicitly reports that no lane request was sent',async()=>{
  const {game,driver,timers,logs,time}=await rig();game.startDiagnostic(driver,{steering:true,direction:-1});await driver.car.pumpPromise;
  time(4000);timers[0].fn();await driver.car.pumpPromise;
  assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);
  assert.match(logs.at(-1),/no lane request sent.*no eligible ordinary-straight reading.*STOP requested/i);
});
