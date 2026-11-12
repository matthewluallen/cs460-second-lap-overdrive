// Record every byte exchanged with each car, and replay a recording later.
//
// Why: the simulator was written by the same hand as the controller, so it can
// only confirm that the two agree with each other. A trace from a real car is
// ground truth. Record one at the track, drop the file in fixtures/, and the test
// suite replays it through the real decoder, mapper and localiser from then on.
import {hex} from './protocol.mjs';

export const TRACE_FORMAT = 'slipstream-trace-v1';
const MAX_EVENTS = 200000;

export class Recorder {
  constructor(clock = () => performance.now()) { this.clock = clock; this.active = false; this.reset(); }
  reset() { this.cars = []; this.events = []; this.started = 0; this.dropped = 0; }
  start(drivers, note = '') {
    this.reset(); this.active = true; this.started = this.clock(); this.note = note; this.wall = new Date().toISOString();
    for (const driver of drivers) this.add(driver);
  }
  add(driver) {
    if (!this.active) return;
    const index = this.cars.length, car = driver.car;
    this.cars.push({name: car.name, model: car.model, simulated: !!car.simulated});
    car.tap = (direction, bytes) => {
      if (!this.active) return;
      if (this.events.length >= MAX_EVENTS) { this.dropped++; return; }
      this.events.push([Math.round(this.clock() - this.started), index, direction, hex(bytes)]);
    };
  }
  stop() { this.active = false; return this.toJSON(); }
  toJSON() {
    return {format: TRACE_FORMAT, recorded: this.wall, note: this.note, source: this.cars.every(c => c.simulated) ? 'simulator' : 'hardware',
      cars: this.cars, dropped: this.dropped, events: this.events};
  }
}

export function validate(trace) {
  if (!trace || trace.format !== TRACE_FORMAT || !Array.isArray(trace.cars) || !Array.isArray(trace.events)) throw new Error('Not a Slipstream trace');
  let last = -1;
  for (const event of trace.events) {
    if (!Array.isArray(event) || event.length !== 4) throw new Error('Malformed trace event');
    const [t, car, direction, bytes] = event;
    if (!Number.isFinite(t) || t < last || !Number.isInteger(car) || car < 0 || car >= trace.cars.length ||
      (direction !== 'rx' && direction !== 'tx') || typeof bytes !== 'string' || !/^([0-9a-f]{2})( [0-9a-f]{2})*$/.test(bytes)) throw new Error('Malformed trace event');
    last = t;
  }
  return trace;
}
const fromHex = text => Uint8Array.from(text.split(' ').map(b => parseInt(b, 16)));

// A transport that plays back what one recorded car said. Writes are accepted and
// kept, so a test can also compare what the controller sends now with what it sent then.
export class ReplayCar {
  constructor(trace, carIndex) {
    this.events = validate(trace).events.filter(e => e[1] === carIndex);
    this.cursor = 0; this.listeners = new Set(); this.written = [];
  }
  onNotify(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async write(bytes) { this.written.push(Uint8Array.from(bytes)); }
  close() {}
  get done() { return this.cursor >= this.events.length; }
  // Emit every recorded notification up to and including this time (ms).
  advance(untilMs) {
    while (this.cursor < this.events.length && this.events[this.cursor][0] <= untilMs) {
      const [, , direction, bytes] = this.events[this.cursor++];
      if (direction === 'rx') for (const fn of this.listeners) fn(fromHex(bytes));
    }
  }
  recorded(direction) { return this.events.filter(e => e[2] === direction).map(e => e[3]); }
}
