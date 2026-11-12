// Short, replayable rounds. This module scores telemetry; it never commands a car.
// circuitProgress is 0..1 around the mapped loop; circuitDirection is +1 or -1.
export const ROUND_MODES = Object.freeze({
  solo: Object.freeze({title: 'Beat your best', description: 'Find your rhythm. Complete laps and set your best lap time.', durationMs: 90000, minCars: 1}),
  precision: Object.freeze({title: 'Precision run', description: 'Match each gate’s lane and speed band. Deliberate driving earns points; full throttle does not.', durationMs: 90000, minCars: 1}),
  race: Object.freeze({title: 'Lap sprint', description: 'Most complete laps wins. A tie is a shared finish.', durationMs: 120000, minCars: 2}),
  team: Object.freeze({title: 'Crew mission', description: 'Every driver contributes. Complete the shared lap goal together.', durationMs: 120000, minCars: 1}),
  battle: Object.freeze({title: 'Battle rush', description: 'Score 100 points per knockout and 25 per crew assist or complete lap.', durationMs: 120000, minCars: 2})
});
// Original story briefs. Every driver scans, carries and delivers their own packets.
// Goals never grant higher motor limits.
export const STORY_MISSIONS = Object.freeze([
  Object.freeze({id: 'signal-run', title: 'The Signal Run', briefing: 'The circuit has gone quiet. Scan a signal, carry it steadily, then deliver at the dock. Every driver restores one link.', goalPerCar: 1, durationMs: 90000}),
  Object.freeze({id: 'beacon-network', title: 'Beacon Network', briefing: 'The outpost needs a stronger link. Each driver must scan, carry and deliver two packets. Work together to light the beacon.', goalPerCar: 2, durationMs: 120000}),
  Object.freeze({id: 'dawn-patrol', title: 'Dawn Patrol', briefing: 'Keep the network alive until sunrise. Each driver completes three scan-and-deliver runs. No crew member can be left behind.', goalPerCar: 3, durationMs: 150000})
]);
const bounded = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const position = row => row.connected && row.located && Number.isFinite(row.circuitProgress) &&
  row.circuitProgress >= 0 && row.circuitProgress < 1 && (row.circuitDirection === 1 || row.circuitDirection === -1);

const GATES = Object.freeze([0.125, 0.375, 0.625, 0.875]);
const GATE_LANES = Object.freeze([-45, 0, 45, 0]);
const wrap = value => ((value % 1) + 1) % 1;
const near = (a, b, radius) => Math.min(wrap(a - b), wrap(b - a)) <= radius;
const crossed = (previous, progress, direction, target, movement) => {
  if (previous === null || movement === null || movement <= 0) return false;
  const ahead = wrap((target - previous) * direction);
  return ahead > 1e-8 && ahead <= movement + 1e-8;
};

export class RoundSession {
  constructor() { this.reset(); }
  reset() {
    this.status = 'idle'; this.mode = null; this.roster = new Map(); this.elapsedMs = 0;
    this.durationMs = 0; this.lastAt = null; this.goal = null; this.reason = null; this.mission = null;
    return this.view();
  }
  start(mode, snapshot, now, {durationMs, goal, mission, speedLimit} = {}) {
    const config = ROUND_MODES[mode];
    if (!config) throw new Error('Choose a round mode');
    if (!Number.isFinite(now)) throw new Error('Round clock must be finite');
    if (this.status === 'running' || this.status === 'paused') throw new Error('Finish the current round first');
    const drivers = snapshot.filter(row => row.connected && row.control !== 'none');
    if (drivers.length < config.minCars) throw new Error(config.title + ' needs ' + config.minCars + ' active car' + (config.minCars === 1 ? '' : 's'));
    if (drivers.length > 4 || new Set(drivers.map(row => row.id)).size !== drivers.length) throw new Error('A round needs one to four distinct cars');
    const story = mission === undefined || mission === null ? null : STORY_MISSIONS.find(item => item.id === (typeof mission === 'string' ? mission : mission.id));
    if (mission != null && (!story || mode !== 'team')) throw new Error('Choose a valid crew mission');
    this.reset(); this.mission = story; this.mode = mode; this.status = 'running'; this.lastAt = now;
    this.durationMs = bounded(durationMs, 10000, 300000, story?.durationMs ?? config.durationMs);
    this.goal = story ? drivers.length * story.goalPerCar * 3 : mode === 'team' ? Math.round(bounded(goal, 1, 100, drivers.length * 3)) : null;
    for (const row of drivers) this.roster.set(row.id, {
      id: row.id, name: row.name, control: row.control, computer: row.control === 'bot', connected: true,
      laps: 0, hits: 0, assists: 0, losses: 0, score: 0, bestLapMs: null, lastLapMs: null,
      baseAssists: count(row.assists), baseKills: count(row.kills), baseDeaths: count(row.deaths), distance: 0,
      previous: position(row) ? row.circuitProgress : null,
      direction: position(row) ? row.circuitDirection : null, lapStarted: 0,
      speedLimit: bounded(speedLimit ?? row.speedCeiling, 100, 1400, 700), gateIndex: null,
      gates: 0, misses: 0, taskPoints: 0, taskPhase: 'scan', tasksCompleted: 0,
      deliveries: 0, scanMs: 0, carryDistance: 0
    });
    return this.view();
  }
  #clock(now) {
    if (!Number.isFinite(now) || now < this.lastAt) return false;
    this.elapsedMs = Math.min(this.durationMs, this.elapsedMs + now - this.lastAt);
    this.lastAt = now; return true;
  }
  update(snapshot, now) {
    const priorAt = this.lastAt;
    if (this.status !== 'running' || !this.#clock(now)) return this.view();
    // A delayed browser callback must not award telemetry arriving after the deadline.
    if (this.elapsedMs >= this.durationMs) return this.finish(now, 'time');
    const dt = Math.max(0, now - priorAt);
    const current = new Map(snapshot.map(row => [row.id, row]));
    for (const racer of this.roster.values()) {
      const row = current.get(racer.id);
      racer.connected = !!row?.connected;
      if (!row) { racer.previous = null; racer.distance = 0; racer.scanMs = 0; racer.carryDistance = 0; continue; }
      const previous = racer.previous, previousDirection = racer.direction;
      let movement = null;
      // A model/battle reset never turns negative counters into points.
      const kills = count(row.kills), deaths = count(row.deaths), assists = count(row.assists);
      if (assists < racer.baseAssists) racer.baseAssists = assists;
      racer.assists += Math.max(0, assists - racer.baseAssists); racer.baseAssists = assists;
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
            movement = delta * racer.direction;
            racer.distance = Math.max(0, racer.distance + movement);
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
      if (this.mode === 'precision' || this.mission) this.#tasks(racer, row, previous, movement, dt, previousDirection);
      racer.score = this.mode === 'precision' || this.mission ? racer.taskPoints : this.mode === 'battle' ? racer.hits * 100 + (racer.laps + racer.assists) * 25 : racer.laps * 100;
    }
    if (this.mode === 'team' && (this.mission ? [...this.roster.values()].every(row => row.taskPhase === 'complete') : [...this.roster.values()].reduce((sum, row) => sum + row.laps, 0) >= this.goal)) return this.finish(now, 'goal');
    if (![...this.roster.values()].some(row => row.connected)) return this.finish(now, 'disconnected');
    return this.view();
  }
  #task(racer) {
    if (this.mode === 'precision') {
      const index = racer.gateIndex ?? 0, slow = index % 2 === 0;
      const minSpeed = racer.speedLimit * (slow ? 0.15 : 0.3), maxSpeed = racer.speedLimit * (slow ? 0.35 : 0.55);
      const targetLane = GATE_LANES[index], lane = targetLane < 0 ? 'right' : targetLane > 0 ? 'left' : 'center';
      return {phase: 'precision', label: 'Gate ' + (index + 1), cue: 'Gate ' + (index + 1) + ': ' + lane + ' lane, ' + Math.round(minSpeed) + '–' + Math.round(maxSpeed) + ' mm/s',
        targetLane, targetSpeedRatio: slow ? 0.25 : 0.425, minSpeed, maxSpeed, gateProgress: GATES[index], completed: racer.gates, total: null};
    }
    if (!this.mission) return null;
    const phase = racer.taskPhase, targetLane = phase === 'carry' ? (racer.deliveries % 2 ? 45 : -45) : 0;
    const minSpeed = racer.speedLimit * 0.1, maxSpeed = racer.speedLimit * (phase === 'carry' ? 0.6 : 0.45);
    const speedCue = Math.round(minSpeed) + '–' + Math.round(maxSpeed) + ' mm/s';
    const cue = phase === 'complete' ? 'Delivery complete. Wait for your crew.' : phase === 'scan'
      ? 'Scan: center lane, ' + speedCue + ', through the beacon at 12% of the circuit.' : phase === 'carry'
        ? 'Carry: ' + (targetLane < 0 ? 'right' : 'left') + ' lane, ' + speedCue + ', steady for 35% of the circuit.'
        : 'Deliver: center lane, ' + speedCue + ', through the dock at 80% of the circuit.';
    return {phase, label: phase === 'complete' ? 'Complete' : phase[0].toUpperCase() + phase.slice(1), cue,
      targetLane, targetSpeedRatio: phase === 'complete' ? 0 : phase === 'carry' ? 0.4 : 0.275,
      minSpeed, maxSpeed, gateProgress: phase === 'scan' ? 0.125 : phase === 'deliver' ? 0.8 : null,
      completed: racer.tasksCompleted, total: this.mission.goalPerCar * 3,
      deliveries: racer.deliveries, requiredDeliveries: this.mission.goalPerCar,
      progress: phase === 'scan' ? Math.min(1, racer.scanMs / 600) : phase === 'carry' ? Math.min(1, racer.carryDistance / 0.35) : phase === 'complete' ? 1 : 0};
  }
  #tasks(racer, row, previous, movement, dt, previousDirection) {
    if (!position(row) || movement === null || previousDirection !== row.circuitDirection || dt > 1000) {
      racer.scanMs = 0; racer.carryDistance = 0; racer.gateIndex = null; return;
    }
    if (this.mode === 'precision' && racer.gateIndex === null) {
      racer.gateIndex = GATES.map((gate, index) => ({index, distance: wrap((gate - previous) * row.circuitDirection)}))
        .sort((a, b) => a.distance - b.distance)[0].index;
    }
    const task = this.#task(racer);
    const deliberate = Number.isFinite(row.speed) && row.speed >= task.minSpeed && row.speed <= task.maxSpeed &&
      Number.isFinite(row.lateral) && Math.abs(row.lateral - task.targetLane) <= 12 && movement > 0;
    if (this.mode === 'precision') {
      if (crossed(previous, row.circuitProgress, row.circuitDirection, task.gateProgress, movement)) {
        if (deliberate) { racer.gates++; racer.taskPoints += 100; } else racer.misses++;
        racer.gateIndex = (racer.gateIndex + row.circuitDirection + 4) % 4;
      }
      return;
    }
    if (racer.taskPhase === 'complete') return;
    if (racer.taskPhase === 'scan') {
      racer.scanMs = deliberate && near(row.circuitProgress, 0.125, 0.08) ? racer.scanMs + dt : 0;
      if (racer.scanMs >= 600) { racer.taskPhase = 'carry'; racer.tasksCompleted++; racer.taskPoints += 25; racer.scanMs = 0; }
    } else if (racer.taskPhase === 'carry') {
      racer.carryDistance = deliberate ? racer.carryDistance + movement : 0;
      if (racer.carryDistance >= 0.35 - 1e-9) { racer.taskPhase = 'deliver'; racer.tasksCompleted++; racer.taskPoints += 50; racer.carryDistance = 0; }
    } else if (deliberate && crossed(previous, row.circuitProgress, row.circuitDirection, 0.8, movement)) {
      racer.deliveries++; racer.tasksCompleted++; racer.taskPoints += 100;
      racer.taskPhase = racer.deliveries >= this.mission.goalPerCar ? 'complete' : 'scan';
    }
  }
  guidance(id) {
    if (this.status !== 'running') return null;
    const racer = this.roster.get(id); if (!racer) return null;
    const task = this.#task(racer); return task ? {lane: task.targetLane, throttle: task.targetSpeedRatio} : null;
  }
  pause(now) {
    if (this.status === 'running' && this.#clock(now)) {
      if (this.elapsedMs >= this.durationMs) return this.finish(now, 'time');
      this.status = 'paused';
      // Restart incomplete laps after a safety stop; paused motion earns no points.
      for (const row of this.roster.values()) { row.previous = null; row.distance = 0; row.scanMs = 0; row.carryDistance = 0; }
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
    const rows = [...this.roster.values()].map(racer => {
      const {id, name, control, computer, connected, laps, hits, assists, losses, score, bestLapMs, lastLapMs, gates, misses, tasksCompleted} = racer;
      return {id, name, control, computer, connected, laps, hits, assists, losses, score, bestLapMs, lastLapMs, gates, misses, tasksCompleted, task: this.#task(racer)};
    });
    rows.sort((a, b) => this.mode === 'solo'
      ? (a.bestLapMs ?? Infinity) - (b.bestLapMs ?? Infinity) || b.laps - a.laps || a.id - b.id
      : b.score - a.score || a.id - b.id);
    const teamLaps = rows.reduce((sum, row) => sum + row.laps, 0);
    const teamTasks = rows.reduce((sum, row) => sum + row.tasksCompleted, 0);
    const teamComplete = this.mission ? rows.length > 0 && rows.every(row => row.task.phase === 'complete') : teamLaps >= this.goal;
    const winnerIds = this.status !== 'finished' || this.reason === 'disconnected' ? [] : this.mode === 'team'
      ? (teamComplete ? rows.map(row => row.id) : [])
      : this.mode === 'solo'
        ? rows.filter(row => row.bestLapMs !== null && row.bestLapMs === rows[0]?.bestLapMs && row.laps === rows[0]?.laps).map(row => row.id)
        : rows.filter(row => row.score > 0 && row.score === rows[0]?.score).map(row => row.id);
    const badges = rows.filter(row => row.laps > 0).map(row => ({id: 'full-lap', driverId: row.id, label: 'First full lap'}));
    if (this.status === 'finished' && this.mode === 'team' && teamComplete) badges.push({id: 'crew-complete', driverId: null, label: 'Crew mission complete'});
    return {status: this.status, mode: this.mode, title: this.mission?.title ?? ROUND_MODES[this.mode]?.title ?? 'Choose your next round',
      remainingMs: Math.max(0, this.durationMs - this.elapsedMs), elapsedMs: this.elapsedMs, durationMs: this.durationMs,
      goal: this.goal, teamLaps, teamTasks, mission: this.mission?.id ?? null,
      objective: this.mission ? teamTasks + ' / ' + this.goal + ' crew tasks · every driver: scan → carry → deliver (' + this.mission.goalPerCar + ' delivery each)' : this.mode === 'team' ? teamLaps + ' / ' + this.goal + ' shared laps' : ROUND_MODES[this.mode]?.description ?? '',
      progress: this.goal ? Math.min(1, (this.mission ? teamTasks : teamLaps) / this.goal) : this.durationMs ? this.elapsedMs / this.durationMs : 0,
      rows, winnerIds, badges, reason: this.reason};
  }
}
