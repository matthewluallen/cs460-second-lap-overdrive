import test from 'node:test';
import assert from 'node:assert/strict';
import {EnrollmentProbe} from './detection.mjs';

function clock(){
  let at=0,nextId=0;
  const timers=new Map();
  return {now:()=>at,setTimer:(fn,delay)=>{const id=++nextId;timers.set(id,{at:at+delay,fn});return id;},
    clearTimer:id=>timers.delete(id),get pending(){return timers.size;},
    tick(ms){
      const end=at+ms;
      for(;;){
        const due=[...timers].filter(([,item])=>item.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
        if(!due)break;
        at=due[1].at;timers.delete(due[0]);due[1].fn();
      }
      at=end;
    }
  };
}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function device({id='selected-candidate',connected=false,pending=null,error=null}={}){
  const target=new EventTarget(),listeners=new Set();
  target.id=id;target.watchingAdvertisements=false;target.watchCalls=0;target.aborts=0;target.signals=[];
  target.gatt={connected,connect(){throw Error('Probe attempted GATT connection');},disconnect(){throw Error('Probe attempted GATT disconnection');},
    getPrimaryService(){throw Error('Probe attempted GATT service access');}};
  const add=target.addEventListener.bind(target),remove=target.removeEventListener.bind(target);
  target.addEventListener=(type,fn,...rest)=>{if(type==='advertisementreceived')listeners.add(fn);return add(type,fn,...rest);};
  target.removeEventListener=(type,fn,...rest)=>{if(type==='advertisementreceived')listeners.delete(fn);return remove(type,fn,...rest);};
  target.listenerCount=()=>listeners.size;
  target.watchAdvertisements=({signal})=>{
    target.watchCalls++;target.signals.push(signal);
    signal.addEventListener('abort',()=>{target.aborts++;target.watchingAdvertisements=false;},{once:true});
    if(error)return Promise.reject(error);
    if(pending)return pending.promise;
    target.watchingAdvertisements=true;return Promise.resolve();
  };
  target.emit=(rssi,source=target)=>{
    const event=new Event('advertisementreceived');Object.assign(event,{device:source,rssi});target.dispatchEvent(event);
  };
  return target;
}
function fixture(options={}){
  const time=clock(),log=[],changes=[],car=device(options);
  const probe=new EnrollmentProbe((kind,message)=>{log.push({kind,message});return options.note?.(kind,message);},snapshot=>changes.push(snapshot),time);
  return {time,log,changes,car,probe};
}
async function ready(f){const opened=await f.probe.open(f.car);assert.equal(opened.state,'ready');}
function window(f,values=[],{source=f.car,settling=[]}={}){
  const phase=f.probe.snapshot.phase;
  assert.equal(f.probe.next(),true);
  const start=f.time.now();
  for(const value of settling){f.time.tick(100);f.car.emit(value,source);}
  if(phase.key==='off')f.time.tick(Math.max(0,2000-(f.time.now()-start)));
  for(const value of values){f.time.tick(100);f.car.emit(value,source);}
  f.time.tick(phase.durationMs-(f.time.now()-start));
}
function powerSequence(f){window(f,[-50,-51,-49]);window(f,[],{settling:[null]});window(f,[-51,-50,-52]);}
function finishPairs(f,pairs=Array.from({length:3},()=>[[-44,-43,-45],[-58,-57,-59]])){
  for(const [near,far] of pairs){window(f,near);window(f,far);}
}
function assertStopped(f,state){
  assert.equal(f.probe.snapshot.state,state);assert.equal(f.time.pending,0);
  assert.equal(f.car.listenerCount(),0);assert.equal(f.car.watchingAdvertisements,false);
  if(f.car.signals.length)assert.equal(f.car.signals.at(-1).aborted,true);
}

test('MOCK combined power cycle and all three near/far pairs produce bounded observational evidence, not identity proof',async()=>{
  const f=fixture();await ready(f);powerSequence(f);finishPairs(f);
  assertStopped(f,'complete');const snapshot=f.probe.snapshot;
  assert.equal(snapshot.consistent,true);assert.equal(snapshot.phase,null);assert.match(snapshot.message,/not proof of identity/);
  assert.deepEqual(snapshot.results.map(row=>row.key),['onbaseline','off','onreturn','near1','far1','near2','far2','near3','far3']);
  assert.deepEqual(snapshot.results.filter(row=>row.key.startsWith('far')).map(row=>row.gapDb),[14,14,14]);
  const off=snapshot.results[1];assert.equal(off.count,0);assert.equal(off.settlingCount,1);assert.equal(off.quiet,true);
  assert.equal(f.car.watchCalls,1);assert.equal(f.car.aborts,1);
  assert.ok(f.log.every(row=>row.kind.startsWith('LIVE identification ')));
  const samples=f.log.filter(row=>row.kind.endsWith(' sample')).map(row=>JSON.parse(row.message));
  assert.equal(samples[0].atMs,100);assert.equal(samples[0].rssi,-50);
  assert.equal(samples[3].settling,true);assert.equal(samples[3].rssi,null);
  assert.match(f.log.find(row=>row.kind.endsWith(' step')).message,/operator-declared/);
  snapshot.results[0].median=999;assert.equal(f.probe.snapshot.results[0].median,-50);
  f.car.emit(-10);assert.equal(f.probe.snapshot.results.length,9);
});

test('MOCK every sampling window needs its own operator click and cannot be started twice',async()=>{
  const f=fixture();await ready(f);
  f.car.emit(-20);f.time.tick(10000);assert.equal(f.probe.snapshot.results.length,0);
  assert.equal(f.probe.next(),true);assert.equal(f.probe.next(),false);
  for(const value of [-50,-51,-49]){f.time.tick(100);f.car.emit(value);}
  f.time.tick(4700);assert.equal(f.probe.snapshot.state,'ready');
  assert.equal(f.probe.snapshot.phase.key,'off');f.time.tick(5000);assert.equal(f.probe.snapshot.results.length,1);
  f.probe.cancel();assertStopped(f,'cancelled');assert.equal(f.probe.next(),false);
});

test('MOCK powered-off check counts candidate advertisements even when RSSI is missing',async()=>{
  const f=fixture();await ready(f);window(f,[-50,-51,-49]);window(f,[undefined]);
  assertStopped(f,'inconclusive');const off=f.probe.snapshot.results[1];
  assert.equal(off.count,1);assert.equal(off.rssiCount,0);assert.equal(off.quiet,false);
  assert.match(f.probe.snapshot.message,/continued after/);assert.equal(f.probe.snapshot.consistent,false);
});

test('MOCK silence followed by no returning signal is inconclusive, never a successful power-cycle match',async()=>{
  const f=fixture();await ready(f);window(f,[-50,-51,-49]);window(f);window(f);
  assertStopped(f,'inconclusive');assert.equal(f.probe.snapshot.results[1].quiet,true);
  assert.equal(f.probe.snapshot.results[2].rssiCount,0);assert.match(f.probe.snapshot.message,/onreturn/);
});

test('MOCK null, absent, malformed and unavailable RSSI values never become zero signal',async()=>{
  const f=fixture();await ready(f);window(f,[null,undefined,NaN,'-50',false,127,-128,21,Infinity]);
  assertStopped(f,'inconclusive');const row=f.probe.snapshot.results[0];
  assert.equal(row.count,9);assert.equal(row.rssiCount,0);assert.equal(row.median,null);assert.equal(row.iqr,null);
  const numeric=fixture();await ready(numeric);window(numeric,[0,0,0]);
  assert.equal(numeric.probe.snapshot.results[0].median,0);numeric.probe.cancel();
});

test('MOCK foreign-device events supply neither positive samples nor off-window activity, and no other device is controlled',async()=>{
  const f=fixture(),other=device({id:'other-candidate',connected:true});other.watchingAdvertisements=true;
  await ready(f);assert.equal(f.probe.next(),true);
  for(let index=0;index<3;index++){f.time.tick(100);f.car.emit(-10,other);f.car.emit(-50);}
  f.time.tick(4700);assert.equal(f.probe.snapshot.results[0].count,3);
  window(f,[-10,-10,-10],{source:other});assert.equal(f.probe.snapshot.results[1].quiet,true);
  f.probe.cancel();assert.equal(other.gatt.connected,true);assert.equal(other.watchingAdvertisements,true);
  assert.equal(other.watchCalls,0);assert.equal(other.aborts,0);
});

test('MOCK all three near/far pairs must meet the fixed gap and strict variability rule',async()=>{
  const f=fixture();await ready(f);powerSequence(f);
  finishPairs(f,[
    [[-60,-40,-40],[-50,-50,-50]], // Gap 10 equals near IQR 10: insufficient.
    [[-44,-44,-44],[-50,-50,-50]], // Gap 6 with no variation: meets heuristic.
    [[-46,-46,-46],[-50,-50,-50]]  // Gap 4: insufficient despite low variation.
  ]);
  assertStopped(f,'inconclusive');const far=f.probe.snapshot.results.filter(row=>row.key.startsWith('far'));
  assert.deepEqual(far.map(row=>row.gapDb),[10,6,4]);assert.deepEqual(far.map(row=>row.passed),[false,true,false]);
  assert.equal(f.probe.snapshot.results.length,9);assert.equal(f.probe.snapshot.consistent,false);
});

test('MOCK events are capped at 50 records but further off-window advertisements still prevent false silence',async()=>{
  const f=fixture();await ready(f);assert.equal(f.probe.next(),true);
  for(let index=0;index<80;index++){f.time.tick(10);f.car.emit(-50);}
  f.time.tick(4200);const baseline=f.probe.snapshot.results[0];
  assert.equal(baseline.count,80);assert.equal(baseline.recordedCount,50);assert.equal(baseline.omittedCount,30);assert.equal(baseline.rssiCount,50);
  assert.equal(f.probe.next(),true);
  for(let index=0;index<50;index++){f.time.tick(10);f.car.emit(null);}
  f.time.tick(1500);f.car.emit(undefined);f.time.tick(6000);
  assertStopped(f,'inconclusive');const off=f.probe.snapshot.results[1];
  assert.equal(off.settlingCount,50);assert.equal(off.count,1);assert.equal(off.omittedCount,1);assert.equal(off.quiet,false);
  assert.equal(f.log.filter(row=>row.kind.endsWith(' sample')).length,100);
  assert.equal(f.log.filter(row=>row.kind.endsWith(' limit')).length,2);
});

test('MOCK opening deadline settles even a hanging watch promise and ignores its late completion',async()=>{
  const pending=deferred(),f=fixture({pending});const opened=f.probe.open(f.car);
  f.time.tick(10000);assert.equal((await opened).state,'inconclusive');assertStopped(f,'inconclusive');
  assert.match(f.probe.snapshot.message,/10 seconds/);const count=f.log.length;
  pending.resolve();await Promise.resolve();f.car.emit(-30);assert.equal(f.log.length,count);
});

test('MOCK cancelling a pending open aborts watching, settles the caller and ignores late rejection/events',async()=>{
  const pending=deferred(),f=fixture({pending});const opened=f.probe.open(f.car);
  f.probe.cancel();assert.equal((await opened).state,'cancelled');assertStopped(f,'cancelled');
  const count=f.log.length;pending.reject(new DOMException('Late permission failure','NotAllowedError'));
  await Promise.resolve();f.car.emit(-30);f.time.tick(180000);assert.equal(f.log.length,count);
});

test('MOCK overall 180-second deadline includes user waiting and interrupts a late window without credit',async()=>{
  const f=fixture();await ready(f);f.time.tick(176000);assert.equal(f.probe.next(),true);
  for(let index=0;index<3;index++){f.time.tick(100);f.car.emit(-50);}
  f.time.tick(3700);assertStopped(f,'inconclusive');assert.equal(f.probe.snapshot.results.length,0);
  assert.match(f.probe.snapshot.message,/180-second/);
});

test('MOCK permission errors and disappearing advertisement watches are inconclusive',async()=>{
  const denied=fixture({error:new DOMException('Denied','NotAllowedError')});
  assert.equal((await denied.probe.open(denied.car)).state,'inconclusive');assertStopped(denied,'inconclusive');
  assert.match(denied.probe.snapshot.message,/NotAllowedError/);
  const stopped=fixture();await ready(stopped);window(stopped,[-50,-51,-49]);stopped.probe.next();
  stopped.car.watchingAdvertisements=false;stopped.time.tick(500);assertStopped(stopped,'inconclusive');
  assert.match(stopped.probe.snapshot.message,/silence cannot be credited/);assert.equal(stopped.probe.snapshot.results.length,1);
});

test('MOCK connected or already-watched candidates are rejected without touching their existing activity',async()=>{
  const connected=fixture({connected:true});await connected.probe.open(connected.car);
  assert.equal(connected.probe.snapshot.state,'inconclusive');assert.equal(connected.car.watchCalls,0);
  assert.equal(connected.car.gatt.connected,true);assert.equal(connected.car.listenerCount(),0);assert.equal(connected.time.pending,0);
  const watched=fixture();watched.car.watchingAdvertisements=true;await watched.probe.open(watched.car);
  assert.equal(watched.probe.snapshot.state,'inconclusive');assert.equal(watched.car.watchCalls,0);
  assert.equal(watched.car.watchingAdvertisements,true);assert.equal(watched.car.aborts,0);
});

test('MOCK absent watch API fails before registration, and changing the selected ID or connection fails closed',async()=>{
  const absent=fixture();delete absent.car.watchAdvertisements;await absent.probe.open(absent.car);
  assert.equal(absent.probe.snapshot.state,'inconclusive');assert.equal(absent.car.listenerCount(),0);
  for(const change of ['id','connected']){
    const f=fixture();await ready(f);f.probe.next();
    if(change==='id')f.car.id='replacement';else f.car.gatt.connected=true;
    f.time.tick(500);assertStopped(f,'inconclusive');assert.equal(f.probe.snapshot.results.length,0);
  }
});

test('MOCK trace refusal stops immediately at candidate, step, sample or summary with no further credit',async()=>{
  for(const refused of ['candidate','step','sample','summary']){
    const f=fixture({note:kind=>kind.endsWith(' '+refused)?false:undefined});
    const opened=await f.probe.open(f.car);
    if(refused!=='candidate'){
      assert.equal(opened.state,'ready');
      if(refused==='step')f.probe.next();else window(f,[-50,-51,-49]);
    }
    assertStopped(f,'inconclusive');assert.equal(f.probe.snapshot.consistent,false);
    assert.equal(f.probe.snapshot.results.length,0);assert.match(f.probe.snapshot.message,/Evidence capture stopped/);
    const count=f.log.length;f.car.emit(-50);f.time.tick(180000);assert.equal(f.log.length,count);
    if(refused==='candidate')assert.equal(f.car.watchCalls,0);
  }
});

test('MOCK refusal of final qualification evidence cannot produce a consistent result',async()=>{
  const f=fixture({note:kind=>kind.endsWith(' result')?false:undefined});await ready(f);powerSequence(f);finishPairs(f);
  assertStopped(f,'inconclusive');assert.equal(f.probe.snapshot.results.length,9);
  assert.equal(f.probe.snapshot.consistent,false);assert.match(f.probe.snapshot.message,/unknown/);
});

test('MOCK synchronous UI cancellation during opening or readiness leaves no watch or timer running',async()=>{
  for(const cancelAt of ['opening','ready']){
    const time=clock(),car=device();let probe;
    probe=new EnrollmentProbe(()=>true,snapshot=>{if(snapshot.state===cancelAt)probe.cancel();},time);
    await probe.open(car);assert.equal(probe.snapshot.state,'cancelled');
    assert.equal(time.pending,0);assert.equal(car.listenerCount(),0);assert.equal(car.watchingAdvertisements,false);
    assert.equal(car.watchCalls,cancelAt==='opening'?0:1);
  }
});
