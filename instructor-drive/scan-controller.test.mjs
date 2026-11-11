import test from 'node:test';
import assert from 'node:assert/strict';
import {ScanController,MAX_SCAN_MS} from './scan-controller.mjs';

const flush=async()=>{for(let i=0;i<60;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
class Clock{
  now=0;next=0;timers=new Map();
  set=(fn,ms)=>{const id=++this.next;this.timers.set(id,{fn,at:this.now+ms});return id;};
  clear=id=>this.timers.delete(id);
  async advance(ms){
    const target=this.now+ms;
    for(;;){await flush();const entry=[...this.timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
      if(!entry)break;const [id,timer]=entry;this.now=timer.at;this.timers.delete(id);timer.fn();}
    this.now=target;await flush();
  }
}
class Radio{
  mode='SIMULATION';connected=false;writes=[];firmware=11866;silent=false;intercept=null;
  async open(){this.connected=true;return {browserId:'synthetic-selected-car',name:'SIMULATION'};}
  async identify(){}
  close(){this.connected=false;}
  async write(bytes){
    this.writes.push([...bytes]);
    if(this.intercept){const held=this.intercept(bytes);if(held!==undefined)return held;}
    if(bytes[1]===0x18)this.receive(Uint8Array.of(3,0x19,this.firmware&255,this.firmware>>8));
    if(bytes[1]===0x1a)this.receive(Uint8Array.of(3,0x1b,0xa0,0x0f));
    if(bytes[1]===0x16&&!this.silent)this.receive(Uint8Array.of(1,0x17));
  }
}
function rig(options={}){
  const clock=new Clock(),radio=new Radio(),events=[];
  const drive=new ScanController(radio,{enabled:true,now:()=>clock.now,setTimer:clock.set,clearTimer:clock.clear,
    note:(...x)=>{events.push(x);return true;},...options});return {clock,radio,drive,events};
}
const motors=r=>r.radio.writes.filter(b=>b[1]===0x24),nonzero=r=>motors(r).filter(b=>b[2]||b[3]);
async function arm(r){
  await r.drive.select();await r.drive.identify({safe:true});
  r.drive.confirm({label:'SYNTHETIC-A',typedLabel:'SYNTHETIC-A',browserId:'synthetic-selected-car',observed:true,safe:true});
  await r.drive.arm();
}
async function qualify(r,speed=100){
  await arm(r);await r.drive.pulse(speed);await r.clock.advance(750);
  assert.equal(r.drive.pulseReadyForQualification,true);
  r.drive.qualify({movementObserved:true,stopObserved:true});assert.equal(r.drive.scanQualified,true);
  await r.drive.arm();
}
function position(id=34){return Uint8Array.of(16,0x27,7,id,0,0,0,0,100,0,0,0,0,0,0,100,0);}
function transition(turn=false){return Uint8Array.of(17,0x29,0,255,0,0,0,0,0,0,0,0,0,0,0,0,turn?48:56,turn?40:56);}
function tile(r,id,turn=false){r.radio.receive(position(id));r.radio.receive(transition(turn));}

test('default opt-in and identity/arm gates survive subclassing without auto motion',async()=>{
  const disabled=rig({enabled:false});await assert.rejects(disabled.drive.select(),/opt-in/);assert.equal(disabled.radio.writes.length,0);
  const r=rig();await arm(r);assert.equal(nonzero(r).length,0);assert.equal(r.drive.trackSnapshot().status,'IDLE');
  await assert.rejects(r.drive.scan({containedTrack:true}),/qualify/);assert.throws(()=>r.drive.qualify({movementObserved:true,stopObserved:true}),/Complete/);
});

test('pulse write completion is insufficient: automatic zero STOP and two strict attestations are required',async()=>{
  const r=rig();await arm(r);await r.drive.pulse(100);
  assert.equal(r.drive.pulseReadyForQualification,false);assert.equal(r.drive.scanQualified,false);
  await r.clock.advance(749);assert.equal(r.drive.pulseReadyForQualification,false);
  await r.clock.advance(1);assert.equal(r.drive.pulseReadyForQualification,true);
  for(const args of [{},{movementObserved:true},{stopObserved:true},{movementObserved:'true',stopObserved:true}])assert.throws(()=>r.drive.qualify(args));
  r.drive.qualify({movementObserved:true,stopObserved:true});assert.equal(r.drive.qualifiedSpeed,100);
  assert.equal(nonzero(r).length,1);assert.equal(r.drive.state,'CONFIRMED');
});

test('manual STOP, failed zero write and disconnect never qualify a pulse',async()=>{
  const manual=rig();await arm(manual);await manual.drive.pulse(100);await manual.drive.stop('Emergency STOP');
  await manual.clock.advance(750);assert.equal(manual.drive.pulseReadyForQualification,false);
  const failed=rig();await arm(failed);await failed.drive.pulse(100);
  failed.radio.intercept=b=>{if(b[1]===0x24&&!b[2])throw new Error('zero failed');};
  await failed.clock.advance(750);assert.equal(failed.drive.state,'DISCONNECTED');assert.equal(failed.drive.pulseReadyForQualification,false);
  const lost=rig();await arm(lost);await lost.drive.pulse(100);lost.radio.connected=false;lost.radio.lost();await flush();
  assert.equal(lost.drive.scanQualified,false);assert.equal(lost.drive.pulseReadyForQualification,false);
});

test('concurrent emergency stop invalidates a pending pulse-limit qualification callback',async()=>{
  const r=rig();await arm(r);await r.drive.pulse(100);const held=deferred();
  r.radio.intercept=b=>b[1]===0x24&&!b[2]?held.promise:undefined;
  await r.clock.advance(750);assert.equal(r.drive.state,'STOPPING');
  const stop=r.drive.stop('Emergency STOP');held.resolve();await stop;await flush();
  assert.equal(r.drive.pulseReadyForQualification,false);assert.equal(r.drive.scanQualified,false);
});

test('qualification is bound to the same session, firmware, and physically qualified speed',async()=>{
  const r=rig();await qualify(r,100);
  await assert.rejects(r.drive.scan({containedTrack:true,speed:200}),/qualified pulse speed/);
  r.drive.firmware=9511;assert.equal(r.drive.scanQualified,false);
  r.drive.firmware=11866;await r.drive.stop('Disconnect',true);assert.equal(r.drive.scanQualified,false);
  await r.drive.select();assert.equal(r.drive.pulseReadyForQualification,false);assert.equal(r.drive.scanQualified,false);
});

test('scan validates strict contained-track attestation and bounds before nonzero dispatch',async()=>{
  const r=rig();await qualify(r,200);const count=nonzero(r).length;
  for(const args of [{},{containedTrack:1},{containedTrack:true,speed:0},{containedTrack:true,speed:201},
    {containedTrack:true,speed:100,durationMs:0},{containedTrack:true,durationMs:45001},{containedTrack:true,durationMs:NaN},
    {containedTrack:true,speed:'100'},{containedTrack:true,durationMs:'45000'}])await assert.rejects(r.drive.scan(args));
  assert.equal(MAX_SCAN_MS,45000);assert.equal(nonzero(r).length,count);assert.equal(r.drive.state,'ARMED');
});

test('scan sends one bounded nonzero command and budget STOP; heartbeat cannot repeat speed',async()=>{
  const r=rig();await qualify(r);const before=nonzero(r).length;
  await r.drive.scan({containedTrack:true,speed:100,durationMs:1000});assert.equal(r.drive.state,'SCANNING');
  assert.equal(nonzero(r).length,before+1);await r.clock.advance(999);assert.equal(r.drive.state,'SCANNING');
  await r.clock.advance(1);assert.equal(r.drive.state,'CONFIRMED');assert.equal(r.drive.trackSnapshot().status,'INCOMPLETE');
  assert.equal(r.drive.scanQualified,false);assert.equal(motors(r).at(-1)[2],0);
  await r.clock.advance(50000);assert.equal(nonzero(r).length,before+1);
});

test('no track telemetry stops in five seconds even when all pings reply',async()=>{
  const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});
  await r.clock.advance(4999);assert.equal(r.drive.state,'SCANNING');await r.clock.advance(1);
  assert.equal(r.drive.state,'CONFIRMED');assert.match(r.drive.trackSnapshot().reason,/No track position code/);
  assert.equal(motors(r).at(-1)[2],0);
});

test('first valid track evidence changes the silence deadline to two seconds, ping never resets it',async()=>{
  const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});await r.clock.advance(1000);
  r.radio.receive(position());await r.clock.advance(1999);assert.equal(r.drive.state,'SCANNING');await r.clock.advance(1);
  assert.equal(r.drive.state,'CONFIRMED');assert.match(r.drive.trackSnapshot().reason,/absent for 2 seconds/);
});

test('transition bars alone cannot extend initial or subsequent position-code deadlines',async()=>{
  const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});
  for(let i=0;i<4;i++){await r.clock.advance(1000);r.radio.receive(transition());}
  await r.clock.advance(1000);assert.equal(r.drive.state,'CONFIRMED');assert.match(r.drive.trackSnapshot().reason,/No track position code/);
  const second=rig();await qualify(second);await second.drive.scan({containedTrack:true});second.radio.receive(position());
  await second.clock.advance(1500);second.radio.receive(transition());await second.clock.advance(500);
  assert.equal(second.drive.state,'CONFIRMED');assert.match(second.drive.trackSnapshot().reason,/position codes absent/);
});

test('STOP invalidates active work before recorder finalization; clock reversal cannot delay heartbeat beyond500ms',async()=>{
  const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});
  const epoch=r.drive.epoch;let observed;
  r.drive.recorder.finish=()=>{observed={epoch:r.drive.epoch,state:r.drive.state};throw new Error('export failed');};
  await r.drive.stop('Emergency STOP');assert.equal(observed.epoch,epoch+1);assert.equal(observed.state,'STOPPING');
  assert.equal(motors(r).at(-1)[2],0);assert.equal(r.drive.heartbeatDelay(r.clock.now+999999),500);
});

test('heartbeat response timeout stops and disconnects; no overlapping same-ID waiter',async()=>{
  const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});r.radio.silent=true;
  const pings=r.radio.writes.filter(b=>b[1]===0x16).length;
  await r.clock.advance(500);assert.equal(r.drive.waiters.size,1);await r.clock.advance(999);
  assert.equal(r.radio.writes.filter(b=>b[1]===0x16).length,pings+1);assert.equal(r.drive.state,'SCANNING');
  await r.clock.advance(1);assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.drive.scanQualified,false);
  r.radio.receive(Uint8Array.of(1,0x17));await r.clock.advance(5000);assert.equal(r.drive.state,'DISCONNECTED');
});

test('STOP during pre-scan ping prevents any scan speed even after a late reply',async()=>{
  const r=rig();await qualify(r);r.radio.silent=true;const before=nonzero(r).length;
  const scan=r.drive.scan({containedTrack:true});const rejected=assert.rejects(scan,/STOP|cancelled/);await flush();
  await r.drive.stop('Emergency STOP');await rejected;r.radio.receive(Uint8Array.of(1,0x17));await r.clock.advance(5000);
  assert.equal(nonzero(r).length,before);assert.equal(r.drive.state,'CONFIRMED');assert.equal(r.drive.scanQualified,false);
});

test('STOP while heartbeat reply is pending cancels timers and late replies cannot restart scan',async()=>{
  const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});r.radio.silent=true;
  await r.clock.advance(500);await r.drive.stop('Emergency STOP');const writes=r.radio.writes.length;
  r.radio.receive(Uint8Array.of(1,0x17));await r.clock.advance(50000);
  assert.equal(r.radio.writes.length,writes);assert.equal(r.drive.state,'CONFIRMED');assert.equal(r.drive.scanQualified,false);
});

test('scan budget starts before held speed dispatch, stale completion cannot bypass queued zero',async()=>{
  const r=rig();await qualify(r);const held=deferred();r.radio.intercept=b=>b[1]===0x24&&b[2]===100?held.promise:undefined;
  const scan=r.drive.scan({containedTrack:true,durationMs:100});const rejected=assert.rejects(scan,/cancelled|timed out/);await flush();
  await r.clock.advance(100);assert.equal(r.drive.state,'STOPPING');held.resolve();await rejected;await flush();
  assert.equal(r.drive.state,'CONFIRMED');assert.equal(motors(r).at(-1)[2],0);assert.equal(r.drive.scanQualified,false);
  await r.clock.advance(50000);assert.equal(r.drive.state,'CONFIRMED');
});

test('hung speed write and failed STOP close the session without late motion resurrection',async()=>{
  const r=rig();await qualify(r);const held=deferred();r.radio.intercept=b=>b[1]===0x24&&b[2]===100?held.promise:undefined;
  const scan=r.drive.scan({containedTrack:true});const rejected=assert.rejects(scan,/timed out/);await flush();
  await r.clock.advance(1200);await rejected;assert.equal(r.drive.state,'DISCONNECTED');
  held.resolve();await flush();assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.drive.scanQualified,false);
});

test('malformed, ambiguous and delocalized telemetry trigger STOP rather than simulated progress',async()=>{
  for(const bytes of [Uint8Array.of(0),Uint8Array.of(2,0x27,34),Uint8Array.of(1,0x2b)]){
    const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});r.radio.receive(bytes);await flush();
    assert.notEqual(r.drive.state,'SCANNING');assert.equal(motors(r).at(-1)[2],0);
    assert.equal(r.drive.trackSnapshot().status,'INCOMPLETE');assert.equal(r.drive.scanQualified,false);
  }
  const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});tile(r,34);tile(r,53);await flush();
  assert.equal(r.drive.state,'CONFIRMED');assert.equal(r.drive.trackSnapshot().pieces[1].pieceId,53);
});

test('real recorder completion stops before any further motion and preserves synthetic evidence label',async()=>{
  const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});
  tile(r,34);tile(r,33);tile(r,17,true);tile(r,17,true);tile(r,36);tile(r,17,true);tile(r,17,true);tile(r,34);
  await flush();assert.equal(r.drive.state,'CONFIRMED');assert.equal(motors(r).at(-1)[2],0);
  const result=r.drive.trackSnapshot();assert.equal(result.status,'COMPLETE');assert.equal(result.mode,'SIMULATION');
  const writes=r.radio.writes.length;await r.clock.advance(50000);assert.equal(r.radio.writes.length,writes);
});

test('trace refusal and recorder exceptions cannot prevent emergency zero',async()=>{
  const r=rig();await qualify(r);await r.drive.scan({containedTrack:true});r.drive.note=()=>false;
  r.radio.receive(Uint8Array.of(1,0x17));await flush();assert.equal(motors(r).at(-1)[2],0);assert.equal(r.drive.state,'DISCONNECTED');
  const broken=rig();await qualify(broken);await broken.drive.scan({containedTrack:true});
  broken.drive.recorder.ingest=()=>{throw new Error('recorder failure');};broken.radio.receive(position());await flush();
  assert.equal(motors(broken).at(-1)[2],0);assert.equal(broken.drive.state,'DISCONNECTED');
});

test('qualification trace refusal cannot grant authority and later STOP revokes prior attestation',async()=>{
  const r=rig();await arm(r);await r.drive.pulse(100);await r.clock.advance(750);r.drive.note=()=>false;
  assert.throws(()=>r.drive.qualify({movementObserved:true,stopObserved:true}),/Evidence/);assert.equal(r.drive.scanQualified,false);
  r.drive.note=()=>true;r.drive.qualify({movementObserved:true,stopObserved:true});await r.drive.stop('Operator STOP');
  assert.equal(r.drive.scanQualified,false);assert.equal(r.drive.pulseReadyForQualification,false);
});
