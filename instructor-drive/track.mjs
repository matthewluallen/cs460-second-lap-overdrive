// Independent passive implementation. No transport, commands, reconnects or timers.
// Packet fields: official anki/drive-sdk, commit 410352617b8660338746a6bb2b2dd173afb1b91a,
// include/ankidrive/protocol.h lines 164–221. Piece classifications and nominal geometry
// corroborated by Leicas/overdrive-arena (MIT), ff03e265e77be237c329a512b92b6fb579abbeb9,
// README protocol notes. No Partydrive code or offsetInfo.json table is incorporated.
const TYPES=new Map([
  ...[33,34].map(id=>[id,'start']),
  ...[36,39,40,48,51].map(id=>[id,'straight']),
  ...[17,18,20,23,24,27].map(id=>[id,'curve']),
  [10,'crossing'],[43,'jump ramp'],[58,'jump ramp'],[46,'jump landing'],[63,'jump landing'],
  [53,'Fast & Furious special'],[54,'Fast & Furious special'],[57,'Fast & Furious special'],
]);
const SIMPLE=new Set(['start','straight','curve']);
const CLASSIC=new Set([9511,11866]);
const DIRECTIONS=[[1,0],[0,1],[-1,0],[0,-1]];
const copy=value=>JSON.parse(JSON.stringify(value));
const hex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(' ');

function decodeFrame(bytes){
  const id=bytes[1],view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(id===0x27){
    if(bytes.length!==17)throw new Error('Position 0x27 requires the full 17-byte classic frame');
    const offsetMm=view.getFloat32(4,true);
    if(!Number.isFinite(offsetMm))throw new Error('Position offset is not finite');
    return {type:'position',locationId:bytes[2],pieceId:bytes[3],offsetMm,
      speedMmPerSec:view.getUint16(8,true),parsingFlags:bytes[10],
      reverseParsing:!!(bytes[10]&0x40),reverseDriving:!!(bytes[10]&0x20),
      invertedColor:!!(bytes[10]&0x80),codeBits:bytes[10]&0x0f,
      lastReceivedLaneCommandId:bytes[11],lastExecutedLaneCommandId:bytes[12],
      desiredLaneSpeedMmPerSec:view.getUint16(13,true),desiredSpeedMmPerSec:view.getUint16(15,true)};
  }
  if(id===0x29){
    if(bytes.length!==18)throw new Error('Transition 0x29 requires the full 18-byte classic frame');
    const offsetMm=view.getFloat32(4,true);
    if(!Number.isFinite(offsetMm))throw new Error('Transition offset is not finite');
    return {type:'transition',currentSegmentIndex:view.getInt8(2),previousSegmentIndex:view.getInt8(3),
      offsetMm,lastReceivedLaneCommandId:bytes[8],lastExecutedLaneCommandId:bytes[9],
      desiredLaneSpeedMmPerSec:view.getUint16(10,true),averageLineDriftPixels:view.getInt8(12),
      hadLaneChangeActivity:bytes[13],uphillCounter:bytes[14],downhillCounter:bytes[15],
      leftWheelDistanceCm:bytes[16],rightWheelDistanceCm:bytes[17]};
  }
  if(id===0x2b)return {type:'delocalized'};
  return {type:'other',id};
}

function layout(pieces){
  let x=0,y=0,heading=0;
  const path=[{xMm:x,yMm:y,heading}];
  for(const piece of pieces){
    if(!SIMPLE.has(piece.kind)||piece.ambiguous)return null;
    const [dx,dy]=DIRECTIONS[heading];
    if(piece.kind==='curve'){
      if(!piece.turn)return null;
      const next=(heading+(piece.turn==='R'?1:3))%4,[nx,ny]=DIRECTIONS[next];
      x+=280*(dx+nx);y+=280*(dy+ny);heading=next;
    }else{x+=560*dx;y+=560*dy;}
    path.push({xMm:x,yMm:y,heading});
  }
  if(x!==0||y!==0||heading!==0)return null;
  return {closed:true,units:'mm',straightLengthMm:560,curveRadiusMm:280,path,
    basis:'Geometry inferred from observed simple tile sequence and nominal dimensions; origin and heading arbitrary; physical layout unverified'};
}

export class TrackRecorder {
  constructor({now=Date.now,timeoutMs=120000,maxFrames=2048,maxPieces=128}={}){
    if(typeof now!=='function')throw new TypeError('now must be a clock function');
    for(const [name,value,min] of [['timeoutMs',timeoutMs,1],['maxFrames',maxFrames,1],['maxPieces',maxPieces,3]]){
      if(!Number.isSafeInteger(value)||value<min)throw new RangeError(name+' must be a bounded positive integer');
    }
    if(maxFrames>10000||maxPieces>1000||timeoutMs>3600000)throw new RangeError('Recorder bounds exceed the allowed limit');
    this.now=now;this.timeoutMs=timeoutMs;this.maxFrames=maxFrames;this.maxPieces=maxPieces;
    this.status='IDLE';this.mode='SIMULATION';this.session={};this.pieces=[];this.observations=[];this.warnings=[];this.current=[];
  }
  start({mode='SIMULATION',physicalLabel='',browserId='',firmware=null}={}){
    if(mode!=='SIMULATION'&&mode!=='LIVE')throw new Error('Recording mode must be SIMULATION or LIVE');
    if(typeof physicalLabel!=='string'||typeof browserId!=='string')throw new TypeError('Session labels must be strings');
    if(firmware!==null&&(!Number.isSafeInteger(firmware)||firmware<0))throw new TypeError('Invalid firmware value');
    this.mode=mode;this.session={physicalLabel:physicalLabel.slice(0,128),browserId:browserId.slice(0,256),firmware};
    this.status='RECORDING';this.startedAt=this.now();this.endedAt=null;this.reason=null;
    this.pieces=[];this.observations=[];this.warnings=[];this.current=[];this.geometry=null;
    this.anchor=null;this.returnAnchor=null;this.leftAnchor=false;this.invalid=false;this.beforeAnchor=0;
    if(mode==='SIMULATION')this.warn('SIMULATION evidence: these observations do not establish a real track');
    if(!CLASSIC.has(firmware))this.warn('Firmware profile is unknown or unsupported; full classic frames can be recorded but a complete layout cannot be certified');
    return this.snapshot();
  }
  warn(message){if(!this.warnings.includes(message)&&this.warnings.length<64)this.warnings.push(message);}
  expire(){
    if(this.status==='RECORDING'&&this.now()-this.startedAt>=this.timeoutMs)this.finish('timeout');
  }
  ingest(input){
    this.expire();if(this.status!=='RECORDING')return this.snapshot();
    let bytes;
    if(input instanceof Uint8Array)bytes=input;
    else if(input instanceof ArrayBuffer)bytes=new Uint8Array(input);
    else if(input instanceof DataView)bytes=new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
    else throw new TypeError('Notification must be bytes');
    if(this.observations.length>=this.maxFrames)return this.finish('observation limit');
    if(bytes.length>512){
      this.invalid=true;this.warn('Oversized notification; retained raw evidence is truncated to 512 bytes');
      this.observations.push({atMs:Math.max(0,this.now()-this.startedAt),raw:hex(bytes.subarray(0,512)),type:'invalid-envelope',byteLength:bytes.length,truncated:true});
      return this.finish('oversized notification');
    }
    // Validate the whole envelope before treating any leading frame as evidence.
    const frames=[];
    for(let at=0;at<bytes.length;){
      const end=at+bytes[at]+1;
      if(bytes[at]<1||end>bytes.length){
        this.invalid=true;this.warn('Malformed notification envelope; no frame from this notification was accepted');
        this.observations.push({atMs:Math.max(0,this.now()-this.startedAt),raw:hex(bytes),type:'invalid-envelope'});
        return this.snapshot();
      }
      frames.push(bytes.subarray(at,end));at=end;
    }
    for(const frame of frames){
      if(this.observations.length>=this.maxFrames){this.finish('observation limit');break;}
      let decoded;
      try{decoded=decodeFrame(frame);}
      catch(error){
        this.invalid=true;this.warn(error.message);
        this.observations.push({atMs:Math.max(0,this.now()-this.startedAt),raw:hex(frame),type:'invalid',error:error.message});
        continue;
      }
      this.observations.push({atMs:Math.max(0,this.now()-this.startedAt),raw:hex(frame),...decoded});
      if(decoded.type==='position'){
        this.current.push(decoded);
        if(decoded.reverseDriving){this.invalid=true;this.warn('Reverse-driving observations are unsupported for complete layout reconstruction');}
      }else if(decoded.type==='transition')this.closePiece(decoded);
      else if(decoded.type==='delocalized'){this.finish('car delocalized');}
      if(this.status!=='RECORDING')break;
    }
    return this.snapshot();
  }
  closePiece(transition){
    const positions=this.current;this.current=[];
    const ids=[...new Set(positions.map(p=>p.pieceId))];
    const reversals=[...new Set(positions.map(p=>p.reverseParsing))];
    const start=ids.length>0&&ids.every(id=>id===33||id===34);
    const ambiguous=!ids.length||(!start&&ids.length!==1)||reversals.length!==1;
    const pieceId=ids.length===1?ids[0]:null,kind=start?'start':TYPES.get(pieceId)||'unknown';
    const difference=transition.leftWheelDistanceCm-transition.rightWheelDistanceCm;
    const turn=kind==='curve'?(difference>=2?'R':difference<=-2?'L':null):null;
    const piece={pieceId,observedIds:ids,kind,turn,reverseParsing:reversals.length===1?reversals[0]:null,
      ambiguous,positionCount:positions.length,transition};
    if((this.anchor||start)&&(transition.uphillCounter||transition.downhillCounter)){
      this.invalid=true;this.warn('Raised or graded track is not supported by the flat-loop geometry model');
    }
    if(!this.anchor){
      if(start&&!ambiguous){this.anchor=piece;this.pieces.push(piece);}
      else this.beforeAnchor++;
      return;
    }
    if(start&&!ambiguous){
      if(!this.leftAnchor){
        // Adjacent 33/34 observations describe the same physical start tile.
        if(piece.reverseParsing!==this.anchor.reverseParsing){this.invalid=true;this.warn('Start/finish halves disagree on parsing direction');}
        this.anchor.observedIds=[...new Set([...this.anchor.observedIds,...ids])];
        this.anchor.positionCount+=positions.length;
        return;
      }
      this.returnAnchor=piece;
      if(piece.reverseParsing!==this.anchor.reverseParsing){this.invalid=true;this.warn('Return anchor disagrees with the starting direction');}
      if(this.pieces.length<3){this.warn('Return to start occurred before three physical pieces were observed');this.finish('short anchor return');return;}
      this.geometry=!this.invalid&&CLASSIC.has(this.session.firmware)?layout(this.pieces):null;
      if(!this.geometry){this.warn('Observed sequence has gaps, unsupported tiles or does not close in both position and heading');this.finish('loop validation failed');return;}
      this.status='COMPLETE';this.reason='one observed simple loop';this.endedAt=this.now();
      this.warn('One observed loop only; repeat the recording and compare with the physical track before acceptance');
      return;
    }
    this.leftAnchor=true;
    if(this.pieces.length>=this.maxPieces){this.finish('piece limit');return;}
    this.pieces.push(piece);
    if(ambiguous){this.invalid=true;this.warn(ids.length?'Conflicting piece IDs or parsing directions between transition bars':'Transition without a position code: an unknown piece is retained');}
    if(!SIMPLE.has(kind)){this.invalid=true;this.warn('Unsupported layout piece: '+kind+' (IDs '+(ids.join(',')||'unknown')+')');}
    if(kind==='curve'&&!turn){this.invalid=true;this.warn('Curve direction is missing or ambiguous in wheel-distance evidence');}
  }
  finish(reason='operator stop'){
    if(this.status!=='RECORDING')return this.snapshot(false);
    this.status='INCOMPLETE';this.reason=String(reason).slice(0,160);this.endedAt=this.now();
    if(!this.anchor)this.warn('No observed start/finish anchor (33 or 34)');
    if(!this.returnAnchor)this.warn('No observed return to the start/finish anchor');
    if(this.current.length)this.warn('Trailing position observations lack a closing transition');
    if(reason==='timeout')this.warn('Recording timed out; no complete loop was established');
    return this.snapshot(false);
  }
  snapshot(checkTimeout=true){
    if(checkTimeout)this.expire();
    return copy({status:this.status,mode:this.mode,session:this.session,startedAt:this.startedAt??null,
      endedAt:this.endedAt??null,reason:this.reason??null,pieces:this.pieces,warnings:this.warnings,
      observations:this.observations,pendingPositionCount:this.current.length,beforeAnchorPieces:this.beforeAnchor??0,
      returnAnchor:this.returnAnchor??null,...(this.geometry?{geometry:this.geometry}:{})});
  }
}
