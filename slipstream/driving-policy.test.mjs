import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {FaultTransport} from './faults.mjs';
import {SimWorld} from './sim.mjs';

const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const track=JSON.parse(readFileSync(new URL('./fixtures/guardian-sdk-scan-2026-11-18.json',import.meta.url))).diagnostics.track;
const settle=()=>new Promise(resolve=>setImmediate(resolve));
// Synthetic fault-injection samples use verified piece39 geometry; they are not
// a physical run or evidence that any recovery timing works on hardware.
const position=code=>Uint8Array.from([16,0x27,code,39,0,0,0xfc,0xc1,0x2c,1,0x47,255,255,0,0,0x2c,1]);
const transition=Uint8Array.from([17,0x29,0,0,0,0,0xfc,0xc1,255,255,0,0,0x2c,1,0,0,0,0]);
async function rig(options={}){
  let now=0,notify;const timers=[],writes=[];
  const inner={onNotify(fn){notify=fn;return()=>{};},emit(b){notify(b);},async write(b){await inner.block?.(b);writes.push({at:now,packet:[...b]});},close(){}};
  const radio=new FaultTransport(inner);
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,
    schedule:(fn,ms)=>{const timer={fn,at:now+ms,cancelled:false};timers.push(timer);return timer;},unschedule:t=>{t.cancelled=true;}});
  const driver=game.addCar(radio,{name:'Synthetic car',model:12,control:'browser'});await settle();
  game.loadTrack(track);game.stopAll();await driver.car.pumpPromise;
  if(Object.keys(options).length)game.setDrivingOptions(options);else game.topSpeed=600;
  game.resume();driver.input.throttle=1;
  async function advance(at){now=at;game.tick(.04);await driver.car.pumpPromise;}
  await advance(40);now=100;inner.emit(position(35));await driver.car.pumpPromise;
  return{game,driver,radio,inner,writes,timers,time:t=>{now=t;},advance};
}
const speeds=writes=>writes.filter(e=>e.packet[1]===0x24).map(e=>e.packet[2]+256*e.packet[3]);

test('default two-second telemetry loss still hard-stops and cannot resume held input',async()=>{
  const {game,driver,radio,inner,advance}=await rig();radio.silentTelemetry=true;
  inner.emit(position(34));await advance(2101);
  assert.equal(game.safety.trackGapMs,2000);assert.match(game.pitReason,/Telemetry timeout/);assert.equal(driver.car.speed,0);
  radio.silentTelemetry=false;inner.emit(position(34));driver.input.throttle=1;await advance(2200);
  assert.equal(driver.car.speed,0);assert.equal(driver.armed,false);
});

test('explicit brief-gap policy slows without steering, requires two consistent optical reads, and never extends its deadline on transitions',async()=>{
  const {game,driver,radio,inner,advance,time,writes}=await rig({maximumSpeed:600,telemetryGraceMs:1000});
  radio.silentTelemetry=true;await advance(2101);
  assert.equal(driver.car.speed,300);assert.equal(game.pitReason,null);assert.equal(driver.car.maneuversLocked,true);
  assert.equal(game.snapshot()[0].telemetryHealth.state,'degraded');assert.equal(driver.telemetryGrace.until,3100);
  assert.equal(driver.car.localizer.diagnostics(2101).trusted,false);
  const atGap=writes.length;driver.input.lane=54;driver.car.uturn();await advance(2200);
  assert.equal(writes.slice(atGap).some(e=>[0x25,0x32].includes(e.packet[1])),false);
  radio.silentTelemetry=false;time(2250);inner.emit(transition);await driver.car.pumpPromise;
  assert.equal(driver.telemetryGrace.until,3100);assert.equal(driver.car.maneuversLocked,true);
  time(2300);inner.emit(position(35));await driver.car.pumpPromise;assert.ok(driver.telemetryGrace,'one observation does not unlock maneuvers');
  time(2450);inner.emit(position(34));await driver.car.pumpPromise;
  assert.equal(driver.telemetryGrace,null);assert.equal(driver.car.maneuversLocked,false);
  assert.equal(game.snapshot()[0].telemetryHealth.state,'reacquired');
  await advance(2460);assert.equal(driver.car.speed,600);
});

test('brief-gap deadline latches STOP even with transition chatter and late optical recovery',async()=>{
  const {game,driver,inner,advance,time,timers,writes}=await rig({maximumSpeed:200,telemetryGraceMs:1000});
  await advance(2101);assert.equal(driver.car.speed,200,'degradation must never raise a lower requested speed');
  time(3000);inner.emit(transition);await driver.car.pumpPromise;
  time(3100);for(const timer of timers.filter(t=>!t.cancelled&&t.at<=3100))timer.fn();await driver.car.pumpPromise;
  assert.equal(driver.car.speed,0);assert.match(game.pitReason,/Telemetry timeout/);
  const stopped=writes.length;time(3110);inner.emit(position(35));inner.emit(position(34));driver.input.throttle=1;await advance(3200);
  assert.equal(driver.car.speed,0);assert.ok(speeds(writes.slice(stopped)).every(speed=>speed===0));
});

test('manual stop, recovery entry, off-track and link loss remain hard stops during a grace period',async()=>{
  for(const fault of ['manual','recovery','off-track','link']){
    const {game,driver,inner,advance}=await rig({maximumSpeed:600,telemetryGraceMs:1000});await advance(2101);
    if(fault==='manual')game.stopAll();
    if(fault==='recovery')inner.emit(Uint8Array.of(1,0x43));
    if(fault==='off-track')inner.emit(Uint8Array.of(1,0x2b));
    if(fault==='link')driver.car.connectionLost('synthetic link loss');
    await driver.car.pumpPromise;assert.equal(driver.car.speed,0,fault);assert.equal(game.halted,true,fault);
    assert.equal(driver.telemetryGrace,null);driver.input.throttle=1;await advance(2300);assert.equal(driver.car.speed,0);
  }
});

test('optional acceleration ramps toward the selected cap; reductions and STOP are immediate',async()=>{
  const {game,driver,advance,writes}=await rig({maximumSpeed:1200,rampMs:2000});
  await advance(540);const first=driver.car.speed;assert.ok(first>0&&first<600);
  await advance(1040);assert.ok(driver.car.speed>first&&driver.car.speed<1200);
  // Keep the synthetic optical reference fresh independently of pacing.
  driver.car.lastTrackAt=1900;await advance(2040);assert.equal(driver.car.speed,1200);
  game.setDrivingOptions({maximumSpeed:450});await advance(2080);assert.equal(driver.car.speed,450);
  driver.input.throttle=0;await advance(2120);assert.equal(driver.car.speed,0);assert.equal(speeds(writes).at(-1),0);
  game.stopAll();driver.input.throttle=1;await advance(2500);assert.equal(driver.car.speed,0);
});

test('scan acquisition does not inherit the selected high ceiling, acceleration option or telemetry grace',async()=>{
  const {game,driver,inner,advance,time}=await rig({maximumSpeed:1200,rampMs:4000,telemetryGraceMs:1000});
  game.stopAll();await driver.car.pumpPromise;game.startScan(driver);await driver.car.pumpPromise;
  assert.ok(driver.car.speed<=300);time(5000);inner.emit(position(35));await driver.car.pumpPromise;await advance(7001);
  assert.equal(driver.car.speed,0);assert.match(game.pitReason,/Telemetry timeout/);assert.equal(driver.telemetryGrace,null);
});

test('driving-option validation is atomic and grace cannot be enabled while moving',async()=>{
  const {game}=await rig();
  for(const options of [{maximumSpeed:1201},{maximumSpeed:NaN},{rampMs:-1},{telemetryGraceMs:500}])assert.throws(()=>game.setDrivingOptions(options));
  assert.equal(game.topSpeed,600);assert.throws(()=>game.setDrivingOptions({maximumSpeed:1200,telemetryGraceMs:1000}),/Stop/);assert.equal(game.topSpeed,600);
});

test('releasing throttle during telemetry grace preserves its queued zero-speed write behind busy GATT',async()=>{
  const{game,driver,inner,advance,time,writes}=await rig({maximumSpeed:600,telemetryGraceMs:1000});await advance(2101);
  let release;inner.block=async packet=>{if(packet[1]===0x1a)await new Promise(resolve=>{release=resolve;});};
  driver.car.refreshBattery();while(!release)await settle();
  time(2200);driver.input.throttle=0;game.tick(.04);assert.equal(driver.car.speed,0);assert.equal(driver.telemetryGrace,null);
  release();await driver.car.pumpPromise;
  assert.equal(speeds(writes).at(-1),0,'ending grace must not delete the queued throttle-zero STOP');
});

test('full SimWorld optical loss enters grace and reacquires at the unchanged two-second freshness limit',async()=>{
  let now=0;const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,schedule:()=>({}),unschedule(){}});
  const world=new SimWorld(game.pieces,'Starter oval'),sim=world.addCar({index:4,progress:.05,lateral:22.5,model:12});
  const radio=new FaultTransport(sim),driver=game.addCar(radio,{model:12,simulated:true,control:'browser'});await settle();
  game.useTrack(world.track);game.stopAll();await driver.car.pumpPromise;game.setDrivingOptions({maximumSpeed:600,telemetryGraceMs:1000});game.resume();driver.input.throttle=1;
  let first,restored=false,degraded=false;
  for(now=40;now<=7000;now+=40){
    world.step(.04);game.tick(.04);await driver.car.pumpPromise;
    if(!first&&driver.car.telemetry.positions){first=now;radio.silentTelemetry=true;}
    if(first&&!restored&&now>=first+2120){radio.silentTelemetry=false;restored=true;}
    if(driver.telemetryGrace){degraded=true;assert.ok(driver.car.speed<=300);assert.equal(driver.car.maneuversLocked,true);}
    if(restored&&driver.car.telemetry.telemetryHealth?.state==='reacquired')break;
    assert.equal(game.pitReason,null);
  }
  assert.equal(degraded,true);assert.equal(driver.car.telemetry.telemetryHealth.state,'reacquired');
  assert.ok(now-first<3000);assert.equal(game.safety.trackGapMs,2000);assert.equal(game.pitReason,null);
  game.stopAll();await driver.car.pumpPromise;
});

for(const count of [1,2,3,4])test(`${count}-car simulated brief-gap recovery isolates one silent car until the shared deadline stops all`,async()=>{
  let now=0;
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,schedule:()=>({}),unschedule(){}});
  const world=new SimWorld(game.pieces,'Starter oval'),cars=[];
  for(let i=0;i<count;i++){
    const sim=world.addCar({index:4,progress:.05+i*.05,lateral:i%2?-22.5:22.5,model:12});
    const radio=new FaultTransport(sim),driver=game.addCar(radio,{name:`Simulation ${i+1}`,model:12,simulated:true,control:'browser'});
    cars.push({sim,radio,driver});
  }
  await settle();game.useTrack(world.track);game.stopAll();await Promise.all(cars.map(c=>c.driver.car.pumpPromise));
  game.setDrivingOptions({maximumSpeed:600,telemetryGraceMs:1000});game.resume();
  for(const{driver}of cars)driver.input.throttle=1;
  const lost=cars[0];let lastOptical,graceObserved=false,healthyFrames=0;
  for(now=40;now<=6000;now+=40){
    world.step(.04);game.tick(.04);await Promise.all(cars.map(c=>c.driver.car.pumpPromise));
    if(lastOptical===undefined&&lost.driver.car.telemetry.positions){
      lastOptical=lost.driver.car.lastTrackAt;lost.radio.silentTelemetry=true;
    }
    if(game.pitReason)break;
    if(lost.driver.telemetryGrace){
      graceObserved=true;
      assert.equal(lost.driver.telemetryGrace.until,lastOptical+3000,'the deadline belongs to the last received reading, not fleet activity');
      assert.equal(lost.driver.car.speed,300);assert.equal(lost.sim.targetSpeed,300);
      assert.equal(lost.driver.car.maneuversLocked,true);assert.equal(game.halted,false);
      for(const{driver,sim}of cars.slice(1)){
        assert.equal(driver.telemetryGrace,null,'a healthy car must not inherit another car\'s gap');
        assert.equal(driver.car.speed,driver.input.throttle*600);assert.equal(sim.targetSpeed,driver.car.speed);
        assert.ok(now-driver.car.lastTrackAt<=2000,'healthy cars still have actual fresh simulator telemetry');
        driver.input.throttle=.75; // Other controls remain effective during the single-car grace window.
      }
      healthyFrames++;
    }
  }
  assert.equal(graceObserved,true);assert.ok(healthyFrames>1);
  assert.ok(now>=lastOptical+3000&&now<=lastOptical+3040);
  assert.match(game.pitReason,/Telemetry timeout.*Simulation 1|Simulation 1.*Telemetry timeout/);
  assert.equal(game.halted,true);assert.equal(game.safety.trackGapMs,2000);
  const writtenAtStop=cars.map(({sim})=>sim.written.length);
  for(const{driver,sim}of cars){
    assert.equal(driver.car.speed,0);assert.equal(sim.targetSpeed,0);assert.equal(driver.armed,false);
    assert.equal(driver.telemetryGrace,null);
    const stop=sim.written.filter(p=>p[1]===0x24).at(-1);assert.equal(stop[2]+256*stop[3],0);
  }
  lost.radio.silentTelemetry=false;
  for(let step=0;step<15;step++){
    now+=40;for(const{driver}of cars)driver.input.throttle=1;
    world.step(.04);game.tick(.04);await Promise.all(cars.map(c=>c.driver.car.pumpPromise));
  }
  cars.forEach(({driver,sim},i)=>{
    assert.equal(driver.car.speed,0);assert.equal(sim.targetSpeed,0);
    assert.ok(sim.written.slice(writtenAtStop[i]).filter(p=>p[1]===0x24).every(p=>p[2]+256*p[3]===0),'late readings and held controls cannot restart any car');
  });
});
