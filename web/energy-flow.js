import { html, setHTML, signed } from "./util.js";
import { energyAmount, themeOf } from "./energy-theme.js";
import { energyFlow } from "./planner-model.js";

const previous = new WeakMap();
export function renderEnergyFlow(ctx, day, settings, committed = 0) {
  const f = energyFlow(day, settings),
    remaining = f.remaining - committed,
    word = (n) => energyAmount(n, themeOf(ctx));
  const last = previous.get(ctx);
  if (
    last?.date === day.date &&
    last.remaining !== remaining &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    document
      .getElementById("energy-visual")
      .animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.025)" }, { transform: "scale(1)" }],
        { duration: 360, easing: "ease-out" },
      );
  }
  previous.set(ctx, { date: day.date, remaining });
  setHTML(
    document.getElementById("energy-breakdown"),
    html`<dl class="energy-breakdown"><div><dt>Starting allowance</dt><dd>${f.allowance}</dd></div><div class="is-spending"><dt>Used</dt><dd>${signed(f.spent)}</dd></div><div class="is-recovery"><dt>Recovered</dt><dd>${signed(-f.recovered)}</dd></div>${committed > 0 ? html`<div class="is-planned"><dt>Planned</dt><dd>${signed(committed)}</dd></div>` : ""}<div><dt>Remaining</dt><dd>${remaining}</dd></div></dl><p class="sr-only">${word(f.allowance)} to start, ${word(f.spent)} used, ${word(f.recovered)} recovered${committed > 0 ? `, ${word(committed)} planned` : ""}, ${word(remaining)} remaining.</p>`,
  );
  let balance = f.allowance;
  const changes = day.entries.map((e) => {
    balance -= e.c;
    return { ...e, balance };
  });
  const recent = changes.slice(-5);
  const startingBalance = changes.length > 5 ? changes[changes.length - 6].balance : f.allowance;
  const wasOpen = document.querySelector("#energy-flow details")?.open;
  setHTML(
    document.getElementById("energy-flow"),
    html`<details><summary>How your energy changed${changes.length ? ` · ${changes.length} activities` : ""}</summary><ol class="energy-flow-list"><li><span>${changes.length > 5 ? "Before the latest 5 activities" : "Starting allowance"}</span><b>${startingBalance}</b></li>${recent.map((e) => html`<li class="${e.c < 0 ? "is-recovery" : "is-spending"}"><span>${e.a}<small>${e.t || "Time not set"}${e.c === 0 ? " · recorded only" : e.c < 0 ? ` · +${word(-e.c)} recovered` : ` · −${word(e.c)} used`}</small></span><b>${e.balance}<small>left</small></b></li>`)}</ol>${changes.length > 5 ? html`<p class="hint">Showing the latest 5 changes. The full activity log is below.</p>` : ""}</details>`,
  );
  document.querySelector("#energy-flow details").open = !!wasOpen;
}
