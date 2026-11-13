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
function position({piece=36,location=30,speed=300,reverse=false}={}){
  const bytes=new Uint8Array(17),view=new DataView(bytes.buffer);
  bytes[0]=16;bytes[1]=ID.POSITION;bytes[2]=location;bytes[3]=piece;
  view.setFloat32(4,22.5,true);view.setUint16(8,speed,true);bytes[10]=7|(reverse?0x40:0);bytes[11]=bytes[12]=255;
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
  let now=0;const r=radio(),timers=[];
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,
    schedule:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},unschedule:timer=>{timer.cancelled=true;}});
  const driver=game.addCar(r,{control:'bot'});await driver.car.initialization;await driver.car.pumpPromise;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.stopAll();await driver.car.pumpPromise;
  r.emit([3,ID.BATTERY_REPLY,0,16]);r.emit([5,ID.STATUS,1,0,0,1]);r.sent=[];
  const time=t=>{now=t;};
  return {game,driver,radio:r,time,timers,async start({lane=true,reference=true}={}){
    game.startLaneCancellationComparison(driver);time(100);game.tick(.04,now);await settle();
    assert.equal(driver.car.speed,300);
    if(reference){time(110);r.emit(speedReport());time(120);r.emit(position({piece:34,location:20}));time(130);r.emit(position({piece:34,location:21}));assert.equal(game.laneCancellationComparison.stage,'driving');}
    if(lane){time(140);r.emit(position());game.tick(.04,now);await settle();}
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

test('a new comparison resets CPU maneuver history and still waits for a new optical reference',async()=>{
  const r=await rig(),{game,driver,radio,time}=r;await r.start();
  const bot=driver.bot,firstEncounter=bot.trackLaneEncounter;
  assert.equal(bot.freeLaneTarget,22.5);assert.equal(radio.sent.filter(p=>p[1]===ID.CHANGE_LANE).length,1);
  time(150);radio.emit(position());game.tick(.04,150);await settle();
  assert.equal(radio.sent.filter(p=>p[1]===ID.CHANGE_LANE).length,1,'same trial does not repeat its accepted encounter');
  // Leave a candidate from another ordinary straight waiting for dispatch.
  time(160);radio.emit(position({piece:39}));bot.applyTrackPolicy(160,{throttle:1,lane:null},{topSpeed:300});
  assert.ok(bot.trackLaneCandidate);game.stopAll();await settle();
  time(200);game.startLaneCancellationComparison(driver);
  assert.equal(driver.bot,bot,'the driver settings stay intact');
  assert.equal(bot.trackLaneEncounter,undefined,'old encounter is cleared for the new comparison');
  assert.equal(bot.trackLaneCandidate,null,'old pending candidate cannot survive the new comparison');
  assert.equal(bot.freeLaneTarget,undefined,'new trial chooses from its new observed lane');
  assert.equal(driver.car.steeringLocked,true);assert.equal(driver.car.speed,0);
  time(300);game.tick(.04,300);await settle();time(310);radio.emit(speedReport());
  assert.equal(radio.sent.filter(p=>p[1]===ID.CHANGE_LANE).length,1,'reset history alone cannot authorize steering');
  time(320);radio.emit(position({piece:34,location:20}));time(330);radio.emit(position({piece:34,location:21}));
  assert.equal(game.laneCancellationComparison.stage,'driving');
  time(340);radio.emit(position());game.tick(.04,340);await settle();
  assert.notEqual(bot.trackLaneEncounter,firstEncounter,'fresh confirmation receives a new section visit even at lap zero');
  assert.equal(bot.freeLaneTarget,22.5,'new observation, not old alternation, selects the first lane');
  assert.equal(radio.sent.filter(p=>p[1]===ID.CHANGE_LANE).length,2);
  time(350);game.tick(.04,350);await settle();assert.equal(radio.sent.filter(p=>p[1]===ID.CHANGE_LANE).length,2);
  game.stopAll();await settle();
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
    const r=await rig(),{game,driver,radio,time}=r;await r.start({lane:false,reference:fault!=='no-first-position'});
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
    ['no start or finish',({game})=>{game.track.pieces=game.track.pieces.filter(p=>!['start','finish'].includes(p.kind));}],
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

test('comparison resets old localization and holds all steering until a distinct consistent anchor follow-up',async()=>{
  const r=await rig(),{game,driver,radio,time,timers}=r;
  radio.emit(position());assert.equal(driver.car.localizer.located,true);
  await r.start({lane:false,reference:false});
  assert.equal(driver.car.localizer.located,false);assert.equal(driver.car.localizer.index,-1);
  assert.equal(driver.car.steeringLocked,true);assert.equal(timers[0].ms,5000);
  driver.car.steerTo(45);driver.car.uturn();driver.car.send('offset',encode.setOffset(45));
  time(120);radio.emit(position({piece:34,location:20}));await settle();
  assert.equal(game.laneCancellationComparison.stage,'acquiring-reference');
  assert.equal(game.laneCancellationComparison.reference.pieceId,34);
  time(130);radio.emit(position({piece:34,location:20}));game.tick(.04,130);await settle();
  assert.equal(driver.car.steeringLocked,true,'repeated same code is not independent confirmation');
  assert.equal(steering(radio).length,0,'even automatic calibration is blocked during acquisition');
  time(140);radio.emit(position({piece:34,location:21}));await settle();
  assert.equal(game.laneCancellationComparison.stage,'driving');assert.equal(driver.car.steeringLocked,false);
  assert.equal(steering(radio).length,0,'unlock does not send an offset or lane itself');
  assert.equal(timers[0].cancelled,true);assert.equal(driver.car.telemetry.laneCancellationComparison.confirmedAt,140);
  timers[0].fn();assert.notEqual(game.laneCancellationComparison,null,'expired acquisition callback cannot stop confirmed driving');
  game.stopAll();await settle();
});

test('the first optical reference must be valid, uniquely mapped start or finish from the current motion',async()=>{
  for(const bad of [position(),position({piece:18,location:9}),position({piece:57,location:25}),position({piece:99,location:1}),position({piece:34,location:255}),position({piece:34,location:20,speed:0})]){
    const r=await rig(),{game,driver,radio,time}=r;await r.start({lane:false,reference:false});
    time(120);radio.emit(bad);await settle();
    assert.equal(game.laneCancellationComparison,null);assert.equal(driver.car.speed,0);assert.match(game.pitReason,/expected.*start\/finish; observed piece/);
    assert.equal(steering(radio).length,0,'a mismatched first code cannot calibrate before STOP');
    assert.equal(driver.car.telemetry.laneCancellationComparison.stage,'failed');
  }
  const duplicate=await rig();duplicate.game.track.pieces.push({...duplicate.game.track.pieces.find(p=>p.id===34)});
  await duplicate.start({lane:false,reference:false});duplicate.time(120);duplicate.radio.emit(position({piece:34,location:20}));await settle();
  assert.match(duplicate.game.pitReason,/uniquely identified/);assert.equal(steering(duplicate.radio).length,0);
  const beforeMotion=await rig();beforeMotion.game.startLaneCancellationComparison(beforeMotion.driver);
  beforeMotion.time(1);beforeMotion.radio.emit(position({piece:34,location:20}));await settle();
  assert.equal(beforeMotion.game.laneCancellationComparison,null,'a late optical packet before current motion cannot authorize driving');
  assert.equal(beforeMotion.driver.car.speed,0);
});

test('reference follow-up rejects wrong pieces, reverse direction and non-forward codes',async()=>{
  for(const next of [position({piece:20,location:9}),position({piece:57,location:25}),position({piece:34,location:21,reverse:true}),position({piece:34,location:18})]){
    const r=await rig(),{game,driver,radio,time}=r;await r.start({lane:false,reference:false});
    time(120);radio.emit(position({piece:34,location:20}));time(140);radio.emit(next);await settle();
    assert.equal(driver.car.speed,0);assert.equal(game.laneCancellationComparison,null);
    assert.match(game.pitReason,/expected a forward follow-up.*observed piece/);assert.equal(steering(radio).length,0);
  }
  // A finish anchor has only one longitudinal code row. Its next mapped piece
  // is valid confirmation, with or without the intervening transition packet.
  for(const withTransition of [false,true]){
    const r=await rig(),{game,radio,time}=r;await r.start({lane:false,reference:false});
    time(120);radio.emit(position({piece:33,location:10}));
    if(withTransition){time(130);radio.emit([17,ID.TRANSITION,0,0,0,0,0,0,255,255,0,0,44,1,0,0,22,22]);}
    time(140);radio.emit(position({piece:39,location:30}));await settle();
    assert.equal(game.laneCancellationComparison.stage,'driving');game.stopAll();await settle();
  }
});

test('reference deadline survives repeated anchor codes and a cancellation during acquisition still opens the pit',async()=>{
  for(const path of ['timer','tick','message']){
    const r=await rig(),{game,driver,radio,time,timers}=r;await r.start({lane:false,reference:false});
    time(120);radio.emit(position({piece:34,location:20}));
    for(const now of [1000,2000,3000,4000]){time(now);radio.emit(position({piece:34,location:20}));game.tick(.04,now);}
    assert.notEqual(game.laneCancellationComparison,null);time(5000);
    if(path==='timer')timers[0].fn();else if(path==='tick')game.tick(.04,5000);else radio.emit(position({piece:34,location:21}));
    await settle();assert.equal(driver.car.speed,0);assert.equal(game.laneCancellationComparison,null);assert.match(game.pitReason,/Reference timeout/);
    assert.equal(timers[0].cancelled,true);assert.equal(steering(radio).length,0);
  }
  const r=await rig();await r.start({lane:false,reference:false});r.radio.emit(cancellation());await settle();
  assert.match(r.game.pitReason,/Lane change cancelled/);assert.equal(r.driver.car.speed,0);assert.equal(r.game.laneCancellationComparison,null);
  assert.equal(r.driver.car.telemetry.laneCancellationComparison.cancelled,false,'acquisition never activates the continue-forward exception');
});

test('loss or an optical gap invalidates an acquisition anchor before a later follow-up can unlock steering',async()=>{
  for(const event of ['off-track-status','recovery','optical-gap']){
    const r=await rig(),{game,driver,radio,time}=r;await r.start({lane:false,reference:false});
    time(120);radio.emit(position({piece:34,location:20}));
    if(event==='off-track-status'){time(125);radio.emit([5,ID.STATUS,0,0,0,1]);}
    if(event==='recovery'){time(125);radio.emit([1,ID.DELOC_RECOVERY_ENTERED]);}
    // No animation tick between observations: the newly arrived follow-up must
    // not erase the evidence gap before the reference gate can check it.
    time(event==='optical-gap'?2121:130);radio.emit(position({piece:34,location:21}));await settle();
    assert.equal(game.laneCancellationComparison,null,event);assert.equal(driver.car.speed,0,event);
    assert.match(game.pitReason,/Reference lost/,event);assert.equal(steering(radio).length,0,event);
    assert.equal(driver.car.telemetry.laneCancellationComparison.stage,'failed',event);
  }
});

test('late optical messages after a reference stop cannot calibrate or learn a steering sign',async()=>{
  for(const failure of ['wrong-first','timeout','cancellation','host-stop']){
    const r=await rig(),{game,driver,radio,time,timers}=r;await r.start({lane:false,reference:false});
    time(120);
    if(failure==='wrong-first')radio.emit(position());
    if(failure==='timeout'){time(5000);timers[0].fn();}
    if(failure==='cancellation')radio.emit(cancellation());
    if(failure==='host-stop')game.stopAll();
    await settle();assert.ok(driver.car.safetyReason,failure);assert.equal(game.laneCancellationComparison,null);
    driver.car.lastPair={lateral:-22.5,offset:22.5};driver.car.signVotes=0;
    const late=position({piece:36,location:12});
    for(const offset of [-70,654321]){
      new DataView(late.buffer).setFloat32(4,offset,true);radio.emit(late);await settle();
      assert.equal(steering(radio).length,0,failure+' cannot send a late offset or lane');
      assert.equal(driver.car.signVotes,0,failure+' cannot learn from observations received while latched');
    }
    assert.equal(driver.car.lateral,31.5,'observed lateral telemetry may still be recorded');
    assert.equal(driver.car.lastPair,null);assert.equal(driver.car.speed,0);
  }
});
