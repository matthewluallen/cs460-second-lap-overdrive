// Track model: piece tables, automatic mapping from a driving car, layout geometry
// and per-car localisation. Piece data comes from data/pieces.json, which is derived
// from the original app's own modular road-piece definitions.
//
// Frames: world x right, y up, angles counter-clockwise, millimetres. "Lateral" is
// always positive to the LEFT of the direction of travel.

export const CURVE_RADIUS = 280, LANE_LIMIT = 68;
export const SPECIAL_UNVERIFIED = Object.freeze([53,54,57]);
export const POSITION_MAX_AGE_MS = 2000;
const TAU = Math.PI * 2;
const norm = a => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };

export class Pieces {
  constructor(table) { this.table = table; }
  get(id) { const piece=this.table[String(id)]; return piece && SPECIAL_UNVERIFIED.includes(Number(id)) ? {...piece,kind:'special',unverified:true} : piece ?? null; }
  kind(id) { return this.get(id)?.kind ?? 'unknown'; }
  // Location code -> {progress 0..1 in the direction of travel, lateral mm (left +)}.
  locate(pieceId, locationId, reverse) {
    const entry = this.get(pieceId)?.locs[String(locationId)];
    if (!entry) return null;
    return reverse ? {progress: 1 - entry[0], lateral: -entry[1]} : {progress: entry[0], lateral: entry[1]};
  }
}

// One piece as traversed. turn: +1 left, -1 right, 0 straight.
export function traversal(pieces, id, reverse, hint = {}) {
  const def = pieces.get(id);
  const kind = def?.kind ?? hint.kind ?? 'straight';
  if (kind === 'curve') {
    // Definitions describe every curve as a left turn when its codes are read forward.
    const turn = hint.turn ?? (reverse ? -1 : 1);
    return {id, kind, reverse, turn, length: def?.length ?? CURVE_RADIUS * Math.PI / 2, radius: def?.radius ?? CURVE_RADIUS};
  }
  return {id, kind, reverse, turn: 0, length: def?.length ?? hint.length ?? 560, ...(!def ? {inferred: true} : {}), ...(def?.unverified ? {unverified:true} : {})};
}

// Lay pieces end to end. Returns poses and whether the loop closes on itself.
export function layout(sequence) {
  let x = 0, y = 0, heading = 0, distance = 0;
  const placed = sequence.map(piece => {
    const start = {x, y, heading, distance};
    if (piece.turn) {
      const r = piece.radius, cx = x - piece.turn * r * Math.sin(heading), cy = y + piece.turn * r * Math.cos(heading);
      heading += piece.turn * Math.PI / 2;
      x = cx + piece.turn * r * Math.sin(heading); y = cy - piece.turn * r * Math.cos(heading);
      distance += piece.length;
      return {...piece, start, centre: {x: cx, y: cy}};
    }
    x += piece.length * Math.cos(heading); y += piece.length * Math.sin(heading);
    distance += piece.length;
    return {...piece, start};
  });
  const gap = Math.hypot(x, y), turned = norm(heading);
  const xs = [], ys = [];
  for (const p of placed) for (const t of [0, 0.5, 1]) for (const l of [-110, 110]) { const q = pointOn(p, t, l); xs.push(q.x); ys.push(q.y); }
  return {pieces: placed, length: distance, closed: placed.length >= 4 && gap < 90 && Math.abs(turned) < 0.2,
    gap, bounds: xs.length ? {minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys)} : null};
}

// World pose at a fraction along a placed piece and a lateral offset.
export function pointOn(piece, progress, lateral = 0) {
  const s = piece.start;
  if (piece.turn) {
    const angle = s.heading + piece.turn * progress * Math.PI / 2, r = piece.radius - piece.turn * lateral;
    return {x: piece.centre.x + piece.turn * r * Math.sin(angle), y: piece.centre.y - piece.turn * r * Math.cos(angle), heading: angle};
  }
  const d = progress * piece.length;
  return {x: s.x + d * Math.cos(s.heading) - lateral * Math.sin(s.heading),
    y: s.y + d * Math.sin(s.heading) + lateral * Math.cos(s.heading), heading: s.heading};
}

export class Track {
  constructor(sequence) {
    Object.assign(this, layout(sequence));
    this.count = this.pieces.length;
    this.unverifiedCount = this.pieces.filter(p=>p.unverified).length;
    this.inferredCount = this.pieces.filter(p => p.inferred).length;
  }
  // Path length of a piece in a given lane (inside of a curve is shorter).
  laneLength(index, lateral = 0) {
    const p = this.pieces[index];
    return p.turn ? Math.max(60, p.radius - p.turn * lateral) * Math.PI / 2 : p.length;
  }
  pose(index, progress, lateral = 0, direction = 1) {
    const p = this.pieces[((index % this.count) + this.count) % this.count];
    if (direction >= 0) return pointOn(p, progress, lateral);
    const q = pointOn(p, 1 - progress, -lateral);
    return {x: q.x, y: q.y, heading: q.heading + Math.PI};
  }
  // Centre-line distance from the loop start, in the map's direction.
  distance(index, progress, direction = 1) {
    const p = this.pieces[index];
    return p.start.distance + (direction >= 0 ? progress : 1 - progress) * p.length;
  }
  toJSON() { return this.pieces.map(({id, kind, reverse, turn, length, radius, inferred}) => ({id, kind, reverse, turn, length, radius, ...(inferred ? {inferred: true} : {})})); }
}

// Builds the piece sequence from one car's position and transition messages.
// A piece is committed at each transition bar. The loop is complete when the
// start piece comes round again and the laid-out pieces close geometrically.
export class TrackMapper {
  constructor(pieces, {maxPieces = 64} = {}) {
    this.piecesTable = pieces; this.maxPieces = maxPieces; this.reset();
  }
  reset() { this.sequence = []; this.current = null; this.anchor = -1; this.track = null; this.transitions = 0; this.problem = ''; }
  get done() { return this.track !== null; }
  feed(message) {
    if (this.done) return this.track;
    if (message.type === 'position') {
      // Several codes are read on one piece; they agree on id and direction.
      // A different id with no bar in between (the start piece reports 34 then 33)
      // is also a boundary.
      if (this.current && this.current.id !== message.pieceId) this.#commit(null);
      if (!this.current || this.current.id !== message.pieceId) this.current = {id: message.pieceId, reverse: message.reverse, votes: 0};
      this.current.votes++;
    } else if (message.type === 'transition') {
      this.transitions++;
      // The first bar only tells us a piece boundary was crossed mid-piece.
      if (this.transitions > 1 || this.current) this.#commit(message);
      this.current = null;
    }
    return this.track;
  }
  #commit(transition) {
    let piece;
    if (this.current && this.piecesTable.get(this.current.id)) piece = traversal(this.piecesTable, this.current.id, this.current.reverse);
    else {
      // No code was read (fast lane change, dirty track): infer shape from the wheels.
      const l = transition?.leftCm ?? null, r = transition?.rightCm ?? null;
      if (l === null || r === null) { this.problem = 'A piece was not identified; continuing'; return; }
      const curved = Math.abs(l - r) >= 6;
      piece = traversal(this.piecesTable, -1, false, curved ? {kind: 'curve', turn: l < r ? 1 : -1} : {kind: 'straight', length: (l + r) * 5});
      piece.inferred = true;
    }
    const kind = piece.kind;
    if (this.anchor < 0) {
      // Anchor on the start piece so every map begins at the same place.
      if (kind === 'start' || kind === 'finish') { this.sequence = [piece]; this.anchor = 0; }
      else { this.sequence.push(piece); this.#tryUnanchored(); }
      return;
    }
    const first = this.sequence[0];
    if (this.sequence.length >= 4 && piece.id === first.id && piece.reverse === first.reverse) {
      const candidate = new Track(this.sequence);
      if (candidate.closed) { this.track = candidate; return; }
      this.problem = 'Loop did not close (' + Math.round(candidate.gap) + ' mm gap); driving another lap';
      this.sequence = [piece]; return;
    }
    this.sequence.push(piece);
    if (this.sequence.length > this.maxPieces) { this.problem = 'Too many pieces without closing; restarting'; this.sequence = []; this.anchor = -1; }
  }
  // Tracks without a start piece: accept the shortest repeating closed loop.
  #tryUnanchored() {
    const s = this.sequence;
    for (let n = 4; n <= Math.min(this.maxPieces, s.length / 2); n++) {
      const lap = s.slice(s.length - n), before = s.slice(s.length - 2 * n, s.length - n);
      if (lap.every((p, i) => p.id === before[i].id && p.reverse === before[i].reverse)) {
        const candidate = new Track(lap);
        if (candidate.closed) { this.track = candidate; return; }
      }
    }
    this.sequence = s.slice(-2 * this.maxPieces);
  }
}

// Where one car is on a known track. Keeps every (index, direction) hypothesis
// consistent with the pieces the car has reported, so duplicate piece ids resolve
// as soon as the car has driven past a distinguishing piece.
export class Localizer {
  constructor(track, pieces) { this.track = track; this.piecesTable = pieces; this.reset(); }
  reset() { this.candidates = null; this.index = -1; this.direction = 1; this.progress = 0; this.lateral = 0; this.speed = 0; this.stamp = 0; this.located = false; this.laps = 0; this.seenCode = false; this.lastId = -1; }
  seed(index, direction, now) { this.candidates = [{index, direction}]; this.progress = 0.3; this.stamp = now; this.speed = 0; this.seenCode = true; this.lastId = this.track.pieces[index].id; this.#settle(); }
  #candidatesFor(id, reverse) {
    const out = [];
    this.track.pieces.forEach((p, index) => { if (p.id === id) out.push({index, direction: p.reverse === reverse ? 1 : -1}); });
    return out;
  }
  #step(c) { const n = this.track.count; return {index: (c.index + c.direction + n) % n, direction: c.direction}; }
  feed(message, now) {
    if (message.type === 'position') {
      const spot = this.piecesTable.locate(message.pieceId, message.locationId, message.reverse);
      if (!spot || !Number.isFinite(message.speed)) { this.located = false; this.candidates = null; return; }
      if (this.candidates && this.seenCode && this.lastId !== message.pieceId) this.#advance();
      this.lastId = message.pieceId;
      const matches = this.#candidatesFor(message.pieceId, message.reverse);
      const key = c => c.index + ':' + c.direction;
      if (this.candidates && !this.seenCode) {
        const allowed = new Set(matches.map(key));
        const kept = this.candidates.filter(c => allowed.has(key(c)));
        this.candidates = kept.length ? kept : matches;
      } else if (!this.candidates) this.candidates = matches;
      else {
        const allowed = new Set(matches.map(key));
        const kept = this.candidates.filter(c => allowed.has(key(c)));
        if (kept.length) this.candidates = kept;
        else this.candidates = matches;      // lost: re-localise from this piece
      }
      this.seenCode = true;
      if (spot) { this.progress = spot.progress; this.lateral = spot.lateral; }
      this.speed = message.speed; this.stamp = now;
      this.#settle();
    } else if (message.type === 'transition') {
      this.#advance(); this.stamp = now;
    } else if (message.type === 'delocalized') { this.located = false; this.candidates = null; }
  }
  #advance() {
    if (this.candidates) {
      const before = this.candidates[0];
      this.candidates = this.candidates.map(c => this.#step(c));
      const after = this.candidates[0];
      if (this.located && this.seenCode && this.candidates.length === 1) {
        const wrapped = before.direction > 0 ? after.index < before.index : after.index > before.index;
        if (wrapped) { this.laps++; this.onLap?.(this.laps); }
      }
    }
    this.seenCode = false; this.progress = 0;
    this.#settle();
  }
  #settle() {
    if (!this.candidates || !this.candidates.length) { this.located = false; return; }
    this.index = this.candidates[0].index; this.direction = this.candidates[0].direction;
    this.located = this.candidates.length === 1;
  }
  // Dead-reckon between codes so motion on screen is smooth.
  estimate(now) {
    if (this.index < 0) return null;
    const length = this.track.laneLength(this.index, this.direction * this.lateral);
    const progress = Math.min(0.999, this.progress + Math.max(0, now - this.stamp) / 1000 * this.speed / length);
    return {index: this.index, direction: this.direction, progress, lateral: this.lateral, located: this.located && now >= this.stamp && now - this.stamp <= POSITION_MAX_AGE_MS};
  }
  pose(now) {
    const e = this.estimate(now);
    return e ? {...this.track.pose(e.index, e.progress, e.lateral, e.direction), ...e} : null;
  }
  // Distance along the loop in this car's own direction of travel.
  odometer(now) {
    const e = this.estimate(now);
    if (!e) return null;
    const d = this.track.distance(e.index, e.progress, e.direction);
    return e.direction > 0 ? d : this.track.length - d;
  }
}

// Signed gap from one car to another along the loop: positive means "other" is ahead.
export function gapAhead(trackLength, fromOdometer, toOdometer) {
  let gap = (toOdometer - fromOdometer) % trackLength;
  if (gap < -trackLength / 2) gap += trackLength;
  if (gap > trackLength / 2) gap -= trackLength;
  return gap;
}

// Validate a user-authored plan without accepting arbitrary geometry for known IDs.
export function trackFromPlan(pieces, plan) {
  if (!Array.isArray(plan) || !plan.length || plan.length > 64) throw new Error('Choose 1–64 track sections');
  return new Track(plan.map(p => {
    if (!p || !Number.isInteger(p.id) || typeof p.reverse !== 'boolean') throw new Error('Invalid track section');
    if (pieces.get(p.id)) return traversal(pieces, p.id, p.reverse);
    if (p.id !== -1 || !['curve', 'straight'].includes(p.kind) || !Number.isFinite(p.length) || p.length < 60 || p.length > 2000 || (p.kind === 'curve' && ![-1, 1].includes(p.turn))) throw new Error('Unrecognized track section: rescan this piece');
    return {...traversal(pieces, -1, p.reverse, p), inferred: true};
  }));
}

// Evidence report only. Geometry is not physical acceptance or car localization.
export function trackValidation(track) {
  if (!track) return {schema:'slipstream-track-checks-v1',available:false,physicalValidation:false,issues:['no-map']};
  const pieces=track.pieces, counts=new Map();
  for(const p of pieces)counts.set(p.id,(counts.get(p.id)??0)+1);
  const startCount=pieces.filter(p=>p.kind==='start').length;
  const inferred=pieces.flatMap((p,index)=>p.inferred?[{id:p.id,index}]:[]);
  const special=pieces.flatMap((p,index)=>p.unverified||SPECIAL_UNVERIFIED.includes(Number(p.id))?[{id:p.id,index}]:[]);
  const intersections=pieces.flatMap((p,index)=>p.kind==='intersection'?[index]:[]);
  const jumps=pieces.flatMap((p,index)=>['jump','landing'].includes(p.kind)?[{id:p.id,index,reverse:!!p.reverse}]:[]);
  const issues=[];
  if(!track.closed)issues.push('geometry-not-closed');
  if(startCount===0)issues.push('missing-start');else if(startCount>1)issues.push('multiple-starts');
  if(inferred.length)issues.push('inferred-sections');
  if(special.length)issues.push('unverified-special-sections');
  if(intersections.length)issues.push('intersection-traversal-unverified');
  if(jumps.length)issues.push('jump-direction-unverified');
  return {schema:'slipstream-track-checks-v1',available:true,physicalValidation:false,
    geometricClosure:!!track.closed,closureGapMm:track.gap,pieceCount:pieces.length,startCount,
    repeatedPieceIds:[...counts].filter(([,n])=>n>1).map(([id,count])=>({id,count})),
    inferred,special,intersections,jumps,issues};
}
