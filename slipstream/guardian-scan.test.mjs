import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {decode,hex} from './protocol.mjs';
import {ReplayCar,validate} from './trace.mjs';

// Unmodified export: trace car 2 is reconnected driver 4. Identity comes from
// operator isolation/manual selection, not an invented advertisement model.
// Physical stop and map acceptance were still pending when this was exported.
const file=readFileSync(new URL('./fixtures/guardian-sdk-scan-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const json=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text],index)=>({at,car,direction,text,index,packet:raw(text)})).filter(e=>e.car===2);
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));
const positive=packet=>packet[1]===0x24&&(packet[2]||packet[3]);
const stop=packet=>packet[1]===0x24&&!packet[2]&&!packet[3];
const expectedTrack=[[33,false],[17,false],[20,false],[39,true],[17,false],[23,false],[34,false]];
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('Guardian export retains isolated driver provenance and complete observed optical sequence',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'f65bcc19eadeda9c68bfedf3f099220d1019725abf7080f09506dfe151ddd592');
  assert.equal(trace.events.length,88);assert.equal(events.length,46);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual([trace.cars[2].driverId,trace.cars[2].profile,trace.cars[2].firmware,trace.cars[2].model],[4,'sdk',11866,0]);
  assert.equal(trace.diagnostics.cars[0].carId,4);assert.equal(trace.diagnostics.cars[0].name,'Guardian');
  assert.match(trace.diagnostics.operatorNotes,/only driver 3, Z\. Drive, disconnected/);
  assert.deepEqual(rx.filter(e=>e.message.type==='battery').map(e=>e.message.millivolts),[3762]);
  assert.equal(rx.filter(e=>e.message.type==='position').length,15);assert.equal(rx.filter(e=>e.message.type==='transition').length,8);
  assert.equal(rx.some(e=>['delocRecoveryEntered','delocRecoverySucceeded','delocalized'].includes(e.message.type)),false);
  assert.deepEqual(trace.diagnostics.track.map(p=>[p.id,p.reverse]),expectedTrack);
  assert.equal(trace.diagnostics.trackChecks.geometricClosure,true);assert.deepEqual(trace.diagnostics.trackChecks.inferred,[]);
  assert.deepEqual(trace.diagnostics.trackChecks.special,[]);assert.equal(trace.diagnostics.trackChecks.physicalValidation,false);
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
});

test('Guardian raw scan calibrates only after optical evidence and requests STOP after observed closure',()=>{
  assert.deepEqual(tx.filter(e=>e.at<=1408912).map(e=>e.text),[
    '06 24 00 00 c4 09 00','03 90 01 01','01 16','01 18','06 24 00 00 c4 09 00','01 1a',
    '11 33 03 00 00 00 00 00 03 00 0e 0e 00 02 00 00 00 00'
  ]);
  const motion=tx.filter(e=>positive(e.packet));assert.deepEqual(motion.map(e=>[e.index,e.at,e.text]),[[57,1432500,'06 24 2c 01 e8 03 00']]);
  const first=rx.find(e=>e.message.type==='position');
  assert.deepEqual([first.index,first.at-motion[0].at,first.message.pieceId,first.message.locationId,first.message.offset],[60,832,33,6,654321]);
  assert.deepEqual(tx.filter(e=>e.packet[1]===0x2c).map(e=>[e.index,e.at,e.text]),[[61,1433333,'05 2c 00 00 58 c1']]);
  assert.equal(tx.some(e=>[0x25,0x32,0x34,0x35,0x37,0x45].includes(e.packet[1])),false);
  const closure=rx.filter(e=>e.message.type==='transition').at(-1);assert.equal(closure.index,83);
  assert.deepEqual(tx.filter(e=>e.at>closure.at).map(e=>[e.index,e.at-closure.at,e.text]),[
    [84,3,'06 24 00 00 c4 09 00'],[85,3,'06 24 00 00 c4 09 00']
  ]);
  assert.deepEqual(rx.filter(e=>e.message.type==='speed').map(e=>[e.message.desired,e.message.actual]),[[300,0],[0,286]]);
  // STOP write completion and the later speed sample do not prove physical stop.
});

test('real Game replays Guardian into an observed closed map and remains stopped under default watchdogs',async()=>{
  let now=0;const radio=new ReplayCar(trace,2);radio.initializationProfile='sdk';
  const game=new Game({pieces:json('./data/pieces.json'),weapons:json('./data/weapons.json'),vehicles:json('./data/vehicles.json'),clock:()=>now});
  const driver=game.addCar(radio,{name:'Guardian',model:12,control:'none'});
  const writes=[];driver.car.tap=(direction,packet)=>{if(direction==='tx')writes.push({at:now,text:hex(packet),packet:Uint8Array.from(packet)});};
  await settle();
  for(const at of [...new Set(events.filter(e=>e.at<=1409090).map(e=>e.at))]){now=at;radio.advance(now);await settle();}
  await driver.car.initialization;await driver.car.pumpPromise;
  assert.equal(driver.car.faulted,false);assert.equal(driver.car.version,11866);assert.equal(driver.car.millivolts,3762);
  assert.deepEqual(game.safety,{firstTrackMs:5000,trackGapMs:2000,stopGraceMs:1000,scanMs:45000,scanLaps:3});
  now=1432495;game.topSpeed=300;radio.advance(now);const beforeScan=writes.length;game.startScan(driver);await driver.car.pumpPromise;
  for(const event of rx.filter(e=>e.at>=1432500)){
    now=event.at;radio.advance(now);game.tick(.04);await driver.car.pumpPromise;
  }
  assert.equal(game.track.closed,true);assert.equal(game.track.count,7);assert.equal(game.track.inferredCount,0);
  assert.equal(game.track.unverifiedCount,0);assert.ok(Math.abs(game.track.length-2879.2)<.001);
  assert.deepEqual(game.track.pieces.map(p=>[p.id,p.reverse]),expectedTrack);
  assert.equal(driver.car.telemetry.positions,15);assert.equal(driver.car.telemetry.transitions,8);
  assert.equal(driver.car.telemetry.malformed,0);assert.equal(game.pitReason,null);
  assert.equal(game.halted,true);assert.equal(game.scanner,null);assert.equal(driver.car.speed,0);
  assert.deepEqual(writes.slice(beforeScan).map(e=>e.text),[
    '06 24 00 00 c4 09 00','06 24 2c 01 e8 03 00','05 2c 00 00 58 c1','06 24 00 00 c4 09 00','06 24 00 00 c4 09 00'
  ]);
  assert.equal(writes.find(e=>e.packet[1]===0x2c).at,1433332,'calibration follows the actual replayed printed-code message');
  const completed=writes.length;
  // Sustained inputs and post-completion ticks cannot silently restart a scan.
  driver.input.throttle=1;
  for(now=1443183;now<=1453183;now+=40){game.tick(.04);await driver.car.pumpPromise;}
  assert.equal(driver.car.speed,0);assert.equal(game.halted,true);assert.equal(game.pitReason,null);
  assert.ok(writes.slice(completed).every(e=>stop(e.packet)));
  assert.equal(writes.filter(e=>positive(e.packet)).length,1);
  assert.equal(driver.car.diagnostics().physicalStopVerified,false);
});
