import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Execute the actual phone handlers against a small browser surface. No radio,
// permissions or device sensor is implied by these logic-level regressions.
function pad({vibration = true} = {}) {
  const nodes = new Map(), callbacks = {}, buzzes = [], sent = [];
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {textContent: '', hidden: false, disabled: false, value: '', attrs: {}, events: {},
      style: {setProperty() {}}, classList: {add() {}, remove() {}, toggle() {}}, replaceChildren() {},
      setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, handler) { this.events[type] = handler; }, setPointerCapture() {},
      getBoundingClientRect() { return {top: 0, height: 200}; }});
    return nodes.get(id);
  }
  const storage = {getItem() { return null; }, setItem() {}, removeItem() {}};
  const context = vm.createContext({console, URLSearchParams, Date,
    location: {hash: '#r=12345678&j=' + 'a'.repeat(24)}, sessionStorage: storage, localStorage: storage,
    navigator: vibration ? {vibrate(p) { buzzes.push(p); return true; }} : {},
    document: {hidden: false, getElementById: node, body: node('body'), documentElement: node('html'), addEventListener() {}, createElement: () => node('new')},
    window: {}, screen: {orientation: {angle: 0}},
    setInterval() {}, setTimeout() {}, addEventListener() {},
    api: async () => ({player: 1, playerKey: 'b'.repeat(48)}),
    channel(options) { Object.assign(callbacks, options); return {send: async body => { sent.push(body); }}; }
  });
  vm.runInContext(readFileSync(new URL('./pad.mjs', import.meta.url), 'utf8').replace("import {api, channel} from './net.mjs';", ''), context);
  const run = code => vm.runInContext(code, context);
  const state = {type: 'state', me: {name: 'Car', color: [0, 1, 0], energy: 1, speed: 0, kills: 0, deaths: 0, laps: 0, bays: {}, disabled: false}, lobby: {phase: 'ready', cars: []}};
  const ready = async () => { await node('go').onclick(); callbacks.onStatus('online'); callbacks.onMessage({type: 'approved'}); callbacks.onMessage(state); };
  return {run, node, callbacks, buzzes, sent, state, ready};
}

test('phone disconnect and host stop discard throttle and held controls before recovery', async () => {
  const p = pad(); await p.ready(); p.run('setThrottle(1); down.add("KeyW"); state.attack = true');
  p.callbacks.onStatus('offline');
  assert.equal(p.run('state.throttle'), 0); assert.equal(p.run('down.size'), 0); assert.equal(p.run('state.attack'), false);
  p.callbacks.onStatus('online'); p.callbacks.onMessage(p.state);
  assert.equal(p.run('state.throttle'), 0, 'reconnect must not restore previous motion');
  p.run('setThrottle(1)'); p.callbacks.onMessage({...p.state, lobby: {phase: 'stopped'}});
  assert.equal(p.run('state.throttle'), 0);
  p.callbacks.onMessage(p.state); assert.equal(p.run('state.throttle'), 0);
  p.run('setThrottle(0.5)'); assert.equal(p.run('state.throttle'), 0.5, 'a fresh deliberate input can drive');
});

test('haptics are opt-in and visual feedback works without vibration support', async () => {
  const p = pad(); await p.ready(); assert.equal(p.buzzes.length, 0);
  p.node('haptics').onclick(); assert.equal(p.buzzes.length, 1); assert.equal(p.node('haptics').attrs['aria-pressed'], 'true');
  p.node('haptics').onclick(); assert.equal(p.node('haptics').attrs['aria-pressed'], 'false');
  const unsupported = pad({vibration: false}); await unsupported.ready();
  assert.equal(unsupported.node('haptics').disabled, true);
  assert.match(unsupported.node('feedback').textContent, /Approved/);
});

test('tilt starts neutral at a comfortable holding angle and can be recentered', () => {
  const p = pad();
  p.run('tiltWanted = true; onTilt({beta: 0, gamma: 18})');
  assert.equal(p.run('state.steer'), 0);
  p.run('onTilt({beta: 0, gamma: 30})'); assert.ok(p.run('state.steer') > 0);
  p.node('centerTilt').onclick(); assert.equal(p.run('state.steer'), 0);
  p.run('onTilt({beta: 0, gamma: 30})'); assert.equal(p.run('state.steer'), 0);
  p.run('onTilt({beta: NaN, gamma: 30})'); assert.equal(p.run('state.steer'), 0);
});


test('phone safety stop and disconnected telemetry cannot enable throttle', async () => {
  const p = pad(); await p.ready();
  for (const patch of [{safetyReason: 'Off track'}, {connected: false}]) {
    p.callbacks.onMessage({...p.state, me: {...p.state.me, ...patch}});
    p.run('setThrottle(1)');
    assert.equal(p.run('state.throttle'), 0);
    assert.match(p.node('status').textContent, /Safety stop|disconnected/);
  }
});

test('phone displays the shared objective without losing a queued car selection', async () => {
  const p = pad(); await p.ready();
  p.run('once.car = 2');
  p.callbacks.onMessage({type: 'state', me: null, lobby: {phase: 'ready', cars: [], round: {title: 'Crew mission', status: 'running', mode: 'team', remainingMs: 65000, goal: 6, teamLaps: 2}}});
  assert.equal(p.run('once.car'), 2);
  assert.equal(p.node('missionTitle').textContent, 'Crew mission');
  assert.equal(p.node('missionTime').textContent, '1:05');
  assert.equal(p.node('missionGoal').textContent, '2 / 6 crew laps');
});


test('countdown stays stopped and round transition feedback is announced once', async () => {
  const p = pad(); await p.ready();
  const phase = status => ({...p.state, lobby: {phase: 'ready', round: {title: 'Lap sprint', status, mode: 'race', remainingMs: 3000}}});
  p.callbacks.onMessage(phase('countdown')); p.run('setThrottle(1)');
  assert.equal(p.run('state.throttle'), 0);
  assert.match(p.node('missionGoal').textContent, /Apply throttle after GO/);
  p.callbacks.onMessage(phase('running')); assert.match(p.node('feedback').textContent, /GO!/);
  p.node('feedback').textContent = 'Another cue';
  p.callbacks.onMessage(phase('running')); assert.equal(p.node('feedback').textContent, 'Another cue');
  p.callbacks.onMessage(phase('finished')); assert.match(p.node('feedback').textContent, /Round complete/);
  p.run('setThrottle(1)'); assert.equal(p.run('state.throttle'), 0);
  p.node('feedback').textContent = 'Another cue';
  p.callbacks.onMessage(phase('finished')); assert.equal(p.node('feedback').textContent, 'Another cue');
});


test('accessible throttle responds to arrows, Home and End only when driving is enabled', async () => {
  const p = pad(); await p.ready();
  const key = code => p.node('throttle').events.keydown({code, preventDefault() {}, stopPropagation() {}});
  key('ArrowUp'); assert.equal(p.run('state.throttle'), 0.05);
  assert.equal(p.node('throttle').attrs['aria-valuenow'], '5');
  key('End'); assert.equal(p.run('state.throttle'), 1);
  key('Home'); assert.equal(p.run('state.throttle'), 0);
  p.callbacks.onStatus('offline'); key('End'); assert.equal(p.run('state.throttle'), 0);
});


test('phone shows each driver task and shared objective, and celebrates score gains once', async () => {
  const p = pad(); await p.ready();
  const taskState = score => ({...p.state, me: {...p.state.me, score, task: 'Hold the center lane'}, lobby: {phase: 'ready', round: {title: 'Precision run', status: 'running', mode: 'precision', objective: 'Complete three clean tasks', remainingMs: 60000}}});
  p.callbacks.onMessage(taskState(0));
  assert.equal(p.node('missionGoal').textContent, 'Your task: Hold the center lane · Complete three clean tasks');
  assert.match(p.node('hits').textContent, /Score 0/);
  p.run('haptics = true; lastBuzz = -Infinity');
  p.callbacks.onMessage(taskState(50));
  assert.equal(p.node('feedback').textContent, '+50 points!');
  assert.match(p.node('hits').textContent, /Score 50/);
  assert.equal(p.buzzes.length, 1);
  p.callbacks.onMessage(taskState(50)); assert.equal(p.buzzes.length, 1, 'repeated state does not repeat the cue');
});

test('shared pit pause clears inputs, explains recovery, and never restores throttle', async () => {
  const p = pad(); await p.ready(); p.run('setThrottle(1); state.attack = true');
  const paused = {...p.state, lobby: {phase: 'ready', round: {title: 'Crew mission', status: 'paused', mode: 'team', objective: 'Complete tasks together', remainingMs: 60000}}};
  p.callbacks.onMessage(paused);
  assert.equal(p.run('state.throttle'), 0); assert.equal(p.run('state.attack'), false);
  assert.match(p.node('missionGoal').textContent, /Shared pit stop.*clear the track/);
  assert.match(p.node('status').textContent, /All cars stopped/);
  assert.match(p.node('feedback').textContent, /Shared pit stop/);
  p.callbacks.onMessage({...paused, lobby: {...paused.lobby, round: {...paused.lobby.round, status: 'running'}}});
  assert.equal(p.run('state.throttle'), 0);
});

test('spending weapon energy alone is not presented as a damage event', async () => {
  const p = pad(); await p.ready();
  p.node('feedback').textContent = 'Ready'; p.run('haptics = true; lastBuzz = -Infinity');
  p.callbacks.onMessage({...p.state, me: {...p.state.me, energy: 0.5}});
  assert.equal(p.node('feedback').textContent, 'Ready'); assert.equal(p.buzzes.length, 0);
});


test('a held touch cannot restore throttle after disconnect or a host stop', async () => {
  const p=pad();await p.ready();const slider=p.node('throttle');
  const touch={pointerId:7,pointerType:'touch',clientY:12,button:0};
  slider.events.pointerdown(touch);assert.equal(p.run('state.throttle'),1);
  p.callbacks.onStatus('offline');
  assert.equal(slider.attrs['aria-disabled'],'true');assert.equal(p.node('attack').disabled,true);
  p.callbacks.onStatus('online');p.callbacks.onMessage(p.state);
  slider.events.pointermove(touch);assert.equal(p.run('state.throttle'),0);
  slider.events.pointerdown(touch);assert.equal(p.run('state.throttle'),1);
  p.callbacks.onMessage({...p.state,lobby:{phase:'stopped'}});p.callbacks.onMessage(p.state);
  slider.events.pointermove(touch);assert.equal(p.run('state.throttle'),0);
});

test('direct car reassignment clears held controls and requires deliberate new input', async () => {
  const p=pad();await p.ready();
  p.callbacks.onMessage({...p.state,me:{...p.state.me,id:1}});
  p.run('setThrottle(1); setSteer(1); state.attack=true; down.add("KeyW"); once.uturn=true');
  p.callbacks.onMessage({...p.state,me:{...p.state.me,id:2}});
  assert.equal(p.run('state.throttle'),0);assert.equal(p.run('state.steer'),0);
  assert.equal(p.run('state.attack'),false);assert.equal(p.run('down.size'),0);assert.equal(p.run('once.uturn'),undefined);
  assert.match(p.node('feedback').textContent,/Car changed/);
  p.run('setThrottle(.5)');assert.equal(p.run('state.throttle'),.5);
  p.callbacks.onMessage({...p.state,me:null});p.run('setSteer(1)');
  p.callbacks.onMessage({...p.state,me:{...p.state.me,id:3}});
  assert.equal(p.run('state.steer'),0);assert.equal(p.run('state.throttle'),0);
});

test('unassigned and revoked phones show disabled weapon controls', async () => {
  const p=pad();await p.ready();
  p.callbacks.onMessage({...p.state,lobby:{phase:'battle'}});assert.equal(p.node('attack').disabled,false);
  p.callbacks.onMessage({...p.state,me:null});assert.equal(p.node('attack').disabled,true);
  assert.equal(p.node('energy').style.width,'0%');assert.equal(p.node('hits').textContent,'');
  p.callbacks.onMessage({...p.state,lobby:{phase:'battle'}});
  p.callbacks.onMessage({type:'kicked'});assert.equal(p.node('attack').disabled,true);
  assert.equal(p.node('throttle').attrs['aria-disabled'],'true');
});

test('throttle ignores unrelated pointers and ended gestures', async () => {
  const p=pad();await p.ready();const slider=p.node('throttle');
  slider.events.pointermove({pointerId:7,pointerType:'touch',clientY:12});assert.equal(p.run('state.throttle'),0);
  slider.events.pointerdown({pointerId:7,button:0,clientY:100});
  slider.events.pointermove({pointerId:8,clientY:12});assert.equal(p.run('state.throttle'),.5);
  slider.events.pointerup({pointerId:7});slider.events.pointermove({pointerId:7,clientY:12});assert.equal(p.run('state.throttle'),.5);
});


test('leaving a car locks held inputs until host acknowledgement and retries release', async () => {
  const p=pad();await p.ready();p.callbacks.onMessage({...p.state,me:{...p.state.me,id:1}});
  p.run('setThrottle(1); state.attack=true; down.add("KeyW")');p.node('leave').onclick();
  assert.equal(p.run('releasePending'),true);assert.equal(p.run('driveReady'),false);
  assert.equal(p.run('state.attack'),false);assert.equal(p.run('down.size'),0);
  p.callbacks.onMessage({...p.state,me:{...p.state.me,id:1}});p.run('setThrottle(1)');
  assert.equal(p.run('state.throttle'),0);assert.equal(p.run('driveReady'),false);
  assert.equal(p.sent.at(-1).release,true);assert.equal(p.sent.at(-1).throttle,0);assert.equal(p.sent.at(-1).attack,false);
  p.run('once={};lastSentAt=0;send();');assert.equal(p.sent.at(-1).release,true);
  assert.equal(p.run('releasePending'),true,'release survives outgoing one-shot cleanup');
  p.callbacks.onStatus('offline');p.callbacks.onStatus('online');
  p.callbacks.onMessage({...p.state,me:{...p.state.me,id:1}});assert.equal(p.run('driveReady'),false);
  p.callbacks.onMessage({...p.state,me:null});assert.equal(p.run('releasePending'),false);
  p.callbacks.onMessage({...p.state,me:{...p.state.me,id:2}});assert.equal(p.run('state.throttle'),0);
  p.run('setThrottle(.5)');assert.equal(p.run('state.throttle'),.5);
});
