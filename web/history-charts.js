// Small same-origin SVG charts, with a keyboard inspector and an equivalent data table.
import { energyCopy, energyAmount, energyWords } from "./energy-theme.js";
import { html, fmtDay } from "./util.js";
const W = 640,
  H = 220,
  LEFT = 44,
  RIGHT = 620,
  TOP = 18,
  BOTTOM = 180;
const num = (value, theme) =>
  value === null ? "No activities logged" : energyAmount(value, theme);
const rangeLabel = (b, locale) =>
  b.from === b.to ? fmtDay(b.from, locale) : `${fmtDay(b.from, locale)} – ${fmtDay(b.to, locale)}`;

export function bucketDescription(b, locale, theme = "points") {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return `${rangeLabel(b, locale)}. ${plural(b.checked, "check-in")} (${b.green} green, ${b.amber} amber, ${b.red} red). ${plural(b.logged, "day")} with activities. ${b.avgUsed === null ? energyCopy("No activity points recorded.", theme) : `Used ${energyWords(theme).plural} ${b.avgSpent}; recovered ${b.avgRecovery}; Net ${energyWords(theme).plural} ${b.avgUsed}; allowance ${b.avgAllowance}${b.from !== b.to ? " (averages on activity days)" : ""}.`} ${plural(b.episodes, "episode")}; ${plural(b.poorSleep, "day")} marked poor sleep; ${plural(b.recorded - b.poorSleep, "recorded day")} without a poor-sleep mark.`;
}

export function chartMarkup(data, kind, locale, theme = "points") {
  const { buckets } = data,
    combined = kind === "combined",
    energy = kind !== "episodes",
    id = "chart-" + kind;
  const height = combined ? 330 : H,
    left = combined ? 86 : LEFT;
  const values = energy
    ? buckets.flatMap((b) => [b.avgSpent, b.avgUsed, b.avgAllowance]).filter((n) => n !== null)
    : buckets.map((b) => b.episodes);
  const min = energy ? Math.min(0, ...values) : 0,
    max = Math.max(1, ...values);
  const rawStep = (max - min) / 4,
    power = 10 ** Math.floor(Math.log10(rawStep));
  const step = energy
    ? [1, 2, 5, 10].find((n) => n * power >= rawStep) * power
    : Math.max(1, Math.ceil(max / 3));
  const lo = Math.floor(min / step) * step,
    hi = Math.ceil(max / step) * step;
  const ticks = Array.from(
    { length: Math.round((hi - lo) / step) + 1 },
    (_, i) => Math.round((lo + i * step) * 100) / 100,
  );
  const x = (i) => left + ((i + 0.5) / buckets.length) * (RIGHT - left),
    y = (n) => BOTTOM - ((n - lo) / (hi - lo)) * (BOTTOM - TOP);
  const line = (key) => {
    let prior = false;
    return buckets
      .map((b, i) => {
        if (b[key] === null) {
          prior = false;
          return "";
        }
        const command = prior ? "L" : "M";
        prior = true;
        return `${command}${x(i).toFixed(2)},${y(b[key]).toFixed(2)}`;
      })
      .join(" ");
  };
  const available = combined
    ? buckets.some((b) => b.recorded)
    : energy
      ? buckets.some((b) => b.logged)
      : data.metrics.episodes > 0;
  return html`<div class="chart-card ${combined ? "chart-combined" : ""}" data-chart="${kind}">
    <div class="label-row"><h3>${combined ? "Sleep, energy & morning check-ins" : energy ? "Energy across your days" : "Episodes over time"}</h3><button class="help-tip" aria-label="About ${energy ? "energy" : "episode"} graph" data-tooltip="${energy ? energyCopy("Net points subtract recorded recovery from activity costs. Allowance uses each day's saved budget and penalties. Gaps mean no activities logged; longer periods show averages on activity days.", theme) : "Counts episodes by their recorded local start date. Zero means no episodes recorded, rather than proof of a symptom-free day."}">?</button></div>
    <p class="hint">${energy ? energyCopy("Activity points used before recovery, net points and your allowance.", theme) : "Episodes counted on the date they started."} ${combined ? "Lower rows show check-ins and poor-sleep flags; grouped periods retain all counts. " : ""}${data.bucketDays > 1 ? `Each point covers up to ${data.bucketDays} days.` : "One point per day."}</p>
    ${
      available
        ? html`<svg class="history-chart" viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc">
      <title id="${id}-title">${combined ? energyCopy("Sleep flags, morning check-ins and activity points", theme) : energy ? energyCopy("Activity points used, net points and allowance", theme) : "Recorded episode counts"}</title><desc id="${id}-desc">${energy ? energyCopy("Broken lines leave unlogged days empty. Recovery can bring net points below zero.", theme) : "Bars count episodes within each date bucket."} ${combined ? "Aligned rows retain all check-in and poor-sleep counts. Unmarked sleep is not evidence of good sleep. " : ""}Use the period selector or data table below for exact values.</desc>
      ${ticks.map((n) => {
        const yy = y(n);
        return html`<line class="chart-grid" x1="${left}" x2="${RIGHT}" y1="${yy}" y2="${yy}"></line><text class="chart-axis" x="${left - 8}" y="${yy + 4}" text-anchor="end">${n}</text>`;
      })}
      ${energy && lo < 0 ? html`<line class="chart-zero" x1="${left}" x2="${RIGHT}" y1="${y(0)}" y2="${y(0)}"></line>` : ""}
      ${energy ? html`<path class="chart-spent" d="${line("avgSpent")}"></path>${buckets.map((b, i) => (b.avgSpent !== null ? html`<circle class="chart-spent-point" cx="${x(i)}" cy="${y(b.avgSpent)}" r="3.5"></circle>` : ""))}<path class="chart-allowance" d="${line("avgAllowance")}"></path><path class="chart-used" d="${line("avgUsed")}"></path>${buckets.map((b, i) => (b.avgUsed !== null ? html`<circle class="chart-point" cx="${x(i)}" cy="${y(b.avgUsed)}" r="3.5"></circle>` : ""))}` : buckets.map((b, i) => html`<rect class="chart-episode" x="${x(i) - ((RIGHT - left) / buckets.length) * 0.32}" y="${y(b.episodes)}" width="${((RIGHT - left) / buckets.length) * 0.64}" height="${BOTTOM - y(b.episodes)}" rx="3"></rect>`)}
      ${combined ? combinedRows(buckets, left) : ""}
      ${buckets.map((b, i) => html`<rect class="chart-hit" data-bucket="${i}" x="${left + (i / buckets.length) * (RIGHT - left)}" y="${TOP}" width="${(RIGHT - left) / buckets.length}" height="${(combined ? 294 : BOTTOM) - TOP}"><title>${bucketDescription(b, locale, theme)}</title></rect>`)}
      <text class="chart-axis" x="${left}" y="${height - 12}">${buckets[0].from}</text><text class="chart-axis" x="${RIGHT}" y="${height - 12}" text-anchor="end">${buckets.at(-1).to}</text>
    </svg>`
        : html`<div class="chart-empty"><span class="label">${energy ? "Space for your energy story" : "No episodes recorded"}</span><p>${energy ? energyCopy("Log activities on Today to see how your points change across days.", theme) : "Any episodes matching this period and your filters will appear here."}</p></div>`
    }
    ${energy ? html`<div class="chart-legend"><span><i class="legend-spent"></i>Used before recovery</span><span><i class="legend-used"></i>Net ${energyWords(theme).plural}</span><span><i class="legend-allowance"></i>Allowance</span><span>Gaps = no activity log</span>${combined ? html`<span><i class="legend-green"></i>Green check-in</span><span><i class="legend-amber"></i>Amber check-in</span><span><i class="legend-red"></i>Red check-in</span><span><i class="legend-sleep"></i>Poor sleep marked</span><span><i></i>Unmarked / no check-in</span><span>Blank sleep = no day recorded</span>` : ""}</div>` : html`<div class="chart-legend"><span><i class="legend-used"></i>Episode count</span><span>Zero = none recorded</span></div>`}
    <div class="chart-inspector"><label class="field" for="${id}-select">Inspect a ${data.bucketDays > 1 ? "period" : "day"}<select id="${id}-select" data-inspect>${buckets.map((b, i) => html`<option value="${i}">${rangeLabel(b, locale)}</option>`)}</select></label><p class="meta" data-detail role="status"></p><button class="secondary small" data-chart-open>Open day</button></div>
    <details class="chart-data" id="${id}-data"><summary>View graph data</summary><div class="table-scroll" tabindex="0" role="region" aria-label="${energy ? "Energy" : "Episode"} graph data"><table><caption class="sr-only">Energy values are averages on activity days for grouped periods; check-ins and sleep flags are counts. Blank energy means no activities logged.</caption><thead><tr><th scope="col">Period</th>${energy ? html`<th scope="col">Used ${energyWords(theme).plural}</th><th scope="col">Recovered</th><th scope="col">Net ${energyWords(theme).plural}</th><th scope="col">Allowance</th><th scope="col">Activity days</th>${combined ? html`<th scope="col">Green / amber / red</th><th scope="col">Poor sleep marked</th><th scope="col">Recorded days</th>` : ""}` : html`<th scope="col">Episodes</th>`}</tr></thead><tbody>${buckets.map((b) => html`<tr><th scope="row">${rangeLabel(b, locale)}</th>${energy ? html`<td>${num(b.avgSpent, theme)}</td><td>${num(b.avgRecovery, theme)}</td><td>${num(b.avgUsed, theme)}</td><td>${b.avgAllowance === null ? "—" : b.avgAllowance}</td><td>${b.logged}</td>${combined ? html`<td>${b.green} / ${b.amber} / ${b.red}</td><td>${b.poorSleep}</td><td>${b.recorded}</td>` : ""}` : html`<td>${b.episodes}</td>`}</tr>`)}</tbody></table></div></details>
  </div>`;
}

function combinedRows(buckets, left) {
  const width = (RIGHT - left) / buckets.length;
  return html`<text class="chart-axis" x="${left - 8}" y="240" text-anchor="end">Check-in</text><text class="chart-axis" x="${left - 8}" y="280" text-anchor="end">Sleep flag</text>${buckets.map(
    (b, i) => {
      const days = Math.round((Date.parse(b.to) - Date.parse(b.from)) / 86400000) + 1;
      const start = left + i * width;
      let offset = 0;
      return html`<rect class="composition-empty" x="${start}" y="226" width="${width}" height="18"></rect>${[
        "green",
        "amber",
        "red",
      ].map((key) => {
        const x = start + (offset / days) * width;
        offset += b[key];
        return html`<rect class="composition-${key}" x="${x}" y="226" width="${(b[key] / days) * width}" height="18"></rect>`;
      })}<rect class="composition-empty" x="${start}" y="266" width="${(b.recorded / days) * width}" height="18"></rect><rect class="chart-sleep" x="${start}" y="266" width="${(b.poorSleep / days) * width}" height="18"></rect>`;
    },
  )}`;
}

export function connectCharts(root, data, locale, open, theme = "points") {
  for (const card of root.querySelectorAll("[data-chart]")) {
    const select = card.querySelector("[data-inspect]"),
      detail = card.querySelector("[data-detail]"),
      button = card.querySelector("[data-chart-open]");
    const update = (index) => {
      const b = data.buckets[index];
      select.value = String(index);
      detail.textContent = bucketDescription(b, locale, theme);
      button.textContent = b.from === b.to ? "Open day" : "Explore this period";
      card
        .querySelectorAll("[data-bucket]")
        .forEach((el) => el.classList.toggle("is-inspected", Number(el.dataset.bucket) === index));
    };
    update(
      Math.max(
        0,
        data.buckets.findLastIndex((b) => b.checked || b.logged || b.episodes || b.poorSleep),
      ),
    );
    select.addEventListener("change", () => update(Number(select.value)));
    card.querySelector("svg")?.addEventListener("pointermove", (e) => {
      const hit = e.target.closest("[data-bucket]");
      if (hit) update(Number(hit.dataset.bucket));
    });
    card.querySelector("svg")?.addEventListener("click", (e) => {
      const hit = e.target.closest("[data-bucket]");
      if (hit) update(Number(hit.dataset.bucket));
    });
    button.addEventListener("click", () => open(data.buckets[Number(select.value)]));
  }
}
