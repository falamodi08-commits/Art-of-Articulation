/**
 * storage.js
 * ──────────────────────────────────────────────────────
 * Two-tier persistence:
 *   • App state (scores, text, progress) → localStorage (fast, synchronous)
 *   • Audio recordings (binary blobs)    → IndexedDB   (no 5 MB size limit)
 *
 * The recording ID is stored in the session object so state and IDB stay in sync.
 */

// ── localStorage ─────────────────────────────────────────

const LS_KEY = "aoa_v4";

function defaultState() {
  return { completed: [], sessions: {} };
}

export function loadState() {
  try {
    // Migrate from older keys
    for (const oldKey of ["aoa_v3", "artOfArticulation_v3", "artOfArticulation_v2"]) {
      const old = localStorage.getItem(oldKey);
      if (old) {
        const parsed = JSON.parse(old);
        // Normalise: older versions used different session shapes
        saveState(parsed);
        return parsed;
      }
    }
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : defaultState();
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("localStorage write failed:", e);
  }
}

/** Return the session object for a day, creating it if needed. */
export function getSession(state, day) {
  if (!state.sessions[day]) {
    state.sessions[day] = {
      brainstorm:      "",
      write:           "",
      speechNotes:     "",
      recordingIds:    [],   // IDs pointing into IndexedDB
      scores:          null,
      diagnostics:     null,
      feedbackSource:  "",
      rewriteChallenge:"",
      constraints:     {},
    };
  }
  return state.sessions[day];
}

// ── IndexedDB ─────────────────────────────────────────────

const DB_NAME    = "aoa_recordings";
const DB_VERSION = 1;
const STORE      = "recordings";

let _db = null;

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("dayNum", "dayNum", { unique: false });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror   = ()  => reject(req.error);
  });
}

/**
 * Save an audio recording to IndexedDB.
 * @param {object} rec  { id, dayNum, label, ts, b64, durationSec }
 */
export async function saveRecording(rec) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx    = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(rec);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("IDB saveRecording failed:", e);
  }
}

/**
 * Retrieve all recordings for a given day, ordered by insertion time.
 * @param {number} dayNum
 * @returns {Promise<object[]>}
 */
export async function getRecordingsForDay(dayNum) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx      = db.transaction(STORE, "readonly");
      const index   = tx.objectStore(STORE).index("dayNum");
      const results = [];
      const req     = index.openCursor(IDBKeyRange.only(dayNum));
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) { results.push(cursor.value); cursor.continue(); }
        else        { resolve(results.sort((a, b) => a.id.localeCompare(b.id))); }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    return [];
  }
}

/**
 * Delete a single recording by ID.
 * @param {string} id
 */
export async function deleteRecording(id) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("IDB deleteRecording failed:", e);
  }
}

/**
 * Delete ALL recordings for a day (used on clear-all).
 * @param {number} dayNum
 */
export async function deleteRecordingsForDay(dayNum) {
  const recs = await getRecordingsForDay(dayNum);
  await Promise.all(recs.map(r => deleteRecording(r.id)));
}

/**
 * Wipe everything from IndexedDB (used on full reset).
 */
export async function clearAllRecordings() {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("IDB clear failed:", e);
  }
}
