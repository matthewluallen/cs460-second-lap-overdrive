// Host page: owns the Bluetooth links, runs the game loop, draws the map and
// relays phone players. Nothing here trusts text from a car or a phone as HTML.
import {Game} from './game.mjs';
import {trackFromPlan} from './track.mjs';
import {SimWorld, LAYOUTS} from './sim.mjs';
import {chooseCar, bluetoothAvailable} from './ble.mjs';
import {Renderer} from './render.mjs';
import {WEAPON_LABEL} from './battle.mjs';
import {api, channel} from './net.mjs';
import {Recorder} from './trace.mjs';
import {RoundSession, ROUND_MODES, STORY_MISSIONS} from './session.mjs';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
const load = name => fetch('data/' + name + '.json', {cache: 'no-store'}).then(r => { if (!r.ok) throw new Error('Could not load ' + name); return r.json(); });
const SAVED = 'slipstream.track.v1';

const [pieces, vehicles, weapons] = await Promise.all([load('pieces'), load('vehicles'), load('weapons')]);
const game = new Game({pieces, vehicles, weapons, log});
game.topSpeed = 400;
const world = new SimWorld(game.pieces, 'Capsule');
const mapRenderer = new Renderer($('map'));
let renderer = mapRenderer, studioRenderer = null, studioLoading = false, requestedView = '2d';
const recorder = new Recorder();
const session = new RoundSession();
let countdown = null, sessionResultShown = false;
let activeMission = null, activeExperience = 'arcade', recordEligible = true;
window.slipstream = {game, world, recorder, get transport() { return room?.link.transport ?? null; }};                        // for the browser console and tests

function log(text) {
  const list = $('log');
  list.prepend(el('li', {textContent: new Date().toLocaleTimeString() + '  ' + text}));
  while (list.children.length > 60) list.lastChild.remove();
}

// --- garage --------------------------------------------------------------------
const cards = new Map();           // driver -> DOM refs
const CONTROLS = [['none', 'Parked'], ['browser', 'On-screen controls'], ['keys1', 'Keyboard W A S D'], ['keys2', 'Keyboard arrows'], ['gamepad', 'Gamepad'], ['phone', 'Phone or link'], ['bot', 'Computer']];
const MODELS = Object.entries(vehicles.models).filter(([, m]) => !['Future', 'Unrecognized'].includes(m.name)).sort((a, b) => a[1].name.localeCompare(b[1].name));

function addCard(driver) {
  const model = el('select', {title: 'Car model'}), control = el('select', {title: 'Who drives'});
  for (const [id, m] of MODELS) model.append(new Option(m.name + (m.truck ? ' (truck)' : ''), id));
  for (const [id, label] of CONTROLS) control.append(new Option(label, id));
  model.value = String(driver.car.model); control.value = driver.control;
  const crew = el('select', {title: 'Battle crew'});
  crew.setAttribute('aria-label', 'Battle alliance');
  for (const [id, label] of [['', 'Independent racer'], ['sun', 'Sun crew'], ['moon', 'Moon crew']]) crew.append(new Option(label, id));
  crew.onchange = () => { if (session.status === 'running' || session.status === 'paused' || countdown) halt('Crew changed'); game.setCrew(driver, crew.value); refresh(); };
  const task = el('p', {className: 'driver-task', hidden: true});
  const name = el('span', {className: 'name', textContent: driver.id + ' · ' + driver.car.name});
  const tag = el('span', {className: 'tag', textContent: driver.car.simulated ? 'sim' : 'live'});
  const remove = el('button', {className: 'small', textContent: '✕', title: 'Disconnect'});
  const code = el('button', {className: 'small', textContent: 'Code', title: 'Show this car\'s own join code'});
  const seatCanvas = el('canvas', {width: 164, height: 164, className: 'seatqr'});
  const seatLink = el('input', {readOnly: true, className: 'seatlink'});
  const seatBox = el('div', {className: 'seat', hidden: true}, seatCanvas, el('p', {className: 'note', textContent: 'Scan to drive this car from a phone, or open the link on a laptop.'}), seatLink);
  const energy = el('i'), speed = el('i');
  const recover = el('button', {className: 'recovery', textContent: 'Car back on track · Recover', hidden: true});
  recover.onclick = () => { if (document.hidden) return; game.recoverCar(driver); driver.level = 0; if (driver.pad) driver.pad.throttle = 0; refresh(); };
  const throttle = el('input', {type: 'range', min: 0, max: 100, value: 0, step: 5});
  throttle.setAttribute('aria-label', driver.car.name + ' throttle');
  throttle.oninput = () => { if (driver.control === 'browser' && !game.halted && !driver.car.safetyReason) driver.level = Number(throttle.value) / 100; else throttle.value = 0; };
  const leftButton = el('button', {textContent: '← Lane', title: 'Move one lane left'}), rightButton = el('button', {textContent: 'Lane →', title: 'Move one lane right'});
  leftButton.onclick = () => { if (!game.halted && !driver.car.safetyReason) game.nudge(driver, 1); };
  rightButton.onclick = () => { if (!game.halted && !driver.car.safetyReason) game.nudge(driver, -1); };
  const brake = el('button', {textContent: 'Brake', className: 'brake'});
  brake.onclick = () => { driver.level = 0; driver.input.throttle = 0; throttle.value = 0; driver.car.stop(); };
  const browserControls = el('div', {className: 'browser-controls', hidden: true}, el('label', {textContent: 'Throttle'}, throttle), el('div', {className: 'row'}, leftButton, brake, rightButton));
  const fireRow = el('div', {className: 'row'});
  for (const bay of ['attack', 'support', 'special']) {
    const fire = el('button', {textContent: bay === 'attack' ? 'Fire' : bay === 'support' ? 'Support' : 'Special'});
    fire.onpointerdown = event => { fire.setPointerCapture(event.pointerId); if (!game.halted) driver.input[bay] = true; };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) fire.addEventListener(type, () => { driver.input[bay] = false; });
    fire.onkeydown = event => { if (event.code === 'Space' || event.code === 'Enter') { event.preventDefault(); if (!game.halted) driver.input[bay] = true; } };
    fire.onkeyup = fire.onblur = () => { driver.input[bay] = false; };
    fireRow.append(fire);
  }
  browserControls.append(fireRow);
  const left = el('span'), right = el('span'), weaponsBox = el('div', {className: 'weapons'});
  const card = el('div', {className: 'car'},
    el('div', {className: 'top'}, name, tag, code, remove),
    el('div', {className: 'grid'}, model, control), el('label', {className: 'field', textContent: 'Battle alliance'}, crew),
    el('div', {className: 'bar'}, energy), el('div', {className: 'bar speed'}, speed),
    el('div', {className: 'meta'}, left, right), weaponsBox, recover, task, browserControls, seatBox);
  code.onclick = async () => {
    if (!seatBox.hidden) { seatBox.hidden = true; return; }
    try {
      await openRoom();
      const seat = await api('/rooms/' + room.room + '/seats', {method: 'POST', key: room.hostKey, body: {car: driver.id}});
      const url = location.origin + '/slipstream/pad.html#r=' + room.room + '&s=' + seat.seatKey;
      seatLink.value = url; await drawQr(seatCanvas, url); seatBox.hidden = false;
    } catch (error) { log('Could not make a code: ' + error.message); }
  };
  seatLink.onfocus = () => seatLink.select();
  card.style.setProperty('--c', `rgb(${driver.car.color.map(v => Math.round(v * 255)).join()})`);
  model.onchange = () => { if (session.status === 'running' || session.status === 'paused' || countdown) halt('Car changed'); game.setModel(driver, Number(model.value)); driver.car.name = game.modelName(driver.car.model); name.textContent = driver.id + ' · ' + driver.car.name; };
  control.onchange = () => { if (session.status === 'running' || session.status === 'paused' || countdown) halt('Driver changed'); releasePad(driver, true); driver.level = 0; game.setControl(driver, control.value); driver.car.stop(); refresh(); };
  remove.onclick = async () => { if (session.status === 'running' || session.status === 'paused' || countdown) halt('Car disconnected'); releasePad(driver, true); if (room) api('/rooms/' + room.room + '/seats', {method: 'POST', key: room.hostKey, body: {car: driver.id, remove: true}}).catch(() => {}); if (driver.sim) world.removeCar(driver.sim); await game.removeCar(driver); card.remove(); cards.delete(driver); refresh(); };
  recorder.add(driver);
  $('cars').append(card); cards.set(driver, {card, energy, speed, left, right, weaponsBox, control, name, seatBox, recover, browserControls, throttle, fireRow, task});
  refresh();
}

$('layout').append(...Object.keys(LAYOUTS).map(n => new Option(n, n)));
$('layout').value = world.layoutName;
$('layout').onchange = () => {
  halt('Layout changed');
  world.setLayout($('layout').value);
  if (game.drivers.some(d => d.car.simulated) && game.track) { game.track = null; game.phase = 'garage'; game.battle = null; for (const d of game.drivers) d.car.useTrack(null); log('Layout changed: scan the track again'); }
};
$('addSim').onclick = () => {
  if (game.drivers.length >= 4 || session.status === 'running' || session.status === 'paused' || countdown) return;
  const taken = new Set(game.drivers.map(d => d.car.model)), next = MODELS.find(([id]) => !taken.has(Number(id))) ?? MODELS[0];
  const sim = world.addCar({model: Number(next[0])});
  const driver = game.addCar(sim, {model: Number(next[0]), simulated: true, control: game.drivers.some(d => d.control === 'keys1') ? 'bot' : 'keys1'});
  driver.sim = sim; if (driver.control === 'bot') game.setControl(driver, 'bot');
  addCard(driver); log('Added simulated ' + driver.car.name);
};
if (!bluetoothAvailable()) { $('bleNote').textContent = 'Bluetooth is not available in this browser. Use desktop Chrome or Edge on HTTPS or localhost. Simulated cars still work.'; $('bleNote').classList.add('bad'); $('connect').disabled = true; }
else $('bleNote').textContent = 'Real cars move as soon as they have a driver. Keep the track clear and someone next to it.';
$('connect').onclick = async event => {
  try {
    if (game.drivers.length >= 4) throw new Error('The garage holds four cars. Disconnect one first.');
    const link = await chooseCar(event.shiftKey);
    if (game.drivers.some(d => d.car.connected && d.car.transport.id === link.id)) throw new Error('This car is already in the pit crew. Use its existing controls.');
    log('Connecting to ' + (link.name || 'car') + '…');
    try { await link.open(); } catch (error) { link.close(); throw error; }
    const model = link.model && vehicles.models[String(link.model)] ? link.model : 8;
    if (game.drivers.length >= 4 || document.hidden) { link.close(); throw new Error('Connection cancelled: return to the host tab with an available garage slot.'); }
    const driver = game.addCar(link, {model, name: vehicles.models[String(model)].name, control: 'none'});
    link.onClose(() => { log(driver.car.name + ' lost its Bluetooth link'); driver.car.connected = false; });
    addCard(driver);
    log('Connected ' + driver.car.name + (link.model ? '' : ' (model not reported: choose it in the list)'));
  } catch (error) { if (error.name !== 'NotFoundError') log('Connect failed: ' + error.message); }
};

// --- top bar ---------------------------------------------------------------------
$('scan').onclick = () => {
  if (game.phase === 'scanning') return game.cancelScan();
  try { requireVisible(); endRound('Track scan'); game.resume(); game.startScan(); } catch (error) { log(error.message); }
};
$('battle').onclick = () => beginRound();
$('stop').onclick = () => halt('Host stopped');
$('resume').onclick = () => { if (countdown || game.pitReason) return; try { requireVisible(); session.reset(); activeMission = null; game.resume(); $('results').hidden = true; log('Free drive ready. Apply throttle to move.'); } catch (error) { log(error.message); } };
$('top').oninput = () => { if (session.status === 'running') recordEligible = false; game.topSpeed = Number($('top').value); $('topLabel').textContent = 'Speed ceiling ' + game.topSpeed + ' mm/s'; };
game.onTrack = track => { if (!game.drivers.every(d => d.car.simulated)) try { localStorage.setItem(SAVED, JSON.stringify(track.toJSON())); } catch {} };
let saved = null; try { saved = JSON.parse(localStorage.getItem(SAVED)); } catch {}
if (Array.isArray(saved) && saved.length >= 4) { $('loadMap').hidden = false; $('loadMap').onclick = () => { try { halt('Map changed'); game.loadTrack(saved); log('Loaded the saved map'); } catch (error) { log(error.message); } }; }

// Three different moods, one shared set of driving and safety rules.
let experience = 'arcade';
const EXPERIENCES = {arcade: ['solo', 'precision', 'battle', 'team'], competition: ['solo', 'precision', 'race'], story: ['team']};
const timeText = ms => { const seconds = Math.ceil(ms / 1000); return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0'); };
const lapText = ms => ms === null ? 'No full lap yet' : (ms / 1000).toFixed(2) + 's best lap';
function requireVisible() { if (document.hidden) throw new Error('Return to the host tab before starting cars.'); }
function scoringSnapshot(now = performance.now()) {
  return game.snapshot(now).map(row => {
    const driver = game.drivers.find(d => d.id === row.id), pose = driver.car.localizer?.estimate(now);
    return {...row, lateral: pose?.lateral, speedCeiling: game.topSpeed, circuitProgress: pose?.located && game.track ? (game.track.distance(pose.index, pose.progress, pose.direction) / game.track.length) % 1 : undefined, circuitDirection: pose?.direction};
  });
}
function endRound(reason = 'ended') {
  recordEligible = false;
  countdown = null; $('countdown').hidden = true;
  if (session.status === 'running' || session.status === 'paused') session.finish(performance.now(), reason);
}
$('pitResume').onclick = () => {
  try { requireVisible(); game.resumeFromPit(); held.clear(); session.resume(performance.now()); log('Track clear acknowledged. Apply throttle to continue.'); refresh(); }
  catch (error) { $('pitMessage').textContent = error.message; }
};
function halt(reason = 'Host stopped') { endRound(reason); game.stopAll(); held.clear(); renderRound(); }
function modeInfo() {
  const mode = $('mode').value, mission = STORY_MISSIONS.find(m => m.id === $('mission').value);
  $('modeDescription').textContent = experience === 'story' ? mission.briefing : ROUND_MODES[mode].description;
  $('missionField').hidden = experience !== 'story';
  $('roundHelp').textContent = experience === 'story' ? 'A shared mission for 1–4 human or computer drivers. Each car must scan, carry and deliver its signal. Nobody can finish another driver’s job.' : mode === 'precision' ? '1–4 cars · match each gate’s lane and speed · 90 seconds' : mode === 'solo' ? '1–4 cars · individual best laps · 90 seconds' : mode === 'team' ? '1–4 cars · shared lap goal · 2 minutes' : '2–4 cars · human, computer, or a mix · 2 minutes';
}
function chooseExperience(value) {
  if (session.status === 'running' || session.status === 'paused' || countdown) return;
  experience = value;
  for (const button of document.querySelectorAll('[data-experience]')) button.setAttribute('aria-pressed', String(button.dataset.experience === value));
  $('mode').replaceChildren(...EXPERIENCES[value].map(id => new Option(ROUND_MODES[id].title, id)));
  modeInfo();
}
for (const mission of STORY_MISSIONS) $('mission').append(new Option(mission.title, mission.id));
for (const button of document.querySelectorAll('[data-experience]')) button.onclick = () => chooseExperience(button.dataset.experience);
$('mode').onchange = $('mission').onchange = modeInfo;
chooseExperience('arcade');
function beginRound() {
  try {
    requireVisible();
    if (session.status === 'running' || session.status === 'paused' || countdown) return;
    if (game.pitReason) throw new Error('Complete the shared pit recovery before starting.');
    if (!game.track) throw new Error('Map the circuit first, or try the two-car simulation.');
    if (game.track.inferredCount) throw new Error('Rescan the circuit: ' + game.track.inferredCount + ' sections were inferred. Clean the codes and use a lower scan speed.');
    const active = game.drivers.filter(d => d.car.connected && d.control !== 'none');
    const mode = $('mode').value;
    if (active.length < ROUND_MODES[mode].minCars) throw new Error('Choose a driver for at least ' + ROUND_MODES[mode].minCars + ' car(s) in the pit crew.');
    if (mode === 'battle' && active.length > 1 && active[0].crew && active.every(d => d.crew === active[0].crew)) throw new Error('Everyone is allied. Choose another crew for a rival, or play Crew mission together.');
    if (active.some(d => d.car.safetyReason && d.car.safetyReason !== 'Host stopped')) throw new Error('Recover the off-track car or disconnect it before starting.');
    if (active.some(d => d.control === 'phone' && !d.pad)) throw new Error('Approve a phone driver or choose another control before starting.');
    game.stopAll(); held.clear(); session.reset(); sessionResultShown = false; recordEligible = true;
    $('results').hidden = true;
    countdown = {until: performance.now() + 3000, mode, ids: active.map(d => d.id), mission: experience === 'story' ? STORY_MISSIONS.find(m => m.id === $('mission').value) : null};
    $('roundHelp').textContent = 'Track clear? Cars stay stopped through the countdown. Apply throttle after GO.';
    renderRound();
  } catch (error) { $('roundHelp').textContent = error.message; log(error.message); }
}
function tickRound(now) {
  if (countdown) {
    if (document.hidden && game.drivers.some(d => !d.car.simulated)) { halt('Host tab hidden'); return; }
    if (now >= countdown.until) {
      const ready = countdown; countdown = null; $('countdown').hidden = true;
      try {
        requireVisible();
        if (ready.ids.some(id => !game.drivers.some(d => d.id === id && d.car.connected && d.control !== 'none' && (!d.car.safetyReason || d.car.safetyReason === 'Host stopped')))) throw new Error('The grid changed. Check your drivers and start again.');
        game.resume(); if (ready.mode === 'battle') game.startBattle();
        const opts = ready.mission ? {mission: ready.mission.id, goal: ready.mission.goalPerCar * ready.ids.length, durationMs: ready.mission.durationMs} : {};
        activeMission = ready.mission; activeExperience = experience;
        session.start(ready.mode, scoringSnapshot(now).filter(s => ready.ids.includes(s.id)), now, opts);
        log('GO · ' + (ready.mission?.title ?? ROUND_MODES[ready.mode].title));
      } catch (error) { game.stopAll(); $('roundHelp').textContent = error.message; log(error.message); }
    }
  }
  if (session.status === 'running') {
    if (game.pitReason) { session.pause(now); recordEligible = false; held.clear(); }
    else if (game.halted) endRound('Safety stop');
    else session.update(scoringSnapshot(now), now);
  }
  if (session.status === 'finished' && !sessionResultShown) {
    sessionResultShown = true; game.stopAll(); showResults();
  }
}
function renderRound() {
  const view = session.view(), running = view.status === 'running' || view.status === 'paused';
  $('pitPanel').hidden = !game.pitReason;
  $('pitResume').disabled = !game.pitReady;
  $('pitMessage').textContent = game.pitReason ? 'Stop requested for every car. Confirm they are physically still before touching the track. Use each affected car’s Recover button, clear hands and obstacles, then continue.' : '';
  $('pitResume').textContent = view.status === 'paused' ? 'Track clear · Continue round' : 'Track clear · Rearm controls';
  $('roundLabel').textContent = game.pitReason ? 'SHARED PIT · CLOCK PAUSED' : countdown ? 'TRACK CLEAR · GET READY' : running ? activeExperience.toUpperCase() + ' · ROUND LIVE' : view.status === 'finished' ? 'ROUND COMPLETE' : 'READY WHEN YOU ARE';
  $('roundTitle').textContent = view.status === 'idle' ? 'Choose your kind of fun' : activeMission?.title ?? view.title;
  $('roundGoal').textContent = view.objective || (view.goal ? view.teamLaps + ' / ' + view.goal + ' shared laps · every driver contributes' : view.mode === 'battle' ? '100 per knockout · 25 per assist or lap' : view.mode === 'solo' ? 'Complete a full circuit. Find your fastest clean rhythm.' : 'Complete laps. Keep your eyes on the physical track.');
  $('roundClock').textContent = countdown ? String(Math.max(1, Math.ceil((countdown.until - performance.now()) / 1000))) : view.status === 'idle' ? '—' : timeText(view.remainingMs);
  $('roundState').textContent = countdown ? 'Get ready' : view.status === 'paused' ? 'Paused' : running ? 'Remaining' : game.halted ? 'Cars stopped' : 'Free drive';
  $('countdown').hidden = !countdown; $('countdown').textContent = countdown ? $('roundClock').textContent : '';
  $('endRound').hidden = !running && !countdown;
  for (const button of document.querySelectorAll('[data-experience]')) button.disabled = running || !!countdown;
  $('mode').disabled = $('mission').disabled = running || !!countdown;
}
function showResults() {
  const view = session.view();
  const goalMet = view.mode === 'team' && view.reason === 'goal';
  $('resultTitle').textContent = goalMet ? 'Mission accomplished.' : view.reason !== 'time' && view.reason !== 'goal' ? 'Round ended safely.' : view.mode === 'team' ? 'One more run?' : 'That’s a wrap.';
  $('resultSummary').textContent = view.objective ? view.objective : view.mode === 'team' ? view.teamLaps + ' of ' + view.goal + ' shared laps. ' + (goalMet ? 'Your crew did it together.' : 'Build your rhythm and try again.') : 'Full laps count. Virtual knockouts count. Physical contact never earns points.';
  $('resultRows').replaceChildren(...view.rows.map(row => {
    const label = row.name + (row.computer ? ' · CPU' : ' · human');
    let record = '';
    if (view.mode === 'solo' && row.bestLapMs !== null && !row.computer && recordEligible) {
      const driver = game.drivers.find(d => d.id === row.id);
      // Personal records compare like-for-like setups, never simulated and live laps.
      const key = 'slipstream.best.v1.' + JSON.stringify([game.track?.toJSON(), driver?.car.simulated, driver?.car.model, row.control, game.topSpeed]);
      try {
        const old = Number(localStorage.getItem(key));
        if (!old || row.bestLapMs < old) { localStorage.setItem(key, String(row.bestLapMs)); record = old ? ' · New personal best!' : ' · First recorded best'; }
        else record = ' · Record ' + (old / 1000).toFixed(2) + 's';
      } catch { record = ' · Session best'; }
    }
    const earned = view.badges?.some(b => b.driverId === row.id && b.id === 'full-lap') ? ' · Full circuit earned' : '';
    const winner = view.winnerIds.includes(row.id) && view.mode !== 'team' ? ' ★' : '';
    return el('li', {}, el('strong', {textContent: label + winner}), el('span', {textContent: row.laps + ' laps · ' + (row.task ? row.score + ' pts · ' + row.task.completed + (row.task.total ? ' / ' + row.task.total + ' tasks' : ' gates') : view.mode === 'battle' ? row.score + ' pts' : lapText(row.bestLapMs)) + record + earned}));
  }));
  $('results').hidden = false;
}
$('endRound').onclick = () => halt('Finished by host');
$('rematch').onclick = beginRound;
$('dismissResults').onclick = () => { $('results').hidden = true; };
$('demo').onclick = () => {
  if (game.drivers.length) { $('roundHelp').textContent = 'Disconnect your current cars before loading the simulation demo.'; return; }
  $('addSim').click(); $('addSim').click();
  game.useTrack(world.track); game.stopAll();
  for (const d of game.drivers) { d.car.localizer.seed(d.sim.index, d.sim.direction, performance.now()); d.car.localizer.progress = d.sim.progress; d.car.localizer.lateral = d.sim.lateral; }
  const first = game.drivers[0]; game.setControl(first, 'browser');
  $('roundHelp').textContent = 'Simulation ready: your on-screen car and one computer rival. Choose a challenge, then Start round.';
  refresh();
};

// --- keyboard and gamepad ----------------------------------------------------------
const SCHEMES = {
  keys1: {up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', attack: 'KeyF', support: 'KeyG', special: 'KeyR', cycleAttack: 'KeyQ', cycleSupport: 'KeyE', uturn: 'KeyX'},
  keys2: {up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', attack: 'KeyK', support: 'KeyL', special: 'KeyO', cycleAttack: 'KeyI', cycleSupport: 'KeyP', uturn: 'KeyM'}
};
const held = new Set();
const typing = target => ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName);
addEventListener('keydown', event => {
  if (event.code === 'Escape') { halt('Host stopped'); return; }
  if (typing(event.target) || event.repeat) return;
  if (game.halted) return;
  held.add(event.code);
  for (const d of game.drivers) {
    const s = SCHEMES[d.control]; if (!s) continue;
    if (Object.values(s).includes(event.code)) event.preventDefault();
    if (event.code === s.left) game.nudge(d, 1);
    if (event.code === s.right) game.nudge(d, -1);
    if (event.code === s.cycleAttack) game.battle?.cycle(d.car, 'attack');
    if (event.code === s.cycleSupport) game.battle?.cycle(d.car, 'support');
    if (event.code === s.uturn) d.car.uturn();
  }
});
addEventListener('keyup', event => held.delete(event.code));
addEventListener('blur', () => { held.clear(); for (const d of game.drivers) if (SCHEMES[d.control] || d.control === 'browser') { d.level = 0; d.input.throttle = 0; d.input.attack = d.input.support = d.input.special = false; d.car.stop(); } });

function readControls(dt) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  let padIndex = 0;
  for (const d of game.drivers) {
    const s = SCHEMES[d.control], input = d.input;
    if (game.halted || d.car.safetyReason) { d.level = 0; input.throttle = 0; input.attack = input.support = input.special = false; if (d.pad) d.pad.throttle = 0; continue; }
    if (s) {
      d.level = Math.max(0, Math.min(1, (d.level ?? 0) + (held.has(s.up) ? 0.9 * dt : 0) - (held.has(s.down) ? 1.6 * dt : 0)));
      input.throttle = d.level; input.attack = held.has(s.attack); input.support = held.has(s.support); input.special = held.has(s.special);
    } else if (d.control === 'browser') { input.throttle = d.level ?? 0;
    } else if (d.control === 'gamepad') {
      const pad = pads[padIndex++];
      if (!pad) { input.throttle = 0; continue; }
      input.throttle = pad.buttons[7]?.value ?? 0;
      input.lane = -(Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : 0) * 67.5;
      input.attack = !!pad.buttons[0]?.pressed; input.support = !!pad.buttons[1]?.pressed; input.special = !!pad.buttons[3]?.pressed;
    } else if (d.control === 'phone') {
      const pad = d.pad, fresh = pad && performance.now() - pad.seen < 700;
      // Dead-man: a phone that stops sending (locked, out of range) stops its car.
      input.throttle = fresh ? pad.throttle : 0; input.attack = fresh && pad.attack; input.support = fresh && pad.support; input.special = fresh && pad.special;
      if (fresh) input.lane = -pad.steer * 67.5;
    } else if (d.control === 'none') { input.throttle = 0; input.attack = input.support = input.special = false; d.level = 0; }
  }
}

// --- phone players -------------------------------------------------------------------
let room = null;                   // {room, hostKey, joinKey, stop}
const players = new Map();         // id -> {name, online, driver}
function releasePad(driver, revoke = false) { if (driver.pad) { const player = driver.pad.player; player.driver = null; if (revoke) { player.car = undefined; player.manual = true; } driver.pad = null; driver.input.throttle = 0; driver.car.stop(); } }
function seat(player, wantedId = player.car) {
  if (player.driver || !player.approved) return;
  // Approval may offer a seat; recurring input never changes the host's control mode.
  const free = d => d.control === 'phone' && !d.pad && d.car.connected;
  const driver = game.drivers.find(d => free(d) && d.id === wantedId) ?? (wantedId ? null : game.drivers.find(free));
  if (!driver) return;
  driver.pad = {player, seen: 0, throttle: 0, steer: 0, attack: false, support: false, special: false};
  player.driver = driver; log(player.name + ' is driving ' + driver.car.name);
}
function onRelay(m) {
  const carOf = x => Number.isSafeInteger(x.car) ? x.car : undefined;
  const fresh = x => ({id: x.id, name: String(x.name).slice(0, 16), online: false, driver: null, car: carOf(x), approved: x.approved === true});
  if (m.type === 'players') { for (const p of m.players) if (!players.has(p.id)) players.set(p.id, fresh(p)); }
  else if (m.type === 'joined') { players.set(m.id, fresh(m)); log(players.get(m.id).name + ' is waiting to be let in'); }
  else if (m.type === 'online') { const p = players.get(m.player); if (p) { p.online = true; seat(p); } }
  else if (m.type === 'offline' || m.type === 'left') { const p = players.get(m.player); if (p) { p.online = false; if (m.type === 'left') { if (p.driver) releasePad(p.driver); players.delete(m.player); } } }
  else if (m.type === 'input') {
    const p = players.get(m.player); if (!p) return;
    if (m.release) { p.car = undefined; p.manual = true; if (p.driver) { log(p.name + ' left ' + p.driver.car.name); releasePad(p.driver); } renderPlayers(); return; }
    // After leaving a car, a player only gets another by picking one.
    if (!p.driver && Number.isSafeInteger(m.car)) seat(p, m.car);
    else if (!p.driver && !p.manual) seat(p);
    const pad = p.driver?.pad; if (!pad) return;
    pad.seen = performance.now();
    pad.throttle = Math.max(0, Math.min(1, Number(m.throttle) || 0)); pad.steer = Math.max(-1, Math.min(1, Number(m.steer) || 0));
    pad.attack = m.attack === true; pad.support = m.support === true; pad.special = m.special === true;
    if (m.cycle === 'attack' || m.cycle === 'support' || m.cycle === 'special') game.battle?.cycle(p.driver.car, m.cycle);
    if (m.uturn === true && !game.halted && game.phase !== 'scanning') p.driver.car.uturn();
  }
  renderPlayers();
}
// Nobody drives until the host says so. Approving a per-car request hands over
// that car; whoever held it before is removed, and its code is replaced.
async function approve(p) {
  try {
    if (session.status === 'running' || session.status === 'paused' || countdown) throw new Error('Finish the round before changing drivers.');
    await api('/rooms/' + room.room + '/approve', {method: 'POST', key: room.hostKey, body: {player: p.id}});
    p.approved = true;
    const taken = p.car && game.drivers.find(d => d.id === p.car);
    if (taken?.pad && taken.pad.player !== p) {
      const old = taken.pad.player; releasePad(taken); players.delete(old.id);
      api('/rooms/' + room.room + '/kick', {method: 'POST', key: room.hostKey, body: {player: old.id}}).catch(() => {});
    }
    if (taken) { cards.get(taken).seatBox.hidden = true; game.setControl(taken, 'phone'); }
    seat(p); log('Let in ' + p.name); renderPlayers();
  } catch (error) { log('Could not let ' + p.name + ' in: ' + error.message); }
}
function renderPlayers() {
  const list = $('players'); list.replaceChildren();
  for (const p of players.values()) {
    const remove = el('button', {className: 'small', textContent: '✕', title: 'Remove this player'});
    remove.onclick = async () => {
      if (p.driver) releasePad(p.driver);
      players.delete(p.id); renderPlayers();
      try { await api('/rooms/' + room.room + '/kick', {method: 'POST', key: room.hostKey, body: {player: p.id}}); } catch {}
    };
    const wants = p.car && game.drivers.find(d => d.id === p.car);
    const status = el('span', {textContent: p.driver ? p.driver.car.name : p.approved ? 'no car yet' : wants ? 'wants ' + wants.car.name : 'wants any car'});
    const row = el('li', {className: p.approved ? '' : 'pending'}, el('span', {textContent: (p.online ? '● ' : '○ ') + p.name}), status);
    if (!p.approved) {
      const allow = el('button', {className: 'small primary', textContent: 'Let in'});
      allow.onclick = () => approve(p);
      row.append(allow);
    }
    row.append(remove); list.append(row);
  }
}
async function drawQr(canvas, text) {
  const {default: qrcode} = await import('./vendor/qrcode.mjs');
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const c = canvas.getContext('2d'), n = qr.getModuleCount(), cell = Math.floor(canvas.width / (n + 4)), off = Math.floor((canvas.width - cell * n) / 2);
  c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height); c.fillStyle = '#000';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) c.fillRect(off + x * cell, off + y * cell, cell, cell);
}
let opening = null;
function openRoom() {
  if (room) return Promise.resolve(room);
  return opening ??= (async () => {
    try {
      const code = $('hostCode').value.trim().toUpperCase();
      if (!code) throw new Error('enter the host code first');
      const made = await api('/rooms', {method: 'POST', key: code});
      try { sessionStorage.setItem('slipstream.hostCode', code); } catch {}
      $('codeField').hidden = true;
      room = {...made, link: channel({room: made.room, key: made.hostKey, role: 'host', onMessage: onRelay, onStatus: s => { $('roomNote').textContent = s === 'online' ? '' : 'Relay ' + s; }})};
      const url = location.origin + '/slipstream/pad.html#r=' + made.room + '&j=' + made.joinKey;
      $('joinUrl').value = url; $('room').hidden = false; $('invite').hidden = true;
      await drawQr($('qr'), url);
      if (/^(localhost|127\.|\[::1\])/.test(location.host)) $('roomNote').textContent = 'This page is on localhost, which other devices cannot reach. Open it through the Codespaces forwarded address and set the port to Public.';
      log('Room open: players can join');
      return room;
    } finally { opening = null; }
  })();
}
$('invite').onclick = () => openRoom().catch(error => { $('roomNote').textContent = 'Could not open a room: ' + error.message; });
$('closeRoom').onclick = async () => {
  if (!room) return;
  room.link.stop(); try { await api('/rooms/' + room.room, {method: 'DELETE', key: room.hostKey}); } catch {}
  for (const d of game.drivers) releasePad(d);
  for (const ui of cards.values()) ui.seatBox.hidden = true;
  players.clear(); room = null; $('room').hidden = true; $('invite').hidden = false; $('codeField').hidden = false; renderPlayers();
};
let lastState = 0;
function pushState(snapshot, now) {
  if (!room || now - lastState < 200) return;
  lastState = now;
  const round = session.view(), roundRows = new Map(round.rows.map(row => [row.id, row]));
  const view = s => ({id: s.id, crew: s.crew, assists: s.assists, targets: s.targets, name: s.name, color: s.color, energy: +s.energy.toFixed(2), speed: Math.round(s.speed), disabled: s.disabled, shield: s.shield, connected: s.connected, safetyReason: s.safetyReason,
    task: roundRows.get(s.id)?.task?.cue ?? '', score: roundRows.get(s.id)?.score ?? 0,
    kills: roundRows.get(s.id)?.hits ?? s.kills, deaths: roundRows.get(s.id)?.losses ?? s.deaths, laps: roundRows.get(s.id)?.laps ?? s.laps,
    bays: Object.fromEntries(['attack', 'support', 'special'].map(b => [b, s[b] ? {label: WEAPON_LABEL[s[b].type], style: s[b].style, ready: s[b].ready, charge: +s[b].charge.toFixed(1)} : null]))});
  const byDriver = new Map(snapshot.map(s => [s.id, s])), mine = {};
  for (const p of players.values()) if (p.driver) mine[p.id] = view(byDriver.get(p.driver.id));
  const lobby = {phase: game.halted ? 'stopped' : game.phase, round: {title: countdown ? 'Get ready' : activeMission?.title ?? round.title, remainingMs: countdown ? Math.max(0, countdown.until - now) : round.remainingMs, status: countdown ? 'countdown' : round.status, mode: countdown?.mode ?? round.mode, goal: round.goal, teamLaps: round.teamLaps, objective: round.objective ?? ''}, cars: game.drivers.filter(d => d.control === 'phone').map(d => ({id: d.id, name: d.car.name, color: d.car.color, free: !d.pad}))};
  room.link.send({players: mine, lobby}).catch(() => {});
}

// --- loops ---------------------------------------------------------------------------
const PHASE = {garage: 'Garage', scanning: 'Scanning', ready: 'Track ready', battle: 'Battle'};
function refresh(snapshot = game.snapshot()) {
  renderRound();
  const busy = session.status === 'running' || session.status === 'paused' || !!countdown;
  $('carCount').textContent = game.drivers.length + ' / 4 cars';
  $('addSim').disabled = game.drivers.length >= 4 || busy;
  $('connect').disabled = !bluetoothAvailable() || game.drivers.length >= 4 || busy;
  $('demo').hidden = game.drivers.length > 0;
  $('layout').disabled = busy; $('top').disabled = busy;
  $('liveTag').textContent = game.drivers.some(d => !d.car.simulated) ? 'LIVE HARDWARE · SUPERVISE' : 'SIMULATION';
  $('arenaTitle').textContent = !game.drivers.length ? 'Make room for a little rivalry.' : session.status === 'running' ? 'Eyes up. The track is the game.' : 'Your crew. Your next challenge.';
  $('empty').hidden = game.drivers.length > 0;
  const chip = $('phase'); chip.textContent = game.halted ? 'Stopped' : PHASE[game.phase];
  chip.className = 'chip' + (game.phase === 'battle' ? ' live' : game.phase === 'scanning' ? ' scan' : '');
  $('scan').textContent = game.phase === 'scanning' ? 'Cancel scan' : game.track ? 'Rescan track' : 'Scan track';
  $('scan').disabled = busy || !game.drivers.some(d => d.car.connected);
  $('battle').disabled = !game.track || busy; $('battle').textContent = countdown ? 'Get ready…' : session.status === 'paused' ? 'Round paused' : session.status === 'running' ? 'Round live' : 'Start round';
  $('resume').hidden = !game.halted || !!countdown || !!game.pitReason;
  const byId = new Map(snapshot.map(s => [s.id, s]));
  for (const [driver, ui] of cards) {
    const s = byId.get(driver.id); if (!s) continue;
    ui.card.classList.toggle('off', !s.connected); ui.card.classList.toggle('down', s.disabled);
    ui.energy.style.width = Math.round(s.energy * 100) + '%'; ui.energy.className = s.energy < 0.33 ? 'low' : s.energy < 0.66 ? 'mid' : '';
    ui.speed.style.width = Math.min(100, Math.round(s.speed / 12)) + '%';
    ui.left.textContent = !s.connected ? 'Disconnected · reconnect to recover' : s.safetyReason === 'Off track' ? 'OFF TRACK · stopped' : s.disabled ? 'DISABLED' : Math.round(s.speed) + ' mm/s' + (driver.pad ? ' · ' + driver.pad.player.name : driver.control === 'bot' ? ' · CPU' : '');
    const objective = session.view().rows.find(row => row.id === driver.id)?.task;
    ui.task.hidden = !objective; ui.task.textContent = objective?.cue ?? '';
    ui.recover.hidden = s.safetyReason !== 'Off track';
    ui.browserControls.hidden = driver.control !== 'browser';
    ui.fireRow.hidden = game.phase !== 'battle';
    ui.throttle.value = Math.round((driver.level ?? 0) * 100); ui.throttle.disabled = game.halted || !!s.safetyReason;
    ui.right.textContent = (s.millivolts ? (s.millivolts / 1000).toFixed(2) + ' V · ' : '') + (s.located ? 'on map' : game.track ? 'locating' : 'no map') + (s.crew ? ' · ' + s.crew + ' · ' + s.assists + ' assists' : '') + (s.targets?.length ? ' · Target ' + s.targets.join(', ') : '');
    if (ui.control.value !== driver.control) ui.control.value = driver.control;
    const chips = ['attack', 'support', 'special'].filter(b => s[b]).map(b => {
      const chip = el('span', {className: 'weapon' + (s[b].ready ? ' ready' : '')});
      chip.append(el('b', {textContent: b[0].toUpperCase() + ' '}), WEAPON_LABEL[s[b].type] ?? s[b].type);
      return chip;
    });
    ui.weaponsBox.replaceChildren(...chips);
  }
  const round = session.view();
  const taskMode = round.mode === 'precision' || !!round.mission;
  $('scoreCol').textContent = taskMode ? 'Points' : 'KOs';
  $('detailCol').textContent = taskMode ? (round.mission ? 'Tasks' : 'Gates') : 'Lost';
  const standings = round.rows.length ? round.rows.map(row => ({...row, kills: row.hits, deaths: row.losses})) : [...snapshot].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const rows = standings.map(s => el('tr', {}, el('td', {textContent: s.id + ' · ' + s.name + (s.control === 'bot' ? ' · CPU' : '')}), el('td', {textContent: taskMode ? s.score : s.kills}), el('td', {textContent: taskMode ? s.task?.completed ?? 0 : s.deaths}), el('td', {textContent: s.laps})));
  $('scores').tBodies[0].replaceChildren(...rows);
}

let last = performance.now(), slow = 0;
setInterval(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  readControls(dt);
  world.step(dt);
  for (const d of game.drivers) d.objectiveInput = session.status === 'running' ? session.guidance(d.id) : null;
  game.tick(dt, now);
  tickRound(now);
  if (game.battle) for (const e of game.battle.drain()) {
    const id = car => game.drivers.find(d => d.car === car)?.id;
    renderer.addEffect({...e, from: id(e.from), to: id(e.to), car: id(e.car), life: e.type === 'explosion' || e.type === 'disabled' ? 700 : e.type === 'beam' ? 160 : 400});
    if (e.type === 'disabled') log((game.drivers.find(d => d.car === e.car)?.car.name ?? 'A car') + ' was disabled' + (e.by ? ' by ' + e.by.name : ''));
  }
  if (now - slow > 150) { slow = now; const snapshot = game.snapshot(now); refresh(snapshot); pushState(snapshot, now); }
}, 40);

function frame() {
  const now = performance.now(), snapshot = game.snapshot(now), byId = new Map(snapshot.map(s => [s.id, s]));
  const cars = game.drivers.map(d => { const s = byId.get(d.id); return {...s, pose: d.car.pose(now), truck: vehicles.models[String(d.car.model)]?.truck}; });
  const banner = game.phase === 'scanning' ? 'Mapping the track: ' + (game.mapper.sequence.length) + ' pieces so far' + (game.mapper.problem ? ' · ' + game.mapper.problem : '')
    : !game.track && game.drivers.length ? 'Press “Scan track” to map the layout' : '';
  try { renderer.draw({track: game.track, partial: game.phase === 'scanning' ? game.mapper.sequence : null, cars, mines: game.battle?.mines ?? [], now, banner, objectives: session.view().rows.filter(r => r.task && Number.isFinite(r.task.gateProgress)).map(r => ({progress: r.task.gateProgress, label: String(r.id)}))}); }
  catch (error) { if (renderer !== mapRenderer) { requestedView='2d'; useMap('3D interrupted · 2D map active'); log('3D view interrupted: '+error.message); } }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// A hidden tab gets its timers throttled, so it cannot be trusted to drive cars.
document.addEventListener('visibilitychange', () => { if (document.hidden && game.drivers.some(d => !d.car.simulated && d.car.connected)) { halt('Host tab hidden'); log('Tab hidden: cars stopped. Return and explicitly resume.'); } });
addEventListener('pagehide', () => { halt('Host page closed'); });
try { $('hostCode').value = sessionStorage.getItem('slipstream.hostCode') || ''; } catch {}
$('record').onclick = () => {
  if (recorder.active) { recorder.stop(); $('record').textContent = 'Record'; $('saveTrace').disabled = false; $('traceNote').textContent = recorder.events.length + ' messages recorded from ' + recorder.cars.length + ' car(s).'; return; }
  recorder.start(game.drivers, 'layout: ' + (game.drivers.every(d => d.car.simulated) ? world.layoutName : 'real track'));
  $('record').textContent = 'Stop recording'; $('saveTrace').disabled = true; $('traceNote').textContent = 'Recording…';
};
$('saveTrace').onclick = () => {
  const link = el('a', {href: URL.createObjectURL(new Blob([JSON.stringify(recorder.toJSON())], {type: 'application/json'})), download: 'slipstream-trace-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'});
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
refresh();
log('Ready. ' + Object.keys(pieces).length + ' track pieces, ' + MODELS.length + ' car models, ' + Object.keys(weapons).length + ' weapons loaded.');

// Build a design at rest. A drawing cannot establish what is on the physical floor.
let draftPlan = [];
const draftRenderer = new Renderer($('planMap'));
for (const [id, piece] of Object.entries(pieces)) $('planPiece').append(new Option(piece.kind + ' · code ' + id, id));
function drawPlan() {
  let track = null;
  try { if (draftPlan.length) track = trackFromPlan(game.pieces, draftPlan); } catch (e) { $('planStatus').textContent = e.message; }
  $('planList').textContent = draftPlan.map(p => p.id + (p.reverse ? ' ←' : ' →')).join(' · ') || 'Add sections in driving order.';
  $('planStatus').textContent = track ? track.count + ' sections · ' + (track.length / 1000).toFixed(2) + ' m · ' + (track.closed ? 'Ends meet. Check crossings and bridge clearance.' : Math.round(track.gap) + ' mm gap; ends must meet and face the same way.') : 'Choose a section and its direction.';
  $('planUse').disabled = !track?.closed;
  draftRenderer.draw({track, cars: [], mines: [], now: performance.now()});
}
$('planAdd').onclick = () => { if (draftPlan.length >= 64) return; draftPlan.push({id: Number($('planPiece').value), reverse: $('planDirection').value === 'reverse'}); drawPlan(); };
$('planUndo').onclick = () => { draftPlan.pop(); drawPlan(); };
$('planCopy').onclick = () => { if (game.track) draftPlan = game.track.toJSON(); drawPlan(); };
$('planUse').onclick = () => {
  try {
    const track = trackFromPlan(game.pieces, draftPlan);
    if (!track.closed) throw new Error('Close the circuit first');
    halt('Circuit design changed');
    if (game.drivers.some(d => !d.car.simulated)) { log('Build this design with the cars stopped, then scan the physical circuit. A drawing does not verify the floor layout.'); return; }
    world.track = track; world.layoutName = 'Custom design';
    world.cars.forEach((car, i) => { car.index = 0; car.progress = .05 + i * .05; car.direction = 1; car.speed = car.targetSpeed = 0; });
    game.useTrack(track); refresh(); log('Custom circuit ready in the simulator.');
  } catch (error) { log(error.message); }
};
$('planBuilder').ontoggle = drawPlan;

// Visualization is optional and never issues motion commands.
function useMap(note = '2D telemetry map') {
  renderer = mapRenderer; $('map').hidden = false; $('map3d').hidden = true;
  $('view2d').setAttribute('aria-pressed','true'); $('view3d').setAttribute('aria-pressed','false');
  $('sceneNote').textContent = note;
  for (const id of ['cameraOut','cameraIn','cameraReset']) $(id).disabled = true;
}
async function useStudio() {
  requestedView = '3d';
  if (studioLoading) return;
  try {
    if (!studioRenderer) {
      studioLoading = true; $('sceneNote').textContent = 'Opening 3D studio…';
      const {Renderer3D} = await import('./render3d.mjs');
      studioRenderer = new Renderer3D($('map3d'), {onLost: () => { requestedView='2d'; useMap('3D paused by the browser · 2D map remains available'); }});
    }
    if (requestedView !== '3d') return;
    if (!studioRenderer.available) throw new Error('Graphics context has not recovered');
    renderer = studioRenderer; $('map').hidden = true; $('map3d').hidden = false;
    $('view2d').setAttribute('aria-pressed','false'); $('view3d').setAttribute('aria-pressed','true');
    $('sceneNote').textContent = 'Drag to orbit · Visual model, not measured elevation';
    for (const id of ['cameraOut','cameraIn','cameraReset']) $(id).disabled = false;
  } catch (error) { requestedView='2d'; useMap('3D unavailable on this browser · 2D map active'); log('3D view unavailable: '+error.message); }
  finally { studioLoading=false; }
}
$('view3d').onclick = useStudio;
$('view2d').onclick = () => { requestedView='2d'; useMap(); };
$('cameraIn').onclick = () => studioRenderer?.setZoom(.15);
$('cameraOut').onclick = () => studioRenderer?.setZoom(-.15);
$('cameraReset').onclick = () => studioRenderer?.resetView();
useMap();
// Start in the lightweight map; the 3D button loads WebGL only when requested.
for (const [id, variable, start, sign] of [['garageResize','--garage-width',280,1],['telemetryResize','--telemetry-width',270,-1]]) {
  const handle=$(id); let width=start, drag=null;
  const resize = value => { width=Math.max(220,Math.min(420,value)); document.body.style.setProperty(variable,width+'px'); handle.setAttribute('aria-valuenow',String(Math.round(width))); };
  handle.setAttribute('aria-valuemin','220'); handle.setAttribute('aria-valuemax','420'); handle.setAttribute('aria-valuenow',String(start));
  handle.onpointerdown = e => { drag={x:e.clientX,width}; handle.setPointerCapture(e.pointerId); };
  handle.onpointermove = e => { if(drag)resize(drag.width+(e.clientX-drag.x)*sign); };
  handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = () => { drag=null; };
  handle.onkeydown = e => { if(['ArrowLeft','ArrowRight','Home'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); resize(e.key==='Home'?start:width+(e.key==='ArrowRight'?20:-20)*sign); } };
}
