// Tells a person when the shared defaults have items their own lists lack, and adds them in one tap.
// It only ever adds to the end of their lists. "Not now" is remembered until the shared defaults change again.
import { $, html, setHTML } from "./util.js";
import { defaultsGap, mergeDefaults, gapSignature, identifyActivities } from "./model.js";

const KEYS = ["activities", "symptoms", "triggers"];
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const describeGap = (gap) =>
  [
    gap.acts.length && plural(gap.acts.length, "activity", "activities"),
    gap.sym.length && plural(gap.sym.length, "symptom", "symptoms"),
    gap.trig.length && plural(gap.trig.length, "trigger", "triggers"),
  ]
    .filter(Boolean)
    .join(", ");
export const previewGap = (gap, max = 4) => {
  const names = [...gap.acts.map((x) => x.a), ...gap.sym, ...gap.trig];
  return (
    names.slice(0, max).join(", ") + (names.length > max ? ` and ${names.length - max} more` : "")
  );
};

export function initDefaultsNotice(ctx, { canWrite }) {
  const el = $("defaults-notice"),
    dismissKey = `jiggered:defaults-dismissed:${ctx.me.id}`;
  const dismissed = () => {
    try {
      return localStorage.getItem(dismissKey);
    } catch {
      return null;
    }
  };
  const dismiss = (sig) => {
    try {
      localStorage.setItem(dismissKey, sig);
    } catch {
      /* only a convenience */
    }
  };
  const current = () => {
    if (!ctx.store.view("settings") || !canWrite()) return null;
    const gap = defaultsGap(ctx.settings(), ctx.defaults());
    return gap.total ? gap : null;
  };
  const pick = (S, keys) => Object.fromEntries(keys.map((k) => [k, S[k]]));

  function update() {
    const gap = current(),
      sig = gap && gapSignature(gap);
    if (!gap || dismissed() === sig) {
      if (!el.hidden) {
        el.hidden = true;
        el.replaceChildren();
      }
      return;
    }
    if (el.dataset.sig === sig && !el.hidden) return; // already showing this; don't rebuild under someone's finger
    el.dataset.sig = sig;
    setHTML(
      el,
      html`<h2>New in the shared defaults</h2><p>Your admin has added ${describeGap(gap)} that aren't in your lists yet: <span class="meta">${previewGap(gap)}</span>. Your own items, order and points won't change.</p><div class="row"><button class="primary" data-notice="add">Add ${gap.total === 1 ? "it" : `all ${gap.total}`} to my lists</button><button class="secondary" data-notice="review">Review in Account</button><button class="x" data-notice="later">Not now</button></div>`,
    );
    el.hidden = false;
  }

  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-notice]"),
      gap = current();
    if (!b || !gap) return;
    if (b.dataset.notice === "later") {
      dismiss(gapSignature(gap));
      update();
      return;
    }
    if (b.dataset.notice === "review") {
      ctx.editSettings("set-acts");
      return;
    }
    if (ctx.drafts?.get("settings")) {
      ctx.toast(
        "You have an unfinished settings draft in Account. Finish or discard it first, or review there.",
      );
      return;
    }
    const S = ctx.settings(),
      base = { ...S, activities: identifyActivities(S.activities) },
      merged = mergeDefaults(S, ctx.defaults());
    const keys = KEYS.filter((k) => JSON.stringify(merged[k]) !== JSON.stringify(base[k]));
    if (!keys.length) return;
    ctx.store.dispatch({
      id: "settings",
      type: "settingsPatch",
      arg: pick(merged, keys),
      before: pick(base, keys),
      original: base,
    });
    ctx.toast(`Added ${plural(gap.total, "item", "items")} to your lists.`, {
      label: "Undo",
      fn: () => {
        dismiss(gapSignature(gap)); // they chose not to have these: don't ask again
        ctx.store.dispatch({
          id: "settings",
          type: "settingsPatch",
          arg: pick(base, keys),
          before: pick(merged, keys),
          original: merged,
        });
      },
    });
  });

  return { update };
}
