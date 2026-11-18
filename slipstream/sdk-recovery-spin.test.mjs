import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {decode,hex} from './protocol.mjs';
import {ReplayCar,validate} from './trace.mjs';

// Exact final export with the operator's later power-off observation. Replay
// verifies host behavior, not firmware mechanics, physical speed or stopping.
const file=readFileSync(new URL('./fixtures/groundshock-sdk-recovery-spin-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text])=>({at,car,direction,text,packet:raw(text)}));
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const positive=packet=>packet[1]===0x24 && (packet[2]||packet[3]);
const maneuver=packet=>[0x25,0x2c,0x32,0x34].includes(packet[1]);
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('SDK recovery-spin export preserves startup and operator power-off observation without invented optical evidence',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'3617ae69dfe2919c2d0567c81f88e8be2e5a26d1a055f202cf18bd6c4ed74686');
  assert.equal(trace.events.length,30);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual([trace.cars[0].profile,trace.cars[0].firmware,trace.cars[0].model],['sdk',11866,0]);
  assert.equal(trace.diagnostics.cars[0].name,'Groundshock');
  assert.deepEqual(tx.filter(e=>e.at<=180).map(e=>e.text),[
    '06 24 00 00 c4 09 00','03 90 01 01','01 16','01 18','06 24 00 00 c4 09 00','01 1a',
    '11 33 03 00 00 00 00 00 03 00 0e 0e 00 02 00 00 00 00'
  ]);
  assert.deepEqual(rx.filter(e=>e.message.type==='battery').map(e=>e.message.millivolts),[3834]);
  assert.equal(events.some(e=>e.direction==='rx'&&[0x27,0x29].includes(e.packet[1])),false);
  assert.equal(trace.diagnostics.cars[0].positions,0);assert.equal(trace.diagnostics.cars[0].transitions,0);
  assert.equal(trace.diagnostics.track,null);assert.equal(trace.diagnostics.cars[0].connected,false);
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false,'software does not promote an operator observation to sensor verification');
  assert.match(trace.diagnostics.operatorNotes,/powered off and stationary/);
});

test('firmware recovery precedes off-road and host STOP without any intervening host maneuver',()=>{
  const motion=tx.filter(e=>positive(e.packet));
  assert.deepEqual(motion.map(e=>[e.at,e.text]),[[16422,'06 24 2c 01 e8 03 00']]);
  assert.deepEqual(rx.filter(e=>['delocRecoveryEntered','delocRecoverySucceeded','delocalized'].includes(e.message.type))
    .map(e=>[e.at-motion[0].at,e.message.type]),[[1070,'delocRecoveryEntered'],[1280,'delocRecoverySucceeded'],[1339,'delocalized']]);
  assert.equal(tx.some(e=>e.at>16422&&e.at<17762),false);
  assert.deepEqual(tx.filter(e=>e.at>=17762&&e.at<=17763).map(e=>[e.at-16422,e.text]),[
    [1340,'06 24 00 00 c4 09 00'],[1341,'06 24 00 00 c4 09 00']
  ]);
  assert.equal(tx.some(e=>maneuver(e.packet)||[0x35,0x37,0x45].includes(e.packet[1])),false);
  assert.deepEqual(rx.filter(e=>e.message.type==='speed').map(e=>[e.at,e.message.desired,e.message.actual]),[[16471,300,0],[17821,0,0]]);
  assert.equal(tx.some(e=>e.at>17761&&positive(e.packet)),false);
  // The 1 ms interval is notification-to-write-completion, not braking latency.
});

test('accepted SDK scan uses the same forward bytes but acquires optical codes rather than entering recovery',()=>{
  const accepted=validate(json('./fixtures/groundshock-sdk-repaired-scan.json'));
  const commands=accepted.events.filter(e=>e[2]==='tx');
  assert.deepEqual(commands.filter(e=>positive(raw(e[3]))).map(e=>e[3]),['06 24 2c 01 e8 03 00']);
  assert.ok(commands.some(e=>e[3]==='03 90 01 01'));
  const messages=accepted.events.filter(e=>e[2]==='rx').flatMap(e=>decode(raw(e[3])).map(message=>({at:e[0],message})));
  const first=messages.find(e=>e.message.type==='position');
  assert.equal(first.at-22328,818);assert.equal(messages.filter(e=>e.message.type==='position').length,24);
  assert.equal(messages.some(e=>['delocRecoveryEntered','delocRecoverySucceeded','delocalized'].includes(e.message.type)),false);
  assert.deepEqual(messages.filter(e=>e.message.type==='battery').map(e=>e.message.millivolts),[4162]);
  // Different session history and battery readings are confounders, not a
  // demonstrated explanation for the physical outcome of the newer trial.
});

test('actual Game replay stops on off-road and late recovery success cannot revive speed or steering',async()=>{
  let now=0;const radio=new ReplayCar(trace,0);radio.initializationProfile='sdk';
  const game=new Game({pieces:json('./data/pieces.json'),weapons:json('./data/weapons.json'),vehicles:json('./data/vehicles.json'),clock:()=>now});
  const driver=game.addCar(radio,{name:'Groundshock',model:0,control:'none'});
  const writes=[];driver.car.tap=(direction,packet)=>{if(direction==='tx')writes.push({at:now,packet:Uint8Array.from(packet),text:hex(packet)});};
  await settle();
  for(const at of [...new Set(events.filter(e=>e.at<=361).map(e=>e.at))]){now=at;radio.advance(now);await settle();}
  await driver.car.initialization;await driver.car.pumpPromise;
  assert.equal(driver.car.initializing,false);assert.equal(driver.car.faulted,false);assert.equal(driver.car.version,11866);
  game.topSpeed=300;now=16421;radio.advance(now);game.startScan(driver);await driver.car.pumpPromise;
  const afterStart=writes.length;
  for(const event of rx.filter(e=>e.at>16422&&e.at<=17702)){
    now=event.at;radio.advance(now);game.tick(.04);await driver.car.pumpPromise;
    assert.equal(writes.length,afterStart,'status, collision and recovery replies do not issue new host driving commands');
  }
  assert.equal(driver.car.telemetry.recoveryEntered,1);assert.equal(driver.car.telemetry.recoverySucceeded,1);
  now=17761;radio.advance(now);game.tick(.04);await driver.car.pumpPromise;
  assert.equal(game.halted,true);assert.match(game.pitReason,/left the track/);assert.equal(driver.car.safetyReason,'Off track');
  assert.equal(driver.car.speed,0);assert.equal(game.scanner,null);assert.equal(game.track,null);
  assert.ok(writes.slice(afterStart).length>0);assert.ok(writes.slice(afterStart).every(e=>e.text==='06 24 00 00 c4 09 00'));
  assert.equal(writes.some(e=>maneuver(e.packet)),false);
  assert.deepEqual(writes.filter(e=>positive(e.packet)).map(e=>e.text),['06 24 2c 01 e8 03 00']);
  // Synthetic late notifications exercise ordering beyond the frozen capture.
  // They are explicitly injected, not presented as additional hardware evidence.
  const beforeLate=writes.length;
  for(const text of ['01 44','01 2b','01 44']){
    now+=100;for(const notify of radio.listeners)notify(raw(text));game.tick(.04);await driver.car.pumpPromise;
    assert.equal(driver.car.speed,0);assert.equal(driver.car.safetyReason,'Off track');assert.equal(game.halted,true);
  }
  assert.ok(writes.slice(beforeLate).length>0);
  assert.ok(writes.slice(beforeLate).every(e=>e.text==='06 24 00 00 c4 09 00'));
  assert.equal(driver.car.telemetry.positions,0);assert.equal(driver.car.telemetry.transitions,0);
  assert.equal(driver.car.diagnostics().physicalStopVerified,false);
});
