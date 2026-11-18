import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {buildTrack,LAYOUTS} from './sim.mjs';
import {ID} from './protocol.mjs';

// Host regressions, not new physical steering acceptance. measured22/measured13
// are captured Guardian forward/scan packets replayed with simulated timing.
// The straight36 packet below is synthetic, using the existing piece geometry;
// piece36 is not part of Guardian's seven-piece recorded circuit.
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const raw=text=>Uint8Array.from(text.split(' ').map(b=>parseInt(b,16)));
const measured22=raw('10 27 0b 22 00 00 fc c1 39 01 07 ff ff 00 00 2c 01');
const measured13=raw('10 27 06 21 10 bf 1f 49 29 01 07 ff ff 00 00 2c 01');
const straight=raw('10 27 0f 24 00 00 b4 c1 2c 01 07 ff ff 00 00 2c 01');
const lanePackets=radio=>radio.sent.filter(p=>p[1]===ID.CHANGE_LANE);
const float=(p,offset)=>new DataView(Uint8Array.from(p).buffer).getFloat32(offset,true);
const moving=radio=>radio.sent.filter(p=>p[1]===ID.SPEED&&(p[2]||p[3]));
async function rig({simulated=false}={}) {
  let now=0,notify;const timers=[];
  const radio={initializationProfile:'sdk',sent:[],onNotify(fn){notify=fn;return()=>{};},close(){},
    emit(bytes){notify(Uint8Array.from(bytes));},async write(bytes){
      await radio.block?.(bytes);radio.sent.push([...bytes]);
      if(bytes[1]===ID.PING)queueMicrotask(()=>radio.emit([1,0x17]));
      if(bytes[1]===ID.VERSION)queueMicrotask(()=>radio.emit([3,0x19,0x5a,0x2e]));
    }};
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,
    schedule:(fn,ms)=>{const timer={fn,ms,due:now+ms,cancelled:false};timers.push(timer);return timer;},unschedule:t=>{t.cancelled=true;}});
  const driver=game.addCar(radio,{name:'Guardian',model:12,control:'browser',simulated});
  await driver.car.initialization;await driver.car.pumpPromise;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.stopAll();await driver.car.pumpPromise;
  radio.emit([3,ID.BATTERY_REPLY,0,16]);radio.emit([5,ID.STATUS,1,0,0,1]);game.topSpeed=300;radio.sent=[];
  return {game,driver,radio,timers,time:t=>{now=t;},async drive(packet=measured22){
    now=100;game.resume();driver.input.throttle=1;game.tick(.04);await driver.car.pumpPromise;
    now=200;radio.emit(packet);await driver.car.pumpPromise;
  },async due(t){now=t;for(const timer of timers)if(!timer.cancelled&&timer.due<=now){timer.cancelled=true;timer.fn();}await driver.car.pumpPromise;}};
}

for(const [measured,packet] of [[22.5,measured22],[13.5,measured13]])for(const direction of [1,-1]) {
  test('first physical '+(direction===1?'left':'right')+' nudge is relative to measured '+measured+' mm rather than stale target zero',async()=>{
    const {game,driver,radio,drive}=await rig();await drive(packet);
    assert.equal(driver.car.lateral,measured);assert.equal(driver.car.targetLateral,0);assert.equal(driver.input.lane,null);
    game.nudge(driver,direction);
    assert.equal(driver.input.lane,measured+direction*22.5);
    game.tick(.04);await driver.car.pumpPromise;
    assert.equal(lanePackets(radio).length,1);assert.equal(float(lanePackets(radio)[0],6)||0,-(measured+direction*22.5)||0);
  });
}

test('same-epoch pending nudges accumulate, while stopped or unrelated old lane targets cannot anchor a new physical nudge',async()=>{
  const {game,driver,radio,drive,time}=await rig();await drive();
  game.nudge(driver,1);game.nudge(driver,1);assert.equal(driver.input.lane,67.5);
  game.nudge(driver,-1);assert.equal(driver.input.lane,45);game.tick(.04);await driver.car.pumpPromise;
  assert.equal(float(lanePackets(radio).at(-1),6),-45);
  driver.car.stop();await driver.car.pumpPromise;game.nudge(driver,1);
  assert.equal(driver.input.lane,null,'STOP discards discrete intent rather than leaving a queued lane target');
  time(300);driver.input.throttle=1;game.tick(.04);await driver.car.pumpPromise;
  time(400);radio.emit(measured13);await driver.car.pumpPromise;
  driver.input.lane=-45; // unrelated intent has no current discrete-nudge provenance
  game.nudge(driver,1);assert.equal(driver.input.lane,36);
});

test('missing, stale, future, previous-epoch or stopped optical references refuse a new physical nudge',async()=>{
  for(const fault of ['missing','stale','future','epoch','stopped']){
    const {game,driver,radio,drive,time}=await rig();await drive();
    if(fault==='missing')driver.car.physicalLaneReference=null;
    if(fault==='stale')time(2201);
    if(fault==='future')time(199);
    if(fault==='epoch')driver.car.physicalLaneReference={...driver.car.physicalLaneReference,epoch:driver.car.driveEpoch-1};
    if(fault==='stopped')driver.car.stop();
    game.nudge(driver,1);assert.equal(driver.input.lane,null,fault+' must not leave a future lane request');
    await driver.car.pumpPromise;assert.equal(lanePackets(radio).length,0);
  }
});

test('simulator nudges preserve existing target-grid behavior without requiring physical optical evidence',async()=>{
  const {game,driver}=await rig({simulated:true});driver.car.targetLateral=13.5;
  game.nudge(driver,1);assert.equal(driver.input.lane,45);
  game.nudge(driver,-1);assert.equal(driver.input.lane,22.5);
});

for(const direction of [1,-1])test('bounded '+(direction===1?'left':'right')+' diagnostic sends one measured relative lane and preserves 4s/750ms stops',async()=>{
  const {game,driver,radio,timers,time,due}=await rig();
  game.startDiagnostic(driver,{steering:true,direction});await driver.car.pumpPromise;
  assert.equal(timers[0].ms,4000);assert.equal(driver.car.speed,300);
  time(100);radio.emit(straight);await driver.car.pumpPromise;
  assert.equal(driver.car.lateral,22.5);assert.equal(lanePackets(radio).length,1);
  assert.equal(float(lanePackets(radio)[0],6)||0,-(22.5+direction*22.5)||0);
  assert.equal(game.diagnostic.direction,direction);
  assert.equal(game.diagnostic.until,850);assert.ok(timers.some(t=>t.ms===750));
  time(200);radio.emit(straight);await driver.car.pumpPromise;assert.equal(lanePackets(radio).length,1);
  await due(850);assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);
  for(const timer of timers)timer.fn();game.tick(.04,5000);await driver.car.pumpPromise;
  assert.equal(moving(radio).length,1);assert.equal(lanePackets(radio).length,1);
});

test('invalid diagnostic direction is rejected before any motion or state change',async()=>{
  for(const direction of [0,2,-2,'-1',null,NaN,Infinity]){
    const {game,driver,radio}=await rig();
    assert.throws(()=>game.startDiagnostic(driver,{steering:true,direction}),/direction/i);
    assert.equal(game.diagnostic,null);assert.equal(radio.sent.length,0);assert.equal(driver.car.speed,0);
  }
});

test('right diagnostic rejects a start piece and retains lane-cancellation STOP',async()=>{
  const {game,driver,radio,time}=await rig();game.startDiagnostic(driver,{steering:true,direction:-1});await driver.car.pumpPromise;
  time(100);radio.emit(measured22);await driver.car.pumpPromise;assert.equal(lanePackets(radio).length,0,'start piece is not an ordinary straight');
  time(200);radio.emit(straight);await driver.car.pumpPromise;assert.equal(lanePackets(radio).length,1);
  radio.emit([14,0x41,0,0,0,0,0,0,0,0,0,0,0,0,0x80]);await driver.car.pumpPromise;
  assert.match(game.pitReason,/Lane change cancelled/);assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);
  time(300);radio.emit(straight);game.tick(.04);await driver.car.pumpPromise;assert.equal(lanePackets(radio).length,1);
});
