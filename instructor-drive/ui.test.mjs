import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SimulationTransport as RealSimulationTransport} from './transport.mjs';

// Synthetic DOM integration, NOT browser or hardware acceptance. Load the actual
// UI, controller, protocol, trace and simulation modules. Replace only the LIVE
// radio boundary and browser DOM/config APIs. No Bluetooth API is accessed.
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
class Events {
  handlers=new Map();
  addEventListener(type,fn){const list=this.handlers.get(type)||[];list.push(fn);this.handlers.set(type,list);}
  async dispatch(type,event={}){
    for(const fn of this.handlers.get(type)||[])await fn({target:this,preventDefault(){},...event});
    await flush();
  }
}
class Element extends Events {
  value='';checked=false;disabled=false;hidden=false;textContent='';
  replaceChildren(...children){this.children=children;this.textContent=children.map(x=>x.textContent).join('');}
}
class FixtureRadio {
  mode='LIVE';connected=false;writes=[];opens=[];id='SYNTHETIC-BROWSER-ID';firmware=11866;battery=4000;
  async open(options){this.opens.push(options);this.connected=true;return {name:'Synthetic car',browserId:this.id};}
  async identify(){}
  close(){this.connected=false;}
  async write(bytes){
    this.writes.push([...bytes]);
    const reply={0x16:[1,0x17],0x18:[3,0x19,this.firmware&255,this.firmware>>8],0x1a:[3,0x1b,this.battery&255,this.battery>>8]}[bytes[1]];
    if(reply)this.receive(Uint8Array.from(reply));
  }
}
let fixtureNumber=0;
async function fixture(t,{config=true}={}){
  const elements=new Map(),html=await readFile(new URL('./index.html',import.meta.url),'utf8');
  for(const [,attrs,id] of html.matchAll(/<[a-z]+\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
    const element=new Element();
    element.value=attrs.match(/\bvalue="([^"]*)"/)?.[1]||'';
    element.disabled=/\bdisabled\b/.test(attrs);element.hidden=/\bhidden\b/.test(attrs);
    elements.set(id,element);
  }
  const element=id=>{assert.ok(elements.has(id),`Missing UI element ${id}`);return elements.get(id);};
  element('mode').value=html.match(/id="mode"[\s\S]*?<option value="([^"]+)"/)?.[1];
  const document=Object.assign(new Events(),{hidden:false,getElementById:element,createElement:()=>new Element(),createTextNode:text=>({textContent:text})});
  const window=new Events(),radios=[];
  class MockBrowserTransport extends FixtureRadio {constructor(){super();radios.push(this);}}
  class RecordedSimulation extends RealSimulationTransport {
    writes=[];
    async write(bytes){this.writes.push([...bytes]);return super.write(bytes);}
  }
  const values={document,window,fetch:async()=>({ok:true,json:async()=>({instructorLiveDrive:config})}),
    __driveUIRadio:MockBrowserTransport,__driveUISimulation:RecordedSimulation};
  const prior=new Map([...Object.keys(values),'__driveUIHooks'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(values))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  const absolute=path=>JSON.stringify(new URL(path,import.meta.url).href);
  let source=await readFile(new URL('./ui.mjs',import.meta.url),'utf8');
  source=source.replace("'/link.mjs'",absolute('../bench/link.mjs')).replace("'/trace.mjs'",absolute('../bench/trace.mjs'))
    .replace("'./controller.mjs'",absolute('./controller.mjs'))
    .replace("import {BrowserTransport,SimulationTransport} from './transport.mjs';",
      'const BrowserTransport=globalThis.__driveUIRadio,SimulationTransport=globalThis.__driveUISimulation;');
  source+=`\nglobalThis.__driveUIHooks={controller:()=>controller,trace};\n//# sourceURL=instructor-drive-ui-fixture-${++fixtureNumber}.mjs`;
  await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const hooks=globalThis.__driveUIHooks;
  t.after(async()=>{
    await hooks.controller()?.stop('Synthetic UI test cleanup',true);await flush();
    for(const [key,descriptor] of prior){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  });
  const click=async id=>{assert.equal(element(id).disabled,false,`${id} must be enabled for a user click`);await element(id).dispatch('click');};
  const check=async(id,value)=>{element(id).checked=value;await element(id).dispatch('change');};
  const mode=async value=>{element('mode').value=value;await element('mode').dispatch('change');};
  const connect=async({live=false,label='INSTRUCTOR-A'}={})=>{
    if(live)await mode('live');element('label').value=label;await element('label').dispatch('input');
    await check('safe',true);await click('select');assert.equal(hooks.controller().state,'SELECTED');
  };
  const lightConfirm=async()=>{await click('identify');await check('observed',true);await click('confirm');};
  return {element,click,check,mode,connect,lightConfirm,document,window,radios,...hooks};
}
const nonzero=transport=>transport.writes.filter(x=>x[1]===0x24&&(x[2]||x[3]));

test('UI defaults to simulation and progressively gates connection, observation, arm and one pulse',async t=>{
  const f=await fixture(t),e=f.element;
  assert.equal(e('mode').value,'simulation');assert.equal(e('select').disabled,true);
  assert.equal(e('identifyStep').hidden,true);assert.equal(e('driveStep').hidden,true);assert.equal(f.radios.length,0);
  e('label').value='INSTRUCTOR-A';await e('label').dispatch('input');assert.equal(e('select').disabled,true);
  await f.check('safe',true);await f.click('select');
  assert.equal(e('identifyStep').hidden,false);assert.equal(e('driveStep').hidden,true);assert.equal(e('confirm').disabled,true);
  await f.click('identify');assert.equal(e('confirm').disabled,true);assert.equal(nonzero(f.controller().transport).length,0);
  await f.check('observed',true);await f.click('confirm');assert.equal(e('driveStep').hidden,false);
  assert.equal(e('pulse').disabled,true);await f.click('arm');assert.equal(e('pulse').disabled,false);
  assert.equal(nonzero(f.controller().transport).length,0);await f.click('pulse');
  assert.equal(nonzero(f.controller().transport).length,1);assert.equal(nonzero(f.controller().transport)[0][2],100);
  assert.equal(e('pulse').disabled,true);await f.click('stop');
  assert.equal(f.controller().state,'DISCONNECTED');assert.equal(e('driveStep').hidden,true);
});

test('UI locks mode during selection and requires a fresh safety acknowledgement when changing mode',async t=>{
  const f=await fixture(t);await f.connect();const original=f.controller();
  assert.equal(f.element('mode').disabled,true);await f.mode('live');
  assert.equal(f.controller(),original);assert.equal(f.element('mode').value,'simulation');assert.equal(f.radios.length,0);
  await f.click('disconnect');await f.mode('live');
  assert.equal(f.element('safe').checked,false);assert.equal(f.element('select').disabled,true);
  assert.equal(f.element('observed').checked,false);assert.equal(f.radios[0].opens.length,0);
});

test('UI confirmation binds the captured physical label, not subsequent field changes',async t=>{
  const f=await fixture(t);await f.connect({live:true,label:'FIXED-PHYSICAL-LABEL'});
  assert.equal(f.element('label').disabled,true);
  // Even a scripted field change cannot silently substitute a label mid-session.
  f.element('label').value='DIFFERENT-LABEL';await f.element('label').dispatch('input');
  await f.lightConfirm();
  assert.equal(f.controller().label,'FIXED-PHYSICAL-LABEL');assert.equal(f.element('targetLabel').textContent,'FIXED-PHYSICAL-LABEL');
  assert.equal(f.controller().identity.browserId,'SYNTHETIC-BROWSER-ID');
});

test('UI power-button check requires deliberate same-device reconnection and manual attestation',async t=>{
  const f=await fixture(t);await f.connect({live:true});const radio=f.radios[0];
  await f.click('powerCheck');assert.equal(f.controller().state,'WAITING_POWER_OFF');assert.equal(radio.writes.length,0);
  assert.equal(f.element('select').disabled,true);assert.match(f.element('identityPrompt').textContent,/turn this labeled car OFF/);
  radio.connected=false;radio.lost();await flush();
  assert.equal(f.controller().state,'POWER_OFF_SEEN');assert.equal(radio.opens.length,1);
  assert.equal(f.element('label').disabled,true);assert.equal(f.element('mode').disabled,true);
  assert.equal(f.element('select').textContent,'Reconnect same car');assert.equal(f.element('confirm').disabled,true);
  await f.click('select');assert.equal(radio.opens.length,2);
  assert.equal(radio.opens[1].expectedBrowserId,'SYNTHETIC-BROWSER-ID');assert.equal(f.controller().identityMethod,'power-cycle');
  assert.equal(f.element('confirm').disabled,true);assert.equal(f.element('observed').checked,false);
  assert.match(f.element('observedText').textContent,/switched this exact labeled car off/);
  await f.check('observed',true);await f.click('confirm');
  assert.equal(f.controller().state,'CONFIRMED');assert.equal(radio.writes.length,0);
});

test('UI rejects a different browser device after the physical power check',async t=>{
  const f=await fixture(t);await f.connect({live:true});const radio=f.radios[0];await f.click('powerCheck');
  radio.connected=false;radio.lost();await flush();radio.id='OTHER-SYNTHETIC-ID';await f.click('select');
  assert.equal(f.controller().state,'DISCONNECTED');assert.match(f.element('result').textContent,/does not match/);
  assert.equal(f.element('driveStep').hidden,true);assert.equal(f.element('observed').checked,false);assert.equal(radio.writes.length,0);
});

test('UI light failure never enables confirmation and error reporting tolerates a throwing trace sink',async t=>{
  const f=await fixture(t);await f.connect({live:true});const radio=f.radios[0];
  radio.identify=async()=>{throw new Error('Light signal failed');};
  f.trace.append=()=>{throw new Error('Evidence storage failed');};
  await assert.doesNotReject(f.click('identify'));
  assert.equal(f.controller().state,'DISCONNECTED');assert.match(f.element('result').textContent,/Light signal failed/);
  assert.equal(f.element('confirm').disabled,true);assert.equal(f.element('observed').checked,false);assert.equal(radio.writes.length,0);
});

test('UI retains the exact low battery reading in Debug after arming is blocked',async t=>{
  const f=await fixture(t);await f.connect({live:true});await f.lightConfirm();f.radios[0].battery=3483;
  await f.click('arm');assert.equal(f.controller().state,'DISCONNECTED');
  assert.match(f.element('telemetry').textContent,/battery 3483 mV/);
  assert.match(f.element('result').textContent,/Battery reading is outside/);assert.equal(nonzero(f.radios[0]).length,0);
});

test('UI safety revocation during motion requests STOP and prevents another pulse',async t=>{
  const f=await fixture(t);await f.connect({live:true});await f.lightConfirm();await f.click('arm');await f.click('pulse');
  await f.check('safe',false);assert.equal(f.controller().state,'DISCONNECTED');
  assert.deepEqual(f.radios[0].writes.at(-1),[6,0x24,0,0,0xe8,3,1]);
  assert.equal(f.element('select').disabled,true);assert.equal(f.element('pulse').disabled,true);
});

test('UI Escape, loss of focus, hidden page and exit each disarm and disconnect an armed trial',async t=>{
  const f=await fixture(t);
  const trigger=[()=>f.document.dispatch('keydown',{key:'Escape'}),()=>f.window.dispatch('blur'),
    ()=>{f.document.hidden=true;return f.document.dispatch('visibilitychange');},()=>f.window.dispatch('pagehide')];
  for(const event of trigger){
    f.document.hidden=false;await f.connect();await f.lightConfirm();await f.click('arm');await event();
    assert.equal(f.controller().state,'DISCONNECTED');assert.equal(f.element('pulse').disabled,true);
    assert.equal(nonzero(f.controller().transport).length,0);
  }
});

test('UI server opt-in refusal leaves all connection and motion controls disabled',async t=>{
  const f=await fixture(t,{config:false});
  assert.equal(f.controller(),undefined);assert.equal(f.element('select').disabled,true);assert.equal(f.element('mode').disabled,true);
  assert.equal(f.element('confirm').disabled,true);assert.equal(f.element('arm').disabled,true);assert.equal(f.element('pulse').disabled,true);
  assert.match(f.element('result').textContent,/opt-in is disabled/);assert.equal(f.radios.length,0);
});
