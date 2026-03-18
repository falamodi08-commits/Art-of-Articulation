/**
 * app.js  —  Art of Articulation
 * ──────────────────────────────────────────────────────
 * Entry point.  Imports all modules and wires them together.
 * Nothing here manipulates the DOM directly — that's ui.js's job.
 * Nothing here does I/O — that's storage.js's job.
 */

import { topics, weekNames }                                         from "./data/topics.js";
import { loadState, saveState, getSession,
         saveRecording, getRecordingsForDay, deleteRecording,
         clearAllRecordings }                                        from "./modules/storage.js";
import { TimerEngine, bell }                                         from "./modules/timers.js";
import { Recorder }                                                  from "./modules/recorder.js";
import { analyseOffline, wordList }                                  from "./modules/analysis.js";
import { renderFeedback, runOfflineFeedback, runAIFeedback }         from "./modules/feedback.js";
import { updateHeader, renderList, injectModeUI, goToPhase,
         setSessionHeader, updateSidebarStats, renderCoach,
         renderConstraints, updateConstraintChip, showViolations,
         renderRecordings, updateRefPanels, updateWordCount,
         showView, toast }                                           from "./modules/ui.js";

// ── App state ─────────────────────────────────────────────

let state      = loadState();
let currentDay = null;

// ── Timer engine ──────────────────────────────────────────

const timers = new TimerEngine();

timers.on("complete", ({ id }) => {
  const labels = { 1: "Brainstorm", 2: "Write", 3: "Speak" };
  const label  = labels[id];
  if (label) toast(`${label} time's up!`);
});

// ── Recorder ──────────────────────────────────────────────

const recorder = new Recorder({
  onStart() {
    document.getElementById("recBtn")?.classList.add("recording");
    document.getElementById("recTime")?.classList.add("visible");
    document.getElementById("recStatus").textContent = "RECORDING · TAP TO STOP";
  },
  onStop() {
    document.getElementById("recBtn")?.classList.remove("recording");
    document.getElementById("recTime")?.classList.remove("visible");
    document.getElementById("recStatus").textContent = "SAVING…";
  },
  onTick(secs) {
    const m  = Math.floor(secs / 60);
    const s  = secs % 60;
    const el = document.getElementById("recTime");
    if (el) el.textContent = `${m}:${s < 10 ? "0" : ""}${s}`;
  },
  async onSave(recs) {
    document.getElementById("recStatus").textContent = "SAVED · TAP FOR ANOTHER TAKE";
    renderRecordings(recs, deleteRec);
    if (currentDay) {
      const sess = getSession(state, currentDay);
      sess.recordingIds = recs.map(r => r.id);
      saveState(state);
      updateSidebarStats(sess.brainstorm, sess.write, recs.length);
    }
  },
  onError(msg) {
    document.getElementById("recStatus").textContent = msg;
    toast(msg);
  },
});

// ── Core navigation ───────────────────────────────────────

function startSession(dayNum) {
  currentDay = dayNum;
  state      = loadState(); // refresh from storage
  const sess = getSession(state, dayNum);
  const t    = topics[dayNum - 1];

  // Reset timers and re-register
  timers.resetAll();
  timers.register(1, 300, timerEls(1));
  timers.register(2, 600, timerEls(2));
  timers.register(3, 300, timerEls(3));

  // Populate DOM
  setSessionHeader(dayNum, t.topic, state.completed.includes(dayNum));
  injectModeUI(t.mode || "E");
  document.getElementById("pHint1").textContent = t.prompt;

  const bsTa = document.getElementById("brainstormText");
  const wrTa = document.getElementById("writeText");
  if (bsTa) bsTa.value = sess.brainstorm || "";
  if (wrTa) wrTa.value = sess.write      || "";

  updateWordCount("brainstormText", "wc1");
  updateWordCount("writeText",      "wc2");

  renderConstraints(sess.constraints || {}, toggleConstraint);

  // Load recordings from IDB
  getRecordingsForDay(dayNum).then(recs => {
    renderRecordings(recs, deleteRec);
    const status = recs.length ? "TAP TO RECORD ANOTHER TAKE" : "TAP TO START RECORDING";
    document.getElementById("recStatus").textContent = status;
    updateSidebarStats(sess.brainstorm, sess.write, recs.length);
  });

  // Reset feedback panel
  const fc = document.getElementById("feedbackContent");
  const fl = document.getElementById("feedbackLoading");
  const cb = document.getElementById("completeBtn");
  if (fc) { fc.innerHTML = ""; fc.classList.remove("visible"); }
  if (fl) fl.style.display = "none";
  if (cb) cb.classList.remove("show");

  document.getElementById("recTime")?.classList.remove("visible");
  document.getElementById("recBtn")?.classList.remove("recording");

  showView("sessionView");
  goToPhase(1);
}

function exitSession() {
  recorder.abort();
  timers.stopAll();
  currentDay = null;
  showView("listView");
  renderList(state, topics, weekNames, startSession);
  updateHeader(state);
}

// ── Phase change ──────────────────────────────────────────

function changePhase(n) {
  if (currentDay) persistTextareas();

  goToPhase(n);

  if (n === 2) {
    const sess = getSession(state, currentDay);
    updateRefPanels(sess.brainstorm, sess.write);
    const coachOn = document.getElementById("coachToggle")?.checked;
    if (coachOn) renderCoach(sess.brainstorm);
    showViolations(sess.write || "", sess.constraints || {});
  }

  if (n === 3) {
    const sess = getSession(state, currentDay);
    updateRefPanels(sess.brainstorm, sess.write);
    getRecordingsForDay(currentDay).then(recs => renderRecordings(recs, deleteRec));
  }

  if (n === 4) {
    const sess = getSession(state, currentDay);
    // Restore previously saved feedback if available
    if (sess.scores && sess.diagnostics) {
      const result = {
        ...sess.scores,
        ...sess.diagnostics,
        challenge: sess.rewriteChallenge,
      };
      const els = feedbackEls();
      renderFeedback(result, sess.feedbackSource === "ai", els);
    }
  }
}

// ── Feedback paths ────────────────────────────────────────

function triggerOfflineFeedback() {
  if (!currentDay) return;
  persistTextareas();
  const sess = getSession(state, currentDay);
  getRecordingsForDay(currentDay).then(recs => {
    runOfflineFeedback(
      { brainstorm: sess.brainstorm, write: sess.write, speechNotes: sess.speechNotes, recordings: recs },
      feedbackEls(),
      (result, source) => saveFeedbackResult(result, source)
    );
  });
}

async function triggerAIFeedback() {
  if (!currentDay) return;
  persistTextareas();
  const sess  = getSession(state, currentDay);
  const t     = topics[currentDay - 1];
  await runAIFeedback(
    { topic: t.topic, brainstorm: sess.brainstorm, write: sess.write, speechNotes: sess.speechNotes },
    { ...feedbackEls(), aiBtnEl: document.getElementById("aiFeedbackBtn") },
    (result, source) => saveFeedbackResult(result, source)
  );
}

function saveFeedbackResult(result, source) {
  if (!currentDay) return;
  const sess         = getSession(state, currentDay);
  sess.scores        = { clarity: result.clarity, depth: result.depth, structure: result.structure, conviction: result.conviction, overall: result.overall };
  sess.diagnostics   = { bestSentence: result.bestSentence, whatWorked: result.whatWorked, priority: result.priority, secondary: result.secondary, tomorrow: result.tomorrow, diag: result.diag, heatmap: result.heatmap };
  sess.rewriteChallenge = result.challenge || "";
  sess.feedbackSource   = source;
  saveState(state);
}

// ── Day completion ────────────────────────────────────────

function toggleDayComplete() {
  if (!currentDay) return;
  const alreadyDone = state.completed.includes(currentDay);
  if (alreadyDone) {
    state.completed = state.completed.filter(d => d !== currentDay);
  } else {
    state.completed.push(currentDay);
  }
  saveState(state);
  setSessionHeader(currentDay, topics[currentDay - 1]?.topic, !alreadyDone);
  updateHeader(state);
  renderList(state, topics, weekNames, startSession);
  if (!alreadyDone) toast(`Day ${currentDay} complete! See you tomorrow.`);
}

// ── Constraints ───────────────────────────────────────────

function toggleConstraint(id) {
  if (!currentDay) return;
  const sess        = getSession(state, currentDay);
  sess.constraints  = sess.constraints || {};
  sess.constraints[id] = !sess.constraints[id];
  saveState(state);
  updateConstraintChip(id, sess.constraints[id]);
  showViolations(sess.write || "", sess.constraints);
}

// ── Delete recording ──────────────────────────────────────

async function deleteRec(recId) {
  if (!currentDay) return;
  await deleteRecording(recId);
  const recs = await getRecordingsForDay(currentDay);
  // Re-label remaining takes
  recs.forEach(async (r, i) => {
    r.label = `Take ${i + 1}`;
    await saveRecording(r);
  });
  renderRecordings(await getRecordingsForDay(currentDay), deleteRec);
  const sess = getSession(state, currentDay);
  sess.recordingIds = recs.map(r => r.id);
  saveState(state);
  updateSidebarStats(sess.brainstorm, sess.write, recs.length);
}

// ── Export / Import ───────────────────────────────────────

function exportJSON() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  downloadFile(blob, "aoa-backup.json");
  toast("JSON backup downloaded.");
}

function exportText() {
  let txt = "ART OF ARTICULATION — WRITING ARCHIVE\n" + "=".repeat(44) + "\n\n";
  for (let i = 1; i <= 60; i++) {
    const s = state.sessions[i];
    if (!s?.brainstorm && !s?.write) continue;
    txt += `DAY ${i} — ${topics[i - 1]?.topic || ""}\n${"-".repeat(40)}\n`;
    if (s.brainstorm)  txt += `BRAINSTORM:\n${s.brainstorm}\n\n`;
    if (s.write)       txt += `WRITING:\n${s.write}\n\n`;
    if (s.scores)      txt += `SCORES: C${s.scores.clarity} D${s.scores.depth} S${s.scores.structure} K${s.scores.conviction} O${s.scores.overall}\n`;
    txt += "\n";
  }
  downloadFile(new Blob([txt], { type: "text/plain" }), "aoa-writing.txt");
  toast("Writing archive downloaded.");
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.sessions || data.completed) {
        state = data;
        saveState(state);
        renderList(state, topics, weekNames, startSession);
        updateHeader(state);
        modal("importModal", false);
        toast("Data imported successfully!");
      } else {
        toast("Invalid file format.");
      }
    } catch {
      toast("Could not parse file.");
    }
  };
  reader.readAsText(file);
}

async function clearAll() {
  if (!confirm("Permanently delete all progress? This cannot be undone.")) return;
  state = { completed: [], sessions: {} };
  saveState(state);
  await clearAllRecordings();
  renderList(state, topics, weekNames, startSession);
  updateHeader(state);
  modal("importModal", false);
  toast("All data cleared.");
}

// ── Utilities ─────────────────────────────────────────────

function persistTextareas() {
  if (!currentDay) return;
  const sess = getSession(state, currentDay);
  const bsTa = document.getElementById("brainstormText");
  const wrTa = document.getElementById("writeText");
  if (bsTa) sess.brainstorm = bsTa.value;
  if (wrTa) sess.write      = wrTa.value;
  saveState(state);
}

function timerEls(n) {
  return {
    ringEl: document.getElementById(`t${n}ring`),
    numEl:  document.getElementById(`t${n}num`),
    btnEl:  document.getElementById(`t${n}btn`),
  };
}

function feedbackEls() {
  return {
    loadingEl:     document.getElementById("feedbackLoading"),
    contentEl:     document.getElementById("feedbackContent"),
    completeBtnEl: document.getElementById("completeBtn"),
  };
}

function downloadFile(blob, filename) {
  const a   = document.createElement("a");
  a.href    = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function modal(id, open) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("on", open);
}

// ── Event listeners ───────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  // Initial render
  renderList(state, topics, weekNames, startSession);
  updateHeader(state);

  // Phase nav sidebar
  [1, 2, 3, 4].forEach(n => {
    document.getElementById(`sNav${n}`)?.addEventListener("click", () => changePhase(n));
  });

  // Phase "next" buttons
  document.getElementById("goPhase2")?.addEventListener("click", () => changePhase(2));
  document.getElementById("goPhase3")?.addEventListener("click", () => changePhase(3));
  document.getElementById("goPhase4")?.addEventListener("click", () => changePhase(4));

  // Exit / complete
  document.getElementById("exitSessionBtn")?.addEventListener("click", exitSession);
  document.getElementById("completeBtn")?.addEventListener("click", () => { toggleDayComplete(); exitSession(); });
  document.getElementById("sessionCompleteBtn")?.addEventListener("click", toggleDayComplete);

  // Feedback buttons
  document.getElementById("offlineFeedbackBtn")?.addEventListener("click", triggerOfflineFeedback);
  document.getElementById("aiFeedbackBtn")?.addEventListener("click", triggerAIFeedback);

  // Recorder
  document.getElementById("recBtn")?.addEventListener("click", () => {
    if (currentDay) recorder.toggle(currentDay);
  });

  // Live textarea save + word count + violations
  document.getElementById("brainstormText")?.addEventListener("input", (e) => {
    if (!currentDay) return;
    const sess       = getSession(state, currentDay);
    sess.brainstorm  = e.target.value;
    saveState(state);
    updateWordCount("brainstormText", "wc1");
    updateSidebarStats(sess.brainstorm, sess.write, (sess.recordingIds || []).length);
  });

  document.getElementById("writeText")?.addEventListener("input", (e) => {
    if (!currentDay) return;
    const sess  = getSession(state, currentDay);
    sess.write  = e.target.value;
    saveState(state);
    updateWordCount("writeText", "wc2");
    showViolations(sess.write, sess.constraints || {});
    updateSidebarStats(sess.brainstorm, sess.write, (sess.recordingIds || []).length);
  });

  // Thinking coach toggle
  document.getElementById("coachToggle")?.addEventListener("change", (e) => {
    const card = document.getElementById("coachCard");
    if (!card) return;
    if (e.target.checked && currentDay) {
      const sess = getSession(state, currentDay);
      renderCoach(sess.brainstorm || "");
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }
  });

  // Modals
  document.getElementById("exportBtn")?.addEventListener("click", () => modal("exportModal", true));
  document.getElementById("importBtn")?.addEventListener("click", () => modal("importModal", true));
  document.getElementById("closeExportModal")?.addEventListener("click", () => modal("exportModal", false));
  document.getElementById("closeImportModal")?.addEventListener("click", () => modal("importModal", false));

  document.getElementById("doExportJson")?.addEventListener("click", exportJSON);
  document.getElementById("doExportTxt")?.addEventListener("click",  exportText);
  document.getElementById("doClearAll")?.addEventListener("click",   clearAll);

  document.getElementById("doImportSelect")?.addEventListener("click", () => {
    document.getElementById("importFileInput")?.click();
  });
  document.getElementById("importFileInput")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) importJSON(file);
    e.target.value = "";
  });

  // Close modals on backdrop click
  ["exportModal", "importModal"].forEach(id => {
    document.getElementById(id)?.addEventListener("click", e => {
      if (e.target === e.currentTarget) modal(id, false);
    });
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT") return;

    const inSession = document.getElementById("sessionView")?.classList.contains("active");
    if (!inSession) return;

    // Space → toggle active phase timer
    if (e.code === "Space") {
      e.preventDefault();
      const activePanel = document.querySelector(".phase-panel.active");
      if (!activePanel) return;
      const n = parseInt(activePanel.id.replace("phase", ""), 10);
      if (n >= 1 && n <= 3) timers.toggle(n);
    }

    // Arrow keys → switch phases
    if (e.key === "ArrowRight") {
      const active = document.querySelector(".phase-panel.active");
      if (!active) return;
      const n = parseInt(active.id.replace("phase", ""), 10);
      if (n < 4) changePhase(n + 1);
    }
    if (e.key === "ArrowLeft") {
      const active = document.querySelector(".phase-panel.active");
      if (!active) return;
      const n = parseInt(active.id.replace("phase", ""), 10);
      if (n > 1) changePhase(n - 1);
    }

    // Escape → exit session
    if (e.key === "Escape") exitSession();
  });

  // Register service worker for offline / PWA support
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js")
      .catch(err => console.warn("SW registration failed:", err));
  }
});
