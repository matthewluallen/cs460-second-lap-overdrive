// Short, replayable rounds. This module scores telemetry; it never commands a car.
// circuitProgress is 0..1 around the mapped loop; circuitDirection is +1 or -1.
export const ROUND_MODES = Object.freeze({
  solo: Object.freeze({title: 'Beat your best', description: 'Find your rhythm. Complete laps and set your best lap time.', durationMs: 90000, minCars: 1}),
  race: Object.freeze({title: 'Lap sprint', description: 'Most complete laps wins. A tie is a shared finish.', durationMs: 120000, minCars: 2}),
  team: Object.freeze({title: 'Crew mission', description: 'Every driver contributes. Complete the shared lap goal together.', durationMs: 120000, minCars: 1}),
  battle: Object.freeze({title: 'Battle rush', description: 'Score 100 points per knockout and 25 per complete lap.', durationMs: 120000, minCars: 2})
});
// Original story briefs. These goals change the shared lap target, never motor limits.
export const STORY_MISSIONS = Object.freeze([
  Object.freeze({id: 'signal-run', title: 'The Signal Run', briefing: 'The circuit has gone quiet. Carry a clean signal around the loop and bring your crew back online.', goalPerCar: 1, durationMs: 90000}),
  Object.freeze({id: 'beacon-network', title: 'Beacon Network', briefing: 'The outpost needs a stronger link. Every completed lap powers the shared beacon. Work together to light it.', goalPerCar: 2, durationMs: 120000}),
  Object.freeze({id: 'dawn-patrol', title: 'Dawn Patrol', briefing: 'Keep the network alive until sunrise. Complete the final delivery together; every driver contributes.', goalPerCar: 3, durationMs: 150000})
]);
const bounded = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const position = row => row.connected && row.located && Number.isFinite(row.circuitProgress) &&
  row.circuitProgress >= 0 && row.circuitProgress < 1 && (row.circuitDirection === 1 || row.circuitDirection === -1);

export class RoundSession {
  constructor() { this.reset(); }
  reset() {
    this.status = 'idle'; this.mode = null; this.roster = new Map(); this.elapsedMs = 0;
    this.durationMs = 0; this.lastAt = null; this.goal = null; this.reason = null;
    return this.view();
  }
  start(mode, snapshot, now, {durationMs, goal} = {}) {
    const config = ROUND_MODES[mode];
    if (!config) throw new Error('Choose a round mode');
    if (!Number.isFinite(now)) throw new Error('Round clock must be finite');
    if (this.status === 'running' || this.status === 'paused') throw new Error('Finish the current round first');
    const drivers = snapshot.filter(row => row.connected && row.control !== 'none');
    if (drivers.length < config.minCars) throw new Error(config.title + ' needs ' + config.minCars + ' active car' + (config.minCars === 1 ? '' : 's'));
    if (drivers.length > 4 || new Set(drivers.map(row => row.id)).size !== drivers.length) throw new Error('A round needs one to four distinct cars');
    this.reset(); this.mode = mode; this.status = 'running'; this.lastAt = now;
    this.durationMs = bounded(durationMs, 10000, 300000, config.durationMs);
    this.goal = mode === 'team' ? Math.round(bounded(goal, 1, 100, drivers.length * 3)) : null;
    for (const row of drivers) this.roster.set(row.id, {
      id: row.id, name: row.name, control: row.control, computer: row.control === 'bot', connected: true,
      laps: 0, hits: 0, losses: 0, score: 0, bestLapMs: null, lastLapMs: null,
      baseKills: count(row.kills), baseDeaths: count(row.deaths), distance: 0,
      previous: position(row) ? row.circuitProgress : null,
      direction: position(row) ? row.circuitDirection : null, lapStarted: 0
    });
    return this.view();
  }
  #clock(now) {
    if (!Number.isFinite(now) || now < this.lastAt) return false;
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + now - this.lastAt);
    this.lastAt = now; return true;
  }
  update(snapshot, now) {
    if (this.status !== 'running' || !this.#clock(now)) return this.view();
    // A delayed browser callback must not award telemetry arriving after the deadline.
    if (this.elapsedMs >= this.durationMs) return this.finish(now, 'time');
    const current = new Map(snapshot.map(row => [row.id, row]));
    for (const racer of this.roster.values()) {
      const row = current.get(racer.id);
      racer.connected = !!row?.connected;
      if (!row) { racer.previous = null; racer.distance = 0; continue; }
      // A model/battle reset never turns negative counters into points.
      const kills = count(row.kills), deaths = count(row.deaths);
      if (kills < racer.baseKills) racer.baseKills = kills;
      if (deaths < racer.baseDeaths) racer.baseDeaths = deaths;
      racer.hits += Math.max(0, kills - racer.baseKills);
      racer.losses += Math.max(0, deaths - racer.baseDeaths);
      racer.baseKills = kills; racer.baseDeaths = deaths;
      if (!position(row)) { racer.previous = null; racer.distance = 0; }
      else {
        if (racer.previous === null || racer.direction !== row.circuitDirection) {
          racer.distance = 0; racer.lapStarted = this.elapsedMs;
        } else {
          let delta = row.circuitProgress - racer.previous;
          if (delta > 0.5) delta -= 1;
          if (delta < -0.5) delta += 1;
          // A large teleport is ambiguous: never treat re-localization as a lap.
          if (Math.abs(delta) > 0.25) { racer.distance = 0; racer.lapStarted = this.elapsedMs; }
          else {
            racer.distance = Math.max(0, racer.distance + delta * racer.direction);
            if (racer.distance >= 1 - 1e-9) {
              racer.laps++; racer.distance = Math.max(0, racer.distance - 1);
              racer.lastLapMs = this.elapsedMs - racer.lapStarted;
              racer.bestLapMs = racer.bestLapMs === null ? racer.lastLapMs : Math.min(racer.bestLapMs, racer.lastLapMs);
              racer.lapStarted = this.elapsedMs;
            }
          }
        }
        racer.previous = row.circuitProgress; racer.direction = row.circuitDirection;
      }
      racer.score = this.mode === 'battle' ? racer.hits * 100 + racer.laps * 25 : racer.laps * 100;
    }
    if (this.mode === 'team' && [...this.roster.values()].reduce((sum, row) => sum + row.laps, 0) >= this.goal) return this.finish(now, 'goal');
    if (![...this.roster.values()].some(row => row.connected)) return this.finish(now, 'disconnected');
    return this.view();
  }
  pause(now) {
    if (this.status === 'running' && this.#clock(now)) {
      if (this.elapsedMs >= this.durationMs) return this.finish(now, 'time');
      this.status = 'paused';
      // Restart incomplete laps after a safety stop; paused motion earns no points.
      for (const row of this.roster.values()) { row.previous = null; row.distance = 0; }
    }
    return this.view();
  }
  resume(now) {
    if (this.status === 'paused' && Number.isFinite(now) && now >= this.lastAt) { this.status = 'running'; this.lastAt = now; }
    return this.view();
  }
  finish(now, reason = 'ended') {
    if (this.status === 'running' || this.status === 'paused') {
      if (this.status === 'running') this.#clock(now);
      this.status = 'finished'; this.reason = reason;
    }
    return this.view();
  }
  view() {
    const rows = [...this.roster.values()].map(({id, name, control, computer, connected, laps, hits, losses, score, bestLapMs, lastLapMs}) =>
      ({id, name, control, computer, connected, laps, hits, losses, score, bestLapMs, lastLapMs}));
    rows.sort((a, b) => this.mode === 'solo'
      ? (a.bestLapMs ?? Infinity) - (b.bestLapMs ?? Infinity) || b.laps - a.laps || a.id - b.id
      : b.score - a.score || a.id - b.id);
    const teamLaps = rows.reduce((sum, row) => sum + row.laps, 0);
    const winnerIds = this.status !== 'finished' || this.reason === 'disconnected' ? [] : this.mode === 'team'
      ? (teamLaps >= this.goal ? rows.map(row => row.id) : [])
      : this.mode === 'solo'
        ? rows.filter(row => row.bestLapMs !== null && row.bestLapMs === rows[0]?.bestLapMs && row.laps === rows[0]?.laps).map(row => row.id)
        : rows.filter(row => row.score > 0 && row.score === rows[0]?.score).map(row => row.id);
    const badges = rows.filter(row => row.laps > 0).map(row => ({id: 'full-lap', driverId: row.id, label: 'First full lap'}));
    if (this.status === 'finished' && this.mode === 'team' && teamLaps >= this.goal) badges.push({id: 'crew-complete', driverId: null, label: 'Crew mission complete'});
    return {status: this.status, mode: this.mode, title: ROUND_MODES[this.mode]?.title ?? 'Choose your next round',
      remainingMs: Math.max(0, this.durationMs - this.elapsedMs), elapsedMs: this.elapsedMs, durationMs: this.durationMs,
      goal: this.goal, teamLaps, progress: this.goal ? Math.min(1, teamLaps / this.goal) : this.durationMs ? this.elapsedMs / this.durationMs : 0,
      rows, winnerIds, badges, reason: this.reason};
  }
}
