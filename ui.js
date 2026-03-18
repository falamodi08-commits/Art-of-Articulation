/**
 * ui.js
 * ──────────────────────────────────────────────────────
 * All DOM manipulation lives here.
 * Functions receive state + topics as parameters — no globals.
 */

import { analyseOffline, wordList } from "./analysis.js";
import { topics } from "./topics.js";
// ── Header / progress ────────────────────────────────────

export function updateHeader(state) {
  const done = state.completed.length;
  const pct  = (done / 60) * 100;
  const fill = document.getElementById("hpFill");
  const lbl  = document.getElementById("hpLabel");
  if (fill) fill.style.width  = pct + "%";
  if (lbl)  lbl.textContent   = `${done} / 60`;
}

// ── List view ────────────────────────────────────────────

/**
 * Render all weeks and day rows.
 * @param {object}   state
 * @param {object[]} topics
 * @param {string[]} weekNames
 * @param {function} onStart   (dayNum) → void
 */
export function renderList(state, topics, weekNames, onStart) {
  const body = document.getElementById("listBody");
  if (!body) return;
  body.innerHTML = "";

  for (let w = 0; w < 9; w++) {
    const weekTopics = topics.slice(w * 7, Math.min((w + 1) * 7, topics.length));
    const section    = el("div", "week-section");
    const head       = el("div", "week-head", weekNames[w]);
    section.appendChild(head);

    weekTopics.forEach((t, di) => {
      const dn   = w * 7 + di + 1;
      const done = state.completed.includes(dn);
      const sess = state.sessions[dn];
      const row  = el("div", `day-row${done ? " completed" : ""}`);

      // Day number
      row.appendChild(el("div", "day-n", String(dn).padStart(2, "0")));

      // Info column
      const info = el("div");
      info.appendChild(el("div", "day-cat",   t.cat));
      info.appendChild(el("div", "day-topic", t.topic));

      // Mode badge
      const modeCls   = { P: "mode-P", I: "mode-I", E: "mode-E" }[t.mode] || "mode-E";
      const modeLabel = { P: "PERSUADE", I: "INFORM", E: "EXPLORE" }[t.mode] || "EXPLORE";
      const modeBadge = el("div");
      const chip = el("span");
      chip.className   = `mode-chip ${modeCls}`;
      chip.textContent = modeLabel;
      modeBadge.style.marginTop = "4px";
      modeBadge.appendChild(chip);
      info.appendChild(modeBadge);

      // Score mini-badges (if feedback has been run)
      if (sess?.scores) {
        const scoreRow = el("div", "day-info-score");
        const isAI     = sess.feedbackSource === "ai";
        ["clarity", "depth", "structure", "conviction", "overall"].forEach(d => {
          const badge = el("span", `score-mini${isAI ? " ai" : ""}`);
          badge.title       = d;
          badge.textContent = `${d[0].toUpperCase()}${sess.scores[d]}`;
          scoreRow.appendChild(badge);
        });
        info.appendChild(scoreRow);
      }

      // Actions
      const actions = el("div", "day-actions");
      const btn     = el("button", `start-btn${done ? " done-btn" : ""}`);
      btn.textContent = done ? "REDO" : "BEGIN";
      btn.addEventListener("click", e => { e.stopPropagation(); onStart(dn); });

      const check = el("div", "check-mark");
      check.innerHTML = `<svg viewBox="0 0 10 10"><polyline points="1,5 4,8 9,2"/></svg>`;
      actions.appendChild(btn);
      actions.appendChild(check);

      row.appendChild(info);
      row.appendChild(actions);
      row.addEventListener("click", () => onStart(dn));
      section.appendChild(row);
    });

    body.appendChild(section);
  }
}

// ── Mode injection ────────────────────────────────────────

export function injectModeUI(mode) {
  const cfg = modeCfg[mode] || modeCfg.E;

  const badgeHTML = `
    <div class="mode-badge mode-${mode}">
      <div class="mode-dot"></div>${cfg.label}
    </div>`;

  const guideHTML = `
    <div class="mode-guide">
      <div class="mode-guide-title">WHAT THIS MODE ASKS</div>
      <div class="mode-guide-text">${cfg.what}</div>
      <div class="mode-guide-tips">
        ${cfg.tips.map(t => `<div class="mode-tip"><span>${t.icon}</span><span>${t.text}</span></div>`).join("")}
      </div>
    </div>`;

  ["1", "2", "3"].forEach(n => {
    const el = document.getElementById(`modeBadge${n}`);
    if (el) el.innerHTML = badgeHTML;
  });
  const guide = document.getElementById("modeGuide1");
  if (guide) guide.innerHTML = guideHTML;

  const p2 = document.getElementById("p2desc");
  if (p2) p2.textContent = cfg.writeDesc;
  const p3 = document.getElementById("p3desc");
  if (p3) p3.textContent = cfg.speakDesc;
}

// ── Phase nav ─────────────────────────────────────────────

export function goToPhase(n) {
  // Panels
  document.querySelectorAll(".phase-panel").forEach(p => p.classList.remove("active"));
  const panel = document.getElementById(`phase${n}`);
  if (panel) panel.classList.add("active");

  // Sidebar items
  document.querySelectorAll(".phase-item").forEach((item, i) => {
    item.classList.remove("active", "done-phase");
    if (i === n - 1)       item.classList.add("active");
    else if (i < n - 1)    item.classList.add("done-phase");
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ── Session header ────────────────────────────────────────

export function setSessionHeader(dayNum, topic, completed) {
  const dayEl  = document.getElementById("sidebarDay");
  const topEl  = document.getElementById("sidebarTopic");
  const pTopic = document.getElementById("pTopic1");
  if (dayEl)  dayEl.textContent  = `DAY ${dayNum}`;
  if (topEl)  topEl.textContent  = topic;
  if (pTopic) pTopic.textContent = topic;

  const btn = document.getElementById("sessionCompleteBtn");
  if (btn) {
    btn.textContent = completed ? "COMPLETED ✓" : "MARK COMPLETE";
    btn.classList.toggle("is-done", !!completed);
  }
}

// ── Sidebar stats ─────────────────────────────────────────

export function updateSidebarStats(brainstorm, write, recordingCount) {
  const wc = wordList((brainstorm || "") + " " + (write || "")).length;
  const wEl = document.getElementById("sbWords");
  const rEl = document.getElementById("sbRecs");
  if (wEl) wEl.textContent = wc;
  if (rEl) rEl.textContent = recordingCount;
}

// ── Thinking coach ────────────────────────────────────────

export function renderCoach(brainstorm) {
  const card = document.getElementById("coachCard");
  if (!card) return;

  const lower = (brainstorm || "").toLowerCase();
  const qs    = [];

  qs.push(
    lower.includes("should") || lower.includes("must")
      ? "What assumptions are you making about what people should or must do here?"
      : "What assumptions are hiding beneath your notes that you haven't said out loud?"
  );
  qs.push(
    lower.includes("example") || lower.includes("story") || lower.includes("remember")
      ? "Which single example from your brainstorm best carries the entire idea — and why that one?"
      : "If you had to pick one story from your life to illustrate this, which would you choose?"
  );
  qs.push("If someone intelligent disagreed with you, where would they push back first — and how would you respond?");

  card.innerHTML = `
    <div class="coach-card">
      <div class="coach-card-lbl">THINKING COACH</div>
      ${qs.map((q, i) => `<div class="coach-q"><strong>Q${i + 1}.</strong> ${q}</div>`).join("")}
    </div>`;
}

// ── Constraints ───────────────────────────────────────────

export function renderConstraints(activeConstraints, onToggle) {
  const row = document.getElementById("constraintChips");
  if (!row) return;
  row.innerHTML = "";
  CONSTRAINTS.forEach(c => {
    const chip = el("span", `chip${activeConstraints[c.id] ? " on" : ""}`);
    chip.textContent = c.label;
    chip.addEventListener("click", () => onToggle(c.id));
    row.appendChild(chip);
  });
}

export function updateConstraintChip(id, active) {
  const chips = document.querySelectorAll(".chip");
  chips.forEach(chip => {
    if (chip.textContent === CONSTRAINTS.find(c => c.id === id)?.label) {
      chip.classList.toggle("on", active);
    }
  });
}

export function showViolations(text, constraints) {
  const violations = checkConstraints(text, constraints);
  const note       = document.getElementById("violationNote");
  if (!note) return;
  note.textContent = violations.join(" · ");
  note.classList.toggle("on", violations.length > 0);
}

// ── Recordings ────────────────────────────────────────────

export function renderRecordings(recordings, onDelete) {
  const list = document.getElementById("recordingsList");
  if (!list) return;
  list.innerHTML = "";
  if (!recordings.length) return;

  recordings.forEach((rec, i) => {
    const item = el("div", "recording-item");
    item.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:2px;min-width:90px">
        <span class="rec-num">${rec.label || "TAKE " + (i + 1)}</span>
        ${rec.ts ? `<span style="font-family:'DM Mono',monospace;font-size:9px;color:var(--muted)">${rec.ts}</span>` : ""}
      </div>
      <audio src="${rec.b64}" controls style="flex:1;height:32px"></audio>`;
    const del = el("button", "del-rec");
    del.textContent = "✕";
    del.title       = "Delete this take";
    del.addEventListener("click", () => onDelete(rec.id));
    item.appendChild(del);
    list.appendChild(item);
  });
}

// ── Ref panels in write/speak phases ────────────────────

export function updateRefPanels(brainstorm, write) {
  const bsRef = document.getElementById("brainstormRef");
  const spRef = document.getElementById("speechRef");
  if (bsRef) bsRef.textContent = brainstorm || "(nothing written yet)";
  if (spRef) spRef.textContent = write       || "(nothing written yet)";
}

// ── Word counts ───────────────────────────────────────────

export function updateWordCount(taId, wcId) {
  const ta = document.getElementById(taId);
  const wc = document.getElementById(wcId);
  if (!ta || !wc) return;
  const n = wordList(ta.value).length;
  wc.textContent = `${n} word${n !== 1 ? "s" : ""}`;
}

// ── View switching ────────────────────────────────────────

export function showView(id) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const target = document.getElementById(id);
  if (target) target.classList.add("active");
}

// ── Toast ─────────────────────────────────────────────────

export function toast(msg, duration = 3200) {
  const shelf = document.getElementById("toastShelf");
  if (!shelf) return;
  const t = el("div", "toast-item");
  t.textContent = msg;
  shelf.appendChild(t);
  setTimeout(() => {
    t.style.animation = "toastOut 0.25s ease forwards";
    setTimeout(() => t.remove(), 260);
  }, duration);
}

// ── Helpers ───────────────────────────────────────────────

function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text)      node.textContent = text;
  return node;
}
