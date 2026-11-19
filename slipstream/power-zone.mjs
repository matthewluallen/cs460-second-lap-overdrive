// Slipstream's optional whole-piece checkpoint. This is not the original F&F
// marked-lane disabling attack. Decisions only: no transport or car commands.
import {POSITION_MAX_AGE_MS, LANE_LIMIT} from './track.mjs';

export const POWER_ZONE_MODES = Object.freeze([
  {id:'off',label:'Off'},
  {id:'shield',label:'Charge shield'},
  {id:'boost',label:'Boost after exit'}
]);
export const POWER_ZONE = Object.freeze({
  pieceId:57, lengthMm:560, startMm:170, endMm:390,
  scope:'any-lane', cooldownMs:3000, shieldMs:3000, boostMs:1000, extraSpeed:75,
  provenance:'Slipstream custom checkpoint; original F&F attack is not implemented'
});

export class PowerZoneController {
  constructor({pieces,mode='off'}={}) {
    this.pieces=pieces; this.states=new Map(); this.setMode(mode);
  }
  setMode(mode) {
    if(!POWER_ZONE_MODES.some(option=>option.id===mode))throw new RangeError('Unknown Power Zone rule');
    this.mode=mode; this.reset();
  }
  reset(carId) { if(carId===undefined)this.states.clear(); else this.states.delete(carId); }
  // Call from the actual message handler after Localizer.feed. observedAt is
  // Car's receive stamp, not a later clock sample. active must be false during
  // stop, pit, scan, diagnostics, initialization or degraded telemetry. moving
  // means a positive current driving request; an effect can never start a car.
  observe({carId,message,observedAt,now,localization,track,runId,lap,active,moving}={}) {
    if(this.mode==='off' || active!==true || moving!==true || !Number.isSafeInteger(carId) ||
        !Number.isSafeInteger(runId) || !Number.isSafeInteger(lap) || lap<0 || !track?.closed ||
        !Array.isArray(track.pieces) || track.pieces.some(p=>p.inferred)) {
      this.reset(carId); return null;
    }
    let state=this.states.get(carId);
    if(!state || state.track!==track || state.runId!==runId) {
      state={track,runId,lastAt:-Infinity,lastEffectAt:-Infinity,used:new Map(),entry:null,pending:null};
      this.states.set(carId,state);
    }
    const discard=()=>{state.entry=null;state.pending=null;return null;};
    if(['hostStopped','closed','delocalized','delocRecoveryEntered'].includes(message?.type) ||
        (message?.type==='status' && (!message.onTrack || message.onCharger || message.lowBattery)))return discard();
    if(message?.type!=='position')return null; // transitions/predictions/supercodes never activate a rule
    const reference=localization?.reference;
    const definition=this.pieces?.get(message.pieceId);
    const spot=this.pieces?.locate(message.pieceId,message.locationId,message.reverse);
    if(!Number.isFinite(now) || !Number.isFinite(observedAt) || now<observedAt || now-observedAt>POSITION_MAX_AGE_MS ||
        localization?.trusted!==true || localization.state!=='confirmed' || reference?.source!=='printed-code' || reference.fresh!==true ||
        reference.at!==observedAt || reference.pieceId!==message.pieceId || reference.locationId!==message.locationId || reference.reverse!==message.reverse ||
        !Number.isInteger(reference.index) || ![-1,1].includes(reference.direction) ||
        !Number.isFinite(message.speed) || message.speed<=0 || typeof message.reverse!=='boolean' ||
        !spot || !Number.isFinite(spot.progress) || !Number.isFinite(spot.lateral) || Math.abs(spot.lateral)>LANE_LIMIT) return discard();
    const piece=track.pieces[reference.index];
    if(!piece || piece.id!==message.pieceId || piece.inferred ||
        message.reverse!==(reference.direction===1 ? piece.reverse : !piece.reverse))return discard();
    if(observedAt<state.lastAt)return discard();
    if(observedAt===state.lastAt)return null; // same observation cannot be consumed twice
    state.lastAt=observedAt;
    if(message.pieceId===POWER_ZONE.pieceId) {
      if(definition?.length!==POWER_ZONE.lengthMm || state.used.get(reference.index)===lap)return discard();
      if(state.pending?.index===reference.index && state.pending.direction===reference.direction)return null;
      const progressMm=spot.progress*POWER_ZONE.lengthMm;
      if(progressMm<=POWER_ZONE.startMm) {
        state.entry={index:reference.index,direction:reference.direction,reverse:message.reverse,
          at:observedAt,lastProgress:spot.progress,locationId:message.locationId,lap};
        state.pending=null; return null;
      }
      const entry=state.entry;
      if(!entry || entry.index!==reference.index || entry.direction!==reference.direction || entry.reverse!==message.reverse ||
          entry.lap!==lap || observedAt-entry.at>POSITION_MAX_AGE_MS || spot.progress<entry.lastProgress)return discard();
      entry.lastProgress=spot.progress;
      if(progressMm>=POWER_ZONE.endMm && message.locationId!==entry.locationId) {
        state.pending={index:reference.index,direction:reference.direction,at:observedAt,lap};
        state.entry=null;
      }
      return null;
    }
    const pending=state.pending;
    state.entry=null; state.pending=null;
    if(!pending || observedAt-pending.at>POSITION_MAX_AGE_MS || reference.direction!==pending.direction ||
        reference.index!==(pending.index+pending.direction+track.pieces.length)%track.pieces.length ||
        !definition || definition.unverified || piece.unverified || !Number.isFinite(definition.length))return null;
    // One opportunity per zone per optical lap. A curve exit consumes a boost
    // opportunity; it must not become a delayed boost on a later straight.
    state.used.set(pending.index,pending.lap);
    if(now-state.lastEffectAt<POWER_ZONE.cooldownMs)return null;
    const remainingMm=(1-spot.progress)*definition.length;
    if(this.mode==='boost' && (definition.kind!=='straight' || remainingMm<250))return null;
    state.lastEffectAt=now;
    return {type:this.mode,carId,at:now,expiresAt:now+(this.mode==='boost'?POWER_ZONE.boostMs:POWER_ZONE.shieldMs),
      pieceIndex:pending.index,exitIndex:reference.index,source:'slipstream-custom',scope:POWER_ZONE.scope,
      ...(this.mode==='boost'?{extraSpeed:POWER_ZONE.extraSpeed,remainingMm}:{})};
  }
}
