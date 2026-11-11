import {CarLink} from '/link.mjs';
import {TraceLog} from '/trace.mjs';
import {ScanController as DriveController} from './scan-controller.mjs';
import {BrowserTransport,SimulationTransport} from './transport.mjs';

const $=id=>document.getElementById(id),trace=new TraceLog();
let controller,enabled=false,sessionLabel='',message='',lastState='';
const states={
  DISCONNECTED:'Not connected',SELECTING:'Choose one car',SELECTED:'Connected · identity needed',
  IDENTIFYING:'Sending light signal',WAITING_POWER_OFF:'Waiting for your power-button press',
  POWER_OFF_SEEN:'Disconnected · turn this car on',CONFIRMED:'Car confirmed · ready to arm',
  ARMING:'Checking car',ARMED:'Armed · ready for one pulse',CHECKING:'Checking connection',
  MOVING:'Pulse requested · watch the car',SCAN_STARTING:'Checking scan readiness',SCANNING:'Scanning track · watch the car',STOPPING:'Sending STOP',
};
const driveStates=['CONFIRMED','ARMING','ARMED','CHECKING','MOVING','SCAN_STARTING','SCANNING'];
function note(source,text){const kept=trace.append(source,text);$('trace').textContent=trace.view;return kept;}
function humanError(error){
  const text=error.message||String(error);
  const firmware=text.match(/Unreviewed firmware (\d+)/);
  if(firmware)return `This car’s firmware (${firmware[1]}) is not approved for this trial. Driving is blocked.`;
  if(text.includes('Battery outside'))return 'Battery reading is outside the trial limits. Inspect or charge the car before retrying.';
  if(text.includes('User cancelled')||text.includes('User canceled'))return 'Selection cancelled. No car was confirmed.';
  return text;
}
function stopMessage(c){
  if(!c?.stopResult)return '';
  if(c.stopReason?.startsWith('No expected disconnect'))return 'No power-off was detected during the check. Connect again when you are ready to press the car’s button. No motor command was sent.';
  if(c.stopResult.toLowerCase().includes('no motor command'))return 'Disconnected. No drive command was sent in this session.';
  if(c.stopResult.includes('write completed'))return 'Stop command sent. Check that the physical car has stopped.';
  return 'Stop delivery is unverified. If the car is moving, switch it off physically.';
}
function render(){
  const c=controller,s=c?.state||'DISCONNECTED',active=s!=='DISCONNECTED';
  const mode=c?.transport.mode||'SIMULATION',isLive=mode==='LIVE';
  const proof=c?.identityMethod==='power-cycle'?'power':c?.signalled?'light':null;
  if(s!==lastState&&['DISCONNECTED','SELECTING','IDENTIFYING','WAITING_POWER_OFF','POWER_OFF_SEEN'].includes(s))$('observed').checked=false;
  lastState=s;
  $('modeState').replaceChildren(Object.assign(document.createElement('strong'),{textContent:mode}),document.createTextNode(s==='SELECTING'?(c?.transport.stage||states[s]):states[s]||'Working…'));
  $('mode').disabled=active||!!c?.transport.setupPending||!enabled;
  for(const id of ['label','context','fallback'])$(id).disabled=active;
  $('select').textContent=s==='POWER_OFF_SEEN'?'Reconnect same car':c?.transport.retryBrowserId?'Retry same car':'Connect one car';
  $('select').disabled=!!c?.transport.setupPending||!enabled||!['DISCONNECTED','POWER_OFF_SEEN'].includes(s)||!$('safe').checked||!$('label').value.trim();
  $('disconnect').disabled=!active;
  $('disconnect').textContent=['WAITING_POWER_OFF','POWER_OFF_SEEN'].includes(s)?'Cancel check':'Disconnect';
  $('identifyStep').hidden=['DISCONNECTED','SELECTING'].includes(s);
  $('driveStep').hidden=!driveStates.includes(s);
  $('targetLabel').textContent=sessionLabel||$('label').value;
  $('powerCheck').hidden=!isLive;
  $('powerCheck').disabled=s!=='SELECTED'||!$('safe').checked;
  $('identify').disabled=s!=='SELECTED'||!$('safe').checked;
  $('powerHelp').hidden=!isLive||driveStates.includes(s);
  $('observed').disabled=s!=='SELECTED'||!proof;
  $('confirm').disabled=s!=='SELECTED'||!proof||!$('observed').checked||!$('safe').checked;
  if(s==='WAITING_POWER_OFF'){
    $('identityPrompt').textContent='Press and release the grey button once to turn this labeled car OFF. Wait for this page to notice the disconnection. Do not click Disconnect.';
  }else if(s==='POWER_OFF_SEEN'){
    $('identityPrompt').textContent='A disconnection was observed. If you caused it by switching this labeled car off, press once to turn it ON, then click “Reconnect same car” above and select the same car in the fresh chooser. A different device is rejected before connection.';
  }else if(s==='IDENTIFYING'){
    $('identityPrompt').textContent=isLive?'Watch this labeled car for off → green → off. No visible pattern means no light confirmation.':'Rehearsing the light step. No real car receives commands.';
  }else if(proof==='power'){
    $('identityPrompt').textContent='The same browser device was reconnected. Confirm only if you personally caused the off/on change on this labeled car.';
  }else if(proof==='light'){
    $('identityPrompt').textContent=isLive?'The light writes completed. Confirm only if you saw off → green → off on this exact labeled car. If not, use the power-button check.':'Simulation light step complete. Confirm below to rehearse arming and one pulse.';
  }else{
    $('identityPrompt').textContent=isLive?'Identify this car with its power button, or try the optional off → green → off light signal. A device name alone is not enough.':'Use the light step to rehearse physical identification. No Bluetooth radio is used.';
  }
  $('observedText').textContent=!isLive?'I understand this is SIMULATION, and I am rehearsing confirmation.':proof==='power'?
    'I switched this exact labeled car off, saw the page detect disconnection, turned it on and reconnected the same device.':
    'I personally saw off → green → off on this exact labeled car.';
  $('arm').disabled=s!=='CONFIRMED'||!$('safe').checked;
  $('pulse').disabled=s!=='ARMED'||!$('safe').checked;
  $('normalStop').disabled=!driveStates.includes(s);
  $('speed').disabled=!['CONFIRMED','ARMED'].includes(s);
  renderTrack(c,s);
  $('identity').textContent=c?.identity?`Selected name: ${c.identity.name||'(unnamed)'} · Browser ID: ${c.identity.browserId}. This is not a hardware serial or physical identity proof.`:
    c?.powerTarget?.browserId?`Power check expects browser ID: ${c.powerTarget.browserId}. This is not a MAC address.`:'No selected device. Browser IDs are not MAC addresses or physical identity proof.';
  $('debugState').textContent=`State: ${s} · Connection stage: ${c?.transport.stage||'simulation'} · Identity method: ${c?.identityMethod|| (c?.signalled?'light trial':'not confirmed')}`;
  $('telemetry').textContent=Number.isInteger(c?.firmware)?`${s==='DISCONNECTED'?'Last session · ':''}${mode} · firmware ${c.firmware} · battery ${c.battery??'not yet read'} mV. These do not prove physical identity.`:'No live measurements.';
  $('debugResult').textContent=c?.stopResult||'';
  $('result').textContent=c?.transport.setupPending&&s!=='SELECTING'?'The browser is finishing the previous connection attempt. Wait until Retry same car becomes available. No drive command was sent.':message||stopMessage(c);
}
function renderTrack(c,s){
  const track=c?.trackSnapshot(),recorded=track&&track.status!=='IDLE';
  $('trackStep').hidden=!driveStates.includes(s)&&!recorded;
  const ready=!!c?.pulseReadyForQualification;
  if(!ready)$('pulseObserved').checked=false;
  $('pulseObserved').disabled=!ready||s!=='CONFIRMED';
  $('qualify').disabled=!ready||!$('pulseObserved').checked||s!=='CONFIRMED';
  if(!c?.scanQualified)$('contained').checked=false;
  $('contained').disabled=!c?.scanQualified||!['CONFIRMED','ARMED'].includes(s);
  $('scan').disabled=s!=='ARMED'||!c?.scanQualified||!$('contained').checked||!$('safe').checked;
  $('qualification').textContent=c?.scanQualified?`Observation recorded for this session, up to ${c.qualifiedSpeed} mm/s. Scan uses the Speed field above.`:'A completed pulse, successful STOP write and your physical observation are required for this session.';
  $('exportTrack').disabled=!recorded;
  $('trackStatus').textContent=recorded?`${track.mode} · ${track.status} · ${track.pieces.length} observed pieces · ${track.observations.length} messages. ${track.reason||''}`:'No scan recorded.';
  $('trackPieces').textContent=recorded?track.pieces.map((p,i)=>`${i+1}: ${p.kind}${p.turn?' '+p.turn:''} [${p.observedIds.join('/')||'?'}]`).join(' → '):'';
  $('trackWarnings').textContent=recorded?track.warnings.join(' '):'';
  // Geometry exists only for a complete, supported observed loop. All SVG
  // coordinates below originate in the bounded numeric geometry model.
  const points=track?.geometry?.path;
  if(points?.length){
    const xs=points.map(p=>p.xMm),ys=points.map(p=>p.yMm),pad=180;
    const x=Math.min(...xs)-pad,y=Math.min(...ys)-pad,w=Math.max(...xs)-x+pad,h=Math.max(...ys)-y+pad;
    let d=`M ${points[0].xMm} ${points[0].yMm}`;
    for(let i=1;i<points.length;i++){
      const p=track.pieces[i-1],end=points[i];
      d+=p.kind==='curve'?` A 280 280 0 0 ${p.turn==='R'?1:0} ${end.xMm} ${end.yMm}`:` L ${end.xMm} ${end.yMm}`;
    }
    $('trackMap').innerHTML=`<p class="hint">Derived flat-loop schematic; verify against the physical track. Origin and orientation are arbitrary.</p><svg role="img" aria-label="Track schematic derived from recorded messages" viewBox="${x} ${y} ${w} ${h}" style="width:100%;max-height:22rem"><path d="${d}" fill="none" stroke="#18484c" stroke-width="90"/><circle cx="0" cy="0" r="55" fill="#db9d24"/></svg>`;
  }else $('trackMap').innerHTML='';
}
function build(){
  const transport=$('mode').value==='live'?new BrowserTransport(note,{enabled,Link:CarLink}):new SimulationTransport();
  controller=new DriveController(transport,{enabled,note,changed:render});sessionLabel='';lastState='';render();
}
async function run(action){
  message='';$('result').textContent='';
  try{await action();render();}
  catch(error){
    message=humanError(error);
    try{note(controller?.transport.mode||'UI','UI error: '+(error.message||String(error)));}catch{}
    render();
  }
}
function safety(){if(!$('safe').checked)throw new Error('Confirm the physical safety setup first.');}
$('mode').addEventListener('change',()=>{
  if(controller?.state!=='DISCONNECTED'){$('mode').value=controller?.transport.mode==='LIVE'?'live':'simulation';return;}
  $('observed').checked=false;$('safe').checked=false;message='';build();
});
$('label').addEventListener('input',render);
$('observed').addEventListener('change',render);
$('select').addEventListener('click',()=>run(async()=>{
  safety();
  if(controller.state!=='POWER_OFF_SEEN'){
    sessionLabel=$('label').value;
    if(!sessionLabel.trim())throw new Error('Enter the label attached to this physical car.');
    note(controller.transport.mode,'Operator setup '+JSON.stringify({label:sessionLabel,context:$('context').value}));
  }
  $('observed').checked=false;
  await controller.select({showAllDevices:$('fallback').checked});
}));
$('powerCheck').addEventListener('click',()=>run(()=>{
  safety();$('observed').checked=false;
  if(controller.transport.mode!=='LIVE')throw new Error('Use the light step to rehearse in SIMULATION.');
  return controller.beginPowerCheck({safe:true});
}));
$('identify').addEventListener('click',()=>run(()=>{
  safety();$('observed').checked=false;return controller.identify({safe:true});
}));
$('confirm').addEventListener('click',()=>run(()=>{
  safety();
  // One explicit observation binds the chosen device to the fixed session label.
  // Re-entering opaque IDs or the same label would add no physical evidence.
  return controller.confirm({label:sessionLabel,typedLabel:sessionLabel,browserId:controller.identity?.browserId,
    observed:$('observed').checked,safe:true});
}));
$('arm').addEventListener('click',()=>run(()=>{safety();return controller.arm();}));
$('pulse').addEventListener('click',()=>run(()=>{safety();return controller.pulse(Number($('speed').value));}));
$('pulseObserved').addEventListener('change',render);
$('contained').addEventListener('change',()=>{if(!$('contained').checked&&['SCAN_STARTING','SCANNING'].includes(controller?.state))emergency('Track containment confirmation revoked');render();});
$('qualify').addEventListener('click',()=>run(()=>{safety();return controller.qualify({movementObserved:$('pulseObserved').checked,stopObserved:$('pulseObserved').checked});}));
$('scan').addEventListener('click',()=>run(()=>{safety();return controller.scan({containedTrack:$('contained').checked,speed:Number($('speed').value),durationMs:45000});}));
$('exportTrack').addEventListener('click',()=>{
  const record=controller.trackSnapshot();
  const url=URL.createObjectURL(new Blob([JSON.stringify(record,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='cs460-track-'+record.mode.toLowerCase()+'-'+new Date().toISOString().replaceAll(':','-')+'.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
function emergency(reason){if(controller)void run(()=>controller.stop(reason,true));}
$('stop').addEventListener('click',()=>emergency('Operator EMERGENCY STOP'));
$('disconnect').addEventListener('click',()=>emergency('Operator disconnect / cancel check'));
$('normalStop').addEventListener('click',()=>run(()=>controller.stop('Operator STOP')));
$('safe').addEventListener('change',()=>{if(!$('safe').checked)emergency('Physical safety confirmation revoked');render();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();emergency('Escape emergency stop');}});
// A browser chooser can blur this window. Armed trials lose their authorization.
window.addEventListener('blur',()=>{if(['ARMING','ARMED','CHECKING','MOVING','SCAN_STARTING','SCANNING'].includes(controller?.state))emergency('Window lost focus');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)emergency('Page hidden');});
window.addEventListener('pagehide',()=>emergency('Page exit'));
$('export').addEventListener('click',()=>{
  const url=URL.createObjectURL(new Blob([trace.text],{type:'text/plain'}));
  const a=document.createElement('a');a.href=url;a.download='cs460-drive-trace-'+new Date().toISOString().replaceAll(':','-')+'.txt';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
try{
  const response=await fetch('./config.json',{cache:'no-store'});
  if(!response.ok)throw new Error('Instructor drive is disabled on this server');
  enabled=(await response.json()).instructorLiveDrive===true;
  if(!enabled)throw new Error('Instructor opt-in is disabled');
  build();note('SIMULATION','Instructor preview opened; default simulation, no radio');
}catch(error){message=humanError(error);render();}
