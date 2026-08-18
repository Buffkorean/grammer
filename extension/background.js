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
    const body = await res.json().catch(() => null);
    if (res.status === 429 && body?.error === "rate_limited") {
      const err = new Error(body.message || "Rate limited");
      err.rateLimited = true;
      err.retryAfter = body.retryAfter;
      throw err;
    }
    throw new Error(body?.error || `Backend returned ${res.status}`);
  }

  return res.json();
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHECK_TEXT") {
    checkText(message.text)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: String(err.message || err),
          rateLimited: !!err.rateLimited,
          retryAfter: err.retryAfter,
        })
      );
    return true; // keep the message channel open for the async response
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings().then((settings) => sendResponse({ ok: true, settings }));
    return true;
  }
});
