// Original synthesized client-side game sounds. Never sends a BLE/control message.
const clamp = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const CUES = Object.freeze({
  countdown: [440], go: [660, 880], ready: [660, 880], lap: [880, 1100],
  shield: [440, 660, 880], boost: [330, 660, 990], stop: [330, 220],
  limited: [220, 220], recovered: [440, 660], disabled: [220, 165],
  score: [660, 880], finish: [660, 880, 1100]
});
const AUDIO_TEXT = Object.freeze({off: 'Sound off.', on: 'Sound on · synthesized game effects, not car audio.',
  paused: 'Sound suspended by the browser. Choose Enable sound to retry.',
  blocked: 'Sound could not start. Choose Enable sound to retry.', unsupported: 'Sound unavailable in this browser.'});

export class AudioCues {
  constructor({AudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext, document = globalThis.document,
    now = () => globalThis.performance?.now?.() ?? Date.now(), onStatus = () => {}} = {}) {
    this.Context = AudioContext; this.document = document; this.now = now; this.onStatus = onStatus;
    this.enabled = false; this.engine = false; this.volume = .2; this.state = typeof AudioContext === 'function' ? 'off' : 'unsupported';
    this.context = null; this.master = null; this.engineNode = null; this.engineGain = null;
    this.tones = new Set(); this.lastCue = new Map(); this.previous = null; this.pending = null; this.version = 0; this.disposed = false;
    this.visibility = () => { if (this.document?.hidden) this.#silence(); };
    this.document?.addEventListener?.('visibilitychange', this.visibility);
    this.#status(this.state);
  }
  snapshot() { return {enabled: this.enabled, engine: this.engine, volume: this.volume, state: this.state, text: AUDIO_TEXT[this.state]}; }
  #status(state) { this.state = state; try { this.onStatus(this.snapshot()); } catch {} }
  #available() { return this.enabled && !this.disposed && !this.document?.hidden && this.context?.state === 'running'; }
  async enable() {
    if (this.disposed) return false;
    if (typeof this.Context !== 'function') { this.#status('unsupported'); return false; }
    if (this.pending) return this.pending;
    const version = ++this.version;
    try {
      // Construction/resume happen in the click's user-activation task.
      const context = this.context ??= new this.Context();
      if (!this.master) { this.master = context.createGain(); this.master.gain.value = this.volume; this.master.connect(context.destination); }
      context.onstatechange = () => {
        if (this.context !== context || !this.enabled) return;
        if (context.state !== 'running') this.#silence();
        this.#status(context.state === 'running' ? 'on' : 'paused');
      };
      this.pending = Promise.resolve(context.resume()).then(() => {
        if (this.disposed || version !== this.version || this.context !== context) return false;
        this.enabled = context.state === 'running';
        this.#status(this.enabled ? 'on' : 'blocked');
        return this.enabled;
      }).catch(() => {
        if (version === this.version && !this.disposed) { this.enabled = false; this.#silence(); this.#status('blocked'); }
        return false;
      }).finally(() => { if (version === this.version) this.pending = null; });
      return this.pending;
    } catch {
      this.enabled = false; this.#silence(); this.#status('blocked'); return false;
    }
  }
  disable() {
    this.enabled = false; this.version++; this.pending = null; this.#silence();
    const context = this.context; this.context = null;
    try { this.engineNode?.stop(); this.engineNode?.disconnect(); this.engineGain?.disconnect(); this.master?.disconnect(); } catch {}
    this.engineNode = this.engineGain = this.master = null;
    try { Promise.resolve(context?.close()).catch(() => {}); } catch {}
    this.#status(typeof this.Context === 'function' ? 'off' : 'unsupported');
  }
  setVolume(value) {
    this.volume = clamp(Number(value), this.volume);
    try { if (this.master) this.master.gain.setValueAtTime(this.volume, this.context.currentTime); } catch { this.#silence(); }
    this.#status(this.state); return this.volume;
  }
  setEngine(enabled) { this.engine = !!enabled; if (!this.engine) this.#engineLevel(0, 0); this.#status(this.state); }
  #removeTone(tone, stop = false) {
    this.tones.delete(tone);
    try { if (stop) tone.osc.stop(); tone.osc.disconnect(); tone.gain.disconnect(); } catch {}
  }
  #silence() {
    this.#engineLevel(0, 0);
    for (const tone of [...this.tones]) this.#removeTone(tone, true);
  }
  #engineLevel(level, speed) {
    if (!this.context || !this.master) return;
    try {
      if (!this.engineNode && level > 0) {
        this.engineNode = this.context.createOscillator(); this.engineNode.type = 'triangle';
        this.engineGain = this.context.createGain(); this.engineGain.gain.value = 0;
        this.engineNode.connect(this.engineGain); this.engineGain.connect(this.master); this.engineNode.start();
      }
      if (!this.engineGain) return;
      const at = this.context.currentTime, gain = this.engineGain.gain;
      gain.cancelScheduledValues(at); gain.setValueAtTime(gain.value, at);
      gain.linearRampToValueAtTime(level, at + .025);
      if (level > 0) {
        this.engineNode.frequency.setTargetAtTime(65 + Math.max(0, Math.min(1200, speed)) * .16, at, .05);
        // Audio-thread deadline: engine fades even if JS stops supplying updates.
        gain.setValueAtTime(level, at + .35); gain.linearRampToValueAtTime(0, at + .5);
      }
    } catch { try { if (this.engineGain) this.engineGain.gain.value = 0; } catch {} }
  }
  cue(kind) {
    const notes = CUES[kind], now = this.now();
    if (!notes || !this.#available() || this.volume <= 0 || now - (this.lastCue.get(kind) ?? -Infinity) < 400) return false;
    this.lastCue.set(kind, now);
    try {
      for (let i = 0; i < notes.length; i++) {
        while (this.tones.size >= 6) this.#removeTone(this.tones.values().next().value, true);
        const osc = this.context.createOscillator(), gain = this.context.createGain(), tone = {osc, gain};
        this.tones.add(tone); osc.type = 'sine'; osc.frequency.value = notes[i]; osc.connect(gain); gain.connect(this.master);
        const at = this.context.currentTime + i * .1;
        gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(.14, at + .012); gain.gain.linearRampToValueAtTime(0, at + .09);
        osc.onended = () => this.#removeTone(tone); osc.start(at); osc.stop(at + .11);
      }
      return true;
    } catch { this.#silence(); return false; }
  }
  update({online = false, halted = true, carId = null, speed = 0, fresh = false, telemetryState = 'normal', lap = null, powerZone = null, countdown = null} = {}) {
    const current = {online: online === true, halted: !!halted, carId, fresh: fresh === true, telemetryState,
      lap: Number.isFinite(lap) ? lap : null, powerZone: ['shield','boost'].includes(powerZone) ? powerZone : null,
      countdown: Number.isFinite(countdown) && countdown > 0 ? Math.ceil(countdown) : null};
    const before = this.previous; this.previous = current;
    if (!this.#available() || !current.online) { this.#silence(); return; }
    const sameCar = !!before && current.carId !== null && current.carId === before.carId;
    if (!current.fresh || current.halted || telemetryState === 'degraded') {
      this.#engineLevel(0, 0);
      if (before && ((!current.fresh && before.fresh) || (current.halted && !before.halted) ||
        (telemetryState === 'degraded' && before.telemetryState !== 'degraded'))) {
        for (const tone of [...this.tones]) this.#removeTone(tone, true);
      }
    } else this.#engineLevel(this.engine && Number.isFinite(speed) && speed > 0 ? .08 : 0, speed);
    if (before && current.halted && !before.halted) this.cue('stop');
    else if (sameCar && telemetryState === 'degraded' && before.telemetryState !== 'degraded') this.cue('limited');
    else if (sameCar && current.fresh && telemetryState === 'reacquired' && before.telemetryState === 'degraded') this.cue('recovered');
    else if (current.countdown !== null && before?.countdown !== current.countdown) this.cue('countdown');
    else if (before?.countdown !== null && before?.countdown !== undefined && current.countdown === null && !current.halted) this.cue('go');
    else if (sameCar && current.fresh && !current.halted && current.lap !== null && before.lap !== null && current.lap > before.lap) this.cue('lap');
    else if (sameCar && current.fresh && !current.halted && current.powerZone && current.powerZone !== before.powerZone) this.cue(current.powerZone);
  }
  dispose() { this.disposed = true; this.disable(); this.document?.removeEventListener?.('visibilitychange', this.visibility); }
}
