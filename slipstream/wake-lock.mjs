// Screen comfort only. This object has no connection to vehicle controls.
const TEXT = Object.freeze({
  idle: 'Screen-awake request is idle.', requesting: 'Requesting screen-awake support…',
  held: 'Screen-awake request active. Keep this tab visible.',
  paused: 'Screen-awake request paused while this page is hidden.',
  released: 'The browser released screen-awake support. Keep the screen on or retry.',
  denied: 'Screen-awake request unavailable or denied. Keep the screen on manually.',
  unsupported: 'Screen-awake support unavailable. Keep the screen on manually.'
});

export class ScreenAwake {
  constructor({wakeLock = globalThis.navigator?.wakeLock, document = globalThis.document, onStatus = () => {}} = {}) {
    this.wakeLock = wakeLock; this.document = document; this.onStatus = onStatus;
    this.active = false; this.sentinel = null; this.pending = null; this.version = 0; this.disposed = false;
    this.state = typeof wakeLock?.request === 'function' ? 'idle' : 'unsupported';
    this.visibility = () => {
      if (!this.active || this.disposed) return;
      this.version++;
      if (this.document?.hidden) { this.#release(); this.#status('paused'); }
      else this.#request();
    };
    this.document?.addEventListener?.('visibilitychange', this.visibility);
    this.#status(this.state);
  }
  snapshot() { return {state: this.state, active: this.active, text: TEXT[this.state]}; }
  #status(state) { this.state = state; try { this.onStatus(this.snapshot()); } catch {} }
  #wanted() { return this.active && !this.disposed && !this.document?.hidden; }
  setActive(active) {
    active = !!active;
    if (this.disposed || active === this.active) return this.snapshot();
    this.active = active; this.version++;
    if (!active) { this.#release(); this.#status(typeof this.wakeLock?.request === 'function' ? 'idle' : 'unsupported'); }
    else if (this.document?.hidden) this.#status('paused');
    else this.#request();
    return this.snapshot();
  }
  retry() {
    if (!this.#wanted()) return this.snapshot();
    this.version++; this.#request(); return this.snapshot();
  }
  #release() {
    const sentinel = this.sentinel; this.sentinel = null;
    try { Promise.resolve(sentinel?.release()).catch(() => {}); } catch {}
  }
  #request() {
    if (!this.#wanted()) return;
    if (typeof this.wakeLock?.request !== 'function') { this.#status('unsupported'); return; }
    if (this.sentinel && !this.sentinel.released) { this.#status('held'); return; }
    if (this.pending) return;
    const version = this.version;
    this.#status('requesting');
    // A request failure is shown, not retried by every frame or in a timer loop.
    // Returning to the visible page or an explicit retry permits one new attempt.
    this.pending = Promise.resolve().then(() => this.wakeLock.request('screen')).then(sentinel => {
      if (!this.#wanted() || version !== this.version) {
        try { Promise.resolve(sentinel?.release()).catch(() => {}); } catch {}
        return;
      }
      if (!sentinel || sentinel.released) { this.#status('released'); return; }
      this.sentinel = sentinel;
      sentinel.addEventListener?.('release', () => {
        if (this.sentinel !== sentinel) return;
        this.sentinel = null;
        this.#status(this.document?.hidden ? 'paused' : this.active ? 'released' : 'idle');
      }, {once: true});
      this.#status('held');
    }).catch(() => {
      if (this.#wanted() && version === this.version) this.#status('denied');
    }).finally(() => {
      this.pending = null;
      if (this.#wanted() && version !== this.version) this.#request();
    });
  }
  dispose() {
    this.disposed = true; this.active = false; this.version++; this.#release();
    this.document?.removeEventListener?.('visibilitychange', this.visibility);
    this.#status(typeof this.wakeLock?.request === 'function' ? 'idle' : 'unsupported');
  }
}
