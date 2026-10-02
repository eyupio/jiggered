// Shared, non-interactive tooltips: hoverable, focusable triggers, Escape dismissal and tap help buttons.
// Plain text only; critical guidance also lives in Help and beside the relevant fields.
const HINTS = {
  "#svc-interval_hours":
    "Schedules from when enabled or changed; a manual backup also starts a fresh interval.",
  "#svc-keep":
    "Only this installation’s backup objects are pruned. Set 0 to keep every remote backup.",
  '[data-service-action="test_s3"]':
    "Checks write, read, delete and list permissions using a disposable probe in your saved prefix.",
  '[data-service-action="test_email"]':
    "Sends a test to your configured notification recipients. SMTP acceptance does not guarantee inbox delivery.",
  '[data-service-action="backup"]':
    "Creates a consistent SQLite snapshot and uploads it in the background. Your tab can be closed safely.",
  '[data-service-action="list"]':
    "Lists the latest remote snapshots belonging to this instance. Downloading requires your admin password.",
  "#security-regenerate":
    "Replaces all previous recovery codes. Save the new codes immediately; they are displayed once.",
  "#security-disable":
    "Requires your password and a valid factor, and signs out your other devices.",
  '[data-act="two-factor-reset"]':
    "For a verified person who has lost their authenticator and recovery codes. This removes protection and signs out every device.",
  "#day-prev": "Review or correct the previous day. Changes stay on that day.",
  "#day-next": "Move forward one day. Future days cannot be logged.",
  "#day-pick": "Choose today or an earlier day to review and correct its log.",
  "#sleep": "Subtract your chosen sleep cost from this day's starting budget.",
  "#other-activity": "Log a one-off activity without changing your preset list.",
  "#entry-cost,.order-cost":
    "Positive points spend energy; negative points record recovery; zero only logs the activity.",
  "#entry-time,#act-time": "Optional. Leave blank if you don't remember the time.",
  "#ep-when": "The symptom start time. New captures use this device's local time zone.",
  "#ep-dur": "Choose Still going to keep this episode available for a later completion.",
  "#ep-ended": "Optional exact end time, between the recorded start and now.",
  "#set-budget": "Your starting daily planning budget, from 1 to 30 points.",
  "#def-budget":
    "The starting daily budget for new accounts. Existing personal settings stay unchanged.",
  "#set-penalty,#def-penalty": "Points taken off for poor sleep, from zero to the daily budget.",
  "#sum-range": "The printed summary has its own period. It does not use the history filters.",
  "#sum-notes": "Turn off to keep private episode notes out of the printed summary.",
  "#csv-days,#csv-eps": "Download the records matching your current history filters.",
  "#export-all": "A JSON export of saved server data. This file can be restored in Account.",
  "#export-device":
    "Keep drafts and queued or refused changes in a private recovery file. This is not a restore file.",
  "#import-file": "Choose a JSON server export, then preview its effect before restoring.",
  "#defaults-reload":
    "Load the current shared defaults. Review any unfinished admin draft before replacing it.",
  "#backup":
    "Download the full database, including everyone's private health log. Store the backup securely.",
  "[data-act='reset']":
    "Sign this person out and create a temporary password they must change at sign-in.",
  "[data-act='disable']": "Block sign-in and end sessions while keeping this person's data.",
  "[data-act='revoke']": "End this person's sessions so they must sign in again.",
  "#new-admin": "Admins manage accounts and can download a backup containing everyone's data.",
  ".drag-handle":
    "Drag to reorder. Keyboard: Up, Down, Home or End. Escape cancels a drag. Save to keep the order.",
  "[data-move='-1']": "Move this item up one position.",
  "[data-move='1']": "Move this item down one position.",
  "[data-remove]":
    "Remove this preset from the draft. Save to apply; logged records stay unchanged.",
};

export function initTooltips() {
  const tip = document.createElement("div");
  tip.id = "jiggered-tooltip";
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);
  let active = null,
    showTimer,
    hideTimer;
  const described = new WeakMap();
  const trigger = (node) => (node instanceof Element ? node.closest("[data-tooltip]") : null);
  function decorate(root) {
    for (const [selector, text] of Object.entries(HINTS)) {
      const nodes = [...root.querySelectorAll(selector)];
      if (root.matches?.(selector)) nodes.push(root);
      for (const el of nodes) {
        el.dataset.tooltip = text;
        el.removeAttribute("title");
      }
    }
  }
  function position() {
    if (!active?.isConnected || active.closest("[hidden]")) {
      hide();
      return;
    }
    const anchor = active.getBoundingClientRect(),
      box = tip.getBoundingClientRect(),
      gap = 8,
      edge = 12;
    const height = globalThis.visualViewport?.height || window.innerHeight;
    const width = globalThis.visualViewport?.width || window.innerWidth;
    if (anchor.bottom < 0 || anchor.top > height) {
      hide();
      return;
    }
    const below = anchor.bottom + gap;
    tip.style.left =
      Math.max(
        edge,
        Math.min(width - box.width - edge, anchor.left + anchor.width / 2 - box.width / 2),
      ) + "px";
    tip.style.top =
      Math.max(
        edge,
        Math.min(
          height - box.height - edge,
          below + box.height <= height - edge ? below : anchor.top - box.height - gap,
        ),
      ) + "px";
  }
  function hide() {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (active) {
      delete active.dataset.tipPinned;
      const prior = described.get(active);
      if (prior) active.setAttribute("aria-describedby", prior);
      else active.removeAttribute("aria-describedby");
    }
    active = null;
    tip.hidden = true;
  }
  function show(el) {
    hide();
    active = el;
    described.set(el, el.getAttribute("aria-describedby") || "");
    tip.textContent = el.dataset.tooltip;
    tip.hidden = false;
    el.setAttribute("aria-describedby", [described.get(el), tip.id].filter(Boolean).join(" "));
    position();
  }
  const laterHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!tip.matches(":hover") && !active?.matches(":hover") && document.activeElement !== active)
        hide();
    }, 180);
  };
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const el = trigger(e.target);
    if (!el || el === trigger(e.relatedTarget)) return;
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(el), 350);
  });
  document.addEventListener("pointerout", (e) => {
    if (trigger(e.target) === trigger(e.relatedTarget)) return;
    clearTimeout(showTimer);
    laterHide();
  });
  document.addEventListener("focusin", (e) => {
    const el = trigger(e.target);
    if (el) show(el);
    else hide();
  });
  document.addEventListener("focusout", laterHide);
  document.addEventListener("click", (e) => {
    const el = trigger(e.target);
    if (el?.classList.contains("help-tip")) {
      e.preventDefault();
      if (active === el && el.dataset.tipPinned === "true") {
        delete el.dataset.tipPinned;
        hide();
      } else {
        show(el);
        el.dataset.tipPinned = "true";
      }
    } else if (!tip.contains(e.target)) hide();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && active) {
      hide();
      e.stopPropagation();
    }
  });
  tip.addEventListener("pointerenter", () => clearTimeout(hideTimer));
  tip.addEventListener("pointerleave", laterHide);
  window.addEventListener("resize", position);
  window.addEventListener(
    "scroll",
    () => {
      if (active) position();
    },
    true,
  );
  decorate(document);
  new MutationObserver((records) => {
    for (const record of records)
      for (const node of record.addedNodes)
        if (node instanceof Element && node !== tip) decorate(node);
    if (active && !active.isConnected) hide();
  }).observe(document.body, { childList: true, subtree: true });
  return { hide };
}
