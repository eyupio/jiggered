// Small helpers shared by the pages: safe HTML building, formatting, talking to the API.

export const $ = (id) => document.getElementById(id);

export const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// html`...` escapes everything interpolated into it, so names and notes people type can't become markup.
// Wrap already-safe markup with raw(); nested html`` results and arrays of them are passed through.
class Safe {
  constructor(s) {
    this.s = s;
  }
}
export const raw = (s) => new Safe(String(s));
const part = (v) =>
  v instanceof Safe
    ? v.s
    : Array.isArray(v)
      ? v.map(part).join("")
      : v == null || v === false
        ? ""
        : esc(v);
export const html = (parts, ...vals) =>
  new Safe(parts.reduce((out, p, i) => out + p + (i < vals.length ? part(vals[i]) : ""), ""));
export const setHTML = (el, safe) => {
  el.innerHTML = safe.s;
};
export const appendHTML = (el, safe) => el.insertAdjacentHTML("beforeend", safe.s);

export function fmtDay(key, locale) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale || undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function fmtLongDay(key, locale) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale || undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function fmtWhen(when, locale) {
  const w = new Date(when);
  if (isNaN(w)) return String(when);
  const p = (n) => String(n).padStart(2, "0");
  return `${w.toLocaleDateString(locale || undefined, { day: "numeric", month: "short", year: "numeric" })}, ${p(w.getHours())}:${p(w.getMinutes())}`;
}

// "just now", "5 minutes ago", "3 days ago"
export function ago(unixSeconds, nowMs = Date.now()) {
  const s = Math.max(0, Math.round(nowMs / 1000 - unixSeconds));
  if (s < 60) return "just now";
  const unit = (n, w) => `${n} ${w}${n === 1 ? "" : "s"} ago`;
  if (s < 3600) return unit(Math.floor(s / 60), "minute");
  if (s < 86400) return unit(Math.floor(s / 3600), "hour");
  return unit(Math.floor(s / 86400), "day");
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

// A cost as it reads on screen: spending is −n, recovery is +n, and nothing is a plain 0 (never "−0" or "+0").
export const signed = (c) => (c > 0 ? `−${c}` : c < 0 ? `+${-c}` : "0");
// A balance, with a real minus sign when it is below zero.
export const minus = (n) => String(n).replace("-", "−");

// "Firefox on Linux", for the list of signed-in devices.
export function describeUA(ua = "") {
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /FxiOS\/|Firefox\//.test(ua)
        ? "Firefox"
        : /CriOS\/|Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : "";
  return browser && os ? `${browser} on ${os}` : browser || os || "Unknown device";
}

// api talks to the server and never throws: you get { ok, status, data, error } with a message fit to show.
// Set once the page knows who is signed in; sent with every request so the server can refuse a page whose
// person has since been replaced (another tab signed in as someone else).
let pageUser = null;
export const setPageUser = (id) => {
  pageUser = id;
};

export async function api(method, path, body, headers = {}) {
  const opts = {
    method,
    signal: AbortSignal.timeout(
      path.startsWith("/api/restore") || path.startsWith("/api/import") || path === "/api/export"
        ? 300000
        : path === "/api/admin/services/action"
          ? 45000
          : 20000,
    ),
    credentials: "same-origin",
    headers: {
      ...headers,
      "X-Requested-With": "jiggered",
      ...(pageUser != null && { "X-Jiggered-User": String(pageUser) }),
    },
  };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let r, text;
  try {
    r = await fetch(path, opts);
    if (r.status === 401) {
      location.href = "/login?e=expired";
      return { ok: false, status: 401, data: null, error: "You've been signed out." };
    }
    // A connection can fail after headers arrive; consuming its body belongs to the same transport boundary.
    text = await r.text();
  } catch {
    return {
      ok: false,
      status: 0,
      data: null,
      error: "Couldn't reach the server. Check your connection and try again.",
    };
  }
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return {
    ok: r.ok,
    status: r.status,
    data,
    error: r.ok ? "" : (data && data.error) || `Something went wrong (${r.status}).`,
  };
}

// A short random id for things created offline, so retrying a save can't add them twice.
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// A queued attempt resolving is not proof it reached the server. Call from render as the store changes.
export function saveFeedback(store, ticket, el, success = "Saved.") {
  if (!ticket) return null;
  const outcome = store.outcome(ticket.n);
  const st = store.status();
  el.classList.toggle("err", outcome === "failed");
  el.textContent =
    outcome === "saved"
      ? success
      : outcome === "failed"
        ? "The server refused this change. Your copy is in Recovery above."
        : outcome === "discarded"
          ? "Recovery item discarded; the unfinished form is kept."
          : !st.durable
            ? "Change queued, but only in memory. Keep this page open."
            : "Change queued on this device. Waiting to save on your server.";
  return outcome;
}

export async function withBusy(button, label, action) {
  if (button.disabled) return;
  const before = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await action();
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = before;
    }
  }
}

// sheetMode shows an in-page form as a centred sheet over the page instead of wherever it happens to sit in the
// document, so editing from a timeline neither moves the page nor loses the timeline. The form keeps its markup and
// handlers; it leaves the sheet as soon as it is hidden again. Escape and a click outside call onCancel, and Tab
// stays inside while it is open.
export function sheetMode(form, { onCancel, labelledBy = "" }) {
  let backdrop = null;
  const focusable =
    "a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled])";
  const keys = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...form.querySelectorAll(focusable)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0],
      last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  function off() {
    if (!form.classList.contains("is-sheet")) return;
    form.classList.remove("is-sheet");
    form.removeAttribute("role");
    form.removeAttribute("aria-modal");
    form.removeAttribute("aria-labelledby");
    form.removeEventListener("keydown", keys);
    backdrop?.remove();
    backdrop = null;
  }
  new MutationObserver(() => {
    if (form.hidden) off();
  }).observe(form, { attributes: true, attributeFilter: ["hidden"] });
  return {
    on() {
      if (form.classList.contains("is-sheet")) return;
      backdrop = document.createElement("div");
      backdrop.className = "sheet-backdrop";
      backdrop.addEventListener("click", onCancel);
      document.body.append(backdrop);
      form.classList.add("is-sheet");
      form.setAttribute("role", "dialog");
      form.setAttribute("aria-modal", "true");
      if (labelledBy) form.setAttribute("aria-labelledby", labelledBy);
      form.addEventListener("keydown", keys);
    },
    off,
  };
}

// A modal yes/no question. Resolves true only for the confirm button; Escape, the backdrop and Cancel all resolve false.
// Built on <dialog>, so focus is trapped and returned to what opened it. Text goes in through textContent.
export function confirmDialog({ title, body, confirmLabel = "Remove", cancelLabel = "Keep it" }) {
  return new Promise((resolve) => {
    const opener = document.activeElement,
      dialog = document.createElement("dialog"),
      heading = document.createElement("h2"),
      text = document.createElement("p"),
      row = document.createElement("div"),
      cancel = document.createElement("button"),
      confirm = document.createElement("button");
    dialog.className = "confirm-dialog";
    dialog.setAttribute("role", "alertdialog");
    heading.id = `confirm-title-${uid()}`;
    text.id = `confirm-body-${uid()}`;
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.setAttribute("aria-describedby", text.id);
    heading.textContent = title;
    text.textContent = body;
    row.className = "row confirm-actions";
    cancel.type = confirm.type = "button";
    cancel.className = "secondary";
    confirm.className = "danger";
    cancel.textContent = cancelLabel;
    confirm.textContent = confirmLabel;
    row.append(cancel, confirm);
    dialog.append(heading, text, row);
    let answer = false;
    cancel.addEventListener("click", () => dialog.close());
    confirm.addEventListener("click", () => {
      answer = true;
      dialog.close();
    });
    // A click on the backdrop lands on the dialog element itself, outside its padding box.
    dialog.addEventListener("click", (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
        dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      resolve(answer);
    });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus(); // the safe choice is the one under Enter
  });
}

export function downloadFile(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
