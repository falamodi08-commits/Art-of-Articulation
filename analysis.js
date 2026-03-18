/**
 * analysis.js
 * ──────────────────────────────────────────────────────
 * Pure functions — no DOM, no side effects.
 * Takes text strings, returns structured score objects.
 *
 * Scoring model:
 *   Clarity    — readability, sentence rhythm, hedge/crutch penalty
 *   Depth      — Toulmin argument structure, Aristotle, idea density
 *   Structure  — PEEL, hook, closing strength, Monroe's sequence
 *   Conviction — conviction markers, hedge ratio, ethos presence
 *   Overall    — weighted average (C×0.3, D×0.3, S×0.2, K×0.2)
 */

// ── Phrase lists ──────────────────────────────────────────

export const PHRASES = {
  hedge:     ["kind of","sort of","maybe","I guess","perhaps","a bit","could be","seems like","not sure","I think maybe","kind of like"],
  conviction:["I believe","I know","without doubt","clearly","I am certain","the fact is","I'm convinced","undoubtedly","absolutely"],
  crutch:    ["basically","literally","actually","just","very","really","like","you know","I mean","things","stuff","a lot","kind of","sort of"],
  ethos:     ["in my experience","I've seen","as someone who","from what I've observed","having worked","I've learned"],
  pathos:    ["imagine","feel","fear","hope","struggle","we all","everyone","heart","pain","joy","dream","loss","grief"],
  logos:     ["because","therefore","evidence","for example","research shows","data suggests","this means","which proves","consequently"],
  tClaim:    ["I believe","I think","I argue","I maintain","my position is","I contend"],
  tGrounds:  ["because","since","given that","due to","the reason is","as shown by"],
  tWarrant:  ["this means","this shows","this suggests","ultimately","at its core","which demonstrates","the implication"],
  tRebuttal: ["however","but","although","that said","to be fair","admittedly","one could argue","critics might say"],
  peelEv:    ["for example","for instance","such as","I remember","to illustrate","consider","take the case of"],
  hooks:     ["imagine","picture","what if","have you ever","most people","let me tell you","there's a moment","here's the thing"],
  closings:  ["in the end","ultimately","the takeaway","my point is","so the next time","what this means is","to sum up","the real question"],
};

export const CONSTRAINTS = [
  { id: "noCrutch",  label: "NO CRUTCH WORDS"      },
  { id: "metaphor",  label: "MUST USE A METAPHOR"   },
  { id: "rebuttal",  label: "MUST INCLUDE REBUTTAL" },
  { id: "max120",    label: "MAX 120 WORDS"         },
];

// ── Text utilities ────────────────────────────────────────

export function wordList(text) {
  return (text || "")
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0);
}

export function sentenceList(text) {
  return (text || "")
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 3);
}

export function paragraphList(text) {
  return (text || "")
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 10);
}

/** Count syllables in a word (Moby algorithm approximation). */
function syllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (word.length <= 3) return 1;
  word = word
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const m = word.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}

/**
 * Count occurrences of any phrase from the list in the text.
 * Uses word-boundary matching where possible.
 */
export function countPhrases(text, phrases) {
  const lower = (text || "").toLowerCase();
  let n = 0;
  for (const phrase of phrases) {
    const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re      = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$|[.,!?])`, "g");
    const matches = lower.match(re);
    if (matches) n += matches.length;
  }
  return n;
}

export function hasPhrases(text, phrases) {
  return countPhrases(text, phrases) > 0;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

// ── Flesch-Kincaid ────────────────────────────────────────

export function readabilityStats(text) {
  const words = wordList(text);
  const sents = sentenceList(text);
  const nW    = Math.max(1, words.length);
  const nS    = Math.max(1, sents.length);
  const nSyl  = words.reduce((acc, w) => acc + syllables(w), 0);
  const wps   = nW / nS;
  const spw   = nSyl / nW;
  const ease  = 206.835 - 1.015 * wps - 84.6 * spw;
  const grade = 0.39  * wps + 11.8 * spw - 15.59;

  const sentLens = sents.map(s => wordList(s).length);
  const meanLen  = sentLens.reduce((a, b) => a + b, 0) / Math.max(1, sentLens.length);
  const variance = sentLens.length > 1
    ? Math.sqrt(sentLens.reduce((a, l) => a + (l - meanLen) ** 2, 0) / (sentLens.length - 1))
    : 0;

  return { words: nW, sentences: nS, syllables: nSyl, wps, spw, ease, grade, variance, sentLens };
}

// ── Transfer rate ─────────────────────────────────────────

/** Fraction of brainstorm content words that appear in the written piece. */
function transferRate(brainstorm, write) {
  const bWords = new Set(wordList(brainstorm).filter(w => w.length > 4).map(w => w.toLowerCase()));
  const wWords = wordList(write).filter(w => w.length > 4).map(w => w.toLowerCase());
  if (!bWords.size || !wWords.length) return 0;
  const overlap = wWords.filter(w => bWords.has(w)).length;
  return Math.round((overlap / wWords.length) * 100);
}

// ── Best sentence ─────────────────────────────────────────

function bestSentence(text) {
  const sents = sentenceList(text);
  if (!sents.length) return "";
  let best = sents[0], bestScore = -Infinity;
  for (const s of sents) {
    const score =
      countPhrases(s, PHRASES.conviction) * 3 +
      countPhrases(s, PHRASES.peelEv)     * 2 +
      countPhrases(s, PHRASES.logos)      * 2 +
      countPhrases(s, PHRASES.pathos)         -
      countPhrases(s, PHRASES.hedge)      * 2 -
      countPhrases(s, PHRASES.crutch);
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

// ── Heatmap ───────────────────────────────────────────────

export function buildHeatmap(text) {
  return sentenceList(text).map(sentence => {
    const h = countPhrases(sentence, PHRASES.hedge);
    const c = countPhrases(sentence, PHRASES.crutch);
    const k = countPhrases(sentence, PHRASES.conviction);
    const l = countPhrases(sentence, PHRASES.logos);
    const p = countPhrases(sentence, PHRASES.peelEv);

    let label = "neutral";
    if ((k > 0 || l > 0 || p > 0) && h === 0 && c <= 1) label = "strong";
    else if (h > 0 || c > 2) label = "weak";
    return { sentence, label };
  });
}

// ── Constraint violations ─────────────────────────────────

export function checkConstraints(text, constraints) {
  const violations = [];
  if (constraints.noCrutch) {
    const found = PHRASES.crutch.filter(w => countPhrases(text, [w]) > 0);
    if (found.length) violations.push(`Crutch words found: ${found.slice(0, 5).join(", ")}`);
  }
  if (constraints.max120 && wordList(text).length > 120) {
    violations.push(`Over limit: ${wordList(text).length} / 120 words`);
  }
  if (constraints.rebuttal && !hasPhrases(text, PHRASES.tRebuttal)) {
    violations.push("No rebuttal phrase yet — try: however, but, admittedly…");
  }
  if (constraints.metaphor) {
    // Rough heuristic: look for "like a", "as a", "is a kind of", "reminds me of"
    const metRe = /\b(like a|as a|is a kind of|reminds me of|as if|metaphor)\b/i;
    if (!metRe.test(text)) violations.push("No metaphor detected yet.");
  }
  return violations;
}

// ── Main analysis function ────────────────────────────────

/**
 * Full offline analysis.
 * @param {string} brainstorm
 * @param {string} write
 * @param {string} speechNotes  (optional)
 * @param {object[]} recordings (optional, for pacing estimate)
 * @returns {AnalysisResult}
 */
export function analyseOffline(brainstorm = "", write = "", speechNotes = "", recordings = []) {
  const bs = brainstorm.trim();
  const sp = write.trim();
  const st = readabilityStats(sp || "placeholder.");

  // Phrase counts
  const hedges  = countPhrases(sp, PHRASES.hedge);
  const crutch  = countPhrases(sp, PHRASES.crutch);
  const conv    = countPhrases(sp, PHRASES.conviction);
  const ethos   = countPhrases(sp, PHRASES.ethos);
  const pathos  = countPhrases(sp, PHRASES.pathos);
  const logos   = countPhrases(sp, PHRASES.logos);

  // Toulmin
  const hasClaim    = hasPhrases(sp, PHRASES.tClaim);
  const hasGrounds  = hasPhrases(sp, PHRASES.tGrounds);
  const hasWarrant  = hasPhrases(sp, PHRASES.tWarrant);
  const hasRebuttal = hasPhrases(sp, PHRASES.tRebuttal);

  // Structure
  const hasEvidence = hasPhrases(sp, PHRASES.peelEv);
  const hasHook     = hasPhrases(sp, PHRASES.hooks);
  const hasClose    = hasPhrases(sp, PHRASES.closings);

  const xfer = transferRate(bs, sp);

  // ── Scoring ───────────────────────────────────────

  // Clarity: readability, rhythm, penalties
  let clarity = 7;
  if (st.ease > 70)   clarity += 2;
  else if (st.ease < 40) clarity -= 2;
  else if (st.ease < 55) clarity -= 1;
  if (st.variance >= 4) clarity += 1;       // good sentence variation is a bonus
  else if (st.variance < 1.5) clarity -= 1; // all sentences the same length — monotonous
  clarity -= Math.min(2, Math.floor(hedges / 3));
  clarity -= Math.min(2, Math.floor(crutch / 5));
  clarity = clamp(clarity, 1, 10);

  // Depth: argument structure, rhetoric, density
  let depth = 5;
  depth += [hasClaim, hasGrounds, hasWarrant, hasRebuttal].filter(Boolean).length; // max +4
  depth += Math.min(2, (ethos > 0) + (logos > 0) + (pathos > 0));                 // max +2
  if (hasEvidence)          depth += 1;
  if (st.wps > 15)          depth += 1; // longer sentences can carry more nuance
  if (xfer > 50)            depth += 1; // carried ideas from brainstorm into write
  if (st.words > 150)       depth += 1; // enough length to develop ideas
  depth = clamp(depth, 1, 10);

  // Structure: hook, PEEL, closing, coherence
  let structure = 6;
  if (hasHook)                    structure += 2;
  if (hasClose)                   structure += 2;
  if (hasEvidence)                structure += 1;
  if (hasRebuttal && hasGrounds)  structure += 1;
  if (paragraphList(sp).length >= 3) structure += 1; // multi-paragraph = organised
  structure = clamp(structure, 1, 10);

  // Conviction: assertive language vs hedging
  let conviction = 6;
  conviction += Math.min(3, conv);
  conviction -= Math.min(3, Math.round(hedges / 2));
  conviction -= Math.min(2, Math.round(crutch / 4));
  if (ethos > 0)  conviction += 1;
  if (hasRebuttal) conviction += 1; // rebuttal shows confidence to acknowledge opposition
  conviction = clamp(conviction, 1, 10);

  const overall = clamp(
    0.30 * clarity + 0.30 * depth + 0.20 * structure + 0.20 * conviction,
    1, 10
  );

  // ── Qualitative feedback ──────────────────────────

  const whatWorked = [];
  if (hasHook)     whatWorked.push("Your opening uses a hook pattern — the reader is more likely to keep reading.");
  if (hasEvidence) whatWorked.push("You support your ideas with examples or evidence phrases, which strengthens the logos of your piece.");
  if (logos > 0)   whatWorked.push("Logical connectors make your reasoning trackable — the reader can follow your argument.");
  if (pathos > 0)  whatWorked.push("Emotional language gives the piece resonance beyond just information.");
  if (ethos > 0)   whatWorked.push("Personal experience cues give the reader a sense of your lived perspective.");
  if (hasRebuttal) whatWorked.push("You acknowledge a counterpoint, which adds credibility and intellectual honesty.");
  if (!whatWorked.length) whatWorked.push("You got the idea out of your head and into text — the raw material every strong piece needs.");

  const weak = [];
  if (hedges > 0)     weak.push("Hedging language softens your stance where it doesn't need to. Trimming phrases like 'kind of' and 'maybe' would give your sentences more authority.");
  if (crutch > 0)     weak.push("Crutch words dilute your meaning. Replacing 'really', 'just', and 'basically' with precise nouns and verbs would make each sentence do more work.");
  if (!hasClose)      weak.push("The piece doesn't yet close with a clear takeaway. One declarative final sentence — what you want the reader to carry away — would strengthen the ending significantly.");
  if (!hasHook)       weak.push("The opening could pull the reader in more forcefully. Try starting with a question, a contradiction, or a brief concrete image.");
  if (!hasRebuttal)   weak.push("There's no counterpoint here. Briefly acknowledging an opposing view and responding to it would make the argument more convincing, not less.");
  if (!hasEvidence)   weak.push("Abstract claims stand alone without supporting examples. One concrete story or specific case would make the central idea land much harder.");
  if (!weak.length)   weak.push("Consider sharpening transitions between ideas, or adding one more concrete example to support your main point.");

  // Tomorrow's exercise — targeted at weakest dimension
  let weakDim = "clarity";
  let weakVal = clarity;
  const dims = { depth, structure, conviction };
  for (const [dim, val] of Object.entries(dims)) {
    if (val < weakVal) { weakVal = val; weakDim = dim; }
  }

  const tomorrow = {
    clarity:    "Rewrite your piece twice. First in under 150 words, then in under 80. Each pass, remove every hedge and crutch word while keeping the core claim.",
    depth:      "Write one explicit claim, three separate grounds, one warrant that connects them, and one counterpoint with a short rebuttal. Label each.",
    structure:  "Before writing tomorrow, sketch a PEEL outline (Point → Evidence → Explain → Link). Write the piece, then check each paragraph against the outline.",
    conviction: "Write with a rule: every paragraph must contain at least one conviction marker, and no sentence may contain a hedge word.",
  }[weakDim];

  const challenge = {
    clarity:    "Rewrite this piece in under 120 words. Delete every hedge and crutch word. The main claim must survive intact.",
    depth:      "Add one vivid, concrete example or short story that lets a stranger visualise your point without any context from you.",
    structure:  "Rewrite using strict PEEL: one sentence point, one sentence evidence, one sentence explanation, one sentence linking back.",
    conviction: "Rewrite with two conviction markers added and one explicit rebuttal to the most likely counterargument.",
  }[weakDim];

  // ── Diagnostics ───────────────────────────────────

  const totalDur  = recordings.reduce((a, r) => a + (r.durationSec || 0), 0);
  const totalFill = recordings.reduce((a, r) => a + (r.fillersCount || 0), 0);

  const diag = {
    readability: `Words: ${st.words} · Sentences: ${st.sentences} · Flesch ease: ${st.ease.toFixed(0)} (${st.ease > 70 ? "easy" : st.ease > 50 ? "standard" : "complex"}) · FK grade: ${st.grade.toFixed(1)} · Avg sentence: ${st.wps.toFixed(1)} words · Rhythm variance: ${st.variance.toFixed(1)}`,
    aristotle:   `Logos: ${logos > 0 ? "✓ (" + logos + ")" : "–"}  ·  Pathos: ${pathos > 0 ? "✓ (" + pathos + ")" : "–"}  ·  Ethos: ${ethos > 0 ? "✓ (" + ethos + ")" : "–"}`,
    toulmin:     `Claim: ${hasClaim ? "✓" : "–"}  ·  Grounds: ${hasGrounds ? "✓" : "–"}  ·  Warrant: ${hasWarrant ? "✓" : "–"}  ·  Rebuttal: ${hasRebuttal ? "✓" : "–"}`,
    structure:   `Hook: ${hasHook ? "✓" : "–"}  ·  Evidence: ${hasEvidence ? "✓" : "–"}  ·  Close: ${hasClose ? "✓" : "–"}  ·  Paragraphs: ${paragraphList(sp).length}`,
    lexical:     `Hedges: ${hedges}  ·  Crutch words: ${crutch}  ·  Conviction markers: ${conv}`,
    transfer:    `Brainstorm: ${wordList(bs).length} words  ·  Written: ${st.words} words  ·  Concept overlap: ${xfer}%`,
    speech:      recordings.length
      ? `Takes: ${recordings.length}  ·  Total duration: ~${totalDur}s  ·  Estimated fillers: ${totalFill}`
      : "No audio takes recorded for this session.",
  };

  return {
    clarity,
    depth,
    structure,
    conviction,
    overall,
    bestSentence: bestSentence(sp),
    whatWorked,
    priority:   weak[0]  || "",
    secondary:  weak[1]  || "",
    tomorrow,
    challenge,
    diag,
    heatmap: buildHeatmap(sp),
    weakDim,
  };
}
