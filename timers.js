/**
 * timers.js
 * ──────────────────────────────────────────────────────
 * TimerEngine manages up to N independent countdown timers,
 * each tied to a DOM ring (SVG stroke-dashoffset) + text node.
 *
 * Usage:
 *   const engine = new TimerEngine();
 *   engine.register(1, 300, { ringEl, numEl, btnEl });  // 5 min
 *   engine.toggle(1);   // start or pause
 *   engine.reset(1);
 *   engine.on("complete", ({ id }) => …);
 */

const CIRCUMFERENCE = 207.3; // 2π × r=33

export class TimerEngine {
  constructor() {
    this._timers    = {};  // id → { total, rem, running, iv, els }
    this._listeners = {};
  }

  // ── Event emitter ───────────────────────────────────

  on(event, fn) {
    (this._listeners[event] = this._listeners[event] || []).push(fn);
    return this;
  }

  _emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }

  // ── Timer lifecycle ─────────────────────────────────

  /**
   * Register a timer.
   * @param {number|string} id    Unique timer ID
   * @param {number}        secs  Total seconds
   * @param {{ ringEl, numEl, btnEl }} els  DOM elements to drive
   */
  register(id, secs, els = {}) {
    if (this._timers[id]) this._stop(id);
    this._timers[id] = { total: secs, rem: secs, running: false, iv: null, els };
    this._render(id);
  }

  toggle(id) {
    const t = this._timers[id];
    if (!t) return;
    t.running ? this._stop(id) : this._start(id);
  }

  reset(id) {
    const t = this._timers[id];
    if (!t) return;
    this._stop(id);
    t.rem = t.total;
    this._render(id);
    this._emit("reset", { id });
  }

  resetAll() {
    Object.keys(this._timers).forEach(id => this.reset(id));
  }

  stopAll() {
    Object.keys(this._timers).forEach(id => this._stop(id));
  }

  getRem(id) {
    return this._timers[id]?.rem ?? 0;
  }

  // ── Private ─────────────────────────────────────────

  _start(id) {
    const t = this._timers[id];
    if (!t || t.running) return;
    if (t.rem <= 0) this.reset(id);
    t.running = true;
    this._render(id);
    t.iv = setInterval(() => {
      t.rem -= 1;
      this._render(id);
      if (t.rem <= 0) {
        this._stop(id);
        t.rem = 0;
        this._render(id);
        bell();
        this._emit("complete", { id });
      }
    }, 1000);
  }

  _stop(id) {
    const t = this._timers[id];
    if (!t) return;
    clearInterval(t.iv);
    t.iv      = null;
    t.running = false;
    this._render(id);
  }

  _render(id) {
    const t = this._timers[id];
    if (!t) return;
    const { rem, total, running, els } = t;
    const m   = Math.floor(rem / 60);
    const s   = rem % 60;
    const pct = total > 0 ? rem / total : 0;

    if (els.numEl) {
      els.numEl.textContent = `${m}:${s < 10 ? "0" : ""}${s}`;
    }
    if (els.ringEl) {
      // filled portion grows as time ticks down
      const filled = (1 - pct) * CIRCUMFERENCE;
      els.ringEl.style.strokeDashoffset = CIRCUMFERENCE - filled;
    }
    if (els.btnEl) {
      els.btnEl.textContent = running ? "PAUSE" : "START";
    }
  }
}

// ── Bell ─────────────────────────────────────────────────

/** Play a soft three-note chime using the Web Audio API. */
export function bell() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [
      { freq: 880,  gain: 0.22, offset: 0 },
      { freq: 1108, gain: 0.14, offset: 0.1 },
      { freq: 1318, gain: 0.10, offset: 0.22 },
    ];
    notes.forEach(({ freq, gain, offset }) => {
      const osc = ctx.createOscillator();
      const gn  = ctx.createGain();
      osc.connect(gn);
      gn.connect(ctx.destination);
      osc.type             = "sine";
      osc.frequency.value  = freq;
      gn.gain.setValueAtTime(gain, ctx.currentTime + offset);
      gn.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 2.0);
      osc.start(ctx.currentTime + offset);
      osc.stop (ctx.currentTime + offset + 2.0);
    });
  } catch (_) { /* audio API not available */ }
}

// ── Formatting util (also used in recorder) ──────────────

export function formatTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}
