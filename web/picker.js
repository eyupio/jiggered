// Long-list helpers for the activity buttons and the symptom/trigger chips. Pure functions, no DOM, so they can be
// tested and reused by any future picker (search, favourites, groups and paging are all decided here).
import { addDays, listDays, listEpisodes } from "./model.js";

export const PICKER = {
  searchFrom: 8,      // show a search box once a list is longer than this
  favourites: 6,      // most shown in the favourites row
  favouriteWindow: 60, // days of history that count as "use"
  page: 12,           // items shown per group before "Show more"
  searchPage: 24,     // items shown per page of search results
};

const fold = s => String(s).normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

// matches: every word of the query appears somewhere in the text, ignoring case and accents.
export function matches(query, text) {
  const words = fold(query).split(/\s+/).filter(Boolean), t = fold(text);
  return words.every(w => t.includes(w));
}

// usage counts how often, and how recently, each activity, symptom and trigger name was logged.
export function usage(docs, today, days = PICKER.favouriteWindow) {
  const since = addDays(today, -days), out = { acts: new Map(), sym: new Map(), trig: new Map() };
  const bump = (m, name, when) => { const u = m.get(name) || { n: 0, last: "" }; u.n++; if (when > u.last) u.last = when; m.set(name, u) };
  for (const d of listDays(docs)) if (d.date >= since) for (const e of d.entries) bump(out.acts, e.a, d.date + "T" + (e.t || "00:00"));
  for (const [, e] of listEpisodes(docs)) if (e.when.slice(0, 10) >= since) {
    for (const s of e.symptoms) bump(out.sym, s, e.when);
    for (const t of e.before) bump(out.trig, t, e.when);
  }
  return out;
}

// favourites picks up to `max` names: mostly the ones used at least twice, then the latest used to fill the rest.
export function favourites(names, use, max = PICKER.favourites) {
  const used = names.filter(n => use.get(n)), byCount = [...used].filter(n => use.get(n).n >= 2)
    .sort((a, b) => use.get(b).n - use.get(a).n || use.get(b).last.localeCompare(use.get(a).last)).slice(0, Math.ceil(max * 2 / 3));
  const recent = used.filter(n => !byCount.includes(n)).sort((a, b) => use.get(b).last.localeCompare(use.get(a).last));
  return [...byCount, ...recent].slice(0, max);
}

// groupItems keeps the order the person chose: groups by first appearance, items inside by list order. Anything
// without a group goes last. A list with no groups at all comes back as one unnamed group.
export function groupItems(items, groupOf = x => x.g) {
  const groups = new Map(), loose = [];
  items.forEach((item, i) => {
    const g = (groupOf(item) || "").trim();
    if (!g) { loose.push({ item, i }); return }
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ item, i });
  });
  if (!groups.size) return [{ name: "", rows: loose }];
  return [...groups].map(([name, rows]) => ({ name, rows })).concat(loose.length ? [{ name: "Ungrouped", rows: loose }] : []);
}

export const groupNames = items => [...new Set(items.map(x => (x.g || "").trim()).filter(Boolean))];
