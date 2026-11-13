import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {buildTrack, LAYOUTS} from './sim.mjs';
import {ID} from './protocol.mjs';

// Fake radio/scheduler exercise host control, not firmware or physical steering.
const data = name => JSON.parse(readFileSync(new URL('./data/'+name+'.json', import.meta.url)));
const settle = () => new Promise(resolve => setImmediate(resolve));
const lanes = radio => radio.sent.filter(p => p[1] === ID.CHANGE_LANE);
const speeds = radio => radio.sent.filter(p => p[1] === ID.SPEED).map(p => p[2] + 256*p[3]);
const f32 = (packet, offset) => new DataView(Uint8Array.from(packet).buffer).getFloat32(offset, true);
function position({piece=36, location=15, speed=300, offset=-22.5} = {}) {
  const p = new Uint8Array(17), view = new DataView(p.buffer);
  p[0]=16; p[1]=ID.POSITION; p[2]=location; p[3]=piece;
  view.setFloat32(4,offset,true); view.setUint16(8,speed,true);
  p[10]=7; p[11]=p[12]=255; view.setUint16(15,300,true);
  return p;
}
async function rig() {
  let now=0, notify;
  const timers=[];
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,
    schedule:(fn,ms)=>{const timer={fn,ms,due:now+ms,cancelled:false};timers.push(timer);return timer;},
    unschedule:timer=>{timer.cancelled=true;}});
  const radio={initializationProfile:'sdk',sent:[],onNotify(fn){notify=fn;return()=>{};},close(){},
    emit(bytes){notify(Uint8Array.from(bytes));},async write(bytes){
      await radio.block?.(bytes); radio.sent.push([...bytes]);
      if(bytes[1]===ID.PING)queueMicrotask(()=>radio.emit([1,0x17]));
      if(bytes[1]===ID.VERSION)queueMicrotask(()=>radio.emit([3,0x19,0x5a,0x2e]));
    }};
  const driver=game.addCar(radio,{control:'browser'});
  await driver.car.initialization; await driver.car.pumpPromise;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule)); game.stopAll(); await driver.car.pumpPromise;
  radio.emit([3,0x1b,0,16]); radio.emit([5,0x3f,1,0,0,1]); radio.sent=[];
  return {game,driver,radio,timers,time:t=>{now=t;},async fireDue(t){
    now=t;
    for(const timer of timers)if(!timer.cancelled && !timer.fired && timer.due<=now){timer.fired=true;timer.fn();}
    await settle();
  }};
}

test('steering trial requires map, fresh battery and clear health before motion',async()=>{
  const {game,driver,radio,time}=await rig();const track=game.track;
  game.track=null;assert.throws(()=>game.startDiagnostic(driver,{steering:true}),/map|track/i);
  game.track=track;track.inferredCount=1;assert.throws(()=>game.startDiagnostic(driver,{steering:true}),/infer|track/i);
  track.inferredCount=0;time(30001);assert.throws(()=>game.startDiagnostic(driver,{steering:true}),/battery|refresh/i);
  radio.emit([3,0x1b,0,16]);radio.emit([5,0x3f,1,1,0,0]);
  assert.throws(()=>game.startDiagnostic(driver,{steering:true}),/charging/i);
  assert.equal(speeds(radio).some(s=>s>0),false);
});

test('fresh straight position requests one relative left move then stops after 750 ms',async()=>{
  const r=await rig(),{game,driver,radio,timers,time}=r;
  driver.car.targetLateral=-45;game.topSpeed=600;game.startDiagnostic(driver,{steering:true});await settle();
  assert.equal(driver.car.speed,300);assert.equal(timers[0].ms,4000);assert.equal(game.halted,true);
  // Existing control inputs and ordinary steerTo must not interfere with this one-shot.
  driver.input={throttle:1,lane:-45,attack:true};driver.car.steerTo(-45);game.tick(.04,50);await settle();
  assert.equal(lanes(radio).length,0);
  time(100);radio.emit(position());await settle();
  assert.equal(lanes(radio).length,1);assert.equal(f32(lanes(radio)[0],6),-45);
  time(200);radio.emit(position({location:18,offset:-13.5}));await settle();assert.equal(lanes(radio).length,1);
  assert.ok(timers.some(t=>t.ms===750));await r.fireDue(850);
  assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);assert.equal(speeds(radio).at(-1),0);
  time(5000);for(const timer of timers)timer.fn();game.tick(.04,5000);await settle();
  assert.equal(lanes(radio).length,1);assert.equal(speeds(radio).filter(s=>s>0).length,1);
});

test('uncertain telemetry, old position and insufficient remaining time cannot authorize a lane',async()=>{
  const {game,driver,radio,time,timers}=await rig();
  radio.emit(position());game.startDiagnostic(driver,{steering:true});await settle();
  assert.equal(lanes(radio).length,0,'pre-trial position is not fresh trial evidence');
  const samples=[position({piece:57}),position({piece:18}),position({piece:200}),position({location:255}),position({speed:0}),position({location:17}),position({location:0}),
    [7,0x36,0x2c,1,0xe8,3,0x2c,1],[17,0x29,0,0,0,0,0,0,255,255,0,0,0x2c,1,0,0,0,0]];
  for(const [i,p] of samples.entries()){time(100+i*100);radio.emit(p);await settle();assert.equal(lanes(radio).length,0);}
  time(3300);radio.emit(position());await settle();assert.equal(lanes(radio).length,0,'less than 750 ms remains');
  time(4000);timers[0].fn();await settle();assert.equal(driver.car.speed,0);
});

test('expired transport queue or in-flight offset cannot deliver a pending lane after the deadline',async()=>{
  for(const blockedId of [ID.BATTERY,ID.SET_OFFSET]){
    const {game,driver,radio,time}=await rig();game.startDiagnostic(driver,{steering:true});await settle();
    let release;radio.block=bytes=>{if(bytes[1]===blockedId)return new Promise(resolve=>release=resolve);};
    if(blockedId===ID.BATTERY){driver.car.refreshBattery();await settle();}
    time(100);radio.emit(position());await settle();assert.ok(release);
    // Let the transport finish before an overdue timer gets a callback. The
    // write-boundary deadline must still reject the queued lane.
    time(5000);release();await settle();await settle();
    assert.equal(lanes(radio).length,0);assert.equal(driver.car.speed,0);
    assert.equal(speeds(radio).at(-1),0);
  }
});

test('steering trial retains normal collision reporting and stops on actual lane cancellation',async()=>{
  const {game,driver,radio,time}=await rig();game.startDiagnostic(driver,{steering:true});await settle();
  time(100);radio.emit([3,0x4d,1,0]);await settle();
  assert.equal(driver.car.telemetry.collisions,1);assert.equal(driver.car.speed,300);assert.equal(game.pitReason,null);
  time(200);radio.emit(position());await settle();assert.equal(lanes(radio).length,1);
  radio.emit([14,0x41,0,0,0,0,0,0,0,0,0,0,0,0,0x80]);await settle();
  assert.match(game.pitReason,/Lane change cancelled/);assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);
});

test('steering acquisition expires without telemetry and cannot resume from stale controls',async()=>{
  const r=await rig(),{game,driver,radio}=r;game.startDiagnostic(driver,{steering:true});await settle();
  driver.input={throttle:1,lane:45,attack:true};await r.fireDue(4000);game.tick(.04,5000);await settle();
  assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);assert.equal(lanes(radio).length,0);
  assert.equal(speeds(radio).filter(s=>s>0).length,1);
});

test('steering acquisition obeys telemetry gaps, off-road and connection-loss stops',async()=>{
  for(const fault of ['gap','off-road','connection']){
    const {game,driver,radio,time}=await rig();game.startDiagnostic(driver,{steering:true});await settle();
    time(100);radio.emit(position({piece:18}));await settle(); // valid optical heartbeat, not a straight steering opportunity
    if(fault==='gap'){time(2201);game.tick(.04,2201);}
    if(fault==='off-road')radio.emit([1,0x2b]);
    if(fault==='connection')driver.car.connectionLost();
    await settle();assert.equal(driver.car.speed,0,fault);assert.equal(game.diagnostic,null,fault);
    assert.ok(game.pitReason,fault);assert.equal(lanes(radio).length,0,fault);
  }
});
