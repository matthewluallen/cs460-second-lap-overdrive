import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {encode,hex} from './protocol.mjs';
const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
async function setup() {
 let now=0,notify;
 const radio={initializationProfile:'fast-furious',sent:[],onNotify(fn){notify=fn;return()=>{};},close(){},
  emit(b){notify(Uint8Array.from(b));},async write(b){
   this.sent.push([...b]);
   if(b[1]===0x16)queueMicrotask(()=>this.emit([1,0x17]));
   if(b[1]===0x18)queueMicrotask(()=>this.emit([3,0x19,0x5a,0x2e]));
   if(b[1]===0x49)queueMicrotask(()=>this.emit([3,0x23,255,255]));
  }};
 const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now});
 const driver=game.addCar(radio);await driver.car.initialization;await driver.car.pumpPromise;
 radio.sent=[];
 return {game,driver,radio,advance(ms){now+=ms;game.tick(.04);}};
}
const limits=r=>r.sent.filter(b=>b[1]===0x37).map(b=>b[2]+256*b[3]);
const position=[16,0x27,0,34,0,0,0,0,0x2c,1,0,0,0,0,0,0x2c,1];
test('scan allowance golden wire packet is bounded to 300 mm/s',()=>{
 assert.equal(hex(encode.maxDelocalizedSpeed(300)),'03 37 2c 01');
 assert.equal(hex(encode.maxDelocalizedSpeed(999)),'03 37 2c 01');
 assert.equal(hex(encode.maxDelocalizedSpeed(0)),'03 37 00 00');
});
test('only explicit F&F scanning enables allowance, before motion; first position restores zero',async()=>{
 const {game,driver,radio}=await setup();
 driver.car.setSpeed(100);await driver.car.pumpPromise;assert.deepEqual(limits(radio),[]);
 game.startScan(driver);await driver.car.pumpPromise;
 assert.deepEqual(limits(radio),[300]);
 assert.equal(driver.car.speed,300);
 const enable=radio.sent.findIndex(b=>b[1]===0x37&&b[2]===0x2c);
 const move=radio.sent.findIndex((b,i)=>i>enable&&b[1]===0x24&&b[2]===0x2c&&b[3]===1);
 assert.ok(move>enable);
 radio.emit([7,0x29,0,0x10,0xbf,0x1f,0x49,0]);await driver.car.pumpPromise;
 assert.deepEqual(limits(radio),[300],'unsupported transition must not claim first position');
 radio.emit(position);await driver.car.pumpPromise;
 assert.deepEqual(limits(radio),[300,0]);assert.equal(driver.car.scanDelocalizationAllowance,false);
});
for(const action of ['cancel','halt','off-track','watchdog','close','zero-speed','pit']) {
 test('scan allowance restores zero on '+action,async()=>{
  const {game,driver,radio,advance}=await setup();game.startScan(driver);await driver.car.pumpPromise;
  if(action==='cancel')game.cancelScan();
  if(action==='halt')game.stopAll();
  if(action==='off-track')radio.emit([1,0x2b]);
  if(action==='watchdog')advance(5001);
  if(action==='close')await driver.car.close();
  if(action==='zero-speed')driver.car.setSpeed(0);
  if(action==='pit')game.requestPit(driver,'Other car needs recovery');
  await driver.car.pumpPromise;
  assert.equal(limits(radio).at(-1),0);assert.equal(driver.car.scanDelocalizationAllowance,false);
  assert.equal(driver.car.speed,0);
 });
}
test('STOP during an in-flight allowance write cancels queued scan movement and then restores zero',async()=>{
 const {game,driver,radio}=await setup();let release;
 const write=radio.write.bind(radio);
 radio.write=async b=>{if(b[1]===0x37&&b[2]===0x2c)await new Promise(resolve=>release=resolve);await write(b);};
 game.startScan(driver);
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 game.stopAll();release();await driver.car.pumpPromise;
 assert.deepEqual(limits(radio),[300,0]);
 assert.ok(radio.sent.filter(b=>b[1]===0x24).every(b=>b[2]===0&&b[3]===0));
});
test('settled connection fault attempts STOP and restores zero before closing',async()=>{
 const {game,driver,radio}=await setup();game.startScan(driver);await driver.car.pumpPromise;
 const write=radio.write.bind(radio);let fail=true;
 radio.write=async b=>{if(fail){fail=false;throw new Error('radio error');}await write(b);};
 driver.car.refreshBattery();await driver.car.pumpPromise;
 assert.equal(limits(radio).at(-1),0);assert.equal(driver.car.faulted,true);
 assert.equal(driver.car.scanDelocalizationAllowance,false);assert.ok(game.pitReason);
});
test('lost link does not pretend restoration succeeded or restart motion',async()=>{
 const {game,driver,radio}=await setup();game.startScan(driver);await driver.car.pumpPromise;
 const before=radio.sent.length;driver.car.connectionLost();await driver.car.pumpPromise;
 assert.equal(radio.sent.length,before);assert.equal(driver.car.connected,false);
 assert.equal(driver.car.scanDelocalizationAllowance,false);assert.ok(game.pitReason);
 assert.equal(driver.car.speed,0);assert.throws(()=>game.startScan(driver),/initialization/);
});
test('disconnect still restores zero when first-position restoration was queued behind a write',async()=>{
 const {game,driver,radio}=await setup();game.startScan(driver);await driver.car.pumpPromise;
 const write=radio.write.bind(radio);let release;
 radio.write=async b=>{if(b[1]===0x1a)await new Promise(resolve=>release=resolve);await write(b);};
 driver.car.refreshBattery();while(!release)await new Promise(resolve=>setImmediate(resolve));
 radio.emit(position);const closing=driver.car.close();release();await closing;
 assert.deepEqual(limits(radio),[300,0]);
 assert.equal(radio.sent.at(-1)[1],0x0d);
});
