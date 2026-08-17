const DEFAULT_SETTINGS = {
  backendUrl: "http://localhost:3000",
  enabled: true,
  autoCheck: true,
};

const enabledEl = document.getElementById("enabled");
const autoCheckEl = document.getElementById("autoCheck");
const backendUrlEl = document.getElementById("backendUrl");
const statusEl = document.getElementById("status");

async function load() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabledEl.checked = settings.enabled;
  autoCheckEl.checked = settings.autoCheck;
  backendUrlEl.value = settings.backendUrl;
}

function originFor(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return null;
  }
}

document.getElementById("save").addEventListener("click", async () => {
  const backendUrl = backendUrlEl.value.trim().replace(/\/$/, "");
  const origin = originFor(backendUrl);

  if (!origin) {
    statusEl.textContent = "Enter a valid URL (e.g. http://localhost:3000).";
    return;
  }

  // Custom (non-default) backend hosts need runtime permission in MV3.
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) {
    statusEl.textContent = "Permission denied — can't reach that backend without it.";
    return;
  }

  await chrome.storage.sync.set({
    backendUrl,
    enabled: enabledEl.checked,
    autoCheck: autoCheckEl.checked,
  });

  statusEl.textContent = "Saved.";
  setTimeout(() => (statusEl.textContent = ""), 1500);
});

load();
