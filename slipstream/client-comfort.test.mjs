import test from 'node:test';
import assert from 'node:assert/strict';
import {AudioCues} from './audio-cues.mjs';
import {ScreenAwake} from './wake-lock.mjs';

function page() {
  const listeners = new Map();
  return {hidden:false, addEventListener(name,fn){(listeners.get(name)??listeners.set(name,new Set()).get(name)).add(fn);},
    removeEventListener(name,fn){listeners.get(name)?.delete(fn);},
    visible(value){this.hidden=!value;for(const fn of listeners.get('visibilitychange')??[])fn();}};
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function sentinel() {
  let released;
  return {released:false, releases:0, addEventListener(name,fn){if(name==='release')released=fn;},
    release(){this.releases++;this.released=true;released?.();return Promise.resolve();},
    browserRelease(){this.released=true;released?.();}};
}
function audioFixture({reject=false, resumePending=false}={}) {
  const contexts=[],params=[];
  class Param {
    constructor(){this.value=0;this.events=[];params.push(this);}
    cancelScheduledValues(at){this.events.push(['cancel',at]);}
    setValueAtTime(value,at){this.value=value;this.events.push(['set',value,at]);}
    linearRampToValueAtTime(value,at){this.value=value;this.events.push(['ramp',value,at]);}
    setTargetAtTime(value,at,time){this.value=value;this.events.push(['target',value,at,time]);}
  }
  class Node {
    constructor(type){this.type=type;this.gain=new Param();this.frequency=new Param();this.connected=false;this.stops=[];this.starts=[];}
    connect(){this.connected=true;}
    disconnect(){this.connected=false;}
    start(at=0){this.starts.push(at);}
    stop(at=0){this.stops.push(at);}
    end(){this.onended?.();}
  }
  class Context {
    constructor(){this.state='suspended';this.currentTime=0;this.destination={};this.nodes=[];this.closed=0;contexts.push(this);}
    createGain(){const n=new Node('gain');this.nodes.push(n);return n;}
    createOscillator(){const n=new Node('oscillator');this.nodes.push(n);return n;}
    resume(){if(reject)return Promise.reject(new Error('blocked'));if(resumePending)return new Promise(resolve=>{this.resolve=()=>{this.state='running';resolve();};});this.state='running';return Promise.resolve();}
    close(){this.closed++;this.state='closed';return Promise.resolve();}
  }
  return {Context,contexts,params};
}

test('screen-awake remains idle until active and avoids duplicate requests during normal refreshes',async()=>{
  const document=page(),locks=[],status=[];
  const wake=new ScreenAwake({document,wakeLock:{request:async type=>{assert.equal(type,'screen');const s=sentinel();locks.push(s);return s;}},onStatus:s=>status.push(s.state)});
  assert.equal(locks.length,0);wake.setActive(true);wake.setActive(true);await flush();
  assert.equal(locks.length,1);assert.equal(wake.snapshot().state,'held');
  for(let i=0;i<100;i++)wake.setActive(true);
  assert.equal(locks.length,1);wake.setActive(false);assert.equal(locks[0].releases,1);assert.equal(wake.snapshot().state,'idle');
  wake.dispose();assert.ok(status.includes('requesting'));
});
test('screen-awake reacquires after visibility returns but browser release needs explicit retry',async()=>{
  const document=page(),locks=[];
  const wake=new ScreenAwake({document,wakeLock:{request:async()=>{const s=sentinel();locks.push(s);return s;}}});
  wake.setActive(true);await flush();document.visible(false);assert.equal(wake.snapshot().state,'paused');assert.equal(locks[0].released,true);
  document.visible(true);await flush();assert.equal(locks.length,2);assert.equal(wake.snapshot().state,'held');
  locks[1].browserRelease();assert.equal(wake.snapshot().state,'released');
  for(let i=0;i<100;i++)wake.setActive(true);await flush();assert.equal(locks.length,2,'no automatic retry loop');
  wake.retry();await flush();assert.equal(locks.length,3);wake.dispose();
});
test('late screen-awake approval cannot retain a lock after hiding or disconnecting',async()=>{
  for(const action of ['hide','disconnect','dispose']){
    const document=page();let resolve;const lock=sentinel();
    const wake=new ScreenAwake({document,wakeLock:{request:()=>new Promise(r=>resolve=r)}});
    wake.setActive(true);await flush();
    if(action==='hide')document.visible(false);else if(action==='disconnect')wake.setActive(false);else wake.dispose();
    resolve(lock);await flush();assert.equal(lock.releases,1,action);assert.notEqual(wake.snapshot().state,'held',action);wake.dispose();
  }
});
test('denied and unsupported screen-awake requests remain visible without retry storms',async()=>{
  const document=page();let attempts=0;
  const wake=new ScreenAwake({document,wakeLock:{request:async()=>{attempts++;throw new Error('denied');}}});
  wake.setActive(true);await flush();assert.equal(wake.snapshot().state,'denied');
  for(let i=0;i<100;i++)wake.setActive(true);await flush();assert.equal(attempts,1);
  wake.retry();await flush();assert.equal(attempts,2);wake.dispose();
  const unsupported=new ScreenAwake({document,wakeLock:null});unsupported.setActive(true);assert.equal(unsupported.snapshot().state,'unsupported');unsupported.dispose();
});
test('audio allocates nothing before explicit enable, handles denial, and cancels a pending opt-in',async()=>{
  const f=audioFixture(),document=page(),audio=new AudioCues({document,AudioContext:f.Context});
  audio.setEngine(true);audio.update({online:true,halted:false,fresh:true,speed:300,carId:1,lap:0});audio.cue('lap');assert.equal(f.contexts.length,0);
  assert.equal(await audio.enable(),true);assert.equal(f.contexts.length,1);audio.disable();assert.equal(f.contexts[0].closed,1);
  const failed=audioFixture({reject:true}),blocked=new AudioCues({document,AudioContext:failed.Context});assert.equal(await blocked.enable(),false);assert.equal(blocked.snapshot().state,'blocked');blocked.dispose();
  const late=audioFixture({resumePending:true}),cancelled=new AudioCues({document,AudioContext:late.Context});const pending=cancelled.enable();cancelled.disable();late.contexts[0].resolve();assert.equal(await pending,false);assert.equal(cancelled.snapshot().enabled,false);assert.equal(late.contexts[0].closed,1);
});
test('engine synthesis has an audio-thread freshness deadline and is silenced on stale, hidden, stopped or lost state',async()=>{
  for(const action of ['stale','hidden','stopped','offline','degraded']){
    const f=audioFixture(),document=page(),audio=new AudioCues({document,AudioContext:f.Context});await audio.enable();audio.setEngine(true);
    const live={online:true,halted:false,carId:1,speed:300,fresh:true,lap:0};audio.update(live);
    const context=f.contexts[0],engine=audio.engineNode,gain=audio.engineGain.gain;
    assert.equal(engine.starts.length,1);assert.ok(gain.events.some(e=>e[0]==='ramp'&&e[1]===0&&e[2]===.5));
    context.currentTime=1;
    if(action==='hidden')document.visible(false);
    else audio.update({...live,...({stale:{fresh:false},stopped:{halted:true},offline:{online:false},degraded:{telemetryState:'degraded'}}[action])});
    assert.deepEqual(gain.events.at(-1),['ramp',0,1.025],action);
    audio.dispose();assert.equal(engine.connected,false,action);
  }
});
test('audio cues use event edges, not initial lap counts or repeated frames, and cap live voices',async()=>{
  const f=audioFixture(),document=page();let now=0;
  const audio=new AudioCues({document,AudioContext:f.Context,now:()=>now});await audio.enable();
  const live={online:true,halted:false,fresh:true,carId:1,speed:300,lap:7};audio.update(live);assert.equal(audio.tones.size,0);
  audio.update({...live,lap:8});assert.equal(audio.tones.size,2);
  audio.update({...live,lap:8});assert.equal(audio.tones.size,2,'same lap does not replay');
  audio.update({...live,carId:2,lap:20});assert.equal(audio.tones.size,2,'selecting a new car does not celebrate old laps');
  for(let i=0;i<20;i++){now+=500;audio.cue('shield');assert.ok(audio.tones.size<=6);}
  for(const tone of [...audio.tones])tone.osc.end();assert.equal(audio.tones.size,0);
  audio.update({...live,carId:2,halted:true,fresh:false});assert.equal(audio.tones.size,2,'STOP-request cue is allowed after engine is muted');
  audio.update({...live,carId:2,halted:true,fresh:false});assert.equal(audio.tones.size,2,'next quiet frame does not truncate STOP-request cue');
  document.visible(false);assert.equal(audio.tones.size,0);assert.equal(audio.cue('lap'),false);audio.dispose();
});
test('volume and optional engine changes are local only and suspended audio remains explicit',async()=>{
  const f=audioFixture(),audio=new AudioCues({AudioContext:f.Context,document:page()});await audio.enable();
  assert.equal(audio.snapshot().engine,false);assert.equal(audio.setVolume(4),1);assert.equal(audio.setVolume(-3),0);assert.equal(audio.cue('lap'),false);
  audio.setVolume(.3);audio.setEngine(true);audio.update({online:true,halted:false,fresh:true,carId:1,speed:600});assert.ok(audio.engineNode);
  audio.setEngine(false);assert.equal(audio.engineGain.gain.events.at(-1)[1],0);
  f.contexts[0].state='suspended';f.contexts[0].onstatechange();assert.equal(audio.snapshot().state,'paused');assert.equal(audio.cue('lap'),false);
  assert.equal(await audio.enable(),true);assert.equal(audio.snapshot().state,'on');audio.dispose();
});
