import {Records} from './records.mjs';
import {ServerRecords} from './server-records.mjs';
const $=id=>document.getElementById(id);
const shared=new URLSearchParams(window.location.search).get('store')==='server';
const book=shared?new ServerRecords():new Records();
$('storageMode').textContent=shared
  ? 'Shared MOCK platform records. Other tabs using this server share the records. Restart the server to reset.'
  : 'MOCK records in this tab only. Reload to reset. Platform records are a separate store.';
$('summary').hidden=!shared;
for(const team of ['red','blue','green','gold'])for(const [id,value] of [['operator','pilot-'+team],['group',team]])$(id).append(new Option(team,value));
async function show(fn){
  for(const id of ['list','read','add','summary'])$(id).disabled=true;
  try{$('out').textContent=JSON.stringify(await fn(),null,2);}catch(e){$('out').textContent=e.name==='AbortError'?'Platform request timed out; outcome unknown. Check records before retrying an addition.':e.message;}
  finally{for(const id of ['list','read','add','summary'])$(id).disabled=false;}
}
$('list').onclick=()=>show(()=>book.list($('operator').value));
$('read').onclick=()=>show(()=>book.read($('operator').value,$('rid').value));
$('add').onclick=()=>show(()=>book.add($('operator').value,$('group').value,$('entry').value));
$('summary').onclick=()=>{if(shared)return show(()=>book.summary($('operator').value));};
