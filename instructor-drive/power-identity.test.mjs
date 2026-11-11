import test from 'node:test';
import assert from 'node:assert/strict';
import {DriveController} from './controller.mjs';

const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
class Clock {
  now=0;next=0;timers=new Map();
  set=(fn,ms)=>{const id=++this.next;this.timers.set(id,{at:this.now+ms,fn});return id;};
  clear=id=>this.timers.delete(id);
  async advance(ms){
    const target=this.now+ms;
    for(;;){
      await flush();
      const entry=[...this.timers].filter(([,v])=>v.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!entry)break;
      this.now=entry[1].at;this.timers.delete(entry[0]);entry[1].fn();
    }
    this.now=target;await flush();
  }
}
class Radio {
  mode='LIVE';connected=false;browserId='the-selected-MXT';opens=[];writes=[];closes=0;signals=0;
  async open(options={}){
    this.opens.push(options);
    if(options.expectedBrowserId&&options.expectedBrowserId!==this.browserId)throw Error('Selected device does not match the saved car');
    this.connected=true;return {name:'MXT',browserId:this.browserId};
  }
  close(){this.closes++;this.connected=false;}
  lose(){this.connected=false;this.lost();}
  async identify(){this.signals++;}
  async write(bytes){
    this.writes.push([...bytes]);
    if(bytes[1]===0x18)this.receive(Uint8Array.of(3,0x19,0x27,0x25));
    if(bytes[1]===0x1a)this.receive(Uint8Array.of(3,0x1b,0xa0,0x0f));
    if(bytes[1]===0x16)this.receive(Uint8Array.of(1,0x17));
  }
}
function rig(){
  const radio=new Radio(),clock=new Clock(),log=[];
  const drive=new DriveController(radio,{enabled:true,note:(...row)=>{log.push(row);return true;},setTimer:clock.set,clearTimer:clock.clear});
  return {radio,clock,drive,log};
}
const confirmation={label:'CS460 MXT 01',typedLabel:'CS460 MXT 01',browserId:'the-selected-MXT',observed:true,safe:true};
async function seenOff(r){
  await r.drive.select();r.drive.beginPowerCheck({safe:true});r.radio.lose();await flush();
  assert.equal(r.drive.state,'POWER_OFF_SEEN');
}

test('MOCK prompted off/on check needs same browser device and explicit physical confirmation; nothing auto-starts',async()=>{
  const r=rig();await r.drive.select();
  assert.throws(()=>r.drive.confirm(confirmation));r.drive.beginPowerCheck({safe:true});
  assert.equal(r.drive.state,'WAITING_POWER_OFF');assert.equal(r.radio.connected,true);assert.equal(r.radio.opens.length,1);
  assert.throws(()=>r.drive.confirm(confirmation));r.radio.lose();await flush();
  assert.equal(r.drive.state,'POWER_OFF_SEEN');assert.equal(r.radio.opens.length,1,'disconnect never reconnects automatically');
  assert.throws(()=>r.drive.confirm(confirmation));await assert.rejects(r.drive.arm());
  await r.drive.select();assert.equal(r.radio.opens[1].expectedBrowserId,'the-selected-MXT');assert.equal(r.radio.opens[1].rescanSavedDevice,true);
  assert.equal(r.drive.state,'SELECTED');assert.equal(r.drive.identityMethod,'power-cycle');
  assert.equal(r.radio.writes.length,0);assert.equal(r.radio.signals,0);
  for(const patch of [{observed:false},{safe:false},{typedLabel:'wrong label'},{browserId:'another-MXT'},{observed:'true'},{safe:'true'}]){
    assert.throws(()=>r.drive.confirm({...confirmation,...patch}));assert.equal(r.drive.state,'SELECTED');
  }
  r.drive.confirm(confirmation);assert.equal(r.drive.state,'CONFIRMED');assert.equal(r.radio.writes.length,0);
  await r.drive.arm();assert.equal(r.drive.state,'ARMED');
  assert.deepEqual(r.radio.writes.map(bytes=>bytes[1]),[0x18,0x1a,0x16,0x90,0x24]);
  assert.deepEqual(r.radio.writes.at(-1),[6,0x24,0,0,0xe8,3,1]);
  await r.drive.stop('End test',true);
});

test('MOCK power check requires an explicit true safety acknowledgement and a selected car',async()=>{
  const r=rig();assert.throws(()=>r.drive.beginPowerCheck({safe:true}));await r.drive.select();
  for(const safe of [undefined,false,'true','false',1,{}])assert.throws(()=>r.drive.beginPowerCheck({safe}));
  assert.equal(r.drive.state,'SELECTED');assert.equal(r.radio.writes.length,0);
  r.drive.beginPowerCheck({safe:true});assert.throws(()=>r.drive.beginPowerCheck({safe:true}));
  await r.drive.stop('Cancel',true);
});

test('MOCK no disconnection within 2 minutes fails closed and a later disconnect is not identity evidence',async()=>{
  const r=rig();await r.drive.select();r.drive.beginPowerCheck({safe:true});
  await r.clock.advance(119999);assert.equal(r.drive.state,'WAITING_POWER_OFF');
  await r.clock.advance(1);assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.connected,false);
  assert.notEqual(r.drive.identityMethod,'power-cycle');r.radio.lose();await flush();
  assert.equal(r.drive.state,'DISCONNECTED');assert.throws(()=>r.drive.confirm(confirmation));
  assert.equal(r.radio.writes.length,0);assert.equal(r.radio.opens.length,1);
});

test('MOCK unprompted connection loss cannot establish a power-cycle identity witness',async()=>{
  const r=rig();await r.drive.select();r.radio.lose();await flush();
  assert.equal(r.drive.state,'DISCONNECTED');assert.notEqual(r.drive.identityMethod,'power-cycle');
  await r.drive.select();assert.equal(r.drive.state,'SELECTED');assert.notEqual(r.drive.identityMethod,'power-cycle');
  assert.throws(()=>r.drive.confirm(confirmation));assert.equal(r.radio.writes.length,0);
  await r.drive.stop('End test',true);
});

test('MOCK wrong-car reconnect fails instead of treating an unrelated car as power-cycle matched',async()=>{
  const r=rig();await seenOff(r);r.radio.browserId='another-MXT';
  await assert.rejects(r.drive.select(),/does not match/);
  assert.equal(r.radio.opens[1].expectedBrowserId,'the-selected-MXT');assert.equal(r.radio.opens[1].rescanSavedDevice,true);assert.equal(r.drive.state,'DISCONNECTED');
  assert.notEqual(r.drive.identityMethod,'power-cycle');assert.throws(()=>r.drive.confirm({...confirmation,browserId:'another-MXT'}));
  assert.equal(r.radio.writes.length,0);
});

for(const stage of ['WAITING_POWER_OFF','POWER_OFF_SEEN','reconnected'])test('MOCK cancellation at '+stage+' clears the witness before a fresh selection',async()=>{
  const r=rig();await r.drive.select();r.drive.beginPowerCheck({safe:true});
  if(stage!=='WAITING_POWER_OFF'){r.radio.lose();await flush();}
  if(stage==='reconnected')await r.drive.select();
  await r.drive.stop('Operator cancelled identity check',true);
  assert.equal(r.drive.state,'DISCONNECTED');assert.notEqual(r.drive.identityMethod,'power-cycle');
  await r.drive.select();assert.equal(r.drive.state,'SELECTED');assert.notEqual(r.drive.identityMethod,'power-cycle');
  assert.throws(()=>r.drive.confirm(confirmation));await r.clock.advance(120000);
  assert.equal(r.drive.state,'SELECTED','cancelled timer cannot alter a fresh selection');assert.equal(r.radio.writes.length,0);
  await r.drive.stop('End test',true);
});

test('MOCK starting a power check discards an earlier light signal and cannot silently confirm',async()=>{
  const r=rig();await r.drive.select();await r.drive.identify({safe:true});
  assert.equal(r.drive.signalled,true);r.drive.beginPowerCheck({safe:true});
  assert.equal(r.drive.signalled,false);assert.throws(()=>r.drive.confirm(confirmation));
  await r.drive.stop('Cancel',true);await r.drive.select();assert.throws(()=>r.drive.confirm(confirmation));
  assert.equal(r.radio.writes.length,0);await r.drive.stop('End test',true);
});

test('MOCK invisible light report or failed light writes never silently authorize motion',async()=>{
  const r=rig();await r.drive.select();await r.drive.identify({safe:true});
  assert.throws(()=>r.drive.confirm({...confirmation,observed:false}));await assert.rejects(r.drive.arm());
  r.radio.identify=async()=>{throw Error('Light write failed');};
  await assert.rejects(r.drive.identify({safe:true}),/Light write failed/);
  assert.equal(r.drive.state,'DISCONNECTED');assert.throws(()=>r.drive.confirm(confirmation));
  assert.equal(r.radio.writes.length,0);assert.notEqual(r.drive.identityMethod,'power-cycle');
});

test('MOCK completed power-cycle witness is not invalidated by its old off deadline and is never an automatic confirmation',async()=>{
  const r=rig();await seenOff(r);await r.drive.select();await r.clock.advance(120000);
  assert.equal(r.drive.state,'SELECTED');assert.equal(r.drive.identityMethod,'power-cycle');
  await assert.rejects(r.drive.arm());assert.equal(r.radio.writes.length,0);await r.drive.stop('End test',true);
});

test('MOCK controller checks the captured ID even if an adapter fails to enforce its expected-ID argument',async()=>{
  const r=rig();await seenOff(r);let received;
  r.radio.open=async options=>{received=options; r.radio.connected=true;return {name:'Another MXT',browserId:'wrong-car'};};
  await assert.rejects(r.drive.select({expectedBrowserId:'wrong-car'}),/does not match/);
  assert.equal(received.expectedBrowserId,'the-selected-MXT','caller cannot substitute its own expected ID');
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.drive.identityMethod,null);
  assert.equal(r.radio.connected,false);assert.equal(r.radio.writes.length,0);
});

test('MOCK cancellation during reconnect erases its captured witness and ignores a late selection result',async()=>{
  const r=rig();await seenOff(r);const gate=deferred();
  r.radio.open=async options=>{r.radio.opens.push(options);await gate.promise;r.radio.connected=true;return {name:'MXT',browserId:'the-selected-MXT'};};
  const reconnect=r.drive.select(),rejected=assert.rejects(reconnect,/cancelled/);await flush();
  assert.equal(r.drive.state,'SELECTING');await r.drive.stop('Cancel pending reconnect',true);
  gate.resolve();await rejected;assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.radio.connected,false);
  assert.equal(r.drive.identityMethod,null);assert.equal(r.drive.powerTarget,null);
  r.radio.open=Radio.prototype.open;r.radio.browserId='a-fresh-candidate';await r.drive.select();
  assert.equal(r.drive.state,'SELECTED');assert.equal(r.drive.identityMethod,null);
  assert.throws(()=>r.drive.confirm({...confirmation,browserId:'a-fresh-candidate'}));
  assert.equal(r.radio.writes.length,0);await r.drive.stop('End test',true);
});

test('MOCK a disconnect callback while transport is still connected cannot produce a power-off witness',async()=>{
  const r=rig();await r.drive.select();r.drive.beginPowerCheck({safe:true});r.radio.lost();await flush();
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.drive.powerTarget,null);assert.equal(r.drive.identityMethod,null);
  assert.equal(r.radio.writes.length,0);
});

test('MOCK evidence refusal while recording expected power loss clears the witness and fails closed',async()=>{
  const r=rig();await r.drive.select();r.drive.beginPowerCheck({safe:true});
  r.drive.note=()=>false;r.radio.lose();await flush();
  assert.equal(r.drive.state,'DISCONNECTED');assert.equal(r.drive.powerTarget,null);assert.equal(r.drive.identityMethod,null);
  assert.throws(()=>r.drive.confirm(confirmation));assert.equal(r.radio.writes.length,0);
});


test('MOCK service setup timeout retains only a partial same-ID power witness for explicit retry',async()=>{
  const r=rig();await seenOff(r);
  r.radio.open=async()=>{r.radio.retryBrowserId='the-selected-MXT';throw Object.assign(new Error('discovery timed out'),{name:'SetupTimeoutError'});};
  await assert.rejects(r.drive.select(),/timed out/);
  assert.equal(r.drive.state,'POWER_OFF_SEEN');assert.equal(r.drive.powerTarget.browserId,'the-selected-MXT');
  assert.equal(r.drive.identityMethod,null);assert.equal(r.radio.writes.length,0);assert.throws(()=>r.drive.confirm(confirmation));
  r.radio.open=Radio.prototype.open;await r.drive.select();
  assert.equal(r.drive.identityMethod,'power-cycle');assert.throws(()=>r.drive.confirm({...confirmation,observed:false}));
  await r.drive.stop('End test',true);
});
