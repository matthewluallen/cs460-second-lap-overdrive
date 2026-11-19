import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';

const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const track=JSON.parse(readFileSync(new URL('./fixtures/guardian-sdk-scan-2026-11-18.json',import.meta.url))).diagnostics.track;
// Synthetic ordinary optical frames; no test contacts a car. The clock jumps
// model a notification/microtask running before an overdue control-loop timer.
const position=code=>Uint8Array.from([16,0x27,code,39,0,0,0xfc,0xc1,0x2c,1,0x47,255,255,0,0,0x2c,1]);
const transition=Uint8Array.from([17,0x29,0,0,0,0,0xfc,0xc1,255,255,0,0,0x2c,1,0,0,0,0]);
const speed=packet=>packet[2]+256*packet[3];
const settle=()=>new Promise(resolve=>setImmediate(resolve));

async function rig({grace=0,firstPosition=true}={}) {
  let now=0,notify;
  const writes=[],timers=[];
  const radio={onNotify(fn){notify=fn;return()=>{};},emit(bytes){notify(bytes);},close(){},
    async write(packet){await radio.block?.(packet);writes.push({at:now,packet:[...packet]});}};
  const game=new Game({pieces:data('pieces'),vehicles:data('vehicles'),weapons:data('weapons'),clock:()=>now,
    schedule:(fn,ms)=>{const timer={fn,at:now+ms,cancelled:false};timers.push(timer);return timer;},
    unschedule:timer=>{timer.cancelled=true;}});
  const driver=game.addCar(radio,{name:'Synthetic car',model:12,control:'browser'});
  await driver.car.initialization;await driver.car.pumpPromise;
  game.loadTrack(track);game.stopAll();await driver.car.pumpPromise;
  game.setDrivingOptions({maximumSpeed:600,telemetryGraceMs:grace});game.resume();driver.input.throttle=1;
  now=40;game.tick(.04,now);await driver.car.pumpPromise;
  if(firstPosition){now=100;radio.emit(position(35));await driver.car.pumpPromise;}
  return {game,driver,radio,writes,timers,time:t=>{now=t;},tick:()=>game.tick(.04,now)};
}

async function deliver(r,at,order,packet=position(34)) {
  r.time(at);
  if(order==='tick first')r.tick();
  r.radio.emit(packet);
  if(order==='callback first')r.tick();
  await r.driver.car.pumpPromise;
}

for(const order of ['callback first','tick first']) {
  test(`first optical deadline cannot be replaced by a late reading: ${order}`,async()=>{
    const r=await rig({firstPosition:false});
    await deliver(r,5041,order);
    assert.equal(r.game.halted,true);assert.equal(r.driver.car.speed,0);assert.match(r.game.pitReason,/Telemetry timeout/);
    assert.equal(r.driver.armed,false);
    assert.ok(r.writes.filter(e=>e.at>=5041&&e.packet[1]===0x24).every(e=>speed(e.packet)===0));
  });

  test(`strict optical gap cannot be hidden by a late reading: ${order}`,async()=>{
    const r=await rig();await deliver(r,2101,order);
    assert.equal(r.game.halted,true);assert.equal(r.driver.car.speed,0);assert.match(r.game.pitReason,/Telemetry timeout/);
    assert.equal(r.driver.car.physicalLaneReference,null);
    if(order==='callback first')assert.equal(r.driver.car.lastTrackAt,100,'rejected observation cannot replace the old watchdog basis');
    r.driver.input.throttle=1;r.time(2200);r.tick();await r.driver.car.pumpPromise;
    assert.equal(r.driver.car.speed,0,'a held control cannot restart the car');
  });

  test(`late optical callback first enters the existing fixed recovery window: ${order}`,async()=>{
    const r=await rig({grace:1000});await deliver(r,2200,order);
    assert.equal(r.game.halted,false);assert.equal(r.driver.car.speed,300);
    assert.equal(r.driver.telemetryGrace.until,3100,'recovery remains anchored to the reading at100ms');
    assert.equal(r.driver.car.maneuversLocked,true);assert.equal(r.driver.car.telemetry.telemetryHealth.state,'degraded');
    assert.equal(r.driver.telemetryGrace.candidate.at,2200,'the delayed first sample is only one recovery candidate');
    r.time(2300);r.radio.emit(position(33));await r.driver.car.pumpPromise;
    assert.equal(r.driver.telemetryGrace,null);assert.equal(r.driver.car.telemetry.telemetryHealth.state,'reacquired');
    r.tick();await r.driver.car.pumpPromise;assert.equal(r.driver.car.speed,600);
    r.game.stopAll();await r.driver.car.pumpPromise;
  });

  test(`a callback after the optional final deadline cannot silently skip recovery: ${order}`,async()=>{
    const r=await rig({grace:1000});await deliver(r,3100,order);
    assert.equal(r.game.halted,true);assert.equal(r.driver.car.speed,0);assert.match(r.game.pitReason,/Telemetry timeout/);
    assert.equal(r.driver.telemetryGrace,null);
    assert.ok(r.writes.filter(e=>e.at>=3100&&e.packet[1]===0x24).every(e=>speed(e.packet)===0));
  });
}

test('a transition callback cannot refresh an expired ordinary watchdog',async()=>{
  const r=await rig();await deliver(r,2101,'callback first',transition);
  assert.equal(r.game.halted,true);assert.equal(r.driver.car.lastTrackAt,100);
  assert.equal(r.driver.car.speed,0);assert.match(r.game.pitReason,/Telemetry timeout/);
});

test('two coalesced late positions enter grace without inventing distinct observation times',async()=>{
  const r=await rig({grace:1000});
  await deliver(r,2200,'callback first',Uint8Array.from([...position(34),...position(33)]));
  assert.equal(r.driver.car.speed,300);assert.equal(r.driver.telemetryGrace.until,3100);
  assert.equal(r.driver.car.maneuversLocked,true);assert.equal(r.driver.car.telemetry.telemetryHealth.state,'degraded');
  r.game.stopAll();await r.driver.car.pumpPromise;
});

test('an overdue coalesced batch cannot refresh location after its first sample trips STOP',async()=>{
  const r=await rig();
  await deliver(r,2101,'callback first',Uint8Array.from([...position(34),...position(33)]));
  assert.equal(r.game.halted,true);assert.equal(r.driver.car.speed,0);
  assert.equal(r.driver.car.lastTrackAt,100,'the entire overdue optical batch remains rejected');
  assert.equal(r.driver.car.localizer.reference.at,100);
  assert.equal(r.driver.car.telemetry.rejectedTrackObservations,2);
  // A separate later notification remains visible to the existing STOP alarm;
  // suppressing this one batch must not conceal continued physical activity.
  r.time(3202);r.radio.emit(position(34));r.tick();await r.driver.car.pumpPromise;
  assert.equal(r.driver.car.lastTrackAt,3202);assert.match(r.game.pitReason,/STOP not confirmed/);
  assert.equal(r.driver.car.speed,0);
});

test('existing exact first-reading and gap boundaries remain unchanged',async()=>{
  for(const [firstPosition,at] of [[false,5040],[true,2100]]){
    const r=await rig({firstPosition});await deliver(r,at,'callback first');
    assert.equal(r.game.halted,false);assert.equal(r.driver.car.speed,600);
    r.game.stopAll();await r.driver.car.pumpPromise;
  }
});

for(const grace of [0,1000])test(`queued acceleration rechecks the ordinary optical deadline before transport (grace ${grace}ms)`,async()=>{
  const r=await rig({grace});
  // Extend only the synthetic GATT timeout to isolate the earlier optical
  // deadline; the production one-second write timeout is unchanged.
  r.driver.car.writeTimeoutMs=10000;
  let release;r.radio.block=async packet=>{if(packet[1]===0x1a)await new Promise(resolve=>{release=resolve;});};
  r.time(200);r.driver.car.refreshBattery();while(!release)await settle();
  r.driver.car.setSpeed(900);r.time(2200);release();await r.driver.car.pumpPromise;
  const after=r.writes.filter(e=>e.at>=2200&&e.packet[1]===0x24).map(e=>speed(e.packet));
  assert.equal(after.includes(900),false,'queued acceleration never reaches the radio after the gap');
  if(grace){assert.deepEqual(after,[300]);assert.equal(r.driver.telemetryGrace.until,3100);assert.equal(r.driver.car.maneuversLocked,true);}
  else {assert.deepEqual(after,[0]);assert.equal(r.game.halted,true);assert.match(r.game.pitReason,/Telemetry timeout/);}
  r.game.stopAll();await r.driver.car.pumpPromise;
});

test('scan wall-clock budget wins over a newly delivered optical sample',async()=>{
  const r=await rig({firstPosition:false});r.game.stopAll();await r.driver.car.pumpPromise;r.game.startScan(r.driver);await r.driver.car.pumpPromise;
  for(let at=1000;at<=45000;at+=1000){r.time(at);r.radio.emit(position(35));await r.driver.car.pumpPromise;}
  r.time(45041);r.radio.emit(position(34));await r.driver.car.pumpPromise;
  assert.equal(r.game.halted,true);assert.equal(r.driver.car.speed,0);assert.match(r.game.pitReason,/Scan time budget/);
  assert.equal(r.driver.car.lastTrackAt,45000);
});

test('diagnostic window expires before a delayed optical callback can recalibrate',async()=>{
  const r=await rig();r.game.stopAll();await r.driver.car.pumpPromise;
  r.radio.emit(Uint8Array.of(3,0x1b,0,16));r.game.startDiagnostic(r.driver);await r.driver.car.pumpPromise;
  r.time(600);r.radio.emit(position(34));await r.driver.car.pumpPromise;
  assert.equal(r.game.diagnostic,null);assert.equal(r.driver.car.speed,0);assert.equal(r.game.halted,true);
  assert.equal(r.driver.car.lastTrackAt,100);
  assert.ok(r.writes.filter(e=>e.at>=600).every(e=>e.packet[1]!==0x2c));
});
