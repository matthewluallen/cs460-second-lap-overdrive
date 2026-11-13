import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {buildTrack, LAYOUTS} from './sim.mjs';
import {encode, ID} from './protocol.mjs';

// Host policy tests with a fake SDK radio; no claims about firmware motion.
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const steeringIds=new Set([ID.CHANGE_LANE,ID.SET_OFFSET,ID.OFFSET_ADJUST,ID.TURN]);
const steering=radio=>radio.sent.filter(p=>steeringIds.has(p[1]));
const speeds=radio=>radio.sent.filter(p=>p[1]===ID.SPEED).map(p=>p[2]+256*p[3]);
const cancellation=()=>Uint8Array.from([14,ID.LANE_CHANGE_UPDATE,0,0,0,0,0,0,0,0,0,0,44,1,128]);
function position({piece=36,location=30,speed=300}={}){
  const bytes=new Uint8Array(17),view=new DataView(bytes.buffer);
  bytes[0]=16;bytes[1]=ID.POSITION;bytes[2]=location;bytes[3]=piece;
  view.setFloat32(4,22.5,true);view.setUint16(8,speed,true);bytes[10]=7;bytes[11]=bytes[12]=255;
  return bytes;
}
function speedReport(speed=300,accel=1000){
  const bytes=new Uint8Array(8),view=new DataView(bytes.buffer);bytes[0]=7;bytes[1]=ID.SPEED_UPDATE;
  view.setInt16(2,speed,true);view.setInt16(4,accel,true);view.setInt16(6,speed,true);return bytes;
}
function radio(){
  let notify;const r={initializationProfile:'sdk',sent:[],onNotify(fn){notify=fn;return()=>{};},close(){},
    emit(bytes){notify(Uint8Array.from(bytes));},async write(bytes){
      await r.block?.(bytes);r.sent.push([...bytes]);
      if(bytes[1]===ID.PING)queueMicrotask(()=>r.emit([1,ID.PING_REPLY]));
      if(bytes[1]===ID.VERSION)queueMicrotask(()=>r.emit([3,ID.VERSION_REPLY,0x5a,0x2e]));
    }};return r;
}
async function rig(){
  let now=0;const r=radio();
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now});
  const driver=game.addCar(r,{control:'bot'});await driver.car.initialization;await driver.car.pumpPromise;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.stopAll();await driver.car.pumpPromise;
  r.emit([3,ID.BATTERY_REPLY,0,16]);r.emit([5,ID.STATUS,1,0,0,1]);r.sent=[];
  const time=t=>{now=t;};
  return {game,driver,radio:r,time,async start({lane=true}={}){
    game.startLaneCancellationComparison(driver);time(100);game.tick(.04,now);await settle();
    assert.equal(driver.car.speed,300);
    if(lane){time(110);r.emit(speedReport());time(120);r.emit(position());game.tick(.04,now);await settle();}
  }};
}

test('moving cancellation retains the shared pit by default and after a comparison ends',async()=>{
  for(const previouslyCompared of [false,true]){
    const r=await rig(),{game,driver,radio}=r;
    if(previouslyCompared){await r.start();game.stopAll();await settle();assert.equal(game.laneCancellationComparison,null);}
    game.resume();driver.car.setSpeed(300);await settle();radio.emit(cancellation());await settle();
    assert.equal(game.halted,true);assert.match(game.pitReason,/Lane change cancelled/);
    assert.equal(driver.car.speed,0);assert.equal(speeds(radio).at(-1),0);
  }
});

test('explicit comparison cancellation keeps forward speed and locks queued, manual and CPU steering without retries',async()=>{
  const r=await rig(),{game,driver,radio,time}=r;await r.start();
  assert.equal(radio.sent.filter(p=>p[1]===ID.CHANGE_LANE).length,1);
  let release;radio.block=p=>{if(p[1]===ID.BATTERY)return new Promise(resolve=>release=resolve);};
  driver.car.refreshBattery();await settle();driver.car.steerTo(-45);
  const prior=steering(radio).length,cancelIndex=radio.sent.length;radio.emit(cancellation());
  assert.equal(driver.car.steeringLocked,true);assert.equal(game.laneCancellationComparison.cancelled,true);
  assert.equal(driver.car.speed,300);assert.equal(game.halted,false);assert.equal(game.pitReason,null);
  release();await settle();assert.equal(steering(radio).length,prior,'pending reference and lane are dropped');
  driver.car.steerTo(45);driver.car.nudge(1);driver.car.uturn();
  for(const [key,p] of [['raw-lane',encode.changeLane(45)],['raw-offset',encode.setOffset(45)],['raw-turn',encode.turn()],['raw-adjust',Uint8Array.from([5,ID.OFFSET_ADJUST,0,0,0,0])]])driver.car.send(key,p);
  for(const now of [200,300,400]){
    time(now);radio.emit(position());driver.input.lane=45;driver.objectiveInput={throttle:1,lane:-45};
    driver.car.localizer.laps++;game.tick(.04,now);radio.emit(cancellation());await settle();
    assert.equal(driver.car.speed,300);assert.equal(game.halted,false);
  }
  assert.equal(steering(radio).length,prior,'no queued, direct or automatic steering retry reaches the radio');
  assert.equal(speeds({sent:radio.sent.slice(cancelIndex)}).includes(0),false,'cancellation itself does not send STOP in the explicit comparison');
  game.stopAll();await settle();assert.equal(driver.car.speed,0);assert.equal(driver.car.steeringLocked,false);
  assert.equal(game.laneCancellationComparison,null);
});

test('comparison never exceeds 300 despite a higher slider or boosted limiter output and preserves lower requested speed',async()=>{
  const r=await rig(),{game,driver,radio,time}=r;game.topSpeed=900;await r.start({lane:false});
  game.topSpeed=1400;
  // Inject the effect result at the limiter boundary; an actual active round
  // ends the comparison before driving, covered separately below.
  const limit=game.battle.limit;game.battle.limit=()=>({speed:1400,accel:2000});
  driver.objectiveInput={throttle:1,lane:null};time(200);radio.emit(position());game.tick(.04,200);await settle();
  assert.equal(driver.car.speed,300);assert.ok(speeds(radio).every(s=>s<=300));
  game.battle.limit=limit;game.topSpeed=150;time(300);radio.emit(position());game.tick(.04,300);await settle();
  assert.equal(driver.car.speed,150,'comparison does not raise a lower operator ceiling');
  game.stopAll();await settle();
});

test('cancellation followed immediately by STOP cannot release lateral writes queued under alternate keys',async()=>{
  for(const boundary of ['queued','before-radio-microtask']){
    const r=await rig(),{game,driver,radio}=r;await r.start({lane:false});
    let release;
    if(boundary==='queued'){
      radio.block=p=>{if(p[1]===ID.BATTERY)return new Promise(resolve=>release=resolve);};
      driver.car.refreshBattery();await settle();
    }
    driver.car.send('alternate-offset-key',encode.setOffset(22.5));
    driver.car.send('alternate-lane-key',encode.changeLane(45));
    driver.car.send('alternate-turn-key',encode.turn());
    radio.emit(cancellation());game.stopAll();release?.();await settle();await settle();
    assert.equal(steering(radio).length,0,boundary+' must discard every pre-lock lateral command');
    assert.equal(driver.car.speed,0);assert.equal(speeds(radio).at(-1),0);
    assert.equal(game.laneCancellationComparison,null);
  }
});

test('off-road, telemetry silence and link failures still stop and end the comparison',async()=>{
  for(const fault of ['off-road','gap','no-first-position','link','write']){
    const r=await rig(),{game,driver,radio,time}=r;await r.start({lane:false});
    if(fault!=='no-first-position'){time(200);radio.emit(position());}
    if(fault==='off-road')radio.emit([1,ID.DELOCALIZED]);
    if(fault==='gap'){time(2201);game.tick(.04,2201);}
    if(fault==='no-first-position'){time(5101);game.tick(.04,5101);}
    if(fault==='link')driver.car.connectionLost();
    if(fault==='write'){radio.block=()=>{throw new Error('injected settled write failure');};driver.car.refreshBattery();}
    await settle();await settle();assert.equal(driver.car.speed,0,fault);assert.equal(game.halted,true,fault);
    assert.equal(game.laneCancellationComparison,null,fault);assert.ok(game.pitReason,fault);
    game.tick(.04,5200);await settle();assert.equal(driver.car.speed,0,fault+' cannot restart');
  }
});

test('STOP, controller reassignment and an active round end the comparison and cannot restart from held controls',async()=>{
  for(const action of ['host-stop','car-stop','reassign','active-round']){
    const r=await rig(),{game,driver,radio,time}=r;await r.start();radio.emit(cancellation());await settle();
    driver.input.throttle=1;driver.input.lane=45;
    if(action==='host-stop')game.stopAll();
    if(action==='car-stop')driver.car.stop();
    if(action==='reassign')game.setControl(driver,'browser');
    if(action==='active-round')game.battle.active=true;
    time(500);game.tick(.04,500);await settle();
    assert.equal(driver.car.speed,0,action);assert.equal(game.laneCancellationComparison,null,action);
    assert.equal(driver.car.steeringLocked,false,action);assert.equal(driver.cpuArmed,false,action);
  }
});

test('comparison requires a single stopped ready computer car, an identified map and fresh healthy battery',async()=>{
  const cases=[
    ['browser driver',({game,driver})=>game.setControl(driver,'browser')],
    ['moving car',({driver})=>{driver.car.recover();driver.car.setSpeed(100);}],
    ['no map',({game})=>game.track=null],
    ['open map',({game})=>game.track.closed=false],
    ['inferred map',({game})=>game.track.inferredCount=1],
    ['stale battery',({time})=>time(30001)],
    ['missing battery',({driver})=>driver.car.telemetry.batteryAt=undefined],
    ['charging',({radio})=>radio.emit([5,ID.STATUS,1,1,0,0])],
    ['low battery',({radio})=>radio.emit([5,ID.STATUS,1,0,1,0])],
    ['faulted',({driver})=>driver.car.faulted=true],
    ['not initialized',({driver})=>driver.car.initializing=true],
    ['disconnected',({driver})=>driver.car.connected=false],
    ['off-track latch',({driver})=>driver.car.safetyReason='Off track'],
    ['second car',async({game})=>{const d=game.addCar(radio());await d.car.initialization;await d.car.pumpPromise;}],
    ['active round',({game})=>game.battle.active=true],
    ['pit',({game})=>game.pitReason='Recover car first'],
    ['scan',({game})=>game.phase='scanning'],
    ['existing comparison',({game,driver})=>game.startLaneCancellationComparison(driver)],
  ];
  for(const [label,mutate] of cases){
    const r=await rig();await mutate(r);await settle();
    const before=r.game.laneCancellationComparison;
    assert.throws(()=>r.game.startLaneCancellationComparison(r.driver),undefined,label);
    assert.equal(r.game.laneCancellationComparison===before,true,label);r.game.stopAll();await settle();
  }
});
