# Grammar Writer

A grammar/style checker with two parts:

- **`extension/`** — a Chrome extension (Manifest V3) that watches text fields on any
  website (textareas, inputs, `contenteditable` — Gmail, docs, forms, etc.) and shows
  inline suggestions in a floating panel.
- **`server/`** — a small Next.js backend with a single `POST /api/check` route that
  sends text to Claude and returns structured grammar/spelling/style issues. This is
  the shared "engine" — the extension is just one client of it. A future Word add-in,
  desktop app, or CLI could reuse the same endpoint.

## How it works

1. You focus a text field and type. The content script debounces (1.2s after you stop
   typing) and sends the field's text to the background service worker.
2. The background worker POSTs it to the backend's `/api/check` endpoint.
3. The backend asks Claude for a JSON list of issues: `{ original, replacement, type, message }`.
4. The content script shows them in a small floating panel (bottom-right of the page).
   Click **Apply** to replace the flagged text in place, or **Dismiss** to ignore it.

## Running the backend locally

```bash
cd server
npm install
cp .env.example .env.local   # add your ANTHROPIC_API_KEY
npm run dev                  # http://localhost:3000
```

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

Set `ANTHROPIC_API_KEY` (and optionally `GRAMMAR_MODEL`) as environment variables in
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
