import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {buildTrack,LAYOUTS} from './sim.mjs';

const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
// Synthetic ordinary-straight reading with sufficient remaining geometry;
// this exercises the host gate and is not a new hardware acceptance trace.
const straight=Uint8Array.from('10 27 0f 24 00 00 b4 c1 2c 01 07 ff ff 00 00 2c 01'.split(' ').map(x=>parseInt(x,16)));
async function rig() {
  let now=0,notify;const timers=[],logs=[];
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,log:m=>logs.push(m),
    schedule:(fn,ms)=>{const timer={fn,ms,due:now+ms,cancelled:false};timers.push(timer);return timer;},unschedule:timer=>{timer.cancelled=true;}});
  const radio={sent:[],onNotify(fn){notify=fn;return()=>{};},async write(bytes){this.sent.push([...bytes]);},close(){},emit(bytes){notify(Uint8Array.from(bytes));}};
  const driver=game.addCar(radio,{control:'browser'});await driver.car.initialization;await driver.car.pumpPromise;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.stopAll();await driver.car.pumpPromise;
  radio.emit([3,0x1b,0,16]);radio.sent=[];logs.length=0;
  return {game,driver,radio,timers,logs,time:t=>{now=t;}};
}
const outcomes=logs=>logs.filter(m=>m.startsWith('Diagnostic deadline:'));

for(const mode of ['straight','no-lane-request','left-request','right-request'])test('diagnostic '+mode+' deadline reports the same outcome once whether timer or tick wins',async()=>{
  const messages=[];
  for(const winner of ['tick','timer']) {
    const {game,driver,radio,timers,logs,time}=await rig();
    const steering=mode!=='straight',requested=mode.endsWith('-request')&&mode!=='no-lane-request',direction=mode==='right-request'?-1:1;
    game.startDiagnostic(driver,{steering,direction});await driver.car.pumpPromise;
    if(requested){time(100);radio.emit(straight);await driver.car.pumpPromise;assert.equal(game.diagnostic.laneRequested,true);}
    const deadline=game.diagnostic.until;assert.equal(deadline,requested?850:steering?4000:500);
    time(deadline);
    if(winner==='timer')timers.at(-1).fn();else game.tick(.04,deadline);
    await driver.car.pumpPromise;
    assert.equal(game.diagnostic,null);assert.equal(driver.car.speed,0);assert.equal(game.halted,true);
    assert.equal(outcomes(logs).length,1,winner+' must report a diagnostic outcome');
    if(!steering)assert.match(outcomes(logs)[0],/straight pulse ended/);
    else if(!requested)assert.match(outcomes(logs)[0],/no lane request sent; no eligible ordinary-straight reading/);
    else assert.match(outcomes(logs)[0],new RegExp('one '+(direction===1?'left':'right')+' lane request attempted; maneuver completion unverified'));
    assert.match(outcomes(logs)[0],/STOP requested; confirm physical stop/);
    assert.ok(timers.every(t=>t.cancelled));
    const sent=radio.sent.length;for(const timer of timers)timer.fn();game.tick(.04,deadline+1);await driver.car.pumpPromise;
    assert.equal(outcomes(logs).length,1,'late callbacks cannot duplicate the outcome');assert.equal(radio.sent.length,sent,'late callbacks cannot add motion or repeat the completed stop');
    assert.equal(radio.sent.filter(p=>p[1]===0x24&&(p[2]||p[3])).length,1);
    assert.equal(radio.sent.filter(p=>p[1]===0x25).length,requested?1:0);
    messages.push(outcomes(logs)[0]);
  }
  assert.equal(messages[0],messages[1]);
});

test('cancelled diagnostic timers cannot report completion or stop a later diagnostic',async()=>{
  const {game,driver,radio,timers,logs,time}=await rig();game.startDiagnostic(driver,{steering:true});await driver.car.pumpPromise;
  const oldTimer=timers[0];game.stopAll();await driver.car.pumpPromise;oldTimer.fn();assert.equal(outcomes(logs).length,0);
  time(100);game.startDiagnostic(driver);await driver.car.pumpPromise;const current=game.diagnostic;
  oldTimer.fn();await driver.car.pumpPromise;assert.equal(game.diagnostic,current);assert.equal(driver.car.speed,150);assert.equal(outcomes(logs).length,0);
  time(600);game.tick(.04);await driver.car.pumpPromise;assert.equal(outcomes(logs).length,1);
  assert.match(outcomes(logs)[0],/straight pulse ended/);assert.equal(driver.car.speed,0);
});
