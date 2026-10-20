import {CarLink,Replay} from './link.mjs';
import {Records} from './records.mjs';
const $=id=>document.getElementById(id);
const rows=[],ops=[...document.querySelectorAll('[data-op]')];
const stateChanges=new Set(['lampOn','lampOff','sdkOn','sdkOff']);
let link=null,pendingLink=null,busy=false,mode='Disconnected',confirmed=false,session=0,timer=null,pendingLamp=false,liveOpening=0;
const source=()=>mode==='Live car connected'?'LIVE':'REPLAY';
function cancelCheck(){if(timer!==null){clearTimeout(timer);timer=null;}}
function batteryCheck(kind){
  cancelCheck();$('batteryResult').textContent=kind+': waiting for battery RX…';
  timer=setTimeout(()=>{
    timer=null;
    $('batteryResult').textContent=kind+': no battery reply within five seconds.';
    note(kind,'battery request timed out after five seconds');controls();
  },5000);
}
$('context').textContent='Browser path: '+(window.isSecureContext?'secure':'insecure')+' · '+(window.top===window.self?'direct tab':'embedded preview')+' · Web Bluetooth API '+(navigator.bluetooth?'present':'unavailable');
function note(kind,message,row){
  if(timer!==null && kind===(source()==='LIVE'?'LIVE decoded':'REPLAY RX') && row?.id===0x1b && row.text.startsWith('battery ')){
    cancelCheck();
    $('batteryResult').textContent=kind+': '+row.text+' · '+row.raw+' · '+new Date().toISOString();
    controls();
  }
  // Keep every line until the student explicitly clears a disconnected trace.
  rows.push(new Date().toISOString()+' | '+kind+' | '+message);
  $('trace').textContent=rows.join('\n');$('trace').scrollTop=$('trace').scrollHeight;
}
function controls(){
  const live=mode==='Live car connected';
  for(const b of ops)b.disabled=!link||busy||timer!==null||(live&&stateChanges.has(b.dataset.op)&&!confirmed);
  $('replay').disabled=!!link||busy;
  $('live').disabled=!!link||busy||liveOpening>0||!$('assignedCar').value.trim();
  $('close').disabled=!link&&!pendingLink;
  $('confirm').disabled=!live||busy||confirmed;
  $('recordObservation').disabled=!live||busy||!confirmed;
  $('clear').disabled=!!link||busy;
  for(const id of ['assignedCar','sessionNotes','allDevices'])$(id).disabled=!!link||busy;
  $('status').textContent=mode==='Disconnected'&&liveOpening>0?'Disconnected; finishing the previous Bluetooth attempt. Replay is available.':mode;
}
function resetResults(){
  pendingLamp=false;$('observation').value='';$('observationNote').value='';
  $('batteryResult').textContent='No battery request this session.';
  $('lampResult').textContent='No headlight command this session.';
  $('selection').textContent='No live car selected.';
}
function forget(){
  if(timer!==null)$('batteryResult').textContent=source()+': disconnected before a battery reply.';
  if(pendingLamp)$('lampResult').textContent=source()+': disconnected during headlight write; outcome unknown.';
  pendingLamp=false;cancelCheck();link=pendingLink=null;mode='Disconnected';confirmed=false;busy=false;session++;
  $('selection').textContent='No live car selected.';
  $('allDevices').checked=false;controls();
}
async function connect(live){
  if(link||busy||(live&&liveOpening>0))return;
  const label=$('assignedCar').value.trim();
  if(live&&!label)return;
  const current=++session;
  if(live)liveOpening++;
  busy=true;confirmed=false;mode=live?'Choosing car…':'Opening replay…';resetResults();controls();
  const kind=live?'LIVE':'REPLAY';
  const scopedNote=(...args)=>{if(current===session)note(...args);};
  const next=live?new CarLink(scopedNote,()=>{if(current===session)forget();}):new Replay(scopedNote);
  pendingLink=next;controls();
  note(kind+' operator','assigned label: '+JSON.stringify(label||'(replay fixture)')+'; context: '+JSON.stringify($('sessionNotes').value.trim()||'(not recorded)'));
  note(kind+' browser',navigator.userAgent);
  try{
    // Keep requestDevice directly in the click's user gesture, without a prior await.
    await next.open(live?navigator.bluetooth:null,{showAllDevices:$('allDevices').checked});
    if(current!==session)return;
    link=next;pendingLink=null;mode=live?'Live car connected':'Replay fixture';
    if(live)$('selection').textContent='Selected Chrome name: '+(next.selection.name||'(not supplied)')+' · browser device ID: '+(next.selection.browserId||'(not supplied)')+' · not yet confirmed';
    else $('selection').textContent='REPLAY fixture — no Bluetooth device or physical LED.';
  }catch(e){
    // Setup failures can call forget() through the link's close callback first.
    if(current===session){next.close();if(current===session)forget();note(kind+' error',e.name+': '+e.message);}
  }finally{if(live)liveOpening--;if(current===session)busy=false;controls();}
}
$('assignedCar').oninput=controls;
$('replay').onclick=()=>connect(false);$('live').onclick=()=>connect(true);
$('close').onclick=()=>{const current=session;(link||pendingLink)?.close();if(current===session)forget();};
$('confirm').onclick=()=>{
  if(!link||busy||mode!=='Live car connected'||confirmed)return;
  try{
    link.confirmAssignedCar($('assignedCar').value);
    confirmed=true;$('selection').textContent+=' · assignment confirmed by operator';controls();
  }catch(e){note('LIVE error',e.message);}
};
for(const b of ops)b.onclick=async()=>{
  if(b.disabled||!link||busy)return;
  const active=link,current=session,kind=source(),op=b.dataset.op;
  busy=true;
  if(op==='battery')batteryCheck(kind);
  if(op==='lampOn'||op==='lampOff'){pendingLamp=true;$('lampResult').textContent=kind+': headlight write pending…';}
  controls();
  try{
    await active.send(op);
    if(current!==session)return;
    pendingLamp=false;
    if(op==='lampOn'||op==='lampOff')$('lampResult').textContent=kind==='REPLAY'?'REPLAY: command rehearsed; no physical LED.':'LIVE: '+op+' write completed. Observe the assigned car and record what you see.';
  }catch(e){
    if(current!==session)return;
    pendingLamp=false;
    if(op==='battery'){cancelCheck();$('batteryResult').textContent=kind+': battery write failed: '+e.message;}
    if(op==='lampOn'||op==='lampOff')$('lampResult').textContent=kind+': headlight write failed: '+e.message;
    note(kind+' error',e.message);
  }finally{if(current===session){busy=false;controls();}}
};
$('recordObservation').onclick=()=>{
  if(!link||busy||!confirmed||mode!=='Live car connected')return;
  const observation=$('observation').value;
  if(!observation)return;
  note('LIVE observation','operator reports: '+observation+'; note: '+JSON.stringify($('observationNote').value.trim()));
  $('lampResult').textContent='LIVE operator observation: '+observation+' (not telemetry).';
};
window.addEventListener('pagehide',()=>{const current=session;(link||pendingLink)?.close();if(current===session)forget();});
$('save').onclick=()=>{
  const u=URL.createObjectURL(new Blob([rows.join('\n')+'\n'],{type:'text/plain'}));
  const a=document.createElement('a');a.href=u;
  a.download='second-lap-bench-trace-'+new Date().toISOString().replaceAll(':','-')+'.txt';a.click();
  setTimeout(()=>URL.revokeObjectURL(u),1000);
};
$('clear').onclick=()=>{if(link||busy)return;rows.length=0;$('trace').textContent='No traffic yet.';resetResults();};
const book=new Records();
for(const team of ['red','blue','green','gold'])for(const [id,value] of [['operator','pilot-'+team],['group',team]])$(id).append(new Option(team,value));
function show(fn){try{$('out').textContent=JSON.stringify(fn(),null,2);}catch(e){$('out').textContent=e.message;}}
$('list').onclick=()=>show(()=>book.list($('operator').value));
$('read').onclick=()=>show(()=>book.read($('operator').value,$('rid').value));
$('add').onclick=()=>show(()=>book.add($('operator').value,$('group').value,$('entry').value));
controls();
