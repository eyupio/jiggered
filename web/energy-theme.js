// Presentation only. Saved budgets, activity costs and export fields always keep their original values.
export const energyTheme = (profile) => (profile?.energyTheme === "spoons" ? "spoons" : "points");
export const energyWords = (theme) =>
  theme === "spoons"
    ? { singular: "spoon", plural: "spoons", title: "Spoons" }
    : { singular: "point", plural: "points", title: "Points" };
export const energyAmount = (n, theme) =>
  `${n} ${Math.abs(n) === 1 ? energyWords(theme).singular : energyWords(theme).plural}`;
// Only for application-authored energy copy, never names, notes, search queries or graph data points.
export const energyCopy = (text, theme) =>
  theme === "spoons"
    ? text.replace(
        /\b[Pp]oints?\b/g,
        (word) =>
          (word[0] === "P" ? "S" : "s") + (word.toLowerCase() === "point" ? "poon" : "poons"),
      )
    : text;
export const themeOf = (ctx) => energyTheme(ctx.store?.view("settings")?.profile);

export function applyEnergyTheme(theme, root = document) {
  for (const el of root.querySelectorAll("[data-energy-copy]")) {
    const text = energyCopy(el.dataset.energyCopy, theme);
    if (el.textContent !== text) el.textContent = text;
  }
  for (const el of root.querySelectorAll("[data-energy-tooltip]"))
    el.dataset.tooltip = energyCopy(el.dataset.energyTooltip, theme);
  for (const el of root.querySelectorAll("[data-energy-label]"))
    el.setAttribute("aria-label", energyCopy(el.dataset.energyLabel, theme));
}

// A consistent outlined spoon, drawn with the current text colour at every size.
export const SPOON_PATH =
  "M12 2c-2.5 0-4 2.7-4 5.5 0 2.4 1.1 4.1 2.5 4.8L10 20a2 2 0 0 0 4 0l-.5-7.7C14.9 11.6 16 9.9 16 7.5 16 4.7 14.5 2 12 2Z";
