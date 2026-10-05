// The Tools tab: a small launcher of self-contained tools, each with its own panel and its own document.
// A tool module exports `meta` (id, name, eyebrow, tagline, description) and `mount(ctx, root)`, which returns the same
// view shape as a tab (render, show, hide, snapshot, destroy). Fretboard is the first; add the next one to TOOLS.
import { $, html, setHTML } from "./util.js";
import * as fretboard from "./fretboard.js";

const TOOLS = [fretboard];
// While there is one tool it has no tab and no launcher: the account menu opens it directly. A second tool brings
// the launcher (and a tab, if it earns one) back.
const ONLY = TOOLS.length === 1 ? TOOLS[0] : null;

export function init(ctx) {
  const launcher = $("tool-launcher"),
    stage = $("tool-stage"),
    body = $("tool-body");
  const mounted = {}; // id -> { view, root }
  let active = null;

  $("tool-back").hidden = !!ONLY;
  if (!ONLY)
    setHTML(
      $("tool-grid"),
      html`${TOOLS.map(
        ({ meta }) =>
          html`<button type="button" class="tool-card" data-tool="${meta.id}">
          <span class="tool-card-eyebrow">${meta.eyebrow}</span>
          <span class="tool-card-name">${meta.name}</span>
          <span class="tool-card-text">${meta.description}</span>
          <span class="tool-card-open">Open ${meta.name} ›</span>
        </button>`,
      )}<div class="tool-card is-soon" aria-hidden="true">
        <span class="tool-card-eyebrow">Next</span>
        <span class="tool-card-name">More tools, in time</span>
        <span class="tool-card-text">This space grows one tool at a time. Each one stays small, quiet and yours.</span>
      </div>`,
    );

  const byId = (id) => TOOLS.find((t) => t.meta.id === id);
  function open(id) {
    const tool = byId(id);
    if (!tool) return close();
    if (active && active !== id) mounted[active]?.view.hide();
    if (!mounted[id]) {
      const root = document.createElement("div");
      root.className = "tool-root";
      root.dataset.tool = id;
      body.append(root);
      mounted[id] = { view: tool.mount(ctx, root), root };
    }
    for (const [other, m] of Object.entries(mounted)) m.root.hidden = other !== id;
    active = id;
    $("tool-eyebrow").textContent = tool.meta.eyebrow;
    $("tool-title").textContent = tool.meta.name;
    $("tool-tagline").textContent = tool.meta.tagline;
    launcher.hidden = true;
    stage.hidden = false;
    mounted[id].view.show();
    ctx.measure("tool_opened");
  }
  function close() {
    if (active) mounted[active]?.view.hide();
    active = null;
    saved.tool = "";
    if (ONLY) return open(ONLY.meta.id); // there is nothing else to show
    stage.hidden = true;
    launcher.hidden = false;
  }
  launcher.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tool]");
    if (b) open(b.dataset.tool);
  });
  $("tool-back").addEventListener("click", () => {
    close();
    launcher.querySelector("[data-tool]")?.focus();
  });

  const saved = ctx.ui?.get("tools") || {};
  return {
    open,
    render() {
      if (active) mounted[active].view.render();
    },
    show() {
      if (!active && ONLY) open(ONLY.meta.id);
      else if (!active && byId(saved.tool)) open(saved.tool);
      else if (active) mounted[active].view.show();
    },
    hide() {
      if (active) mounted[active].view.hide();
    },
    snapshot() {
      const out = { tool: active || "" };
      for (const [id, m] of Object.entries(mounted))
        if (m.view.snapshot) out[id] = m.view.snapshot();
      return out;
    },
  };
}
