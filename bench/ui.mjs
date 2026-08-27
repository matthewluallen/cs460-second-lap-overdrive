import {CarLink,Replay} from './link.mjs';
import {Records} from './records.mjs';
const $=id=>document.getElementById(id),rows=[],ops=[...document.querySelectorAll('[data-op]')];
let link=null,busy=false,mode='Disconnected';
let timer=null;
function cancelCheck(){if(timer!==null){clearTimeout(timer);timer=null;}}
function batteryCheck(){
  cancelCheck();$('batteryResult').textContent=mode+': waiting for battery RX…';
  timer=setTimeout(()=>{timer=null;$('batteryResult').textContent=mode+': no battery reply within five seconds.';note(mode,'battery request timed out');},5000);
}
$('context').textContent='Browser path: '+(window.isSecureContext?'secure':'insecure')+' · '+(window.top===window.self?'direct tab':'embedded preview')+' · Web Bluetooth API '+(navigator.bluetooth?'present':'unavailable');
function note(source,message,row){
  if(timer!==null && row?.id===0x1b && row.text.startsWith('battery ')){cancelCheck();$('batteryResult').textContent=source+': '+row.text+' · '+row.raw+' · '+new Date().toISOString();}rows.push(new Date().toISOString()+' | '+source+' | '+message);if(rows.length>500)rows.shift();$('trace').textContent=rows.join('\n');$('trace').scrollTop=$('trace').scrollHeight;}
function controls(){for(const b of ops)b.disabled=!link||busy;$('replay').disabled=$('live').disabled=!!link||busy;$('close').disabled=!link||busy;$('status').textContent=mode;}
function forget(){if(timer!==null)$('batteryResult').textContent='Disconnected before a battery reply.';cancelCheck();link=null;mode='Disconnected';controls();}
async function connect(live){
  if(link||busy)return;busy=true;mode=live?'Choosing car…':'Opening replay…';controls();
  const next=live?new CarLink(note,forget):new Replay(note);
  try{await next.open(live?navigator.bluetooth:null);link=next;mode=live?'Live car connected':'Replay fixture';}
  catch(e){next.close();forget();note(live?'LIVE error':'REPLAY error',e.name+': '+e.message);}
  finally{busy=false;controls();}
}
$('replay').onclick=()=>connect(false);$('live').onclick=()=>connect(true);
$('close').onclick=()=>{link?.close();forget();};
for(const b of ops)b.onclick=async()=>{if(!link||busy)return;busy=true;controls();try{if(b.dataset.op==='battery')batteryCheck();await link.send(b.dataset.op);}catch(e){if(b.dataset.op==='battery'){cancelCheck();$('batteryResult').textContent='Battery write failed: '+e.message;}note(mode+' error',e.message);}finally{busy=false;controls();}};
window.addEventListener('pagehide',()=>link?.close());
$('save').onclick=()=>{const u=URL.createObjectURL(new Blob([rows.join('\n')+'\n'],{type:'text/plain'}));const a=document.createElement('a');a.href=u;a.download='second-lap-bench-trace.txt';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);};
$('clear').onclick=()=>{rows.length=0;$('trace').textContent='No traffic yet.';};
const book=new Records();
for(const team of ['red','blue','green','gold']){for(const [id,value] of [['operator','pilot-'+team],['group',team]])$(id).append(new Option(team,value));}
function show(fn){try{$('out').textContent=JSON.stringify(fn(),null,2);}catch(e){$('out').textContent=e.message;}}
$('list').onclick=()=>show(()=>book.list($('operator').value));$('read').onclick=()=>show(()=>book.read($('operator').value,$('rid').value));
$('add').onclick=()=>show(()=>book.add($('operator').value,$('group').value,$('entry').value));controls();
