// Deterministic simulator-only fault injection. This does not model radio timing,
// physical braking, or a disconnected laptop's ability to deliver STOP.
import {decode, ID} from './protocol.mjs';
const range=(value,min,max,label)=>{if(!Number.isFinite(value)||!Number.isInteger(value)||value<min||value>max)throw new RangeError(label+' is out of range');return value;};
const time=value=>{if(!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)throw new RangeError('Fault time is invalid');return value;};
const packed=frames=>Uint8Array.from(frames.flatMap(frame=>[...frame]));
export class FaultTransport {
  // Only supported, complete position/transition frames are faulted. Safety,
  // unknown formats and malformed tails pass immediately without reassembly.
  // No real timers/randomness: call advance(now) to release due frames. Default
  // receipt time is the last advance value (starts at zero), or inject clock.
  // Delay (0..10000 ms) and burst loss apply to newly received optical frames;
  // changing them does not retime frames already queued. At most maxPending
  // (1..1024; default128) copied frames are retained; overflow drops telemetry.
  constructor(inner,{telemetryDelayMs=0,maxPending=128,clock}={}) {
    this.maxPending=range(maxPending,1,1024,'Maximum pending count');this.setTelemetryDelay(telemetryDelayMs);
    if(clock!==undefined && typeof clock!=='function')throw new TypeError('Fault clock must be a function');
    this.inner=inner;this.now=0;this.clock=clock??(()=>this.now);this.active=true;this.unexpectedClose=false;
    this.silentTelemetry=false;this.dropRemaining=0;this.droppedTelemetry=0;this.listeners=new Set();this.closed=new Set();this.pending=[];
    this.unsubscribe=inner.onNotify(bytes=>this.#receive(bytes));
    this.unsubscribeClose=inner.onClose?.(()=>{
      if(!this.active)return;
      this.unexpectedClose=true;const callbacks=[...this.closed];this.#deactivate();for(const fn of callbacks)fn();
    });
  }
  get initializationProfile(){return this.inner.initializationProfile;}
  set initializationProfile(value){this.inner.initializationProfile=value;}
  get initializationOptions(){return this.inner.initializationOptions;}
  set initializationOptions(value){this.inner.initializationOptions=value;}
  get initializationTimeoutMs(){return this.inner.initializationTimeoutMs;}
  set initializationTimeoutMs(value){this.inner.initializationTimeoutMs=value;}
  drainNotifications(){return this.inner.drainNotifications?.();}
  diagnostics(){return this.inner.diagnostics?.()??null;}
  onNotify(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  onClose(fn){if(this.unexpectedClose){fn();return()=>{};}if(!this.active)return()=>{};this.closed.add(fn);return()=>this.closed.delete(fn);}
  emit(bytes) { if(this.active)for (const fn of this.listeners){if(!this.active)break;fn(bytes);} }
  async write(bytes) { if(!this.active)throw new Error('Fault transport closed');return this.inner.write(bytes); }
  setTelemetryDelay(ms){this.telemetryDelayMs=range(ms,0,10000,'Telemetry delay');}
  // Replace, rather than add to, the number of next optical frames to discard.
  dropNextTelemetry(count){this.dropRemaining=range(count,0,10000,'Telemetry burst count');}
  #drop(){this.droppedTelemetry=Math.min(Number.MAX_SAFE_INTEGER,this.droppedTelemetry+1);}
  #receive(bytes){
    if(!this.active)return;
    if(!this.silentTelemetry && !this.dropRemaining && !this.telemetryDelayMs){this.emit(bytes);return;}
    const immediate=[];
    for(let at=0;at<bytes.length;){
      const end=at+bytes[at]+1;
      if(bytes[at]<1 || end>bytes.length){immediate.push(bytes.slice(at));break;}
      const frame=bytes.slice(at,end);at=end;
      const optical=[ID.POSITION,ID.TRANSITION].includes(frame[1]) && ['position','transition'].includes(decode(frame)[0]?.type);
      if(!optical){immediate.push(frame);continue;}
      if(this.dropRemaining){this.dropRemaining--;this.#drop();continue;}
      if(this.silentTelemetry){this.#drop();continue;}
      if(this.telemetryDelayMs){
        if(this.pending.length>=this.maxPending){this.#drop();continue;}
        this.pending.push({at:time(time(this.clock())+this.telemetryDelayMs),bytes:frame});
      }else immediate.push(frame);
    }
    if(immediate.length)this.emit(packed(immediate));
    else if(bytes.length===0)this.emit(bytes);
  }
  lateDelocalized(at) {
    time(at);if(!this.active)return;
    if(this.pending.length>=this.maxPending)throw new RangeError('Maximum pending fault count reached');
    this.pending.push({at,bytes:Uint8Array.of(1,ID.DELOCALIZED)});
  }
  advance(now) {
    time(now);if(!this.active)return;this.now=now;
    const due=this.pending.filter(event=>event.at<=now).sort((a,b)=>a.at-b.at);
    this.pending=this.pending.filter(event=>event.at>now);
    for(const event of due)this.emit(event.bytes);
  }
  #deactivate(){this.active=false;this.unsubscribe?.();this.unsubscribeClose?.();this.listeners.clear();this.closed.clear();this.pending=[];}
  close() {this.#deactivate();return this.inner.close();}
}
// Relay outages occur above BLE. Keep this companion separate so a lost relay
// never silently disables local Bluetooth STOP delivery in the test model.
export class FaultRelay {
  constructor(onMessage, onStatus) { this.onMessage = onMessage; this.onStatus = onStatus; this.outage = false; }
  setOutage(value, {announce = true} = {}) { this.outage = value; if (announce) this.onStatus(value ? 'offline' : 'online'); }
  send(message) { if (!this.outage) this.onMessage(message); }
}
