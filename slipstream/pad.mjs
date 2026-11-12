// Phone controller: throttle slider, tilt (or buttons) to steer, weapon buttons.
// It only ever talks to the relay; the host browser decides what a car does.
import {api, channel} from './net.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const room = params.get('r') || '', joinKey = params.get('s') || params.get('j') || '', seated = params.has('s');
const KEY = 'slipstream.pad.' + room + '.' + joinKey.slice(0, 8);
const state = {throttle: 0, steer: 0, attack: false, support: false, special: false};
let me = null, link = null, allowed = false, once = {}, tiltOn = false, tiltWanted = false, listening = false, flip = 1, lastSent = '', lastSentAt = 0, hasCar = false;
try { flip = sessionStorage.getItem('slipstream.flip') === '-1' ? -1 : 1; } catch {}

const say = text => { $('msg').textContent = text; };
if (!/^[0-9a-f]{8}$/.test(room) || !/^[0-9a-f]{24}$/.test(joinKey)) { say('This link is incomplete. Scan the QR code on the host screen again.'); $('go').disabled = true; }
try { const saved = JSON.parse(sessionStorage.getItem(KEY)); if (saved?.playerKey) { me = saved; start(); } } catch {}

$('go').onclick = async () => {
  $('go').disabled = true; say('Joining…');
  askTilt();
  try {
    me = await api('/rooms/' + room + '/join', {method: 'POST', body: {joinKey, name: $('name').value}});
    try { sessionStorage.setItem(KEY, JSON.stringify(me)); } catch {}
    start();
  } catch (error) { say(error.status === 404 ? 'That room has closed. Ask the host for a new code.' : error.status === 403 ? 'This code is no longer valid. Ask the host for a new one.' : error.message); $('go').disabled = false; }
};
$('name').onkeydown = event => { if (event.key === 'Enter') $('go').click(); };

window.slipstreamPad = {get transport() { return link?.transport ?? null; }};   // diagnostics
function start() {
  $('join').hidden = true; $('play').hidden = false;
  link = channel({room, key: me.playerKey, role: 'player', onMessage, onStatus: status => {
    $('link').textContent = status === 'online' ? '' : status === 'refused' ? 'Room closed' : 'Reconnecting…';
    if (status === 'refused') { try { sessionStorage.removeItem(KEY); } catch {} }
  }});
  setInterval(send, 66);
  navigator.wakeLock?.request?.('screen').catch(() => {});
}

function onMessage(m) {
  if (m.type === 'kicked') { $('car').textContent = 'Removed'; $('status').textContent = 'The host removed you.'; allowed = false; return; }
  if (m.type === 'pending') { allowed = false; $('car').textContent = 'Waiting…'; $('status').textContent = 'Waiting for the host to let you in.'; return; }
  if (m.type === 'approved') { allowed = true; $('status').textContent = 'You are in.'; return; }
  if (m.type !== 'state') return;
  const mine = m.me, lobby = m.lobby ?? {};
  hasCar = !!mine;
  document.body.classList.toggle('down', !!mine?.disabled);
  if (mine) {
    const [r, g, b] = mine.color.map(v => Math.round(v * 255));
    document.documentElement.style.setProperty('--car', `rgb(${r},${g},${b})`);
    $('car').textContent = mine.name;
    $('energy').style.width = Math.round(mine.energy * 100) + '%'; $('energy').className = mine.energy < 0.33 ? 'low' : mine.energy < 0.66 ? 'mid' : '';
    $('status').textContent = ({battle: 'Battle', ready: 'Free drive', scanning: 'Host is mapping the track', garage: 'Waiting for the track map', stopped: 'Host pressed STOP'})[lobby.phase] + ' · ' + mine.speed + ' mm/s';
    $('hits').textContent = 'Hits ' + mine.kills + ' · Lost ' + mine.deaths + ' · Laps ' + mine.laps;
    for (const bay of ['attack', 'support', 'special']) {
      const info = mine.bays[bay], button = $(bay);
      button.hidden = !info && bay === 'special';
      $(bay + 'Name').textContent = info ? info.label + (info.charge > 0 ? ' ' + info.charge + 's' : '') : '—';
      button.classList.toggle('wait', !!info && !info.ready);
    }
    if (mine.disabled && !onMessage.wasDown) navigator.vibrate?.([120, 60, 240]);
    onMessage.wasDown = mine.disabled; $('cars').replaceChildren(); $('leave').hidden = false;
  } else {
    $('car').textContent = 'Waiting for a car…'; $('leave').hidden = true;
    const free = (lobby.cars ?? []).filter(c => c.free);
    $('status').textContent = free.length ? 'Pick a car:' : 'Ask the host to set a car to “Phone”.';
    $('cars').replaceChildren(...free.map(c => { const b = document.createElement('button'); b.textContent = c.name; b.onclick = () => { once.car = c.id; }; return b; }));
  }
}

function send() {
  if (!me || !link || !allowed) return;
  const body = {...state, throttle: +state.throttle.toFixed(2), steer: +state.steer.toFixed(2), ...once};
  const text = JSON.stringify(body), now = Date.now();
  // Always refresh a few times a second so the host's dead-man timer stays happy.
  if (text === lastSent && now - lastSentAt < 250) return;
  lastSent = text; lastSentAt = now; once = {};
  link.send(body).catch(error => { if (error.status === 404) $('link').textContent = 'Room closed'; });
}

// --- throttle slider ---------------------------------------------------------
const slider = $('throttle');
function setThrottle(value) {
  state.throttle = Math.max(0, Math.min(1, value));
  $('fill').style.height = Math.round(state.throttle * 100) + '%'; $('pct').textContent = Math.round(state.throttle * 100);
}
function drag(event) { const box = slider.getBoundingClientRect(); setThrottle(1 - (event.clientY - box.top - 12) / (box.height - 24)); }
slider.addEventListener('pointerdown', event => { slider.setPointerCapture(event.pointerId); drag(event); });
slider.addEventListener('pointermove', event => { if (event.buttons || event.pointerType === 'touch') drag(event); });
$('brake').onclick = () => setThrottle(0);

// --- weapons --------------------------------------------------------------------
for (const bay of ['attack', 'support', 'special']) {
  const button = $(bay);
  const set = down => { state[bay] = down; button.classList.toggle('on', down); if (down) navigator.vibrate?.(15); };
  button.addEventListener('pointerdown', event => { button.setPointerCapture(event.pointerId); set(true); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => set(false));
  // Double-tap the label area cycles weapons on cars that carry more than one.
  button.addEventListener('dblclick', () => { once.cycle = bay; });
}
$('uturn').onclick = () => { once.uturn = true; };
$('leave').onclick = () => { setThrottle(0); once.release = true; };

// --- keyboard, for players on a laptop --------------------------------------------
const down = new Set();
const KEYS = {attack: ['KeyF', 'Space'], support: ['KeyG'], special: ['KeyR']};
addEventListener('keydown', event => {
  if (event.target?.tagName === 'INPUT' || !me) return;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  down.add(event.code);
  if (event.code === 'KeyA' || event.code === 'ArrowLeft') $('left').click();
  if (event.code === 'KeyD' || event.code === 'ArrowRight') $('right').click();
  if (event.code === 'KeyX') once.uturn = true;
  if (event.code === 'KeyQ') once.cycle = 'attack';
  if (event.code === 'KeyE') once.cycle = 'support';
  if (event.code === 'Escape') setThrottle(0);
  for (const [bay, codes] of Object.entries(KEYS)) if (codes.includes(event.code)) { state[bay] = true; $(bay).classList.add('on'); }
});
addEventListener('keyup', event => {
  down.delete(event.code);
  for (const [bay, codes] of Object.entries(KEYS)) if (codes.includes(event.code)) { state[bay] = false; $(bay).classList.remove('on'); }
});
addEventListener('blur', () => { down.clear(); for (const bay of Object.keys(KEYS)) { state[bay] = false; $(bay).classList.remove('on'); } });
setInterval(() => {
  const up = down.has('KeyW') || down.has('ArrowUp'), slower = down.has('KeyS') || down.has('ArrowDown');
  if (up || slower) setThrottle(state.throttle + (up ? 0.045 : 0) - (slower ? 0.08 : 0));
}, 50);

// --- steering ---------------------------------------------------------------------
function setSteer(value) { state.steer = Math.max(-1, Math.min(1, value)); $('dot').style.left = (50 + state.steer * 44) + '%'; }
$('left').onclick = () => setSteer(Math.round(state.steer * 3 - 1) / 3);
$('right').onclick = () => setSteer(Math.round(state.steer * 3 + 1) / 3);
function onTilt(event) {
  if (event.beta === null || event.gamma === null) return;
  // Only a device that really reports motion counts as having tilt steering.
  if (tiltWanted && !tiltOn) { tiltOn = true; $('tilt').textContent = 'Tilt on'; $('tilt').classList.add('on'); $('flip').hidden = false; }
  if (!tiltOn) return;
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  const degrees = angle === 90 ? event.beta : angle === 270 || angle === -90 ? -event.beta : event.gamma;
  const dead = Math.abs(degrees) < 3 ? 0 : degrees - Math.sign(degrees) * 3;
  setSteer(flip * dead / 24);
}
async function askTilt() {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') return false;
  } catch { return false; }
  if (!listening) { addEventListener('deviceorientation', onTilt); listening = true; }
  tiltWanted = true;
  return true;
}
$('tilt').onclick = async () => {
  if (tiltOn) { tiltOn = false; tiltWanted = false; $('tilt').textContent = 'Tilt steering'; $('tilt').classList.remove('on'); $('flip').hidden = true; setSteer(0); return; }
  if (!await askTilt()) { $('status').textContent = 'Tilt is not available here. Use the arrow buttons.'; return; }
  setTimeout(() => { if (!tiltOn) $('link').textContent = 'No motion sensor found: use the arrows or A / D'; }, 1200);
};
$('flip').onclick = () => { flip = -flip; try { sessionStorage.setItem('slipstream.flip', String(flip)); } catch {} };
document.addEventListener('visibilitychange', () => { if (document.hidden) { setThrottle(0); for (const bay of ['attack', 'support', 'special']) state[bay] = false; send(); } });
addEventListener('contextmenu', event => event.preventDefault());
