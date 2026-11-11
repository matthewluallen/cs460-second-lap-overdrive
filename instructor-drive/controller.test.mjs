import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveController} from './controller.mjs';

const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
class Clock {
  now=0;next=0;timers=new Map();
  set=(fn,ms)=>{const id=++this.next;this.timers.set(id,{at:this.now+ms,fn});return id;};
  clear=id=>this.timers.delete(id);
  async advance(ms){
    const target=this.now+ms;
    for(;;){
      await flush();
      const entry=[...this.timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(!entry)break;
      const [id,item]=entry;this.now=item.at;this.timers.delete(id);item.fn();
    }
    this.now=target;await flush();
  }
}
class Radio {
  mode='SIMULATION';connected=false;writes=[];opens=0;closed=0;identifications=0;
  firmware=11866;battery=4000;silent=new Set();intercept=null;
  async open(){this.opens++;this.connected=true;return {browserId:'one-selected-browser-id',name:'Overdrive'};}
  async identify(){this.identifications++;}
  close(){this.closed++;this.connected=false;}
  async write(bytes){
    this.writes.push([...bytes]);
    if(this.intercept){const result=this.intercept(bytes);if(result!==undefined)return result;}
    const id=bytes[1];if(this.silent.has(id))return;
    if(id===0x18)this.receive(Uint8Array.of(3,0x19,this.firmware&255,this.firmware>>8));
    if(id===0x1a)this.receive(Uint8Array.of(3,0x1b,this.battery&255,this.battery>>8));
    if(id===0x16)this.receive(Uint8Array.of(1,0x17));
  }
}
function rig(options={}){
  const clock=new Clock(),radio=new Radio(),events=[],states=[];
  const drive=new DriveController(radio,{enabled:true,note:(...row)=>{events.push(row);return true;},
    changed:c=>states.push(c.state),setTimer:clock.set,clearTimer:clock.clear,...options});
  return {clock,radio,drive,events,states};
}
const motors=radio=>radio.writes.filter(x=>x[1]===0x24);
const moving=radio=>motors(radio).filter(x=>x[2]!==0||x[3]!==0);
async function confirm(r){
  await r.drive.select();await r.drive.identify({safe:true});
  r.drive.confirm({label:'CS460 CAR 07',typedLabel:'CS460 CAR 07',browserId:'one-selected-browser-id',observed:true,safe:true});
}
async function armed(r){await confirm(r);await r.drive.arm();assert.equal(r.drive.state,'ARMED');}

test('only strict instructor opt-in allows selection; default path cannot touch radio',async()=>{
  for(const enabled of [false,undefined,'true',1]){
    const r=rig({enabled});await assert.rejects(r.drive.select(),/opt-in/);
    assert.equal(r.radio.opens,0);assert.equal(r.radio.writes.length,0);
  }
});

test('selection and light trial do not start motors and reject a second selection',async()=>{
  const r=rig();await r.drive.select();assert.equal(r.drive.state,'SELECTED');
  await assert.rejects(r.drive.select(),/Disconnect/);assert.equal(r.radio.opens,1);
  await assert.rejects(r.drive.identify(),/wheels clear/);
  await r.drive.identify({safe:true});assert.equal(r.radio.identifications,1);
  assert.equal(motors(r.radio).length,0);assert.equal(r.drive.state,'SELECTED');
});

test('confirmation requires light trial, exact physical label, selected ID and all acknowledgements',async()=>{
  const r=rig();await r.drive.select();
  const valid={label:'CAR 07',typedLabel:'CAR 07',browserId:'one-selected-browser-id',observed:true,safe:true};
  assert.throws(()=>r.drive.confirm(valid),/light trial/);
  await r.drive.identify({safe:true});
  for(const patch of [{typedLabel:'car 07'},{browserId:'other-car'},{observed:false},{safe:false},{label:''},{label:' '.repeat(3),typedLabel:' '.repeat(3)},{label:'x'.repeat(81),typedLabel:'x'.repeat(81)}]){
    assert.throws(()=>r.drive.confirm({...valid,...patch}),/Exact physical/);assert.equal(r.drive.state,'SELECTED');
  }
  await assert.rejects(r.drive.arm(),/physical car/);
  r.drive.confirm(valid);assert.equal(r.drive.state,'CONFIRMED');assert.ok(Object.isFrozen(r.drive.identity));
  assert.equal(moving(r.radio).length,0);
});

test('arming verifies version/battery/ping then SDK then zero; it never auto-starts',async()=>{
  const r=rig();await armed(r);
  assert.deepEqual(r.radio.writes.map(x=>x[1]),[0x18,0x1a,0x16,0x90,0x24]);
  assert.deepEqual(motors(r.radio),[[6,0x24,0,0,0xe8,3,1]]);
  await r.clock.advance(5000);assert.equal(r.drive.state,'CONFIRMED');
  assert.equal(moving(r.radio).length,0);assert.match(r.drive.stopResult,/physical stop unverified/);
});

test('unknown and v4 firmware cannot enable SDK or nonzero speed; no compatibility fallback',async()=>{
  for(const firmware of [0,12385,12386,12411,12412,3387,65535]){
    const r=rig();r.radio.firmware=firmware;await confirm(r);
    await assert.rejects(r.drive.arm(),/Unreviewed firmware/);
    assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.writes.some(x=>x[1]===0x90),false);
    assert.equal(motors(r.radio).length,0);assert.equal(r.radio.writes.some(x=>x.length===8),false);
  }
});

test('battery outside provisional gate cannot enable SDK or motion',async()=>{
  for(const battery of [0,3499,4501,65535]){
    const r=rig();r.radio.battery=battery;await confirm(r);
    await assert.rejects(r.drive.arm(),/Battery outside/);
    assert.equal(r.drive.state,'DISCONNECTED');assert.equal(moving(r.radio).length,0);
    assert.equal(r.radio.writes.some(x=>x[1]===0x90),false);
  }
});

test('unsafe speed inputs and premature requests never send a nonzero command',async()=>{
  const r=rig();await assert.rejects(r.drive.pulse(100),/Arm this/);await armed(r);
  const before=r.radio.writes.length;
  for(const speed of [-1,201,1000,NaN,Infinity,1.1,'100',null])await assert.rejects(r.drive.pulse(speed),RangeError);
  assert.equal(r.radio.writes.length,before);assert.equal(r.drive.state,'ARMED');
  assert.equal(moving(r.radio).length,0);
});

test('one explicit pulse checks ping, sends bounded speed and stops at 750 ms with no repeat',async()=>{
  const r=rig();await armed(r);await r.drive.pulse(100);
  assert.equal(r.drive.state,'MOVING');assert.deepEqual(moving(r.radio),[[6,0x24,100,0,0xe8,3,1]]);
  await assert.rejects(r.drive.pulse(100),/Arm this/);
  await r.clock.advance(749);assert.equal(r.drive.state,'MOVING');
  await r.clock.advance(1);assert.equal(r.drive.state,'CONFIRMED');
  assert.deepEqual(r.radio.writes.at(-1),[6,0x24,0,0,0xe8,3,1]);
  await r.clock.advance(10000);assert.equal(moving(r.radio).length,1);
  await assert.rejects(r.drive.pulse(100),/Arm this/);
});

test('zero speed is always a STOP request, and concurrent STOP callers do not duplicate motor writes',async()=>{
  const r=rig();await armed(r);await r.drive.pulse(200);
  const before=motors(r.radio).length;
  await Promise.all([r.drive.pulse(0),r.drive.stop('Emergency STOP'),r.drive.stop('Repeated STOP')]);
  assert.equal(r.drive.state,'CONFIRMED');assert.equal(motors(r.radio).length,before+1);
  await r.clock.advance(10000);assert.equal(moving(r.radio).length,1);
});

test('STOP during arm reply wait invalidates setup and prevents a late reply from arming',async()=>{
  const r=rig();await confirm(r);r.radio.silent.add(0x18);
  const arm=r.drive.arm();const rejection=assert.rejects(arm,/STOP|cancelled/);await flush();
  await r.drive.stop('Emergency STOP');await rejection;
  r.radio.receive(Uint8Array.of(3,0x19,0x5a,0x2e));await flush();
  assert.notEqual(r.drive.state,'ARMED');assert.equal(r.radio.writes.some(x=>x[1]===0x90),false);
  assert.equal(moving(r.radio).length,0);
});

test('STOP during pre-pulse ping wait forbids nonzero command even after a delayed ping',async()=>{
  const r=rig();await armed(r);r.radio.silent.add(0x16);
  const pulse=r.drive.pulse(100);const rejection=assert.rejects(pulse,/STOP|cancelled/);await flush();
  await r.drive.stop('Emergency STOP');await rejection;
  r.radio.receive(Uint8Array.of(1,0x17));await flush();assert.equal(moving(r.radio).length,0);
});

test('late speed write completes before queued STOP, and stale completion cannot restore motion state',async()=>{
  const r=rig();await armed(r);const held=deferred();
  r.radio.intercept=bytes=>bytes[1]===0x24&&bytes[2]===100?held.promise:undefined;
  const pulse=r.drive.pulse(100);const rejection=assert.rejects(pulse,/cancelled/);await flush();
  assert.equal(r.drive.state,'MOVING');const stop=r.drive.stop('Emergency STOP');await flush();
  assert.equal(r.drive.state,'STOPPING');assert.equal(motors(r.radio).length,2);
  held.resolve();await stop;await rejection;
  assert.equal(r.drive.state,'CONFIRMED');assert.deepEqual(motors(r.radio).map(x=>x[2]),[0,100,0]);
  await r.clock.advance(10000);assert.equal(moving(r.radio).length,1);
});

test('hung nonzero write times out, attempts bounded STOP, closes connection, and cannot resume later',async()=>{
  const r=rig();await armed(r);const held=deferred();
  r.radio.intercept=bytes=>bytes[1]===0x24&&bytes[2]===100?held.promise:undefined;
  const pulse=r.drive.pulse(100);const rejection=assert.rejects(pulse,/Write timed out/);await flush();
  await r.clock.advance(1200);await rejection;
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.connected,false);
  const count=r.radio.writes.length;held.resolve();await flush();
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.writes.length,count);
  assert.match(r.drive.stopResult,/unavailable\/unverified/);
});

test('missing version or pre-pulse ping replies time out and never produce nonzero motion',async()=>{
  const setup=rig();await confirm(setup);setup.radio.silent.add(0x18);
  const arm=setup.drive.arm();const armRejected=assert.rejects(arm,/reply timed out/);await flush();
  await setup.clock.advance(1000);await armRejected;
  assert.equal(setup.drive.state,'DISCONNECTED');assert.equal(moving(setup.radio).length,0);
  const r=rig();await armed(r);r.radio.silent.add(0x16);
  const pulse=r.drive.pulse(100);const pulseRejected=assert.rejects(pulse,/reply timed out/);await flush();
  await r.clock.advance(1000);await pulseRejected;
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(moving(r.radio).length,0);
});

test('malformed notification during motion stops, disconnects, and records uncertainty',async()=>{
  const r=rig();await armed(r);await r.drive.pulse(100);
  r.radio.receive(Uint8Array.of(3,0x1b,1));await flush();
  assert.equal(r.drive.state,'DISCONNECTED');assert.deepEqual(r.radio.writes.at(-1),[6,0x24,0,0,0xe8,3,1]);
  assert.equal(moving(r.radio).length,1);assert.match(r.drive.stopResult,/physical stop unverified/);
});

test('disconnect cancels motion and identity without reconnect, claiming no delivered physical STOP',async()=>{
  const r=rig();await armed(r);await r.drive.pulse(100);const count=r.radio.writes.length;
  r.radio.connected=false;r.radio.lost();await flush();
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.drive.identity,null);assert.equal(r.drive.label,null);
  assert.equal(r.radio.writes.length,count);assert.match(r.drive.stopResult,/unavailable\/unverified/);
  await r.clock.advance(10000);assert.equal(r.radio.opens,1);assert.equal(moving(r.radio).length,1);
  await assert.rejects(r.drive.arm(),/physical car/);
});

test('a rejected drive write attempts speed-zero and disconnects',async()=>{
  const r=rig();await armed(r);
  r.radio.intercept=bytes=>bytes[1]===0x24&&bytes[2]===100?Promise.reject(new Error('radio failure')):undefined;
  await assert.rejects(r.drive.pulse(100),/radio failure/);
  assert.equal(r.drive.state,'DISCONNECTED');assert.deepEqual(motors(r.radio).map(x=>x[2]),[0,100,0]);
});

test('trace capacity refusal blocks motion but cannot veto an emergency zero-speed write',async()=>{
  const r=rig();await armed(r);r.drive.note=()=>false;
  await assert.rejects(r.drive.pulse(100),/Evidence capture full/);
  assert.equal(moving(r.radio).length,0);assert.deepEqual(motors(r.radio).map(x=>x[2]),[0,0]);
  assert.equal(r.drive.state,'DISCONNECTED');
});

test('a throwing evidence sink cannot veto emergency STOP',async()=>{
  const r=rig();await armed(r);await r.drive.pulse(100);
  r.drive.note=()=>{throw new Error('storage failure');};await r.drive.stop('Emergency STOP');
  assert.deepEqual(motors(r.radio).map(x=>x[2]),[0,100,0]);
});

test('STOP and disconnect escalation share one pending STOP without leaving the car armed',async()=>{
  const r=rig();await armed(r);const held=deferred();
  r.radio.intercept=bytes=>bytes[1]===0x24?held.promise:undefined;
  const first=r.drive.stop('Emergency STOP');await flush();
  const second=r.drive.stop('Close browser path',true);held.resolve();await Promise.all([first,second]);
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.connected,false);assert.equal(r.drive.identity,null);
});

test('cancelled late device selection closes the stale connection and cannot select a second car',async()=>{
  const r=rig();const held=deferred();
  r.radio.open=async()=>{r.radio.opens++;await held.promise;r.radio.connected=true;return {browserId:'late-device'};};
  const select=r.drive.select();const rejection=assert.rejects(select,/cancelled/);await flush();
  await r.drive.stop('Picker cancelled',true);held.resolve();await rejection;
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.connected,false);assert.equal(moving(r.radio).length,0);
});

test('safety and observed acknowledgements require true booleans, never truthy text',async()=>{
  const r=rig();await r.drive.select();
  for(const safe of ['false','true',1,{}])await assert.rejects(r.drive.identify({safe}),/wheels clear/);
  await r.drive.identify({safe:true});
  const valid={label:'CAR 07',typedLabel:'CAR 07',browserId:'one-selected-browser-id',observed:true,safe:true};
  for(const field of ['observed','safe'])for(const value of ['false','true',1,{}]){
    assert.throws(()=>r.drive.confirm({...valid,[field]:value}),/Exact physical/);
  }
  assert.equal(r.drive.state,'SELECTED');assert.equal(motors(r.radio).length,0);
});

test('selection without a browser identity cannot reach confirmation',async()=>{
  const r=rig();r.radio.open=async()=>{r.radio.connected=true;return {name:'Ambiguous car'};};
  await assert.rejects(r.drive.select(),/no browser ID/);
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.connected,false);assert.equal(r.drive.identity,null);
});

test('identification timeout closes the link without enabling motion',async()=>{
  const r=rig();await r.drive.select();const held=deferred();r.radio.identify=()=>held.promise;
  const trial=r.drive.identify({safe:true});const rejected=assert.rejects(trial,/identification timed out/);await flush();
  await r.clock.advance(11000);await rejected;
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.connected,false);
  held.resolve();await flush();assert.equal(r.drive.signalled,false);assert.equal(motors(r.radio).length,0);
});

test('STOP while SDK initialization is outstanding blocks the rest of arm and queues zero after it',async()=>{
  const r=rig();await confirm(r);const held=deferred();r.radio.intercept=bytes=>bytes[1]===0x90?held.promise:undefined;
  const arm=r.drive.arm();const rejected=assert.rejects(arm,/cancelled/);await flush();
  assert.equal(r.drive.state,'ARMING');assert.equal(r.radio.writes.at(-1)[1],0x90);
  const stop=r.drive.stop('Emergency STOP');await flush();held.resolve();await stop;await rejected;
  assert.equal(r.drive.state,'CONFIRMED');assert.deepEqual(motors(r.radio),[[6,0x24,0,0,0xe8,3,1]]);
  assert.equal(moving(r.radio).length,0);
});

test('evidence exhaustion after nonzero dispatch still sends emergency zero and disconnects',async()=>{
  const r=rig();await armed(r);
  r.drive.note=(_mode,message)=>!(moving(r.radio).length&&message==='Write completed; physical result unverified');
  await assert.rejects(r.drive.pulse(100),/Evidence capture full/);
  assert.deepEqual(motors(r.radio).map(x=>x[2]),[0,100,0]);assert.equal(r.drive.state,'DISCONNECTED');
});

test('failed STOP write disconnects and reports unknown physical outcome',async()=>{
  const r=rig();await armed(r);await r.drive.pulse(100);
  r.radio.intercept=bytes=>bytes[1]===0x24?Promise.reject(new Error('stop write failed')):undefined;
  await r.drive.stop('Emergency STOP');
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.connected,false);
  assert.match(r.drive.stopResult,/unavailable\/unverified/);assert.equal(moving(r.radio).length,1);
});

test('both explicitly reviewed classic firmware replies arm, with battery boundary values',async()=>{
  for(const [firmware,battery] of [[9511,3500],[11866,4500]]){
    const r=rig();r.radio.firmware=firmware;r.radio.battery=battery;await armed(r);
    assert.equal(r.drive.firmware,firmware);assert.equal(r.drive.battery,battery);
    assert.equal(moving(r.radio).length,0);await r.drive.stop('End fixture',true);
  }
});


test('repeated disconnect STOP never erases earlier motor-command attempts from status',async()=>{
  const r=rig();await armed(r);await r.drive.pulse(100);await r.clock.advance(750);
  await r.drive.stop('Page hidden',true);assert.equal(r.drive.state,'DISCONNECTED');
  await r.drive.stop('Page exit',true);
  assert.doesNotMatch(r.drive.stopResult,/no motor command/);
  assert.match(r.drive.stopResult,/unavailable\/unverified/);
  assert.equal(moving(r.radio).length,1);
});
