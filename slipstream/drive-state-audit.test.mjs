import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Car} from './car.mjs';
import {Game} from './game.mjs';
import {Pieces} from './track.mjs';
import {buildTrack,LAYOUTS} from './sim.mjs';
import {decode,ID} from './protocol.mjs';

const data=name=>JSON.parse(readFileSync(new URL('./data/'+name+'.json',import.meta.url)));
const fixture=name=>JSON.parse(readFileSync(new URL('./fixtures/'+name+'.json',import.meta.url)));
function captured(name,at){
  const event=fixture(name).events.find(e=>e[0]===at&&e[2]==='rx');assert.ok(event,'captured packet '+name+'@'+at);
  return Uint8Array.from(event[3].split(' ').map(s=>parseInt(s,16)));
}
const finite=captured('groundshock-sdk-scan-steering',275155); // 18/code15, offset-7.4; lateral comes from the current piece table
const unknown=captured('groundshock-sdk-scan-steering',274645); // 18/code14, offset654321
const repositioned=captured('groundshock-sdk-left-lane-accepted',1444700); // 39/code31, lateral-22.5, retained offset-22.5
const reference=captured('groundshock-sdk-reference-spin',32551); // 34/code12, offset654321
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const lateralIds=new Set([ID.CHANGE_LANE,ID.SET_OFFSET,ID.OFFSET_ADJUST,ID.TURN]);
const speed=packet=>new DataView(packet.buffer,packet.byteOffset,packet.byteLength).getInt16(2,true);

// Records entry into the transport separately from completion: a command whose
// transport call has not started is still suppressible by a synchronous STOP.
class RecordingTransport {
  initializationProfile='sdk';attempted=[];sent=[];
  onNotify(fn){this.notify=fn;return()=>{};}
  emit(packet){this.notify(Uint8Array.from(packet));}
  async write(packet){
    const copy=Uint8Array.from(packet);this.attempted.push(copy);
    await this.block?.(copy);this.sent.push(copy);
    if(copy[1]===ID.PING)queueMicrotask(()=>this.emit([1,ID.PING_REPLY]));
    if(copy[1]===ID.VERSION)queueMicrotask(()=>this.emit([3,ID.VERSION_REPLY,0x5a,0x2e]));
  }
  clear(){this.sent=[];this.attempted=[];}
  close(){}
}
async function rig(){
  let now=1000;const radio=new RecordingTransport(),pieces=new Pieces(data('pieces'));
  const car=new Car(radio,{pieces,clock:()=>now});await car.start();await car.pumpPromise;
  car.useTrack(buildTrack(pieces,LAYOUTS.Capsule));radio.clear();
  return {car,radio,time:t=>{now=t;}};
}

for(const boundary of ['STOP/recover','off-road','recovery-entry','optical-gap','map-replacement']){
  test('reused calibration cannot infer a new steering sign across '+boundary,async()=>{
    const r=await rig(),{car,radio,time}=r;car.setSpeed(300);await car.pumpPromise;
    radio.emit(finite);await car.pumpPromise;assert.equal(car.offsetSign,-1);assert.ok(car.lastPair);
    if(boundary==='STOP/recover'){car.safetyStop('Host stopped');await car.pumpPromise;car.recover();}
    if(boundary==='off-road')radio.emit([1,ID.DELOCALIZED]);
    if(boundary==='recovery-entry')radio.emit([1,ID.DELOC_RECOVERY_ENTERED]);
    if(boundary==='map-replacement')car.useTrack(buildTrack(car.pieces,LAYOUTS.Capsule));
    if(boundary!=='optical-gap')assert.equal(car.lastPair,null,'the old observation pair is invalid immediately at '+boundary);
    const nextAt=boundary==='optical-gap'?10000:1100;
    time(nextAt);car.setSpeed(300);radio.emit(repositioned);await car.pumpPromise;
    assert.equal(car.offsetSign,-1,'two different observation epochs are not a measured lateral move');
    assert.equal(car.signVotes,0,'no vote may come from the pre-boundary pair');
    const fresh=await rig();fresh.time(nextAt);fresh.radio.emit(repositioned);await fresh.car.pumpPromise;
    assert.equal(car.offsetSign,fresh.car.offsetSign,'reused and fresh cars agree on this first observation');
  });
}

test('a changed piece or reversed code frame cannot be used as a same-frame steering-sign measurement',async()=>{
  for(const reversal of [false,true]){
    const {car,radio,time}=await rig();radio.emit(finite);await car.pumpPromise;time(1100);
    const next=Uint8Array.from(repositioned);
    if(reversal){
      // Inject a direction change into a valid captured payload. This is a
      // software fault scenario, not a claim that this exact frame was recorded.
      next[3]=18;next[2]=10;next[10]|=0x40;
    }
    radio.emit(next);await car.pumpPromise;
    assert.equal(car.offsetSign,-1,reversal?'opposite road-code frame':'different piece geometry');
    assert.equal(car.signVotes,0);
  }
});

test('an enqueued but unwritten calibration is not an observed offset for subsequent sign learning',async()=>{
  const {car,radio,time}=await rig();let release;
  radio.block=p=>p[1]===ID.BATTERY?new Promise(resolve=>release=resolve):undefined;
  car.refreshBattery();await settle();assert.ok(release);
  try{
    radio.emit(unknown);
    assert.equal(radio.attempted.some(p=>p[1]===ID.SET_OFFSET),false,'calibration is still behind the stalled read');
    assert.equal(car.lastPair,null,'a queued correction must not fabricate measured offset evidence');
    // Same piece and direction, but another valid code while the reference has
    // still not reached firmware. Only code identity is fault-injected here.
    const next=Uint8Array.from(repositioned);next[3]=18;next[2]=20;time(1100);radio.emit(next);
    assert.equal(car.offsetSign,-1);
  }finally{car.stop();release();await car.pumpPromise;}
});

test('native unknown-offset range is never treated as a finite lane measurement or sign vote',async()=>{
  // Native mm-to-metres conversion maps raw values >500000 to its unknown
  // sentinel. Hardware carried654312 in0x2a; injecting it into0x27/0x41 tests
  // the shared scalar meaning without claiming this caused a recorded spin.
  const report=captured('groundshock-sdk-scan-steering',406684);
  new DataView(report.buffer).setFloat32(2,654312,true);new DataView(report.buffer).setFloat32(6,654312,true);
  assert.equal(decode(report)[0].offsetKnown,false);
  const {car,radio,time}=await rig(),first=Uint8Array.from(reference);
  new DataView(first.buffer).setFloat32(4,-13.5,true);radio.emit(first);await car.pumpPromise;
  const next=captured('groundshock-sdk-left-lane-accepted',1455784);new DataView(next.buffer).setFloat32(4,654312,true);
  time(1100);radio.emit(next);await car.pumpPromise;assert.equal(car.offsetSign,-1);assert.equal(car.signVotes,0);
});

for(const boundary of ['stop','safetyStop','close','stop-recover-restart']){
  test('positive speed dequeued before '+boundary+' cannot begin its transport write afterward',async()=>{
    const {car,radio}=await rig();car.setSpeed(300);
    assert.equal(radio.attempted.length,0,'transport has not yet been entered');
    let closing;
    if(boundary==='stop')car.stop();
    if(boundary==='safetyStop')car.safetyStop('Host stopped');
    if(boundary==='close')closing=car.close();
    if(boundary==='stop-recover-restart'){car.safetyStop('Host stopped');car.recover();car.setSpeed(150);}
    await closing;await car.pumpPromise;
    const requested=radio.attempted.filter(p=>p[1]===ID.SPEED).map(speed);
    assert.equal(requested.includes(300),false,'old positive command must not enter the radio after stop');
    assert.equal(requested.at(-1),boundary==='stop-recover-restart'?150:0);
  });
}

test('STOP suppresses a dequeued SDK steering preamble, optical correction or turn before radio entry',async()=>{
  for(const command of ['steering','calibration','turn']){
    const {car,radio}=await rig();
    if(command==='steering'){
      // The physical steering gate needs a current moving optical reference;
      // this test must reach the queued command, not merely reject its input.
      car.setSpeed(300);await car.pumpPromise;radio.emit(repositioned);await car.pumpPromise;radio.clear();
      car.steerTo(22.5);assert.equal(car.activeWrite?.[1],ID.SET_OFFSET);
    }
    if(command==='calibration')radio.emit(unknown);
    if(command==='turn')car.uturn();
    assert.equal(radio.attempted.length,0);car.safetyStop('Host stopped');await car.pumpPromise;
    assert.equal(radio.attempted.some(p=>lateralIds.has(p[1])),false,command);
    assert.equal(radio.attempted.at(-1)[1],ID.SPEED);assert.equal(speed(radio.attempted.at(-1)),0);
  }
});

test('STOP remains next after an already-entered write and clears every queued lane command',async()=>{
  const {car,radio}=await rig();let release;
  radio.block=p=>p[1]===ID.SPEED&&speed(p)>0?new Promise(resolve=>release=resolve):undefined;
  car.setSpeed(300);await settle();assert.ok(release);assert.equal(radio.attempted.length,1);
  radio.emit(repositioned);car.steerTo(22.5);
  assert.ok([...car.pending.values()].some(p=>p[1]===ID.CHANGE_LANE),'fresh optical input admitted a real queued lane command');
  car.safetyStop('Host stopped');release();await car.pumpPromise;
  assert.deepEqual(radio.attempted.map(p=>[p[1],p[1]===ID.SPEED?speed(p):null]),[[ID.SPEED,300],[ID.SPEED,0]]);
});

for(const stop of ['safety-stop-and-recover','zero-speed']){
  test('an undelivered '+stop+' cannot be overwritten by fresh positive speed behind an in-flight command',async()=>{
    const {car,radio}=await rig();let release;
    radio.block=p=>p[1]===ID.SPEED&&speed(p)===300?new Promise(resolve=>release=resolve):undefined;
    car.setSpeed(300);await settle();assert.ok(release,'the first movement command entered the radio');
    if(stop==='safety-stop-and-recover'){car.safetyStop('Host stopped');car.recover();}
    else car.setSpeed(0);
    car.setSpeed(150);release();await car.pumpPromise;
    assert.deepEqual(radio.attempted.filter(p=>p[1]===ID.SPEED).map(speed),[300,0,150],
      'the already-entered write finishes, STOP reaches firmware, then fresh input can resume');
  });
}

test('captured start code is readable in scan and mapped acquisition while reference steering stays locked',async()=>{
  for(const mode of ['scan','reference']){
    let now=1000;const radio=new RecordingTransport();
    const game=new Game({pieces:data('pieces'),weapons:data('weapons'),vehicles:data('vehicles'),clock:()=>now,
      schedule:()=>({}),unschedule(){}});
    const driver=game.addCar(radio,{control:'bot'});await driver.car.initialization;await driver.car.pumpPromise;
    radio.emit([3,ID.BATTERY_REPLY,0,16]);radio.emit([5,ID.STATUS,1,0,0,1]);game.topSpeed=300;game.scanSpeed=300;
    if(mode==='scan')game.startScan(driver);
    else {game.useTrack(buildTrack(game.pieces,LAYOUTS.Capsule));game.startLaneCancellationComparison(driver);game.tick(.04,now);}
    await driver.car.pumpPromise;radio.clear();now=1100;radio.emit(reference);await driver.car.pumpPromise;
    assert.equal(driver.car.telemetry.lastPositionAt,1100);assert.equal(driver.car.lateral,13.5);
    if(mode==='reference'){
      assert.equal(driver.car.steeringLocked,true);assert.equal(game.laneCancellationComparison.reference.pieceId,34);
      assert.equal(radio.attempted.some(p=>lateralIds.has(p[1])),false,'reference acquisition never calibrates or steers from its first code');
    }
    game.stopAll();await driver.car.pumpPromise;
  }
});
