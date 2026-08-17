(() => {
  const DEBOUNCE_MS = 1200;
  const EDITABLE_INPUT_TYPES = new Set([
    "text", "search", "email", "url", "tel", "", null,
  ]);

  let settings = null;
  let activeField = null;
  let debounceTimer = null;
  let issues = [];
  let lastCheckedText = "";
  let checking = false;

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT") return EDITABLE_INPUT_TYPES.has((el.getAttribute("type") || "").toLowerCase());
    if (el.isContentEditable) return true;
    return false;
  }

  function getText(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value;
    return el.innerText;
  }

  // Native setters bypass React/Vue's overridden value/textContent setters,
  // so dispatching a real "input" event afterward makes the framework notice.
  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function setText(el, text) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      setNativeValue(el, text);
    } else {
      el.innerText = text;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function applyIssue(issue) {
    if (!activeField) return;
    const text = getText(activeField);
    const idx = text.indexOf(issue.original);
    if (idx === -1) {
      issue.stale = true;
      renderPanel();
      return;
    }
    const next = text.slice(0, idx) + issue.replacement + text.slice(idx + issue.original.length);
    setText(activeField, next);
    issues = issues.filter((i) => i !== issue);
    lastCheckedText = next;
    renderPanel();
  }

  function dismissIssue(issue) {
    issues = issues.filter((i) => i !== issue);
    renderPanel();
  }

  async function analyze() {
    if (!activeField || !settings?.enabled) return;
    const text = getText(activeField).trim();
    if (!text || text === lastCheckedText) return;

    checking = true;
    renderPanel();

    chrome.runtime.sendMessage({ type: "CHECK_TEXT", text }, (response) => {
      checking = false;
      if (chrome.runtime.lastError) {
        renderPanel(`Extension error: ${chrome.runtime.lastError.message}`);
        return;
      }
      if (!response?.ok) {
        renderPanel(response?.error || "Could not reach the grammar backend.");
        return;
      }
      lastCheckedText = text;
      issues = (response.data?.issues || []).filter((i) => text.includes(i.original));
      renderPanel();
    });
  }

  function scheduleAnalyze() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(analyze, DEBOUNCE_MS);
  }

  // ---- UI (shadow DOM keeps host-page CSS from leaking in or out) ----

  let host, shadow, panelEl, toggleEl;

  function buildUI() {
    host = document.createElement("div");
    host.id = "grammar-writer-host";
    host.style.all = "initial";
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      * { box-sizing: border-box; font-family: -apple-system, system-ui, sans-serif; }
      .toggle {
        position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
        width: 44px; height: 44px; border-radius: 50%;
        background: #1a73e8; color: #fff; border: none; cursor: pointer;
        font-size: 14px; font-weight: 600; box-shadow: 0 2px 8px rgba(0,0,0,.25);
        display: flex; align-items: center; justify-content: center;
      }
      .badge {
        position: absolute; top: -4px; right: -4px; background: #d93025;
        color: #fff; border-radius: 10px; font-size: 11px; padding: 1px 5px;
        min-width: 16px; text-align: center;
      }
      .panel {
        position: fixed; bottom: 74px; right: 20px; z-index: 2147483647;
        width: 320px; max-height: 420px; overflow-y: auto;
        background: #fff; border-radius: 10px; box-shadow: 0 4px 20px rgba(0,0,0,.3);
        display: none; flex-direction: column; font-size: 13px; color: #202124;
      }
      .panel.open { display: flex; }
      .panel-header {
        padding: 10px 14px; font-weight: 600; border-bottom: 1px solid #eee;
        display: flex; justify-content: space-between; align-items: center;
      }
      .panel-list { padding: 6px; }
      .issue {
        padding: 8px 10px; margin: 4px; border-radius: 8px; background: #f8f9fa;
      }
      .issue .type {
        font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
        color: #1a73e8; font-weight: 700;
      }
      .issue .diff { margin: 4px 0; }
      .issue .orig { text-decoration: line-through; color: #d93025; }
      .issue .repl { color: #188038; font-weight: 600; }
      .issue .msg { color: #5f6368; margin: 4px 0; }
      .issue .actions { display: flex; gap: 6px; margin-top: 6px; }
      .issue button {
        border: none; border-radius: 6px; padding: 4px 8px; cursor: pointer; font-size: 12px;
      }
      .apply { background: #1a73e8; color: #fff; }
      .dismiss { background: #e8eaed; color: #202124; }
      .empty { padding: 20px; text-align: center; color: #5f6368; }
    `;
    shadow.appendChild(style);

    toggleEl = document.createElement("button");
    toggleEl.className = "toggle";
    toggleEl.textContent = "GW";
    toggleEl.addEventListener("click", () => {
      panelEl.classList.toggle("open");
      if (panelEl.classList.contains("open")) analyze();
    });
    shadow.appendChild(toggleEl);

    panelEl = document.createElement("div");
    panelEl.className = "panel";
    shadow.appendChild(panelEl);
  }

  function renderPanel(errorMessage) {
    if (!panelEl) return;

    const badge = shadow.querySelector(".badge");
    if (badge) badge.remove();
    if (issues.length > 0) {
      const b = document.createElement("span");
      b.className = "badge";
      b.textContent = String(issues.length);
      toggleEl.appendChild(b);
    }

    panelEl.innerHTML = "";

    const header = document.createElement("div");
    header.className = "panel-header";
    header.innerHTML = `<span>Grammar Writer</span>`;
    const status = document.createElement("span");
    status.style.fontWeight = "400";
    status.style.color = "#5f6368";
    status.textContent = checking ? "Checking…" : "";
    header.appendChild(status);
    panelEl.appendChild(header);

    const list = document.createElement("div");
    list.className = "panel-list";

    if (errorMessage) {
      const el = document.createElement("div");
      el.className = "empty";
      el.textContent = errorMessage;
      list.appendChild(el);
    } else if (!activeField) {
      const el = document.createElement("div");
      el.className = "empty";
      el.textContent = "Click into a text field, then reopen this panel.";
      list.appendChild(el);
    } else if (issues.length === 0 && !checking) {
      const el = document.createElement("div");
      el.className = "empty";
      el.textContent = "No issues found.";
      list.appendChild(el);
    } else {
      for (const issue of issues) {
        const row = document.createElement("div");
        row.className = "issue";
        row.innerHTML = `
          <div class="type">${issue.type || "suggestion"}</div>
          <div class="diff"><span class="orig">${escapeHtml(issue.original)}</span> → <span class="repl">${escapeHtml(issue.replacement)}</span></div>
          <div class="msg">${escapeHtml(issue.message || "")}</div>
        `;
        const actions = document.createElement("div");
        actions.className = "actions";

        const applyBtn = document.createElement("button");
        applyBtn.className = "apply";
        applyBtn.textContent = issue.stale ? "Text changed" : "Apply";
        applyBtn.disabled = !!issue.stale;
        applyBtn.addEventListener("click", () => applyIssue(issue));

        const dismissBtn = document.createElement("button");
        dismissBtn.className = "dismiss";
        dismissBtn.textContent = "Dismiss";
        dismissBtn.addEventListener("click", () => dismissIssue(issue));

        actions.appendChild(applyBtn);
        actions.appendChild(dismissBtn);
        row.appendChild(actions);
        list.appendChild(row);
      }
    }

    panelEl.appendChild(list);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // ---- field tracking ----

  document.addEventListener("focusin", (e) => {
    if (isEditable(e.target)) {
      activeField = e.target;
      issues = [];
      lastCheckedText = "";
      renderPanel();
    }
  });

  document.addEventListener("input", (e) => {
    if (e.target === activeField && settings?.autoCheck) {
      scheduleAnalyze();
    }
  });

  chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (response) => {
    settings = response?.settings || { enabled: true, autoCheck: true };
    buildUI();
    renderPanel();
  });

  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (settings) settings[key] = newValue;
    }
  });
})();
