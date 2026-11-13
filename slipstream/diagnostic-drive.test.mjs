import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
const data=n=>JSON.parse(readFileSync(new URL('./data/'+n+'.json',import.meta.url)));
const settle=()=>new Promise(r=>setImmediate(r));
async function rig(){
 let now=0;const timers=[];
 const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,schedule:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},unschedule:t=>{t.cancelled=true;}});
 let notify;const radio={sent:[],onNotify(fn){notify=fn;return()=>{};},async write(b){await radio.block?.();radio.sent.push([...b]);},close(){},emit(b){notify(Uint8Array.from(b));}};
 const driver=game.addCar(radio,{control:'browser'});await settle();game.stopAll();await settle();radio.emit([3,0x1b,0,16]);
 return {game,driver,radio,timers,time:t=>now=t};
}
const speeds=r=>r.sent.filter(b=>b[1]===0x24).map(b=>b[2]+256*b[3]);
test('diagnostic deadline stops without animation ticks and never resumes stale inputs',async()=>{
 const {game,driver,radio,timers}=await rig();game.startDiagnostic(driver);await settle();
 assert.equal(driver.car.speed,150);assert.equal(game.halted,true);assert.equal(timers[0].ms,500);
 driver.input={throttle:1,lane:45,attack:true};game.tick(.1,100);assert.equal(driver.car.speed,150);
 timers[0].fn();await settle();assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);
 game.tick(.1,1000);await settle();assert.deepEqual(speeds(radio).slice(-2),[150,0]);assert.equal(driver.armed,false);
 assert.equal(radio.sent.some(b=>[0x25,0x2c].includes(b[1])),false);
});
test('manual STOP and late deadline cannot restart diagnostic or a subsequent session',async()=>{
 const {game,driver,radio,timers}=await rig();game.startDiagnostic(driver);await settle();game.stopAll();await settle();
 const count=radio.sent.length;timers[0].fn();await settle();assert.equal(radio.sent.length,count);assert.equal(driver.car.speed,0);
});
test('deadline discards pending motion behind a delayed write',async()=>{
 const {game,driver,radio,timers}=await rig();let release;let first=true;
 radio.block=()=>{if(first){first=false;return new Promise(r=>release=r);}};
 game.startDiagnostic(driver);await settle();timers[0].fn();release();await settle();
 assert.equal(speeds(radio).includes(150),false);assert.equal(speeds(radio).at(-1),0);
});
test('diagnostic refuses stale battery and recent charger/low-battery reports',async()=>{
 const {game,driver,radio,time}=await rig();time(30001);assert.throws(()=>game.startDiagnostic(driver),/Refresh/);
 radio.emit([3,0x1b,0,16]);radio.emit([5,0x3f,0,1,0,0]);assert.throws(()=>game.startDiagnostic(driver),/charging/);
 radio.emit([5,0x3f,0,0,1,0]);assert.throws(()=>game.startDiagnostic(driver),/low battery/);
 assert.equal(driver.car.speed,0);
});
test('collision during diagnostic stops and latches shared pit',async()=>{
 const {game,driver,radio}=await rig();game.startDiagnostic(driver);await settle();radio.emit([3,0x4d,1,0]);await settle();
 assert.match(game.pitReason,/Collision during diagnostic/);assert.equal(driver.car.speed,0);assert.equal(game.diagnostic,null);
 assert.throws(()=>game.startDiagnostic(driver),/clear the pit/);
});
test('driver reassignment cancels diagnostic and cannot restart from its timer',async()=>{
 const {game,driver,timers}=await rig();game.startDiagnostic(driver);await settle();game.setControl(driver,'bot');timers[0].fn();game.tick(.1,1000);await settle();assert.equal(driver.car.speed,0);assert.equal(driver.cpuArmed,false);
});
test('diagnostics preserve independent battery and status sample ages',async()=>{
 const {driver,radio,time}=await rig();time(100);radio.emit([5,0x3f,0,0,1,0]);time(1000);
 const d=driver.car.diagnostics();assert.equal(d.batteryAgeMs,1000);assert.equal(d.statusAgeMs,900);assert.equal(d.status.lowBattery,true);assert.equal(d.positionAgeMs,null);
 d.status.lowBattery=false;assert.equal(driver.car.status.lowBattery,true);
});
