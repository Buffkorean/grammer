const DEFAULT_SETTINGS = {
  backendUrl: "http://localhost:3000",
  enabled: true,
  autoCheck: true,
};

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...stored };
}

async function checkText(text) {
  const settings = await getSettings();
  const url = `${settings.backendUrl.replace(/\/$/, "")}/api/check`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend returned ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHECK_TEXT") {
    checkText(message.text)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true; // keep the message channel open for the async response
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }
});
