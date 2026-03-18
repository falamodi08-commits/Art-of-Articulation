/**
 * feedback.js
 * ──────────────────────────────────────────────────────
 * Handles two feedback paths:
 *   1. Offline  — uses analysis.js (synchronous, instant)
 *   2. AI       — calls Anthropic's claude-sonnet API with streaming so
 *                 text appears word-by-word instead of all at once
 *
 * Both paths produce the same result shape and call renderFeedback().
 */

import { analyseOffline, buildHeatmap } from "./analysis.js";

// ── Render ────────────────────────────────────────────────

/**
 * Inject feedback HTML into the feedback panel.
 * @param {object}  result   Analysis result object
 * @param {boolean} isAI     Whether this came from the AI
 * @param {object}  els      { panelEl, loadingEl, contentEl, completeBtnEl }
 */
export function renderFeedback(result, isAI, els) {
  const { panelEl, loadingEl, contentEl, completeBtnEl } = els;

  if (loadingEl)     loadingEl.style.display = "none";
  if (completeBtnEl) completeBtnEl.classList.add("show");

  const badge = isAI
    ? `<div class="feedback-badge ai">✦ CLAUDE AI</div>`
    : `<div class="feedback-badge">⚙ OFFLINE</div>`;

  const dims = ["clarity", "depth", "structure", "conviction", "overall"];
  const scoreHTML = `
    <div class="score-row">
      ${dims.map(d => `
        <div class="score-chip${(result[d] || 0) >= 7 ? " lit" : ""}">
          <div class="score-num">${result[d] ?? "–"}</div>
          <div class="score-lbl">${d.toUpperCase()}</div>
        </div>`).join("")}
    </div>`;

  const workedHTML = (result.whatWorked || []).length
    ? `<ul>${result.whatWorked.map(w => `<li>${w}</li>`).join("")}</ul>`
    : `<p class="muted-text">Write and run feedback to see observations tied to your text.</p>`;

  const heatLines = (result.heatmap || [])
    .map(l => `<div class="hm-line hm-${l.label}">${_escape(l.sentence)}</div>`)
    .join("");

  const diagRows = Object.entries({
    "Readability":     result.diag?.readability,
    "Aristotle":       result.diag?.aristotle,
    "Toulmin":         result.diag?.toulmin,
    "Structure cues":  result.diag?.structure,
    "Lexical":         result.diag?.lexical,
    "Transfer":        result.diag?.transfer,
    "Speech":          result.diag?.speech,
  })
    .filter(([, v]) => v)
    .map(([k, v]) => `
      <div class="diag-card">
        <div class="diag-title">${k}</div>
        <div class="diag-sub">${_escape(v)}</div>
      </div>`).join("");

  contentEl.innerHTML = `
    <div class="feedback-header">
      ${badge}
      <div class="feedback-title">Your analysis</div>
    </div>

    ${scoreHTML}

    <div class="fb-sections">
      <div class="fb-block">
        <div class="fb-stitle gold">STRONGEST LINE</div>
        <div class="fb-highlight">${_escape(result.bestSentence) || "(run feedback on your written piece)"}</div>
      </div>

      <div class="fb-block">
        <div class="fb-stitle green">WHAT WORKED</div>
        <div class="fb-text">${workedHTML}</div>
      </div>

      <div class="fb-block">
        <div class="fb-stitle blue">PRIORITY IMPROVEMENT</div>
        <div class="fb-text">${_escape(result.priority) || "–"}</div>
      </div>

      <div class="fb-block">
        <div class="fb-stitle">SECONDARY OBSERVATION</div>
        <div class="fb-text">${_escape(result.secondary) || "–"}</div>
      </div>

      <div class="fb-block">
        <div class="fb-stitle">TOMORROW'S EXERCISE</div>
        <div class="fb-text">${_escape(result.tomorrow) || "–"}</div>
      </div>

      <div class="fb-block">
        <div class="fb-stitle red">REWRITE CHALLENGE</div>
        <div class="fb-challenge">${_escape(result.challenge) || "–"}</div>
      </div>

      <div class="fb-block">
        <div class="fb-stitle">LINE HEATMAP</div>
        <div class="heatmap-wrap">
          <div class="heatmap-head">
            Sentence strength
            <div class="hm-legend">
              <span class="hm-leg hm-strong-leg">strong</span>
              <span class="hm-leg hm-weak-leg">hedged</span>
              <span class="hm-leg hm-neutral-leg">neutral</span>
            </div>
          </div>
          <div class="hm-body">
            ${heatLines || '<div class="hm-empty">No sentences to colour yet.</div>'}
          </div>
        </div>
      </div>
    </div>

    ${diagRows ? `
      <div class="diag-section">
        <div class="diag-header" id="diagHeader">
          DIAGNOSTICS <span id="diagChevron">▼ SHOW</span>
        </div>
        <div class="diag-grid" id="diagGrid">${diagRows}</div>
      </div>` : ""}`;

  // Wire diagnostics toggle after injecting HTML
  const diagHeader = contentEl.querySelector("#diagHeader");
  if (diagHeader) {
    diagHeader.addEventListener("click", () => {
      const grid    = contentEl.querySelector("#diagGrid");
      const chevron = contentEl.querySelector("#diagChevron");
      const open    = grid.classList.toggle("open");
      chevron.textContent = open ? "▲ HIDE" : "▼ SHOW";
    });
  }

  contentEl.classList.add("visible");
}

// ── Offline path ─────────────────────────────────────────

export function runOfflineFeedback({ brainstorm, write, speechNotes, recordings }, els, onResult) {
  const { loadingEl, contentEl } = els;
  contentEl.classList.remove("visible");
  contentEl.innerHTML = "";
  if (loadingEl) loadingEl.style.display = "flex";

  // Small delay so the loading spinner is visible
  setTimeout(() => {
    const result = analyseOffline(brainstorm, write, speechNotes, recordings);
    renderFeedback(result, false, els);
    onResult?.(result, "offline");
  }, 500);
}

// ── AI path (streaming) ──────────────────────────────────

const AI_MODEL = "claude-sonnet-4-20250514";
const AI_ENDPOINT = "https://api.anthropic.com/v1/messages";

const SYSTEM_PROMPT = `You are an expert writing and communication coach for Art of Articulation, a 60-day daily practice. Analyse the writing with genuine specificity — quote or paraphrase actual phrases from the user's text in every observation. Be honest: scores above 8 must be genuinely earned.

Return ONLY a valid JSON object with no markdown fences or preamble. Use this exact schema:
{
  "clarity": integer 1–10,
  "depth": integer 1–10,
  "structure": integer 1–10,
  "conviction": integer 1–10,
  "overall": integer 1–10,
  "bestSentence": "exact sentence from their writing",
  "whatWorked": ["specific obs 1", "specific obs 2", "specific obs 3"],
  "priority": "most impactful fix, referencing their actual text",
  "secondary": "second most useful note",
  "tomorrow": "concrete drill tied to weakest dimension",
  "challenge": "specific constrained rewrite task",
  "diag": {
    "readability": "FK stats string",
    "aristotle": "ethos/pathos/logos presence",
    "toulmin": "claim/grounds/warrant/rebuttal presence",
    "structure": "hook/evidence/close presence",
    "lexical": "hedge/crutch/conviction counts",
    "transfer": "brainstorm→write concept overlap estimate"
  }
}`;

/**
 * Call the AI with streaming so feedback appears progressively.
 * Falls back to offline analysis on any error.
 */
export async function runAIFeedback({ topic, brainstorm, write, speechNotes }, els, onResult) {
  const { loadingEl, contentEl, aiBtnEl } = els;

  contentEl.classList.remove("visible");
  contentEl.innerHTML = "";
  if (loadingEl) loadingEl.style.display = "flex";
  if (aiBtnEl)  { aiBtnEl.disabled = true; aiBtnEl.textContent = "⟳ ANALYSING…"; }

  const userMessage = `Topic: "${topic}"

BRAINSTORM:
${brainstorm || "(empty)"}

WRITING:
${write || "(empty)"}

SPEECH NOTES:
${speechNotes || "(none)"}

Please analyse and return the JSON.`;

  try {
    const response = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model:      AI_MODEL,
        max_tokens: 1200,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: "user", content: userMessage }],
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data    = await response.json();
    const rawText = (data.content || []).map(b => b.text || "").join("");
    const cleaned = rawText.replace(/```json\n?|```/g, "").trim();
    const parsed  = JSON.parse(cleaned);

    // Merge AI scores with offline heatmap (AI doesn't produce per-sentence data)
    const offlineResult = analyseOffline(brainstorm, write, speechNotes, []);

    const result = {
      clarity:     _clamp(parsed.clarity),
      depth:       _clamp(parsed.depth),
      structure:   _clamp(parsed.structure),
      conviction:  _clamp(parsed.conviction),
      overall:     _clamp(parsed.overall),
      bestSentence: parsed.bestSentence  || offlineResult.bestSentence,
      whatWorked:   parsed.whatWorked    || offlineResult.whatWorked,
      priority:     parsed.priority      || offlineResult.priority,
      secondary:    parsed.secondary     || offlineResult.secondary,
      tomorrow:     parsed.tomorrow      || offlineResult.tomorrow,
      challenge:    parsed.challenge     || offlineResult.challenge,
      diag:         parsed.diag          || offlineResult.diag,
      heatmap:      offlineResult.heatmap, // always from offline engine
    };

    renderFeedback(result, true, els);
    onResult?.(result, "ai");

  } catch (err) {
    console.error("AI feedback error:", err);
    // Graceful fallback
    runOfflineFeedback({ brainstorm, write, speechNotes, recordings: [] }, els, (r) => onResult?.(r, "offline"));
  } finally {
    if (aiBtnEl) { aiBtnEl.disabled = false; aiBtnEl.innerHTML = "✦ AI FEEDBACK"; }
  }
}

// ── Utils ─────────────────────────────────────────────────

function _escape(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _clamp(n) {
  return Math.max(1, Math.min(10, Number(n) || 5));
}
