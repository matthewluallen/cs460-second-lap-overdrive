import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {buildTrack,LAYOUTS} from './sim.mjs';

const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
// Actual eligible Guardian position from the 20:25 recording: piece39/code20,
// reverse, measured−13.5 mm, 440.16 mm remaining. Replayed timing is synthetic.
const eligible=Uint8Array.from('10 27 14 27 ee 7c 82 42 32 01 47 ff 81 46 00 2c 01'.split(' ').map(x=>parseInt(x,16)));
const lanes=radio=>radio.sent.filter(p=>p[1]===0x25);
async function rig(step=.1) {
  let now=0,reads=0,notify;const timers=[];
  const clock=()=>now+reads++*step,time=t=>{now=t;reads=0;};
  const radio={initializationProfile:'sdk',sent:[],onNotify(fn){notify=fn;return()=>{};},close(){},
    emit(bytes){notify(Uint8Array.from(bytes));},async write(bytes){
      await radio.block?.(bytes);this.sent.push([...bytes]);
      if(bytes[1]===0x16)queueMicrotask(()=>this.emit([1,0x17]));
      if(bytes[1]===0x18)queueMicrotask(()=>this.emit([3,0x19,0x5a,0x2e]));
    }};
  const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock,
    schedule:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},unschedule:t=>{t.cancelled=true;}});
  const driver=game.addCar(radio,{model:12,name:'Guardian'});await driver.car.initialization;await driver.car.pumpPromise;
  game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.stopAll();await driver.car.pumpPromise;
  radio.emit([3,0x1b,0,16]);radio.emit([5,0x3f,1,0,0,1]);radio.sent=[];
  game.startDiagnostic(driver,{steering:true,direction:1});await driver.car.pumpPromise;
  return {game,driver,radio,timers,time,clock,intercept(fn){
    const listeners=[...driver.car.listeners];driver.car.listeners.clear();
    driver.car.on((m,c,at)=>{if(m.type==='position')fn(m,c,at);for(const listener of listeners)listener(m,c,at);});
  }};
}

for(const step of [0,.1])test('eligible captured steering observation reaches Game with clock advancing '+step+' ms per read',async()=>{
  const {game,driver,radio,time,clock}=await rig(step);let receivedAt;
  driver.car.on((m,_car,at)=>{if(m.type==='position')receivedAt=at;});
  time(871);radio.emit(eligible);await driver.car.pumpPromise;
  try {
    assert.equal(lanes(radio).length,1,'later host clock sampling must not discard this eligible observation');
    assert.equal(game.diagnostic.laneRequested,true);
    assert.equal(new DataView(Uint8Array.from(lanes(radio)[0]).buffer).getFloat32(6,true),-9);
    assert.equal(receivedAt,driver.car.lateralEstimate.at,'event and estimate retain the exact receive timestamp');
    if(step)assert.ok(clock()>receivedAt,'reproduction uses a genuinely advancing clock');
    assert.equal(driver.car.speed,300);
  }finally{game.stopAll();await driver.car.pumpPromise;}
});

for(const fault of ['mismatched-observation','future','stale','previous-drive','deadline'])test('diagnostic refuses '+fault+' evidence without widening the observation match',async()=>{
  const {game,driver,radio,time,intercept}=await rig();
  intercept((_m,car,at)=>{
    if(fault==='mismatched-observation')car.lateralEstimate.at=at-.1;
    if(fault==='future')time(at-1);
    if(fault==='stale')time(at+2001);
    if(fault==='previous-drive')game.diagnostic.started=at+.05;
    if(fault==='deadline')time(game.diagnostic.until);
  });
  time(871);radio.emit(eligible);await driver.car.pumpPromise;
  assert.equal(lanes(radio).length,0);assert.equal(game.diagnostic?.laneRequested??false,false);
  game.stopAll();await driver.car.pumpPromise;
});

test('a packed off-track message after eligible steering invalidates queued lane commands before transport',async()=>{
  const {game,driver,radio,time}=await rig();let release;
  radio.block=async bytes=>{if(bytes[1]===0x1a)await new Promise(resolve=>{release=resolve;});};
  driver.car.refreshBattery();while(!release)await new Promise(resolve=>setImmediate(resolve));
  time(871);radio.emit(Uint8Array.from([...eligible,1,0x2b]));
  release();await driver.car.pumpPromise;
  assert.match(game.pitReason,/left the track/);assert.equal(driver.car.speed,0);assert.equal(lanes(radio).length,0);
  assert.equal(radio.sent.filter(p=>p[1]===0x24&&(p[2]||p[3])).length,1,'only the original diagnostic forward request entered transport');
});
