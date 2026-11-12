// Virtual cars on a virtual track. A SimCar accepts the same bytes a real car
// accepts and emits the same notifications, so everything above the transport
// (decoding, mapping, localisation, battle) runs unchanged without hardware.
import {ID, encode, decode} from './protocol.mjs';
import {Track, traversal, LANE_LIMIT} from './track.mjs';

// Ready-made layouts: [pieceId, reverse]. Curves turn left unless reversed.
export const LAYOUTS = Object.freeze({
  'Starter oval': [[34, 0], [33, 0], [17, 0], [18, 0], [36, 0], [20, 0], [23, 0]],
  'Capsule': [[34, 0], [33, 0], [39, 0], [17, 0], [18, 0], [36, 0], [40, 0], [20, 0], [23, 0]],
  'Square': [[34, 0], [33, 0], [17, 0], [36, 0], [18, 0], [39, 0], [20, 0], [40, 0], [23, 0]],
  'Figure eight': [[34, 0], [33, 0], [10, 0], [17, 0], [36, 0], [18, 0], [20, 0], [39, 0], [10, 0], [23, 1], [40, 0], [24, 1], [27, 1]],
  'Jump loop': [[34, 0], [33, 0], [36, 0], [17, 0], [18, 0], [43, 0], [46, 0], [20, 0], [23, 0]],
  'Grand circuit': [[34, 0], [33, 0], [39, 0], [17, 0], [36, 0], [18, 0], [40, 0], [48, 0], [51, 0], [20, 0], [53, 0], [23, 0], [57, 0]]
});

export function buildTrack(pieces, layout) {
  return new Track(layout.map(([id, reverse]) => traversal(pieces, id, !!reverse)));
}


export class SimCar {
  constructor(world, {name = 'Sim', model = 8, index = 0, progress = 0.1, lateral = 0, direction = 1, offsetSign = -1} = {}) {
    // The car's own lateral convention: by default a positive offset is to the RIGHT.
    this.toCar = lateralLeft => offsetSign * lateralLeft; this.fromCar = offset => offset / offsetSign;
    this.world = world; this.name = name; this.model = model;
    this.index = index; this.progress = progress; this.direction = direction;
    this.lateral = lateral;            // truth, left +, in the direction of travel
    this.believedShift = 0;            // car offset = toCar(lateral) + shift until calibrated
    this.targetLateral = lateral; this.lateralSpeed = 300;
    this.speed = 0; this.targetSpeed = 0; this.accel = 1000;
    this.sdk = false; this.lights = {r: 0, g: 0, b: 0, effect: 0}; this.headlights = false;
    this.listeners = new Set(); this.connected = true; this.millivolts = 3950; this.uturnUntil = 0;
    this.written = [];
  }
  // --- transport interface (same shape as the Bluetooth link) -------------
  onNotify(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async write(bytes) {
    if (!this.connected) throw new Error('Car disconnected');
    this.written.push(Uint8Array.from(bytes));
    if (this.written.length > 200) this.written.shift();
    this.#command(Uint8Array.from(bytes));
  }
  close() { this.connected = false; this.targetSpeed = this.speed = 0; }
  #emit(bytes) { if (this.connected) for (const fn of this.listeners) fn(bytes); }
  #command(m) {
    const v = new DataView(m.buffer);
    switch (m[1]) {
      case ID.PING: return this.#later(Uint8Array.of(1, ID.PING_REPLY));
      case ID.VERSION: return this.#later(Uint8Array.of(5, ID.VERSION_REPLY, 0x27, 0x25, 0, 0));
      case ID.BATTERY: return this.#later(Uint8Array.of(3, ID.BATTERY_REPLY, this.millivolts & 255, this.millivolts >> 8));
      case ID.SDK_MODE: this.sdk = m[2] === 1; return;
      case ID.SPEED: if (this.sdk) { this.targetSpeed = v.getInt16(2, true); this.accel = Math.max(50, v.getInt16(4, true)); } return;
      case ID.SET_OFFSET: this.believedShift = v.getFloat32(2, true) - this.toCar(this.lateral); return;
      case ID.CHANGE_LANE: {
        if (!this.sdk) return;
        const wanted = v.getFloat32(6, true) - this.believedShift;
        this.targetLateral = Math.max(-LANE_LIMIT, Math.min(LANE_LIMIT, this.fromCar(wanted)));
        this.lateralSpeed = Math.max(20, v.getUint16(2, true)); return;
      }
      case ID.CANCEL_LANE_CHANGE: this.targetLateral = this.lateral; return;
      case ID.TURN: if (this.sdk && m[2] >= 3) this.#uturn(); return;
      case ID.LIGHTS: if ((m[2] & 0x01)) this.headlights = (m[2] & 0x10) !== 0; return;
      case ID.LIGHTS_PATTERN: {
        const next = {...this.lights};
        for (let i = 0; i < m[2]; i++) {
          const at = 3 + i * 5, level = Math.max(m[at + 2], m[at + 3]) / 14;
          if (m[at] === 0) next.r = level; if (m[at] === 3) next.g = level; if (m[at] === 2) next.b = level;
          next.effect = m[at + 1];
        }
        this.lights = next; return;
      }
      case ID.DISCONNECT: this.close(); return;
    }
  }
  #later(bytes) { queueMicrotask(() => this.#emit(bytes)); }
  #uturn() {
    this.direction = -this.direction; this.progress = 1 - this.progress;
    this.lateral = -this.lateral; this.targetLateral = -this.targetLateral; this.believedShift = -this.believedShift;
  }
  // --- physics -------------------------------------------------------------
  get piece() { return this.world.track.pieces[this.index]; }
  // Reverse flag the car would report on this piece when travelling this way.
  get reverseFlag() { return this.direction > 0 ? this.piece.reverse : !this.piece.reverse; }
  step(dt) {
    if (!this.connected) return;
    const dv = this.accel * dt;
    this.speed += Math.max(-dv, Math.min(dv, this.targetSpeed - this.speed));
    const dl = this.lateralSpeed * dt;
    this.lateral += Math.max(-dl, Math.min(dl, this.targetLateral - this.lateral));
    let travel = this.speed * dt;
    while (travel > 1e-9) {
      const track = this.world.track, mapLateral = this.direction * this.lateral;
      const length = track.laneLength(this.index, mapLateral);
      const before = this.progress, after = Math.min(1, before + travel / length);
      this.#codes(before, after);
      travel -= (after - before) * length; this.progress = after;
      if (after >= 1) {
        const wheel = cm => Math.max(0, Math.min(255, Math.round(cm)));
        const turn = this.piece.turn * this.direction;          // as driven
        const inner = (this.piece.radius ?? 0) - turn * this.lateral;
        const left = this.piece.turn ? (inner - turn * 22) * Math.PI / 2 / 10 : length / 10;
        const right = this.piece.turn ? (inner + turn * 22) * Math.PI / 2 / 10 : length / 10;
        const previous = this.index;
        this.index = (this.index + this.direction + track.count) % track.count; this.progress = 0;
        const bytes = new Uint8Array(18), v = new DataView(bytes.buffer);
        bytes[0] = 17; bytes[1] = ID.TRANSITION; v.setInt8(2, this.index); v.setInt8(3, previous);
        v.setFloat32(4, this.toCar(this.lateral) + this.believedShift, true);
        bytes[16] = wheel(left); bytes[17] = wheel(right);
        this.#emit(bytes);
      }
    }
  }
  // Emit a position update for each location code crossed in the current lane.
  #codes(from, to) {
    const def = this.world.pieces.get(this.piece.id);
    if (!def) return;
    const reverse = this.reverseFlag;
    let best = null;
    for (const [locationId, [p, l]] of Object.entries(def.locs)) {
      const progress = reverse ? 1 - p : p, lateral = reverse ? -l : l;
      if (progress <= from || progress > to) continue;
      const miss = Math.abs(lateral - this.lateral);
      if (miss <= 5.5 && (!best || miss < best.miss)) best = {locationId: +locationId, miss};
    }
    if (!best) return;
    const bytes = new Uint8Array(17), v = new DataView(bytes.buffer);
    bytes[0] = 16; bytes[1] = ID.POSITION; bytes[2] = best.locationId; bytes[3] = this.piece.id;
    v.setFloat32(4, this.toCar(this.lateral) + this.believedShift, true);
    v.setUint16(8, Math.round(this.speed), true);
    bytes[10] = (reverse ? 0x40 : 0) | 7;
    v.setUint16(15, Math.round(this.targetSpeed), true);
    this.#emit(bytes);
  }
}

export class SimWorld {
  constructor(pieces, layoutName = 'Capsule') {
    this.pieces = pieces; this.cars = []; this.setLayout(layoutName);
  }
  setLayout(name) {
    this.layoutName = name; this.track = buildTrack(this.pieces, LAYOUTS[name]);
    this.cars.forEach((car, i) => { car.index = 0; car.progress = 0.05 + 0.05 * i; car.direction = 1; });
  }
  addCar(options = {}) {
    const n = this.cars.length;
    const car = new SimCar(this, {index: 0, progress: Math.max(0.02, 0.55 - 0.16 * Math.floor(n / 2)), lateral: [-22.5, 22.5, -58.5, 58.5][n % 4], ...options});
    this.cars.push(car); return car;
  }
  removeCar(car) { this.cars = this.cars.filter(c => c !== car); car.close(); }
  step(dt) { for (const car of this.cars) car.step(Math.min(dt, 0.05)); }
}

export {encode, decode};
