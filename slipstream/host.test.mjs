import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {Game} from './game.mjs';
import {trackFromPlan} from './track.mjs';
import {SimWorld, LAYOUTS} from './sim.mjs';
import {Recorder} from './trace.mjs';
import {WEAPON_LABEL} from './battle.mjs';
import {RoundSession, ROUND_MODES, STORY_MISSIONS} from './session.mjs';

// Execute the actual host handlers and loop with DOM stubs and the simulated
// transport. These verify control logic, not browser rendering or real hardware.
function host() {
  const nodes = new Map(), documentEvents = {}, windowEvents = {}, intervals = [];
  let now = 0;
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
  const storage = {getItem() { return null; }, setItem() {}, removeItem() {}};
  const document = {hidden: false, getElementById: node, createElement: element, querySelectorAll() { return []; },
    addEventListener(name, fn) { (documentEvents[name] ??= []).push(fn); }};
  const fixtures = Object.fromEntries(['pieces', 'vehicles', 'weapons'].map(n => [n, JSON.parse(readFileSync(new URL('./data/' + n + '.json', import.meta.url)))]));
  const context = vm.createContext({console, Date, URL, Blob, trackFromPlan, Game: class extends Game { constructor(options) { super({...options, clock: () => now}); } }, SimWorld, LAYOUTS, Recorder, WEAPON_LABEL, RoundSession, ROUND_MODES, STORY_MISSIONS,
    fixtures, document, window: {}, navigator: {}, sessionStorage: storage, localStorage: storage,
    performance: {now: () => now}, location: {origin: 'http://localhost', host: 'localhost'},
    Option: function(text, value) { return {textContent: text, value}; },
    Renderer: class {draw() {} addEffect() {}}, bluetoothAvailable: () => false,
    api: async () => ({}), channel: () => ({send: async () => {}, stop() {}}),
    setTimeout() {}, setInterval(fn) { intervals.push(fn); }, requestAnimationFrame() {},
    addEventListener(name, fn) { (windowEvents[name] ??= []).push(fn); }
  });
  const source = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '')
    .replace("await Promise.all([load('pieces'), load('vehicles'), load('weapons')])", '[fixtures.pieces, fixtures.vehicles, fixtures.weapons]');
  vm.runInContext(source, context);
  return {run: code => vm.runInContext(code, context), node, document,
    tick(time) { now = time; for (const fn of intervals) fn(); },
    visibility(hidden) { document.hidden = hidden; for (const fn of documentEvents.visibilitychange ?? []) fn(); },
    event(name, value = {}) { for (const fn of windowEvents[name] ?? []) fn(value); }};
}
const settle = () => new Promise(resolve => setImmediate(resolve));

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
  h.tick(40); await settle(); assert.ok(h.run('d.car.speed') > 0);
  for (const time of [80, 120, 160]) {
    h.node('stop').click(); h.tick(time); await settle();
    assert.equal(h.run('game.halted'), true); assert.equal(h.run('d.car.speed'), 0);
  }
  h.node('resume').click(); h.tick(200); await settle();
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
  test(`${carCount}-car ${mode} round integrates human/CPU driving, full-loop scoring and stopped finish`, async () => {
    const h = host();
    for (let i = 0; i < carCount; i++) h.node('addSim').click();
    h.run(`game.useTrack(world.track); game.topSpeed = 600;
      for (let i = 0; i < game.drivers.length; i++) game.setControl(game.drivers[i], i % 2 ? 'bot' : 'browser');`);
    await settle();
    h.node('mode').value = mode; h.node('battle').click();
    assert.equal(h.run('!!countdown'), true);
    for (let t = 40; t < 3000; t += 40) { h.tick(t); await settle(); }
    assert.equal(h.run('game.drivers.every(d => d.car.speed === 0)'), true);
    h.tick(3000); await settle();
    assert.equal(h.run('session.status'), 'running');
    assert.equal(h.run('session.view().rows.length'), carCount);
    // Fresh human input is applied only after GO, through the actual browser
    // throttle handler. Other drivers use the real Bot and battle systems.
    h.run(`for (const d of game.drivers) if (d.control === 'browser') {
      cards.get(d).throttle.value = 85; cards.get(d).throttle.oninput();
    }`);
    for (let t = 3040; t <= 33000; t += 40) { h.tick(t); await settle(); }
    const rows = JSON.parse(h.run('JSON.stringify(session.view().rows)'));
    assert.ok(rows.reduce((sum, row) => sum + row.laps, 0) > 0, 'real simulator telemetry must produce completed circuits');
    assert.ok(rows.find(row => !row.computer).laps > 0, 'human input must complete a scored circuit');
    assert.equal(rows.filter(row => row.computer).length, Math.floor(carCount / 2));
    for (const row of rows) {
      assert.equal(row.score, mode === 'battle' ? row.hits * 100 + row.laps * 25 : row.laps * 100);
      if (row.laps) assert.ok(row.bestLapMs > 0);
    }
    // Reach the real configured deadline without waiting in wall-clock time.
    h.tick(3000 + ROUND_MODES[mode].durationMs); await settle();
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
  assert.equal(h.run('session.status'), 'running');
  assert.equal(h.run('game.halted'), false);
  assert.equal(h.run('game.drivers[0].level'), 0);
  h.tick(20040); await settle();
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
    navigator.getGamepads=()=>[pa,pb];readControls(.04);pa.buttons[7].value=.7;pb.buttons[7].value=.3;readControls(.04);
    a.car.safetyReason='Off track';readControls(.04);`);
  assert.equal(h.run('b.input.throttle'),.3);assert.equal(h.run('a.input.throttle'),0);
  h.run('a.car.safetyReason=null;readControls(.04)');assert.equal(h.run('a.input.throttle'),0);
  h.run('pa.buttons[7].value=0;readControls(.04);pa.buttons[7].value=.7;readControls(.04)');assert.equal(h.run('a.input.throttle'),.7);
  h.run("game.setControl(a,'none');game.setControl(a,'gamepad');readControls(.04)");assert.equal(h.run('a.input.throttle'),0);
});
