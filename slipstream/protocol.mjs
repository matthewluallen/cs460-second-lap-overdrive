// Vehicle wire protocol. Layouts follow the manufacturer's published SDK header
// and were cross-checked against the original Android app (see ANALYSIS.md).
// Every message is [size, id, ...payload] where size counts id + payload.

const uuid = n => 'be15' + n + '-6186-407e-8381-0bd89c4d8df4';
export const UUIDS = Object.freeze({service: uuid('beef'), notify: uuid('bee0'), write: uuid('bee1')});

export const ID = Object.freeze({
  DISCONNECT: 0x0d, PING: 0x16, PING_REPLY: 0x17, VERSION: 0x18, VERSION_REPLY: 0x19,
  CAR_INIT: 0x23, BATTERY: 0x1a, BATTERY_REPLY: 0x1b, LIGHTS: 0x1d, SPEED: 0x24, CHANGE_LANE: 0x25,
  CANCEL_LANE_CHANGE: 0x26, POSITION: 0x27, TRANSITION: 0x29, INTERSECTION: 0x2a,
  DELOCALIZED: 0x2b, SET_OFFSET: 0x2c, OFFSET_UPDATE: 0x2d, TURN: 0x32, LIGHTS_PATTERN: 0x33,
  MAX_DELOCALIZED_SPEED: 0x37, OFFSET_ADJUST: 0x34, SPEED_UPDATE: 0x36, STATUS: 0x3f, LANE_CHANGE_UPDATE: 0x41, CONFIG: 0x45,
  COLLISION: 0x4d, JUMP_RESULT: 0x4e, SUPERCODE: 0x4f, ZONE_SUPERCODE: 0x53, TRANSITION2: 0x51, CYCLE_OVERTIME: 0x86, SDK_MODE: 0x90
});
export const MAX_SPEED = 1400;                 // mm/s hard ceiling for anything this code sends
export const LIGHT = Object.freeze({RED: 0, TAIL: 1, BLUE: 2, GREEN: 3, FRONTL: 4, FRONTR: 5});
export const EFFECT = Object.freeze({STEADY: 0, FADE: 1, THROB: 2, FLASH: 3, RANDOM: 4});
export const TURN = Object.freeze({NONE: 0, LEFT: 1, RIGHT: 2, UTURN: 3, UTURN_JUMP: 4});

const int = (value, min, max, name) => {
  if (!Number.isFinite(value)) throw new RangeError(name + ' must be a number');
  return Math.max(min, Math.min(max, Math.round(value)));
};
function build(id, size, fill) {
  const bytes = new Uint8Array(size + 1), view = new DataView(bytes.buffer);
  bytes[0] = size; bytes[1] = id;
  if (fill) fill(view);
  return bytes;
}

export const encode = Object.freeze({
  ping: () => build(ID.PING, 1),
  version: () => build(ID.VERSION, 1),
  battery: () => build(ID.BATTERY, 1),
  disconnect: () => build(ID.DISCONNECT, 1),
  // flags 1 = override localization, so the car obeys speed commands anywhere.
  sdkMode: (on = true, flags = 1) => build(ID.SDK_MODE, 3, v => { v.setUint8(2, on ? 1 : 0); v.setUint8(3, flags & 255); }),
  speed: (mmPerSec, accel = 1000, respectRoadLimit = false) => build(ID.SPEED, 6, v => {
    v.setInt16(2, int(mmPerSec, 0, MAX_SPEED, 'speed'), true);
    v.setInt16(4, int(accel, 50, 5000, 'acceleration'), true);
    v.setUint8(6, respectRoadLimit ? 1 : 0);
  }),
  // Tell the car which lateral offset it is at right now (calibration, no motion).
  setOffset: mm => build(ID.SET_OFFSET, 5, v => v.setFloat32(2, int(mm * 10, -1000, 1000, 'offset') / 10, true)),
  changeLane: (offsetMm, hSpeed = 300, hAccel = 300, tag = 0) => build(ID.CHANGE_LANE, 11, v => {
    v.setUint16(2, int(hSpeed, 20, 1000, 'lane speed'), true);
    v.setUint16(4, int(hAccel, 20, 5000, 'lane acceleration'), true);
    v.setFloat32(6, int(offsetMm * 10, -1000, 1000, 'offset') / 10, true);
    v.setUint8(10, 0); v.setUint8(11, tag & 255);
  }),
  // App-native 0x37: unsigned mm/s; scan policy supplies the tighter ceiling.
  maxDelocalizedSpeed: speed => build(ID.MAX_DELOCALIZED_SPEED, 3, v => v.setUint16(2, int(speed, 0, 300, 'delocalized speed'), true)),
  cancelLaneChange: () => build(ID.CANCEL_LANE_CHANGE, 1),
  turn: (type = TURN.UTURN, trigger = 0) => build(ID.TURN, 3, v => { v.setUint8(2, int(type, 0, 4, 'turn')); v.setUint8(3, trigger ? 1 : 0); }),
  // Simple lights: low nibble selects which lights change, high nibble their new state.
  lights: mask => build(ID.LIGHTS, 2, v => v.setUint8(2, mask & 255)),
  // Up to three {channel, effect, start, end, cycles} entries; intensities 0..14.
  lightsPattern: channels => {
    if (!Array.isArray(channels) || channels.length < 1 || channels.length > 3) throw new RangeError('1 to 3 light channels');
    return build(ID.LIGHTS_PATTERN, 17, v => {
      v.setUint8(2, channels.length);
      channels.forEach((c, i) => {
        const at = 3 + i * 5;
        v.setUint8(at, int(c.channel, 0, 5, 'channel')); v.setUint8(at + 1, int(c.effect ?? 0, 0, 4, 'effect'));
        v.setUint8(at + 2, int(c.start ?? 0, 0, 14, 'start')); v.setUint8(at + 3, int(c.end ?? c.start ?? 0, 0, 14, 'end'));
        v.setUint8(at + 4, int(c.cycles ?? 0, 0, 255, 'cycles'));
      });
    });
  }
});

// Engine RGB helper: r, g, b in 0..1, optional effect for all three channels.
export function rgb(r, g, b, effect = EFFECT.STEADY, cycles = 0) {
  const level = x => Math.round(Math.max(0, Math.min(1, x)) * 14);
  const entry = (channel, x) => effect === EFFECT.STEADY
    ? {channel, effect, start: level(x), end: level(x), cycles: 0}
    : {channel, effect, start: 0, end: level(x), cycles};
  return encode.lightsPattern([entry(LIGHT.RED, r), entry(LIGHT.GREEN, g), entry(LIGHT.BLUE, b)]);
}

export const hex = bytes => [...bytes].map(n => n.toString(16).padStart(2, '0')).join(' ');

// One notification can carry several length-prefixed messages.
export function decode(bytes) {
  const out = [];
  for (let at = 0; at < bytes.length;) {
    const size = bytes[at], end = at + 1 + size;
    if (size < 1 || end > bytes.length) throw new Error('Malformed notification: ' + hex(bytes));
    out.push(decodeOne(bytes.subarray(at, end)));
    at = end;
  }
  return out;
}

function decodeOne(m) {
  const v = new DataView(m.buffer, m.byteOffset, m.byteLength), size = m[0], id = m[1];
  const has = n => size >= n;
  switch (id) {
    // F&F build 403: CarMsgCarInitComplete (006b8638/006b86c0), upgrades u16.
    case ID.CAR_INIT: if (size !== 3) break; return {id, type:'carInit', upgrades:v.getUint16(2,true)};
    case ID.PING_REPLY: return {id, type: 'ping'};
    case ID.VERSION_REPLY: if (!has(3)) break; return {id, type: 'version', version: has(5) ? v.getUint32(2, true) : v.getUint16(2, true)};
    case ID.BATTERY_REPLY: if (!has(3)) break; return {id, type: 'battery', millivolts: v.getUint16(2, true)};
    case ID.POSITION: {
      if (!has(10) || !Number.isFinite(v.getFloat32(4, true))) break;
      const flags = v.getUint8(10);
      return {id, type: 'position', locationId: v.getUint8(2), pieceId: v.getUint8(3),
        offset: v.getFloat32(4, true), speed: v.getUint16(8, true), flags,
        reverse: (flags & 0x40) !== 0, reverseDriving: (flags & 0x20) !== 0,
        laneChangeId: has(12) ? v.getUint8(12) : 0, desiredSpeed: has(16) ? v.getUint16(15, true) : null};
    }
    case ID.TRANSITION: {
      // Only the full classic layout is understood. Real MXT scans emitted
      // eight-byte 0x29 frames; interpreting these as track telemetry masked
      // absent position data and kept the safety watchdog alive.
      if (!has(17) || !Number.isFinite(v.getFloat32(4, true))) break;
      return {id, type: 'transition', pieceIndex: v.getInt8(2), previousPieceIndex: v.getInt8(3),
        offset: v.getFloat32(4, true),
        uphill: has(15) ? v.getUint8(14) : 0, downhill: has(15) ? v.getUint8(15) : 0,
        leftCm: has(17) ? v.getUint8(16) : null, rightCm: has(17) ? v.getUint8(17) : null};
    }
    case ID.INTERSECTION: {
      if (!has(8) || !Number.isFinite(v.getFloat32(3, true))) break;
      return {id, type: 'intersection', pieceIndex: v.getInt8(2), offset: v.getFloat32(3, true),
        code: v.getUint8(7), exiting: v.getUint8(8) !== 0};
    }
    case ID.DELOCALIZED: return {id, type: 'delocalized'};      // the app calls this CarOffRoad
    // The next four are not in the public SDK; ids and sizes are from the app (ANALYSIS.md).
    // Native 006aed3c and independent Partydrive decoder: diagnostic only.
    case ID.LANE_CHANGE_UPDATE: {
      if (size !== 14) break;
      const currentOffset = v.getFloat32(2,true), targetOffset = v.getFloat32(6,true);
      if (!Number.isFinite(currentOffset) || !Number.isFinite(targetOffset)) break;
      return {id,type:'laneChange',currentOffset,targetOffset,offsetKnown:currentOffset !== 654321 && targetOffset !== 654321,
        horizontalSpeed:v.getUint16(10,true),verticalSpeed:v.getInt16(12,true),laneChangeId:m[14]};
    }
    case ID.SPEED_UPDATE: if (!has(7)) break; return {id, type: 'speed', desired: v.getInt16(2, true), accel: v.getInt16(4, true), actual: v.getInt16(6, true)};
    case ID.COLLISION: if (!has(3)) break; return {id, type: 'collision', a: m[2], b: m[3], wasSideOnCollision: !!m[2], wasFrontBackCollision: !!m[3]};
    case ID.JUMP_RESULT: if (!has(4)) break; return {id, type: 'jump', value: v.getInt16(2, true), result: m[4], launchSpeed: v.getInt16(2, true), jumpFailed: !!m[4]};
    // Diagnostic only: Fast & Furious native constructors/GetBytes use a
    // 7-byte frame (ccic). The final byte's gameplay meaning is not established.
    case ID.SUPERCODE:
    case ID.ZONE_SUPERCODE:
      if (!has(6)) break;
      return {id, type: id === ID.SUPERCODE ? 'supercode' : 'zoneSupercode', code: v.getUint32(2, true), rawTag: m[6], raw: hex(m)};
    case ID.CYCLE_OVERTIME: return {id, type: 'overtime'};
    case ID.OFFSET_UPDATE: if (!has(5) || !Number.isFinite(v.getFloat32(2, true))) break; return {id, type: 'offset', offset: v.getFloat32(2, true), laneChangeId: has(6) ? v.getUint8(6) : 0};
    case ID.STATUS: {
      if (!has(5)) break;
      return {id, type: 'status', onTrack: m[2] !== 0, onCharger: m[3] !== 0, lowBattery: m[4] !== 0, charged: m[5] !== 0};
    }
  }
  return {id, type: 'other', raw: hex(m)};
}

// Model id from an advertisement's manufacturer data. Browsers key the record by
// company id 0xEFBE (bytes BE EF) and expose the rest: reserved, model, identifier u32.
export const MANUFACTURER_KEY = 0xefbe;
export function modelFromManufacturerData(view) {
  if (!view || view.byteLength < 2) return null;
  return view.getUint8(1) || null;
}
