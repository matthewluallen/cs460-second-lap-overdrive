import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {AudioCues} from './audio-cues.mjs';
import {ScreenAwake} from './wake-lock.mjs';

// Real controller handlers with a fake relay and browser events. No Bluetooth
// connection, sensor permission, or physical car behavior is implied.
function pad(search='?view=student',hash='#r=12345678&s='+'a'.repeat(24)) {
  const nodes=new Map(),callbacks={},sent=[],requests=[],windowEvents={},documentEvents={},intervals=[];let now=10000,reloads=0,closes=0;
  function node(id){
    if(!nodes.has(id))nodes.set(id,{id,textContent:'',hidden:false,disabled:false,value:'Avery',attrs:{},events:{},children:[],classes:new Set(),
      style:{values:{},setProperty(k,v){this.values[k]=v;}},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,fn){this.events[k]=fn;},setPointerCapture(){},
      append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},getBoundingClientRect(){return{top:0,height:200};},
      classList:{add(...names){for(const name of names)node(id).classes.add(name);},remove(...names){for(const name of names)node(id).classes.delete(name);},toggle(name,on){if(on)node(id).classes.add(name);else node(id).classes.delete(name);}}});
    return nodes.get(id);
  }
  const storage={getItem(){return null;},setItem(){},removeItem(){}};
  const document={hidden:false,getElementById:node,body:node('body'),documentElement:node('html'),createElement:()=>node('new'),addEventListener:(type,fn)=>{documentEvents[type]=fn;}};
  const location={search,hash,reload(){reloads++;}};
  const context=vm.createContext({AudioCues:class extends AudioCues {constructor(options){super({...options,AudioContext:null,document,now:()=>now});}},ScreenAwake:class extends ScreenAwake {constructor(options){super({...options,wakeLock:null,document});}},console,URLSearchParams,Date:{now:()=>now},location,
    sessionStorage:storage,localStorage:storage,navigator:{},document,window:{},screen:{orientation:{angle:0}},
    addEventListener:(type,fn)=>{windowEvents[type]=fn;},setInterval:fn=>{intervals.push(fn);},setTimeout(){},
    api:async(path,options)=>{requests.push({path,...options});return{player:1,playerKey:'b'.repeat(48)};},
    channel:options=>{Object.assign(callbacks,options);return{send:async body=>{sent.push({...body});},stop(){closes++;}};}});
  vm.runInContext(readFileSync(new URL('./pad.mjs',import.meta.url),'utf8').replace(/^import .*;$/gm,''),context);
  const run=code=>vm.runInContext(code,context);
  const state={type:'state',me:{id:1,name:'Guardian',color:[0,1,0],energy:1,speed:0,kills:0,deaths:0,laps:0,bays:{},disabled:false,connected:true},lobby:{phase:'ready',cars:[]}};
  const ready=async()=>{await node('go').onclick();callbacks.onStatus('online');callbacks.onMessage({type:'approved'});callbacks.onMessage(state);};
  const event=(patch={})=>({pointerId:7,button:0,preventDefault(){},stopPropagation(){},...patch});
  return{node,run,callbacks,sent,requests,document,documentEvents,windowEvents,intervals,state,ready,event,location,reloads:()=>reloads,closes:()=>closes,time:t=>{now=t;}};
}

test('student invitation keeps seat credentials and host approval while presenting focused controls',async()=>{
  const p=pad();assert.ok(p.node('body').classes.has('student'));assert.equal(p.node('throttle').hidden,true);
  assert.equal(p.node('drive').hidden,false);assert.equal(p.node('studentGame').hidden,false);
  assert.deepEqual(p.node('studentGame').children.map(n=>n.id),['fire','score']);
  assert.ok(p.node('studentOptionsButtons').children.some(n=>n.id==='tilt'));
  await p.node('go').onclick();assert.equal(p.requests[0].body.joinKey,'a'.repeat(24));
  p.callbacks.onStatus('online');p.callbacks.onMessage({type:'pending'});p.callbacks.onMessage(p.state);
  p.node('drive').events.pointerdown(p.event());assert.equal(p.run('state.throttle'),0);
  assert.equal(p.node('connection').textContent,'Waiting for approval');assert.equal(p.node('drive').disabled,true);
  p.callbacks.onMessage({type:'approved'});p.callbacks.onMessage({...p.state,me:{...p.state.me,needsNeutral:true}});
  p.run('send()');assert.equal(p.sent.at(-1).throttle,0);assert.equal(p.sent.at(-1).steer,0);
  p.callbacks.onMessage(p.state);assert.equal(p.node('car').textContent,'1 · Guardian');assert.equal(p.node('connection').textContent,'Ready to drive');
  assert.equal(p.node('html').style.values['--car'],'rgb(0,255,0)');
  assert.equal(p.run('state.throttle'),0,'approval and readiness never move the car');
  const advanced=pad('');assert.equal(advanced.node('body').classes.has('student'),false);assert.equal(advanced.node('studentGame').children.length,0);
});

test('student hold-to-drive starts deliberately and releases immediately on every ended pointer gesture',async()=>{
  const p=pad();await p.ready();const drive=p.node('drive');
  for(const type of ['pointerup','pointercancel','lostpointercapture']){
    drive.events.pointerdown(p.event());assert.equal(p.sent.at(-1).throttle,1);assert.equal(drive.attrs['aria-pressed'],'true');
    drive.events[type](p.event({pointerId:8}));assert.equal(p.run('state.throttle'),1,'another pointer cannot end this gesture');
    drive.events[type](p.event());assert.equal(p.sent.at(-1).throttle,0);assert.equal(drive.attrs['aria-pressed'],'false');
  }
  assert.equal(p.sent.some(m=>m.attack||m.support||m.special),false);
});

test('student host stops, neutral gates, reassignment and reconnection discard a held gesture',async()=>{
  const p=pad();await p.ready();const drive=p.node('drive');
  for(const fault of ['disconnect','host-stop','neutral','car-change']){
    drive.events.pointerdown(p.event());assert.equal(p.run('state.throttle'),1);
    if(fault==='disconnect'){p.callbacks.onStatus('offline');p.callbacks.onStatus('online');}
    if(fault==='host-stop')p.callbacks.onMessage({...p.state,lobby:{phase:'stopped'}});
    if(fault==='neutral')p.callbacks.onMessage({...p.state,me:{...p.state.me,needsNeutral:true}});
    if(fault==='car-change')p.callbacks.onMessage({...p.state,me:{...p.state.me,id:2}});
    p.callbacks.onMessage(p.state);assert.equal(p.run('state.throttle'),0);assert.equal(p.run('drivePointer'),null);
    drive.events.pointerup(p.event());assert.equal(p.run('state.throttle'),0);
    for(const interval of p.intervals)interval();assert.equal(p.sent.at(-1).throttle,0);
  }
});

test('student STOP, hidden tab, lost focus and stale host state immediately release controls',async()=>{
  const p=pad();await p.ready();const drive=p.node('drive');
  drive.events.pointerdown(p.event());p.node('left').onclick();p.node('brake').onclick();
  assert.equal(p.sent.at(-1).throttle,0);assert.equal(p.sent.at(-1).steer,0);assert.equal(p.node('connection').textContent,'Ready to drive');
  drive.events.pointerdown(p.event());p.document.hidden=true;p.documentEvents.visibilitychange();assert.equal(p.sent.at(-1).throttle,0);
  p.document.hidden=false;p.callbacks.onMessage(p.state);assert.equal(p.run('state.throttle'),0);
  drive.events.pointerdown(p.event());p.windowEvents.blur();assert.equal(p.sent.at(-1).throttle,0);
  drive.events.pointerdown(p.event());p.time(11001);p.run('send()');assert.equal(p.sent.at(-1).throttle,0);assert.equal(drive.disabled,true);
  p.callbacks.onMessage(p.state);assert.equal(p.run('state.throttle'),0);
});

test('student keyboard driving is held rather than latched and never doubles as an attack',async()=>{
  const p=pad();await p.ready();const drive=p.node('drive');
  for(const code of ['Space','Enter']){
    drive.events.keydown(p.event({code}));assert.equal(p.sent.at(-1).throttle,1);assert.equal(p.sent.at(-1).attack,false);
    drive.events.keyup(p.event({code}));assert.equal(p.sent.at(-1).throttle,0);
    drive.events.keydown(p.event({code}));drive.events.blur();assert.equal(p.sent.at(-1).throttle,0,'Tab before keyup cannot latch driving');
    p.windowEvents.keyup(p.event({code,target:p.node('left')}));assert.equal(p.run('state.throttle'),0);
  }
  p.windowEvents.keydown(p.event({code:'KeyW'}));assert.equal(p.run('state.throttle'),1);
  p.windowEvents.keyup(p.event({code:'KeyW'}));assert.equal(p.run('state.throttle'),0);
  p.callbacks.onMessage({...p.state,lobby:{phase:'stopped'}});p.windowEvents.keydown(p.event({code:'KeyW'}));
  p.callbacks.onMessage(p.state);p.windowEvents.keydown(p.event({code:'KeyW',repeat:true}));
  for(const interval of p.intervals)interval();assert.equal(p.run('state.throttle'),0,'a key held across rearming cannot restart motion');
});

test('student leaving and revocation preserve the release handshake and clear driving',async()=>{
  const p=pad();await p.ready();p.node('drive').events.pointerdown(p.event());p.node('leave').onclick();
  assert.equal(p.sent.at(-1).release,true);assert.equal(p.sent.at(-1).throttle,0);assert.equal(p.node('drive').disabled,true);
  p.callbacks.onMessage(p.state);p.node('drive').events.pointerdown(p.event());assert.equal(p.run('state.throttle'),0);
  p.callbacks.onMessage({...p.state,me:null});p.callbacks.onMessage(p.state);assert.equal(p.run('state.throttle'),0);
  p.callbacks.onMessage({type:'kicked'});p.node('drive').events.pointerdown(p.event());assert.equal(p.run('state.throttle'),0);
  assert.equal(p.node('drive').disabled,true);
});

test('a valid QR fragment reloads an incomplete phone page instead of retaining its invalid invitation',async()=>{
  const p=pad('?view=student','');assert.equal(p.node('go').disabled,true);
  p.location.hash='#r=12345678&s='+'c'.repeat(24);await p.windowEvents.hashchange();
  assert.equal(p.reloads(),1);assert.equal(p.closes(),0);assert.equal(p.requests.length,0);
  const loaded=pad('?view=student',p.location.hash);await loaded.node('go').onclick();
  assert.equal(loaded.requests[0].body.joinKey,'c'.repeat(24));
});

test('switching QR invitations neutralizes and closes the old controller before binding the new token',async()=>{
  const p=pad();await p.ready();p.node('drive').events.pointerdown(p.event());assert.equal(p.sent.at(-1).throttle,1);
  p.location.hash='#r=12345678&s='+'c'.repeat(24);
  const switching=p.windowEvents.hashchange();
  assert.equal(p.run('state.throttle'),0);assert.equal(p.node('drive').disabled,true);
  p.callbacks.onMessage(p.state);p.callbacks.onStatus('online');p.node('drive').events.pointerdown(p.event());
  assert.equal(p.run('state.throttle'),0,'old callbacks cannot re-enable controls during invitation change');
  await switching;assert.equal(p.sent.at(-1).throttle,0);assert.equal(p.sent.at(-1).steer,0);
  assert.equal(p.closes(),1);assert.equal(p.reloads(),1);
  for(const interval of p.intervals)interval();assert.equal(p.sent.at(-1).throttle,0);
  const loaded=pad('?view=student',p.location.hash);await loaded.node('go').onclick();
  assert.equal(loaded.requests[0].body.joinKey,'c'.repeat(24));assert.equal(loaded.run('state.throttle'),0);
});


test('phone telemetry grace preserves forward hold while every maneuver path is neutral and visibly locked',async()=>{
  for(const search of ['?view=student','']) {
    const p=pad(search);await p.ready();
    if(search)p.node('drive').events.pointerdown(p.event());else p.run('setThrottle(1)');
    p.run('setSteer(.7);state.attack=state.support=state.special=true;once.uturn=true;tiltOn=true;tiltWanted=true');
    const degraded={...p.state,me:{...p.state.me,telemetryHealth:{state:'degraded',maximumSpeed:300,remainingMs:800}},lobby:{phase:'battle'}};
    p.callbacks.onMessage(degraded);
    assert.equal(p.run('state.throttle'),1,'forward control is allowed during the bounded host grace');
    assert.equal(p.node('drive').disabled,false,'Student hold remains usable');
    for(const id of ['left','right','tilt','flip','centerTilt','uturn','attack','support','special'])assert.equal(p.node(id).disabled,true,search+id);
    assert.match(p.node('status').textContent,/Forward speed limited to 300.*steering, tilt and attacks locked/);
    assert.equal(p.run('tiltOn'),false);assert.equal(p.run('tiltWanted'),false);
    p.node('left').onclick();p.node('right').onclick();p.node('uturn').onclick();await p.node('tilt').onclick();
    p.node('attack').events.pointerdown(p.event());p.windowEvents.keydown(p.event({code:'KeyX'}));p.windowEvents.keydown(p.event({code:'KeyF'}));
    p.run('onTilt({beta:0,gamma:24});lastSentAt=0;send()');
    const sent=p.sent.at(-1);assert.equal(sent.throttle,1);assert.equal(sent.steer,0);assert.equal(sent.attack,false);assert.equal(sent.support,false);assert.equal(sent.special,false);assert.equal(sent.uturn,false);
    p.callbacks.onMessage({...p.state,me:{...p.state.me,telemetryHealth:{state:'reacquired'}},lobby:{phase:'battle'}});
    assert.equal(p.run('state.throttle'),1);assert.equal(p.run('state.steer'),0);assert.equal(p.run('tiltOn'),false);assert.equal(p.node('left').disabled,false);
    assert.match(p.node('feedback').textContent,/Track readings restored/);
    p.run('onTilt({beta:0,gamma:36});lastSentAt=0;send()');assert.equal(p.sent.at(-1).steer,0,'prior tilt cannot resume itself');
    p.node('right').onclick();assert.ok(p.run('state.steer')>0,'a new action can steer');
    p.node('brake').onclick();assert.equal(p.sent.at(-1).throttle,0);
  }
});

test('expired phone updates release held forward control during grace and recovery cannot replay it',async()=>{
  const p=pad();await p.ready();p.node('drive').events.pointerdown(p.event());
  p.callbacks.onMessage({...p.state,me:{...p.state.me,telemetryHealth:{state:'degraded',maximumSpeed:180,remainingMs:300}}});
  assert.equal(p.run('state.throttle'),1);p.time(11001);p.run('send()');
  assert.equal(p.sent.at(-1).throttle,0);assert.equal(p.sent.at(-1).steer,0);assert.match(p.node('status').textContent,/Host updates delayed/);
  p.callbacks.onMessage({...p.state,me:{...p.state.me,telemetryHealth:{state:'reacquired'}}});
  assert.equal(p.run('state.throttle'),0);assert.equal(p.run('drivePointer'),null);
  p.node('drive').events.pointerup(p.event());p.run('lastSentAt=0;send()');assert.equal(p.sent.at(-1).throttle,0);
});

test('phone reports bounded ramp and Power Zone durations without using host clock timestamps or replaying cues',async()=>{
  const p=pad();await p.ready();
  const charged={...p.state,me:{...p.state.me,speedPlan:{requested:600,commanded:240,rampMs:2000},powerZone:{effect:'shield',remainingMs:2500,expiresAt:999999999}}};
  p.callbacks.onMessage(charged);
  assert.match(p.node('status').textContent,/Ramping command 240 toward 600/);assert.match(p.node('status').textContent,/Power Zone shield.*2.5 s/);
  assert.equal(p.node('feedback').textContent,'Power Zone shield charged.');
  p.node('feedback').textContent='Another cue';p.callbacks.onMessage(charged);assert.equal(p.node('feedback').textContent,'Another cue');
  p.callbacks.onMessage({...charged,me:{...charged.me,powerZone:{effect:'boost',remainingMs:750}}});assert.match(p.node('status').textContent,/Power Zone boost.*0.8 s/);
  p.callbacks.onMessage(p.state);assert.doesNotMatch(p.node('status').textContent,/Power Zone|Ramping/);
  p.callbacks.onMessage({...charged,me:{...charged.me,speedPlan:{requested:Infinity,commanded:-20,rampMs:2000},powerZone:{effect:'bogus',remainingMs:999999}}});
  assert.doesNotMatch(p.node('status').textContent,/Infinity|bogus|999999/);
});


test('each recovery identity clears steering intent even if a brief degraded update was missed',async()=>{
  const p=pad();await p.ready();p.node('drive').events.pointerdown(p.event());p.node('left').onclick();
  p.run('lastSentAt=0;send()');assert.equal(p.sent.at(-1).steeringActive,true);
  for(const recoveryId of [1,2]) {
    p.callbacks.onMessage({...p.state,me:{...p.state.me,telemetryHealth:{state:'reacquired',recoveryId}}});
    const neutral=p.sent.at(-1);
    assert.equal(neutral.steeringActive,false,'fresh recovery sends the neutral intent acknowledgement immediately');
    assert.equal(neutral.recoveryId,recoveryId,'neutral acknowledgement identifies this exact recovery');
    assert.equal(neutral.throttle,1,'allowed forward hold survives recovery identity change');
    assert.equal(neutral.steeringActive,false);assert.equal(neutral.steer,0);assert.equal(neutral.attack,false);
    p.node('right').onclick();p.run('lastSentAt=0;send()');assert.equal(p.sent.at(-1).steeringActive,true);assert.equal(p.sent.at(-1).recoveryId,recoveryId);
    assert.ok(p.sent.at(-1).steer>0,'explicit new steering intent follows the neutral acknowledgement');
  }
  p.node('brake').onclick();assert.equal(p.sent.at(-1).steeringActive,false);
});

test('phone sound is opt-in and receives only fresh location state; unsupported APIs never block driving',async()=>{
  const p=pad();await p.ready();
  assert.equal(p.run('sounds.snapshot().enabled'),false);assert.equal(p.run('awake.snapshot().active'),true);
  assert.equal(p.node('soundToggle').disabled,true);assert.match(p.node('soundStatus').textContent,/unavailable/);assert.match(p.node('wakeStatus').textContent,/unavailable/);
  await p.node('soundToggle').onclick();assert.equal(p.run('sounds.snapshot().enabled'),false);
  p.node('drive').events.pointerdown(p.event());
  p.callbacks.onMessage({...p.state,me:{...p.state.me,located:true,speed:300}});
  assert.equal(p.run('sounds.previous.fresh'),true);assert.equal(p.run('sounds.previous.halted'),false);
  p.callbacks.onMessage({...p.state,me:{...p.state.me,located:true,telemetryHealth:{state:'degraded',remainingMs:500,maximumSpeed:300}}});
  assert.equal(p.run('sounds.previous.fresh'),false);assert.equal(p.run('state.throttle'),1);
  p.time(11001);p.run('send()');assert.equal(p.run('sounds.previous.fresh'),false);assert.equal(p.run('state.throttle'),0);
  p.callbacks.onMessage({type:'kicked'});assert.equal(p.run('awake.snapshot().active'),false);
  p.windowEvents.pagehide();assert.equal(p.run('sounds.disposed'),true);assert.equal(p.run('awake.disposed'),true);
});


test('phone echoes the bounded recovery identity through stale state and ignores invalid identity updates',async()=>{
  const p=pad();await p.ready();p.run('lastSentAt=0;send()');assert.equal(p.sent.at(-1).recoveryId,0);
  p.callbacks.onMessage({...p.state,me:{...p.state.me,telemetryHealth:{state:'reacquired',recoveryId:7}}});
  assert.equal(p.sent.at(-1).recoveryId,7);
  p.time(11001);p.run('lastSentAt=0;send()');assert.equal(p.sent.at(-1).recoveryId,7,'stale input remains neutral in the same recovery epoch');
  assert.equal(p.sent.at(-1).steeringActive,false);assert.equal(p.sent.at(-1).throttle,0);
  for(const invalid of [-1,1.5,1000001,Infinity,'8',null]) {
    p.callbacks.onMessage({...p.state,me:{...p.state.me,telemetryHealth:{state:'normal',recoveryId:invalid}}});
    p.run('lastSentAt=0;send()');assert.equal(p.sent.at(-1).recoveryId,7,String(invalid));
  }
  p.callbacks.onMessage({...p.state,me:{...p.state.me,id:2,telemetryHealth:{state:'normal',recoveryId:0}}});
  p.run('lastSentAt=0;send()');assert.equal(p.sent.at(-1).recoveryId,0,'a different car establishes its own host-provided recovery identity');
  assert.equal(p.sent.at(-1).throttle,0);
});
