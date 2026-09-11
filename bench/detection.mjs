// Optional, advertisement-only enrollment evidence. No GATT connection or writes.
// RSSI differences are an uncalibrated heuristic, never authenticated identity.
const OPEN_MS=10000,RUN_MS=180000,MAX_RECORDS=50,MIN_RSSI=3,MIN_GAP_DB=6;
const TERMINAL=new Set(['complete','inconclusive','cancelled']);
const PHASES=[
  {key:'onbaseline',instruction:'Power on the candidate car and keep it near this laptop. Start when ready.',button:'Start powered-on baseline',durationMs:5000},
  {key:'off',instruction:'Power off that same physical car, then start this window. The first two seconds allow settling; later silence is not proof of power-off.',button:'Start powered-off check',durationMs:8000},
  {key:'onreturn',instruction:'Power that same physical car back on, then start this window.',button:'Start return check',durationMs:8000},
  ...[1,2,3].flatMap(round=>[
    {key:'near'+round,instruction:'Round '+round+': move only that same car near the laptop, keep its orientation consistent, then start.',button:'Start near sample '+round,durationMs:5000},
    {key:'far'+round,instruction:'Round '+round+': move that same car farther away while keeping its orientation consistent, then start.',button:'Start far sample '+round,durationMs:5000}
  ])
];
function validRssi(value){
  // Do not coerce null, missing values or strings to a numeric signal. Exclude
  // unavailable/out-of-range values; a genuinely numeric zero remains numeric.
  return typeof value==='number'&&Number.isInteger(value)&&value>=-127&&value<=20;
}
function quantile(sorted,fraction){
  const index=(sorted.length-1)*fraction,lower=Math.floor(index),upper=Math.ceil(index);
  return sorted[lower]+(sorted[upper]-sorted[lower])*(index-lower);
}
function signalSummary(values){
  if(!values.length)return {median:null,iqr:null};
  const sorted=[...values].sort((a,b)=>a-b);
  return {median:quantile(sorted,0.5),iqr:quantile(sorted,0.75)-quantile(sorted,0.25)};
}

export class EnrollmentProbe {
  #note;#onChange;#now;#setTimer;#clearTimer;
  #state='cancelled';#message='Not started.';#consistent=false;#results=[];
  #started=false;#startAt=0;#generation=0;#device=null;#candidateId='';
  #controller=null;#listener=null;#timers=new Set();#openTimer=null;#phaseTimer=null;
  #resolveOpen=null;#phaseIndex=0;#window=null;
  constructor(note,onChange,{now=()=>performance.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id)}={}){
    this.#note=note;this.#onChange=onChange;this.#now=now;this.#setTimer=setTimer;this.#clearTimer=clearTimer;
  }
  get snapshot(){
    return {state:this.#state,phase:['ready','sampling'].includes(this.#state)?{...PHASES[this.#phaseIndex]}:null,
      results:this.#results.map(row=>({...row})),message:this.#message,consistent:this.#consistent};
  }
  #elapsed(){return Math.max(0,this.#now()-this.#startAt);}
  #active(){return this.#started&&!TERMINAL.has(this.#state);}
  #publish(){this.#onChange?.(this.snapshot);}
  #timer(fn,ms){
    const generation=this.#generation;
    const id=this.#setTimer(()=>{
      this.#timers.delete(id);
      if(generation===this.#generation&&this.#active())fn();
    },ms);
    this.#timers.add(id);return id;
  }
  #clear(id){if(id!==null){this.#clearTimer(id);this.#timers.delete(id);}}
  #record(kind,message){
    try{
      if(this.#note?.('LIVE identification '+kind,message)!==false)return this.#active();
    }catch{}
    this.#finish('inconclusive','Evidence capture stopped; this result is unknown and no further qualification is credited.',false);
    return false;
  }
  #cleanup(){
    for(const id of this.#timers)this.#clearTimer(id);
    this.#timers.clear();this.#openTimer=this.#phaseTimer=null;
    if(this.#listener)this.#device?.removeEventListener('advertisementreceived',this.#listener);
    this.#listener=null;
    this.#controller?.abort();
    this.#window=null;
  }
  #finish(state,message,record=true){
    if(!this.#active())return;
    if(record&&!this.#record('result',JSON.stringify({atMs:this.#elapsed(),state,message,identityVerified:false})))return;
    this.#state=state;this.#message=message;this.#consistent=state==='complete';
    this.#generation++;this.#cleanup();
    const resolve=this.#resolveOpen;this.#resolveOpen=null;resolve?.(this.snapshot);
    this.#publish();
  }
  #healthy(){
    if(!this.#active())return false;
    if(this.#elapsed()>=RUN_MS){
      this.#finish('inconclusive','The 180-second qualification deadline expired, including time waiting for operator steps.');return false;
    }
    if(this.#device.id!==this.#candidateId){
      this.#finish('inconclusive','The candidate browser ID changed; start a new qualification.');return false;
    }
    if(this.#device.gatt?.connected){
      this.#finish('inconclusive','The candidate became GATT-connected during advertisement sampling; no connection was made by this probe.');return false;
    }
    if(this.#device.watchingAdvertisements===false){
      this.#finish('inconclusive','Advertisement watching stopped; silence cannot be credited as a power-off observation.');return false;
    }
    return true;
  }
  #monitor(){
    this.#timer(()=>{if(this.#healthy())this.#monitor();},500);
  }
  async open(device){
    if(this.#started)throw Error('Create a new EnrollmentProbe for another qualification.');
    this.#started=true;this.#state='opening';this.#startAt=this.#now();this.#generation++;
    this.#device=device;this.#message='Starting advertisement watching; no GATT connection or car command is requested.';
    const opened=new Promise(resolve=>{this.#resolveOpen=resolve;});
    if(!device||typeof device.id!=='string'||!device.id||device.id.length>256||
       typeof device.watchAdvertisements!=='function'||typeof device.addEventListener!=='function'||typeof device.removeEventListener!=='function'){
      this.#finish('inconclusive','This selected device or browser does not provide the advertisement-watching API required for this optional check.');return opened;
    }
    this.#candidateId=device.id;
    if(device.gatt?.connected){
      this.#finish('inconclusive','Disconnect this candidate before starting advertisement-only qualification.');return opened;
    }
    if(device.watchingAdvertisements===true){
      this.#finish('inconclusive','This candidate is already being watched; stop that operation before starting a separate qualification.');return opened;
    }
    if(!this.#record('candidate',JSON.stringify({browserId:this.#candidateId,atMs:0,
      method:'operator power off/on then three near/far pairs',maxDurationMs:RUN_MS,
      eventRecordsPerPhase:MAX_RECORDS,minimumRssiSamples:MIN_RSSI,
      heuristic:'each near median exceeds far median by at least 6 dB and by more than either IQR; uncalibrated, not identity proof'})))return opened;
    const generation=this.#generation;
    this.#controller=new AbortController();
    this.#listener=event=>this.#advertisement(event,generation);
    device.addEventListener('advertisementreceived',this.#listener);
    this.#openTimer=this.#timer(()=>this.#finish('inconclusive','Advertisement watching did not start within 10 seconds.'),OPEN_MS);
    this.#timer(()=>this.#finish('inconclusive','The 180-second qualification deadline expired, including time waiting for operator steps.'),RUN_MS);
    this.#publish();
    if(generation!==this.#generation||!this.#active())return opened;
    let watching;
    try{watching=device.watchAdvertisements({signal:this.#controller.signal});}
    catch(error){this.#finish('inconclusive','Advertisement watching failed: '+String(error?.name||'Error')+'.');return opened;}
    Promise.resolve(watching).then(()=>{
      if(generation!==this.#generation||!this.#active())return;
      if(!this.#healthy())return;
      this.#clear(this.#openTimer);this.#openTimer=null;
      if(!this.#record('ready',JSON.stringify({atMs:this.#elapsed(),message:'Watching selected candidate; operator must start each sampling window.'})))return;
      this.#state='ready';this.#message='Watch ready. Start each step only after performing its physical instruction.';
      const resolve=this.#resolveOpen;this.#resolveOpen=null;resolve?.(this.snapshot);
      this.#publish();if(this.#active())this.#monitor();
    },error=>{
      if(generation===this.#generation&&this.#active())this.#finish('inconclusive','Advertisement watching failed: '+String(error?.name||'Error')+'.');
    });
    return opened;
  }
  next(){
    if(this.#state!=='ready'||!this.#healthy())return false;
    const phase=PHASES[this.#phaseIndex],startedAtMs=this.#elapsed();
    if(!this.#record('step',JSON.stringify({key:phase.key,atMs:startedAtMs,
      operatorAction:phase.instruction,durationMs:phase.durationMs,
      note:'The click records an operator-declared step, not proof of the physical action.'})))return false;
    this.#window={startedAtMs,count:0,settlingCount:0,recordedCount:0,omittedCount:0,values:[]};
    this.#state='sampling';this.#message='Sampling '+phase.key+'; keep the physical setup unchanged until this window finishes.';
    this.#phaseTimer=this.#timer(()=>this.#endPhase(),phase.durationMs);
    this.#publish();return true;
  }
  #advertisement(event,generation){
    if(generation!==this.#generation||this.#state!=='sampling'||!this.#healthy())return;
    if(event?.device?.id!==this.#candidateId)return;
    const phase=PHASES[this.#phaseIndex],window=this.#window,atMs=this.#elapsed();
    if(atMs-window.startedAtMs>=phase.durationMs){this.#endPhase();return;}
    const settling=phase.key==='off'&&atMs-window.startedAtMs<2000;
    if(settling)window.settlingCount++;else window.count++;
    if(window.recordedCount>=MAX_RECORDS){
      window.omittedCount++;
      if(window.omittedCount===1)this.#record('limit',JSON.stringify({key:phase.key,atMs,
        message:'50 event records reached; subsequent advertisements are still counted, but RSSI statistics use recorded samples only.'}));
      return;
    }
    const rssi=validRssi(event.rssi)?event.rssi:null;
    if(!this.#record('sample',JSON.stringify({key:phase.key,atMs,sinceStepMs:atMs-window.startedAtMs,
      rssi,settling,rssiUsable:rssi!==null})))return;
    window.recordedCount++;
    if(!settling&&rssi!==null)window.values.push(rssi);
  }
  #endPhase(){
    if(this.#state!=='sampling'||!this.#healthy())return;
    this.#clear(this.#phaseTimer);this.#phaseTimer=null;
    const phase=PHASES[this.#phaseIndex],window=this.#window;
    const summary={key:phase.key,durationMs:phase.durationMs,startedAtMs:window.startedAtMs,
      endedAtMs:this.#elapsed(),count:window.count,settlingCount:window.settlingCount,
      recordedCount:window.recordedCount,omittedCount:window.omittedCount,rssiCount:window.values.length,
      ...signalSummary(window.values),quiet:phase.key==='off'?window.count===0:null,passed:false};
    summary.passed=phase.key==='off'?summary.quiet:summary.rssiCount>=MIN_RSSI;
    if(phase.key.startsWith('far')&&summary.rssiCount>=MIN_RSSI){
      const near=this.#results.find(row=>row.key==='near'+phase.key.slice(3));
      summary.gapDb=near.median-summary.median;
      summary.requiredGapDb=Math.max(MIN_GAP_DB,near.iqr,summary.iqr);
      summary.passed=summary.gapDb>=MIN_GAP_DB&&summary.gapDb>Math.max(near.iqr,summary.iqr);
    }
    if(!this.#record('summary',JSON.stringify(summary)))return;
    this.#results.push(summary);this.#window=null;
    if(phase.key==='off'&&!summary.quiet){
      this.#finish('inconclusive','Advertisements continued after the off-window settling period. The selected candidate did not show the requested quiet interval.');return;
    }
    if(phase.key!=='off'&&summary.rssiCount<MIN_RSSI){
      this.#finish('inconclusive','Fewer than three valid recorded RSSI samples in '+phase.key+'; missing signal is not a numeric zero.');return;
    }
    this.#phaseIndex++;
    if(this.#phaseIndex===PHASES.length){
      const consistent=this.#results.every(row=>row.passed);
      this.#finish(consistent?'complete':'inconclusive',consistent
        ?'The observed power-cycle and all three near/far pairs are consistent with this candidate under an uncalibrated heuristic. This is not proof of identity, ownership, or actual power-off.'
        :'All windows finished, but at least one near/far pair did not meet the uncalibrated 6 dB and variability checks. Identity remains unconfirmed.');
      return;
    }
    this.#state='ready';this.#message=phase.key==='off'
      ?'No candidate advertisement was observed after settling in this off window. This silence alone does not prove power-off; continue with the return check.'
      :'Window recorded. Perform the next physical step before clicking its start button.';
    this.#publish();
  }
  cancel(){this.#finish('cancelled','Operator cancelled advertisement qualification; no identity or assignment was established.');}
}
