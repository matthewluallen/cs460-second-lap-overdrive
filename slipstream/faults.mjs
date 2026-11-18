// Deterministic simulator-only fault injection. This does not model radio timing,
// physical braking, or a disconnected laptop's ability to deliver STOP.
import {decode, ID} from './protocol.mjs';
export class FaultTransport {
  constructor(inner) { this.inner = inner; this.silentTelemetry = false; this.listeners = new Set(); this.pending = [];
    this.unsubscribe = inner.onNotify(bytes => {
      if (this.silentTelemetry && decode(bytes).some(m => m.type === 'position' || m.type === 'transition')) return;
      this.emit(bytes);
    });
  }
  onNotify(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(bytes) { for (const fn of this.listeners) fn(bytes); }
  write(bytes) { return this.inner.write(bytes); }
  lateDelocalized(at) { this.pending.push(at); }
  advance(now) { const due = this.pending.filter(at => at <= now); this.pending = this.pending.filter(at => at > now); for (const _ of due) this.emit(Uint8Array.of(1, ID.DELOCALIZED)); }
  close() { this.unsubscribe(); this.listeners.clear(); this.pending = []; return this.inner.close(); }
}
// Relay outages occur above BLE. Keep this companion separate so a lost relay
// never silently disables local Bluetooth STOP delivery in the test model.
export class FaultRelay {
  constructor(onMessage, onStatus) { this.onMessage = onMessage; this.onStatus = onStatus; this.outage = false; }
  setOutage(value, {announce = true} = {}) { this.outage = value; if (announce) this.onStatus(value ? 'offline' : 'online'); }
  send(message) { if (!this.outage) this.onMessage(message); }
}
