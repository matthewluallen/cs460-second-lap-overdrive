import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {FaultTransport, FaultRelay} from './faults.mjs';
import {trackFromPlan, trackValidation} from './track.mjs';
import {SimWorld, LAYOUTS} from './sim.mjs';
import {Recorder} from './trace.mjs';
import {WEAPON_LABEL} from './battle.mjs';
import {RoundSession, ROUND_MODES, STORY_MISSIONS} from './session.mjs';

// Execute the actual host handlers and loop with DOM stubs and the simulated
// transport. These verify control logic, not browser rendering or real hardware.
function host({injectFaults = false, advancingClock = false, bluetoothLink = null, stored = {}} = {}) {
  const transports = [];
  const nodes = new Map(), documentEvents = {}, windowEvents = {}, intervals = [];
  let now = 0, reads = 0;
  const clock = () => now + (advancingClock ? ++reads * .01 : 0);
  function element(tag = 'div') {
    const n = {tagName: tag.toUpperCase(), children: [], textContent: '', value: '', hidden: false, disabled: false,
      style: {setProperty() {}}, classList: {add() {}, remove() {}, toggle() {}}, dataset: {},
      setAttribute() {}, addEventListener() {}, setPointerCapture() {}, select() {}, remove() {},
      append(...items) { this.children.push(...items); if (this.tagName === 'SELECT' && !this.value && items.length) this.value = items[0].value; },
      prepend(...items) { this.children.unshift(...items); },
      replaceChildren(...items) { this.children = []; if (this.tagName === 'SELECT') this.value = ''; this.append(...items); },
      click() { return this.onclick?.({}); }
    };
    return n;
  }
  const node = id => {
    if (!nodes.has(id)) {
      const n = element(['mode', 'mission', 'layout'].includes(id) ? 'select' : 'div');
      if (id === 'scores') n.tBodies = [element('tbody')];
      nodes.set(id, n);
    }
    return nodes.get(id);
  };
  const storage = {getItem(key) { return stored[key] ?? null; }, setItem(key,value) { stored[key]=value; }, removeItem(key) { delete stored[key]; }};
  const document = {hidden: false, getElementById: node, createElement: element, querySelectorAll() { return []; },
    addEventListener(name, fn) { (documentEvents[name] ??= []).push(fn); }};
  const fixtures = Object.fromEntries(['pieces', 'vehicles', 'weapons'].map(n => [n, JSON.parse(readFileSync(new URL('./data/' + n + '.json', import.meta.url)))]));
  const context = vm.createContext({console, Date, URL, Blob, trackFromPlan, trackValidation, FaultRelay, Game: class extends Game { constructor(options) { super({...options, clock}); } addCar(transport, options) { if (injectFaults) { transport = new FaultTransport(transport); transports.push(transport); } return super.addCar(transport, options); } }, SimWorld, LAYOUTS, Recorder, WEAPON_LABEL, RoundSession, ROUND_MODES, STORY_MISSIONS,
    fixtures, document, window: {}, navigator: {}, sessionStorage: storage, localStorage: storage,
    performance: {now: clock}, location: {origin: 'http://localhost', host: 'localhost'},
    Option: function(text, value) { return {textContent: text, value}; },
    Renderer: class {draw() {} addEffect() {}}, bluetoothAvailable: () => !!bluetoothLink, chooseCar: async () => bluetoothLink,
    api: async () => ({}), channel: () => ({send: async () => {}, stop() {}}),
    setTimeout() {}, setInterval(fn) { intervals.push(fn); }, requestAnimationFrame() {},
    addEventListener(name, fn) { (windowEvents[name] ??= []).push(fn); }
  });
  const source = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '')
    .replace("await Promise.all([load('pieces'), load('vehicles'), load('weapons')])", '[fixtures.pieces, fixtures.vehicles, fixtures.weapons]');
  vm.runInContext(source, context);
  return {transports, run: code => vm.runInContext(code, context), node, document,
    tick(time) { now = time; reads = 0; for (const transport of transports) transport.advance(now); for (const fn of intervals) fn(); },
    visibility(hidden) { document.hidden = hidden; for (const fn of documentEvents.visibilitychange ?? []) fn(); },
    event(name, value = {}) { for (const fn of windowEvents[name] ?? []) fn(value); }};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('forward-check button preserves the recording, waits for countdown and exposes a dedicated stop', async () => {
  const h=host();h.node('addSim').click();await h.run('game.drivers[0].car.pumpPromise');
  h.run("const d=game.drivers[0];game.useTrack(world.track);game.setControl(d,'bot');game.stopAll();recorder.start(game.drivers,'Connection recording');recorder.mark('connection-evidence');refresh();cards.get(d).forwardBaseline.click();");
  assert.equal(h.run('countdown.kind'),'forward-baseline');
  assert.equal(h.run('d.car.speed'),0);
  assert.equal(h.run("recorder.markers.some(m=>m.kind==='connection-evidence')"),true);
  assert.equal(h.run('recorder.note'),'Connection recording');
  h.tick(2999);await settle();assert.equal(h.run('d.car.speed'),0);
  h.tick(3001);await settle();
  try {
    assert.ok(h.run('game.forwardBaseline'));
    assert.equal(h.run('d.car.maneuversLocked'),true);
    assert.equal(h.run('d.car.steeringLocked'),false,'ordinary calibration remains available');
    assert.match(h.node('roundTitle').textContent,/Three forward laps/);
    assert.equal(h.node('endRound').hidden,false);
    assert.equal(h.node('endRound').textContent,'Stop forward check');
    assert.equal(h.node('mode').disabled,true);
    assert.equal(h.run("sessionTrace().markers.some(m=>m.kind==='forward-baseline-start')"),true);
    assert.equal(h.run('sessionTrace().diagnostics.cars[0].forwardBaseline.physicalStopVerified'),false);
  } finally {h.node('endRound').click();}
  h.tick(3201);await settle(); // diagnostics render on the host's 150 ms cadence
  assert.equal(h.run('game.forwardBaseline'),null);assert.equal(h.run('d.car.speed'),0);
  assert.match(h.node('liveDiagnostics').textContent,/FORWARD CHECK.*confirm physical stop/);
});

test('STOP or a driver change during forward-check countdown cannot start the car later', async () => {
  for (const cancel of ['stop','driver']) {
    const h=host();h.node('addSim').click();await h.run('game.drivers[0].car.pumpPromise');
    h.run("const d=game.drivers[0];game.useTrack(world.track);game.setControl(d,'bot');game.stopAll();cards.get(d).forwardBaseline.click();");
    if(cancel==='stop')h.node('stop').click();
    else h.run("cards.get(d).control.value='browser';cards.get(d).control.onchange();");
    h.tick(4000);await settle();
    assert.equal(h.run('countdown'),null,cancel);
    assert.equal(h.run('game.forwardBaseline'),null,cancel);
    assert.equal(h.run('d.car.speed'),0,cancel);
  }
});

test('hiding the hardware host ends the forward check and retains its unverified result', async () => {
  const h=host();h.node('addSim').click();await h.run('game.drivers[0].car.pumpPromise');
  h.run("const d=game.drivers[0];game.useTrack(world.track);game.setControl(d,'bot');game.stopAll();cards.get(d).forwardBaseline.click();");
  h.tick(3001);await settle();
  h.run('d.car.simulated=false');h.visibility(true);h.tick(3041);await settle();
  assert.equal(h.run('game.forwardBaseline'),null);
  assert.equal(h.run('d.car.speed'),0);
  assert.equal(h.run('d.car.telemetry.forwardBaseline.active'),false);
  assert.equal(h.run('sessionTrace().diagnostics.cars[0].forwardBaseline.physicalStopVerified'),false);
});

test('host control selection cannot be overridden by an approved phone heartbeat', async () => {
  const h = host(); h.node('addSim').click();
  h.run(`const d = game.drivers[0]; game.setControl(d, 'phone');
    const p = {id: 1, approved: true, name: 'Driver', car: d.id}; players.set(1, p); seat(p);
    cards.get(d).control.value = 'none'; cards.get(d).control.onchange();
    onRelay({type: 'input', player: 1, throttle: 1}); readControls(.04); game.tick(.04);`);
  await settle();
  assert.equal(h.run('d.control'), 'none'); assert.equal(h.run('p.driver'), null);
  assert.equal(h.run('d.car.speed'), 0);
  h.run(`onRelay({type: 'input', player: 1, car: d.id, throttle: 1});`);
  assert.equal(h.run('d.control'), 'none', 'explicit phone seat request must also respect the host');
});

test('hiding a stationary real-car host latches STOP before subsequent phone input', async () => {
  const h = host(); h.node('addSim').click();
  h.run(`const d = game.drivers[0]; d.car.simulated = false; game.setControl(d, 'phone');
    const p = {id: 1, approved: true, name: 'Driver', car: d.id}; players.set(1, p); seat(p);`);
  h.visibility(true);
  assert.equal(h.run('game.halted'), true);
  h.run(`onRelay({type: 'input', player: 1, throttle: 1, uturn: true});`); h.tick(1000); await settle();
  assert.equal(h.run('d.car.speed'), 0); assert.equal(h.run('d.car.safetyReason'), 'Host stopped');
  h.node('resume').click(); assert.equal(h.run('game.halted'), true, 'hidden resume is refused');
});

test('round countdown keeps computer cars stopped until GO and STOP cancels countdown', async () => {
  const h = host(); h.node('addSim').click();
  h.run(`const d = game.drivers[0]; game.useTrack(world.track); game.setControl(d, 'bot'); beginRound();`);
  assert.equal(h.run('!!countdown'), true);
  for (const time of [40, 1000, 2000, 2999]) { h.tick(time); await settle(); assert.equal(h.run('d.car.speed'), 0); }
  assert.equal(h.run('session.status'), 'idle');
  h.tick(3001); h.tick(3041); await settle();
  assert.equal(h.run('session.status'), 'running'); assert.ok(h.run('d.car.speed') > 0);
  h.run(`halt('test'); beginRound();`); h.node('stop').click(); h.tick(7000); await settle();
  assert.equal(h.run('countdown'), null); assert.equal(h.run('d.car.speed'), 0);
});

test('off-track latch survives ordinary resume and blocks a fresh round', async () => {
  const h = host(); h.node('addSim').click();
  h.run(`const d = game.drivers[0]; game.useTrack(world.track); d.car.safetyStop('Off track'); game.stopAll();`);
  h.node('resume').click(); h.node('battle').click();
  assert.equal(h.run('d.car.safetyReason'), 'Off track'); assert.equal(h.run('countdown'), null);
  assert.match(h.node('roundHelp').textContent, /Recover/);
  h.run('held.add("KeyW")'); h.tick(100); await settle(); assert.equal(h.run('d.car.speed'), 0);
});


test('repeated STOP never resumes motion; recovery requires the distinct Resume action', async () => {
  const h = host(); h.node('addSim').click();
  h.run(`const d = game.drivers[0]; game.useTrack(world.track); game.setControl(d, 'bot');`);
  h.node('resume').click();h.tick(3000);h.tick(3040);await settle();assert.ok(h.run('d.car.speed') > 0);
  for (const time of [3080, 3120, 3160]) {
    h.node('stop').click(); h.tick(time); await settle();
    assert.equal(h.run('game.halted'), true); assert.equal(h.run('d.car.speed'), 0);
  }
  h.node('resume').click(); h.tick(3200);await settle();assert.equal(h.run('d.car.speed'),0);h.tick(6160);h.tick(6200);await settle();
  assert.equal(h.run('game.halted'), false); assert.ok(h.run('d.car.speed') > 0);
});

test('round deadline stops cars and displays stable finished results', async () => {
  const h = host(); h.node('addSim').click();
  h.run(`const d = game.drivers[0]; game.useTrack(world.track); game.setControl(d, 'bot'); beginRound();`);
  h.tick(3001); h.tick(3041); await settle(); assert.ok(h.run('d.car.speed') > 0);
  h.tick(93001); await settle();
  assert.equal(h.run('session.status'), 'finished'); assert.equal(h.run('session.reason'), 'time');
  assert.equal(h.run('game.halted'), true); assert.equal(h.run('d.car.speed'), 0);
  assert.equal(h.node('results').hidden, false); assert.match(h.node('resultTitle').textContent, /wrap/);
  const result = h.run('JSON.stringify(session.view())');
  h.tick(95000); await settle(); assert.equal(h.run('JSON.stringify(session.view())'), result);
  assert.equal(h.run('d.car.speed'), 0);
});

for (const carCount of [1, 2, 3, 4]) for (const mode of carCount === 1 ? ['solo', 'team'] : ['solo', 'team', 'race', 'battle']) {
  for (const drivers of mode === 'solo' ? ['mixed', 'human', 'cpu'] : ['mixed'])
  test(`${carCount}-car ${mode} ${drivers} round integrates driving, full-loop scoring and stopped finish`, async () => {
    const h = host();
    for (let i = 0; i < carCount; i++) h.node('addSim').click();
    h.run(`game.useTrack(world.track); game.topSpeed = 600;
      for (let i = 0; i < game.drivers.length; i++) game.setControl(game.drivers[i], ${drivers === 'cpu' ? "'bot'" : drivers === 'human' ? "'browser'" : "i % 2 ? 'bot' : 'browser'"});`);
    await settle();
    h.node('mode').value = mode; h.node('battle').click();
    assert.equal(h.run('!!countdown'), true);
    for (let t = 40; t < 3000; t += 40) { h.tick(t); await settle(); }
    assert.equal(h.run('game.drivers.every(d => d.car.speed === 0)'), true);
    h.tick(3000); await settle();
    assert.equal(h.run('session.status'), 'running');
    assert.equal(h.run('session.view().rows.length'), carCount);
    h.tick(3001); await settle(); // Observe neutral controls after GO before applying throttle.
    // Fresh human input is applied only after GO, through the actual browser
    // throttle handler. Other drivers use the real Bot and battle systems.
    h.run(`for (const d of game.drivers) if (d.control === 'browser') {
      cards.get(d).throttle.value = 85; cards.get(d).throttle.oninput();
    }`);
    for (let t = 3040; t <= 33000; t += 40) { h.tick(t); await settle(); }
    const rows = JSON.parse(h.run('JSON.stringify(session.view().rows)'));
    assert.ok(rows.reduce((sum, row) => sum + row.laps, 0) > 0, 'real simulator telemetry must produce completed circuits');
    const cpuCount = drivers === 'cpu' ? carCount : drivers === 'human' ? 0 : Math.floor(carCount / 2);
    assert.equal(rows.filter(row => row.computer).length, cpuCount);
    for (const row of rows) assert.ok(row.laps > 0, 'every driver must complete a scored circuit: ' + row.name);
    for (const row of rows) {
      assert.equal(row.score, mode === 'battle' ? row.hits * 100 + row.laps * 25 : row.laps * 100);
      if (row.laps) assert.ok(row.bestLapMs > 0);
    }
    // MVP rounds run every update through the full 90 seconds of simulated time.
    // Other modes retain their existing deadline check. No hardware timing claim.
    const deadline = 3000 + ROUND_MODES[mode].durationMs;
    if (mode === 'solo') for (let t = 33040; t < deadline; t += 40) { h.tick(t); await settle(); }
    h.tick(deadline); await settle();
    assert.equal(h.run('session.status'), 'finished');
    assert.equal(h.run('game.halted'), true);
    assert.equal(h.run('game.drivers.every(d => d.car.speed === 0)'), true);
    assert.equal(h.node('results').hidden, false);
    assert.equal(h.run('world.cars.every(c => c.targetSpeed === 0)'), true, 'STOP must reach every simulated transport');
  });
}

test('Free drive clears finished round state before sending the phone dashboard', async () => {
  const h = host(); h.node('addSim').click();
  h.run(`const d = game.drivers[0]; game.useTrack(world.track); game.setControl(d, 'phone');
    const p = {id: 1, approved: true, name: 'Driver', car: d.id}; players.set(1, p); seat(p);
    let dashboard = null; room = {link: {send(body) { dashboard = body; return Promise.resolve(); }}};
    beginRound();`);
  h.tick(3000); h.tick(93000); await settle();
  assert.equal(h.run('session.status'), 'finished'); assert.equal(h.run('dashboard.lobby.round.status'), 'finished');
  h.node('resume').click(); h.tick(94000); await settle();
  assert.equal(h.run('game.halted'), false); assert.equal(h.run('session.status'), 'idle');
  assert.equal(h.run('dashboard.lobby.round.status'), 'idle');
  assert.notEqual(h.run('dashboard.lobby.phase'), 'stopped');
  assert.equal(h.node('results').hidden, true);
});

test('shared pit pauses a round, preserves its clock and requires explicit clear after recovery', async () => {
  const h = host(); h.node('demo').click(); h.node('battle').click(); h.tick(3000); await settle();
  h.tick(4000); await settle();
  h.run(`for (const notify of game.drivers[0].sim.listeners) notify(Uint8Array.of(1, 0x2b));`);
  h.tick(4040); await settle();
  assert.equal(h.run('session.status'), 'paused');
  const remaining = h.run('session.view().remainingMs');
  assert.equal(h.run('game.drivers.every(d => d.car.speed === 0)'), true);
  h.node('pitResume').click(); assert.equal(h.run('game.halted'), true);
  h.run('cards.get(game.drivers[0]).recover.onclick()');
  h.tick(20000); await settle();
  assert.equal(h.run('session.view().remainingMs'), remaining);
  assert.equal(h.run('game.halted'), true);
  h.node('resume').click(); assert.equal(h.run('game.halted'), true);
  h.node('pitResume').click();
  assert.equal(h.run('game.halted'),true);h.tick(22999);assert.equal(h.run('game.halted'),true);h.tick(23000);
  assert.equal(h.run('session.status'), 'running');
  assert.equal(h.run('game.halted'), false);
  assert.equal(h.run('game.drivers[0].level'), 0);
  h.tick(23040); await settle();
  assert.equal(h.run('session.view().remainingMs'), remaining - 40);
});

for (const carCount of [1, 2, 3, 4]) test(`${carCount}-car precision gives purposeful CPUs points and stops at the deadline`, async () => {
  const h = host();
  for (let i = 0; i < carCount; i++) h.node('addSim').click();
  h.run(`game.useTrack(world.track); for (const d of game.drivers) {
    game.setControl(d, 'bot'); d.car.localizer.seed(d.sim.index, d.sim.direction, 0);
    d.car.localizer.progress = d.sim.progress; d.car.localizer.lateral = d.sim.lateral;
  }`);
  h.node('mode').value = 'precision'; h.node('battle').click(); h.tick(3000); await settle();
  for (let t = 3040; t <= 93000; t += 40) { h.tick(t); await settle(); }
  const rows = JSON.parse(h.run('JSON.stringify(session.view().rows)'));
  assert.ok(rows.every(r => r.score > 0), JSON.stringify(rows));
  assert.equal(h.run('game.halted'), true);
  assert.equal(h.run('world.cars.every(c => c.targetSpeed === 0)'), true);
});

test('four phone task dashboards fit the relay message limit', async () => {
  const h = host();
  for (let i = 0; i < 4; i++) h.node('addSim').click();
  h.run(`game.useTrack(world.track); for (const d of game.drivers) {
    game.setControl(d, 'phone'); const p = {id:d.id, name:'Driver', approved:true, car:d.id}; players.set(p.id,p); seat(p);
  } room = {link:{send: async value => { window.lastDashboard = value; }}};
  session.start('team', scoringSnapshot(0), 0, {mission:'dawn-patrol'}); pushState(game.snapshot(200), 200);`);
  const payload = JSON.parse(h.run('JSON.stringify(window.lastDashboard)'));
  assert.equal(Object.keys(payload.players).length, 4);
  assert.ok(Object.values(payload.players).every(p => p.task.includes('Scan')));
  assert.ok(Buffer.byteLength(JSON.stringify({t:'state', ...payload})) < 3500);
});


test('gamepad disconnect preserves the second controller slot and clears held weapons', () => {
  const h=host();h.node('addSim').click();h.node('addSim').click();
  h.run(`const a=game.drivers[0], b=game.drivers[1]; game.setControl(a,'gamepad');game.setControl(b,'gamepad');
    const makePad=()=>({connected:true,axes:[0],buttons:Array.from({length:8},()=>({value:0,pressed:false}))});
    const pa=makePad(), pb=makePad();let pads=[pa,pb];navigator.getGamepads=()=>pads;
    pa.buttons[0].pressed=pb.buttons[0].pressed=true;readControls(.04);pa.buttons[0].pressed=pb.buttons[0].pressed=false;readControls(.04);
    readControls(.04);pa.buttons[7].value=.8;pa.buttons[0].pressed=true;pb.buttons[7].value=.4;readControls(.04);`);
  assert.equal(h.run('a.input.throttle'),.8);assert.equal(h.run('b.input.throttle'),.4);
  h.run('pads=[null,pb];readControls(.04)');
  assert.equal(h.run('a.input.throttle'),0);assert.equal(h.run('a.input.attack'),false);
  assert.equal(h.run('b.input.throttle'),.4);
  h.run('pads=[pa,pb];readControls(.04)');assert.equal(h.run('a.input.throttle'),0);
  h.run('pa.buttons[7].value=0;pa.buttons[0].pressed=false;readControls(.04);pa.buttons[7].value=.6;readControls(.04)');
  assert.equal(h.run('a.input.throttle'),.6);
});

test('gamepad stops require neutral controls and do not shift other car slots', () => {
  const h=host();h.node('addSim').click();h.node('addSim').click();
  h.run(`const a=game.drivers[0],b=game.drivers[1];game.setControl(a,'gamepad');game.setControl(b,'gamepad');
    const pa={axes:[0],buttons:Array.from({length:8},()=>({value:0,pressed:false}))};
    const pb={axes:[0],buttons:Array.from({length:8},()=>({value:0,pressed:false}))};
    navigator.getGamepads=()=>[pa,pb];pa.buttons[0].pressed=pb.buttons[0].pressed=true;readControls(.04);pa.buttons[0].pressed=pb.buttons[0].pressed=false;readControls(.04);readControls(.04);pa.buttons[7].value=.7;pb.buttons[7].value=.3;readControls(.04);
    a.car.safetyReason='Off track';readControls(.04);`);
  assert.equal(h.run('b.input.throttle'),.3);assert.equal(h.run('a.input.throttle'),0);
  h.run('a.car.safetyReason=null;readControls(.04)');assert.equal(h.run('a.input.throttle'),0);
  h.run('pa.buttons[7].value=0;readControls(.04);pa.buttons[7].value=.7;readControls(.04)');assert.equal(h.run('a.input.throttle'),.7);
  h.run("game.setControl(a,'none');game.setControl(a,'gamepad');readControls(.04)");assert.equal(h.run('a.input.throttle'),0);
});

test('H1 host dead-man requires a fresh neutral phone packet before motion resumes', async () => {
  const h=host();h.node('addSim').click();
  h.run(`const d=game.drivers[0];game.setControl(d,'phone');const p={id:1,approved:true,name:'Phone',car:d.id};players.set(1,p);seat(p);
    onRelay({type:'input',player:1,throttle:0,steer:0});onRelay({type:'input',player:1,throttle:1});`);
  h.tick(40);await settle();assert.ok(h.run('d.car.speed')>0);
  h.tick(1100);await settle();assert.equal(h.run('d.car.speed'),0);
  h.run("onRelay({type:'input',player:1,throttle:1})");h.tick(1140);await settle();
  assert.equal(h.run('d.car.speed'),0,'latched non-neutral phone input must not rearm');
  h.run("onRelay({type:'input',player:1,throttle:0,steer:0});onRelay({type:'input',player:1,throttle:.5})");h.tick(1180);await settle();assert.ok(h.run('d.car.speed')>0);
});

test('H1 relay status changes disarm phone seats even with fresh cached throttle', async () => {
  const h=host();h.node('addSim').click();
  h.run(`const d=game.drivers[0];game.setControl(d,'phone');const p={id:1,approved:true,name:'Phone',car:d.id};players.set(1,p);seat(p);
    onRelay({type:'input',player:1,throttle:0});onRelay({type:'input',player:1,throttle:1});readControls(.04);game.tick(.04);
    relayStatus('offline');relayStatus('online');onRelay({type:'input',player:1,throttle:1});readControls(.04);game.tick(.04);`);
  await settle();assert.equal(h.run('d.car.speed'),0);assert.equal(h.run('d.armed'),false);
});

test('H3 selecting Computer never starts motion and releases dropdown focus', async () => {
  const h=host();h.node('addSim').click();
  h.run(`const d=game.drivers[0];game.useTrack(world.track);const control=cards.get(d).control;let blurred=false;control.blur=()=>{blurred=true};control.value='bot';control.onchange();`);
  h.tick(40);await settle();assert.equal(h.run('d.car.speed'),0);assert.equal(h.run('blurred'),true);
  h.node('battle').click();h.tick(1000);assert.equal(h.run('d.car.speed'),0);h.tick(3040);h.tick(3080);await settle();assert.ok(h.run('d.car.speed')>0);
});

test('H2 slow intersection missions are blocked without relaxing the default watchdog',()=>{const h=host();h.node('addSim').click();h.run("world.setLayout('Figure eight');game.useTrack(world.track);game.setControl(game.drivers[0],'bot');chooseExperience('story');beginRound();");assert.equal(h.run('countdown'),null);assert.match(h.node('roundHelp').textContent,/Slow intersection/);assert.equal(h.run('game.safety.trackGapMs'),2000);});

test('M1 leave and host revocation survive an online reconnect',()=>{for(const revoke of [false,true]){const h=host();h.node('addSim').click();h.run(`const d=game.drivers[0];game.setControl(d,'phone');const p={id:1,approved:true,name:'P',car:d.id};players.set(1,p);seat(p);${revoke?'releasePad(d,true)':"onRelay({type:'input',player:1,release:true})"};onRelay({type:'online',player:1});`);assert.equal(h.run('p.driver'),null);h.run("onRelay({type:'input',player:1,car:d.id,throttle:0})");assert.equal(h.run('p.driver === d'),true);}});

test('M2 gamepad identity survives an earlier driver leaving gamepad mode and blur disarms',()=>{const h=host();h.node('addSim').click();h.node('addSim').click();h.run(`const a=game.drivers[0],b=game.drivers[1];game.setControl(a,'gamepad');game.setControl(b,'gamepad');const make=(index)=>({index,id:'Pad '+index,mapping:'standard',axes:[0],buttons:Array.from({length:8},()=>({value:0,pressed:false}))});const pa=make(0),pb=make(1);navigator.getGamepads=()=>[pa,pb];pa.buttons[0].pressed=pb.buttons[0].pressed=true;readControls(.04);pa.buttons[0].pressed=pb.buttons[0].pressed=false;readControls(.04);readControls(.04);game.setControl(a,'none');readControls(.04);pa.buttons[7].value=.8;pb.buttons[7].value=.3;readControls(.04);`);assert.equal(h.run('b.input.throttle'),.3);h.event('blur');h.run('readControls(.04)');assert.equal(h.run('b.input.throttle'),0);});

test('M4 selected scan car waits through a countdown and other cars stay latched',async()=>{const h=host();h.node('addSim').click();h.node('addSim').click();h.run("game.setControl(game.drivers[0],'bot')");h.node('scanCar').value='2';h.node('scanClear').checked=true;h.node('scan').click();h.tick(40);await settle();assert.equal(h.run('game.drivers.every(d=>d.car.speed===0)'),true);h.tick(3000);await settle();assert.equal(h.run('game.scanner?.id'),2);assert.equal(h.run('game.drivers[0].car.speed'),0);assert.ok(h.run('game.drivers[1].car.speed')>0);});

test('H4 special Fast & Furious pieces cannot start a scored round',()=>{const h=host();h.node('addSim').click();h.run("world.setLayout('Grand circuit');game.useTrack(world.track);game.setControl(game.drivers[0],'browser');beginRound()");assert.equal(h.run('countdown'),null);assert.match(h.node('roundHelp').textContent,/special|unverified/i);});

for (const carCount of [1, 2, 3, 4]) for (const mode of carCount === 1 ? ['solo', 'team'] : ['solo', 'team', 'race', 'battle']) {
  for (const fault of ['silent telemetry', 'host-to-relay outage', 'late delocalized']) {
    test(`fault matrix: ${carCount}-car ${mode}, ${fault}`, async () => {
      const h = host({injectFaults: true});
      for (let i = 0; i < carCount; i++) h.node('addSim').click();
      h.run(`game.useTrack(world.track);
        for (let i = 0; i < game.drivers.length; i++) game.setControl(game.drivers[i], i % 2 ? 'bot' : 'browser');
        const d = game.drivers[0]; game.setControl(d, 'phone');
        const p = {id: 99, approved: true, name: 'Fault driver', car: d.id}; players.set(99, p); seat(p);
        const relay = new FaultRelay(onRelay, relayStatus);`);
      h.node('mode').value = mode; h.node('battle').click();
      for (let t = 40; t <= 3040; t += 40) { h.tick(t); await settle(); }
      assert.equal(h.run('session.status'), 'running');
      assert.equal(h.run('session.view().rows.length'), carCount);
      h.run(`relay.send({type:'input',player:99,throttle:0,steer:0});
        for (const d of game.drivers) if(d.control==='browser') {cards.get(d).throttle.value=60;cards.get(d).throttle.oninput();}`);
      for(let t=3080;t<=4040;t+=40){h.run(`relay.send({type:'input',player:99,throttle:.6});`);h.tick(t);await settle();}
      assert.ok(h.run('d.car.speed') > 0, 'fault starts with a commanded moving car');
      if (fault === 'silent telemetry') h.transports[0].silentTelemetry = true;
      if (fault === 'late delocalized') h.transports[0].lateDelocalized(4240);
      // Silent outage exercises the dead-man even when no status callback arrives.
      if (fault === 'host-to-relay outage') h.run(`relay.setOutage(true,{announce:false});`);
      for(let t=4080;t<=10040;t+=40){h.run(`relay.send({type:'input',player:99,throttle:.6});`);h.tick(t);await settle();}
      assert.equal(h.run('d.car.speed'), 0);
      if (fault === 'host-to-relay outage') {
        assert.equal(h.run('d.armed'), false);
        h.run(`relay.setOutage(false);relay.send({type:'input',player:99,throttle:.6});`);
        h.tick(10080);await settle();assert.equal(h.run('d.car.speed'),0,'reconnect cannot revive held throttle');
        h.run(`relay.send({type:'input',player:99,throttle:0,steer:0});relay.send({type:'input',player:99,throttle:.6});`);
        h.tick(10120);await settle();assert.ok(h.run('d.car.speed')>0,'fresh neutral permits intentional control');
      } else {
        assert.equal(h.run('game.halted'),true);
        assert.match(h.run('game.pitReason'),fault === 'silent telemetry' ? /telemetry/i : /left the track/i);
        assert.equal(h.run('game.drivers.every(d=>d.car.speed===0)'),true);
      }
    });
  }
}

test('M4 cancelling a scan latches STOP against subsequent input', async () => {
 const h=host();h.node('addSim').click();h.node('scanCar').value='1';h.node('scanClear').checked=true;h.node('scan').click();h.tick(3000);await settle();
 assert.ok(h.run('game.drivers[0].car.speed')>0);h.node('scan').click();
 assert.equal(h.run('game.halted'),true);h.tick(3040);await settle();assert.equal(h.run('game.drivers[0].car.speed'),0);
});

test('M2 an unmapped gamepad cannot arm through assumed standard buttons', () => {
 const h=host();h.node('addSim').click();
 h.run(`const d=game.drivers[0];game.setControl(d,'gamepad');
 const pad={index:0,id:'Unknown',mapping:'',axes:[0],buttons:Array.from({length:8},()=>({value:0,pressed:false}))};
 navigator.getGamepads=()=>[pad];pad.buttons[0].pressed=true;readControls(.04);pad.buttons[0].pressed=false;readControls(.04);pad.buttons[7].value=.8;readControls(.04);`);
 assert.equal(h.run('d.input.throttle'),0);assert.match(h.run('d.gamepadWarning'),/Non-standard/);
});

test('scan calibration needs explicit measurement confirmation, snapshots selection and clears it',async()=>{
 const h=host();h.node('addSim').click();h.node('scanCar').value='1';h.node('scanClear').checked=true;
 h.node('scanLateral').value='22.5';h.node('scan').click();assert.equal(h.run('countdown'),null);
 h.node('scanCalibrationConfirmed').checked=true;h.node('scan').click();
 assert.equal(h.run('countdown.startingLateral'),22.5);assert.equal(h.node('scanLateral').value,'');assert.equal(h.node('scanCalibrationConfirmed').checked,false);
 h.node('scanLateral').value='-22.5';h.tick(3000);await settle();assert.equal(h.run('game.scanner.car.startingCalibration.lateral'),22.5);
});
test('live diagnostic export includes observations and scan evidence while recording continues',async()=>{
 const h=host();h.node('addSim').click();h.node('scanCar').value='1';h.node('scanClear').checked=true;h.node('operatorNotes').value='Car stayed on track';
 h.node('scan').click();h.tick(3000);await settle();
 const x=h.run('sessionTrace()');assert.equal(x.diagnostics.operatorNotes,'Car stayed on track');assert.equal(x.diagnostics.schema,'slipstream-diagnostics-v1');
 assert.ok(x.markers.some(m=>m.kind==='scan-start'));assert.equal(h.run('recorder.active'),true);assert.equal(h.node('saveTrace').disabled,false);
 assert.match(h.node('liveDiagnostics').textContent,/Requested/);
});

for (const advancingClock of [false,true]) test(`default two-car demo scores both CPU drivers (advancing clock: ${advancingClock})`,async()=>{
  const h=host({advancingClock});h.node('demo').click();
  h.run("for(const d of game.drivers) game.setControl(d,'bot')");
  await settle();h.node('mode').value='race';h.node('battle').click();
  for(let t=40;t<=123120;t+=40){h.tick(t);await settle();}
  const rows=JSON.parse(h.run('JSON.stringify(session.view().rows)'));
  assert.equal(rows.length,2);
  assert.equal(h.node('scoreCol').textContent,'Best lap');
  assert.equal(h.node('detailCol').textContent,'Last lap');
  assert.ok(rows.every(row=>row.laps>0),JSON.stringify(rows));
  assert.equal(h.run('session.status'),'finished');
  assert.equal(h.run('world.cars.every(car=>car.targetSpeed===0)'),true);
});

test('host displays and exports map checks without claiming physical validation',()=>{
 const h=host();h.node('demo').click();
 assert.match(h.node('liveDiagnostics').textContent,/Map checks:/);
 assert.equal(h.run('sessionTrace().diagnostics.trackChecks.physicalValidation'),false);
 assert.equal(h.run('sessionTrace().diagnostics.trackChecks.available'),true);
});

test('supervised cancellation comparison uses a countdown and exposes forward-driving steering lock',async()=>{
 const h=host();h.node('addSim').click();await h.run('game.drivers[0].car.pumpPromise');
 h.run("game.useTrack(world.track);game.setControl(game.drivers[0],'bot');game.stopAll();game.topSpeed=300;refresh();");
 h.run('cards.get(game.drivers[0]).cancellationComparison.click()');
 assert.equal(h.run('countdown.kind'),'lane-cancellation-comparison');
 assert.equal(h.run('game.laneCancellationComparison'),null);assert.equal(h.run('game.drivers[0].car.speed'),0);
 h.tick(2999);assert.equal(h.run('game.drivers[0].car.speed'),0);
 h.tick(3001);await h.run('game.drivers[0].car.pumpPromise');
 assert.ok(h.run('game.laneCancellationComparison'));assert.match(h.node('roundTitle').textContent,/cancellation comparison/);
 // Rendering fixture only; actual cancellation/lock semantics have separate core tests.
 h.run("game.laneCancellationComparison.stage='driving';game.laneCancellationComparison.cancelled=true;game.drivers[0].car.lockSteering('Comparison cancellation');renderRound();");
 assert.match(h.node('roundLabel').textContent,/CAR STILL DRIVING/);
 assert.match(h.node('roundGoal').textContent,/No further steering/);
 assert.equal(h.node('endRound').hidden,false);assert.equal(h.node('endRound').textContent,'Stop comparison');
 h.node('stop').click();assert.equal(h.run('game.laneCancellationComparison'),null);assert.equal(h.run('game.drivers[0].car.speed'),0);
});

test('STOP during cancellation-comparison countdown prevents later motion and comparison activation',async()=>{
 const h=host();h.node('addSim').click();await h.run('game.drivers[0].car.pumpPromise');
 h.run("game.useTrack(world.track);game.setControl(game.drivers[0],'bot');game.stopAll();refresh();cards.get(game.drivers[0]).cancellationComparison.click();");
 h.node('stop').click();h.tick(4000);
 assert.equal(h.run('countdown'),null);assert.equal(h.run('game.laneCancellationComparison'),null);
 assert.equal(h.run('game.drivers[0].car.speed'),0);assert.equal(h.run('game.drivers[0].cpuArmed'),false);
});

test('host shows unknown locations explicitly and exports the full map with optical reference evidence',()=>{
 const h=host();h.node('addSim').click();
 h.run("const d=game.drivers[0];game.useTrack(world.track);refresh();");
 assert.match(h.node('mapPositionStatus').textContent,/Position unknown/);
 assert.match(h.run('cards.get(d).locationReference.textContent'),/No optical reference/);
 h.run("d.car.localizer.feed({type:'position',pieceId:34,locationId:20,reverse:false,speed:300},performance.now());refresh();");
 assert.match(h.run('cards.get(d).locationReference.textContent'),/Optical reference: piece 34 \/ code 20/);
 assert.match(h.node('mapPositionStatus').textContent,/estimates from recent optical codes/);
 assert.equal(h.run('sessionTrace().diagnostics.cars[0].localization.reference.source'),'printed-code');
 assert.deepEqual(JSON.parse(h.run('JSON.stringify(sessionTrace().diagnostics.track)')),JSON.parse(h.run('JSON.stringify(game.track.toJSON())')));
 h.run("d.car.localizer.feed({type:'status',onTrack:false},performance.now());refresh();");
 assert.match(h.run('cards.get(d).locationReference.textContent'),/Position unknown.*off track.*marker hidden/);
 assert.equal(h.run('sessionTrace().diagnostics.cars[0].localization.trusted'),false);
 assert.match(h.node('mapPositionStatus').textContent,/Unconfirmed map markers are hidden/);
});


function connectionRadio() {
  let notify;const radio={id:'host-connection-test',name:'Test car',sent:[],async open(){},onClose(){},close(){},
    onNotify(fn){notify=fn;return()=>{};},async write(packet){radio.sent.push([...packet]);
      if(packet[1]===0x16)queueMicrotask(()=>notify(Uint8Array.of(1,0x17)));
      if(packet[1]===0x18)queueMicrotask(()=>notify(Uint8Array.of(5,0x19,0x5a,0x2e,0,0)));
      if(packet[1]===0x45)queueMicrotask(()=>notify(Uint8Array.of(3,0x23,0,0)));
    }};return radio;
}

test('kit connection selects explicit SDK plastic comparison without changing ordinary SDK or F&F profiles',async()=>{
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
  assert.match(html,/<option value="sdk-plastic">Classic SDK · plastic-track comparison<\/option>/);
  for(const kit of ['sdk','sdk-plastic','fast-furious']) {
    const radio=connectionRadio(),h=host({bluetoothLink:radio});h.node('kit').value=kit;h.node('kit').onchange();
    assert.equal(h.node('kitNote').hidden,false);
    h.run("recorder.start([],'Existing connection recording');recorder.mark('retained-evidence');");
    await h.node('connect').click();await h.run('game.drivers[0].car.pumpPromise');h.run('refresh()');
    assert.equal(radio.initializationProfile,kit==='fast-furious'?'fast-furious':'sdk');
    assert.deepEqual(JSON.parse(JSON.stringify(radio.initializationOptions)),kit==='sdk-plastic'?{plasticTrack:true}:{});
    assert.equal(h.run('game.drivers[0].car.initializing'),false);assert.equal(h.run('game.drivers[0].car.speed'),0);
    assert.equal(h.run('countdown'),null);assert.equal(h.run('game.forwardBaseline'),null);
    assert.equal(radio.sent.some(p=>p[1]===0x24 && (p[2]||p[3])),false,'connection cannot request forward speed');
    assert.equal(h.run('recorder.note'),'Existing connection recording');assert.equal(h.run("recorder.markers.some(m=>m.kind==='retained-evidence')"),true);
    assert.equal(h.run("recorder.markers.find(m=>m.kind==='connection-options').details.sdkPlasticTrackRequested"),kit==='sdk-plastic');
    assert.equal(h.run('sessionTrace().diagnostics.build'),'2026-11-18-diagnostic-outcomes');
    if(kit==='sdk-plastic') {
      const diagnostics=JSON.parse(h.run('JSON.stringify(sessionTrace().diagnostics.cars[0].sdkPlasticTrack)'));
      assert.deepEqual(diagnostics,{requested:true,sequenceComplete:true,firmwareApplied:null});
      assert.match(h.node('liveDiagnostics').textContent,/Plastic-track comparison: requested plastic parser and disabled jump boosts; initialization sequence complete; firmware application unconfirmed/);
    } else assert.doesNotMatch(h.node('liveDiagnostics').textContent,/Plastic-track comparison:/);
    if(kit==='sdk') {
      assert.equal(radio.sent.some(p=>p[1]===0x45),false,'ordinary SDK has no new config command');
      const before=radio.sent.length;h.node('kit').value='sdk-plastic';h.node('kit').onchange();
      assert.equal(radio.sent.length,before,'changing the selector cannot reconfigure a connected car');
      assert.deepEqual(JSON.parse(JSON.stringify(radio.initializationOptions)),{});
    }
    await h.run('game.removeCar(game.drivers[0])');
  }
});


test('connection captures the explicit kit before asynchronous Bluetooth pairing',async()=>{
  const radio=connectionRadio();let release;
  radio.open=()=>new Promise(resolve=>{release=resolve;});
  const h=host({bluetoothLink:radio});h.node('kit').value='sdk-plastic';h.node('kit').onchange();
  const connecting=h.node('connect').click();await settle();assert.ok(release);
  h.node('kit').value='sdk';h.node('kit').onchange();release();await connecting;
  await h.run('game.drivers[0].car.pumpPromise');
  assert.equal(radio.initializationProfile,'sdk');assert.deepEqual(JSON.parse(JSON.stringify(radio.initializationOptions)),{plasticTrack:true});
  assert.equal(h.run("recorder.markers.find(m=>m.kind==='connection-options').details.sdkPlasticTrackRequested"),true);
  assert.equal(h.run('game.drivers[0].car.speed'),0);
  await h.run('game.removeCar(game.drivers[0])');
});

test('scan validation and connected profile are visible without opening the session log',async()=>{
  const radio=connectionRadio(),h=host({bluetoothLink:radio});h.node('kit').value='fast-furious';
  await h.node('connect').click();h.node('scanCar').value='1';h.node('scan').click();
  assert.equal(h.node('scanStatus').hidden,false);
  assert.match(h.node('scanStatus').textContent,/Scan not started.*Confirm the track is clear/);
  assert.match(h.node('scanStatus').textContent,/Fast & Furious.*experimental/);
  const labels=h.run("cards.get(game.drivers[0]).card.children.flatMap(n=>n.children??[]).filter(n=>n.tagName==='LABEL').map(n=>n.textContent)");
  assert.ok(labels.includes('Car model'));assert.ok(labels.includes('Who drives'));
  assert.match(h.run('cards.get(game.drivers[0]).connection.textContent'),/Fast & Furious.*experimental/);
  h.node('kit').value='sdk';h.node('kit').onchange();
  assert.match(h.run('cards.get(game.drivers[0]).connection.textContent'),/Fast & Furious/,'selector cannot relabel an existing connection');
  assert.match(h.node('kitNote').textContent,/next Connect car.*Car model/);
  assert.equal(h.run('countdown'),null);assert.equal(radio.sent.some(p=>p[1]===0x24&&(p[2]||p[3])),false);
  await h.run('game.removeCar(game.drivers[0])');
});

test('scan timeout stays visible and retry requires recovery, stopped pit clear and a new countdown',async()=>{
  const radio=connectionRadio(),h=host({bluetoothLink:radio});h.node('kit').value='fast-furious';
  await h.node('connect').click();h.node('scanCar').value='1';h.node('scanClear').checked=true;h.node('scan').click();
  assert.match(h.node('scanStatus').textContent,/Scan countdown/);h.tick(3001);await settle();
  assert.match(h.node('scanStatus').textContent,/Scanning.*No optical position codes/);
  h.tick(8201);await settle();assert.match(h.run('game.pitReason'),/Telemetry timeout/);
  assert.match(h.node('scanStatus').textContent,/Scan stopped.*Telemetry timeout/);
  assert.match(h.node('scanStatus').textContent,/0 optical positions.*0 transitions/);
  h.node('scan').click();assert.match(h.node('scanStatus').textContent,/Recover.*Clear pit/);
  const positiveCount=()=>radio.sent.filter(p=>p[1]===0x24&&(p[2]||p[3])).length;
  const before=positiveCount();h.node('pitClearStopped').click();assert.ok(h.run('game.pitReason'),'unrecovered latch cannot be cleared');
  h.run('cards.get(game.drivers[0]).recover.click()');assert.equal(h.run('game.pitReady'),true);
  h.node('pitClearStopped').click();h.tick(8500);await settle();
  assert.equal(h.run('game.pitReason'),null);assert.equal(h.run('game.halted'),true);assert.equal(h.run('countdown'),null);
  assert.equal(h.run('game.drivers[0].cpuArmed'),false);assert.equal(positiveCount(),before);
  assert.match(h.node('scanStatus').textContent,/remain stopped.*Scan track/);
  h.node('scanClear').checked=true;h.node('scan').click();h.tick(11499);await settle();assert.equal(positiveCount(),before);
  h.tick(11501);await settle();assert.equal(positiveCount(),before+1);h.node('stop').click();
  await h.run('game.removeCar(game.drivers[0])');
});

test('stopped pit clearing never rearms mapped computer cars or resumes a paused round',async()=>{
  const h=host();h.node('demo').click();h.node('battle').click();h.tick(3001);await settle();
  h.run("game.requestPit(game.drivers[0],'Telemetry timeout')");h.tick(3041);await settle();assert.equal(h.run('session.status'),'paused');
  h.run('cards.get(game.drivers[0]).recover.click()');h.node('pitClearStopped').click();
  h.tick(7000);await settle();assert.equal(h.run('game.pitReason'),null);assert.equal(h.run('game.halted'),true);
  assert.equal(h.run('session.status'),'idle');assert.equal(h.run('game.drivers.every(d=>d.car.speed===0&&!d.cpuArmed&&!d.armed)'),true);
});

test('scan status distinguishes cancelled countdown, start failure and an explicit scan cancellation',async()=>{
  const h=host();h.node('addSim').click();await settle();h.node('scanCar').value='1';
  h.node('scanClear').checked=true;h.node('scan').click();h.node('stop').click();
  assert.match(h.node('scanStatus').textContent,/Scan stopped.*Host stopped/);assert.equal(h.run('countdown'),null);
  h.node('scanClear').checked=true;h.node('scan').click();h.run('game.drivers[0].car.connected=false');h.tick(3001);
  assert.match(h.node('scanStatus').textContent,/Selected scanner is unavailable/);
  h.run('game.drivers[0].car.connected=true');h.node('scanClear').checked=true;h.node('scan').click();h.tick(6002);await settle();
  assert.equal(h.run('game.phase'),'scanning');h.node('scan').click();
  assert.match(h.node('scanStatus').textContent,/Scan stopped.*Scan cancelled/);assert.equal(h.run('game.halted'),true);
});

test('explicit kit choice survives reload, rejects unknown stored values and does not reconfigure a connected car',async()=>{
  const stored={},radio=connectionRadio(),h=host({stored,bluetoothLink:radio});
  h.node('kit').value='sdk';h.node('kit').onchange();await h.node('connect').click();
  const before=radio.sent.length;
  h.node('kit').value='sdk-plastic';h.node('kit').onchange();
  assert.equal(radio.initializationProfile,'sdk');assert.deepEqual(JSON.parse(JSON.stringify(radio.initializationOptions)),{});
  assert.equal(radio.sent.length,before);
  const reloaded=host({stored});assert.equal(reloaded.node('kit').value,'sdk-plastic');
  stored['slipstream.kit.v1']='unrecognized-profile';assert.notEqual(host({stored}).node('kit').value,'unrecognized-profile');
  const throwing=new Proxy({}, {get(){throw new Error('Storage unavailable');},set(){throw new Error('Storage unavailable');}});
  const noStorage=host({stored:throwing});noStorage.node('kit').value='sdk';assert.doesNotThrow(()=>noStorage.node('kit').onchange());
  await h.run('game.removeCar(game.drivers[0])');
});

test('scan status reports a complete simulated map and retains only that attempt’s received-code counts',async()=>{
  const h=host();h.node('addSim').click();await settle();
  h.run('game.drivers[0].car.telemetry.positions=12;game.drivers[0].car.telemetry.transitions=7');
  h.node('scanCar').value='1';h.node('scanClear').checked=true;h.node('scan').click();h.tick(3001);await settle();
  assert.match(h.node('scanStatus').textContent,/0 optical positions.*0 transitions/,'previous telemetry is not acquisition evidence');
  for(let now=3041;now<40000&&h.run("game.phase==='scanning'");now+=40){h.tick(now);await settle();}
  h.run('refresh()');
  assert.ok(h.run('game.track?.closed'));assert.equal(h.run('game.halted'),true);
  assert.match(h.node('scanStatus').textContent,/Scan mapped \d+ pieces.*STOP requested; confirm the physical stop and map/);
  assert.equal(h.run('scanAttempt.positions'),h.run('game.drivers[0].car.telemetry.positions-12'));
  assert.equal(h.run('scanAttempt.transitions'),h.run('game.drivers[0].car.telemetry.transitions-7'));
  const result=h.node('scanStatus').textContent;
  h.run('game.drivers[0].car.telemetry.positions++;refresh()');assert.equal(h.node('scanStatus').textContent,result,'late telemetry does not revise a completed scan');
});

for(const [side,direction] of [['left',1],['right',-1]])test('host '+side+'-lane diagnostic preserves selected car, direction and three-second countdown',async()=>{
  const h=host();h.node('addSim').click();h.node('addSim').click();await settle();
  h.run("game.useTrack(world.track);game.stopAll();recorder.start(game.drivers,'Directional host test');const diagnosticCalls=[];const testDiagnosticStart=game.startDiagnostic.bind(game);game.startDiagnostic=(d,options)=>{diagnosticCalls.push({id:d.id,...options});return testDiagnosticStart(d,options);}");
  h.run("cards.get(game.drivers[1]).card.children.find(n=>n.textContent==='Clear track · one "+side+"-lane test').click()");
  assert.equal(h.run('countdown.direction'),direction);assert.equal(h.run('countdown.driverId'),2);
  assert.equal(h.run('game.drivers.every(d=>d.car.speed===0)'),true);
  assert.match(h.node('roundTitle').textContent,new RegExp('One '+side+'-lane test'));
  assert.match(h.node('roundGoal').textContent,new RegExp('One '+side+' request only after a fresh readable straight code'));
  assert.equal(h.run("recorder.markers.find(m=>m.kind==='diagnostic-request').details.direction"),direction);
  assert.equal(h.run('diagnosticCalls.length'),0);h.tick(2999);await settle();assert.equal(h.run('diagnosticCalls.length'),0);
  h.tick(3001);await settle();
  try {
    assert.deepEqual(JSON.parse(h.run('JSON.stringify(diagnosticCalls)')),[{id:2,steering:true,direction}]);
    assert.equal(h.run('game.diagnostic.driver.id'),2);assert.equal(h.run('game.diagnostic.direction'),direction);
    assert.equal(h.run('game.drivers[0].car.speed'),0);assert.equal(h.run('game.drivers[1].car.speed'),300);
    h.tick(3200);await settle();assert.match(h.node('roundTitle').textContent,new RegExp('One '+side+'-lane test'));
  }finally{h.node('stop').click();}
});

test('STOP cancels a right-lane diagnostic countdown without invoking a driver',async()=>{
  const h=host();h.node('addSim').click();await settle();h.run('game.useTrack(world.track);game.stopAll();');
  h.run("cards.get(game.drivers[0]).card.children.find(n=>n.textContent==='Clear track · one right-lane test').click()");
  h.node('stop').click();h.tick(4000);await settle();
  assert.equal(h.run('countdown'),null);assert.equal(h.run('game.diagnostic'),null);
  assert.equal(h.run('game.drivers[0].car.speed'),0);assert.equal(h.run('game.halted'),true);
});
