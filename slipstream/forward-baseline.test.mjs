import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {buildTrack, LAYOUTS, SimWorld} from './sim.mjs';
import {ID} from './protocol.mjs';

// Explicit host-policy tests using a fake SDK radio. They do not model physical
// traction or firmware calibration behavior and cannot establish hardware parity.
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const speeds=radio=>radio.sent.filter(p=>p[1]===ID.SPEED).map(p=>p[2]+256*p[3]);
function position({piece=34,code=20,speed=300,offset=654321,reverse=false}={}) {
  const bytes=new Uint8Array(17),view=new DataView(bytes.buffer);
  bytes[0]=16;bytes[1]=ID.POSITION;bytes[2]=code;bytes[3]=piece;
  view.setFloat32(4,offset,true);view.setUint16(8,speed,true);bytes[10]=7|(reverse?0x40:0);bytes[11]=bytes[12]=255;
  return bytes;
}
const transition=()=>Uint8Array.of(17,ID.TRANSITION,...new Array(16).fill(0));
function radio() {
  let notify;const r={initializationProfile:'sdk',sent:[],onNotify(fn){notify=fn;return()=>{};},close(){},emit(bytes){notify(Uint8Array.from(bytes));},
    async write(bytes){await r.block?.(bytes);r.sent.push([...bytes]);
      if(bytes[1]===ID.PING)queueMicrotask(()=>r.emit([1,ID.PING_REPLY]));
      if(bytes[1]===ID.VERSION)queueMicrotask(()=>r.emit([3,ID.VERSION_REPLY,0x5a,0x2e]));}};return r;
}
async function rig() {
  let now=0;const r=radio(),timers=[];
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,
    schedule:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},unschedule:timer=>{timer.cancelled=true;}});
  const driver=game.addCar(r,{control:'bot'});await driver.car.initialization;await driver.car.pumpPromise;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.stopAll();await driver.car.pumpPromise;
  r.emit([3,ID.BATTERY_REPLY,0,16]);r.emit([5,ID.STATUS,1,0,0,1]);r.sent=[];
  const time=t=>{now=t;};
  return {game,driver,radio:r,time,timers,
    async start(){game.startForwardBaseline(driver);await settle();time(100);r.emit(position());await settle();assert.equal(game.forwardBaseline.stage,'driving');},
    async reading(index,{reverse=false}={}) {
      now+=100;const piece=game.track.pieces[index],codes=game.pieces.get(piece.id).locs;
      const code=Number(Object.keys(codes)[0]);r.emit(position({piece:piece.id,code,reverse:reverse?!piece.reverse:piece.reverse}));await driver.car.pumpPromise;
    },
    async transition(){now+=100;r.emit(transition());await driver.car.pumpPromise;}
  };
}

test('forward baseline keeps scan-style optical calibration while isolating every driver input and battle action',async()=>{
  const r=await rig(),{game,driver,radio,time}=r;
  driver.car.localizer.laps=99;driver.car.localizer.seed(3,1,0);
  game.startForwardBaseline(driver);await settle();
  assert.equal(driver.car.localizer.laps,0);assert.equal(driver.car.localizer.reference,null);
  assert.equal(driver.car.maneuversLocked,true);assert.equal(driver.car.steeringLocked,false);
  assert.equal(radio.sent.some(p=>p[1]===ID.SET_OFFSET),false,'no guessed pre-optical calibration');
  time(100);radio.emit(position());await settle();
  assert.equal(game.forwardBaseline.stage,'driving');
  assert.equal(radio.sent.filter(p=>p[1]===ID.SET_OFFSET).length,1,'ordinary observed-code calibration reaches radio');
  driver.bot.drive=()=>assert.fail('CPU planner must not run');game.battle.press=()=>assert.fail('weapons must not run');
  driver.input={throttle:1,lane:45,attack:true,support:true,special:true};driver.objectiveInput={throttle:1,lane:-45};driver.pad={throttle:1};
  game.nudge(driver,1);driver.car.nudge(1);driver.car.uturn();time(200);game.tick(.04,200);await settle();
  assert.equal(driver.car.speed,300);assert.deepEqual(driver.input,{throttle:0,lane:null,attack:false,support:false,special:false});
  assert.equal(driver.objectiveInput,null);assert.equal(radio.sent.some(p=>[ID.CHANGE_LANE,ID.TURN].includes(p[1])),false);
  assert.equal(radio.sent.some(p=>p[1]===ID.MAX_DELOCALIZED_SPEED),false,'baseline introduces no scan allowance');
  game.stopAll();await settle();assert.equal(driver.car.maneuversLocked,false);
});

test('three laps require three complete optical traversals after the initial partial wrap, in either direction',async()=>{
  for(const reverse of [false,true]) {
    const r=await rig(),{game,driver,radio,timers}=r;game.startForwardBaseline(driver);await settle();
    const order=reverse?[0,...Array.from({length:game.track.count-1},(_,i)=>game.track.count-1-i)]:Array.from({length:game.track.count},(_,i)=>i);
    // Acquire at map zero; the first map crossing starts evidence, not a lap.
    for(let circuit=0;circuit<4;circuit++) {
      for(const index of order){await r.reading(index,{reverse});await r.transition();}
      assert.equal(driver.car.localizer.laps,circuit);
      if(circuit<3){assert.ok(game.forwardBaseline);assert.equal(game.forwardBaseline.laps,circuit);assert.equal(driver.car.speed,300);}
    }
    assert.equal(game.forwardBaseline,null);assert.equal(game.halted,true);assert.equal(driver.car.speed,0);
    assert.equal(driver.car.telemetry.forwardBaseline.stage,'complete');assert.equal(driver.car.telemetry.forwardBaseline.laps,3);
    assert.equal(driver.car.telemetry.forwardBaseline.physicalStopVerified,false);
    assert.equal(speeds(radio).at(-1),0);assert.ok(timers.every(t=>t.cancelled));
    game.tick(.04,10000);await settle();assert.equal(driver.car.speed,0);
  }
});

test('a missing optical section cannot manufacture a lap from transition traffic',async()=>{
  const r=await rig(),{game,driver}=r;game.startForwardBaseline(driver);await settle();
  for(let circuit=0;circuit<5;circuit++)for(let index=0;index<game.track.count;index++) {
    if(index!==3)await r.reading(index);await r.transition();
  }
  assert.equal(driver.car.localizer.laps,0);assert.equal(game.forwardBaseline.laps,0);assert.equal(driver.car.telemetry.forwardBaseline.stage,'driving');
  game.stopAll();await settle();
});

test('ambiguous optical updates do not extend the five-second reference deadline',async()=>{
  const r=await rig(),{game,driver,radio,time,timers}=r;
  // Two mapped occurrences of the same ID retain ambiguity before any reference.
  game.track.pieces[2].id=34;game.startForwardBaseline(driver);await settle();
  for(const t of [100,1000,2000,3000,4000]){time(t);radio.emit(position());game.tick(.04,t);await settle();assert.equal(game.forwardBaseline.stage,'acquiring-reference');}
  time(5000);game.tick(.04,5000);await settle();
  assert.equal(game.forwardBaseline,null);assert.equal(driver.car.speed,0);assert.match(game.pitReason,/reference timeout/);
  assert.equal(driver.car.telemetry.forwardBaseline.stage,'failed');assert.ok(timers.every(t=>t.cancelled));
});

test('first-position and telemetry-gap watchdogs, off-track states, cancellation and link loss still latch the pit',async()=>{
  for(const fault of ['first-position','gap','delocalized','recovery','off-track','low-battery','charger','lane-cancel','link']) {
    const r=await rig(),{game,driver,radio,time}=r;
    if(fault==='first-position'){game.startForwardBaseline(driver);await settle();time(5001);game.tick(.04,5001);}
    else {
      await r.start();time(200);
      if(fault==='gap'){time(2101);game.tick(.04,2101);}
      if(fault==='delocalized')radio.emit([1,ID.DELOCALIZED]);
      if(fault==='recovery')radio.emit([1,ID.DELOC_RECOVERY_ENTERED]);
      if(fault==='off-track')radio.emit([5,ID.STATUS,0,0,0,0]);
      if(fault==='low-battery')radio.emit([5,ID.STATUS,1,0,1,1]);
      if(fault==='charger')radio.emit([5,ID.STATUS,1,1,0,1]);
      if(fault==='lane-cancel')radio.emit([14,ID.LANE_CHANGE_UPDATE,0,0,0,0,0,0,0,0,0,0,44,1,128]);
      if(fault==='link')driver.car.connectionLost();
    }
    await settle();assert.equal(driver.car.speed,0,fault);assert.equal(game.forwardBaseline,null,fault);assert.equal(game.halted,true,fault);assert.ok(game.pitReason,fault);
    game.tick(.04,6000);await settle();assert.equal(driver.car.speed,0,fault+' cannot automatically resume');
  }
});

test('deadline stops without animation ticks and stale timer callbacks cannot affect the next session',async()=>{
  const r=await rig(),{game,driver,radio,time,timers}=r;await r.start();
  const deadline=timers.find(t=>t.ms===120000);time(120000);deadline.fn();await settle();
  assert.equal(driver.car.speed,0);assert.match(game.pitReason,/time budget/);assert.equal(game.forwardBaseline,null);
  game.recoverCar(driver);game.resumeFromPit();time(120001);radio.emit([3,ID.BATTERY_REPLY,0,16]);game.startForwardBaseline(driver);await settle();
  const next=game.forwardBaseline;deadline.fn();await settle();assert.equal(game.forwardBaseline,next,'finished timer cannot stop a newer explicit run');
  game.stopAll();await settle();
});

test('reference and overall deadlines block queued motion before overdue timer callbacks or game ticks run',async()=>{
  for(const stage of ['reference','overall']) {
    const r=await rig(),{game,driver,radio,time}=r;let release;
    if(stage==='overall')await r.start();
    radio.block=p=>p[1]===ID.BATTERY?new Promise(resolve=>release=resolve):undefined;
    driver.car.refreshBattery();await settle();const prior=speeds(radio).filter(s=>s>0).length;
    if(stage==='reference')game.startForwardBaseline(driver);
    else {game.topSpeed=150;time(200);game.tick(.04,200);}
    time(stage==='reference'?5001:120001);release();await settle();await settle();
    assert.equal(speeds(radio).filter(s=>s>0).length,prior,stage);assert.equal(driver.car.speed,0,stage);assert.equal(game.forwardBaseline,null,stage);
  }
});

test('lost, expired or reversed optical evidence cannot count toward successful forward laps',async()=>{
  for(const event of ['unmapped','unknown-code','reversed','optical-silence']) {
    const r=await rig(),{game,driver,radio,time}=r;await r.start();time(200);
    if(event==='unmapped')radio.emit(position({piece:99}));
    if(event==='unknown-code')radio.emit(position({code:255}));
    if(event==='reversed')radio.emit(position({reverse:true}));
    if(event==='optical-silence'){
      for(const t of [1000,2000]){time(t);radio.emit(transition());game.tick(.04,t);}
      time(2101);game.tick(.04,2101);
    }
    await settle();assert.equal(game.forwardBaseline,null,event);assert.equal(driver.car.speed,0,event);assert.equal(driver.car.telemetry.forwardBaseline.stage,'failed',event);
    assert.equal(driver.car.telemetry.forwardBaseline.laps,0,event);
  }
});

test('STOP, lifecycle changes and withdrawn maneuver lock end the baseline without held-input restart',async()=>{
  for(const action of ['host-stop','car-stop','controller','model','crew','map','add-car','remove-car','battle','unlock','zero-ceiling']) {
    const r=await rig(),{game,driver,time,timers}=r;await r.start();
    driver.input={throttle:1,lane:45,attack:true};driver.objectiveInput={throttle:1,lane:45};
    if(action==='host-stop')game.stopAll();if(action==='car-stop')driver.car.stop();
    if(action==='controller')game.setControl(driver,'browser');if(action==='model')game.setModel(driver,18);
    if(action==='crew')game.setCrew(driver,'sun');if(action==='map')game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));
    if(action==='add-car'){const d=game.addCar(radio());await d.car.initialization;await d.car.pumpPromise;}
    if(action==='remove-car')await game.removeCar(driver);
    if(action==='battle')game.battle.active=true;if(action==='unlock')driver.car.unlockManeuvers();if(action==='zero-ceiling')game.topSpeed=0;
    time(300);game.tick(.04,300);await settle();assert.equal(game.forwardBaseline,null,action);assert.equal(driver.car.speed,0,action);
    assert.equal(driver.cpuArmed,false,action);assert.equal(driver.armed,false,action);assert.ok(timers.every(t=>t.cancelled),action);
  }
});

test('the captured pace never rises after start and respects a lower operator ceiling',async()=>{
  const r=await rig(),{game,driver,time}=r;game.topSpeed=250;await r.start();assert.equal(driver.car.speed,250);
  game.topSpeed=1400;time(200);game.tick(.04,200);assert.equal(driver.car.speed,250);
  game.topSpeed=150;time(300);game.tick(.04,300);assert.equal(driver.car.speed,150);
  game.stopAll();await settle();
});

test('baseline requires one ready stopped computer car, an identified closed map and a fresh healthy battery',async()=>{
  const cases=[
    ['browser',({game,driver})=>game.setControl(driver,'browser')],['moving',({driver})=>{driver.car.recover();driver.car.setSpeed(100);}],
    ['no-map',({game})=>game.track=null],['open-map',({game})=>game.track.closed=false],['inferred',({game})=>game.track.inferredCount=1],
    ['stale-battery',({time})=>time(30001)],['missing-battery',({driver})=>driver.car.telemetry.batteryAt=undefined],
    ['charging',({radio})=>radio.emit([5,ID.STATUS,1,1,0,0])],['low-battery',({radio})=>radio.emit([5,ID.STATUS,1,0,1,0])],
    ['faulted',({driver})=>driver.car.faulted=true],['initializing',({driver})=>driver.car.initializing=true],['disconnected',({driver})=>driver.car.connected=false],
    ['off-track-latch',({driver})=>driver.car.safetyReason='Off track'],['second-car',async({game})=>{const d=game.addCar(radio());await d.car.initialization;}],
    ['active-round',({game})=>game.battle.active=true],['pit',({game})=>game.pitReason='Recover'],['scan',({game})=>game.phase='scanning'],
    ['existing-baseline',({game,driver})=>game.startForwardBaseline(driver)],['zero-speed',({game})=>game.topSpeed=0],['invalid-speed',({game})=>game.topSpeed=NaN]
  ];
  for(const [name,mutate] of cases){const r=await rig();await mutate(r);await settle();const before=r.game.forwardBaseline;assert.throws(()=>r.game.startForwardBaseline(r.driver),undefined,name);assert.equal(r.game.forwardBaseline,before,name);r.game.stopAll();await settle();}
});

test('special track tiles remain eligible for unscored baseline but blocked for scored rounds',async()=>{
  const r=await rig(),{game,driver}=r;
  game.loadTrack([[33,false],[18,false],[57,true],[39,false],[20,false],[17,false],[17,true],[23,false],[36,false],[18,false],[34,false]].map(([id,reverse])=>({id,reverse})));assert.equal(game.track.unverifiedCount,1);
  game.startForwardBaseline(driver);assert.ok(game.forwardBaseline);game.stopAll();await settle();
  assert.throws(()=>game.startBattle(),/Special track pieces/);
});


test('the real simulator completes three baseline laps on ordinary and observed Power Zone maps with default watchdogs',async()=>{
  const observed=[[33,false],[18,false],[57,true],[39,false],[20,false],[17,false],[17,true],[23,false],[36,false],[18,false],[34,false]];
  for(const layout of ['Starter oval','Capsule','observed Power Zone'])for(const lateral of [-22.5,22.5]) {
    let now=0;const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now});
    game.topSpeed=300;
    const world=new SimWorld(game.pieces,layout==='observed Power Zone'?'Capsule':layout);
    if(layout==='observed Power Zone')world.track=buildTrack(game.pieces,observed);
    const transport=world.addCar({lateral,progress:0.05});
    const driver=game.addCar(transport,{control:'bot',simulated:true});await driver.car.initialization;await driver.car.pumpPromise;
    game.useTrack(world.track);game.stopAll();await driver.car.pumpPromise;
    game.startForwardBaseline(driver);await driver.car.pumpPromise;
    for(let i=0;i<6001 && game.forwardBaseline;i++) {
      now+=20;world.step(.02);game.tick(.02,now);await driver.car.pumpPromise;
    }
    assert.equal(game.forwardBaseline,null,layout+' '+lateral);
    assert.equal(driver.car.telemetry.forwardBaseline.stage,'complete',layout+' '+lateral+': '+game.pitReason);
    assert.equal(driver.car.telemetry.forwardBaseline.laps,3);assert.equal(driver.car.speed,0);
    assert.equal(game.pitReason,null);assert.equal(game.safety.firstTrackMs,5000);assert.equal(game.safety.trackGapMs,2000);
    assert.equal(transport.written.some(p=>[ID.CHANGE_LANE,ID.TURN].includes(p[1])),false);
    await game.removeCar(driver);
  }
});
