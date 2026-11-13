// Battle engine. Weapon and energy numbers come from data/weapons.json and
// data/vehicles.json, which are derived from the original app's items.json and
// vehicleTypes.json. Distances in that data are metres; the track model uses mm.
//
// Effects reach real cars only as speed limits, forced lane changes and lights.
// Everything else (beams, mines, explosions) is drawn on the map.
import {EFFECT, MAX_SPEED} from './protocol.mjs';
import {LANE_STEP} from './car.mjs';
import {LANE_LIMIT, POSITION_MAX_AGE_MS} from './track.mjs';

const CAR_HALF_WIDTH = 0.022;
export const WEAPON_LABEL = Object.freeze({
  continuous_shooting_vehicle_item: 'Machine gun', shooting_vehicle_item: 'Cannon', timed_charge: 'Mine',
  tractor_beam: 'Tractor beam', boost: 'Boost', shield: 'Shield', reverse_drive: 'Reverse drive', horn: 'Horn',
  'e-brake': 'E-brake', scrambler: 'Scrambler', gravity_trap: 'Gravity trap', gravity_trap_rage: 'Gravity rage',
  pulse_ram: 'Pulse ram', pulse_ram_rage: 'Pulse rage'
});
export const ALL_TYPES = Object.freeze(Object.keys(WEAPON_LABEL));
const BEAM_COLOR = {continuous_shooting_vehicle_item: '#ffd34d', shooting_vehicle_item: '#ff7a3d', tractor_beam: '#59c8ff',
  scrambler: '#c77dff', gravity_trap: '#7dffb2', gravity_trap_rage: '#7dffb2', pulse_ram: '#ff4d6d', pulse_ram_rage: '#ff4d6d', horn: '#ffffff'};

// Loadout for a model id: {attack: [...], support: [...], special: [...]} of weapon ids.
export function loadout(vehicles, model) {
  const bays = vehicles.models[String(model)]?.bays;
  if (bays && Object.keys(bays).length) return {attack: bays.attack ?? [], support: bays.support ?? [], special: bays.special ?? []};
  return {attack: ['Gen1MachineGunL01'], support: ['Gen1TractorBeamL01'], special: []};
}

class Fighter {
  constructor(car, bays, maxEnergy) {
    this.car = car; this.bays = bays; this.selected = {attack: 0, support: 0, special: 0};
    this.crew = ''; this.participating = true; this.assists = 0; this.contributors = new Map();
    this.energy = maxEnergy; this.held = {attack: false, support: false, special: false};
    this.was = {attack: false, support: false, special: false};
    this.ready = {}; this.charge = {}; this.kills = 0; this.deaths = 0; this.disabledUntil = 0;
    this.shield = 0; this.slow = new Map(); this.boostUntil = 0; this.boost = 0; this.rageUntil = 0;
    this.wiggleUntil = 0; this.wiggleNext = 0; this.hitUntil = 0; this.firingUntil = 0; this.braking = false;
  }
  item(bay) { const ids = this.bays[bay] ?? []; return ids.length ? ids[this.selected[bay] % ids.length] : null; }
}

export class Battle {
  constructor({weapons, vehicles, track, clock = () => performance.now()}) {
    this.weapons = weapons; this.vehicles = vehicles; this.track = track; this.clock = clock;
    this.config = vehicles.energy; this.fighters = new Map(); this.mines = []; this.events = []; this.active = false; this.pausedAt = null;
  }
  add(car, bays = loadout(this.vehicles, car.model)) {
    const fighter = new Fighter(car, bays, this.config.max_energy);
    this.fighters.set(car, fighter); return fighter;
  }
  remove(car) {
    const fighter = this.fighters.get(car);
    this.fighters.delete(car); this.mines = this.mines.filter(m => m.owner !== fighter);
    for (const f of this.fighters.values()) { f.contributors.delete(fighter); f.slow.delete(fighter); }
  }
  allies(a, b) { return !!a?.crew && a.crew === b?.crew; }
  get(car) { return this.fighters.get(car); }
  press(car, bay, down) { if (this.pausedAt !== null) return; const f = this.fighters.get(car); if (f) f.held[bay] = !!down; }
  cycle(car, bay) { if (this.pausedAt !== null) return; const f = this.fighters.get(car); if (f && (f.bays[bay]?.length ?? 0) > 1) { f.selected[bay]++; f.charge[bay] = 0; } }
  #event(e) { this.events.push({...e, at: this.clock()}); if (this.events.length > 200) this.events.shift(); }
  drain() { const e = this.events; this.events = []; return e; }

  // Where a car is, as map distance and map lateral, plus its travel direction.
  #spot(car, now) {
    const e = car.localizer?.estimate(now);
    if (!e || !e.located) return null;
    return {distance: this.track.distance(e.index, e.progress, e.direction), lateral: e.direction * e.lateral, direction: e.direction};
  }
  // Gap in metres from a to b along a's direction of travel (+ ahead), and lateral difference.
  #relative(a, b) {
    const L = this.track.length;
    let gap = (b.distance - a.distance) % L;
    if (gap > L / 2) gap -= L; if (gap < -L / 2) gap += L;
    return {gap: a.direction * gap / 1000, side: a.direction * (b.lateral - a.lateral) / 1000};
  }
  #inRange(targeter, rel) {
    const {gap, side} = rel, wide = Math.abs(side) - CAR_HALF_WIDTH;
    switch (targeter?.type) {
      case 'rectangle': {
        const length = targeter.length ?? 1, shifted = gap - (targeter.offset ?? 0);
        const along = length >= 0 ? shifted > 0 && shifted <= length : shifted < 0 && shifted >= length;
        return along && wide <= (targeter.half_width ?? 0.1);
      }
      case 'cone': {
        // Signed length chooses front/rear, relative to the source's travel.
        // Preserve the existing angular width model; trailer anchors are a
        // separate, still-unverified geometry feature.
        const length = targeter.length ?? 1;
        const along = length < 0 ? -gap : gap;
        return along > 0 && along <= Math.abs(length) && wide <= along * Math.tan((targeter.theta ?? 0.3) / 2) + 0.02;
      }
      case 'forward_track_distance':
        return gap >= (targeter.min_distance ?? 0.01) && gap <= (targeter.max_distance ?? 1) &&
          (targeter.half_width === undefined || wide <= targeter.half_width);
      case 'proximity': return Math.hypot(gap, side) <= (targeter.radius ?? 0.2) + CAR_HALF_WIDTH;
      default: return false;
    }
  }
  // Cars this weapon can hit right now, nearest first.
  targets(fighter, weapon, spots) {
    const me = spots.get(fighter);
    if (!fighter.participating || !fighter.car.connected || !me || !weapon.targeter || weapon.targeter.type === 'self') return [];
    const hits = [];
    for (const [other, spot] of spots) {
      if (other === fighter || !other.participating || !other.car.connected || this.allies(fighter, other) || !spot || other.disabledUntil > this.clock()) continue;
      const rel = this.#relative(me, spot);
      if (this.#inRange(weapon.targeter, rel)) hits.push({fighter: other, distance: Math.hypot(rel.gap, rel.side)});
    }
    hits.sort((a, b) => a.distance - b.distance);
    return weapon.targeter.single_target ? hits.slice(0, 1) : hits;
  }
  associations(car, now = this.clock()) {
    const f = this.get(car), w = f && this.weapons[f.item('attack')];
    if (!f || !w || !this.active || this.pausedAt !== null) return [];
    const spots = new Map([...this.fighters.values()].map(other => [other, other.car.connected ? this.#spot(other.car, now) : null]));
    return this.targets(f, w, spots).map(hit => hit.fighter.car);
  }
  damage(target, amount, source, now, kind = 'hit') {
    if (this.pausedAt !== null) return;
    if (!target.participating || !target.car.connected || (source && (!source.participating || !source.car.connected || this.allies(source, target))) || target.disabledUntil > now || amount <= 0) return;
    if (target.shield > 0) { amount *= 1 - target.shield; this.#event({type: 'blocked', car: target.car}); }
    if (amount <= 0) return;
    if (source && source !== target) target.contributors.set(source, now);
    target.energy -= amount; target.hitUntil = now + 350;
    this.#event({type: kind, car: target.car, by: source?.car, amount});
    if (target.energy <= 0) {
      target.energy = 0; target.deaths++; target.disabledUntil = now + this.config.recover_time_s * 1000 + 800;
      target.held = {attack: false, support: false, special: false}; target.slow.clear(); target.boostUntil = 0;
      if (source && source !== target) {
        source.kills++;
        for (const [helper, at] of target.contributors) if (helper !== source && now - at <= 3000 && helper.participating && this.fighters.get(helper.car) === helper && this.allies(helper, source)) {
          helper.assists++; this.#event({type: 'assist', car: helper.car, by: source.car, target: target.car});
        }
      }
      target.contributors.clear();
      this.#event({type: 'disabled', car: target.car, by: source?.car});
    }
  }
  #spend(fighter, amount) { if (fighter.energy < amount) return false; fighter.energy -= amount; return true; }

  update(dt, now = this.clock()) {
    if (!this.active || this.pausedAt !== null) return;
    const spots = new Map();
    for (const f of this.fighters.values()) spots.set(f, f.car.connected ? this.#spot(f.car, now) : null);
    // Resolve every held shield before any attack, independent of join order.
    for (const f of this.fighters.values()) {
      f.shield = 0;
      if (!f.participating || !f.car.connected || f.disabledUntil > now) continue;
      for (const bay of ['attack', 'support', 'special']) {
        const w = this.weapons[f.item(bay)];
        if (w?.type === 'shield') this.#use(f, bay, w, dt, now, spots);
      }
    }
    for (const f of this.fighters.values()) {
      if (!f.participating || !f.car.connected) continue;
      f.braking = false; for (const [key, s] of f.slow) if (s.until <= now) f.slow.delete(key);
      if (f.disabledUntil > now) continue;
      if (f.disabledUntil && f.disabledUntil <= now) { f.disabledUntil = 0; f.energy = this.config.max_energy; this.#event({type: 'recovered', car: f.car}); }
      let using = false;
      for (const bay of ['attack', 'support', 'special']) {
        const id = f.item(bay), weapon = id && this.weapons[id];
        if (weapon?.type === 'shield') using = f.shield > 0 || using;
        else if (weapon) using = this.#use(f, bay, weapon, dt, now, spots) || using;
        f.was[bay] = f.held[bay];
      }
      if (!using) f.energy = Math.min(this.config.max_energy, f.energy + this.config.energy_recharge_rate * dt);
      if (f.rageUntil > now) for (const t of this.targets(f, {targeter: {type: 'proximity', radius: 0.18}}, spots)) this.damage(t.fighter, 99, f, now, 'ram');
      if (f.wiggleUntil > now && now >= f.wiggleNext) { f.wiggleNext = now + 600; f.car.nudge(Math.random() < 0.5 ? 2 : -2); }
    }
    this.#mines(now, spots);
    for (const f of this.fighters.values()) this.#lights(f, now);
  }
  // Returns true while the item is consuming energy (pauses recharge).
  #use(f, bay, w, dt, now, spots) {
    const held = f.held[bay], pressed = held && !f.was[bay], released = !held && f.was[bay];
    const ready = (f.ready[bay] ?? 0) <= now, start = this.config.min_energy_to_start_item;
    const hold = cost => held && (f.was[bay] ? f.energy > 0.05 : f.energy >= start) && this.#spend(f, cost * dt);
    const fire = (targets, type) => { f.firingUntil = now + 200; for (const t of targets) this.#event({type: 'beam', from: f.car, to: t.fighter.car, color: BEAM_COLOR[type] ?? '#fff'}); };
    switch (w.type) {
      case 'continuous_shooting_vehicle_item': {
        if (!hold(w.energy_use_per_s ?? 2)) return false;
        const targets = this.targets(f, w, spots); fire(targets, w.type);
        if (!targets.length) this.#event({type: 'tracer', from: f.car, color: BEAM_COLOR[w.type], length: w.targeter?.length ?? 1});
        for (const t of targets) this.damage(t.fighter, (w.damage_per_target_per_s ?? 3) * dt, f, now);
        return true;
      }
      case 'shooting_vehicle_item': {
        if (w.interaction_style === 'charge') {
          const limit = w.cooldown_data?.charge_limit_s ?? 3;
          if (held && ready && f.energy > 0.05) {
            f.charge[bay] = Math.min(limit, (f.charge[bay] ?? 0) + dt);
            this.#spend(f, (w.energy_use_in_charge_mode_per_s ?? 2) * dt); return true;
          }
          if ((released || (held && f.energy <= 0.05)) && (f.charge[bay] ?? 0) > 0.15) {
            const charge = f.charge[bay]; f.charge[bay] = 0; this.#blast(f, w, (w.damage_per_target_per_second_charged ?? 3) * charge, now, spots);
            const c = w.cooldown_data ?? {}; f.ready[bay] = now + 1000 * ((c.cooldown_time_min_s ?? 0.5) + ((c.cooldown_time_max_s ?? 2) - (c.cooldown_time_min_s ?? 0.5)) * charge / limit);
          } else if (!held) f.charge[bay] = 0;
          return false;
        }
        if (pressed && ready && this.#spend(f, w.base_energy_cost ?? 1)) {
          this.#blast(f, w, w.damage_per_target ?? 3, now, spots);
          f.ready[bay] = now + 1000 * Math.max(w.recharge_time_s ?? 0, w.cooldown_data?.recharge_time_s ?? 0.5);
        }
        return false;
      }
      case 'timed_charge': {
        if (pressed && ready && this.#spend(f, w.base_energy_cost ?? 2)) {
          const me = spots.get(f);
          if (me) {
            this.mines.push({owner: f, distance: me.distance, lateral: me.lateral, armedAt: now + 600, weapon: w, expires: now + 30000});
            this.#event({type: 'mine', from: f.car});
          }
          f.ready[bay] = now + 1000 * (w.cooldown_data?.cooldown_time_min_s ?? 3);
        }
        return false;
      }
      case 'tractor_beam': {
        if (!hold(w.energy_use_per_s ?? 2.5)) return false;
        const targets = this.targets(f, w, spots); fire(targets, w.type);
        for (const t of targets) t.fighter.slow.set(f, {until: now + 250, factor: w.tractor_beam_ratio ?? 0.42});
        return true;
      }
      case 'boost': {
        if (!hold(w.energy_use_per_s ?? 5)) return false;
        f.boostUntil = now + 200; f.boost = (w.boost_speed_addition ?? 1) * 1000; return true;
      }
      case 'shield': {
        if (!hold(w.energy_use_per_s ?? 1.5)) return false;
        f.shield = w.shield_blocked_damage_percent ?? 1; return true;
      }
      case 'e-brake': {
        if (!hold(w.energy_use_per_s ?? 2)) return false;
        f.braking = true; return true;
      }
      case 'reverse_drive': {
        if (pressed && ready && this.#spend(f, w.base_energy_cost ?? 2)) { f.car.uturn(); f.ready[bay] = now + 2500; this.#event({type: 'uturn', car: f.car}); }
        return false;
      }
      case 'horn': {
        if (pressed && ready && this.#spend(f, w.base_energy_cost ?? 4)) {
          const script = w.scripts?.[0] ?? {}, targets = this.targets(f, w, spots); fire(targets, w.type);
          this.#event({type: 'horn', from: f.car});
          for (const t of targets) {
            t.fighter.slow.set('horn', {until: now + 1000 * (script.disabled_duration_s ?? 1.5), cap: (script.disabled_speed_max ?? 0.8) * 1000});
            const lanes = Math.ceil((script.min_lanes_to_change ?? 4) * 9 / LANE_STEP);
            t.fighter.car.nudge(t.fighter.car.targetLateral > 0 ? -lanes : lanes);
          }
          f.ready[bay] = now + 1000 * (targets.length ? w.recharge_time_s ?? 3 : w.recharge_time_no_target_s ?? 3);
        }
        return false;
      }
      case 'scrambler': {
        if (!hold(w.energy_use_per_s ?? 2)) return false;
        const targets = this.targets(f, w, spots); fire(targets, w.type);
        for (const t of targets) {
          this.damage(t.fighter, (w.script_config?.damage_per_target_per_s ?? 4) * dt, f, now);
          t.fighter.wiggleUntil = now + 600;
        }
        return true;
      }
      case 'gravity_trap': {
        if (pressed && ready && this.#spend(f, w.base_energy_cost ?? 1)) {
          const targets = this.targets(f, w, spots); fire(targets, w.type);
          for (const t of targets) t.fighter.slow.set('gravity', {until: now + 1000 * (w.max_use_time_s ?? 5), factor: 0.25});
          f.ready[bay] = now + 1000 * (w.recharge_time_s ?? 5);
        }
        return false;
      }
      case 'pulse_ram': {
        if (pressed && ready && this.#spend(f, w.base_energy_cost ?? 6)) {
          const targets = this.targets(f, w, spots); fire(targets, w.type);
          this.#event({type: 'pulse', from: f.car});
          for (const t of targets) this.damage(t.fighter, w.damage_per_target ?? 99, f, now, 'ram');
          f.ready[bay] = now + 1000 * (w.recharge_time_s ?? 3);
        }
        return false;
      }
      case 'gravity_trap_rage': case 'pulse_ram_rage': {
        // Rage: needs a full energy bar, then a speed surge during which contact disables.
        if (pressed && ready && f.energy >= this.config.max_energy - 0.01) {
          const c = w.rage_script_config ?? {};
          f.energy = this.config.max_energy / 2; f.rageUntil = now + 6000;
          f.boostUntil = f.rageUntil; f.boost = (c.lcv_boost_speed ?? 0.35) * 1000;
          f.ready[bay] = now + 1000 * (c.lcv_boost_time ?? 15);
          this.#event({type: 'rage', from: f.car});
        }
        return false;
      }
    }
    return false;
  }
  #blast(f, w, amount, now, spots) {
    const targets = this.targets(f, w, spots), reach = w.targeter?.radius ?? w.targeter?.length ?? 1;
    f.firingUntil = now + 300;
    this.#event({type: w.targeter?.type === 'proximity' ? 'burst' : 'shot', from: f.car, color: BEAM_COLOR[w.type], length: reach, radius: w.targeter?.radius});
    for (const t of targets) {
      const falloff = w.damage_multiplier_at_max_distance === undefined ? 1 : 1 - (1 - w.damage_multiplier_at_max_distance) * Math.min(1, t.distance / reach);
      this.#event({type: 'beam', from: f.car, to: t.fighter.car, color: BEAM_COLOR[w.type]});
      this.damage(t.fighter, amount * falloff, f, now);
    }
  }
  #mines(now, spots) {
    const L = this.track.length;
    this.mines = this.mines.filter(mine => {
      if (now > mine.expires) return false;
      if (now < mine.armedAt) return true;
      const radius = mine.weapon.targeter?.radius ?? 0.15;
      let hit = false;
      for (const [f, spot] of spots) {
        if (!spot || f === mine.owner || !f.participating || this.allies(f, mine.owner) || f.disabledUntil > now) continue;
        let gap = Math.abs(spot.distance - mine.distance) % L; gap = Math.min(gap, L - gap);
        const distance = Math.hypot(gap / 1000, (spot.lateral - mine.lateral) / 1000);
        if (distance > radius + CAR_HALF_WIDTH) continue;
        const far = mine.weapon.damage_multiplier_at_max_distance ?? 1;
        this.damage(f, (mine.weapon.damage_per_target ?? 5) * (1 - (1 - far) * Math.min(1, distance / radius)), mine.owner, now, 'explosion');
        hit = true;
      }
      if (hit) this.#event({type: 'explosion', distance: mine.distance, lateral: mine.lateral});
      return !hit;
    });
  }
  // What the driver asked for, after every active effect. Returns {speed, accel}.
  limit(car, wanted, now = this.clock()) {
    if (this.pausedAt !== null) return {speed: 0, accel: 2500};
    const f = this.fighters.get(car);
    if (!f || !this.active) return {speed: wanted, accel: 1000};
    if (f.disabledUntil > now) return {speed: 0, accel: 2500};
    if (f.braking) return {speed: 0, accel: 5000};
    let speed = wanted;
    if (f.boostUntil > now && wanted > 0) speed = wanted + f.boost;
    for (const s of f.slow.values()) { if (s.factor !== undefined) speed *= s.factor; if (s.cap !== undefined) speed = Math.min(speed, s.cap); }
    return {speed, accel: f.boostUntil > now ? 2000 : 1000};
  }
  #lights(f, now) {
    const car = f.car, [r, g, b] = car.color;
    if (f.disabledUntil > now) car.setLights(1, 0, 0, EFFECT.FLASH, 40);
    else if (f.hitUntil > now) car.setLights(1, 0, 0, EFFECT.THROB, 60);
    else if (f.shield > 0) car.setLights(0, 0.3, 1, EFFECT.THROB, 30);
    else if (f.rageUntil > now) car.setLights(1, 0, 1, EFFECT.FLASH, 60);
    else if (f.firingUntil > now) car.setLights(1, 1, 1, EFFECT.FLASH, 80);
    else if (f.boostUntil > now) car.setLights(1, 0.6, 0);
    else {
      // Health colour bands from the app: red below a third, amber below two thirds.
      const health = f.energy / this.config.max_energy;
      if (health < 0.33) car.setLights(1, 0, 0); else car.setLights(r, g, b);
    }
  }
  // Freeze battle time during shared physical recovery. Releasing a weapon at
  // the pit must never release a previously charged shot when play resumes.
  time(now = this.clock()) { return this.pausedAt ?? now; }
  pause(now = this.clock()) {
    if (!this.active || this.pausedAt !== null) return;
    this.pausedAt = now; this.events = [];
    for (const f of this.fighters.values()) {
      f.held = {attack: false, support: false, special: false};
      f.was = {attack: false, support: false, special: false}; f.charge = {};
      f.shield = 0; f.braking = false;
    }
  }
  resume(now = this.clock()) {
    if (this.pausedAt === null) return 0;
    const elapsed = Math.max(0, now - this.pausedAt);
    const deadlines = ['disabledUntil', 'boostUntil', 'rageUntil', 'wiggleUntil', 'wiggleNext', 'hitUntil', 'firingUntil'];
    for (const f of this.fighters.values()) {
      for (const field of deadlines) if (f[field] > 0) f[field] += elapsed;
      for (const bay of Object.keys(f.ready)) if (f.ready[bay] > 0) f.ready[bay] += elapsed;
      for (const effect of f.slow.values()) effect.until += elapsed;
      for (const [helper, at] of f.contributors) f.contributors.set(helper, at + elapsed);
    }
    for (const mine of this.mines) { mine.armedAt += elapsed; mine.expires += elapsed; }
    this.pausedAt = null;
    return elapsed;
  }
  start() {
    this.active = true; this.pausedAt = null; this.mines = []; this.events = [];
    for (const f of this.fighters.values()) {
      f.energy = this.config.max_energy; f.kills = f.deaths = f.assists = 0; f.contributors.clear(); f.slow.clear(); f.ready = {}; f.charge = {};
      f.held = {attack: false, support: false, special: false}; f.was = {...f.held}; f.shield = 0; f.braking = false;
      for (const key of ['disabledUntil', 'boostUntil', 'rageUntil', 'wiggleUntil', 'wiggleNext', 'hitUntil', 'firingUntil']) f[key] = 0;
    }
  }
  stop() {
    this.active = false; this.pausedAt = null; this.mines = []; this.events = [];
    for (const f of this.fighters.values()) { f.held = {attack: false, support: false, special: false}; f.was = {...f.held}; f.charge = {}; f.car.setLights(...f.car.color); }
  }
  scores() { return [...this.fighters.values()].map(f => ({name: f.car.name, kills: f.kills, deaths: f.deaths, laps: f.car.localizer?.laps ?? 0})).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths); }
}

// A simple computer driver: cruise, line up on the nearest car ahead, shoot when it can.
export class Bot {
  constructor(car, battle, {skill = 0.7} = {}) { this.car = car; this.battle = battle; this.skill = skill; this.nextLane = 0; this.cruise = 0.55 + Math.random() * 0.2; this.mineAt = 0; }
  // Slipstream CPU policy, not a reconstruction of the native app's planner.
  // Require a fresh printed-code match on this exact piece; a transition-only
  // prediction must not authorize automatic lateral movement.
  #trackGeometry(now) {
    const car=this.car, localizer=car.localizer, estimate=localizer?.estimate(now);
    const piece=estimate?.located ? this.battle.track?.pieces[estimate.index] : null;
    const definition=piece ? car.pieces?.get(piece.id) : null;
    const positionAt=car.telemetry?.lastPositionAt;
    const fresh=Number.isFinite(positionAt) && now>=positionAt && now-positionAt<=POSITION_MAX_AGE_MS && (car.motionSince===undefined || positionAt>=car.motionSince);
    const ordinaryStraight=!!(fresh && localizer?.seenCode && localizer.lastId===piece?.id && definition?.kind==='straight' && !definition.unverified && !piece.inferred && !piece.unverified && Number.isFinite(estimate.progress) && estimate.progress>=0 && estimate.progress<=1 && Number.isFinite(piece.length) && piece.length>0);
    const remaining=ordinaryStraight ? (1-estimate.progress)*piece.length : 0;
    const safeLane=ordinaryStraight && remaining>=250 && Number.isFinite(localizer.speed) && localizer.speed>0 && Number.isFinite(estimate.lateral) && Math.abs(estimate.lateral)<=LANE_LIMIT;
    const encounter=safeLane ? estimate.index+':'+estimate.direction+':'+localizer.laps : null;
    return {ordinaryStraight,remaining,safeLane,encounter,estimate,positionAt};
  }
  applyTrackPolicy(now, input, {objective=false} = {}) {
    const {ordinaryStraight,remaining,safeLane,encounter,estimate,positionAt}=this.#trackGeometry(now);
    const ceiling=ordinaryStraight && remaining>=150 ? 1 : 2/3;
    const active=!!this.battle.active || objective;
    input.throttle=active ? Math.min(Math.max(0,Number.isFinite(input.throttle)?input.throttle:0),ceiling) : ceiling;
    const intent=input.lane;
    this.trackLaneCandidate=null;
    input.lane=null; // No stale retry when localization or safe geometry disappears.
    if (!safeLane) return ceiling;
    if (encounter===this.trackLaneEncounter) return ceiling;
    if (active) {
      if (!Number.isFinite(intent) || Math.abs(intent)>LANE_LIMIT) return ceiling;
      input.lane=intent;
    } else {
      const target=this.freeLaneTarget===undefined ? (estimate.lateral>=0 ? -LANE_STEP : LANE_STEP) : -this.freeLaneTarget;
      input.lane=target;
    }
    this.trackLaneCandidate={at:now,positionAt,encounter,target:input.lane,free:!active};
    return ceiling;
  }
  // A geometry candidate is not a dispatched maneuver. Wait until the speed
  // command has a matching report and a later optical observation. This avoids
  // sending acceleration and steering in the same pump tick; it does not claim
  // firmware/native-planner equivalence or a physically completed lane change.
  confirmTrackLane(now,input,finalSpeed,finalAccel=this.car.lastAccel) {
    const candidate=this.trackLaneCandidate, car=this.car;
    const speed=Math.max(0,Math.min(MAX_SPEED,Math.round(finalSpeed)));
    const command=car.telemetry?.speedCommand, report=car.telemetry?.speedReport;
    const location=this.#trackGeometry(now);
    const ready=candidate && candidate.at===now && input.lane===candidate.target &&
      location.safeLane && location.encounter===candidate.encounter && location.positionAt===candidate.positionAt &&
      speed>0 && car.speed===speed && car.lastAccel===finalAccel && command?.speed===speed && command.accel===finalAccel && Number.isFinite(command.at) &&
      report?.desired===speed && report.accel===finalAccel && Number.isFinite(report.at) && report.at>=command.at &&
      report.at>=(car.motionSince??-Infinity) && now>=report.at &&
      location.positionAt>report.at && car.localizer.speed>=Math.min(speed,300);
    if (!ready) { input.lane=null; return false; }
    this.trackLaneEncounter=candidate.encounter;
    if (candidate.free) this.freeLaneTarget=candidate.target;
    this.trackLaneCandidate=null;
    return true;
  }
  drive(now, input, spots) {
    input.throttle = this.cruise;
    const f = this.battle.get(this.car);
    if (!f || !this.battle.active) { if (now > this.nextLane) { this.nextLane = now + 3000 + Math.random() * 4000; input.lane = (Math.floor(Math.random() * 7) - 3) * LANE_STEP; } return; }
    const me = this.car.localizer?.estimate(now);
    let ahead = null, behind = null;
    for (const other of this.battle.fighters.values()) {
      if (other === f || !other.participating || this.battle.allies(f, other) || other.disabledUntil > now) continue;
      const rel = this.battle.relativeCars?.(this.car, other.car, now);
      if (!rel) continue;
      if (rel.gap > 0 && (!ahead || rel.gap < ahead.gap)) ahead = {...rel, other};
      if (rel.gap < 0 && (!behind || rel.gap > behind.gap)) behind = {...rel, other};
    }
    const attack = this.battle.weapons[f.item('attack')], support = this.battle.weapons[f.item('support')];
    const reach = attack?.targeter?.length ?? attack?.targeter?.max_distance ?? attack?.targeter?.radius ?? 0.8;
    input.attack = false; input.support = false; input.special = false;
    if (ahead && me) {
      if (ahead.gap < reach * 1.6) input.lane = (me.lateral + ahead.side * 1000);
      const charging = attack?.interaction_style === 'charge';
      if (ahead.gap < reach && Math.abs(ahead.side) < 0.09 && f.energy > 2) input.attack = charging ? (f.charge.attack ?? 0) < 1.2 : Math.random() < this.skill;
      input.throttle = ahead.gap > reach ? Math.min(1, this.cruise + 0.25) : this.cruise;
      if (support?.type === 'tractor_beam' && ahead.gap > reach && ahead.gap < (support.targeter?.max_distance ?? 2) && f.energy > 5) input.support = true;
      if (support?.type === 'boost' && ahead.gap > reach * 1.5 && f.energy > 6) input.support = true;
    } else if (now > this.nextLane) { this.nextLane = now + 2500 + Math.random() * 3000; input.lane = (Math.floor(Math.random() * 7) - 3) * LANE_STEP; }
    if (support?.type === 'shield' && f.hitUntil > now && f.energy > 1) input.support = true;
    if (behind && behind.gap > -0.5) {
      if (attack?.type === 'timed_charge' && now > this.mineAt) { input.attack = !f.was.attack; this.mineAt = now + 400; }
      if (support?.type === 'gravity_trap') input.support = !f.was.support;
    }
    if (f.energy >= this.battle.config.max_energy - 0.01 && ahead && ahead.gap < 0.6) input.special = !f.was.special;
  }
}
Battle.prototype.relativeCars = function (a, b, now) {
  const spot = car => { const e = car.localizer?.estimate(now); return e && e.located ? {distance: this.track.distance(e.index, e.progress, e.direction), lateral: e.direction * e.lateral, direction: e.direction} : null; };
  const sa = spot(a), sb = spot(b);
  if (!sa || !sb) return null;
  const L = this.track.length; let gap = (sb.distance - sa.distance) % L;
  if (gap > L / 2) gap -= L; if (gap < -L / 2) gap += L;
  return {gap: sa.direction * gap / 1000, side: sa.direction * (sb.lateral - sa.lateral) / 1000};
};
