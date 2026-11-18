// Offline diagnostics. Never connects to a car or interprets supercodes as attacks.
import {readFile, stat} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {validate} from '../trace.mjs';
import {decode, ID, offsetIsKnown} from '../protocol.mjs';

const ACQUISITION_LIMITS=Object.freeze({intervals:32,transitionSamples:8,lateTrackSamples:8});
const COMMAND_BYTES=new Map([[ID.SPEED,7],[ID.SET_OFFSET,6],[ID.OFFSET_ADJUST,6],[ID.CHANGE_LANE,12],[ID.CANCEL_LANE_CHANGE,2],[ID.TURN,4]]);
const acquisitionReport=()=>({
  limitation:'Intervals are positive SPEED requests through the next requested STOP, not physical motion. Times are recorded TX/RX event times, not physical start/stop times. Offset commands are wire opcodes, not proof of optical calibration. Negative SPEED values are reported as unsupported and do not define interval boundaries. Raw position frames require complete framing; decoded transitions and wheel-distance bytes do not identify a track section or prove movement. Sample lists are bounded; omitted intervals still contribute to intervalCount.',
  limits:{...ACQUISITION_LIMITS},intervalCount:0,intervalsOmitted:0,malformedCommandFrames:0,unsupportedSpeedCommands:0,rawPositionFrames:0,rawTransitionFrames:0,unknownOffsetTransitions:0,
  trackMessagesOutsideIntervals:0,offsetCommandsOutsideIntervals:0,lateralCommandsOutsideIntervals:0,intervals:[]
});
function framed(bytes) {
  const frames=[];
  for(let at=0;at<bytes.length;) {
    const size=bytes[at],end=at+size+1;
    if(size<1 || end>bytes.length)return {frames,malformed:true};
    frames.push(bytes.subarray(at,end));at=end;
  }
  return {frames,malformed:false};
}
function command(car,state,frame,time) {
  const report=car.acquisition,id=frame[1],view=new DataView(frame.buffer,frame.byteOffset,frame.byteLength);
  if(!COMMAND_BYTES.has(id))return;
  if(frame.length!==COMMAND_BYTES.get(id) || ([ID.SET_OFFSET,ID.OFFSET_ADJUST].includes(id) && !Number.isFinite(view.getFloat32(2,true))) ||
      (id===ID.CHANGE_LANE && !Number.isFinite(view.getFloat32(6,true)))) {report.malformedCommandFrames++;return;}
  if(id===ID.SPEED) {
    const requestedSpeedMmS=view.getInt16(2,true);
    if(requestedSpeedMmS<0) {report.unsupportedSpeedCommands++;if(state.active)state.active.unsupportedSpeedCommands++;return;}
    if(requestedSpeedMmS===0) {
      if(state.active) {state.active.stopRequestedMs=time;state.active.stopCommandCount++;state.lastStopped=state.active;state.active=null;}
      else if(state.lastStopped)state.lastStopped.stopCommandCount++;
    } else if(state.active) {
      state.active.positiveSpeedCommandCount++;state.active.latestRequestedSpeedMmS=requestedSpeedMmS;
      state.active.maximumRequestedSpeedMmS=Math.max(state.active.maximumRequestedSpeedMmS,requestedSpeedMmS);
    } else {
      const interval={number:++report.intervalCount,startMs:time,stopRequestedMs:null,stopCommandCount:0,
        initialRequestedSpeedMmS:requestedSpeedMmS,latestRequestedSpeedMmS:requestedSpeedMmS,maximumRequestedSpeedMmS:requestedSpeedMmS,positiveSpeedCommandCount:1,unsupportedSpeedCommands:0,
        rawPositionFrames:0,positions:0,rawTransitionFrames:0,transitions:0,unknownOffsetTransitions:0,
        firstRawPositionFrame:null,firstDecodedPosition:null,firstTransition:null,firstRawPositionAfterTransition:null,
        offsetCommands:0,lateralCommands:0,transitionSamples:[],transitionSamplesOmitted:0,
        lateTrack:{positions:0,transitions:0,unknownOffsetTransitions:0,firstAtMs:null,lastAtMs:null,samples:[],samplesOmitted:0}};
      state.active=interval;state.lastStopped=null;
      if(report.intervals.length<ACQUISITION_LIMITS.intervals)report.intervals.push(interval);else report.intervalsOmitted++;
    }
    return;
  }
  const category=[ID.SET_OFFSET,ID.OFFSET_ADJUST].includes(id)?'offsetCommands':'lateralCommands';
  if(state.active)state.active[category]++;
  else report[category+'OutsideIntervals']++;
}
function transitionSample(message,time) {
  return {atMs:time,offsetMm:message.offset,offsetKnown:offsetIsKnown(message.offset),
    leftCm:message.leftCm??null,rightCm:message.rightCm??null};
}
function acquisitionNotification(car,state,frame,message,time) {
  const active=state.active,track=message && ['position','transition'].includes(message.type);
  if(frame[1]===ID.POSITION)car.acquisition.rawPositionFrames++;
  if(frame[1]===ID.TRANSITION)car.acquisition.rawTransitionFrames++;
  if(message?.type==='transition' && !offsetIsKnown(message.offset))car.acquisition.unknownOffsetTransitions++;
  if(active) {
    if(frame[1]===ID.POSITION) {
      active.rawPositionFrames++;
      const observation={atMs:time,afterStartMs:time-active.startMs,decoded:message?.type==='position'};
      active.firstRawPositionFrame??={...observation,afterFirstTransitionMs:active.firstTransition?time-active.firstTransition.atMs:null};
      if(active.firstTransition)active.firstRawPositionAfterTransition??={...observation,afterTransitionMs:time-active.firstTransition.atMs};
    }
    if(frame[1]===ID.TRANSITION)active.rawTransitionFrames++;
    if(message?.type==='position') {
      active.positions++;
      active.firstDecodedPosition??={atMs:time,afterStartMs:time-active.startMs,pieceId:message.pieceId,locationId:message.locationId,
        reverse:message.reverse,reportedSpeedMmS:message.speed,offsetMm:message.offset,offsetKnown:offsetIsKnown(message.offset)};
    }
    if(message?.type==='transition') {
      active.transitions++;if(!offsetIsKnown(message.offset))active.unknownOffsetTransitions++;
      active.firstTransition??={atMs:time,afterStartMs:time-active.startMs};
      if(active.transitionSamples.length<ACQUISITION_LIMITS.transitionSamples)active.transitionSamples.push({...transitionSample(message,time),afterStartMs:time-active.startMs});
      else active.transitionSamplesOmitted++;
    }
  } else if(track && state.lastStopped) {
    const late=state.lastStopped.lateTrack;late[message.type==='position'?'positions':'transitions']++;
    late.firstAtMs??=time;late.lastAtMs=time;
    if(message.type==='transition' && !offsetIsKnown(message.offset))late.unknownOffsetTransitions++;
    if(late.samples.length<ACQUISITION_LIMITS.lateTrackSamples)late.samples.push({type:message.type,atMs:time,afterStopMs:time-state.lastStopped.stopRequestedMs,
      ...(message.type==='transition'?transitionSample(message,time):{pieceId:message.pieceId,locationId:message.locationId,reportedSpeedMmS:message.speed})});
    else late.samplesOmitted++;
  } else if(track)car.acquisition.trackMessagesOutsideIntervals++;
}

export function summarizeTrace(input) {
  const trace = validate(input);
  const cars = trace.cars.map((car, index) => ({index, name: car?.name ?? 'Unknown', model: car?.model ?? null,
    simulated: typeof car?.simulated === 'boolean' ? car.simulated : null,
    firmware: car?.firmware ?? null, rx: 0, tx: 0, malformedNotifications: 0,
    messages: {}, pieces: new Set(), supercodes: new Map(), acquisition:acquisitionReport()}));
  const states=cars.map(()=>({active:null,lastStopped:null}));
  for (const [time, index, direction, hex] of trace.events) {
    const car = cars[index],state=states[index]; car[direction]++;
    const bytes=Uint8Array.from(hex.split(' ').map(b=>parseInt(b,16))),packets=framed(bytes);
    if(direction==='tx') {
      if(packets.malformed)car.acquisition.malformedCommandFrames++;
      for(const frame of packets.frames)command(car,state,frame,time);
      continue;
    }
    let messages=[];
    try { messages=decode(bytes); }
    catch { car.malformedNotifications++; }
    for(let i=0;i<packets.frames.length;i++)acquisitionNotification(car,state,packets.frames[i],messages[i],time);
    for (const m of messages) {
      car.messages[m.type] = (car.messages[m.type] ?? 0) + 1;
      if (m.type === 'version') car.firmware = m.version;
      if (m.type === 'position') car.pieces.add(m.pieceId);
      if (m.type === 'supercode' || m.type === 'zoneSupercode') {
        const key = `${m.id}:${m.code}:${m.rawTag}`;
        const found = car.supercodes.get(key);
        if (found) { found.count++; found.lastMs = time; }
        else car.supercodes.set(key, {messageId: m.id, code: m.code, rawTag: m.rawTag, count: 1, firstMs: time, lastMs: time});
      }
    }
  }
  return {declaredSource: trace.source ?? 'unknown', physicalValidation: false,
    limitation: 'Recording metadata is self-reported. Supercodes are observations, not confirmed Power Zone locations or effects.',
    durationMs: trace.events.at(-1)?.[0] ?? 0, dropped: trace.dropped ?? 0,
    cars: cars.map(c => ({...c, pieces: [...c.pieces].sort((a,b) => a-b), supercodes: [...c.supercodes.values()]}))};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node slipstream/tools/inspect_trace.mjs recording.json');
    const file = process.argv[2];
    if ((await stat(file)).size > 32 * 1024 * 1024) throw new Error('Trace exceeds the 32 MiB inspection limit');
    console.log(JSON.stringify(summarizeTrace(JSON.parse(await readFile(file, 'utf8'))), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
