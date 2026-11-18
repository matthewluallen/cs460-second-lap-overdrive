import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

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
  const context=vm.createContext({console,URLSearchParams,Date:{now:()=>now},location,
    sessionStorage:storage,localStorage:storage,navigator:{},document,window:{},screen:{orientation:{angle:0}},
    addEventListener:(type,fn)=>{windowEvents[type]=fn;},setInterval:fn=>{intervals.push(fn);},setTimeout(){},
    api:async(path,options)=>{requests.push({path,...options});return{player:1,playerKey:'b'.repeat(48)};},
    channel:options=>{Object.assign(callbacks,options);return{send:async body=>{sent.push({...body});},stop(){closes++;}};}});
  vm.runInContext(readFileSync(new URL('./pad.mjs',import.meta.url),'utf8').replace("import {api, channel} from './net.mjs';",''),context);
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
