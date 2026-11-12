// Host page: owns the Bluetooth links, runs the game loop, draws the map and
// relays phone players. Nothing here trusts text from a car or a phone as HTML.
import {Game} from './game.mjs';
import {SimWorld, LAYOUTS} from './sim.mjs';
import {chooseCar, bluetoothAvailable} from './ble.mjs';
import {Renderer} from './render.mjs';
import {WEAPON_LABEL} from './battle.mjs';
import {api, channel} from './net.mjs';
import {Recorder} from './trace.mjs';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
const load = name => fetch('data/' + name + '.json', {cache: 'no-store'}).then(r => { if (!r.ok) throw new Error('Could not load ' + name); return r.json(); });
const SAVED = 'slipstream.track.v1';

const [pieces, vehicles, weapons] = await Promise.all([load('pieces'), load('vehicles'), load('weapons')]);
const game = new Game({pieces, vehicles, weapons, log});
const world = new SimWorld(game.pieces, 'Capsule');
const renderer = new Renderer($('map'));
const recorder = new Recorder();
window.slipstream = {game, world, recorder, get transport() { return room?.link.transport ?? null; }};                        // for the browser console and tests

function log(text) {
  const list = $('log');
  list.prepend(el('li', {textContent: new Date().toLocaleTimeString() + '  ' + text}));
  while (list.children.length > 60) list.lastChild.remove();
}

// --- garage --------------------------------------------------------------------
const cards = new Map();           // driver -> DOM refs
const CONTROLS = [['none', 'Parked'], ['keys1', 'Keyboard W A S D'], ['keys2', 'Keyboard arrows'], ['gamepad', 'Gamepad'], ['phone', 'Phone or link'], ['bot', 'Computer']];
const MODELS = Object.entries(vehicles.models).filter(([, m]) => !['Future', 'Unrecognized'].includes(m.name)).sort((a, b) => a[1].name.localeCompare(b[1].name));

function addCard(driver) {
  const model = el('select', {title: 'Car model'}), control = el('select', {title: 'Who drives'});
  for (const [id, m] of MODELS) model.append(new Option(m.name + (m.truck ? ' (truck)' : ''), id));
  for (const [id, label] of CONTROLS) control.append(new Option(label, id));
  model.value = String(driver.car.model); control.value = driver.control;
  const name = el('span', {className: 'name', textContent: driver.car.name});
  const tag = el('span', {className: 'tag', textContent: driver.car.simulated ? 'sim' : 'live'});
  const remove = el('button', {className: 'small', textContent: '✕', title: 'Disconnect'});
  const code = el('button', {className: 'small', textContent: 'Code', title: 'Show this car\'s own join code'});
  const seatCanvas = el('canvas', {width: 164, height: 164, className: 'seatqr'});
  const seatLink = el('input', {readOnly: true, className: 'seatlink'});
  const seatBox = el('div', {className: 'seat', hidden: true}, seatCanvas, el('p', {className: 'note', textContent: 'Scan to drive this car from a phone, or open the link on a laptop.'}), seatLink);
  const energy = el('i'), speed = el('i');
  const left = el('span'), right = el('span'), weaponsBox = el('div', {className: 'weapons'});
  const card = el('div', {className: 'car'},
    el('div', {className: 'top'}, name, tag, code, remove),
    el('div', {className: 'grid'}, model, control),
    el('div', {className: 'bar'}, energy), el('div', {className: 'bar speed'}, speed),
    el('div', {className: 'meta'}, left, right), weaponsBox, seatBox);
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
  model.onchange = () => { game.setModel(driver, Number(model.value)); driver.car.name = game.modelName(driver.car.model); name.textContent = driver.car.name; };
  control.onchange = () => { releasePad(driver); game.setControl(driver, control.value); };
  remove.onclick = async () => { releasePad(driver); if (room) api('/rooms/' + room.room + '/seats', {method: 'POST', key: room.hostKey, body: {car: driver.id, remove: true}}).catch(() => {}); if (driver.sim) world.removeCar(driver.sim); await game.removeCar(driver); card.remove(); cards.delete(driver); refresh(); };
  recorder.add(driver);
  $('cars').append(card); cards.set(driver, {card, energy, speed, left, right, weaponsBox, control, name, seatBox});
  refresh();
}

$('layout').append(...Object.keys(LAYOUTS).map(n => new Option(n, n)));
$('layout').value = world.layoutName;
$('layout').onchange = () => {
  world.setLayout($('layout').value);
  if (game.drivers.some(d => d.car.simulated) && game.track) { game.stopAll(); game.resume(); game.track = null; game.phase = 'garage'; game.battle = null; for (const d of game.drivers) d.car.useTrack(null); log('Layout changed: scan the track again'); }
};
$('addSim').onclick = () => {
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
    const link = await chooseCar(event.shiftKey);
    log('Connecting to ' + (link.name || 'car') + '…');
    await link.open();
    const model = link.model && vehicles.models[String(link.model)] ? link.model : 8;
    const driver = game.addCar(link, {model, name: vehicles.models[String(model)].name, control: 'none'});
    link.onClose(() => { log(driver.car.name + ' lost its Bluetooth link'); driver.car.connected = false; });
    addCard(driver);
    log('Connected ' + driver.car.name + (link.model ? '' : ' (model not reported: choose it in the list)'));
  } catch (error) { if (error.name !== 'NotFoundError') log('Connect failed: ' + error.message); }
};

// --- top bar ---------------------------------------------------------------------
$('scan').onclick = () => {
  if (game.phase === 'scanning') return game.cancelScan();
  try { game.resume(); game.startScan(); } catch (error) { log(error.message); }
};
$('battle').onclick = () => { try { game.phase === 'battle' ? game.stopBattle() : (game.resume(), game.startBattle()); } catch (error) { log(error.message); } };
$('stop').onclick = () => { if (game.halted) { game.resume(); log('Resumed'); } else game.stopAll(); };
$('top').oninput = () => { game.topSpeed = Number($('top').value); $('topLabel').textContent = 'Top speed ' + game.topSpeed + ' mm/s'; };
game.onTrack = track => { if (!game.drivers.every(d => d.car.simulated)) try { localStorage.setItem(SAVED, JSON.stringify(track.toJSON())); } catch {} };
let saved = null; try { saved = JSON.parse(localStorage.getItem(SAVED)); } catch {}
if (Array.isArray(saved) && saved.length >= 4) { $('loadMap').hidden = false; $('loadMap').onclick = () => { try { game.loadTrack(saved); log('Loaded the saved map'); } catch (error) { log(error.message); } }; }

// --- keyboard and gamepad ----------------------------------------------------------
const SCHEMES = {
  keys1: {up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', attack: 'KeyF', support: 'KeyG', special: 'KeyR', cycleAttack: 'KeyQ', cycleSupport: 'KeyE', uturn: 'KeyX'},
  keys2: {up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', attack: 'KeyK', support: 'KeyL', special: 'KeyO', cycleAttack: 'KeyI', cycleSupport: 'KeyP', uturn: 'KeyM'}
};
const held = new Set();
const typing = target => ['INPUT', 'SELECT', 'TEXTAREA'].includes(target?.tagName);
addEventListener('keydown', event => {
  if (event.code === 'Escape') { game.stopAll(); return; }
  if (typing(event.target) || event.repeat) return;
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
addEventListener('blur', () => held.clear());

function readControls(dt) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  let padIndex = 0;
  for (const d of game.drivers) {
    const s = SCHEMES[d.control], input = d.input;
    if (s) {
      d.level = Math.max(0, Math.min(1, (d.level ?? 0) + (held.has(s.up) ? 0.9 * dt : 0) - (held.has(s.down) ? 1.6 * dt : 0)));
      input.throttle = d.level; input.attack = held.has(s.attack); input.support = held.has(s.support); input.special = held.has(s.special);
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
function releasePad(driver) { if (driver.pad) { driver.pad.player.driver = null; driver.pad = null; } }
function seat(player, wantedId = player.car) {
  if (player.driver || !player.approved) return;
  // A per-car code names its car: hand that car over to remote control.
  const named = player.car && game.drivers.find(d => d.id === player.car && d.car.connected);
  if (named && !named.pad && named.control !== 'phone') game.setControl(named, 'phone');
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
    if (m.uturn === true) p.driver.car.uturn();
  }
  renderPlayers();
}
// Nobody drives until the host says so. Approving a per-car request hands over
// that car; whoever held it before is removed, and its code is replaced.
async function approve(p) {
  try {
    await api('/rooms/' + room.room + '/approve', {method: 'POST', key: room.hostKey, body: {player: p.id}});
    p.approved = true;
    const taken = p.car && game.drivers.find(d => d.id === p.car);
    if (taken?.pad && taken.pad.player !== p) {
      const old = taken.pad.player; releasePad(taken); players.delete(old.id);
      api('/rooms/' + room.room + '/kick', {method: 'POST', key: room.hostKey, body: {player: old.id}}).catch(() => {});
    }
    if (taken) cards.get(taken).seatBox.hidden = true;
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
  const view = s => ({name: s.name, color: s.color, energy: +s.energy.toFixed(2), speed: Math.round(s.speed), disabled: s.disabled, shield: s.shield,
    kills: s.kills, deaths: s.deaths, laps: s.laps,
    bays: Object.fromEntries(['attack', 'support', 'special'].map(b => [b, s[b] ? {label: WEAPON_LABEL[s[b].type], style: s[b].style, ready: s[b].ready, charge: +s[b].charge.toFixed(1)} : null]))});
  const byDriver = new Map(snapshot.map(s => [s.id, s])), mine = {};
  for (const p of players.values()) if (p.driver) mine[p.id] = view(byDriver.get(p.driver.id));
  const lobby = {phase: game.halted ? 'stopped' : game.phase, cars: game.drivers.filter(d => d.control === 'phone').map(d => ({id: d.id, name: d.car.name, color: d.car.color, free: !d.pad}))};
  room.link.send({players: mine, lobby}).catch(() => {});
}

// --- loops ---------------------------------------------------------------------------
const PHASE = {garage: 'Garage', scanning: 'Scanning', ready: 'Track ready', battle: 'Battle'};
function refresh(snapshot = game.snapshot()) {
  $('empty').hidden = game.drivers.length > 0;
  const chip = $('phase'); chip.textContent = game.halted ? 'Stopped' : PHASE[game.phase];
  chip.className = 'chip' + (game.phase === 'battle' ? ' live' : game.phase === 'scanning' ? ' scan' : '');
  $('scan').textContent = game.phase === 'scanning' ? 'Cancel scan' : game.track ? 'Rescan track' : 'Scan track';
  $('scan').disabled = !game.drivers.some(d => d.car.connected);
  $('battle').disabled = !game.track; $('battle').textContent = game.phase === 'battle' ? 'End battle' : 'Start battle';
  $('stop').textContent = game.halted ? 'RESUME' : 'STOP ALL';
  const byId = new Map(snapshot.map(s => [s.id, s]));
  for (const [driver, ui] of cards) {
    const s = byId.get(driver.id); if (!s) continue;
    ui.card.classList.toggle('off', !s.connected); ui.card.classList.toggle('down', s.disabled);
    ui.energy.style.width = Math.round(s.energy * 100) + '%'; ui.energy.className = s.energy < 0.33 ? 'low' : s.energy < 0.66 ? 'mid' : '';
    ui.speed.style.width = Math.min(100, Math.round(s.speed / 12)) + '%';
    ui.left.textContent = !s.connected ? 'disconnected' : s.disabled ? 'DISABLED' : Math.round(s.speed) + ' mm/s' + (driver.pad ? ' · ' + driver.pad.player.name : '');
    ui.right.textContent = (s.millivolts ? (s.millivolts / 1000).toFixed(2) + ' V · ' : '') + (s.located ? 'on map' : game.track ? 'locating' : 'no map');
    if (ui.control.value !== driver.control) ui.control.value = driver.control;
    const chips = ['attack', 'support', 'special'].filter(b => s[b]).map(b => {
      const chip = el('span', {className: 'weapon' + (s[b].ready ? ' ready' : '')});
      chip.append(el('b', {textContent: b[0].toUpperCase() + ' '}), WEAPON_LABEL[s[b].type] ?? s[b].type);
      return chip;
    });
    ui.weaponsBox.replaceChildren(...chips);
  }
  const rows = [...snapshot].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths).map(s => el('tr', {}, el('td', {textContent: s.name}), el('td', {textContent: s.kills}), el('td', {textContent: s.deaths}), el('td', {textContent: s.laps})));
  $('scores').tBodies[0].replaceChildren(...rows);
}

let last = performance.now(), slow = 0;
setInterval(() => {
  const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
  readControls(dt);
  world.step(dt);
  game.tick(dt, now);
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
  renderer.draw({track: game.track, partial: game.phase === 'scanning' ? game.mapper.sequence : null, cars, mines: game.battle?.mines ?? [], now, banner});
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// A hidden tab gets its timers throttled, so it cannot be trusted to drive cars.
document.addEventListener('visibilitychange', () => { if (document.hidden && game.drivers.some(d => !d.car.simulated && d.car.speed > 0)) { game.stopAll(); log('Tab hidden: cars stopped'); } });
addEventListener('pagehide', () => { for (const d of game.drivers) d.car.stop(); });
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
