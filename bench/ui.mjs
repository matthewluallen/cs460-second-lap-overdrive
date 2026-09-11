import {CarLink,Replay} from './link.mjs';
import {TraceLog} from './trace.mjs';
import {CarLabels} from './car-labels.mjs';
import {EnrollmentProbe} from './detection.mjs';
import {uuids} from './protocol.mjs';
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
let probe=null,probeCandidate=null,probeLabel='',probeEpoch=0,probeSelecting=false,probeSelectionCancelled=false,signalTrial=null;
const probeActive=()=>!!probe&&['opening','ready','sampling'].includes(probe.snapshot.state);
const identificationBusy=()=>probeSelecting||probeActive();
const source=()=>mode==='Live car connected'?'LIVE':'REPLAY';
function storedDisplayName(value){
  // Optional display text only: never parse an assumed advertisement prefix or
  // alter the opaque browser ID. The original browser name stays in the trace.
  const escaped=(typeof value==='string'?value:'').replace(
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g,
    c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')
  );
  return escaped.length>128?escaped.slice(0,127)+'…':escaped;
}
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
  const live=mode==='Live car connected',stopped=trace.stopped,identifying=identificationBusy();
  const known=live&&carLabels.find(link?.selection?.browserId);
  for(const b of ops)b.disabled=!link||busy||timer!==null||stopped||(live&&stateChanges.has(b.dataset.op)&&!confirmed)||(live&&b.dataset.op==='battery'&&batteryRetryBlocked);
  $('replay').disabled=!!link||busy||stopped||identifying;
  $('live').disabled=!!link||busy||refreshingCars||liveOpening>0||stopped||identifying||!$('assignedCar').value.trim();
  $('close').disabled=!link&&!pendingLink;
  $('confirm').disabled=!live||busy||confirmed||stopped||!!(known&&known.label!==$('assignedCar').value.trim())||!!labelConflict();
  $('rememberCar').disabled=!live||busy||timer!==null||!confirmed||stopped||!link?.selection?.browserId;
  $('refreshCars').disabled=!!link||busy||refreshingCars||liveOpening>0||stopped||identifying;
  $('rememberedCar').disabled=!!link||busy||refreshingCars||liveOpening>0||stopped||identifying;
  $('connectRemembered').disabled=!!link||busy||refreshingCars||liveOpening>0||stopped||identifying||!carLabels.find($('rememberedCar').value);
  $('forgetRemembered').disabled=!!link||busy||refreshingCars||stopped||identifying||!carLabels.find($('rememberedCar').value);
  const free=!link&&!busy&&!refreshingCars&&!liveOpening&&!stopped&&!identifying;
  $('identifyChoose').disabled=!free||!$('assignedCar').value.trim();
  $('identifyStart').disabled=!free||!probeCandidate;
  $('identifyNext').disabled=stopped||probe?.snapshot.state!=='ready';
  $('identifyCancel').disabled=!(probeActive()||(probeSelecting&&!probeSelectionCancelled));
  $('identifyConnect').disabled=!free||!probeCandidate;
  $('identifySignal').disabled=!live||busy||timer!==null||stopped||confirmed||!!(known&&known.label!==$('assignedCar').value.trim())||!!labelConflict();
  $('identifyMatch').disabled=!live||busy||stopped||!signalTrial||signalTrial.session!==session||!signalTrial.finished||signalTrial.observed;
  if(evidence){
    $('recordObservation').disabled=!mayObserve()||!$('observation').value;
    $('clear').disabled=!!link||busy||identifying||(stopped&&!savedStoppedTrace);
  }
  for(const id of ['assignedCar','sessionNotes','allDevices'])$(id).disabled=!!link||busy||stopped||identifying;
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
  signalTrial=null;$('identifyLight').textContent='No identification light trial this session. A visual report does not automatically confirm or save the car.';
  pendingLamp=false;confirmedSession=lastLampAttempt=null;lampSequence=batterySequence=0;batteryRetryBlocked=false;clearObservation();
  $('commandResult').textContent='';
  $('batteryResult').textContent='No battery request this session.';
  $('lampResult').textContent='No light command this session.';
  $('sdkResult').textContent='No SDK request this session; actual car mode unknown.';
  $('recognition').textContent='';
  $('selection').textContent='No live car selected.';
}
function forget(){
  if(signalTrial&&!signalTrial.finished)$('identifyLight').textContent='Disconnected during identification; light state and cleanup are unknown. Re-identify before saving.';
  signalTrial=null;
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
  if(link||busy||trace.stopped||identificationBusy()||(live&&liveOpening>0))return;
  if(probeCandidate&&rememberedDevice!==probeCandidate)clearCandidate();
  const label=$('assignedCar').value.trim();
  if(live&&!label)return;
  const savedLabel=live?carLabels.entries().find(car=>car.label.toLowerCase()===label.toLowerCase()):null;
  const expectedBrowserId=rememberedDevice?.id??savedLabel?.browserId??null;
  const current=++session;
  if(live)liveOpening++;
  busy=true;confirmed=false;mode=live?'Choosing car…':'Opening replay…';resetResults();controls();
  const kind=live?'LIVE':'REPLAY';
  const scopedNote=(...args)=>current===session?note(...args):false;
  const next=live?new CarLink(scopedNote,()=>{if(current===session)forget();}):new Replay(scopedNote);
  pendingLink=next;controls();
  try{
    if(!note(kind+' operator','local session '+current+'; assigned label: '+JSON.stringify(label||'(replay fixture)')+'; context captured at connect: '+JSON.stringify($('sessionNotes').value.trim()||'(not recorded)')))throw Error('Trace limit reached before connection');
    if(!note(kind+' browser',navigator.userAgent+'; bench identify-v1; page '+(window.location?window.location.origin+window.location.pathname:'(not supplied)')))throw Error('Trace limit reached before connection');
    if(live&&expectedBrowserId&&!note('LIVE recognition guard','saved label '+JSON.stringify(savedLabel?.label||label)+' expects browser device ID '+JSON.stringify(expectedBrowserId)+'; '+(rememberedDevice?'checking retained permission object':'Chrome chooser selection must match before GATT connection')+'; physical confirmation is still required'))throw Error('Trace limit reached before saved-car check');
    // Keep requestDevice directly in the click's user gesture, without a prior await.
    await next.open(live?navigator.bluetooth:null,{showAllDevices:$('allDevices').checked,rememberedDevice,expectedBrowserId});
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
function clearCandidate(){
  probeEpoch++;probe?.cancel();probe=null;probeCandidate=null;probeLabel='';
  $('identifySelection').textContent='No identification candidate selected.';
  $('identifyStatus').textContent='Choose one candidate for a new check. Results never automatically confirm or save a car.';
  $('identifySteps').textContent=$('identifyResults').textContent='';
}
function renderProbe(snapshot){
  $('identifyStatus').textContent=snapshot.message;
  $('identifySteps').textContent=snapshot.phase?snapshot.phase.instruction+' Sampling window: '+snapshot.phase.durationMs/1000+' seconds.':'';
  $('identifyNext').textContent=snapshot.phase?.button||"I'm ready — sample this step";
  $('identifyResults').textContent=snapshot.results.map(row=>row.key+': '+row.count+' advertisements'+
    (row.quiet===null?' · '+row.rssiCount+' signal samples · median '+(row.median??'unavailable')+' dBm · spread '+(row.iqr??'unavailable')+' dB':row.quiet?' · no advertisement observed after settling; not proof of power-off':' · advertisements continued during the off check')+
    (row.omittedCount?' · '+row.omittedCount+' samples beyond recording cap':'')).join(' | ');
  controls();
}
$('identifyChoose').onclick=async()=>{
  if($('identifyChoose').disabled)return;
  clearCandidate();const current=probeEpoch,label=$('assignedCar').value.trim();
  probeSelecting=true;probeSelectionCancelled=false;controls();
  $('identifyStatus').textContent='Choose one course-car candidate. No connection or command is made by this selection.';
  try{
    if(!navigator.bluetooth)throw Error('Web Bluetooth unavailable; use replay or a supported local Chrome browser.');
    if(!note('LIVE identification operator','candidate selection for '+JSON.stringify(label)+'; context '+JSON.stringify($('sessionNotes').value.trim())+'; bench identify-v1; no physical identity established'))throw Error('Trace limit reached before selection');
    if(!note('LIVE identification browser',navigator.userAgent+'; bench identify-v1; page '+(window.location?window.location.origin+window.location.pathname:'(not supplied)')))throw Error('Trace limit reached before selection');
    const known=carLabels.entries().find(row=>row.label.toLowerCase()===label.toLowerCase());
    const device=await navigator.bluetooth.requestDevice($('allDevices').checked?{acceptAllDevices:true,optionalServices:[uuids.service]}:{filters:[{services:[uuids.service]}]});
    if(current!==probeEpoch)return;
    if(known&&device.id!==known.browserId)throw Error('Selected device does not match your saved car. No connection or monitoring started.');
    if(!device.id)throw Error('This browser did not supply a device ID; use isolated enrollment.');
    if(!note('LIVE identification selection',JSON.stringify({name:device.name||'',browserId:device.id})+'; browser selection only, not a physical match'))throw Error('Trace limit reached before monitoring');
    probeCandidate=device;probeLabel=label;
    $('identifySelection').textContent='Candidate for '+label+': '+(device.name||'(unnamed)')+' · browser ID '+device.id+' · unconfirmed';
    $('identifyStatus').textContent='Candidate selected, with no GATT connection or commands. Start the power/proximity check, or connect deliberately for the lights-only trial. Neither path saves the car automatically.';
  }catch(error){if(current===probeEpoch){$('identifyStatus').textContent=error.message;note('LIVE identification error',error.message);}}
  finally{probeSelecting=false;controls();}
};
$('identifyStart').onclick=async()=>{
  if($('identifyStart').disabled)return;
  const current=++probeEpoch;
  probe=new EnrollmentProbe((...args)=>current===probeEpoch?note(...args):false,snapshot=>{if(current===probeEpoch)renderProbe(snapshot);});
  await probe.open(probeCandidate);if(current===probeEpoch)renderProbe(probe.snapshot);
};
$('identifyNext').onclick=()=>{if(!$('identifyNext').disabled)probe.next();};
$('identifyCancel').onclick=()=>{
  if($('identifyCancel').disabled)return;
  if(probeSelecting){probeEpoch++;probeSelectionCancelled=true;$('identifyStatus').textContent='Selection cancelled; waiting for the Chrome chooser to close. No connection or commands will follow.';}
  else probe?.cancel();
  controls();
};
$('identifyConnect').onclick=()=>{
  if($('identifyConnect').disabled)return;
  // A completed or cancelled probe has already stopped watching. Reuse only the
  // explicit candidate object; never rediscover or substitute another car.
  return connect(true,probeCandidate);
};
$('identifySignal').onclick=async()=>{
  if($('identifySignal').disabled)return;
  if(trace.lines.length>trace.maxLines-32||trace.chars>trace.maxChars-10000){
    $('identifyLight').textContent='Not enough trace space for a complete signal trial. Disconnect, save and clear the evidence trace, or reload the compact bench.';return;
  }
  const current=session,active=link;
  signalTrial={session:current,selection:{...link.selection},finished:false,observed:false};
  busy=true;controls();$('identifyLight').textContent='Signal trial pending: observe your physical car for off → green → off. No assignment is confirmed.';
  try{
    await active.identifyCandidate();
    if(current!==session)return;
    if(trace.stopped)throw Error('Trace incomplete; signal outcome cannot be credited.');
    signalTrial.finished=true;
    $('identifyLight').textContent='Signal writes completed; visible behavior is unverified. If you saw this exact pattern on your own car, record that below, then Confirm assigned car and Remember confirmed car. Otherwise disconnect and try isolated enrollment.';
  }catch(error){if(current===session){signalTrial=null;$('identifyLight').textContent='Signal incomplete: '+error.message+'; visible state and cleanup may be unknown.';note('LIVE identification error',error.message);}}
  finally{if(current===session){busy=false;controls();}}
};
$('identifyMatch').onclick=()=>{
  if($('identifyMatch').disabled)return;
  if(note('LIVE identification observation',JSON.stringify({session,selection:signalTrial.selection,label:$('assignedCar').value.trim(),observation:'operator reports off/green/off on their own physical car'})+'; human observation, not telemetry or authenticated identity')){
    signalTrial.observed=true;$('identifyLight').textContent='Your visible-match report was recorded. Check the physical label, then Confirm assigned car and Remember confirmed car. Nothing was saved automatically.';
  }
  controls();
};
$('assignedCar').oninput=()=>{if(!link&&!busy&&!identificationBusy()&&$('assignedCar').value.trim()!==probeLabel)clearCandidate();controls();};
function renderRemembered(){
  const selected=$('rememberedCar').value;
  const options=[new Option('Choose a remembered car','')];
  for(const car of carLabels.entries())options.push(new Option(car.label+' · '+(car.name||'unnamed car')+(rememberedDevices.has(car.browserId)?' · permission available':' · chooser required'),car.browserId));
  $('rememberedCar').replaceChildren(...options);
  if(carLabels.find(selected))$('rememberedCar').value=selected;
}
$('rememberedCar').onchange=controls;
$('refreshCars').onclick=async()=>{
  if($('refreshCars').disabled)return;
  const request=++refreshNumber,current=session;
  refreshingCars=true;controls();
  try{
    if(typeof navigator.bluetooth?.getDevices!=='function')throw Error('This browser cannot list prior permissions. '+rememberedDevices.size+' remembered car(s) can reconnect in this open page. Select a saved label and Reconnect; other saved cars use a guarded Chrome chooser.');
    const devices=await navigator.bluetooth.getDevices();
    if(current!==session||request!==refreshNumber)return;
    rememberedDevices.clear();
    for(const device of devices)if(carLabels.find(device.id))rememberedDevices.set(device.id,device);
    $('fleetStatus').textContent=rememberedDevices.size+' remembered car permission(s) available. This is not a scan or proof that a car is nearby. Select a saved label and Reconnect; missing handles use a guarded Chrome chooser. If the saved ID no longer matches after permission changes, forget its label and enroll the isolated car again.';
  }catch(error){if(current===session)$('fleetStatus').textContent=error.message;}
  finally{if(request===refreshNumber){refreshingCars=false;renderRemembered();controls();}}
};
$('rememberCar').onclick=()=>{
  if($('rememberCar').disabled)return;
  try{
    const saved=carLabels.remember({browserId:link.selection.browserId,name:storedDisplayName(link.selection.name)},confirmedSession.label);
    rememberedDevices.set(saved.browserId,link.device);
    $('fleetStatus').textContent='Remembered '+saved.label+' in this browser for this site. Reconnect is ready while this page stays open. After a reload, Reconnect can check your Chrome chooser selection against the saved ID. Recheck the physical label on every connection.';
    note('LIVE operator','saved browser-device label '+JSON.stringify(saved)+'; operator mapping, not authenticated identity');
    renderRemembered();
  }catch(error){$('fleetStatus').textContent=error.message;}
  controls();
};
$('connectRemembered').onclick=()=>{
  if($('connectRemembered').disabled)return;
  const id=$('rememberedCar').value,saved=carLabels.find(id),device=rememberedDevices.get(id);
  if(!saved)return;
  $('assignedCar').value=saved.label;
  return connect(true,device??null);
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
window.addEventListener('pagehide',()=>{clearCandidate();const current=session;(link||pendingLink)?.close();if(current===session)forget();});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    probe?.cancel();if(probeSelecting){probeEpoch++;probeSelectionCancelled=true;}
    // Hidden-tab timer throttling must not prolong an identification signal.
    // Disconnect cancels this trial; it cannot promise LED/SDK cleanup.
    if(signalTrial&&!signalTrial.finished){const current=session;link?.close();if(current===session)forget();}
    controls();
  }
});
if(evidence)$('save').onclick=()=>{
  const u=URL.createObjectURL(new Blob([trace.text],{type:'text/plain'}));
  const a=document.createElement('a');a.href=u;
  a.download='second-lap-bench-trace-'+new Date().toISOString().replaceAll(':','-')+'.txt';a.click();
  if(trace.stopped)savedStoppedTrace=true;
  setTimeout(()=>URL.revokeObjectURL(u),1000);controls();
};
if(evidence)$('clear').onclick=()=>{if(link||busy||identificationBusy()||(trace.stopped&&!savedStoppedTrace))return;clearCandidate();trace.clear();savedStoppedTrace=false;$('trace').textContent='No traffic yet.';resetResults();controls();};
renderRemembered();
$('fleetStatus').textContent=carLabels.warning||'Remember each physical car once. Refresh lists previously granted permissions, not nearby cars.';
controls();
