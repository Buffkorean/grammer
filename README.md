# Grammar Writer

A grammar/style checker with two parts:

- **`extension/`** — a Chrome extension (Manifest V3) that watches text fields on any
  website (textareas, inputs, `contenteditable` — Gmail, docs, forms, etc.) and shows
  inline suggestions in a floating panel.
- **`server/`** — a small Next.js backend with a single `POST /api/check` route that
  sends text to [LanguageTool](https://languagetool.org) (free, no API key) and returns
  structured grammar/spelling/style issues. This is the shared "engine" — the extension
  is just one client of it. A future Word add-in, desktop app, or CLI could reuse the
  same endpoint.

This is entirely free to run: LanguageTool is an open-source, rule-based checker, and
the backend calls its free public API by default — no paid API key required anywhere
in this stack.

## How it works

1. You focus a text field and type. The content script debounces (1.2s after you stop
   typing) and sends the field's text to the background service worker.
2. The background worker POSTs it to the backend's `/api/check` endpoint.
3. The backend sends the text to LanguageTool and maps its matches into a JSON list of
   issues: `{ original, replacement, type, message }`.
4. The content script shows them in a small floating panel (bottom-right of the page).
   Click **Apply** to replace the flagged text in place, or **Dismiss** to ignore it.

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

### Trade-off vs. an LLM-based backend

LanguageTool is rule-based, not an LLM — it's excellent at grammar, spelling, and
punctuation, but won't do the nuanced tone/clarity rewrites an LLM can. If you want
that later, swap `server/app/api/check/route.ts` to call an LLM instead (the original
version of this backend used the Claude API); the rest of the stack (extension,
Issue shape, panel UI) doesn't need to change.

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
self-hosting LanguageTool, set `LANGUAGETOOL_API_URL` as an environment variable in
the Vercel project settings. Then update the extension's **Backend URL** in the popup
to point at the deployed URL.

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

- Suggestions are shown in a side panel, not as inline underlines in the text itself.
- Applying a fix to `contenteditable` fields replaces the element's plain text, which
  can lose rich formatting (bold, links, etc.) in that field.
- No spell-check-as-you-type character-level diffing — each check re-sends the whole
  field's text.
