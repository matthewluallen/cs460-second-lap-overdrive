import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const plan=[[33,false],[18,false],[57,true],[39,false],[20,false],[17,false],[17,true],[23,false],[36,false],[18,false],[34,false]].map(([id,reverse])=>({id,reverse}));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function position(id,code,reverse){
  const p=new Uint8Array(17),v=new DataView(p.buffer);p[0]=16;p[1]=0x27;p[2]=code;p[3]=id;v.setFloat32(4,654321,true);v.setUint16(8,300,true);p[10]=reverse?0x47:7;p[11]=p[12]=255;v.setUint16(15,300,true);return p;
}
async function rig(mode='boost',options={maximumSpeed:600}){
  let now=0,notify;const writes=[];
  const radio={onNotify(fn){notify=fn;return()=>{};},async write(p){writes.push([...p]);},close(){}};
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,schedule:()=>({}),unschedule(){}});
  const driver=game.addCar(radio,{model:12,control:'browser'});await settle();game.loadTrack(plan);game.stopAll();await driver.car.pumpPromise;
  game.setDrivingOptions(options);game.setPowerZoneMode(mode);game.resume();driver.input.throttle=.5;
  async function advance(at){now=at;game.tick(.04);await driver.car.pumpPromise;}
  async function emit(at,id,code,reverse){now=at;notify(position(id,code,reverse));await driver.car.pumpPromise;}
  await advance(40);
  async function cross(){await emit(100,57,23,true);await emit(1420,57,21,true);await emit(2100,39,0,false);}
  return{game,driver,radio,writes,advance,emit,cross,time:t=>{now=t;}};
}

test('optional custom boost is triggered by actual Game observations and remains inside maximum, ramp and STOP gates',async()=>{
  const{game,driver,cross,advance,writes}=await rig();await cross();
  assert.equal(game.powerZoneMode,'boost');assert.equal(game.snapshot()[0].powerZone.effect.type,'boost');
  await advance(2100);assert.equal(driver.car.speed,375);
  game.setDrivingOptions({maximumSpeed:320});driver.input.throttle=1;await advance(2140);assert.equal(driver.car.speed,320);
  driver.input.throttle=0;await advance(2180);assert.equal(driver.car.speed,0);assert.equal(game.snapshot()[0].powerZone.effect,null);
  assert.equal(writes.some(p=>p[1]===0x25),false,'checkpoint never sends a lane command');
  assert.throws(()=>game.startBattle(),/unverified/,'custom rule does not weaken special-piece scoring restrictions');
  const smooth=await rig('boost',{maximumSpeed:600,rampMs:4000});await smooth.cross();
  const before=smooth.driver.car.speed;await smooth.advance(2100);
  assert.ok(smooth.driver.car.speed<375);assert.ok(smooth.driver.car.speed>=before);
  smooth.game.stopAll();await smooth.driver.car.pumpPromise;
});

test('custom shield survives Battle.update, expires on battle time and is cleared by pause or STOP',async()=>{
  const{game,driver,cross,advance,time}=await rig('shield');await cross();
  const fighter=game.battle.get(driver.car);assert.equal(fighter.customShieldUntil,5100);
  // Virtual damage application is tested directly. This does not start a scored
  // round on special57, whose existing restriction remains intact.
  game.battle.active=true;game.battle.update(0,2100);
  const energy=fighter.energy;game.battle.damage(fighter,2,null,2101);assert.equal(fighter.energy,energy);
  game.battle.damage(fighter,2,null,5100);assert.equal(fighter.energy,energy-2,'exact expiry does not retain a stale shield bit');
  fighter.customShieldUntil=9000;game.battle.pause(5200);assert.equal(fighter.customShieldUntil,0);
  game.battle.resume(5300);assert.equal(fighter.customShieldUntil,0);
  fighter.customShieldUntil=9000;time(5400);game.stopAll();await driver.car.pumpPromise;
  assert.equal(fighter.customShieldUntil,0);assert.equal(game.snapshot()[0].powerZone.effect,null);
  await advance(5450);assert.equal(driver.car.speed,0);
});

test('free-drive shield is visible without a combat participant and disappears at expiry or STOP',async()=>{
  const{game,driver,cross,time}=await rig('shield');
  game.battle.remove(driver.car);await cross();
  assert.equal(game.battle.active,false);assert.equal(game.battle.get(driver.car),undefined);
  assert.equal(game.snapshot()[0].shield,true,'free-drive visual shield does not require combat participation');
  assert.equal(game.snapshot(5100)[0].shield,false,'effect ends exactly at its wall-clock expiry');
  time(2200);game.stopAll();await driver.car.pumpPromise;
  assert.equal(game.snapshot()[0].shield,false);assert.equal(game.snapshot()[0].powerZone.effect,null);
});

test('scan, stale observations, stops and degraded telemetry cannot award or retain custom effects',async()=>{
  const{game,driver,emit,advance,cross}=await rig('shield',{maximumSpeed:600,telemetryGraceMs:1000});
  await emit(100,57,23,true);game.stopAll();await driver.car.pumpPromise;game.resume();driver.input.throttle=.5;await advance(120);
  await emit(1420,57,21,true);await emit(2100,39,0,false);assert.equal(game.snapshot()[0].powerZone.effect,null);
  game.stopAll();await driver.car.pumpPromise;game.startScan(driver);await driver.car.pumpPromise;
  await emit(2200,57,23,true);await emit(3520,57,21,true);await emit(4200,39,0,false);assert.equal(game.snapshot()[0].powerZone.effect,null);
  game.stopAll();await driver.car.pumpPromise;
  const degraded=await rig('shield',{maximumSpeed:600,telemetryGraceMs:1000});await degraded.cross();
  await degraded.advance(4101);assert.equal(degraded.driver.car.telemetry.telemetryHealth.state,'degraded');
  assert.equal(degraded.game.snapshot()[0].powerZone.effect,null);assert.equal(degraded.game.battle.get(degraded.driver.car).customShieldUntil,0);
  degraded.game.stopAll();await degraded.driver.car.pumpPromise;
});
