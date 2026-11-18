import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {decode,hex} from './protocol.mjs';
import {Pieces} from './track.mjs';
import {ReplayCar,validate} from './trace.mjs';

// Frozen charged-car capture: no lane command was attempted. Its later physical
// outcome remains an operator observation, separate from these replay checks.
const file=readFileSync(new URL('./fixtures/guardian-sdk-lane-no-attempt-late-straight-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)}));
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const pieces=new Pieces(data('pieces'));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const moving=packet=>packet[1]===0x24&&(packet[2]||packet[3]);

test('charged Guardian recording identifies a late straight code followed only by curves',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'aea4422fb668da9b915687faefc439620d5d70d5e8e6a94832986b2674f602dd');
  assert.equal(trace.events.length,29);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual([trace.cars[0].profile,trace.cars[0].firmware],['sdk',11866]);
  const optical=rx.filter(e=>e.message.type==='position');
  assert.deepEqual(optical.map(e=>[e.index,e.at,e.message.pieceId,e.message.locationId,e.message.reverse]),[
    [18,21333,39,33,true],[21,22172,17,8,false],[22,22711,17,9,false],[24,24031,23,9,false]
  ]);
  assert.deepEqual(optical.map(e=>pieces.locate(e.message.pieceId,e.message.locationId,e.message.reverse).progress),[.786,.321,.731,.731]);
  assert.deepEqual(optical.map(e=>pieces.locate(e.message.pieceId,e.message.locationId,e.message.reverse).lateral),[31.5,31.5,31.5,31.5]);
  const first=optical[0],spot=pieces.locate(39,33,true);
  assert.equal(pieces.get(39).kind,'straight');assert.equal(pieces.get(39).length,560);
  assert.ok(Math.abs((1-spot.progress)*560-119.84)<1e-6);
  assert.equal(first.at-20170,1163);assert.equal(24168-first.at,2835);
  assert.ok(first.message.speed>0);assert.equal(spot.lateral+22.5,54);
  assert.ok((1-spot.progress)*560<250,'remaining straight distance is the failed gate');
  assert.ok(optical.slice(1).every(e=>pieces.get(e.message.pieceId).kind==='curve'));
  assert.equal(24168-optical.at(-1).at,137,'last curve also arrives inside the 750 ms maneuver window');
});

test('charged trial calibrates optically but sends no lane command before its four-second STOP',()=>{
  assert.deepEqual(rx.filter(e=>e.message.type==='battery').map(e=>e.message.millivolts),[4117]);
  assert.ok(rx.filter(e=>e.message.type==='status').every(e=>!e.message.lowBattery&&!e.message.onCharger));
  assert.equal(rx.some(e=>['delocalized','delocRecoveryEntered','delocRecoverySucceeded'].includes(e.message.type)),false);
  assert.deepEqual(tx.filter(e=>e.at>=20168).map(e=>[e.index,e.at,e.text]),[
    [14,20169,'06 24 00 00 c4 09 00'],[15,20170,'06 24 2c 01 e8 03 00'],
    [19,21334,'05 2c 00 00 fc c1'],[26,24170,'06 24 00 00 c4 09 00']
  ]);
  assert.equal(tx.some(e=>[0x25,0x32,0x34].includes(e.packet[1])),false);
  assert.equal(24170-20170,4000);assert.equal(trace.diagnostics.pitReason,null);
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
});

async function rig(recording=trace) {
  let now=0;const radio=new ReplayCar(recording,0);radio.initializationProfile='sdk';const timers=[];
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,
    schedule:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},unschedule:t=>{t.cancelled=true;}});
  const driver=game.addCar(radio,{name:'Guardian',model:12,control:'browser'}),writes=[];
  driver.car.tap=(direction,packet)=>{if(direction==='tx')writes.push({at:now,packet:Uint8Array.from(packet),text:hex(packet)});};
  await settle();
  for(const at of [...new Set(events.filter(e=>e.at<=299).map(e=>e.at))]){now=at;radio.advance(now);await settle();}
  await driver.car.initialization;await driver.car.pumpPromise;
  game.loadTrack(trace.diagnostics.track);game.stopAll();await driver.car.pumpPromise;game.topSpeed=300;
  now=20168;radio.advance(now);const before=writes.length;game.startDiagnostic(driver,{steering:true,direction:1});await driver.car.pumpPromise;
  return {game,driver,radio,writes,timers,before,async advance(at){now=at;radio.advance(now);game.tick(.04);await driver.car.pumpPromise;}};
}

test('actual Game replay rejects the late straight opportunity, calibrates normally and stops without a lane request',async()=>{
  const {game,driver,writes,before,advance,timers}=await rig();
  for(const e of rx.filter(e=>e.at>=20221&&e.at<24168)){
    await advance(e.at);assert.equal(game.diagnostic.laneRequested,false);
  }
  await advance(24168);for(const timer of timers)timer.fn();await driver.car.pumpPromise;
  assert.equal(game.diagnostic,null);assert.equal(game.pitReason,null);assert.equal(game.halted,true);assert.equal(driver.car.speed,0);
  assert.deepEqual(writes.slice(before).map(e=>e.text),[
    '06 24 00 00 c4 09 00','06 24 2c 01 e8 03 00','05 2c 00 00 fc c1','06 24 00 00 c4 09 00'
  ]);
  assert.equal(driver.car.telemetry.positions,4);assert.equal(driver.car.telemetry.transitions,3);
  driver.input={throttle:1,lane:45,attack:true};await advance(26000);
  assert.equal(driver.car.speed,0);assert.equal(writes.slice(before).filter(e=>moving(e.packet)).length,1);
});

test('synthetic earlier code on the same straight and lane qualifies without relaxing the time or distance gates',async()=>{
  // Counterfactual, simulator-only input: replace code33 with code35 at the same
  // notification time. This proves the host geometry gate, not physical success.
  const synthetic=structuredClone(trace),packet=raw(synthetic.events[18][3]);packet[2]=35;synthetic.events[18][3]=hex(packet);
  const spot=pieces.locate(39,35,true);
  assert.equal(spot.lateral,31.5);assert.ok(Math.abs(spot.progress-.214)<1e-9);
  assert.ok(Math.abs((1-spot.progress)*560-440.16)<1e-6);
  const {game,driver,writes,before,advance,timers}=await rig(synthetic);
  await advance(21333);
  assert.equal(game.diagnostic.laneRequested,true);assert.equal(game.diagnostic.until,22083);
  const lane=writes.slice(before).filter(e=>e.packet[1]===0x25);assert.equal(lane.length,1);
  assert.equal(new DataView(lane[0].packet.buffer).getFloat32(6,true),-54);
  assert.equal(timers[0].ms,4000);assert.ok(timers.some(t=>t.ms===750));
  await advance(22083);assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);
  assert.equal(writes.slice(before).filter(e=>moving(e.packet)).length,1);
  assert.equal(driver.car.diagnostics().physicalStopVerified,false);
});
