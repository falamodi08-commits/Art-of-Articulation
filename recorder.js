/**
 * recorder.js
 * ──────────────────────────────────────────────────────
 * Wraps the MediaRecorder API.  Recordings are saved to
 * IndexedDB via storage.js so they don't eat localStorage quota.
 *
 * Usage:
 *   const rec = new Recorder({ onSave, onError, onTick });
 *   await rec.toggle(dayNum);   // start or stop
 *   rec.isRecording();          // boolean
 */

import { saveRecording, getRecordingsForDay, deleteRecording } from "./storage.js";
import { bell } from "./timers.js";

/** Prefer high-quality formats; fall back gracefully. */
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "",
];

function bestMimeType() {
  return MIME_CANDIDATES.find(m => !m || MediaRecorder.isTypeSupported(m)) ?? "";
}

async function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror   = reject;
    reader.readAsDataURL(blob);
  });
}

export class Recorder {
  /**
   * @param {object} opts
   * @param {function} opts.onSave   (recs: object[]) → void   called after each take is saved
   * @param {function} opts.onError  (msg: string)    → void
   * @param {function} opts.onTick   (secs: number)   → void   called every second while recording
   * @param {function} opts.onStart  ()               → void
   * @param {function} opts.onStop   ()               → void
   */
  constructor({ onSave = ()=>{}, onError = ()=>{}, onTick = ()=>{}, onStart = ()=>{}, onStop = ()=>{} } = {}) {
    this._onSave  = onSave;
    this._onError = onError;
    this._onTick  = onTick;
    this._onStart = onStart;
    this._onStop  = onStop;

    this._mr      = null;   // MediaRecorder instance
    this._chunks  = [];
    this._iv      = null;   // tick interval
    this._secs    = 0;
    this._dayNum  = null;
  }

  isRecording() {
    return !!(this._mr && this._mr.state === "recording");
  }

  /**
   * Start recording for the given day, or stop if already recording.
   * @param {number} dayNum
   */
  async toggle(dayNum) {
    if (this.isRecording()) {
      this._mr.stop();
      return;
    }
    this._dayNum = dayNum;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = bestMimeType();
      this._mr     = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      this._chunks = [];

      this._mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this._chunks.push(e.data);
      };

      this._mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        clearInterval(this._iv);
        this._onStop();
        await this._save();
      };

      this._mr.start(200);
      this._secs = 0;
      this._onStart();
      this._iv = setInterval(() => {
        this._secs += 1;
        this._onTick(this._secs);
      }, 1000);

    } catch (err) {
      this._onError(
        err.name === "NotAllowedError"
          ? "Microphone access denied. Check browser permissions."
          : "Could not start recording: " + err.message
      );
    }
  }

  /** Force-stop without saving (e.g. on session exit). */
  abort() {
    if (!this.isRecording()) return;
    this._mr.stream?.getTracks().forEach(t => t.stop());
    clearInterval(this._iv);
    this._mr = null;
  }

  // ── Private ────────────────────────────────────────

  async _save() {
    try {
      const mimeType = this._mr?.mimeType || "audio/webm";
      const blob     = new Blob(this._chunks, { type: mimeType });
      const b64      = await blobToDataURL(blob);
      const existing = await getRecordingsForDay(this._dayNum);
      const id       = `${this._dayNum}_${Date.now()}`;
      const now      = new Date();

      const rec = {
        id,
        dayNum:      this._dayNum,
        label:       `Take ${existing.length + 1}`,
        ts:          now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        b64,
        durationSec: this._secs,
      };

      await saveRecording(rec);
      const updated = await getRecordingsForDay(this._dayNum);
      this._onSave(updated);
    } catch (err) {
      this._onError("Failed to save recording. Try again.");
      console.error("Recorder _save error:", err);
    }
  }
}

// ── Re-export helpers used by UI ────────────────────────

export { getRecordingsForDay, deleteRecording, formatTime };
