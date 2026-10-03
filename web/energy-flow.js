import { html, setHTML } from "./util.js";
import { energyAmount, themeOf } from "./energy-theme.js";
import { energyFlow } from "./planner-model.js";

const previous = new WeakMap();
export function renderEnergyFlow(ctx, day, settings) {
  const f = energyFlow(day, settings),
    word = (n) => energyAmount(n, themeOf(ctx));
  const last = previous.get(ctx);
  if (
    last?.date === day.date &&
    last.remaining !== f.remaining &&
    !matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    document
      .getElementById("energy-visual")
      .animate(
        [{ transform: "scale(1)" }, { transform: "scale(1.025)" }, { transform: "scale(1)" }],
        { duration: 360, easing: "ease-out" },
      );
  }
  previous.set(ctx, { date: day.date, remaining: f.remaining });
  setHTML(
    document.getElementById("energy-breakdown"),
    html`<dl class="energy-breakdown"><div><dt>Starting allowance</dt><dd>${f.allowance}</dd></div><div class="is-spending"><dt>Used</dt><dd>−${f.spent}</dd></div><div class="is-recovery"><dt>Recovered</dt><dd>+${f.recovered}</dd></div><div><dt>Remaining</dt><dd>${f.remaining}</dd></div></dl><p class="sr-only">${word(f.allowance)} to start, ${word(f.spent)} used, ${word(f.recovered)} recovered, ${word(f.remaining)} remaining.</p>`,
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
