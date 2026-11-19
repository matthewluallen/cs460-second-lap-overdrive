// Host page: owns the Bluetooth links, runs the game loop, draws the map and
// relays phone players. Nothing here trusts text from a car or a phone as HTML.
import {Game, TEAM_COLORS} from './game.mjs';
import {trackFromPlan, trackValidation} from './track.mjs';
import {SimWorld, LAYOUTS} from './sim.mjs';
import {chooseCar, bluetoothAvailable} from './ble.mjs';
import {Renderer} from './render.mjs';
import {WEAPON_LABEL} from './battle.mjs';
import {api, channel} from './net.mjs';
import {Recorder} from './trace.mjs';
import {RoundSession, ROUND_MODES, STORY_MISSIONS} from './session.mjs';
import {mountStudentLab} from './student-lab.mjs';
import {rgb} from './protocol.mjs';
import {DriveNarrator, cameraCar} from './camera-director.mjs';
import {drivingReadiness} from './readiness.mjs';
import {buildRunReport, renderRunReportText} from './run-report.mjs';
import {AudioCues} from './audio-cues.mjs';
import {ScreenAwake} from './wake-lock.mjs';

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
const load = name => fetch('data/' + name + '.json', {cache: 'no-store'}).then(r => { if (!r.ok) throw new Error('Could not load ' + name); return r.json(); });
const SAVED = 'slipstream.track.v1';
const isStudent = () => document.body.dataset.view !== 'advanced';
document.body.dataset.view = isStudent() ? 'student' : 'advanced';

const [pieces, vehicles, weapons] = await Promise.all([load('pieces'), load('vehicles'), load('weapons')]);
const game = new Game({pieces, vehicles, weapons, log});
game.topSpeed = isStudent() ? 300 : 400;
$('top').value = game.topSpeed;
if (isStudent()) game.halted = true;
const world = new SimWorld(game.pieces, 'Capsule');
const mapRenderer = new Renderer($('map'));
let renderer = mapRenderer, studioRenderer = null, studioLoading = false, requestedView = '2d';
const recorder = new Recorder();
const narrator = new DriveNarrator();
const sound = new AudioCues({document,now:()=>performance.now(),onStatus:state=>{
  $('soundStatus').textContent=state.text; $('soundToggle').textContent=state.state==='on'?'Mute sound':'Enable sound';
  $('soundToggle').disabled=state.state==='unsupported'; $('soundToggle').setAttribute('aria-pressed',String(state.state==='on'));
}});
const screenAwake = new ScreenAwake({document,wakeLock:navigator.wakeLock,onStatus:state=>{
  $('wakeStatus').textContent=state.text; $('wakeRetry').disabled=!state.active||['unsupported','held','requesting'].includes(state.state);
}});
$('soundVolume').value='20'; $('engineSound').checked=false;
$('soundToggle').onclick=()=>{if(sound.snapshot().state==='on')sound.disable();else void sound.enable();};
$('soundVolume').oninput=()=>sound.setVolume(Number($('soundVolume').value)/100);
$('engineSound').onchange=()=>sound.setEngine($('engineSound').checked);
$('wakeRetry').onclick=()=>screenAwake.retry();
function updateComfort(snapshot,now) {
  screenAwake.setActive(game.drivers.some(d=>d.car.connected));
  const requested=Number($('cameraCar').value),car=requested?snapshot.find(s=>s.id===requested):snapshot.find(s=>s.connected&&s.located&&s.speed>0)??snapshot.find(s=>s.connected&&s.located)??snapshot[0];
  sound.update({online:car?.connected===true,halted:game.halted||!!car?.safetyReason,carId:car?.id??null,speed:car?.speed??0,fresh:car?.located===true,
    telemetryState:car?.telemetryHealth?.state??'normal',lap:car?.laps??null,powerZone:car?.powerZone?.effect?.type??null,countdown:countdown?Math.max(1,Math.ceil((countdown.until-now)/1000)):null});
}
addEventListener('pagehide',()=>{sound.dispose();screenAwake.dispose();});
$('cameraMode').value='orbit'; $('cameraCar').value='0'; $('commentaryMode').value='captions';
const session = new RoundSession();
let countdown = null, sessionResultShown = false;
let scanAttempt = null, scanNotice = '';
let activeMission = null, activeExperience = 'arcade', recordEligible = true;
window.slipstream = {game, world, recorder, get transport() { return room?.link.transport ?? null; }};                        // for the browser console and tests

function log(text) {
  recorder.mark('log',{text:String(text).slice(0,1000)});
  const list = $('log');
  list.prepend(el('li', {textContent: new Date().toLocaleTimeString() + '  ' + text}));
  while (list.children.length > 60) list.lastChild.remove();
}

// --- garage --------------------------------------------------------------------
const cards = new Map();           // driver -> DOM refs
const CONTROLS = [['none', 'Parked'], ['browser', 'On-screen controls'], ['keys1', 'Keyboard W A S D'], ['keys2', 'Keyboard arrows'], ['gamepad', 'Gamepad'], ['phone', 'Phone or link'], ['bot', 'Computer']];
const MODELS = Object.entries(vehicles.models).filter(([, m]) => !['Future', 'Unrecognized'].includes(m.name)).sort((a, b) => a[1].name.localeCompare(b[1].name));
const connectionLabel = driver => driver.car.simulated ? 'Simulator' : driver.car.transport.initializationProfile === 'sdk'
  ? (driver.car.transport.initializationOptions?.plasticTrack === true ? 'Classic SDK · plastic-track comparison' : 'Classic SDK')
  : driver.car.transport.initializationProfile === 'fast-furious' ? 'Fast & Furious · experimental' : 'Unspecified connection';
const colorHex = color => '#' + color.map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const colorPacketKey = color => [...rgb(...color)].join(',');
function assignDistinctColor(driver) {
  const used = new Set(game.drivers.filter(d => d !== driver).map(d => colorPacketKey(d.car.color)));
  if (used.has(colorPacketKey(driver.car.color))) driver.car.color = TEAM_COLORS.find(c => !used.has(colorPacketKey(c)));
}
const phoneUrl = fragment => location.origin + '/slipstream/pad.html' + (isStudent() ? '?view=student' : '') + '#' + fragment;
function canChooseColor(driver) {
  return driver.car.connected && !driver.car.initializing && !driver.car.faulted && game.halted && !countdown && !game.diagnostic && !game.laneCancellationComparison && !game.forwardBaseline && game.phase !== 'scanning' && game.drivers.every(d => d.car.speed === 0);
}

function addCard(driver) {
  const model = el('select', {title: 'Car model'}), control = el('select', {title: 'Who drives'});
  if (!driver.car.model) model.append(new Option('Unidentified car — choose model', '0'));
  for (const [id, m] of MODELS) model.append(new Option(m.name + (m.truck ? ' (truck)' : ''), id));
  for (const [id, label] of CONTROLS) control.append(new Option(label, id));
  model.value = String(driver.car.model); control.value = driver.control;
  const crew = el('select', {title: 'Battle crew'});
  crew.setAttribute('aria-label', 'Battle alliance');
  for (const [id, label] of [['', 'Independent racer'], ['sun', 'Sun crew'], ['moon', 'Moon crew']]) crew.append(new Option(label, id));
  crew.onchange = () => { if (session.status === 'running' || session.status === 'paused' || countdown) halt('Crew changed'); game.setCrew(driver, crew.value); refresh(); };
  const task = el('p', {className: 'driver-task', hidden: true});
  const locationReference = el('p', {className:'note'});
  const name = el('span', {className: 'name', textContent: driver.id + ' · ' + driver.car.name});
  const connection = el('p', {className:'note', textContent:'Connection: '+connectionLabel(driver)});
  const pairing = el('p', {className:'note pairing-identity', textContent:driver.car.simulated ? 'Practice car · simulator' : 'Paired Bluetooth name: ' + (driver.car.transport.name || 'Name not provided')});
  const modelNote = el('p', {className:'note', textContent:driver.car.model ? 'Check that the model matches your car.' : 'Choose the model printed on your car. Its Bluetooth name does not identify the model.'});
  const color = el('input', {type:'color', className:'car-color', value:colorHex(driver.car.color)});
  color.setAttribute('aria-label', driver.car.name + ' LED color');
  const colorStatus = el('p', {className:'note', textContent:'LED color ' + color.value.toUpperCase() + ' · check the light on your car.'});
  const screen = el('button', {className:'student-screen', textContent:'Drive here'});
  const phone = el('button', {className:'student-phone', textContent:'Phone / QR'});
  const phoneStatus = el('p', {className:'note student-only', textContent:''});
  const tag = el('span', {className: 'tag', textContent: driver.car.simulated ? 'sim' : 'live'});
  const remove = el('button', {className: 'small', textContent: '✕', title: 'Disconnect'});
  const code = el('button', {className: 'small advanced-only', textContent: 'Code', title: 'Show this car\'s own join code'});
  const seatCanvas = el('canvas', {width: 164, height: 164, className: 'seatqr'});
  const seatLink = el('input', {readOnly: true, className: 'seatlink'});
  const seatBox = el('div', {className: 'seat', hidden: true}, seatCanvas, el('p', {className: 'note', textContent: 'Scan to drive this car from a phone, or open the link on a laptop.'}), seatLink);
  const energy = el('i'), speed = el('i');
  const recover = el('button', {className: 'recovery', textContent: 'Stopped on track · Recover', hidden: true});
  recover.onclick = () => { if (document.hidden) return; game.recoverCar(driver); driver.level = 0; if (driver.pad) driver.pad.throttle = 0; refresh(); };
  const refreshHealth = el('button', {textContent:'Refresh battery (stopped)'});
  refreshHealth.onclick = () => { if (game.drivers.some(d=>d.car.speed>0) || countdown || game.diagnostic) return; driver.car.refreshBattery(); log('Battery refresh requested; wait for a new sample'); };
  const diagnostic = el('button', {textContent:'Clear track · 0.5 s straight test', title:'Supervise beside the car. Three-second countdown, then at most 150 mm/s; host timing cannot guarantee a stop after Bluetooth loss.'});
  const steeringTest = el('button', {textContent:'Clear track · one left-lane test', title:'Supervise beside the car. Three-second countdown; at most 300 mm/s for four seconds. One left request only after a readable straight code; automatic STOP.'});
  const rightSteeringTest = el('button', {textContent:'Clear track · one right-lane test', title:'Supervise beside the car. Three-second countdown; at most 300 mm/s for four seconds. One right request only after a readable straight code; automatic STOP.'});
  const forwardBaseline = el('button', {textContent:'Supervised · 3 forward laps', title:'One Computer-driven car on a scanned track. Three-second countdown, at most 300 mm/s, three full laps or a two-minute host limit. Normal optical calibration stays active; no lane changes, U-turns or attacks. Remain beside the track.'});
  forwardBaseline.onclick = () => {
    try {
      requireVisible();
      if (countdown || game.diagnostic || game.laneCancellationComparison || game.forwardBaseline || session.status==='running' || session.status==='paused' || game.pitReason || game.drivers.some(d=>d.car.speed>0)) throw new Error('Stop the session and clear the pit first');
      if (driver.control!=='bot') throw new Error('Choose Computer for the forward check');
      if (!game.track?.closed || game.track.inferredCount) throw new Error('Scan an identified closed track before the forward check');
      halt('Preparing supervised forward check'); session.reset(); activeMission=null;
      if (!recorder.active) { recorder.start(game.drivers,'Supervised forward baseline; recording started after connection'); $('record').textContent='Stop recording'; }
      countdown={kind:'forward-baseline',driverId:driver.id,until:performance.now()+3000};
      $('roundHelp').textContent='Supervised forward check: stay beside the clear track. Normal optical calibration remains active; no lane changes, U-turns or attacks.';
      recorder.mark('forward-baseline-request',{carId:driver.id,ceiling:Math.min(300,game.topSpeed),targetLaps:3,maximumMs:120000,calibration:'ordinary-printed-code',maneuvers:'disabled'});
      log('Forward-check countdown: begin before start/finish, supervise beside the clear track. Three full laps at no more than 300 mm/s; optical calibration remains active.'); renderRound();
    } catch(error) { log(error.message); }
  };
  const cancellationComparison = el('button', {textContent:'Supervised · cancellation comparison', title:'Place the sensor just before the start/finish codes. Forward-only acquisition must read that anchor and a consistent follow-up within five seconds before Computer steering unlocks. Ceiling 300 mm/s. Remain beside the track; STOP stays available.'});
  cancellationComparison.onclick = () => {
    try {
      requireVisible();
      if (countdown || game.diagnostic || game.laneCancellationComparison || game.forwardBaseline || session.status==='running' || session.status==='paused' || game.pitReason || game.drivers.some(d=>d.car.speed>0)) throw new Error('Stop the session and clear the pit first');
      if (driver.control!=='bot') throw new Error('Choose Computer for the supervised comparison');
      halt('Preparing supervised cancellation comparison'); session.reset(); activeMission=null;
      if (!recorder.active) { recorder.start(game.drivers,'Supervised lane-cancellation comparison'); $('record').textContent='Stop recording'; }
      countdown={kind:'lane-cancellation-comparison',driverId:driver.id,until:performance.now()+3000};
      recorder.mark('lane-cancellation-comparison-request',{carId:driver.id,ceiling:Math.min(300,game.topSpeed),referencePolicy:'fresh-start-finish-and-consistent-followup',onCancellation:'lock-steering-continue-forward'});
      log('Supervised comparison countdown: start/finish reference first; lane commands and offset calibration stay locked until confirmed. STOP remains available'); renderRound();
    } catch(error) { log(error.message); }
  };
  const prepareDiagnostic = (steering, direction = 1) => {
    try {
      requireVisible();
      if (countdown || game.diagnostic || game.laneCancellationComparison || game.forwardBaseline || session.status==='running' || session.status==='paused' || game.pitReason || game.drivers.some(d=>d.car.speed>0)) throw new Error('Stop the session and clear the pit first');
      halt('Preparing supervised diagnostic');
      if (steering && (!game.track || game.track.inferredCount)) throw new Error('Scan an identified track before the lane test');
      countdown={kind:'diagnostic',driverId:driver.id,steering,direction,until:performance.now()+3000};
      recorder.mark('diagnostic-request',{carId:driver.id,steering,direction:steering?direction:null,maximumMs:steering?4000:500,ceiling:Math.min(steering?300:150,game.topSpeed)});
      log(steering?'Supervised lane-test countdown: watch for one '+(direction===-1?'right':'left')+' shift':'Supervised diagnostic countdown: track clear, watch the car'); renderRound();
    } catch(error) { log(error.message); }
  };
  diagnostic.onclick = () => prepareDiagnostic(false);
  steeringTest.onclick = () => prepareDiagnostic(true, 1);
  rightSteeringTest.onclick = () => prepareDiagnostic(true, -1);
  const throttle = el('input', {type: 'range', min: 0, max: 100, value: 0, step: 5});
  throttle.setAttribute('aria-label', driver.car.name + ' throttle');
  throttle.oninput = () => { if (driver.control === 'browser' && !game.halted && !driver.car.safetyReason) driver.level = Number(throttle.value) / 100; else throttle.value = 0; };
  const leftButton = el('button', {textContent: '← Lane', title: 'Move one lane left'}), rightButton = el('button', {textContent: 'Lane →', title: 'Move one lane right'});
  leftButton.onclick = () => { if (!game.halted && !driver.car.safetyReason) game.nudge(driver, 1); };
  rightButton.onclick = () => { if (!game.halted && !driver.car.safetyReason) game.nudge(driver, -1); };
  const brake = el('button', {textContent: 'Brake', className: 'brake'});
  brake.onclick = () => { if (game.diagnostic || countdown?.kind==='diagnostic') halt('Diagnostic cancelled'); driver.level = 0; driver.input.throttle = 0; throttle.value = 0; driver.car.stop(); };
  const browserControls = el('div', {className: 'browser-controls', hidden: true}, el('label', {textContent: 'Throttle'}, throttle), el('div', {className: 'row'}, leftButton, brake, rightButton));
  const fireRow = el('div', {className: 'row advanced-only'});
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
  for (const node of [locationReference, weaponsBox, refreshHealth, forwardBaseline, diagnostic, steeringTest, rightSteeringTest, cancellationComparison]) node.className += ' advanced-only';
  const card = el('div', {className: 'car'},
    el('div', {className: 'top'}, name, tag, code, remove),
    pairing, connection, el('div', {className: 'grid'}, el('label', {className:'field',textContent:'Car model'}, model), el('label', {className:'field advanced-only',textContent:'Who drives'}, control)), modelNote,
    el('label', {className:'field',textContent:'Your car’s LED color'}, color), colorStatus,
    el('div', {className:'student-driver-actions student-only'}, screen, phone), phoneStatus,
    el('label', {className: 'field advanced-only', textContent: 'Battle alliance'}, crew),
    el('div', {className: 'bar advanced-only'}, energy), el('div', {className: 'bar speed advanced-only'}, speed),
    el('div', {className: 'meta'}, left, right), locationReference, weaponsBox, recover, task, browserControls, refreshHealth, forwardBaseline, diagnostic, steeringTest, rightSteeringTest, cancellationComparison, seatBox);
  let makingSeat = false, seatRequest = 0;
  const cancelSeat = () => { seatRequest++; seatBox.hidden = true; };
  const showSeat = async (toggle = false) => {
    if (makingSeat) return;
    if (toggle && !seatBox.hidden) { seatBox.hidden = true; return; }
    makingSeat = true;
    const request = ++seatRequest;
    const current = () => request === seatRequest && game.drivers.includes(driver) && driver.car.connected;
    try {
      phoneStatus.textContent = 'Opening this car’s phone code…';
      await openRoom();
      if (!current()) return;
      if (driver.inviteRevocationRoom === room.room && driver.inviteRevocation && !await driver.inviteRevocation) throw new Error('The previous invitation could not be retired. Choose Phone / QR to retry.');
      if (!current()) return;
      const seat = await api('/rooms/' + room.room + '/seats', {method: 'POST', key: room.hostKey, body: {car: driver.id}});
      if (!current()) return;
      const url = phoneUrl('r=' + room.room + '&s=' + seat.seatKey);
      seatLink.value = url; await drawQr(seatCanvas, url); if (!current()) return; seatBox.hidden = false;
      phoneStatus.textContent = 'Scan this code, then choose Let in below. Start driving keeps the phone’s hold-to-drive control in charge.';
    } catch (error) {
      if (!current()) return;
      const message = 'Phone code unavailable: ' + error.message;
      phoneStatus.textContent = message; $('roomNote').textContent = message;
      if (!isStudent() && !$('hostCode').value.trim()) { $('codeField').hidden = false; $('hostCode').focus(); $('remotePlayers').scrollIntoView?.({block:'nearest'}); }
      log(message);
    } finally { makingSeat = false; }
  };
  code.onclick = () => showSeat(true);
  seatLink.onfocus = () => seatLink.select();
  card.style.setProperty('--c', `rgb(${driver.car.color.map(v => Math.round(v * 255)).join()})`);
  model.onchange = () => { if (isStudent() || session.status === 'running' || session.status === 'paused' || countdown) halt('Car changed'); game.setModel(driver, Number(model.value)); driver.car.name = game.modelName(driver.car.model); name.textContent = driver.id + ' · ' + driver.car.name; modelNote.textContent = 'Model selected by you: ' + driver.car.name; color.setAttribute('aria-label', driver.car.name + ' LED color'); throttle.setAttribute('aria-label', driver.car.name + ' throttle'); refresh(); };
  control.onchange = () => { control.blur?.(); cancelSeat(); if(control.value!==driver.control)revokeCarInvite(driver); if (isStudent() || session.status === 'running' || session.status === 'paused' || countdown) halt('Driver changed'); releasePad(driver, true); driver.level = 0; game.setControl(driver, control.value); driver.car.stop(); refresh(); };
  screen.onclick = () => { screen.blur(); control.value = 'browser'; control.onchange(); seatBox.hidden = true; phoneStatus.textContent = 'On-screen controls selected. Choose Start driving, then apply throttle.'; };
  phone.onclick = async () => { phone.blur(); if(driver.control!=='phone'){control.value = 'phone';control.onchange();}else if(isStudent())halt('Preparing phone controls');if(driver.inviteRevocationFailed)await revokeCarInvite(driver);await showSeat(); };
  color.onchange = () => {
    const next = color.value.toLowerCase();
    const valid = /^#[0-9a-f]{6}$/.test(next), channels = valid ? [1,3,5].map(i => parseInt(next.slice(i,i+2),16) / 255) : null;
    const refusal = !valid ? 'Choose a valid six-digit color.' : !canChooseColor(driver) ? 'Stop the cars and finish connecting before changing the LED color.' : colorPacketKey(channels) === colorPacketKey([0,0,0]) ? 'Choose a brighter color so you can identify the car.' : game.drivers.some(d => d !== driver && colorPacketKey(d.car.color) === colorPacketKey(channels)) ? 'Another car already uses this LED color. Choose a different color.' : '';
    if (refusal) { color.value = colorHex(driver.car.color); colorStatus.textContent = refusal; return; }
    driver.car.color = channels;
    driver.car.setLights(...driver.car.color);
    card.style.setProperty('--c', next); colorStatus.textContent = 'LED color ' + next.toUpperCase() + ' requested · check the light on your car.';
    recorder.mark('car-color-request',{carId:driver.id,color:next});
  };
  remove.onclick = async () => { if (session.status === 'running' || session.status === 'paused' || countdown) halt('Car disconnected'); revokeCarInvite(driver);releasePad(driver, true); if (driver.sim) world.removeCar(driver.sim); await game.removeCar(driver); card.remove(); cards.delete(driver); refresh(); };
  recorder.add(driver);
  $('cars').append(card); cards.set(driver, {card, model, modelNote, pairing, color, colorStatus, screen, phone, phoneStatus, energy, speed, left, right, locationReference, weaponsBox, control, name, connection, seatBox, seatLink, cancelSeat, recover, browserControls, throttle, leftButton, rightButton, fireRow, task, cancellationComparison, forwardBaseline});
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
  if (isStudent()) halt('Adding a practice car');
  const driver = game.addCar(sim, {model: Number(next[0]), simulated: true, control: isStudent() ? 'browser' : game.drivers.some(d => d.control === 'keys1') ? 'bot' : 'keys1', beforeStart:assignDistinctColor});
  driver.sim = sim; if (driver.control === 'bot') game.setControl(driver, 'bot');
  addCard(driver); log('Added simulated ' + driver.car.name);
};
const showKitNote=()=>{
  $('kitNote').hidden=false;
  $('kitNote').textContent='This choice applies to the next Connect car, separately from Car model. '+($('kit').value==='sdk-plastic'
    ? 'Explicit comparison: request the plastic-track parser with jump boosts off. Connecting does not start the car; firmware application is unconfirmed.'
    : 'Classic SDK previously scanned Groundshock; current reliability is unverified. Fast & Furious remains experimental.');
};
const KIT_CHOICES=['fast-furious','sdk','sdk-plastic'],KIT_STORAGE='slipstream.kit.v1';
$('kit').value='sdk';
try { const savedKit=localStorage.getItem(KIT_STORAGE); if(KIT_CHOICES.includes(savedKit))$('kit').value=savedKit; } catch {}
$('kit').onchange=()=>{showKitNote();if(KIT_CHOICES.includes($('kit').value))try{localStorage.setItem(KIT_STORAGE,$('kit').value);}catch{}};showKitNote();
if (!bluetoothAvailable()) { $('bleNote').textContent = 'Bluetooth is not available in this browser. Use desktop Chrome or Edge on HTTPS or localhost. Simulated cars still work.'; $('bleNote').classList.add('bad'); $('connect').disabled = true; }
else $('bleNote').textContent = 'Select drivers, then explicitly start. Keep the track clear and someone next to it.';
$('connect').onclick = async event => {
  try {
    if (game.drivers.length >= 4) throw new Error('The garage holds four cars. Disconnect one first.');
    const kit=$('kit').value; // the explicit choice belongs to this connection attempt
    const link = await chooseCar(event.shiftKey);
    if (game.drivers.some(d => d.car.connected && d.car.transport.id === link.id)) throw new Error('This car is already in the pit crew. Use its existing controls.');
    log('Connecting to ' + (link.name || 'car') + '…');
    try { await link.open(); } catch (error) { link.close(); throw error; }
    const model = link.model && vehicles.models[String(link.model)] ? link.model : 0;
    link.initializationProfile = ['sdk','sdk-plastic'].includes(kit) ? 'sdk' : 'fast-furious';
    link.initializationOptions = kit==='sdk-plastic' ? {plasticTrack:true} : {};
    if (game.drivers.length >= 4 || document.hidden) { link.close(); throw new Error('Connection cancelled: return to the host tab with an available garage slot.'); }
    if (isStudent()) halt('Connecting a car');
    const driver = game.addCar(link, {model, name: model ? vehicles.models[String(model)].name : 'Unidentified car', control: isStudent() ? 'browser' : 'none', beforeStart: d => {
      assignDistinctColor(d);
      if (!recorder.active) recorder.start(game.drivers.filter(x=>!x.car.simulated), 'Hardware connection and initialization');
      recorder.add(d); $('record').textContent='Stop recording'; $('saveTrace').disabled=false; $('traceNote').textContent='Recording from initialization…';
    }});
    recorder.mark('connection-options',{carId:driver.id,profile:link.initializationProfile,sdkPlasticTrackRequested:link.initializationOptions.plasticTrack===true});
    link.onClose(() => driver.car.connectionLost());
    addCard(driver);
    log('Initializing ' + driver.car.name + ' (' + link.initializationProfile + (link.initializationOptions.plasticTrack?' · plastic-track comparison':'') + ')…');
    await driver.car.initialization;
    refresh();
    log(driver.car.initializationStatus + (model ? '' : '. Model not reported; no Groundshock identity assumed.'));
  } catch (error) { if (error.name !== 'NotFoundError') log('Connect failed: ' + error.message); }
};

// --- top bar ---------------------------------------------------------------------
function sampleScanCounts() {
  if (!scanAttempt?.started) return;
  const t=scanAttempt.driver.car.telemetry;
  scanAttempt.positions=Math.max(0,t.positions-scanAttempt.positionsBefore);
  scanAttempt.transitions=Math.max(0,t.transitions-scanAttempt.transitionsBefore);
}
function renderScanStatus() {
  const attempt=scanAttempt;
  if(attempt?.stage==='scanning') {
    sampleScanCounts();
    if(game.phase!=='scanning' || game.scanner!==attempt.driver) {
      attempt.stage='stopped';attempt.reason??=game.pitReason||'Scan ended';
    }
  } else if(attempt?.stage==='countdown' && countdown?.kind!=='scan') {
    attempt.stage='stopped';attempt.reason??='Countdown cancelled';
  }
  const selected=attempt?.driver??game.drivers.find(d=>d.id===Number($('scanCar').value));
  const connection=selected?'Connection: '+connectionLabel(selected)+'. ':'';
  let text=scanNotice?scanNotice+' ':'';
  if(attempt && (!isStudent() || !scanNotice)) {
    text+=(attempt.stage==='countdown'?'Scan countdown · '+attempt.driver.car.name+'. Cars remain stopped until GO. '
      :attempt.stage==='scanning'?'Scanning · '+attempt.driver.car.name+'. '+(attempt.positions?'Building the map. ':'Waiting for printed track codes. ')
      :attempt.stage==='complete'?'Scan mapped '+attempt.pieces+' pieces. STOP requested; confirm the physical stop and map. '
      :'Scan stopped: '+attempt.reason+'. STOP requested; confirm the car is physically stopped. ');
    if (!isStudent()) {
      text+=connection+attempt.positions+' optical positions · '+attempt.transitions+' transitions received during this attempt. ';
      if(attempt.stage!=='countdown'&&!attempt.positions)text+='No optical position codes received; movement is unconfirmed. ';
    } else if(attempt.stage==='stopped'&&!attempt.positions)text+='No printed track codes were received. ';
  } else if (!isStudent()) text+=connection;
  if(game.pitReason)text+=isStudent()?'Confirm the car is stopped on track. Recover each affected car, then Clear pit · keep stopped. Choose Scan track to retry.':'Use each affected car’s Recover button after confirming it is stopped on track, then Clear pit · keep stopped. A retry needs a separate Scan track countdown.';
  $('scanStatus').hidden=!scanNotice&&!attempt;
  $('scanStatus').textContent=text;
  $('scanStatus').classList.toggle('bad',!!scanNotice||attempt?.stage==='stopped');
}
$('scan').onclick = () => {
  if (game.phase === 'scanning') return halt('Scan cancelled');
  try {
    requireVisible();
    if(countdown)throw new Error('Complete or cancel the current countdown first');
    if(game.pitReason)throw new Error(game.pitReason+'. Recover affected cars, then Clear pit · keep stopped before retrying');
    const driver=game.drivers.find(d=>d.id===Number($('scanCar').value));
    if(!driver || !driver.car.connected)throw new Error('Choose the connected car to scan');
    if(!$('scanClear').checked)throw new Error('Confirm the track is clear, the car is on a printed lane, and you are watching');
    const raw=$('scanLateral').value.trim(),startingLateral=raw===''?null:Number(raw);
    if(startingLateral!==null&&(!Number.isFinite(startingLateral)||Math.abs(startingLateral)>68||!$('scanCalibrationConfirmed').checked))throw new Error('Measure a starting position within 68 mm and confirm it, or leave calibration blank');
    if(!recorder.active){recorder.start(game.drivers,'Scan attempt');$('record').textContent='Stop recording';}
    endRound('Track scan');game.stopAll();
    countdown={kind:'scan',scanner:driver.id,startingLateral,until:performance.now()+3000};
    scanNotice='';scanAttempt={driver,stage:'countdown',started:false,positions:0,transitions:0};
    recorder.mark('scan-request',{carId:driver.id,startingLateral,profile:driver.car.transport.initializationProfile??null,safety:{...game.safety},ceiling:game.topSpeed});
    $('scanLateral').value='';$('scanCalibrationConfirmed').checked=false;$('scanClear').checked=false;
    $('roundHelp').textContent='Scanning with '+driver.car.name+' after the countdown. Other cars remain stopped.';renderRound();
  } catch(error) {scanNotice='Scan not started: '+error.message+'.';renderScanStatus();log(error.message);}
};
$('battle').onclick = () => beginRound();
$('stop').onclick = () => halt('Host stopped');
$('resume').onclick = () => { if (countdown || game.pitReason) return; try { requireVisible(); if(isStudent() && !studentDriveReady())throw new Error(drivingReadiness(game,{countdown,now:performance.now()}).blockers.join(' ')||'Driving is already enabled.'); session.reset(); activeMission = null; if (game.drivers.some(d => d.control === 'bot')) { game.stopAll(); countdown = {kind:'free', until:performance.now()+3000, ids:game.drivers.filter(d=>d.control!=='none').map(d=>d.id)}; renderRound(); return; } game.resume(); $('results').hidden = true; log('Free drive ready. Apply throttle to move.'); refresh(); } catch (error) { log(error.message); } };
$('top').oninput = () => { if (session.status === 'running') recordEligible = false; game.topSpeed = Number($('top').value); syncDrivingSettings(); };
function syncDrivingSettings() {
  const speed=String(game.topSpeed);
  if(![...$('studentMaxSpeed').children].some(n=>String(n.value)===speed)) $('studentMaxSpeed').append(new Option(speed+' mm/s',speed));
  $('studentMaxSpeed').value=speed; $('top').value=speed;
  $('topLabel').textContent='Speed ceiling '+speed+' mm/s';
  $('accelerationMode').value=String(game.rampMs); $('telemetryMode').value=String(game.telemetryGraceMs);
  $('powerZoneMode').value=game.powerZoneMode??'off';
}
function drivingSettingsStopped() {
  return game.halted && !countdown && !game.diagnostic && !game.forwardBaseline && !game.laneCancellationComparison && game.phase!=='scanning' && game.drivers.every(d=>d.car.speed===0);
}
for(const id of ['studentMaxSpeed','accelerationMode','telemetryMode']) $(id).onchange=()=>{
  try {
    if(!drivingSettingsStopped()) throw new Error('Choose STOP before changing driving settings.');
    const settings=game.setDrivingOptions({maximumSpeed:Number($('studentMaxSpeed').value),rampMs:Number($('accelerationMode').value),telemetryGraceMs:Number($('telemetryMode').value)});
    recorder.mark('driving-settings',settings);
    $('drivingSettingsNote').textContent='Maximum '+settings.maximumSpeed+' mm/s · '+(settings.rampMs?settings.rampMs/1000+' s acceleration ramp':'direct throttle')+' · '+(settings.telemetryGraceMs?'brief-gap recovery, hard stop at 3 s':'strict 2 s telemetry stop')+'. Scans stay at or below 300 mm/s.';
  } catch(error) { $('drivingSettingsNote').textContent=error.message; }
  syncDrivingSettings(); $(id).blur();
};
$('powerZoneMode').onchange=()=>{
  try {
    if(!drivingSettingsStopped()) throw new Error('Choose STOP before changing the Power Zone rule.');
    game.setPowerZoneMode($('powerZoneMode').value);
    recorder.mark('power-zone-rule',{mode:game.powerZoneMode});
  } catch(error) { log(error.message); }
  syncDrivingSettings(); $('powerZoneMode').blur(); refresh();
};

game.onTrack = track => {
  if(scanAttempt?.stage==='scanning'){sampleScanCounts();scanAttempt.stage='complete';scanAttempt.pieces=track.count;}
  if (!game.drivers.every(d => d.car.simulated)) try { localStorage.setItem(SAVED, JSON.stringify(track.toJSON())); } catch {}
};
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
  try { requireVisible(); if(countdown) return; if(!game.pitReady) throw new Error('Recover or remove affected cars first'); held.clear(); countdown={kind:'pit',until:performance.now()+3000};log('Track clear acknowledged. Waiting for countdown.');refresh(); }
  catch (error) { $('pitMessage').textContent = error.message; }
};
$('pitClearStopped').onclick = () => {
  try {
    requireVisible();if(countdown)throw new Error('Cancel the countdown before clearing the pit');
    if(!game.clearPitStopped())return;
    endRound('Pit cleared without resuming');session.reset();activeMission=null;held.clear();$('results').hidden=true;
    scanNotice='Pit cleared; all cars remain stopped. Confirm the track is clear, then choose Scan track for a new countdown.';
    recorder.mark('pit-cleared-stopped');refresh();
  } catch(error) {scanNotice=error.message+'.';renderScanStatus();$('pitMessage').textContent=error.message;}
};
function halt(reason = 'Host stopped') { if(['countdown','scanning'].includes(scanAttempt?.stage))scanAttempt.reason=reason;endRound(reason); game.stopAll(); held.clear(); renderRound(); }
function modeInfo() {
  const mode = $('mode').value, mission = STORY_MISSIONS.find(m => m.id === $('mission').value);
  $('modeDescription').textContent = experience === 'story' ? mission.briefing : ROUND_MODES[mode].description;
  $('missionField').hidden = experience !== 'story';
  $('roundHelp').textContent = experience === 'story' ? 'A shared mission for 1–4 human or computer drivers. Each car must scan, carry and deliver its signal. Nobody can finish another driver’s job.' : mode === 'precision' ? '1–4 cars · match each gate’s lane and speed · 90 seconds' : mode === 'solo' ? '1–4 cars · individual best laps · 90 seconds' : mode === 'team' ? '1–4 cars · shared lap goal · 2 minutes' : '2–4 cars · human, computer, or a mix · 2 minutes';
}
function chooseExperience(value) {
  if (session.status === 'running' || session.status === 'paused' || countdown || game.forwardBaseline) return;
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
    if (session.status === 'running' || session.status === 'paused' || countdown || game.forwardBaseline) return;
    if (game.pitReason) throw new Error('Complete the shared pit recovery before starting.');
    if (!game.track) throw new Error('Map the circuit first, or try the two-car simulation.');
    if (game.track.unverifiedCount) throw new Error('Special Fast & Furious pieces 53, 54 and 57 are unverified; scored rounds are blocked.');
    if (game.track.inferredCount) throw new Error('Rescan the circuit: ' + game.track.inferredCount + ' sections were inferred. Clean the codes and use a lower scan speed.');
    const active = game.drivers.filter(d => d.car.connected && d.control !== 'none');
    const mode = $('mode').value;
    if ((experience === 'story' || mode === 'precision') && game.track.pieces.some(p=>p.kind==='intersection')) throw new Error('Slow intersection missions are unverified with the 2-second telemetry watchdog. Choose a layout without intersections.');
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
        if(ready.kind==='forward-baseline') { game.startForwardBaseline(game.drivers.find(d=>d.id===ready.driverId)); recorder.mark('forward-baseline-start',{carId:ready.driverId,...game.forwardBaseline.driver.car.telemetry.forwardBaseline}); renderRound(); return; }
        if(ready.kind==='lane-cancellation-comparison') { game.startLaneCancellationComparison(game.drivers.find(d=>d.id===ready.driverId)); return; }
        if(ready.kind==='diagnostic') { game.startDiagnostic(game.drivers.find(d=>d.id===ready.driverId),{steering:!!ready.steering,direction:ready.direction??1}); return; }
        if(ready.kind==='scan') {
          const scanner=game.drivers.find(d=>d.id===ready.scanner&&d.car.connected);if(!scanner)throw new Error('Selected scanner is unavailable');
          Object.assign(scanAttempt,{stage:'scanning',started:true,positionsBefore:scanner.car.telemetry.positions,transitionsBefore:scanner.car.telemetry.transitions});
          recorder.mark('scan-start',{carId:scanner.id,startingLateral:ready.startingLateral});game.startScan(scanner,{startingLateral:ready.startingLateral??null});renderScanStatus();return;
        }
        if(ready.kind==='pit') {game.resumeFromPit();game.armComputers();session.resume(now);return;}
        if (ready.ids.some(id => !game.drivers.some(d => d.id === id && d.car.connected && d.control !== 'none' && (!d.car.safetyReason || d.car.safetyReason === 'Host stopped')))) throw new Error('The grid changed. Check your drivers and start again.');
        game.resume(); game.armComputers(); if (ready.kind === 'free') { log('Free drive armed after countdown'); return; } if (ready.mode === 'battle') game.startBattle();
        const opts = ready.mission ? {mission: ready.mission.id, goal: ready.mission.goalPerCar * ready.ids.length, durationMs: ready.mission.durationMs} : {};
        activeMission = ready.mission; activeExperience = experience;
        session.start(ready.mode, scoringSnapshot(now).filter(s => ready.ids.includes(s.id)), now, opts);
        log('GO · ' + (ready.mission?.title ?? ROUND_MODES[ready.mode].title));
      } catch (error) { if(ready.kind==='scan'&&scanAttempt){scanAttempt.reason=error.message;scanNotice='Scan could not start: '+error.message+'.';}game.stopAll();renderScanStatus();$('roundHelp').textContent = error.message; log(error.message); }
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
  renderScanStatus();
  const view = session.view(), running = view.status === 'running' || view.status === 'paused', comparison=game.laneCancellationComparison, baseline=game.forwardBaseline;
  $('pitPanel').hidden = !game.pitReason;
  $('pitResume').disabled = !game.pitReady;
  $('pitClearStopped').disabled = !game.pitReady || !!countdown;
  $('pitMessage').textContent = game.pitReason ? game.pitReason + '. Stop requested for every car. Confirm they are physically still before touching the track. Use each affected car’s Recover button. To prepare another scan, choose Clear pit · keep stopped, then start a separate scan. Continuing or rearming below can start Computer drivers after the countdown.' : '';
  $('pitResume').textContent = view.status === 'paused' ? 'Track clear · Continue round' : 'Track clear · Rearm controls';
  $('roundLabel').textContent = game.pitReason ? 'SHARED PIT · CLOCK PAUSED' : countdown ? 'TRACK CLEAR · GET READY' : running ? activeExperience.toUpperCase() + ' · ROUND LIVE' : view.status === 'finished' ? 'ROUND COMPLETE' : 'READY WHEN YOU ARE';
  $('roundTitle').textContent = (game.diagnostic || countdown?.kind==='diagnostic') ? (game.diagnostic?.steering || countdown?.steering ? 'One '+((game.diagnostic?.direction??countdown?.direction)===-1?'right':'left')+'-lane test · 4 s maximum' : 'Supervised straight test · 0.5 s') : view.status === 'idle' ? 'Choose your kind of fun' : activeMission?.title ?? view.title;
  $('roundGoal').textContent = view.objective || (view.goal ? view.teamLaps + ' / ' + view.goal + ' shared laps · every driver contributes' : view.mode === 'battle' ? '100 per knockout · 25 per assist or lap' : view.mode === 'solo' ? 'Complete a full circuit. Find your fastest clean rhythm.' : 'Complete laps. Keep your eyes on the physical track.');
  if(game.diagnostic?.steering || (countdown?.kind==='diagnostic'&&countdown.steering))$('roundGoal').textContent='At most 300 mm/s for four seconds. One '+((game.diagnostic?.direction??countdown?.direction)===-1?'right':'left')+' request only after a fresh readable straight code. Watch the physical car; STOP remains available.';
  $('roundClock').textContent = countdown ? String(Math.max(1, Math.ceil((countdown.until - performance.now()) / 1000))) : view.status === 'idle' ? '—' : timeText(view.remainingMs);
  $('roundState').textContent = game.diagnostic ? 'DIAGNOSTIC · AUTO STOP' : countdown ? 'Get ready' : view.status === 'paused' ? 'Paused' : running ? 'Remaining' : game.halted ? 'Cars stopped' : 'Free drive';
  if (isStudent() && view.status === 'idle' && !countdown && !game.diagnostic && !comparison && !baseline) {
    $('roundTitle').textContent = 'Free drive';
    $('roundGoal').textContent = !game.drivers.length ? 'Connect your car and match its model and LED color.' : !game.track ? 'Scan your physical track to build the live map.' : game.halted ? 'Choose Drive here or Phone / QR, then Start driving. Keep watching the physical car.' : 'You control the pace. Release the phone drive button or use Brake; STOP ALL remains available.';
  }
  if (comparison || countdown?.kind==='lane-cancellation-comparison') {
    const acquiring=comparison?.stage==='acquiring-reference';
    $('roundLabel').textContent=acquiring?'ACQUIRING START/FINISH REFERENCE':comparison?.cancelled?'STEERING LOCKED · CAR STILL DRIVING':'SUPERVISED COMPARISON';
    $('roundTitle').textContent='Lane-cancellation comparison';
    $('roundGoal').textContent=acquiring?'Forward only, no lane or offset commands. The first optical code must identify start/finish, followed by a consistent reading. Wrong reference or a five-second acquisition timeout stops the test.':comparison?.cancelled?'No further steering. Forward driving continues at no more than 300 mm/s. Press STOP to end.':comparison?.stage==='driving'?'Start/finish reference and follow-up confirmed. Computer driving at no more than 300 mm/s; cancellation locks steering while forward driving continues. STOP remains available.':'Place the sensor just before start/finish. Optical reference confirmation comes before Computer steering. Ceiling 300 mm/s; STOP remains available.';
    $('roundState').textContent=countdown?'Get ready':acquiring?'FORWARD ONLY · CONFIRMING POSITION':comparison?.cancelled?'FORWARD DRIVE · STEERING LOCKED':'COMPUTER · SUPERVISE';
  }
  if (baseline || countdown?.kind==='forward-baseline') {
    $('roundLabel').textContent=baseline?.stage==='acquiring-reference'?'ACQUIRING MAP REFERENCE':'SUPERVISED FORWARD CHECK';
    $('roundTitle').textContent='Three forward laps';
    $('roundGoal').textContent=baseline ? (baseline.laps+' / '+baseline.targetLaps+' full laps reported. '+(baseline.stage==='acquiring-reference'?'Waiting for a fresh, unambiguous track reading. ':'')+'Normal optical calibration is active. Lane changes, U-turns and attacks are disabled. Stay beside the track; STOP remains available.') : 'Begin before start/finish on a printed lane. One car, three full laps, at most 300 mm/s. Remain beside the clear track.';
    if (baseline) $('roundClock').textContent=timeText(Math.max(0,baseline.until-performance.now()));
    $('roundState').textContent=countdown?'Get ready':'FORWARD ONLY · AUTO STOP';
  }
  $('countdown').hidden = !countdown; $('countdown').textContent = countdown ? $('roundClock').textContent : '';
  $('endRound').hidden = !running && !countdown && !comparison && !baseline;
  $('endRound').textContent=baseline?'Stop forward check':comparison?'Stop comparison':'Finish round & stop';
  for (const button of document.querySelectorAll('[data-experience]')) button.disabled = running || !!countdown || !!comparison || !!baseline;
  $('mode').disabled = $('mission').disabled = running || !!countdown || !!comparison || !!baseline;
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
addEventListener('blur', () => { held.clear(); for (const d of game.drivers) if (SCHEMES[d.control] || d.control === 'browser' || d.control === 'gamepad') { d.armed = false; d.gamepadArmed = false; d.level = 0; d.input.throttle = 0; d.input.attack = d.input.support = d.input.special = false; d.car.stop(); } });

function readControls(dt) {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()] : [];

  for (const d of game.drivers) {
    const s = SCHEMES[d.control], input = d.input;

    if (game.halted || d.car.safetyReason) { d.armed = false; d.gamepadArmed = false; d.level = 0; input.throttle = 0; input.attack = input.support = input.special = false; if (d.pad) d.pad.throttle = 0; continue; }
    if (s) {
      d.level = Math.max(0, Math.min(1, (d.level ?? 0) + (held.has(s.up) ? 0.9 * dt : 0) - (held.has(s.down) ? 1.6 * dt : 0)));
      input.throttle = d.level; input.attack = held.has(s.attack); input.support = held.has(s.support); input.special = held.has(s.special);
    } else if (d.control === 'browser') { input.throttle = d.level ?? 0;
    } else if (d.control === 'gamepad') {
      if (!d.gamepadBinding) {
        const slot=pads.findIndex((p,i)=>p && p.connected!==false && !game.drivers.some(other=>other!==d && other.gamepadBinding?.slot===i) && p.buttons.some(b=>b.pressed || b.value>.05));
        if(slot>=0) { d.gamepadBinding={slot,id:pads[slot].id??''}; d.armed=false;d.gamepadArmed=false; }
      }
      const binding=d.gamepadBinding, candidate=binding && pads[binding.slot];
      const pad=candidate && (candidate.id??'')===binding.id ? candidate : null;
      if (pad && pad.mapping !== undefined && pad.mapping !== 'standard') { d.gamepadWarning='Non-standard gamepad mapping: use another control'; d.gamepadArmed=false; d.armed=false;input.throttle=0;input.attack=input.support=input.special=false;continue; }
      d.gamepadWarning= !binding ? 'Press a gamepad button to claim, then release' : !pad ? 'Bound gamepad disconnected' : '';

      if (!pad || pad.connected === false) { d.gamepadArmed = false; d.armed = false; input.throttle = 0; input.attack = input.support = input.special = false; continue; }
      // A held trigger must not restart a car after stop, reassignment or reconnect.
      if (!d.gamepadArmed) {
        const neutral = (pad.buttons[7]?.value ?? 0) <= .05 && Math.abs(pad.axes[0] ?? 0) <= .12 && ![0,1,3].some(i => pad.buttons[i]?.pressed);
        input.throttle = 0; input.attack = input.support = input.special = false;
        d.gamepadArmed = neutral; d.armed = neutral; continue;
      }
      input.throttle = (pad.buttons[7]?.value ?? 0) > .05 ? pad.buttons[7].value : 0;
      input.lane = -(Math.abs(pad.axes[0]) > 0.12 ? pad.axes[0] : 0) * 67.5;
      input.attack = !!pad.buttons[0]?.pressed; input.support = !!pad.buttons[1]?.pressed; input.special = !!pad.buttons[3]?.pressed;
    } else if (d.control === 'phone') {
      syncPhoneManeuvers(d);
      const pad = d.pad, fresh = pad && performance.now() - pad.seen < 700;
      if (!fresh) { d.armed = false; if(pad) pad.armed = false; }
      // Dead-man: a phone that stops sending (locked, out of range) stops its car.
      input.throttle = fresh ? pad.throttle : 0;
      const maneuvers=fresh&&!pad.maneuversNeedRelease&&!d.telemetryGrace;
      input.attack = maneuvers && pad.attack; input.support = maneuvers && pad.support; input.special = maneuvers && pad.special;
      input.lane = maneuvers && pad.steeringActive !== false ? -pad.steer * 67.5 : null;
    } else if (d.control === 'none') { input.throttle = 0; input.attack = input.support = input.special = false; d.level = 0; }
    if (d.control !== 'bot' && !d.armed) {
      if (d.control !== 'phone' && input.throttle === 0 && !input.attack && !input.support && !input.special) d.armed = true;
      input.throttle = 0; input.attack = input.support = input.special = false;
    }
  }
}

// --- phone players -------------------------------------------------------------------
let room = null;                   // {room, hostKey, joinKey, stop}
const players = new Map();         // id -> {name, online, driver}
function revokeCarInvite(driver) {
  const target=room, ui=cards.get(driver);
  ui?.cancelSeat();
  for(const p of [...players.values()])if(p.car===driver.id || p.driver===driver){if(p.driver)releasePad(p.driver,true);players.delete(p.id);}
  renderPlayers();
  if(!target)return Promise.resolve(true);
  driver.inviteRevocationRoom=target.room;
  driver.inviteRevocation=Promise.resolve(driver.inviteRevocation).then(async()=>{
    try{await api('/rooms/'+target.room+'/seats',{method:'POST',key:target.hostKey,body:{car:driver.id,remove:true}});driver.inviteRevocationFailed=false;return true;}
    catch(error){driver.inviteRevocationFailed=true;if(ui)ui.phoneStatus.textContent='Could not retire the previous phone invitation. Choose Phone / QR to retry.';log('Phone invitation revocation failed: '+error.message);return false;}
  });
  return driver.inviteRevocation;
}
function syncPhoneManeuvers(driver) {
  const pad=driver.pad,since=driver.car.telemetry.telemetryHealth?.since;
  if(!pad || !Number.isFinite(since) || pad.recoverySince===since)return;
  pad.recoverySince=since;pad.recoveryId=((pad.recoveryId??0)%1000000)+1;pad.maneuversNeedRelease=true;
  pad.steeringActive=false;pad.steer=0;pad.attack=pad.support=pad.special=false;
}
function releasePad(driver, revoke = false) { if (driver.pad) { const player = driver.pad.player; player.driver = null; if (revoke) { player.car = undefined; player.manual = true; } driver.pad = null; driver.input.throttle = 0; driver.car.stop(); } }
function seat(player, wantedId = player.car) {
  if (player.driver || !player.approved) return;
  // Approval may offer a seat; recurring input never changes the host's control mode.
  const free = d => d.control === 'phone' && !d.pad && d.car.connected;
  const driver = game.drivers.find(d => free(d) && d.id === wantedId) ?? (wantedId ? null : game.drivers.find(free));
  if (!driver) return;
  driver.armed = false; driver.pad = {player, seen: 0, throttle: 0, steer: 0, steeringActive:false, recoveryId:0, maneuversNeedRelease:false, attack: false, support: false, special: false};
  player.driver = driver; log(player.name + ' is driving ' + driver.car.name);
}
function onRelay(m) {
  const carOf = x => Number.isSafeInteger(x.car) ? x.car : undefined;
  const fresh = x => ({id: x.id, name: String(x.name).slice(0, 16), online: false, driver: null, car: carOf(x), approved: x.approved === true});
  if (m.type === 'players') { for (const p of m.players) if (!players.has(p.id)) players.set(p.id, fresh(p)); }
  else if (m.type === 'joined') { players.set(m.id, fresh(m)); log(players.get(m.id).name + ' is waiting to be let in'); }
  else if (m.type === 'online') { const p = players.get(m.player); if (p) { p.online = true; if (!p.manual && p.car !== undefined) seat(p, p.car); } }
  else if (m.type === 'offline' || m.type === 'left') { const p = players.get(m.player); if (p) { p.online = false; if (m.type === 'left') { if (p.driver) releasePad(p.driver); players.delete(m.player); } } }
  else if (m.type === 'input') {
    const p = players.get(m.player); if (!p) return;
    if (m.release) { p.car = undefined; p.manual = true; if (p.driver) { log(p.name + ' left ' + p.driver.car.name); releasePad(p.driver); } renderPlayers(); return; }
    // After leaving a car, a player only gets another by picking one.
    if (!p.driver && Number.isSafeInteger(m.car)) seat(p, m.car);
    else if (!p.driver && !p.manual) seat(p);
    const pad = p.driver?.pad; if (!pad) return;
    syncPhoneManeuvers(p.driver);
    pad.seen = performance.now();
    const neutral = Number(m.throttle) === 0 && (Number(m.steer)||0) === 0 && !m.attack && !m.support && !m.special && !m.uturn;
    if (!p.driver.armed) {
      if (neutral && !game.halted && !p.driver.car.safetyReason) p.driver.armed = true;
      else { pad.throttle = 0; pad.attack = pad.support = pad.special = false; return; }
    }
    if(m.recoveryId===pad.recoveryId && m.steeringActive===false && (Number(m.steer)||0)===0 && !m.attack && !m.support && !m.special && !m.uturn && !m.cycle && !p.driver.telemetryGrace)pad.maneuversNeedRelease=false;
    const maneuvers=!pad.maneuversNeedRelease&&!p.driver.telemetryGrace&&(pad.recoveryId===0||m.recoveryId===pad.recoveryId);
    pad.throttle = Math.max(0, Math.min(1, Number(m.throttle) || 0)); pad.steer = maneuvers?Math.max(-1, Math.min(1, Number(m.steer) || 0)):0;
    pad.steeringActive=maneuvers&&m.steeringActive!==false;
    pad.attack = maneuvers&&m.attack === true; pad.support = maneuvers&&m.support === true; pad.special = maneuvers&&m.special === true;
    if (maneuvers && (m.cycle === 'attack' || m.cycle === 'support' || m.cycle === 'special')) game.battle?.cycle(p.driver.car, m.cycle);
    if (maneuvers && m.uturn === true && !game.halted && game.phase !== 'scanning') p.driver.car.uturn();
  }
  renderPlayers();
}
// Nobody drives until the host says so. Approving a per-car request hands over
// that car; whoever held it before is removed, and its code is replaced.
async function approve(p) {
  try {
    if (session.status === 'running' || session.status === 'paused' || countdown) throw new Error('Finish the round before changing drivers.');
    await api('/rooms/' + room.room + '/approve', {method: 'POST', key: room.hostKey, body: {player: p.id}});
    if(players.get(p.id)!==p)return; // a driver/controller change revoked this pending approval
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
      const target=p.car&&game.drivers.find(d=>d.id===p.car);if(target)cards.get(target)?.cancelSeat();
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
function relayStatus(status) {
  $('roomNote').textContent = status === 'online' ? '' : 'Relay ' + status;
  for (const d of game.drivers) if (d.control === 'phone') { d.armed = false; d.input.throttle = 0; if (d.pad) { d.pad.seen = -Infinity; d.pad.throttle = 0; } d.car.stop(); }
}
function openRoom() {
  if (room) return Promise.resolve(room);
  // Validate before assigning the in-flight promise: a synchronous rejection
  // inside the initializer would otherwise leave a permanently failed retry.
  const student=isStudent(), code=student?'':$('hostCode').value.trim();
  if (!student && !code) return Promise.reject(new Error('enter the host code first'));
  return opening ??= (async () => {
    try {
      const made = await api(student?'/student/rooms':'/rooms', student?{method:'POST',body:{}}:{method:'POST',key:code});
      if(!student)try { sessionStorage.setItem('slipstream.hostCode', code); } catch {}
      $('codeField').hidden = true;
      room = {...made, link: channel({room: made.room, key: made.hostKey, role: 'host', onMessage: onRelay, onStatus: relayStatus})};
      const url = phoneUrl('r=' + made.room + '&j=' + made.joinKey);
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
  for (const ui of cards.values()) { ui.cancelSeat(); ui.phoneStatus.textContent = ''; ui.seatLink.value = ''; }
  players.clear(); room = null; $('room').hidden = true; $('invite').hidden = false; $('codeField').hidden = false; renderPlayers();
};
let lastState = 0;
function pushState(snapshot, now) {
  if (!room || now - lastState < 200) return;
  lastState = now;
  const round = session.view(), roundRows = new Map(round.rows.map(row => [row.id, row]));
  const bounded = (value,max) => Number.isFinite(value)?Math.round(Math.max(0,Math.min(max,value))):0;
  const remaining = (until,max) => Number.isFinite(until)&&Number.isFinite(now)?bounded(until-now,max):0;
  const view = (s,d) => ({id: s.id, crew: s.crew, assists: s.assists, targets: s.targets, name: s.name, color: s.color, energy: +s.energy.toFixed(2), speed: Math.round(s.speed), disabled: s.disabled, shield: s.shield, connected: s.connected, safetyReason: s.safetyReason, located:s.located===true,
    telemetryHealth:{recoveryId:bounded(d?.pad?.recoveryId,1000000),state:['degraded','reacquired'].includes(s.telemetryHealth?.state)?s.telemetryHealth.state:'normal',remainingMs:s.telemetryHealth?.state==='degraded'?remaining(s.telemetryHealth.until,1000):0,maximumSpeed:s.telemetryHealth?.state==='degraded'?bounded(s.telemetryHealth.maximumSpeed,300):0},
    speedPlan:{requested:bounded(s.speedPlan?.requested,1200),commanded:bounded(s.speedPlan?.commanded,1200),rampMs:bounded(s.speedPlan?.rampMs,10000)},
    powerZone:{effect:['shield','boost'].includes(s.powerZone?.effect?.type)?s.powerZone.effect.type:null,remainingMs:s.powerZone?.effect?remaining(s.powerZone.expiresAt,3000):0},
    task: roundRows.get(s.id)?.task?.cue ?? '', score: roundRows.get(s.id)?.score ?? 0,
    kills: roundRows.get(s.id)?.hits ?? s.kills, deaths: roundRows.get(s.id)?.losses ?? s.deaths, laps: roundRows.get(s.id)?.laps ?? s.laps,
    bays: Object.fromEntries(['attack', 'support', 'special'].map(b => [b, s[b] ? {label: WEAPON_LABEL[s[b].type], style: s[b].style, ready: s[b].ready, charge: +s[b].charge.toFixed(1)} : null]))});
  const byDriver = new Map(snapshot.map(s => [s.id, s])), mine = {};
  for (const p of players.values()) if (p.driver) { syncPhoneManeuvers(p.driver); mine[p.id] = {...view(byDriver.get(p.driver.id),p.driver), needsNeutral: !p.driver.armed}; }
  const lobby = {phase: game.halted ? 'stopped' : game.phase, round: {title: countdown ? 'Get ready' : activeMission?.title ?? round.title, remainingMs: countdown ? Math.max(0, countdown.until - now) : round.remainingMs, status: countdown ? 'countdown' : round.status, mode: countdown?.mode ?? round.mode, goal: round.goal, teamLaps: round.teamLaps, objective: round.objective ?? ''}, cars: game.drivers.filter(d => d.control === 'phone').map(d => ({id: d.id, name: d.car.name, color: d.car.color, free: !d.pad}))};
  room.link.send({players: mine, lobby}).catch(() => {});
}

// --- loops ---------------------------------------------------------------------------
const PHASE = {garage: 'Garage', scanning: 'Scanning', ready: 'Track ready', battle: 'Battle'};
function studentDriveReady() { return drivingReadiness(game,{countdown,now:performance.now()}).ready; }
function showReadiness() {
  const state=drivingReadiness(game,{countdown,now:performance.now()});
  $('readinessTitle').textContent=state.title; $('readinessInstruction').textContent=state.instruction;
  $('readinessPanel').dataset.state=state.state;
  const items=[...state.blockers,...state.notes],key=JSON.stringify(items);
  if($('readinessItems').dataset.key!==key){$('readinessItems').replaceChildren(...items.map(text=>el('li',{textContent:text})));$('readinessItems').dataset.key=key;}
  $('readinessItems').hidden=!items.length;
  $('resume').title=state.blockers.join(' ')||state.instruction;
}

function locationDescription(location) {
  const reference=location.reference;
  if (!reference) return 'Position unknown · '+(location.reason??'waiting for an optical code')+'. Map marker hidden.';
  const reading=(reference.source==='simulator-seed'?'Simulator placement':'Optical reference')+': piece '+reference.pieceId+(reference.locationId===null?'':' / code '+reference.locationId)+', '+(reference.reverse?'reverse':'forward')+', '+(reference.ageMs/1000).toFixed(1)+'s ago';
  const state=location.state==='confirmed'?'Matched map section '+(reference.index+1):location.state==='estimated'?'Estimated between optical codes':location.state==='ambiguous'?'Ambiguous map section · marker hidden':location.state==='stale'?'Reference expired · marker hidden':'Position unknown · marker hidden';
  return state+'. '+reading+(reference.unverified?' · special-piece geometry unverified':'')+'.';
}
function refresh(snapshot = game.snapshot()) {
  showReadiness();
  $('openReport').disabled=!canReport(); $('openReport').title=game.halted?'View recorded evidence and your observations':'Choose STOP before generating a run report';
  const hasPowerZone = game.track?.pieces.some(p=>p.id===57);
  $('powerZoneStatus').hidden = !hasPowerZone;
  const powerMode=game.powerZoneMode??'off';
  const powerRule=powerMode==='boost'?'Cross the checkpoint in any lane, then exit onto an ordinary straight for up to +75 mm/s for 1 second, within your selected maximum. Zero throttle cancels it.':powerMode==='shield'?'Cross the checkpoint in any lane and leave onto a readable ordinary piece to charge a 3-second virtual shield.':'Effects are off. Choose a rule while stopped.';
  $('powerZoneRuleNote').textContent=powerRule+' This is our programmable Slipstream rule; it does not reproduce the original app’s special lane.';
  $('powerZoneStatus').textContent='Power Zone detected · '+powerRule+' Scored rounds remain blocked on special pieces.';
  const settingsLocked=!drivingSettingsStopped();
  for(const id of ['studentMaxSpeed','accelerationMode','telemetryMode','powerZoneMode']) $(id).disabled=settingsLocked;
  syncDrivingSettings();
  const degraded=snapshot.filter(s=>s.telemetryHealth?.state==='degraded');
  $('drivingHealth').hidden=!degraded.length;
  $('drivingHealth').textContent=degraded.map(s=>s.name+': track readings interrupted. Speed limited; steering and attacks locked. STOP follows at 3 seconds unless two consistent readings return.').join(' ');
  const cameraKey=game.drivers.map(d=>d.id+':'+d.car.name).join('|');
  if($('cameraCar').dataset.key!==cameraKey) {
    const selected=$('cameraCar').value;
    $('cameraCar').replaceChildren(new Option('Active car','0'),...game.drivers.map(d=>new Option(d.id+' · '+d.car.name,String(d.id))));
    $('cameraCar').value=game.drivers.some(d=>String(d.id)===selected)?selected:'0';
    $('cameraCar').dataset.key=cameraKey;
    studioRenderer?.setView($('cameraMode').value,Number($('cameraCar').value));
  }
  const unlocated=snapshot.filter(s=>!s.located).map(s=>s.name);
  $('mapPositionStatus').hidden=!game.drivers.length;
  $('mapPositionStatus').textContent=isStudent()
    ? unlocated.length?'Waiting for a fresh position: '+unlocated.join(', ')+'.':'Positions estimated from recent track readings.'
    : unlocated.length?'Position unknown: '+unlocated.join(', ')+'. Unconfirmed map markers are hidden; physical placement alone does not establish an optical reference.':'Map positions are estimates from recent optical codes. Confirm the physical car before testing.';

  const scanOptions=game.drivers.filter(d=>d.car.connected),scanKey=scanOptions.map(d=>d.id+':'+d.car.name).join('|');
  if($('scanCar').dataset.key!==scanKey){const selected=$('scanCar').value;$('scanCar').replaceChildren(...scanOptions.map(d=>new Option(d.id+' · '+d.car.name,String(d.id))));if(scanOptions.some(d=>String(d.id)===selected))$('scanCar').value=selected;$('scanCar').dataset.key=scanKey;}

  const seconds=ms=>ms===null?'none yet':(ms/1000).toFixed(1)+'s ago';
  const mapChecks=trackValidation(game.track);
  $('liveDiagnostics').textContent=(mapChecks.available?'Map checks: '+(mapChecks.issues.join(', ')||'basic geometry checks clear')+' · physical validation not established by this report\n\n':'')+game.drivers.map(d=>{
    const x=d.car.diagnostics();
    const offset=x.laneChange ? (x.laneChange.offsetKnown?'reported '+x.laneChange.currentOffset.toFixed(1)+' mm':'UNKNOWN — lane calibration needed') : 'not reported';
    return d.car.name+' · firmware '+(x.firmware??'waiting')+' · '+x.profile+'\n'+
      (x.connected?'Connected':'Disconnected')+' · '+(x.safetyReason??x.initialization)+'\n'+
      (x.sdkPlasticTrack?.requested?'Plastic-track comparison: requested plastic parser and disabled jump boosts; '+(x.sdkPlasticTrack.sequenceComplete?'initialization sequence complete':'initialization sequence incomplete')+'; firmware application unconfirmed.\n':'')+
      locationDescription(x.localization)+'\n'+
      'Requested '+x.requestedSpeed+' mm/s; car reported '+x.reportedSpeed+' mm/s ('+seconds(x.reportedSpeedAgeMs)+')\n'+
      'Positions '+x.positions+' ('+seconds(x.positionAgeMs)+'); transitions '+x.transitions+'; other packets '+x.unknown+'; malformed '+x.malformed+'\n'+
      'Last notification '+seconds(x.notificationAgeMs)+' · battery '+(x.millivolts===null?'unknown':(x.millivolts/1000).toFixed(2)+' V')+' ('+seconds(x.batteryAgeMs)+')\n'+
      'Car status ('+seconds(x.statusAgeMs)+'): '+(x.statusAgeMs===null?'unknown':('on track '+x.status.onTrack+' · charging '+x.status.onCharger+' · low battery '+x.status.lowBattery))+'\n'+
      'Firmware collision notifications: '+(x.collisions??0)+' · last '+seconds(x.collisionAgeMs)+(x.lastCollision?' · side '+x.lastCollision.wasSideOnCollision+' · front/back '+x.lastCollision.wasFrontBackCollision:'')+' · not confirmation of physical impact\n'+
      'Firmware recovery: entered '+(x.recoveryEntered??0)+' · succeeded '+(x.recoverySucceeded??0)+' (diagnostic only)\n'+
      'Lateral offset: '+offset+(x.laneChange?' ('+seconds(performance.now()-x.laneChange.at)+')':'')+' · max write '+Math.round(x.maxWriteMs)+' ms'+
      (x.laneCancellationComparison?.active?'\nSUPERVISED COMPARISON · '+(x.laneCancellationComparison.stage==='acquiring-reference'?'ACQUIRING START/FINISH REFERENCE; lane and offset commands locked':x.steeringLocked?'STEERING LOCKED; FORWARD DRIVING CONTINUES':'reference confirmed; cancellation will lock steering and retain forward drive')+' · STOP ends this comparison.':x.laneChange?.cancelled?'\nLane change cancelled · requested target cleared. Moving cancellations require pit recovery.':'')+
      (x.forwardBaseline?'\nFORWARD CHECK · '+x.forwardBaseline.laps+' / '+x.forwardBaseline.targetLaps+' full laps reported · '+(x.forwardBaseline.active?'normal optical calibration active; no maneuvers':x.forwardBaseline.reason+'; confirm physical stop'):'')+
      (x.calibrationBlocked?'\nAutomatic calibration withheld on unverified piece '+x.calibrationBlocked.pieceId+'.':'')+
      (x.laneRequest?'\nSteering request #'+x.laneRequest.id+': target '+x.laneRequest.offset.toFixed(1)+' mm, sideways '+x.laneRequest.horizontalSpeed+' mm/s':'')+
      (x.laneAcknowledgment?'\nSDK-layout ACK (firmware semantics unverified): received #'+x.laneAcknowledgment.received+', executed #'+x.laneAcknowledgment.executed+', requested sideways '+x.laneAcknowledgment.desiredLaneSpeed+' mm/s ('+seconds(performance.now()-x.laneAcknowledgment.at)+'); not proof of lane completion':'')+
      '\nPower Zone signals: '+(x.zoneCodes??0)+' · other special codes: '+(x.supercodes??0)+' · native special-lane effects disabled'+
      (x.lastSpecialCode?' · last code 0x'+x.lastSpecialCode.code.toString(16)+' ('+seconds(performance.now()-x.lastSpecialCode.at)+')':'');
  }).join('\n\n') || 'Connect a car to see telemetry health.';
  $('saveTrace').disabled=recorder.cars.length===0;
  if(recorder.active)$('traceNote').textContent='Recording · '+recorder.events.length+' messages · '+recorder.dropped+' dropped · '+recorder.markersDropped+' annotations dropped. Save anytime without stopping.';
  renderRound();
  const busy = session.status === 'running' || session.status === 'paused' || !!countdown || !!game.laneCancellationComparison || !!game.forwardBaseline;
  $('carCount').textContent = game.drivers.length + ' / 4 cars';
  $('addSim').disabled = game.drivers.length >= 4 || busy;
  $('connect').disabled = !bluetoothAvailable() || game.drivers.length >= 4 || busy;
  $('demo').hidden = game.drivers.length > 0;
  $('layout').disabled = busy; $('top').disabled = busy;
  $('liveTag').textContent = isStudent() && !game.drivers.length ? 'Awaiting car' : game.drivers.some(d => !d.car.simulated) ? 'LIVE HARDWARE · SUPERVISE' : 'SIMULATION';
  if (bluetoothAvailable()) $('bleNote').textContent = isStudent() ? 'Keep this laptop awake and this tab open while driving.' : 'Select drivers, then explicitly start. Keep the track clear and someone next to it.';
  $('arenaTitle').textContent = isStudent() ? 'Your live track' : !game.drivers.length ? 'Make room for a little rivalry.' : session.status === 'running' ? 'Eyes up. The track is the game.' : 'Your crew. Your next challenge.';
  $('empty').hidden = game.drivers.length > 0;
  const chip = $('phase'); chip.textContent = game.halted ? 'Stopped' : PHASE[game.phase];
  chip.className = 'chip' + (game.phase === 'battle' ? ' live' : game.phase === 'scanning' ? ' scan' : '');
  $('scan').textContent = game.phase === 'scanning' ? 'Cancel scan' : game.track ? 'Rescan track' : 'Scan track';
  $('scan').disabled = busy || !game.drivers.some(d => d.car.connected);
  $('battle').disabled = !game.track || busy; $('battle').textContent = countdown ? 'Get ready…' : session.status === 'paused' ? 'Round paused' : session.status === 'running' ? 'Round live' : 'Start round';
  $('resume').textContent = isStudent() ? 'Start driving' : 'Free drive';
  $('resume').hidden = isStudent() ? !game.drivers.some(d => d.car.connected) : !game.halted || !!countdown || !!game.pitReason;
  $('resume').disabled = isStudent() && !studentDriveReady();
  $('studentView').setAttribute('aria-pressed',String(isStudent())); $('advancedView').setAttribute('aria-pressed',String(!isStudent()));
  const byId = new Map(snapshot.map(s => [s.id, s]));
  for (const [driver, ui] of cards) {
    const s = byId.get(driver.id); if (!s) continue;
    ui.color.disabled = !canChooseColor(driver);
    ui.screen.disabled = ui.phone.disabled = !s.connected || driver.car.initializing || busy || game.phase === 'scanning';
    ui.screen.setAttribute('aria-pressed',String(driver.control === 'browser')); ui.phone.setAttribute('aria-pressed',String(driver.control === 'phone'));
    if (driver.pad) ui.phoneStatus.textContent = driver.pad.player.name + ' paired to this car. Choose Start driving on the laptop; then hold to drive on the phone.';
    else if (driver.control === 'browser') ui.phoneStatus.textContent = game.halted ? 'Choose Start driving, then apply throttle.' : !driver.armed ? 'Return throttle to zero to enable driving.' : 'Raise throttle to drive. Brake returns it to zero.';
    ui.cancellationComparison.disabled=busy || !game.halted || !!game.pitReason;
    ui.forwardBaseline.disabled=busy || !game.halted || !!game.pitReason || !game.track || !s.connected || driver.car.initializing;
    ui.card.classList.toggle('off', !s.connected); ui.card.classList.toggle('down', s.disabled);
    ui.locationReference.textContent=locationDescription(driver.car.diagnostics().localization);
    ui.energy.style.width = Math.round(s.energy * 100) + '%'; ui.energy.className = s.energy < 0.33 ? 'low' : s.energy < 0.66 ? 'mid' : '';
    ui.speed.style.width = Math.min(100, Math.round(s.speed / 12)) + '%';
    ui.left.textContent = driver.car.initializing ? 'Initializing: ' + driver.car.initializationStatus : !s.connected ? 'Disconnected · reconnect to recover' : s.safetyReason === 'Off track' ? 'OFF TRACK · stopped' : driver.control === 'gamepad' && !driver.gamepadArmed ? driver.gamepadWarning || 'Release gamepad controls to arm' : s.disabled ? 'DISABLED' : Math.round(s.speed) + ' mm/s' + (driver.pad ? ' · ' + driver.pad.player.name : driver.control === 'bot' ? ' · CPU' : '');
    if(s.powerZone?.effect) ui.left.textContent+=' · '+(s.powerZone.effect.type==='shield'?'POWER ZONE SHIELD':'POWER ZONE BOOST');
    const objective = session.view().rows.find(row => row.id === driver.id)?.task;
    ui.task.hidden = !objective; ui.task.textContent = objective?.cue ?? '';
    ui.recover.hidden = !s.connected || !s.safetyReason || s.safetyReason === 'Host stopped';
    ui.browserControls.hidden = driver.control !== 'browser';
    ui.fireRow.hidden = game.phase !== 'battle';
    ui.throttle.value = Math.round((driver.level ?? 0) * 100); ui.throttle.disabled = game.halted || !!s.safetyReason;
    ui.leftButton.disabled = ui.rightButton.disabled = game.halted || !!s.safetyReason || !s.connected;
    ui.right.textContent = (s.millivolts ? (s.millivolts / 1000).toFixed(2) + ' V · ' : '') + (s.located ? 'map estimate' : game.track ? 'position unknown' : 'no map') + (s.crew ? ' · ' + s.crew + ' · ' + s.assists + ' assists' : '') + (s.targets?.length ? ' · Target ' + s.targets.join(', ') : '');
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
  const combatMode = round.mode === 'battle';
  const lapTime = ms => Number.isFinite(ms) ? (ms / 1000).toFixed(2) + 's' : '—';
  $('scoreCol').textContent = taskMode ? 'Points' : combatMode ? 'KOs' : 'Best lap';
  $('scoreCol').title = taskMode ? 'Objective points' : combatMode ? 'Virtual knockouts' : 'Fastest complete lap this round';
  $('detailCol').textContent = taskMode ? (round.mission ? 'Tasks' : 'Gates') : combatMode ? 'Lost' : 'Last lap';
  const standings = round.rows.length ? round.rows.map(row => ({...row, kills: row.hits, deaths: row.losses})) : [...snapshot].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const rows = standings.map(s => el('tr', {}, el('td', {textContent: s.id + ' · ' + s.name + (s.control === 'bot' ? ' · CPU' : '')}), el('td', {textContent: taskMode ? s.score : combatMode ? s.kills : lapTime(s.bestLapMs)}), el('td', {textContent: taskMode ? s.task?.completed ?? 0 : combatMode ? s.deaths : lapTime(s.lastLapMs)}), el('td', {textContent: s.laps})));
  $('scores').tBodies[0].replaceChildren(...rows);
}

let last = performance.now(), slow = 0;
setInterval(() => {
  const frameAt = performance.now(), dt = Math.min(0.1, (frameAt - last) / 1000); last = frameAt;
  readControls(dt);
  world.step(dt);
  for (const d of game.drivers) d.objectiveInput = session.status === 'running' ? session.guidance(d.id) : null;
  // world.step synchronously emits telemetry stamped after frameAt. Sampling
  // before that delivery makes fresh positions look future-dated and resets
  // lap progress every time a code arrives. Keep the freshness guard intact.
  game.tick(dt, performance.now());
  const now = performance.now();
  tickRound(now);
  if (game.battle) for (const e of game.battle.drain()) {
    const id = car => game.drivers.find(d => d.car === car)?.id;
    renderer.addEffect({...e, from: id(e.from), to: id(e.to), car: id(e.car), life: e.type === 'explosion' || e.type === 'disabled' ? 700 : e.type === 'beam' ? 160 : 400});
    if (e.type === 'disabled') log((game.drivers.find(d => d.car === e.car)?.car.name ?? 'A car') + ' was disabled' + (e.by ? ' by ' + e.by.name : ''));
  }
  if (now - slow > 150) { slow = now; const snapshot = game.snapshot(now); refresh(snapshot); pushState(snapshot, now); updateComfort(snapshot,now); }
}, 40);

function frame() {
  const now = performance.now(), snapshot = game.snapshot(now), byId = new Map(snapshot.map(s => [s.id, s]));
  const cars = game.drivers.map(d => { const s = byId.get(d.id); return {...s, pose: d.car.pose(now), truck: vehicles.models[String(d.car.model)]?.truck}; });
  const banner = game.phase === 'scanning' ? 'Mapping the track: ' + (game.mapper.sequence.length) + ' pieces so far' + (game.mapper.problem ? ' · ' + game.mapper.problem : '')
    : !game.track && game.drivers.length ? 'Press “Scan track” to map the layout' : '';
  try { renderer.draw({track: game.track, partial: game.phase === 'scanning' ? game.mapper.sequence : null, cars, mines: game.battle?.mines ?? [], now, banner, objectives: session.view().rows.filter(r => r.task && Number.isFinite(r.task.gateProgress)).map(r => ({progress: r.task.gateProgress, label: String(r.id)}))}); }
  catch (error) { if (renderer !== mapRenderer) { requestedView='2d'; useMap('3D interrupted · 2D map active'); log('3D view interrupted: '+error.message); } }
  updateDrivingView(cars,now);
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
  $('record').textContent = 'Stop recording'; $('saveTrace').disabled = false; $('traceNote').textContent = 'Recording…';
};
function sessionTrace() { return {...recorder.toJSON(),diagnostics:{schema:'slipstream-diagnostics-v1',build:'2026-11-18-week4-classroom',exported:new Date().toISOString(),phase:game.phase,halted:game.halted,pitReason:game.pitReason,safety:{...game.safety},driving:{maximumSpeed:game.topSpeed,rampMs:game.rampMs,telemetryGraceMs:game.telemetryGraceMs,powerZoneMode:game.powerZoneMode??'off'},track:game.track?.toJSON()??null,trackChecks:trackValidation(game.track),cars:game.drivers.map(d=>({carId:d.id,model:d.car.model,simulated:d.car.simulated,...d.car.diagnostics()})),round:session.view(),operatorNotes:$('operatorNotes').value.slice(0,2000)}}; }
function canReport(){return game.halted&&!countdown&&game.phase!=='scanning'&&!game.diagnostic&&!game.forwardBaseline&&!game.laneCancellationComparison&&game.drivers.every(d=>d.car.speed===0)&&(recorder.cars.length>0||game.drivers.length>0);}
let reportText='';
function refreshReport() {
  if(!canReport()){$('reportNote').textContent='Choose STOP before generating a report.';return false;}
  reportText=renderRunReportText(buildRunReport(sessionTrace()));$('reportContent').textContent=reportText;
  $('reportNote').textContent=recorder.active?'Recording continues. This report is a snapshot; Update report includes later evidence.':'Recording is not active. Missing history is labeled; Record from now captures future commands and readings.';
  $('reportRecord').disabled=recorder.active||!game.drivers.length;return true;
}
$('openReport').onclick=()=>{if(refreshReport())$('reportDialog').showModal();};
$('closeReport').onclick=()=>$('reportDialog').close();
$('updateReport').onclick=refreshReport;
$('downloadReport').onclick=()=>{
  if(!refreshReport())return;
  const url=URL.createObjectURL(new Blob([reportText],{type:'text/plain;charset=utf-8'}));
  el('a',{href:url,download:'slipstream-run-report-'+new Date().toISOString().replace(/[:.]/g,'-')+'.txt'}).click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
$('printReport').onclick=()=>{if(refreshReport())window.print();};
$('reportRecord').onclick=()=>{if(!canReport()||recorder.active)return;$('record').onclick();refreshReport();};
$('saveTrace').onclick = () => {
  const link = el('a', {href: URL.createObjectURL(new Blob([JSON.stringify(sessionTrace())], {type: 'application/json'})), download: 'slipstream-trace-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'});
  link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
};
function chooseWorkspace(view) {
  if ((view === 'student') === isStudent()) return;
  halt('Workspace changed'); session.reset(); activeMission = null;
  document.body.dataset.view = view;
  if (isStudent()) {
    syncDrivingSettings();
    for (const driver of game.drivers) if (driver.control !== 'phone' && driver.control !== 'browser') game.setControl(driver,'browser');
  }
  for (const ui of cards.values()) ui.cancelSeat();
  if (room) {
    const url = phoneUrl('r=' + room.room + '&j=' + room.joinKey);
    $('joinUrl').value = url;
    drawQr($('qr'),url).catch(error => { $('roomNote').textContent = 'Could not update the shared code: ' + error.message; });
  }
  refresh();
}
$('studentView').onclick = () => chooseWorkspace('student');
$('advancedView').onclick = () => chooseWorkspace('advanced');
mountStudentLab($('studentLab'));
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
function cancelCommentary() { globalThis.speechSynthesis?.cancel(); }
function updateDrivingView(cars,now) {
  if(renderer!==studioRenderer || !studioRenderer || document.hidden)return;
  const shot=studioRenderer.cameraInfo;
  const car=cameraCar(cars,Number($('cameraCar').value));
  $('cameraBadge').textContent=shot.reason??(shot.label+(shot.frame&&car?' · '+car.name:''));
  const message=narrator.update({car,track:game.track,now,halted:game.halted});
  if(!message || $('commentaryMode').value==='off')return;
  $('driveNarration').textContent=message.text;
  if(message.urgent)cancelCommentary();
  if($('commentaryMode').value==='voice' && globalThis.speechSynthesis && globalThis.SpeechSynthesisUtterance) {
    cancelCommentary();
    const utterance=new globalThis.SpeechSynthesisUtterance(message.text);
    utterance.rate=1.05; globalThis.speechSynthesis.speak(utterance);
  }
}
function useMap(note = '2D telemetry map') {
  renderer = mapRenderer; $('map').hidden = false; $('map3d').hidden = true;
  $('view2d').setAttribute('aria-pressed','true'); $('view3d').setAttribute('aria-pressed','false');
  $('sceneNote').textContent = note;
  $('cinemaControls').hidden=$('cameraBadge').hidden=$('driveNarration').hidden=true; cancelCommentary();
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
    $('cinemaControls').hidden=$('cameraBadge').hidden=false;
    $('driveNarration').hidden=$('commentaryMode').value==='off';
    setCameraView();

  } catch (error) { requestedView='2d'; useMap('3D unavailable on this browser · 2D map active'); log('3D view unavailable: '+error.message); }
  finally { studioLoading=false; }
}
function setCameraView() {
  studioRenderer?.setView($('cameraMode').value,Number($('cameraCar').value));
  $('sceneNote').textContent=$('cameraMode').value==='orbit'?'Drag to orbit · Visual model, not measured elevation':'Camera follows recent track readings · returns to overview when position is uncertain';
  for(const id of ['cameraOut','cameraIn','cameraReset']) $(id).disabled=$('cameraMode').value!=='orbit';
}
$('cameraMode').onchange=$('cameraCar').onchange=setCameraView;
$('commentaryMode').onchange=()=>{
  cancelCommentary(); narrator.key=''; narrator.lastAt=-Infinity;
  $('driveNarration').hidden=$('commentaryMode').value==='off'||renderer!==studioRenderer;
  if($('commentaryMode').value==='voice' && (!globalThis.speechSynthesis||!globalThis.SpeechSynthesisUtterance)) {
    $('commentaryMode').value='captions'; $('sceneNote').textContent='Voice is unavailable in this browser. Captions remain available.';
  }
};
document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelCommentary();});
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
