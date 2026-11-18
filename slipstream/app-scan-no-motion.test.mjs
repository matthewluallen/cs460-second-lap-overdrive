import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {decode, hex} from './protocol.mjs';
import {validate} from './trace.mjs';

// Original export, unchanged. The operator reported no movement; these bytes
// do not independently prove physical stopping or explain firmware behavior.
const file=readFileSync(new URL('./fixtures/groundshock-app-scan-no-motion-2026-11-18.json',import.meta.url));
const trace=validate(JSON.parse(file));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const events=trace.events.map(([at,car,direction,text])=>({at,car,direction,text,packet:raw(text)}));
const tx=events.filter(e=>e.direction==='tx');
const rx=events.filter(e=>e.direction==='rx').flatMap(e=>decode(e.packet).map(message=>({...e,message})));

test('original app-profile no-motion export preserves initialization, zero optical acquisition and unknown physical stop',()=>{
  assert.equal(createHash('sha256').update(file).digest('hex'),'61b68800c81e5c0cc0b5dbfb91c2caef1d59a346bf8fbdb80517b2918ee437e3');
  assert.equal(trace.events.length,43);assert.equal(trace.dropped,0);assert.equal(trace.markersDropped,0);
  assert.deepEqual([trace.cars[0].profile,trace.cars[0].firmware,trace.cars[0].model],['fast-furious',11866,0]);
  assert.equal(trace.diagnostics.cars[0].name,'Groundshock','manual model selection is distinct from an advertised identity');
  assert.deepEqual(tx.filter(e=>e.at<633).map(e=>e.text),[
    '06 24 00 00 c4 09 00','03 90 00 00','01 16','01 18','02 22 01','01 16','03 45 00 00','01 16','01 21',
    '13 46 01 02 01 3e 01 44 00 00 00 00 00 00 00 00 00 00 00 00',
    '13 48 01 0d 8a 0a 0a 0a 0a 0a 0b 0a 0a 4a 4b 4b 80 00 00 00',
    '08 49 01 10 00 01 02 00 0d','01 16','03 37 00 00','06 24 00 00 c4 09 00','01 16'
  ]);
  assert.deepEqual(rx.filter(e=>e.message.type==='carInit').map(e=>e.at),[480]);
  assert.deepEqual(rx.filter(e=>e.message.type==='ping').map(e=>e.at),[180,300,391,540,632]);
  assert.equal(rx.some(e=>['position','transition','collision','delocalized','delocRecoveryEntered'].includes(e.message.type)),false);
  assert.equal(events.some(e=>e.direction==='rx' && [0x27,0x29].includes(e.packet[1])),false);
  assert.equal(trace.diagnostics.cars[0].physicalStopVerified,false);
  assert.equal(trace.diagnostics.track,null);
});

test('firmware reports desired speed zero before any subsequent recorded host STOP or allowance restoration',()=>{
  const scan=trace.markers.find(m=>m.kind==='scan-start');assert.equal(scan.timeMs,137726);
  const request=trace.markers.find(m=>m.kind==='scan-request');
  assert.deepEqual([request.details.ceiling,request.details.startingLateral],[400,null]);
  assert.deepEqual(tx.filter(e=>e.at>=scan.timeMs && e.at<142767).map(e=>[e.at,e.text]),[
    [137730,'06 24 00 00 c4 09 00'],[137730,'03 37 2c 01'],[137731,'06 24 2c 01 e8 03 00']
  ]);
  assert.deepEqual(rx.filter(e=>e.message.type==='speed').map(e=>[e.at,e.message.desired,e.message.accel,e.message.actual]),[
    [137769,300,1000,0],[137829,0,1000,0]
  ]);
  assert.equal(tx.some(e=>e.at>137731 && e.at<142767),false,'no recorded host command explains the 98 ms speed-state change');
  assert.equal(tx.find(e=>e.at>137731).at-137731,5036);
  assert.deepEqual(tx.filter(e=>e.at>=142767 && e.at<=142768).map(e=>e.text),[
    '06 24 00 00 c4 09 00','06 24 00 00 c4 09 00','03 37 00 00'
  ]);
  assert.equal(tx.some(e=>[0x25,0x2c,0x32,0x34,0x35].includes(e.packet[1])),false);
});

test('parked app-profile scanner retains allowance and requested pace through the recorded speed replies until watchdog',async()=>{
  const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
  let now=0,notify;
  const radio={initializationProfile:'fast-furious',sent:[],onNotify(fn){notify=fn;return()=>{};},close(){},
    emit(bytes){notify(Uint8Array.from(bytes));},async write(bytes){
      this.sent.push({at:now,text:hex(bytes)});
      if(bytes[1]===0x16)queueMicrotask(()=>this.emit([1,0x17]));
      if(bytes[1]===0x18)queueMicrotask(()=>this.emit([3,0x19,0x5a,0x2e]));
      if(bytes[1]===0x49)queueMicrotask(()=>this.emit([3,0x23,255,255]));
    }};
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now});
  const driver=game.addCar(radio,{model:8,control:'none'});
  await driver.car.initialization;await driver.car.pumpPromise;
  game.topSpeed=400;game.stopAll();await driver.car.pumpPromise;radio.sent=[];
  now=3000;game.startScan(driver);await driver.car.pumpPromise;
  for(const event of rx.filter(e=>e.message.type==='speed')){
    now=3000+event.at-137731;radio.emit(event.packet);game.tick(.04);await driver.car.pumpPromise;
  }
  for(now=3100;now<=8000;now+=20){game.tick(.02);await driver.car.pumpPromise;}
  assert.equal(game.phase,'scanning');assert.equal(game.pitReason,null);
  assert.equal(driver.car.speed,300);assert.equal(driver.car.reportedSpeed,0);
  assert.equal(driver.car.scanDelocalizationAllowance,true);
  assert.deepEqual(radio.sent.map(e=>e.text),['06 24 00 00 c4 09 00','03 37 2c 01','06 24 2c 01 e8 03 00']);
  now=8040;game.tick(.04);await driver.car.pumpPromise;
  assert.match(game.pitReason,/Telemetry timeout/);assert.equal(driver.car.speed,0);
  assert.equal(driver.car.scanDelocalizationAllowance,false);
  assert.deepEqual(radio.sent.slice(3).map(e=>e.text),['06 24 00 00 c4 09 00','06 24 00 00 c4 09 00','03 37 00 00']);
  assert.ok(radio.sent.slice(3).every(e=>e.at===8040));
  // A replay only tests host ordering. It cannot emulate firmware cancellation,
  // diagnose a motor/sensor condition or validate a new physical scan.
});
