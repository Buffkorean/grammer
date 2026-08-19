# Grammar Writer

A grammar/style checker with two parts:

- **`extension/`** — a Chrome extension (Manifest V3) that watches text fields on any
  website (textareas, inputs, `contenteditable` — Gmail, docs, forms, etc.), underlines
  flagged spans directly in the text, and lists suggestions in a floating panel.
- **`server/`** — a small Next.js backend with a single `POST /api/check` route that
  sends text to [LanguageTool](https://languagetool.org) (free, no API key) and returns
  structured grammar/spelling/style issues. This is the shared "engine" — the extension
  is just one client of it. A future Word add-in, desktop app, or CLI could reuse the
  same endpoint.

This is entirely free to run by default: LanguageTool is an open-source, rule-based
checker, and the backend calls its free public API — no paid API key required. An
optional second pass (Claude) can be layered on top for sentence-structure/clarity
feedback that a rule-based checker can't do — see "Sentence-structure suggestions"
below. Leave it unconfigured and the stack stays fully free.

## How it works

1. You focus a text field and type. The content script debounces (1.2s after you stop
   typing) and sends the field's text to the background service worker.
2. The background worker POSTs it to the backend's `/api/check` endpoint.
3. The backend sends the text to LanguageTool and maps its matches into a JSON list of
   issues: `{ original, replacement, type, message }`. If `ANTHROPIC_API_KEY` is set, it
   also asks Claude for sentence-structure/clarity issues and merges those in too.
4. The content script underlines each flagged span directly in the field (red wavy =
   spelling, blue = grammar, orange = punctuation, green = style, purple = structure)
   and lists them in a small floating panel (bottom-right of the page). Click **Apply**
   to replace the flagged text in place, or **Dismiss** to ignore it.

Inline underlines work by overlaying an invisible "mirror" of the field's text on top
of it — the same technique Grammarly uses, since browsers give no way to style part of
a `<textarea>`/`<input>`'s text natively. The mirror is purely visual (`pointer-events:
none`), so it never interferes with typing or clicking the real field, and it re-syncs
on every keystroke so an underline disappears the moment you fix that word yourself.

## Running the backend locally

```bash
cd server
npm install
npm run dev                  # http://localhost:3000
```

No `.env` setup is required to use the free public LanguageTool API. See
`server/.env.example` if you want to point at a different LanguageTool language or a
self-hosted instance instead.

### Free-tier limits to know about

The public LanguageTool API is rate-limited (roughly 20 requests/minute per IP) and
caps text size — the backend enforces a 5000-character limit per check to stay well
under that. If you outgrow it, self-host LanguageTool instead:

```bash
docker run -p 8010:8010 erikvl87/languagetool
```

then set `LANGUAGETOOL_API_URL=http://localhost:8010/v2/check` (no rate limit, fully
private, runs on your own machine).

### Sentence-structure suggestions (optional)

LanguageTool is rule-based — excellent at grammar, spelling, and punctuation, but it
can't tell you a sentence is confusingly structured, since that takes actually
understanding the sentence, not just pattern-matching it. To add that, set an
Anthropic API key:

```bash
# server/.env.local
ANTHROPIC_API_KEY=sk-ant-...
```

Get a key at [console.anthropic.com](https://console.anthropic.com). With it set, every
check also asks Claude Haiku for structure/clarity issues (a fast, low-cost model —
chosen deliberately to keep this cheap; set `CLAUDE_MODEL` to use a different one) and
merges them into the same result list, tagged `type: "structure"`. Leave the key unset
and this pass is skipped entirely — no cost, no behavior change from the free-only
setup. If the Claude call fails for any reason (bad key, rate limit, network issue),
the request still succeeds with just LanguageTool's results — it never fails the whole
check.

## Loading the extension

1. Go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension/` folder.
4. Click the extension icon to open settings — confirm **Backend URL** is
   `http://localhost:3000` (the default) and **Enabled**/**Auto-check** are on.
5. Visit any page with a text field, type something, and click the round **GW**
   button that appears in the bottom-right corner.

If you point the backend URL at anything other than `http://localhost:3000`, Chrome
will prompt you to grant that origin permission — this is expected (Manifest V3
requires explicit host permissions for cross-origin requests).

## Deploying the backend

The backend is a standard Next.js app — deploy it to Vercel like any other:

```bash
cd server
vercel deploy
```

No environment variables are required for the default free public API. If you're
self-hosting LanguageTool, set `LANGUAGETOOL_API_URL`; if you want structure/clarity
suggestions, set `ANTHROPIC_API_KEY` — both as environment variables in the Vercel
project settings. Then update the extension's **Backend URL** in the popup to point at
the deployed URL.

## Beyond Chrome

The backend is the reusable part. Anything that can make an HTTP POST can use the same
grammar engine:

- **Microsoft Word / Outlook**: an Office Add-in (JavaScript, using the Office.js API)
  is a separate small project — a task pane that reads/writes the document via
  `Office.js` and calls this same `/api/check` endpoint.
- **Any other app**: a native desktop helper (e.g. an Electron menu-bar app or an
  OS-level accessibility hook) that reads the focused text and calls the same endpoint.

Neither of those exists yet — this repo currently only has the Chrome extension client.

## Known limitations (MVP)

- The underline overlay mirrors the field's computed font/padding/border to line up
  visually; on unusually styled fields (multi-column layouts, non-standard line
  heights) it may drift slightly out of alignment.
- On `contenteditable` fields with rich internal structure (Google Docs, Notion-style
  editors), the mirrored text may not exactly match the visual layout, since those
  editors don't render plain text the same way a textarea does.
- Applying a fix to `contenteditable` fields replaces the element's plain text, which
  can lose rich formatting (bold, links, etc.) in that field.
- No spell-check-as-you-type character-level diffing — each check re-sends the whole
  field's text.
