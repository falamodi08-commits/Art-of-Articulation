# Art of Articulation

A private 60-day daily practice tool to build clarity, depth, and confidence in writing and speaking. 20 minutes a day, no research allowed.

---

## Project structure

```
art-of-articulation/
├── index.html          ← Pure HTML structure, no inline JS or CSS
├── style.css           ← All styles (design tokens, dark mode, responsive)
├── app.js              ← Main entry point, wires all modules together
├── sw.js               ← Service worker (offline / PWA support)
├── manifest.json       ← PWA manifest (install to home screen)
├── data/
│   └── topics.js       ← 60 topics, week names, mode config
└── modules/
    ├── storage.js      ← localStorage (state) + IndexedDB (recordings)
    ├── timers.js       ← TimerEngine class + bell audio
    ├── recorder.js     ← MediaRecorder wrapper
    ├── analysis.js     ← Offline scoring engine (pure functions)
    ├── feedback.js     ← Feedback rendering + AI API call
    └── ui.js           ← All DOM manipulation
```

---

## Running locally

Because the app uses ES modules (`import`/`export`), you **cannot** open `index.html` directly from your filesystem — browsers block module imports over `file://` URLs.

Run a local dev server instead:

```bash
# Option 1 — Node.js (no install needed)
npx serve .

# Option 2 — Python 3
python3 -m http.server 8080

# Option 3 — VS Code
# Install the "Live Server" extension, then right-click index.html → Open with Live Server
```

Then open `http://localhost:3000` (or whatever port the server shows).

---

## GitHub Pages setup

1. Push this folder to a GitHub repo (private is fine)
2. Go to **Settings → Pages**
3. Set source to `main` branch, root folder `/`
4. Your site will be live at `https://yourusername.github.io/repo-name`

---

## AI feedback

The AI feedback button calls the Anthropic API. This works in Claude.ai's environment automatically. To use it on your own hosted version:

1. **Never put your API key in the frontend.** Anyone can read browser source.
2. Create a tiny proxy — a Cloudflare Worker or Vercel Edge Function — that holds your key server-side:

```js
// Example Cloudflare Worker (workers.js)
export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    const body = await request.json();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,   // stored as a Worker secret
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
```

3. Change the `AI_ENDPOINT` constant in `modules/feedback.js` to point at your Worker URL.

---

## What's new vs the single-file version

| Feature | Single file | This version |
|---|---|---|
| Audio storage | base64 in localStorage (5 MB limit) | IndexedDB (no practical limit) |
| Dark mode | ✗ | ✓ automatic via `prefers-color-scheme` |
| Offline / PWA | partial | ✓ service worker + installable |
| Git diffs | one giant file | per-module, readable diffs |
| Fluid typography | fixed px | `clamp()` scales with viewport |
| Reduced motion | ✗ | ✓ `prefers-reduced-motion` |
| Analysis engine | basic heuristics | improved scoring + better phrase matching |
| Keyboard shortcuts | partial | `Space` timer, `←→` phases, `Esc` exit |

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Start / pause the active phase timer |
| `→` | Next phase |
| `←` | Previous phase |
| `Esc` | Exit session back to the day list |
