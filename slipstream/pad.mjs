// Phone controller: throttle slider, tilt (or buttons) to steer, weapon buttons.
// It only ever talks to the relay; the host browser decides what a car does.
import {api, channel} from './net.mjs';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.hash.slice(1));
const room = params.get('r') || '', joinKey = params.get('s') || params.get('j') || '', seated = params.has('s');
const KEY = 'slipstream.pad.' + room + '.' + joinKey.slice(0, 8);
const state = {throttle: 0, steer: 0, attack: false, support: false, special: false};
let lastStateAt = 0;
let throttlePointer = null, releasePending = false, releaseCar = null;
let online = false, driveReady = false, previousView = null, previousRoundStatus = null, tiltNeutral = null, tiltSample = null, tiltAngle = null;
let haptics = false, lastBuzz = -Infinity;
try { haptics = localStorage.getItem('slipstream.haptics') === 'on'; } catch {}
const canVibrate = typeof navigator.vibrate === 'function';
const PULSE = {ready: [25, 50, 25], hit: 35, disabled: [70, 60, 70], recovered: [25, 45, 50], score: [20, 40, 20], lap: 25, finish: [30, 70, 50]};
function feedback(text, kind) {
  $('feedback').textContent = text;
  if (!haptics || !canVibrate || document.hidden || Date.now() - lastBuzz < 500) return;
  lastBuzz = Date.now();
  try { navigator.vibrate(PULSE[kind] ?? 20); } catch {}
}
function showHaptics() {
  $('haptics').disabled = !canVibrate;
  $('haptics').textContent = canVibrate ? 'Haptics: ' + (haptics ? 'on' : 'off') : 'Haptics unavailable';
  $('haptics').setAttribute('aria-pressed', String(canVibrate && haptics));
}
$('haptics').onclick = () => { haptics = !haptics; try { localStorage.setItem('slipstream.haptics', haptics ? 'on' : 'off'); } catch {} showHaptics(); feedback(haptics ? 'Haptics on. Visual cues always remain available.' : 'Haptics off.', 'ready'); };
showHaptics();
let me = null, link = null, allowed = false, once = {}, tiltOn = false, tiltWanted = false, listening = false, flip = 1, lastSent = '', lastSentAt = 0, hasCar = false;
try { flip = sessionStorage.getItem('slipstream.flip') === '-1' ? -1 : 1; } catch {}

const say = text => { $('msg').textContent = text; };
if (!/^[0-9a-f]{8}$/.test(room) || !/^[0-9a-f]{24}$/.test(joinKey)) { say('This link is incomplete. Scan the QR code on the host screen again.'); $('go').disabled = true; }
try { const saved = JSON.parse(sessionStorage.getItem(KEY)); if (saved?.playerKey) { me = saved; start(); } } catch {}

$('go').onclick = async () => {
  $('go').disabled = true; say('Joining…');
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
    online = status === 'online';
    if (!online) { lockControls(); feedback('Connection lost. Throttle reset; wait for the host.', 'disabled'); }
    $('link').textContent = status === 'online' ? '' : status === 'refused' ? 'Room closed' : 'Reconnecting…';
    if (status === 'refused') { try { sessionStorage.removeItem(KEY); } catch {} }
  }});
  setInterval(send, 66);
  navigator.wakeLock?.request?.('screen').catch(() => {});
}

function onMessage(m) {
  if (m.type === 'kicked') { lockControls(); $('car').textContent = 'Removed'; $('status').textContent = 'The host removed you.'; allowed = false; return; }
  if (m.type === 'pending') { lockControls(); allowed = false; $('car').textContent = 'Waiting…'; $('status').textContent = 'Waiting for the host to let you in.'; return; }
  if (m.type === 'approved') { allowed = true; feedback('Approved. Wait for a car, then raise the throttle.', 'ready'); $('status').textContent = 'You are in.'; return; }
  if (m.type !== 'state') return;
  lastStateAt = Date.now();
  const mine = m.me, lobby = m.lobby ?? {};
  hasCar = !!mine;
  if (releasePending && (!mine || mine.id !== releaseCar)) { releasePending = false; releaseCar = null; }
  const ready = online && allowed && !releasePending && hasCar && !mine.needsNeutral && mine.connected !== false && !mine.safetyReason && !mine.disabled && !['stopped', 'scanning'].includes(lobby.phase) && !['countdown', 'paused', 'finished'].includes(lobby.round?.status);
  const changedCar = !!mine && mine.id !== previousView?.id;
  if (!ready || changedCar) resetInputs({keepSelection: !mine});
  if (changedCar) { setSteer(0); tiltNeutral = null; feedback('Car changed. Raise the throttle when ready.', 'ready'); }
  driveReady = ready;
  $('throttle').setAttribute('aria-disabled', String(!ready));
  if (mine && previousView && previousView.id === mine.id) {
    if (mine.disabled && !previousView.disabled) feedback('Car disabled. Throttle reset.', 'disabled');
    else if (!mine.disabled && previousView.disabled) feedback('Recovered. Raise the throttle when ready.', 'recovered');
    else if (mine.assists > previousView.assists) feedback('Crew assist!', 'score');
    else if (mine.kills > previousView.kills) feedback('Knockout scored!', 'score');
    else if (Number.isFinite(mine.score) && Number.isFinite(previousView.score) && mine.score > previousView.score) feedback('+' + (mine.score - previousView.score) + ' points!', 'score');
    else if (mine.laps > previousView.laps) feedback('Lap ' + mine.laps + ' complete!', 'lap');
  }
  previousView = mine ? {...mine} : null;
  const round = lobby.round;
  if (round?.status !== previousRoundStatus) {
    if (round?.status === 'running') feedback('GO! Raise the throttle when ready.', 'ready');
    else if (round?.status === 'paused') feedback('Shared pit stop. Cars stopped. Wait for the host to clear the track and resume.', 'ready');
    else if (round?.status === 'finished') feedback('Round complete. Cars stopped — check the host for results.', 'finish');
  }
  previousRoundStatus = round?.status ?? null;
  $('mission').hidden = !round || round.status === 'idle';
  if (round && round.status !== 'idle') {
    const seconds = Math.max(0, Math.ceil((Number(round.remainingMs) || 0) / 1000));
    const time = Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    $('missionTitle').textContent = round.title || 'Round';
    $('missionTime').textContent = round.status === 'finished' ? 'Finished' : round.status === 'paused' ? 'Paused · ' + time : time;
    const objective = typeof round.objective === 'string' && round.objective.trim() ? round.objective : round.mode === 'team' ? (round.teamLaps ?? 0) + ' / ' + round.goal + ' crew laps' : round.mode === 'solo' ? 'Complete laps. Find your rhythm.' : round.mode === 'race' ? 'Most complete laps wins.' : '100 per knockout · 25 per lap';
    const task = typeof mine?.task === 'string' && mine.task.trim() ? 'Your task: ' + mine.task + ' · ' : '';
    $('missionGoal').textContent = round.status === 'countdown' ? 'Cars stay stopped. Apply throttle after GO.' : round.status === 'paused' ? 'Shared pit stop. Wait for the host to clear the track and resume.' : round.status === 'finished' ? 'Round complete. Check the host for results.' : task + objective;
  }
  document.body.classList.toggle('down', !!mine?.disabled);
  if (mine) {
    const [r, g, b] = mine.color.map(v => Math.round(v * 255));
    document.documentElement.style.setProperty('--car', `rgb(${r},${g},${b})`);
    $('car').textContent = (mine.id ? mine.id + ' · ' : '') + mine.name + (mine.crew ? ' · ' + mine.crew + ' crew' : '');
    $('energy').style.width = Math.round(mine.energy * 100) + '%'; $('energy').className = mine.energy < 0.33 ? 'low' : mine.energy < 0.66 ? 'mid' : '';
    $('status').textContent = releasePending ? 'Leaving car. Waiting for the host to confirm.' : round?.status === 'paused' ? 'Shared pit stop. All cars stopped; wait for the host.' : mine.connected === false ? 'Car disconnected. Ask the host to reconnect.' : mine.safetyReason === 'Host stopped' ? 'Cars stopped. Wait for GO or host Free drive.' : mine.safetyReason ? 'Safety stop: ' + mine.safetyReason : ({battle: 'Battle', ready: round?.status === 'running' ? 'Round live' : 'Free drive', scanning: 'Host is mapping the track', garage: 'Waiting for the track map', stopped: 'Host pressed STOP'})[lobby.phase] + ' · ' + mine.speed + ' mm/s';
    $('hits').textContent = Number.isFinite(mine.score) ? 'Score ' + mine.score + ' · Laps ' + mine.laps : 'Hits ' + mine.kills + ' · Lost ' + mine.deaths + ' · Laps ' + mine.laps;
    if (mine.assists) $('hits').textContent += ' · Assists ' + mine.assists;
    if (mine.targets?.length) $('hits').textContent += ' · Target ' + mine.targets.join(', ');
    for (const bay of ['attack', 'support', 'special']) {
      const info = mine.bays[bay], button = $(bay);
      button.hidden = !info && bay === 'special';
      button.disabled = !driveReady || lobby.phase !== 'battle';
      button.title = lobby.phase === 'battle' ? '' : 'Weapons are available in Battle rush';
      $(bay + 'Name').textContent = info ? info.label + (info.charge > 0 ? ' ' + info.charge + 's' : '') : '—';
      button.classList.toggle('wait', !!info && !info.ready);
    }
    $('cars').replaceChildren(); $('leave').hidden = false;
  } else {
    $('car').textContent = 'Waiting for a car…'; $('leave').hidden = true;
    $('energy').style.width = '0%'; $('hits').textContent = '';
    for (const bay of ['attack', 'support', 'special']) { $(bay).disabled = true; $(bay + 'Name').textContent = '—'; }
    const free = (lobby.cars ?? []).filter(c => c.free);
    $('status').textContent = free.length ? 'Pick a car:' : 'Ask the host to set a car to “Phone”.';
    $('cars').replaceChildren(...free.map(c => { const b = document.createElement('button'); b.textContent = c.name; b.onclick = () => { once.car = c.id; }; return b; }));
  }
}

function send() {
  if (!me || !link || !allowed || !online) return;
  if (Date.now() - lastStateAt > 1000) lockControls();
  const body = {...state, throttle: +state.throttle.toFixed(2), steer: +state.steer.toFixed(2), ...once, ...(releasePending ? {release:true} : {})};
  // Tilt samples and arrow buttons can change steering while controls are locked.
  // The host requires BOTH throttle and steering neutral before it can re-arm.
  // Keep lobby/release requests, but never send a driving action until ready.
  if (!driveReady || document.hidden) Object.assign(body, {throttle:0, steer:0, attack:false, support:false, special:false, uturn:false});
  const text = JSON.stringify(body), now = Date.now();
  // Always refresh a few times a second so the host's dead-man timer stays happy.
  if (text === lastSent && now - lastSentAt < 250) return;
  lastSent = text; lastSentAt = now; once = {};
  link.send(body).catch(error => { if (error.status === 404) $('link').textContent = 'Room closed'; });
}

// --- throttle slider ---------------------------------------------------------
const slider = $('throttle');
function setThrottle(value) {
  state.throttle = driveReady && !document.hidden ? Math.max(0, Math.min(1, value)) : 0;
  $('throttle').setAttribute('aria-valuenow', String(Math.round(state.throttle * 100)));
  $('fill').style.height = Math.round(state.throttle * 100) + '%'; $('pct').textContent = Math.round(state.throttle * 100);
}
function lockControls() {
  driveReady = false; resetInputs();
  $('throttle').setAttribute('aria-disabled', 'true');
  for (const bay of ['attack', 'support', 'special']) $(bay).disabled = true;
}
function resetInputs({keepSelection = false} = {}) {
  throttlePointer = null;
  const selection = keepSelection ? Object.fromEntries(Object.entries(once).filter(([key]) => key === 'car' || key === 'release')) : {};
  state.throttle = 0; state.attack = state.support = state.special = false; once = selection;
  down.clear();
  $('fill').style.height = '0%'; $('pct').textContent = '0'; $('throttle').setAttribute('aria-valuenow', '0');
  for (const bay of ['attack', 'support', 'special']) $(bay).classList.remove('on');
  lastSent = '';
}
slider.addEventListener('keydown', event => {
  if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.code)) return;
  event.preventDefault(); event.stopPropagation();
  setThrottle(event.code === 'Home' ? 0 : event.code === 'End' ? 1 : state.throttle + (event.code === 'ArrowUp' ? 0.05 : -0.05));
});
function drag(event) { const box = slider.getBoundingClientRect(); setThrottle(1 - (event.clientY - box.top - 12) / (box.height - 24)); }
slider.addEventListener('pointerdown', event => {
  if (!driveReady || document.hidden || (event.button !== undefined && event.button !== 0)) return;
  throttlePointer = event.pointerId; slider.setPointerCapture(event.pointerId); drag(event);
});
slider.addEventListener('pointermove', event => { if (throttlePointer === event.pointerId && throttlePointer !== null) drag(event); });
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) slider.addEventListener(type, event => {
  if (throttlePointer === event.pointerId) throttlePointer = null;
});
$('brake').onclick = () => { resetInputs(); send(); feedback('Braking. Throttle reset.', 'ready'); };

// --- weapons --------------------------------------------------------------------
for (const bay of ['attack', 'support', 'special']) {
  const button = $(bay);
  const set = down => { state[bay] = down && driveReady; button.classList.toggle('on', state[bay]); };
  button.addEventListener('pointerdown', event => { button.setPointerCapture(event.pointerId); set(true); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => set(false));
  // Double-tap the label area cycles weapons on cars that carry more than one.
  button.addEventListener('dblclick', () => { once.cycle = bay; });
}
$('uturn').onclick = () => { if (driveReady) once.uturn = true; };
$('leave').onclick = () => {
  if (!hasCar) return;
  releasePending = true; releaseCar = previousView?.id; lockControls(); once.release = true; send();
  feedback('Leaving car. Controls locked until the host confirms.', 'ready');
};

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
  if (event.code === 'KeyX' && driveReady) once.uturn = true;
  if (event.code === 'KeyQ') once.cycle = 'attack';
  if (event.code === 'KeyE') once.cycle = 'support';
  if (event.code === 'Escape') { resetInputs(); send(); }
  for (const [bay, codes] of Object.entries(KEYS)) if (codes.includes(event.code)) { state[bay] = driveReady; $(bay).classList.toggle('on', driveReady); }
});
addEventListener('keyup', event => {
  down.delete(event.code);
  for (const [bay, codes] of Object.entries(KEYS)) if (codes.includes(event.code)) { state[bay] = false; $(bay).classList.remove('on'); }
});
addEventListener('blur', () => { resetInputs(); send(); });
setInterval(() => {
  const up = down.has('KeyW') || down.has('ArrowUp'), slower = down.has('KeyS') || down.has('ArrowDown');
  if (up || slower) setThrottle(state.throttle + (up ? 0.045 : 0) - (slower ? 0.08 : 0));
}, 50);

// --- steering ---------------------------------------------------------------------
function setSteer(value) { state.steer = Math.max(-1, Math.min(1, value)); $('dot').style.left = (50 + state.steer * 44) + '%'; }
$('left').onclick = () => setSteer(Math.round(state.steer * 3 - 1) / 3);
$('right').onclick = () => setSteer(Math.round(state.steer * 3 + 1) / 3);
function onTilt(event) {
  if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
  // Only a device that really reports motion counts as having tilt steering.
  if (tiltWanted && !tiltOn) { tiltOn = true; $('tilt').textContent = 'Tilt on'; $('tilt').classList.add('on'); $('flip').hidden = false; $('centerTilt').hidden = false; }
  if (!tiltOn) return;
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  const degrees = angle === 90 ? event.beta : angle === 270 || angle === -90 ? -event.beta : event.gamma;
  tiltSample = degrees;
  if (tiltNeutral === null || tiltAngle !== angle) { tiltNeutral = degrees; tiltAngle = angle; }
  const relative = degrees - tiltNeutral;
  const dead = Math.abs(relative) < 3 ? 0 : relative - Math.sign(relative) * 3;
  setSteer(flip * dead / 24);
}
async function askTilt() {
  if (typeof DeviceOrientationEvent === 'undefined') return false;
  try {
    if (typeof DeviceOrientationEvent.requestPermission === 'function' && await DeviceOrientationEvent.requestPermission() !== 'granted') return false;
  } catch { return false; }
  if (!listening) { addEventListener('deviceorientation', onTilt); listening = true; }
  tiltNeutral = null; tiltWanted = true;
  return true;
}
$('tilt').onclick = async () => {
  if (tiltOn) { tiltOn = false; tiltWanted = false; $('tilt').textContent = 'Tilt steering'; $('tilt').classList.remove('on'); $('flip').hidden = true; $('centerTilt').hidden = true; setSteer(0); return; }
  if (!await askTilt()) { $('status').textContent = 'Tilt is not available here. Use the arrow buttons.'; return; }
  setTimeout(() => { if (!tiltOn) $('link').textContent = 'No motion sensor found: use the arrows or A / D'; }, 1200);
};
$('centerTilt').onclick = () => { if (tiltSample !== null) { tiltNeutral = tiltSample; setSteer(0); feedback('Steering centered. Hold the phone comfortably.', 'ready'); } };
$('flip').onclick = () => { flip = -flip; try { sessionStorage.setItem('slipstream.flip', String(flip)); } catch {} };
document.addEventListener('visibilitychange', () => { if (document.hidden) { resetInputs(); send(); } });
addEventListener('contextmenu', event => event.preventDefault());
