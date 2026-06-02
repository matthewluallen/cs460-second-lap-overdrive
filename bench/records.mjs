// In-memory support worksheet. Data are disposable fixtures in this browser tab.
const teams=new Map(['red','blue','green','gold'].map(t=>['pilot-'+t,t]));
export class Records {
  constructor(){
    this.rows=new Map([[101,{id:101,team:'red',note:'Replay: bench A, baseline complete.'}],
                       [102,{id:102,team:'blue',note:'Replay: bench B, repeat observation requested.'}]]);
    this.next=103;
  }
  actor(token){if(!teams.has(token))throw new Error('Unknown operator');return teams.get(token);}
  list(token){const team=this.actor(token);return [...this.rows.values()].filter(x=>x.team===team).map(x=>({...x}));}
  read(token,id){this.actor(token);const row=this.rows.get(Number(id));if(!row || row.team!==this.actor(token))throw new Error('No such record');return {...row};}
  add(token,workgroup,note){
    this.actor(token);
    if(workgroup!==this.actor(token) || ![...teams.values()].includes(workgroup))throw new Error('Unknown workgroup');
    const clean=String(note).trim();if(!clean || clean.length>160)throw new Error('Use 1–160 characters');
    const row={id:this.next++,team:workgroup,note:clean};this.rows.set(row.id,row);return {...row};
  }
}
