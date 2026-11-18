// In-memory support worksheet. Data are disposable fixtures in this browser tab.
// Access rule: an operator sees and changes only their own team's records.
export const MAX_RECORDS=1000;
const teams=new Map(['red','blue','green','gold'].map(t=>['pilot-'+t,t]));
function recordId(value){
  // Exact decimal IDs only: no '', ' 101 ', '1e2', '0x65' or float coercion.
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>0?value:null;
  return typeof value==='string'&&/^[1-9][0-9]{0,8}$/.test(value)?Number(value):null;
}
export class Records {
  constructor(){
    this.rows=new Map([[101,{id:101,team:'red',note:'Replay: bench A, baseline complete.'}],
                       [102,{id:102,team:'blue',note:'Replay: bench B, repeat observation requested.'}]]);
    this.next=103;
  }
  actor(token){if(typeof token!=='string'||!teams.has(token))throw new Error('Unknown operator');return teams.get(token);}
  list(token){const team=this.actor(token);return [...this.rows.values()].filter(x=>x.team===team).map(x=>({...x}));}
  read(token,id){
    const team=this.actor(token),row=this.rows.get(recordId(id));
    // Same answer for a missing record and another team's record: no existence oracle.
    if(!row||row.team!==team)throw new Error('No such record');
    return {...row};
  }
  add(token,workgroup,note){
    const team=this.actor(token);
    if(![...teams.values()].includes(workgroup))throw new Error('Unknown workgroup');
    if(workgroup!==team)throw new Error('Operators may add records only for their own workgroup');
    if(typeof note!=='string')throw new Error('Use 1–160 characters');
    const clean=note.trim();if(!clean || clean.length>160)throw new Error('Use 1–160 characters');
    if(this.rows.size>=MAX_RECORDS)throw new Error('Worksheet session full; save your investigation notes and reload to reset');
    const row={id:this.next++,team:workgroup,note:clean};this.rows.set(row.id,row);return {...row};
  }
}
