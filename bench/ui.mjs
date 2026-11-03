import {CarLink,Replay} from './link.mjs';
import {TraceLog} from './trace.mjs';
import {CarLabels} from './car-labels.mjs';
const $=id=>document.getElementById(id);
const evidence=!!$('trace');
const trace=new TraceLog(),ops=[...document.querySelectorAll('[data-op]')];
const lightActions=new Set(['lampOn','lampOff','engineGreen','engineOff']);
const stateChanges=new Set([...lightActions,'sdkOn','sdkOff']);
let storage;try{storage=window.localStorage;}catch{}
const carLabels=new CarLabels(storage),rememberedDevices=new Map();
let refreshingCars=false,refreshNumber=0;
let link=null,pendingLink=null,busy=false,mode='Disconnected',confirmed=false,session=0,timer=null,pendingLamp=false,liveOpening=0;
let confirmedSession=null,lastLampAttempt=null,lampSequence=0,batterySequence=0,pendingBatteryAttempt=null,savedStoppedTrace=false,batteryRetryBlocked=false;
const source=()=>mode==='Live car connected'?'LIVE':'REPLAY';
function cancelCheck(){if(timer!==null){clearTimeout(timer);timer=null;}pendingBatteryAttempt=null;}
function batteryCheck(kind){
  cancelCheck();
  const attempt=session+'/battery-'+(++batterySequence);
  if(!note(kind+' battery check','local attempt '+attempt+'; a reply in this window does not prove which request caused it'))return false;
  pendingBatteryAttempt=attempt;
  $('batteryResult').textContent=kind+': waiting for battery RX… · local attempt '+attempt;
  timer=setTimeout(()=>{
    timer=null;pendingBatteryAttempt=null;
    if(kind==='LIVE')batteryRetryBlocked=true;
    $('batteryResult').textContent=kind+': no battery RX within five seconds; result inconclusive. If a write remains pending, Disconnect to recover. Disconnect and reconnect before another battery request. · local attempt '+attempt;
    note(kind,'battery request timed out after five seconds; local attempt '+attempt);controls();
  },5000);
  return true;
}
$('context').textContent='Browser path: '+(window.isSecureContext?'secure':'insecure')+' · '+(window.top===window.self?'direct tab':'embedded preview')+' · Web Bluetooth API '+(navigator.bluetooth?'present':'unavailable');
function note(kind,message,row){
  const batteryMatch=timer!==null && kind===(source()==='LIVE'?'LIVE decoded':'REPLAY RX') && row?.id===0x1b && row.text.startsWith('battery ');
  const attempt=pendingBatteryAttempt;
  const retained=trace.append(kind,batteryMatch?message+' · local attempt '+attempt+'; battery observed during request window; no response sequence number':message);
  if(evidence){$('trace').textContent=trace.view;$('trace').scrollTop=$('trace').scrollHeight;}
  if(trace.stopped){
    if(timer!==null)$('batteryResult').textContent=source()+': trace incomplete; battery check stopped without a retained result.';
    $('commandResult').textContent=evidence?'Trace incomplete: no further result can be credited. Disconnect, save and clear before continuing.':'Session limit reached. Disconnect and reload before continuing. Use the detailed evidence bench for trace collection.';
    cancelCheck();controls();return false;
  }
  if(retained&&(/error$/.test(kind)||((kind==='LIVE decoded'||kind==='REPLAY RX')&&row?.id!==0x1b)))$('commandResult').textContent=kind+': '+message;
  if(retained&&(kind==='LIVE SDK'||kind==='REPLAY SDK'))$('sdkResult').textContent=kind+': '+message;
  if(retained&&batteryMatch){
    cancelCheck();
    $('batteryResult').textContent=kind+': '+row.text+' · '+row.raw+' · '+new Date().toISOString()+' · battery observed during request window; local attempt '+attempt;
    controls();
  }
  return retained;
}
function mayObserve(){return !!confirmedSession&&!!lastLampAttempt&&!busy&&!trace.stopped&&(mode==='Live car connected'||mode==='Disconnected');}
function labelConflict(){
  const id=link?.selection?.browserId,label=$('assignedCar').value.trim().toLowerCase();
  return id?carLabels.entries().find(car=>car.browserId!==id&&car.label.toLowerCase()===label):null;
}
function controls(){
  const live=mode==='Live car connected',stopped=trace.stopped;
  const known=live&&carLabels.find(link?.selection?.browserId);
  for(const b of ops)b.disabled=!link||busy||timer!==null||stopped||(live&&stateChanges.has(b.dataset.op)&&!confirmed)||(live&&b.dataset.op==='battery'&&batteryRetryBlocked);
  $('replay').disabled=!!link||busy||stopped;
  $('live').disabled=!!link||busy||refreshingCars||liveOpening>0||stopped||!$('assignedCar').value.trim();
  $('close').disabled=!link&&!pendingLink;
  $('confirm').disabled=!live||busy||confirmed||stopped||!!(known&&known.label!==$('assignedCar').value.trim())||!!labelConflict();
  $('rememberCar').disabled=!live||busy||timer!==null||!confirmed||stopped||!link?.selection?.browserId;
  $('refreshCars').disabled=!!link||busy||refreshingCars||liveOpening>0||stopped;
  $('rememberedCar').disabled=!!link||busy||refreshingCars||liveOpening>0||stopped;
  $('connectRemembered').disabled=!!link||busy||refreshingCars||liveOpening>0||stopped||!rememberedDevices.has($('rememberedCar').value);
  $('forgetRemembered').disabled=!!link||busy||refreshingCars||stopped||!carLabels.find($('rememberedCar').value);
  if(evidence){
    $('recordObservation').disabled=!mayObserve()||!$('observation').value;
    $('clear').disabled=!!link||busy||(stopped&&!savedStoppedTrace);
  }
  for(const id of ['assignedCar','sessionNotes','allDevices'])$(id).disabled=!!link||busy||stopped;
  $('status').textContent=mode==='Disconnected'&&liveOpening>0?'Disconnected; finishing the previous Bluetooth attempt.'+(stopped?'':' Replay is available.'):mode;
  if(evidence){
  $('traceNotice').textContent=stopped?'Trace incomplete: recording and new operations stopped at the size limit. Disconnect, save the retained trace, then clear to restart.':'Showing the latest 200 lines. Save trace exports the full retained log.';
  $('observationContext').textContent=confirmedSession&&lastLampAttempt
    ? 'For session '+confirmedSession.number+', '+confirmedSession.label+'; '+lastLampAttempt.id+' '+lastLampAttempt.command+'; '+lastLampAttempt.outcome+(mode==='Disconnected'?'. Record final observations after disconnect; no command will be sent.':'. Choose a fresh observation for this attempt.')
    : 'Run a light attempt on a confirmed live car to record a physical observation. Replay cannot record one.';
  }
}
function clearObservation(){if(evidence){$('observation').value='';$('observationNote').value='';}}
function resetResults(){
  pendingLamp=false;confirmedSession=lastLampAttempt=null;lampSequence=batterySequence=0;batteryRetryBlocked=false;clearObservation();
  $('commandResult').textContent='';
  $('batteryResult').textContent='No battery request this session.';
  $('lampResult').textContent='No light command this session.';
  $('sdkResult').textContent='No SDK request this session; actual car mode unknown.';
  $('recognition').textContent='';
  $('selection').textContent='No live car selected.';
}
function forget(){
  if(timer!==null)$('batteryResult').textContent=source()+': disconnected before a battery reply. · local attempt '+pendingBatteryAttempt;
  if(pendingLamp){
    $('lampResult').textContent=source()+': disconnected during light write; outcome unknown.';
    if(lastLampAttempt)lastLampAttempt=Object.freeze({...lastLampAttempt,outcome:'disconnected during write; outcome unknown'});
  }
  pendingLamp=false;cancelCheck();link=pendingLink=null;mode='Disconnected';confirmed=false;busy=false;session++;
  $('selection').textContent='No live car selected.';
  $('sdkResult').textContent='Disconnected; physical SDK state was not verified or reset by disconnect.';
  $('recognition').textContent='';
  $('allDevices').checked=false;controls();
}
async function connect(live,rememberedDevice=null){
  if(link||busy||trace.stopped||(live&&liveOpening>0))return;
  const label=$('assignedCar').value.trim();
  if(live&&!label)return;
  const current=++session;
  if(live)liveOpening++;
  busy=true;confirmed=false;mode=live?'Choosing car…':'Opening replay…';resetResults();controls();
  const kind=live?'LIVE':'REPLAY';
  const scopedNote=(...args)=>current===session?note(...args):false;
  const next=live?new CarLink(scopedNote,()=>{if(current===session)forget();}):new Replay(scopedNote);
  pendingLink=next;controls();
  try{
    if(!note(kind+' operator','local session '+current+'; assigned label: '+JSON.stringify(label||'(replay fixture)')+'; context captured at connect: '+JSON.stringify($('sessionNotes').value.trim()||'(not recorded)')))throw Error('Trace limit reached before connection');
    if(!note(kind+' browser',navigator.userAgent+'; bench fleet-led-v1; page '+(window.location?window.location.origin+window.location.pathname:'(not supplied)')))throw Error('Trace limit reached before connection');
    // Keep requestDevice directly in the click's user gesture, without a prior await.
    await next.open(live?navigator.bluetooth:null,{showAllDevices:$('allDevices').checked,rememberedDevice});
    if(current!==session)return;
    link=next;pendingLink=null;mode=live?'Live car connected':'Replay fixture';
    if(live){
      $('selection').textContent='Selected Chrome name: '+(next.selection.name||'(not supplied)')+' · browser device ID: '+(next.selection.browserId||'(not supplied)')+' · not yet confirmed';
      const known=carLabels.find(next.selection.browserId);
      if(known){rememberedDevices.set(next.selection.browserId,next.device);renderRemembered();}
      $('recognition').textContent=known?'Remembered label: '+known.label+'. Verify that physical label before confirming.':'New to this browser. Enroll with only one car powered on nearby; then confirm its physical label.';
      if(known&&known.label!==label)$('recognition').textContent+=' Your entered label differs; light controls stay locked. Disconnect and use the remembered car. To correct an old mapping, forget its label while disconnected and enroll again.';
      if(labelConflict())$('recognition').textContent='That physical label is already saved for a different browser device. Light controls stay locked. Disconnect and choose the remembered car; if permissions changed, forget the old label and enroll the isolated car again.';
      note('LIVE recognition',known?'local saved label '+JSON.stringify(known.label)+'; physical identity still requires operator confirmation':'no saved label for this browser device');
    }
    else $('selection').textContent='REPLAY fixture — no Bluetooth device or physical LED.';
  }catch(e){
    // Setup failures can call forget() through the link's close callback first.
    if(current===session){next.close();if(current===session)forget();note(kind+' error',e.name+': '+e.message);}
  }finally{if(live)liveOpening--;if(current===session)busy=false;controls();}
}
$('assignedCar').oninput=controls;
function renderRemembered(){
  const selected=$('rememberedCar').value;
  const options=[new Option('Choose a remembered car','')];
  for(const car of carLabels.entries())options.push(new Option(car.label+' · '+(car.name||'unnamed car')+(rememberedDevices.has(car.browserId)?' · permission available':' · refresh permissions'),car.browserId));
  $('rememberedCar').replaceChildren(...options);
  if(carLabels.find(selected))$('rememberedCar').value=selected;
}
$('rememberedCar').onchange=controls;
$('refreshCars').onclick=async()=>{
  if($('refreshCars').disabled)return;
  const request=++refreshNumber,current=session;
  refreshingCars=true;controls();
  try{
    if(typeof navigator.bluetooth?.getDevices!=='function')throw Error('This browser cannot list prior permissions. '+rememberedDevices.size+' remembered car(s) can reconnect in this open page. Keep the page open; after reload, use Choose assigned car with isolated enrollment again.');
    const devices=await navigator.bluetooth.getDevices();
    if(current!==session||request!==refreshNumber)return;
    rememberedDevices.clear();
    for(const device of devices)if(carLabels.find(device.id))rememberedDevices.set(device.id,device);
    $('fleetStatus').textContent=rememberedDevices.size+' remembered car permission(s) available. This is not a scan or proof that a car is nearby. Missing permission? Enroll again with only that car powered on.';
  }catch(error){if(current===session)$('fleetStatus').textContent=error.message;}
  finally{if(request===refreshNumber){refreshingCars=false;renderRemembered();controls();}}
};
$('rememberCar').onclick=()=>{
  if($('rememberCar').disabled)return;
  try{
    const saved=carLabels.remember(link.selection,confirmedSession.label);
    rememberedDevices.set(saved.browserId,link.device);
    $('fleetStatus').textContent='Remembered '+saved.label+' in this browser for this site. Reconnect is ready while this page stays open. After a reload, Refresh needs browser support or isolated selection again. Recheck the physical label on every connection.';
    note('LIVE operator','saved browser-device label '+JSON.stringify(saved)+'; operator mapping, not authenticated identity');
    renderRemembered();
  }catch(error){$('fleetStatus').textContent=error.message;}
  controls();
};
$('connectRemembered').onclick=()=>{
  if($('connectRemembered').disabled)return;
  const id=$('rememberedCar').value,saved=carLabels.find(id),device=rememberedDevices.get(id);
  if(!saved||!device)return;
  $('assignedCar').value=saved.label;
  return connect(true,device);
};
$('forgetRemembered').onclick=()=>{
  if($('forgetRemembered').disabled)return;
  try{
    const id=$('rememberedCar').value;carLabels.forget(id);rememberedDevices.delete(id);
    $('fleetStatus').textContent='Local label forgotten. Chrome Bluetooth permission was not revoked.';renderRemembered();
  }catch(error){$('fleetStatus').textContent=error.message;}
  controls();
};
if(evidence)$('observation').onchange=controls;
$('replay').onclick=()=>connect(false);$('live').onclick=()=>connect(true);
$('close').onclick=()=>{const current=session;(link||pendingLink)?.close();if(current===session)forget();};
$('confirm').onclick=()=>{
  if($('confirm').disabled||!link||busy||trace.stopped||mode!=='Live car connected'||confirmed)return;
  try{
    link.confirmAssignedCar($('assignedCar').value);
    if(trace.stopped)return;
    confirmedSession=Object.freeze({number:session,label:$('assignedCar').value.trim(),selection:Object.freeze({...link.selection})});
    confirmed=true;$('selection').textContent+=' · assignment confirmed by operator';controls();
  }catch(e){note('LIVE error',e.message);}
};
for(const b of ops)b.onclick=async()=>{
  if(b.disabled||!link||busy||trace.stopped)return;
  const active=link,current=session,kind=source(),op=b.dataset.op;
  busy=true;
  if(op==='battery'&&!batteryCheck(kind)){busy=false;controls();return;}
  const lamp=lightActions.has(op);
  if(lamp){
    clearObservation();pendingLamp=true;
    lastLampAttempt=kind==='LIVE'?Object.freeze({id:confirmedSession.number+'/lamp-'+(++lampSequence),command:op,outcome:'write pending',sdkContext:$('sdkResult').textContent}):null;
    $('lampResult').textContent=kind+': light write pending…';
    if(lastLampAttempt&&!note('LIVE lamp attempt',JSON.stringify({session:confirmedSession,attempt:lastLampAttempt}))){
      lastLampAttempt=Object.freeze({...lastLampAttempt,outcome:'not sent: trace limit reached'});
      $('lampResult').textContent='Light command not sent: trace limit reached.';pendingLamp=false;busy=false;controls();return;
    }
  }
  controls();
  try{
    await active.send(op);
    if(current!==session)return;
    pendingLamp=false;
    if((op==='sdkOn'||op==='sdkOff')&&!trace.stopped)$('commandResult').textContent=kind==='REPLAY'?'REPLAY: '+op+' rehearsed; no physical car.':'LIVE: '+op+' write completed; car response unverified.';
    if(lamp){
      if(lastLampAttempt)lastLampAttempt=Object.freeze({...lastLampAttempt,outcome:trace.stopped?'trace incomplete; write outcome not fully recorded':'write completed; visible outcome unverified',sdkContext:$('sdkResult').textContent});
      $('lampResult').textContent=trace.stopped?'Trace incomplete; light outcome is not fully recorded.':kind==='REPLAY'?'REPLAY: command rehearsed; no physical LED.':'LIVE: '+op+' write completed. Observe the assigned car'+(evidence?' and record what you see.':'; visible behavior is unverified.');
    }
  }catch(e){
    if(current!==session)return;
    pendingLamp=false;
    if(op==='battery'){cancelCheck();if(kind==='LIVE')batteryRetryBlocked=true;$('batteryResult').textContent=trace.stopped?'Trace incomplete; battery check stopped.':kind+': battery write failed: '+e.message+'; result inconclusive. Disconnect and reconnect before another battery request.';}
    if(lamp){
      if(lastLampAttempt)lastLampAttempt=Object.freeze({...lastLampAttempt,outcome:'write failed or completion unknown: '+e.message,sdkContext:$('sdkResult').textContent});
      $('lampResult').textContent=kind+': light write failed: '+e.message;
    }
    note(kind+' error',e.message);
  }finally{if(current===session){busy=false;controls();}}
};
if(evidence)$('recordObservation').onclick=()=>{
  if(!mayObserve())return;
  const observation=$('observation').value;
  if(!observation)return;
  const afterDisconnect=mode==='Disconnected';
  const retained=note('LIVE observation','operator reports: '+observation+'; '+JSON.stringify({session:confirmedSession,attempt:lastLampAttempt,afterDisconnect,note:$('observationNote').value.trim()})+'; not telemetry');
  if(retained){
    $('lampResult').textContent='LIVE operator observation'+(afterDisconnect?' after disconnect':'')+': '+observation+' (not telemetry).';
    clearObservation();
  }
  controls();
};
window.addEventListener('pagehide',()=>{const current=session;(link||pendingLink)?.close();if(current===session)forget();});
if(evidence)$('save').onclick=()=>{
  const u=URL.createObjectURL(new Blob([trace.text],{type:'text/plain'}));
  const a=document.createElement('a');a.href=u;
  a.download='second-lap-bench-trace-'+new Date().toISOString().replaceAll(':','-')+'.txt';a.click();
  if(trace.stopped)savedStoppedTrace=true;
  setTimeout(()=>URL.revokeObjectURL(u),1000);controls();
};
if(evidence)$('clear').onclick=()=>{if(link||busy||(trace.stopped&&!savedStoppedTrace))return;trace.clear();savedStoppedTrace=false;$('trace').textContent='No traffic yet.';resetResults();controls();};
renderRemembered();
$('fleetStatus').textContent=carLabels.warning||'Remember each physical car once. Refresh lists previously granted permissions, not nearby cars.';
controls();
