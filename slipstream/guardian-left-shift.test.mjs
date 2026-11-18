import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {decode,hex} from './protocol.mjs';
import {Pieces} from './track.mjs';
import {ReplayCar,validate} from './trace.mjs';

const file=readFileSync(new URL('./fixtures/guardian-sdk-left-shift-accepted-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const bothFile=readFileSync(new URL('./fixtures/guardian-sdk-left-right-shifts-accepted-2026-11-18.json',import.meta.url));
const bothTrace=validate(JSON.parse(bothFile));
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)}));
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const rightEvents=bothTrace.events.slice(32).map(([at,car,direction,text],index)=>({at,car,direction,text,index:index+32,packet:raw(text)}));
const rightRx=rightEvents.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const moving=packet=>packet[1]===0x24&&(packet[2]||packet[3]);
const stopping=packet=>packet[1]===0x24&&!packet[2]&&!packet[3];
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('accepted Guardian left trace preserves its reference, single lane request, registration and bounded STOP',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'2da8ac2f1b6cdc9596584cbf26b57d73763db0311711d43719af5beb6771212d');
  assert.equal(trace.events.length,32);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual([trace.cars[0].profile,trace.cars[0].firmware],['sdk',11866]);
  const optical=rx.filter(e=>e.message.type==='position');assert.equal(optical.length,1);
  assert.deepEqual([optical[0].index,optical[0].at,optical[0].message.pieceId,optical[0].message.locationId,optical[0].message.reverse],[22,44042,39,22,true]);
  const spot=new Pieces(data('pieces')).locate(39,22,true);
  assert.deepEqual(spot,{progress:.5,lateral:-4.5});assert.equal((1-spot.progress)*560,280);
  assert.deepEqual(tx.filter(e=>e.at>=42603).map(e=>[e.index,e.at,e.text]),[
    [18,42604,'06 24 00 00 c4 09 00'],[19,42607,'06 24 2c 01 e8 03 00'],
    [23,44043,'05 2c 00 00 90 40'],[24,44044,'0b 25 5e 01 e8 03 00 00 90 c1 00 01'],
    [29,44794,'06 24 00 00 c4 09 00']
  ]);
  assert.equal(44042-42607,1435);assert.equal(44794-44044,750);
  const lane=rx.find(e=>e.message.type==='laneChange');
  assert.deepEqual([lane.index,lane.at,lane.message.laneChangeId,lane.message.cancelled,lane.message.horizontalSpeed],[27,44432,1,false,0]);
  assert.equal(lane.at-44044,388);assert.equal(lane.message.currentOffset,lane.message.targetOffset);
  assert.ok(Math.abs(lane.message.currentOffset-(-20.14))<1e-5);
  const ack=rx.find(e=>e.index===28).message;
  assert.deepEqual([ack.lastReceivedLaneChangeId,ack.lastExecutedLaneChangeId,ack.desiredLaneSpeed],[1,1,350]);
  assert.equal(tx.some(e=>[0x26,0x32,0x34].includes(e.packet[1])),false);
  assert.equal(rx.some(e=>['delocalized','delocRecoveryEntered','delocRecoverySucceeded'].includes(e.message.type)),false);
  assert.equal(rx.filter(e=>e.message.type==='battery').at(-1).message.millivolts,3791);
  assert.equal(trace.diagnostics.pitReason,null);
  // Registration and a stopped host are distinct from the operator's physical
  // acceptance, which is explicitly included in this final immutable export.
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
  assert.match(trace.diagnostics.operatorNotes,/physically stopped, clearly shifted left relative to travel, stayed on track/);
});

test('accepted right continuation preserves the left prefix, opposite target and independent operator confirmation',()=>{
  assert.equal(createHash('sha256').update(bothFile).digest('hex'),'81d726d86f5ca2863730eb0fb3117896f135b299e23d0cbb60485e00aa74c00e');
  assert.equal(bothTrace.events.length,48);assert.equal(bothTrace.dropped,0);assert.equal(bothTrace.markersDropped,0);
  assert.deepEqual(bothTrace.events.slice(0,32),trace.events);
  const optical=rightRx.find(e=>e.message.type==='position');
  assert.deepEqual([optical.index,optical.at,optical.message.pieceId,optical.message.locationId,optical.message.reverse],[40,115775,39,31,true]);
  const spot=new Pieces(data('pieces')).locate(39,31,true);
  assert.deepEqual(spot,{progress:.5,lateral:22.5});assert.equal(spot.lateral-22.5,0);
  assert.deepEqual(rightEvents.filter(e=>e.direction==='tx'&&e.at>=114362).map(e=>[e.index,e.at,e.text]),[
    [35,114363,'06 24 00 00 c4 09 00'],[36,114363,'06 24 2c 01 e8 03 00'],
    [41,115776,'05 2c 00 00 b4 c1'],[42,115776,'0b 25 5e 01 e8 03 00 00 00 80 00 02'],
    [45,116527,'06 24 00 00 c4 09 00']
  ]);
  const lane=rightRx.find(e=>e.message.type==='laneChange'),ack=rightRx.find(e=>e.index===44).message;
  assert.deepEqual([lane.at,lane.message.cancelled,lane.message.laneChangeId,lane.message.horizontalSpeed],[116136,false,2,0]);
  assert.deepEqual([ack.lastReceivedLaneChangeId,ack.lastExecutedLaneChangeId,ack.desiredLaneSpeed],[2,2,350]);
  assert.equal(lane.at-115776,360);assert.equal(116527-115776,751);assert.equal(115775-114363,1412);
  assert.equal(rightRx.find(e=>e.message.type==='battery').message.millivolts,3752);
  assert.equal(rightRx.some(e=>['delocalized','delocRecoveryEntered','delocRecoverySucceeded'].includes(e.message.type)),false);
  assert.equal(bothTrace.diagnostics.pitReason,null);assert.equal(bothTrace.diagnostics.cars[0].physicalStopVerified,false);
  assert.match(bothTrace.diagnostics.operatorNotes,/BOTH tests physically stopped, clearly shifted in requested direction, stayed on track/);
});

test('actual SDK Game replay with an advancing clock sends each accepted direction once and remains stopped',async()=>{
  let now=0,reads=0;const clock=()=>now+reads++*.01,time=t=>{now=t;reads=0;};
  const radio=new ReplayCar(bothTrace,0);radio.initializationProfile='sdk';const timers=[],writes=[];
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock,
    schedule:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},unschedule:t=>{t.cancelled=true;}});
  const driver=game.addCar(radio,{name:'Guardian',model:12,control:'browser'});
  driver.car.tap=(direction,packet)=>{if(direction==='tx')writes.push({at:clock(),packet:Uint8Array.from(packet),text:hex(packet)});};
  async function advance(at,tick=true){time(at);radio.advance(at);if(tick)game.tick(.04);await driver.car.pumpPromise;}
  await settle();
  for(const at of [...new Set(events.filter(e=>e.at<=300).map(e=>e.at))]){await advance(at,false);await settle();}
  await driver.car.initialization;await driver.car.pumpPromise;
  game.loadTrack(trace.diagnostics.track);game.stopAll();await driver.car.pumpPromise;game.topSpeed=300;
  await advance(28684);driver.car.refreshBattery();await driver.car.pumpPromise;await advance(28747);
  await advance(42603);const before=writes.length;game.startDiagnostic(driver,{steering:true,direction:1});await driver.car.pumpPromise;
  for(const e of rx.filter(e=>e.at>=42663&&e.at<=44703))await advance(e.at);
  assert.equal(game.diagnostic.laneRequested,true);assert.equal(driver.car.telemetry.laneRequest.target,18);
  assert.equal(driver.car.telemetry.laneRequest.offset,-18);assert.equal(driver.car.telemetry.laneChange.cancelled,false);
  assert.deepEqual([driver.car.telemetry.laneAcknowledgment.received,driver.car.telemetry.laneAcknowledgment.executed],[1,1]);
  assert.equal(timers.length,2);assert.ok(Math.abs(timers[1].ms-750)<1e-6);
  await advance(44794);assert.equal(game.diagnostic,null);assert.equal(game.halted,true);assert.equal(game.pitReason,null);
  assert.deepEqual(writes.slice(before).map(e=>e.text),[
    '06 24 00 00 c4 09 00','06 24 2c 01 e8 03 00','05 2c 00 00 90 40',
    '0b 25 5e 01 e8 03 00 00 90 c1 00 01','06 24 00 00 c4 09 00'
  ]);
  const lane=writes.slice(before).find(e=>e.packet[1]===0x25),stop=writes.at(-1);
  assert.ok(stop.at-lane.at>=750&&stop.at-lane.at<755,'replay uses advancing synthetic sub-millisecond timing, not exact physical timing');
  const afterStop=writes.length;await advance(45422);for(const timer of timers)timer.fn();
  driver.input={throttle:1,lane:45,attack:true};await advance(50000);
  assert.equal(driver.car.speed,0);assert.ok(writes.slice(afterStop).every(e=>stopping(e.packet)));
  assert.equal(writes.slice(before).filter(e=>moving(e.packet)).length,1);
  assert.equal(writes.slice(before).filter(e=>e.packet[1]===0x25).length,1);
  // The operator next refreshes battery and explicitly starts a separate right
  // test. The stopped gap must neither resume motion nor consume its watchdog.
  await advance(100810);driver.car.refreshBattery();await driver.car.pumpPromise;await advance(100864);
  assert.equal(driver.car.millivolts,3752);assert.equal(driver.car.speed,0);
  await advance(114362);const beforeRight=writes.length;game.startDiagnostic(driver,{steering:true,direction:-1});await driver.car.pumpPromise;
  for(const e of rightRx.filter(e=>e.at>=114425&&e.at<=116435))await advance(e.at);
  assert.equal(game.diagnostic.laneRequested,true);assert.equal(driver.car.telemetry.laneRequest.target,0);
  assert.ok(Object.is(driver.car.telemetry.laneRequest.offset,-0),'wire preserves signed zero from the unchanged offset conversion');
  assert.equal(driver.car.telemetry.laneChange.cancelled,false);
  assert.deepEqual([driver.car.telemetry.laneAcknowledgment.received,driver.car.telemetry.laneAcknowledgment.executed],[2,2]);
  await advance(116527);
  assert.deepEqual(writes.slice(beforeRight).map(e=>e.text),[
    '06 24 00 00 c4 09 00','06 24 2c 01 e8 03 00','05 2c 00 00 b4 c1',
    '0b 25 5e 01 e8 03 00 00 00 80 00 02','06 24 00 00 c4 09 00'
  ]);
  const afterRight=writes.length;await advance(117215);for(const timer of timers)timer.fn();
  driver.input={throttle:1,lane:-45,attack:true};await advance(120000);
  assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);assert.equal(game.pitReason,null);
  assert.ok(writes.slice(afterRight).every(e=>stopping(e.packet)));
  assert.equal(writes.slice(before).filter(e=>moving(e.packet)).length,2);
  assert.equal(writes.slice(before).filter(e=>e.packet[1]===0x25).length,2);
  assert.equal(driver.car.diagnostics().physicalStopVerified,false);
});
