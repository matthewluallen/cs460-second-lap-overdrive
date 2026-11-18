import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {buildTrack, LAYOUTS} from './sim.mjs';
import {ID} from './protocol.mjs';

const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function transport(profile='sdk',holdFirst=true) {
  let notify,release;
  const radio={initializationProfile:profile,sent:[],onNotify(fn){notify=fn;return()=>{};},close(){},
    emit(bytes){notify(Uint8Array.from(bytes));},release(){release?.();},
    async write(bytes){
      radio.sent.push([...bytes]);
      if(holdFirst && radio.sent.length===1)await new Promise(resolve=>release=resolve);
      if(bytes[1]===ID.PING)queueMicrotask(()=>radio.emit([1,ID.PING_REPLY]));
      if(bytes[1]===ID.VERSION)queueMicrotask(()=>radio.emit([5,ID.VERSION_REPLY,0x5a,0x2e,0,0]));
      if(bytes[1]===0x49)queueMicrotask(()=>radio.emit([3,0x23,255,255]));
    }};
  return radio;
}
function rig() {
  let now=0;
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now});
  return {game,time:t=>{now=t;}};
}
async function finish(driver,radio) {radio.release();await driver.car.initialization;await driver.car.pumpPromise;}
const speedRows=radio=>radio.sent.filter(p=>p[1]===ID.SPEED);

test('ordinary parked and unarmed computer ticks cannot interleave zero-speed commands with SDK or app initialization',async()=>{
  for(const profile of ['sdk','fast-furious'])for(const control of ['none','bot']) {
    const run=async tick=>{
      const {game}=rig(),radio=transport(profile),driver=game.addCar(radio,{control});
      await settle();assert.equal(driver.car.initializing,true);
      if(tick)for(let i=0;i<5;i++)game.tick(.04,i*40);
      await finish(driver,radio);assert.equal(driver.car.faulted,false);
      return radio.sent;
    };
    const expected=await run(false),withControlTicks=await run(true);
    assert.deepEqual(withControlTicks,expected,profile+'/'+control+' initialization must not depend on control-loop scheduling');
  }
});

test('an initializing car does not run CPU planning or weapon inputs while other host work continues',async()=>{
  const {game}=rig();game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));
  const radio=transport(),driver=game.addCar(radio,{control:'bot'});game.setControl(driver,'bot');game.armComputers();
  let plannerCalls=0,weaponCalls=0,battleTicks=0;
  driver.bot.drive=()=>plannerCalls++;
  game.battle.press=()=>weaponCalls++;
  game.battle.update=()=>battleTicks++;
  driver.input={throttle:1,lane:45,attack:true,support:true,special:true};
  driver.objectiveInput={throttle:1,lane:-45};
  await settle();game.tick(.04,40);await finish(driver,radio);
  assert.equal(plannerCalls,0,'the CPU must not produce commands during initialization');
  assert.equal(weaponCalls,0,'held gameplay input must not enter the initializing car');
  assert.equal(battleTicks,1,'only the initializing driver is skipped');
  assert.ok(speedRows(radio).every(p=>p[2]===0 && p[3]===0));
  assert.equal(radio.sent.some(p=>p[1]===ID.CHANGE_LANE || p[1]===ID.TURN),false);
});

test('explicit STOP still preempts pending initialization packets and stays latched after setup completes',async()=>{
  for(const profile of ['sdk','fast-furious']) {
    const {game}=rig(),radio=transport(profile),driver=game.addCar(radio,{control:'none'});
    await settle();assert.equal(radio.sent.length,1);
    game.stopAll();game.tick(.04,40);await finish(driver,radio);
    assert.deepEqual(radio.sent.slice(0,2),[[6,ID.SPEED,0,0,196,9,0],[6,ID.SPEED,0,0,196,9,0]],profile);
    assert.equal(game.halted,true);assert.equal(driver.car.safetyReason,'Host stopped');
    driver.input={throttle:1,lane:45,attack:true};game.tick(.04,80);await driver.car.pumpPromise;
    assert.ok(speedRows(radio).every(p=>p[2]===0 && p[3]===0));assert.equal(driver.car.speed,0);
  }
});

test('watchdog and shared pit still stop an initializing car when another moving car loses telemetry',async()=>{
  const {game,time}=rig(),movingRadio=transport(undefined,false),moving=game.addCar(movingRadio,{control:'none'});
  await finish(moving,movingRadio);moving.car.setSpeed(300);await moving.car.pumpPromise;
  const startingRadio=transport(),starting=game.addCar(startingRadio,{control:'none'});await settle();
  assert.equal(starting.car.initializing,true);time(6000);game.tick(.04,6000);await finish(starting,startingRadio);await moving.car.pumpPromise;
  assert.equal(game.halted,true);assert.match(game.pitReason,/Telemetry timeout/);
  assert.equal(moving.car.speed,0);assert.equal(starting.car.speed,0);assert.equal(starting.car.safetyReason,'Host stopped');
  assert.deepEqual(startingRadio.sent.slice(0,2),[[6,ID.SPEED,0,0,196,9,0],[6,ID.SPEED,0,0,196,9,0]]);
  assert.ok(speedRows(startingRadio).every(p=>p[2]===0 && p[3]===0));
});
