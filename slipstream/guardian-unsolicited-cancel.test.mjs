import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {decode,hex} from './protocol.mjs';
import {ReplayCar,validate} from './trace.mjs';

// Original cumulative capture, including the earlier no-attempt trial. An
// unsolicited cancellation here means no matching host command in this record;
// it does not establish which internal or retained firmware state produced it.
const file=readFileSync(new URL('./fixtures/guardian-sdk-unsolicited-lane-cancel-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const previous=JSON.parse(readFileSync(new URL('./fixtures/guardian-sdk-lane-no-attempt-late-straight-2026-11-18.json',import.meta.url)));
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)}));
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const moving=packet=>packet[1]===0x24&&(packet[2]||packet[3]);
const stopping=packet=>packet[1]===0x24&&!packet[2]&&!packet[3];
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('frozen Guardian retry receives a cancellation without any host lane request or new optical reference',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'331055a00d4bc6b4b2d23d5e2ad9500900e7040e48c8fb8ca14f7aa2e1bf77f1');
  assert.equal(trace.events.length,52);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual(trace.events.slice(0,29),previous.events,'earlier attempt retained verbatim');
  assert.deepEqual([trace.cars[0].profile,trace.cars[0].firmware],['sdk',11866]);
  assert.equal(tx.some(e=>[0x25,0x26,0x32,0x34].includes(e.packet[1])),false,'neither trial issued a host lane, cancel-lane or turn command');
  assert.deepEqual(tx.filter(e=>e.at>=1164849).map(e=>[e.index,e.at,e.text]),[
    [40,1164851,'06 24 00 00 c4 09 00'],[41,1164851,'06 24 2c 01 e8 03 00'],[48,1166131,'06 24 00 00 c4 09 00']
  ]);
  const retry=rx.filter(e=>e.at>=1164849);
  assert.equal(retry.some(e=>['position','transition'].includes(e.message.type)),false);
  assert.deepEqual(rx.filter(e=>e.message.type==='position').map(e=>e.index),[18,21,22,24]);
  const cancel=retry.find(e=>e.message.type==='laneChange');
  assert.deepEqual([cancel.index,cancel.at,cancel.at-1164851,cancel.message.cancelled,cancel.message.laneChangeId],[47,1166130,1279,true,0x81]);
  assert.equal(cancel.message.currentOffset,65.24400329589844);assert.equal(cancel.message.targetOffset,cancel.message.currentOffset);
  assert.deepEqual([cancel.message.horizontalSpeed,cancel.message.verticalSpeed],[0,300]);
  assert.equal(tx.find(e=>e.at>cancel.at).at-cancel.at,1,'host STOP follows cancellation, rather than causing it');
  const status=retry.find(e=>e.message.type==='status');
  assert.deepEqual([status.at-1164851,status.message.onTrack,status.message.lowBattery,status.message.onCharger],[670,false,false,false]);
  assert.equal(retry.find(e=>e.message.type==='intersection').at-1164851,1039);
  assert.equal(retry.some(e=>['delocalized','delocRecoveryEntered','delocRecoverySucceeded'].includes(e.message.type)),false);
  assert.equal(rx.filter(e=>e.message.type==='battery').at(-1).message.millivolts,3894);
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
});

test('stopped-interval transition raised a STOP alarm and the pit was explicitly cleared before retry',()=>{
  const late=rx.find(e=>e.index===30);
  assert.equal(late.message.type,'transition');assert.equal(late.at,1127969);
  assert.equal(late.message.lastReceivedLaneChangeId,255);assert.equal(late.message.lastExecutedLaneChangeId,255);
  assert.deepEqual(tx.filter(e=>e.at>late.at&&e.at<1153789).map(e=>[e.at,e.text]),[
    [1128015,'06 24 00 00 c4 09 00'],[1128015,'06 24 00 00 c4 09 00']
  ]);
  assert.ok(trace.markers.some(m=>m.timeMs===1128009&&m.details.text==='Guardian: STOP not confirmed: telemetry continues'));
  assert.ok(trace.markers.some(m=>m.timeMs===1158353&&m.kind==='pit-cleared-stopped'));
  assert.deepEqual(tx.filter(e=>e.at>24170&&e.at<1164851&&moving(e.packet)),[]);
  // Telemetry while stopped also occurs during physical handling; the packet
  // alone cannot prove powered motion or failure to obey the earlier STOP.
});

test('actual Game replay stops on unsolicited cancellation and cannot restart or steer from late telemetry',async()=>{
  let now=0;const radio=new ReplayCar(trace,0);radio.initializationProfile='sdk';const timers=[],logs=[],writes=[];
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,log:text=>logs.push(text),
    schedule:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},unschedule:t=>{t.cancelled=true;}});
  const driver=game.addCar(radio,{name:'Guardian',model:12,control:'browser'});
  driver.car.tap=(direction,packet)=>{if(direction==='tx')writes.push({at:now,packet:Uint8Array.from(packet),text:hex(packet)});};
  async function advance(at,tick=true){now=at;radio.advance(now);if(tick)game.tick(.04);await driver.car.pumpPromise;}
  await settle();
  for(const at of [...new Set(events.filter(e=>e.at<=299).map(e=>e.at))]){await advance(at,false);await settle();}
  await driver.car.initialization;await driver.car.pumpPromise;
  game.loadTrack(trace.diagnostics.track);game.stopAll();await driver.car.pumpPromise;game.topSpeed=300;
  await advance(20168);game.startDiagnostic(driver,{steering:true,direction:1});await driver.car.pumpPromise;
  for(const e of rx.filter(e=>e.at>=20221&&e.at<24168))await advance(e.at);
  await advance(24168);assert.equal(game.diagnostic,null);assert.equal(game.pitReason,null);
  await advance(1000410);await advance(1127969,false);await advance(1128009);
  assert.match(game.pitReason,/STOP not confirmed/);assert.equal(driver.car.speed,0);
  assert.ok(logs.some(text=>text.includes('STOP not confirmed: telemetry continues')));
  await advance(1128658);await advance(1153789);assert.equal(game.recoverCar(driver),true);await driver.car.pumpPromise;
  await advance(1154029);driver.car.refreshBattery();await driver.car.pumpPromise;await advance(1154070);
  assert.equal(driver.car.millivolts,3894);
  await advance(1158353);assert.equal(game.clearPitStopped(),true);await driver.car.pumpPromise;
  assert.equal(game.halted,true);assert.equal(driver.car.speed,0);assert.equal(game.pitReason,null);
  await advance(1161828);game.stopAll();await driver.car.pumpPromise;
  await advance(1164849);const before=writes.length;game.startDiagnostic(driver,{steering:true,direction:1});await driver.car.pumpPromise;
  const pulse=game.diagnostic;
  for(const e of rx.filter(e=>e.at>=1164900&&e.at<1166130)){
    await advance(e.at);assert.equal(game.diagnostic.laneRequested,false);assert.equal(driver.car.speed,300);
  }
  assert.deepEqual(writes.slice(before).map(e=>e.text),['06 24 00 00 c4 09 00','06 24 2c 01 e8 03 00']);
  await advance(1166130,false); // Message handling must STOP without needing a control-loop tick.
  assert.equal(pulse.laneRequested,false);assert.equal(game.diagnostic,null);assert.equal(driver.car.speed,0);
  assert.match(game.pitReason,/Lane change cancelled by car/);assert.equal(game.halted,true);
  assert.equal(writes.at(-1).at,1166130);assert.ok(stopping(writes.at(-1).packet));
  assert.equal(driver.car.telemetry.positions,4);assert.equal(driver.car.telemetry.transitions,4);
  const afterStop=writes.length;
  for(const e of rx.filter(e=>e.at>1166130))await advance(e.at);
  // Counterfactual late, eligible optical code (simulator-only): no new lane or
  // positive-speed write may escape the cancellation latch.
  now=1168000;const late=raw(trace.events[18][3]);late[2]=35;
  for(const notify of radio.listeners)notify(late);await driver.car.pumpPromise;
  for(const timer of timers)timer.fn();driver.input={throttle:1,lane:54,attack:true};game.tick(.04);await driver.car.pumpPromise;
  assert.equal(driver.car.speed,0);assert.equal(game.halted,true);assert.ok(game.pitReason);
  assert.ok(writes.slice(afterStop).every(e=>stopping(e.packet)));
  assert.equal(writes.slice(before).filter(e=>moving(e.packet)).length,1);
  assert.equal(writes.slice(before).some(e=>[0x25,0x2c,0x32,0x34].includes(e.packet[1])),false);
  assert.equal(driver.car.diagnostics().physicalStopVerified,false);
});
