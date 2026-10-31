import {Records} from './records.mjs';
const $=id=>document.getElementById(id);
const book=new Records();
for(const team of ['red','blue','green','gold'])for(const [id,value] of [['operator','pilot-'+team],['group',team]])$(id).append(new Option(team,value));
function show(fn){try{$('out').textContent=JSON.stringify(fn(),null,2);}catch(e){$('out').textContent=e.message;}}
$('list').onclick=()=>show(()=>book.list($('operator').value));
$('read').onclick=()=>show(()=>book.read($('operator').value,$('rid').value));
$('add').onclick=()=>show(()=>book.add($('operator').value,$('group').value,$('entry').value));
