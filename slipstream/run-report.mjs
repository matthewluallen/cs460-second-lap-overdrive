// A deliberately lossy, allowlisted summary of recorded evidence. No networking,
// hardware access or rendering; consumers must use textContent / a .txt download.
import {decode, ID} from './protocol.mjs';

export const RUN_REPORT_SCHEMA='slipstream-run-report-v1';
const LIMITS=Object.freeze({events:200000,cars:256,markers:1000,annotations:24});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
const list=value=>Array.isArray(value)?value:[];
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const nonnegative=value=>number(value)!==null&&value>=0?value:null;
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const text=(value,max=240)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,max):'';
const stats=()=>({samples:0,min:null,max:null,mean:null,sum:0});
function sample(summary,value){if(number(value)===null)return;summary.samples++;summary.min=summary.min===null?value:Math.min(summary.min,value);summary.max=summary.max===null?value:Math.max(summary.max,value);summary.sum+=value;}
function finishStats(summary){const {sum,...out}=summary;out.mean=out.samples?Math.round(sum/out.samples*100)/100:null;return out;}
const gapSummary=()=>({samples:0,maxMs:null,buckets:[{label:'0–250 ms',upperMs:250,count:0},{label:'251–500 ms',upperMs:500,count:0},{label:'501–1000 ms',upperMs:1000,count:0},{label:'1001–2000 ms',upperMs:2000,count:0},{label:'over 2000 ms',upperMs:null,count:0}]});
function addGap(summary,gap){if(!Number.isFinite(gap)||gap<0)return;summary.samples++;summary.maxMs=Math.max(summary.maxMs??0,gap);summary.buckets.find(b=>b.upperMs===null||gap<=b.upperMs).count++;}
function packetFrames(value){
  if(typeof value!=='string'||value.length>6143||!/^([0-9a-fA-F]{2})( [0-9a-fA-F]{2})*$/.test(value))return null;
  const bytes=Uint8Array.from(value.split(' '),s=>parseInt(s,16)),frames=[];
  for(let at=0;at<bytes.length;){const end=at+bytes[at]+1;if(bytes[at]<1||end>bytes.length)return null;frames.push(bytes.subarray(at,end));at=end;}
  return frames;
}
function transportSnapshot(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const out={source:'final per-car lifetime snapshot; not limited to the recording',
    writeMode:['with-response','without-response','simulator','unknown'].includes(value.writeMode)?value.writeMode:'unknown'};
  for(const key of ['completed','lateCompletions','failed','timeouts','suppressed','coalesced','pendingCount'])out[key]=integer(value[key]);
  for(const key of ['pendingAgeMs','inFlightAgeMs','lastQueueWaitMs','maxQueueWaitMs','lastCompletedApiMs','maxCompletedApiMs'])out[key]=nonnegative(value[key]);
  return out;
}
function hostTimingSnapshot(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const out={source:'final host-page lifetime snapshot; may include parked or background periods'};
  for(const key of ['expectedIntervalMs','lastGapMs','maxGapMs'])out[key]=nonnegative(value[key]);
  for(const key of ['samples','over100Ms','over500Ms','over1000Ms','clockResets'])out[key]=integer(value[key]);
  return out;
}
function makeCar(info,index,diagnostic={}){
  const id=integer(info.driverId)??integer(diagnostic.carId);
  return {recordingIndex:index,driverId:id,name:text(diagnostic.name||info.name,80)||'Unidentified car',nameAtRecording:text(info.name,80)||null,
    modelId:integer(diagnostic.model)??integer(info.model),firmware:integer(diagnostic.firmware)??integer(info.firmware),profile:text(diagnostic.profile||info.profile,60)||'unknown',
    source:(info.simulated??diagnostic.simulated)===true?'simulator':(info.simulated??diagnostic.simulated)===false?'hardware':'unknown',snapshotOnly:index===null,
    events:{rx:0,tx:0,positions:0,transitions:0,malformedPackets:0,unrecognizedFrames:0,positionsOutsideCommands:0,clockSegments:0},
    requestedSpeed:stats(),reportedPositionSpeed:stats(),reportedSpeedUpdates:stats(),positionGaps:gapSummary(),
    commandedWindows:{count:0,closedByStop:0,openAtEnd:0,splitByClock:0,withoutPosition:0,observedDurationMs:0,maximumFirstPositionDelayMs:null,maximumTailSilenceMs:null},
    stop:{zeroSpeedWrites:0,lastZeroSpeedWriteMs:null,finalReason:text(diagnostic.safetyReason)||null,physicalStopVerified:false},
    finalSnapshot:Object.keys(diagnostic).length?{requestedSpeed:nonnegative(diagnostic.requestedSpeed),reportedSpeed:number(diagnostic.reportedSpeed),reportedSpeedAgeMs:nonnegative(diagnostic.reportedSpeedAgeMs),batteryMv:nonnegative(diagnostic.millivolts),batteryAgeMs:nonnegative(diagnostic.batteryAgeMs),connected:typeof diagnostic.connected==='boolean'?diagnostic.connected:null}:null,
    transportHealth:transportSnapshot(diagnostic.transportHealth),
    controllerLaps:integer(diagnostic.forwardBaseline?.laps)!==null?{count:integer(diagnostic.forwardBaseline.laps),source:'final forward-check snapshot; controller-reported, not independent physical verification'}:null};
}

export function buildRunReport(input){
  const trace=object(input),diagnostics=object(trace.diagnostics),infos=list(trace.cars).slice(0,LIMITS.cars),snapshots=list(diagnostics.cars).slice(0,LIMITS.cars),warnings=[];
  const matched=new Set(),idCounts=new Map();
  for(const info of infos){const id=integer(info?.driverId);if(id!==null)idCounts.set(id,(idCounts.get(id)??0)+1);}
  const ambiguousIds=new Set([...idCounts].filter(([,count])=>count>1).map(([id])=>id));
  if(ambiguousIds.size)warnings.push('Duplicate recording driver IDs: final snapshots and lap claims are kept separate from ambiguous packet streams.');
  const cars=infos.map((entry,index)=>{const info=object(entry),id=integer(info.driverId),matches=id===null||ambiguousIds.has(id)?[]:snapshots.filter(s=>integer(s?.carId)===id);
    const diagnostic=matches.length===1?object(matches[0]):{};if(matches.length===1)matched.add(matches[0]);
    if(matches.length>1)warnings.push('Duplicate final car IDs: no snapshot was attached to recording car '+(index+1)+'.');
    return makeCar(info,index,diagnostic);
  });
  for(const diagnostic of snapshots)if(!matched.has(diagnostic)&&cars.length<LIMITS.cars)cars.push(makeCar({},null,object(diagnostic)));
  const states=cars.map(()=>({active:null})),coverage={inputEvents:list(trace.events).length,processedEvents:0,invalidEvents:0,omittedEvents:Math.max(0,list(trace.events).length-LIMITS.events),clockDiscontinuities:0,
    droppedEvents:integer(trace.dropped),droppedAnnotations:integer(trace.markersDropped),firstEventMs:null,lastEventMs:null,elapsedMs:null,recordingComplete:null};
  let priorTime=null,segment=0;
  function closeWindow(index,time,reason){const active=states[index]?.active;if(!active)return;const w=cars[index].commandedWindows;
    w.observedDurationMs+=Math.max(0,time-active.start);if(active.lastPosition===null)w.withoutPosition++;
    else w.maximumTailSilenceMs=Math.max(w.maximumTailSilenceMs??0,Math.max(0,time-active.lastPosition));
    if(reason==='stop')w.closedByStop++;else if(reason==='clock')w.splitByClock++;else w.openAtEnd++;
    states[index].active=null;
  }
  for(const event of list(trace.events).slice(0,LIMITS.events)){
    if(!Array.isArray(event)||event.length!==4){coverage.invalidEvents++;continue;}
    const [time,index,direction,raw]=event;
    if(nonnegative(time)===null||!Number.isInteger(index)||index<0||index>=infos.length||!['rx','tx'].includes(direction)){coverage.invalidEvents++;continue;}
    if(priorTime!==null&&time<priorTime){coverage.clockDiscontinuities++;for(let i=0;i<states.length;i++)closeWindow(i,priorTime,'clock');segment++;}
    coverage.firstEventMs??=time;coverage.lastEventMs=time;priorTime=time;
    const car=cars[index],state=states[index];coverage.processedEvents++;car.events[direction]++;car.events.clockSegments=Math.max(car.events.clockSegments,segment+1);
    const frames=packetFrames(raw);if(!frames){car.events.malformedPackets++;continue;}
    for(const frame of frames){
      if(direction==='tx'){
        if(frame[1]!==ID.SPEED)continue;
        if(frame.length!==7){car.events.malformedPackets++;continue;}
        const speed=new DataView(frame.buffer,frame.byteOffset,frame.byteLength).getInt16(2,true);
        if(speed<0){car.events.malformedPackets++;continue;}
        sample(car.requestedSpeed,speed);
        if(speed===0){car.stop.zeroSpeedWrites++;car.stop.lastZeroSpeedWriteMs=time;closeWindow(index,time,'stop');}
        else if(!state.active){state.active={start:time,lastPosition:null};car.commandedWindows.count++;}
        continue;
      }
      let message;try{message=decode(frame)[0];}catch{car.events.malformedPackets++;continue;}
      if(message.type==='position'){
        car.events.positions++;sample(car.reportedPositionSpeed,message.speed);
        if(state.active){
          if(state.active.lastPosition!==null)addGap(car.positionGaps,time-state.active.lastPosition);
          else car.commandedWindows.maximumFirstPositionDelayMs=Math.max(car.commandedWindows.maximumFirstPositionDelayMs??0,time-state.active.start);
          state.active.lastPosition=time;
        }else car.events.positionsOutsideCommands++;
      }else if(message.type==='transition')car.events.transitions++;
      else if(message.type==='speed')sample(car.reportedSpeedUpdates,message.actual);
      else if(message.type==='version'&&car.firmware===null)car.firmware=integer(message.version);
      else if(message.type==='other'){
        car.events.unrecognizedFrames++;
        if([ID.POSITION,ID.TRANSITION,ID.SPEED_UPDATE,ID.VERSION_REPLY].includes(frame[1]))car.events.malformedPackets++;
      }
    }
  }
  for(let i=0;i<cars.length;i++){
    closeWindow(i,priorTime??0,'end');const car=cars[i];
    for(const field of ['requestedSpeed','reportedPositionSpeed','reportedSpeedUpdates'])car[field]=finishStats(car[field]);
    const rows=list(diagnostics.round?.rows).filter(r=>integer(r?.id)===car.driverId&&car.driverId!==null);
    if(rows.length===1&&integer(rows[0].laps)!==null&&(car.snapshotOnly||!ambiguousIds.has(car.driverId)))car.controllerLaps={count:rows[0].laps,source:'final round snapshot; controller-reported, not independent physical verification'};
  }
  if(!coverage.clockDiscontinuities&&coverage.firstEventMs!==null)coverage.elapsedMs=coverage.lastEventMs-coverage.firstEventMs;
  const settings=object(diagnostics.driving),safety=object(diagnostics.safety),map=list(diagnostics.track),checks=object(diagnostics.trackChecks);
  const lengths=map.map(p=>nonnegative(p?.length));
  const report={schema:RUN_REPORT_SCHEMA,recordedAt:text(trace.recorded,40)||null,exportedAt:text(diagnostics.exported,40)||null,build:text(diagnostics.build,80)||null,
    controller:{phase:text(diagnostics.phase,40)||null,halted:typeof diagnostics.halted==='boolean'?diagnostics.halted:null,pitReason:text(diagnostics.pitReason)||null},
    source:cars.length&&cars.every(c=>c.source==='simulator')?'simulator':cars.some(c=>c.source==='hardware')?(cars.some(c=>c.source==='simulator')?'mixed':'hardware'):'unknown',coverage,
    hostTiming:hostTimingSnapshot(diagnostics.hostTiming),
    policies:{source:'final controller snapshot; may differ from earlier commands',maximumSpeed:nonnegative(settings.maximumSpeed),rampMs:nonnegative(settings.rampMs),telemetryGraceMs:nonnegative(settings.telemetryGraceMs),powerZoneMode:['off','shield','boost'].includes(settings.powerZoneMode)?settings.powerZoneMode:null,
      firstTrackMs:nonnegative(safety.firstTrackMs),trackGapMs:nonnegative(safety.trackGapMs),scanMs:nonnegative(safety.scanMs),scanLaps:integer(safety.scanLaps)},
    track:{source:'final controller map/checks; not reconstructed from this report',pieceCount:map.length||integer(checks.pieceCount),lengthMm:map.length&&lengths.every(x=>x!==null)?Math.round(lengths.reduce((a,b)=>a+b,0)):null,
      pieceIds:map.slice(0,256).map(p=>integer(p?.id)),geometricClosure:typeof checks.geometricClosure==='boolean'?checks.geometricClosure:null,
      issues:list(checks.issues).slice(0,24).map(s=>text(s,160)),specialPieceIds:[...new Set([...map.filter(p=>p?.unverified||[53,54,57].includes(p?.id)).map(p=>integer(p.id)),...list(checks.special).map(p=>integer(p?.id))].filter(x=>x!==null))],physicalValidation:false},
    cars,annotations:[],operatorObservations:text(diagnostics.operatorNotes,2000),warnings,
    limitations:[
      'A recorded TX is logged after the browser transport API completes, not when the packet enters the radio. It is not proof the firmware accepted it or the physical car moved/stopped.',
      'Command windows use recorded write-completion times. Notifications can arrive before a command completion is logged, so readings outside these windows and windows without a reading do not establish optical silence.',
      'Position gaps measure host receipt of decoded optical notifications inside those windows, not sensor timestamps or radio packet loss. Paused periods are excluded by the recorded writes; transitions, first-reading delay and trailing silence are separate.',
      'Host scheduling, browser delivery, transport operations and missing optical codes can all affect observed timing. This recording does not measure RSSI, retransmissions or radio loss rate.',
      'Transport and host-timing summaries are final lifetime snapshots, not a chronology correlated with this recording. Completed API times cover fulfilled calls, including known late completions; they exclude rejections and unresolved timeouts. A late completion is counted in both completed calls and timeout breaches, so those totals must not be added. Other timeouts do not establish that the underlying operation settled. Coalesced or suppressed commands are not radio packet loss.',
      'Speed averages are sample averages, not time-weighted speeds; position speed and speed-update replies are separate evidence sources.',
      'Only recorded events are analyzed. Missing or malformed events can hide commands, stops or readings; final diagnostics may cover a different time span.',
      'Lap counts, maps and notes are controller/operator claims. This report does not independently verify physical completion, track shape, collision or stopping.',
      'Raw packet bytes, transport identifiers, room keys and connection URLs are not included. Operator-entered observations remain verbatim plain text.'
    ]};
  const allowedKinds=new Set(['driving-settings','power-zone-rule','scan-request','scan-start','forward-baseline-request','diagnostic-request','pit-cleared-stopped']);
  for(const marker of list(trace.markers).slice(0,LIMITS.markers)){
    if(nonnegative(marker?.timeMs)===null)continue;const kind=text(marker.kind,60),details=object(marker.details);
    if(kind==='log'&&/stop|timeout|pit|off.track|battery|recovery/i.test(text(details.text,1000)))report.annotations.push({timeMs:marker.timeMs,kind:'controller log',text:text(details.text,240)});
    else if(allowedKinds.has(kind))report.annotations.push({timeMs:marker.timeMs,kind,text:kind+(integer(details.carId)!==null?' · car '+details.carId:'')});
  }
  if(report.annotations.length>LIMITS.annotations){warnings.push('Only the latest '+LIMITS.annotations+' relevant annotations are shown.');report.annotations=report.annotations.slice(-LIMITS.annotations);}
  if(trace.format!=='slipstream-trace-v1')warnings.push('Recording format is missing or unrecognized; available fields were summarized conservatively.');
  if(!coverage.processedEvents)warnings.push('No recorded packet evidence. Final snapshot fields alone cannot establish a run.');
  if(coverage.droppedEvents===null||coverage.droppedAnnotations===null)warnings.push('Recorder loss counters are missing; completeness cannot be assessed.');
  if(coverage.droppedEvents||coverage.droppedAnnotations)warnings.push('Recorder reported lost events or annotations; coverage is partial.');
  if(coverage.invalidEvents||cars.some(c=>c.events.malformedPackets))warnings.push('Invalid events or malformed packet frames were excluded from the corresponding calculations.');
  if(coverage.clockDiscontinuities)warnings.push('Event time moved backwards. Timing windows were split; overall elapsed time is unavailable.');
  if(coverage.omittedEvents||list(trace.cars).length>LIMITS.cars||list(diagnostics.cars).length>LIMITS.cars||list(trace.markers).length>LIMITS.markers)warnings.push('Input exceeded report limits; only a bounded portion was analyzed.');
  if(cars.some(c=>c.commandedWindows.openAtEnd))warnings.push('At least one positive-command window has no recorded following STOP. The report cannot determine its physical outcome.');
  return report;
}

const show=(value,suffix='')=>value===null||value===undefined?'not recorded':String(value)+suffix;
const seconds=value=>value===null||value===undefined?'not recorded':(value/1000).toFixed(2)+' s';
const milliseconds=value=>value===null||value===undefined?'not recorded':Number(value.toFixed(2))+' ms';
const speedLine=s=>s.samples?`${s.samples} samples; min ${s.min}, max ${s.max}, sample mean ${s.mean} mm/s`:'no recorded samples';
export function renderRunReportText(report){
  if(report?.schema!==RUN_REPORT_SCHEMA)throw new Error('Expected a Slipstream run report');
  const r=report,c=r.coverage,p=r.policies,t=r.track;
  const lines=['SLIPSTREAM RUN REPORT',`Source: ${r.source} · build: ${show(r.build)}`,`Recorded: ${show(r.recordedAt)} · exported: ${show(r.exportedAt)}`,'',
    'FINAL CONTROLLER STATE',`Phase: ${show(r.controller.phase)} · halt requested: ${r.controller.halted===null?'not recorded':r.controller.halted?'yes':'no'} · shared pit: ${show(r.controller.pitReason)}.`,
    '', 'RECORDING COVERAGE',`${c.processedEvents} recorded events analyzed; ${c.invalidEvents} invalid; ${c.omittedEvents} omitted by report limit.`,
    `Recorder losses: ${show(c.droppedEvents)} events, ${show(c.droppedAnnotations)} annotations. Event span: ${seconds(c.elapsedMs)}.`,
    `Clock discontinuities: ${c.clockDiscontinuities}. A zero loss count does not prove complete capture.`,
    '', 'SELECTED SETTINGS (final controller snapshot)',`Maximum ${show(p.maximumSpeed,' mm/s')} · acceleration ramp ${seconds(p.rampMs)} · optional telemetry grace ${seconds(p.telemetryGraceMs)}.`,
    `First-reading limit ${seconds(p.firstTrackMs)} · ordinary gap limit ${seconds(p.trackGapMs)} · scan budget ${seconds(p.scanMs)} / ${show(p.scanLaps,' laps')}.`,
    `Power Zone: ${show(p.powerZoneMode)}. Earlier settings may differ; inspect the trace for chronology.`,
    '', 'MAP (final controller snapshot)',`${show(t.pieceCount)} sections · ${show(t.lengthMm,' mm')} · geometric closure: ${t.geometricClosure===null?'not recorded':t.geometricClosure?'reported closed':'reported open'}.`,
    `Piece IDs: ${t.pieceIds.length?t.pieceIds.map(id=>show(id)).join(', '):'not recorded'}. Special pieces: ${t.specialPieceIds.length?t.specialPieceIds.join(', '):'none reported'}.`,
    `Map issues: ${t.issues.length?t.issues.join('; '):'none reported; not physical validation'}.`];
  const h=r.hostTiming;
  lines.push('', 'HOST TIMING (final page-lifetime snapshot, not recording-only evidence)');
  if(h)lines.push(`Expected callback interval ${milliseconds(h.expectedIntervalMs)}; ${show(h.samples)} measured gaps; latest ${milliseconds(h.lastGapMs)}, maximum ${milliseconds(h.maxGapMs)}.`,
    `Callback gaps over 100 / 500 / 1000 ms: ${show(h.over100Ms)} / ${show(h.over500Ms)} / ${show(h.over1000Ms)}. Clock resets: ${show(h.clockResets)}.`,
    'Includes any recorded parked/background periods; a callback gap does not identify its cause or prove a radio fault.');
  else lines.push('Not recorded. Host scheduling delay cannot be separated from transport timing in this snapshot.');
  for(const car of r.cars){const w=car.commandedWindows,g=car.positionGaps,s=car.finalSnapshot,a=car.transportHealth;
    lines.push('',`CAR ${show(car.driverId)} · ${car.name}${car.snapshotOnly?' (snapshot only)':''}`,`Model ID ${show(car.modelId)} · firmware ${show(car.firmware)} · profile ${car.profile} · ${car.source}.`,
      `${car.events.tx} TX / ${car.events.rx} RX; ${car.events.positions} positions; ${car.events.transitions} transitions; ${car.events.malformedPackets} malformed frames/packets.`,
      `Written speed requests: ${speedLine(car.requestedSpeed)}.`,`Reported position speeds: ${speedLine(car.reportedPositionSpeed)}.`,`Reported speed-update values: ${speedLine(car.reportedSpeedUpdates)}.`,
      `Positive-speed write-completion windows: ${w.count}; ${w.closedByStop} closed by a recorded STOP completion; ${w.openAtEnd} open at recording end; ${w.splitByClock} split by clock.`,
      `Time within recorded completion windows ${seconds(w.observedDurationMs)}; ${w.withoutPosition} windows contain no decoded position (not proof of optical silence).`,
      `First host-received position after logged write completion: max ${seconds(w.maximumFirstPositionDelayMs)}. Tail receipt gap to STOP completion/end: max ${seconds(w.maximumTailSilenceMs)}.`,
      `Host-received optical gaps within those windows: ${g.samples}; maximum ${seconds(g.maxMs)}.`,g.buckets.map(b=>`${b.label}: ${b.count}`).join(' | '),
      `${car.events.positionsOutsideCommands} position notifications outside recorded completion windows; API completion may follow a notification.`,
      `STOP writes: ${car.stop.zeroSpeedWrites}. Final controller reason: ${show(car.stop.finalReason)}. Physical stop: unverified.`,
      `Laps: ${car.controllerLaps?car.controllerLaps.count+' ('+car.controllerLaps.source+')':'not recorded; not inferred from repeated piece IDs'}.`);
    if(s)lines.push(`Final snapshot requested ${show(s.requestedSpeed,' mm/s')}, reported ${show(s.reportedSpeed,' mm/s')} (report age ${seconds(s.reportedSpeedAgeMs)}).`,
      `Battery ${show(s.batteryMv,' mV')} (sample age ${seconds(s.batteryAgeMs)}). Final connection: ${s.connected===null?'unknown':s.connected?'connected':'disconnected'}.`);
    if(a)lines.push(`Transport health (final car-lifetime snapshot): ${a.writeMode}; API completions ${show(a.completed)}, settled rejections ${show(a.failed)}, timeout breaches ${show(a.timeouts)}.`,
      `Known late completions: ${show(a.lateCompletions)} (included in both completions and timeout breaches; do not add these totals).`,
      `Suppressed before transport: ${show(a.suppressed)}; coalesced queued requests: ${show(a.coalesced)}. These are not radio loss counts.`,
      `Queued requests ${show(a.pendingCount)}; oldest pending age ${milliseconds(a.pendingAgeMs)}; current API operation age ${milliseconds(a.inFlightAgeMs)}.`,
      `Queue waiting: latest ${milliseconds(a.lastQueueWaitMs)}, maximum ${milliseconds(a.maxQueueWaitMs)}. Fulfilled API duration (including known late completions): latest ${milliseconds(a.lastCompletedApiMs)}, maximum ${milliseconds(a.maxCompletedApiMs)}.`,
      'API timing includes host/browser scheduling and does not measure over-the-air latency or firmware acknowledgment.');
    else lines.push('Transport queue/API timing: not recorded.');
  }
  lines.push('', 'RECORDED CONTROLLER ANNOTATIONS (not physical observations)');
  lines.push(...(r.annotations.length?r.annotations.map(a=>`${seconds(a.timeMs)} · ${a.text}`):['None captured.']));
  lines.push('', 'OPERATOR OBSERVATIONS (unverified, entered by a person)',r.operatorObservations||'Not entered.', '', 'COVERAGE WARNINGS',...(r.warnings.length?r.warnings.map(w=>'- '+w):['No additional data-quality warning detected; limitations below still apply.']), '', 'LIMITS',...r.limitations.map(l=>'- '+l));
  return lines.join('\n')+'\n';
}
