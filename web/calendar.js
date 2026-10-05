// A time grid: day columns on an hour rail, with blocks that can be dragged, resized or moved from the keyboard.
// It draws what it is given and reports what the person did; it never writes data (the views that own the data do).
// Geometry is set through CSS custom properties from script, because the CSP forbids style attributes in markup.
//
// A drag shows a snapped preview in the column under the pointer and moves nothing until it is dropped. The grid is
// not repainted while a gesture is under way (a sync could otherwise replace the block being dragged), and focus and
// scroll position are restored after every repaint so keyboard moves feel continuous.

import { html, setHTML, signed } from "./util.js";
import {
  DAY,
  STEP,
  NEW_DUR,
  fromMinutes,
  hourWindow,
  layoutDay,
  moveTo,
  resizeEnd,
  resizeStart,
  slotText,
  spanOf,
  scaleCost,
} from "./calendar-model.js";

const MOVE_SLOP = 4; // pixels before a press becomes a drag; a smaller movement is still a click
const EDGE = 40; // pixels from the top or bottom of the scroller where dragging starts to scroll it, faster the closer
const PAGE_EDGE = 70; // the same for the window itself, while something is carried in from elsewhere on the page
let grids = 0;
const nowMinute = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// hooks: { editable(), onSelectDay(date), onOpen({date,id}), onCreate({date,start}),
//          onChange({id, fromDate, toDate, start, dur, source}), onDrop(payload, {date,start,dur}),
//          onRemove({date,id}) (optional: blocks marked `removable` then carry a remove control),
//          onMenu({date,id,x,y,el}) (optional: right-click, or the menu key, on an editable block) }
export function createTimeGrid(root, hooks) {
  let model = null,
    win = [6 * 60, 22 * 60],
    session = null,
    pending = null,
    focusKey = null,
    scrolled = false,
    suppressClick = false;
  // The painted part is replaced on every render; the live region stays put so announcements are not lost.
  const inner = Object.assign(document.createElement("div"), { className: "cal-inner" }),
    live = Object.assign(document.createElement("div"), { className: "sr-only" }),
    helpId = `cal-help-${++grids}`;
  live.setAttribute("role", "status");
  root.append(inner, live);
  const announce = (text) => {
    live.textContent = text;
  };
  const q = (selector, from = root) => from.querySelector(selector);
  const all = (selector, from = root) => [...from.querySelectorAll(selector)];
  const byKey = (key) => all("[data-key]").find((el) => el.dataset.key === key);

  // Blocks with no cost (an episode) leave the cost out of what is said and shown.
  const label = (b) =>
    `${b.title}${b.slot ? ", " + b.slot : ""}${b.cost === undefined ? "" : `, ${b.cost < 0 ? `recovers ${-b.cost}` : b.cost === 0 ? "costs nothing" : `uses ${b.cost}`}`}${b.done ? ", done" : ""}${b.hint ? ". " + b.hint : ""}`;
  const meta = (b) =>
    [b.slot, b.cost === undefined ? "" : signed(b.cost), b.hint].filter(Boolean).join(" · ");

  function paint(m) {
    model = m;
    const scroller = q("[data-cal-scroll]"),
      top = scroller ? scroller.scrollTop : 0,
      active = document.activeElement,
      keep = focusKey ?? (root.contains(active) ? active.closest("[data-key]")?.dataset.key : null);
    focusKey = null;
    const days = m.days.map((d) => {
      // `slot` is the text for what was recorded; the drawn length of an entry with none is only a default.
      const marked = d.blocks.map((b) => ({ ...b, slot: slotText(b) })),
        timed = marked.flatMap((b) => {
          const s = spanOf(b);
          return s ? [{ ...b, ...s }] : [];
        });
      // Blocks marked `side` (episodes) are laid out among themselves, in a strip down the edge of the column.
      const laid = [
        ...layoutDay(timed.filter((b) => !b.side)),
        ...layoutDay(timed.filter((b) => b.side)),
      ];
      return { ...d, laid, tray: marked.filter((b) => !spanOf(b)) };
    });
    win = hourWindow(days.flatMap((d) => d.laid));
    const hours = Array.from({ length: (win[1] - win[0]) / 60 }, (_, i) => win[0] + i * 60);
    const editable = m.editable && hooks.editable();
    // A remove control is a span, not a button: it sits inside the block's own button. Keyboard users press Delete.
    const remove = (b) =>
      editable && hooks.onRemove && b.removable
        ? html`<span class="cal-remove" role="button" tabindex="-1" data-remove aria-label="Remove ${b.title}" title="Remove ${b.title}">×</span>`
        : "";
    const removable = (b) => (editable && hooks.onRemove && b.removable ? " is-removable" : "");
    const block = (d, b) =>
      html`<button type="button" class="cal-block cal-${b.kind}${b.side ? " cal-side" : ""}${b.done ? " is-done" : ""}${b.dur <= 30 ? " is-short" : ""}${b.cost < 0 ? " is-recovery" : b.cost > 0 ? " is-spend" : ""}${b.tone ? ` cal-tone cal-tone-${b.tone}` : ""}${editable && b.editable ? " is-editable" : ""}${removable(b)}" data-key="${d.date}|${b.id}" data-date="${d.date}" data-id="${b.id}" data-s="${b.start - win[0]}" data-d="${b.dur}" data-lane="${b.lane}" data-lanes="${b.lanes}" data-cost="${b.cost ?? ""}" aria-label="${label(b)}" title="${label(b)}" aria-describedby="${helpId}">${editable && b.editable ? html`<span class="cal-resize" data-edge="top" aria-hidden="true"></span><span class="cal-grip" aria-hidden="true"></span>` : ""}${remove(b)}<span class="cal-title">${b.done ? "✓ " : ""}${b.title}</span>${b.cost === undefined ? "" : html`<b class="cal-cost-badge" aria-hidden="true">${signed(b.cost)}</b>`}<span class="cal-meta">${meta(b)}</span>${editable && b.editable ? html`<span class="cal-resize" data-edge="bottom" aria-hidden="true"></span>` : ""}</button>`;
    setHTML(
      inner,
      html`<p class="sr-only" id="${helpId}">${(editable && m.help) || (editable ? "Enter opens a block to edit it. Up and down arrows move it by 15 minutes, Left and Right move it to another day, and Shift with Up or Down changes how long it lasts." + (hooks.onRemove ? " Delete removes it, after asking you to confirm." : "") : "Enter opens a block.")}</p>
      <div class="cal-scroll" data-cal-scroll><div class="cal-top"><div class="cal-head"><span class="cal-corner"></span>${days.map((d) => html`<button type="button" class="cal-day-head${d.today ? " is-today" : ""}${d.selected ? " is-selected" : ""}${d.warn ? " is-warn" : ""}" data-cal-day="${d.date}" aria-pressed="${!!d.selected}"><span>${d.label}</span><b>${d.value}</b></button>`)}</div>
      ${days.some((d) => d.tray.length) ? html`<div class="cal-tray-row"><span class="cal-corner">Any time</span>${days.map((d) => html`<div class="cal-tray" data-date="${d.date}">${d.tray.map((b) => html`<button type="button" class="cal-chip cal-${b.kind}${b.done ? " is-done" : ""}${b.tone ? ` cal-tone cal-tone-${b.tone}` : ""}${editable && b.editable ? " is-editable" : ""}${removable(b)}" data-key="${d.date}|${b.id}" data-date="${d.date}" data-id="${b.id}" aria-label="${label(b)}" title="${label(b)}">${b.done ? "✓ " : ""}${b.title}${b.cost === undefined ? "" : html` <b class="cal-chip-cost" aria-hidden="true">${signed(b.cost)}</b>`}${remove(b)}</button>`)}</div>`)}</div>` : ""}
      </div><div class="cal-body" data-cal-body><div class="cal-rail" aria-hidden="true">${hours.map((h) => html`<span>${fromMinutes(h)}</span>`)}</div>${days.map((d) => html`<div class="cal-col${d.today ? " is-today" : ""}${m.strip ? " has-side" : ""}" data-cal-col data-date="${d.date}" role="group" aria-label="${d.label}">${d.laid.map((b) => block(d, b))}${d.today ? html`<span class="cal-now" aria-hidden="true"></span>` : ""}</div>`)}</div></div>`,
    );
    const body = q("[data-cal-body]");
    inner.style.setProperty("--cols", String(days.length));
    body.style.setProperty("--hours", String(hours.length));
    for (const el of all("[data-s]")) {
      el.style.setProperty("--start", el.dataset.s);
      el.style.setProperty("--span", el.dataset.d);
      el.style.setProperty("--lane", el.dataset.lane);
      el.style.setProperty("--lanes", el.dataset.lanes);
    }
    tickNow();
    const next = q("[data-cal-scroll]");
    if (!next.clientHeight) {
      // Painted while its tab is hidden: nothing can be measured yet, so place it when it is first shown.
      next.scrollTop = top;
    } else if (!scrolled) {
      // First view: start an hour before the earliest block, or at the working day if the grid is empty.
      // The side strip (episodes) does not count: one that began the night before must not scroll the view to midnight.
      const first = days
        .flatMap((d) => d.laid)
        .filter((b) => !b.side)
        .reduce((n, b) => Math.min(n, b.start), 8 * 60);
      const head = q(".cal-top");
      next.scrollTop = Math.max(
        0,
        body.offsetTop +
          ((first - win[0] - 60) / (win[1] - win[0])) * body.offsetHeight -
          head.offsetHeight,
      );
      scrolled = true;
    } else next.scrollTop = top;
    const again = keep && byKey(keep);
    if (again) again.focus({ preventScroll: true });
  }

  function tickNow() {
    const now = q(".cal-now");
    if (!now) return;
    const at = nowMinute();
    now.hidden = at < win[0] || at > win[1];
    now.style.setProperty("--start", String(at - win[0]));
  }
  const clock = setInterval(tickNow, 60_000);

  // ---- where a pointer is on the grid ----
  const cols = () => all("[data-cal-col]");
  function colAt(x) {
    const list = cols();
    return (
      list.find(
        (c) => x >= c.getBoundingClientRect().left && x < c.getBoundingClientRect().right,
      ) ??
      list.reduce((best, c) => {
        const r = c.getBoundingClientRect(),
          gap = Math.min(Math.abs(x - r.left), Math.abs(x - r.right));
        return !best || gap < best.gap ? { c, gap } : best;
      }, null)?.c
    );
  }
  function minuteAt(col, y) {
    const r = col.getBoundingClientRect();
    return win[0] + ((y - r.top) / r.height) * (win[1] - win[0]);
  }

  // ---- drag, resize and drop ----
  const drop = document.createElement("div");
  drop.className = "cal-drop";
  drop.hidden = true;
  const preview = (date, start, dur, name) => {
    const col = cols().find((c) => c.dataset.date === date);
    if (!col) return;
    col.append(drop);
    drop.hidden = false;
    drop.style.setProperty("--start", String(start - win[0]));
    drop.style.setProperty("--span", String(dur));
    drop.textContent = `${fromMinutes(start)}–${fromMinutes(Math.min(start + dur, DAY))}${name ? ` · ${name}` : ""}`;
  };

  function begin(e, s) {
    session = {
      ...s,
      pointerId: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      moved: false,
      last: e,
      armed: s.kind !== "external",
    };
    // Pulling an activity in from a list must not also select text or scroll the page by itself (browsers do both).
    if (s.kind === "external") document.body.style.setProperty("user-select", "none");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onEscape, true);
  }
  function end() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onEscape, true);
    cancelAnimationFrame(session?.raf);
    cancelAnimationFrame(session?.pageRaf);
    document.body.style.removeProperty("user-select");
    drop.hidden = true;
    drop.remove();
    const s = session;
    s?.el?.classList.remove("is-dragging");
    if (s?.kind.startsWith("resize") && s.el) {
      s.el.style.setProperty("--start", s.el.dataset.s);
      s.el.style.setProperty("--span", s.el.dataset.d);
      const meta = s.el.querySelector(".cal-meta");
      if (meta && s.meta !== undefined) meta.textContent = s.meta;
    }
    session = null;
    if (pending) {
      const m = pending;
      pending = null;
      paint(m);
    }
    return s;
  }

  function update(e) {
    const s = session;
    if (!s) return;
    s.last = e;
    const sc = q("[data-cal-scroll]"),
      area = sc.getBoundingClientRect();
    if (!s.moved && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) < MOVE_SLOP) return;
    if (!s.moved) {
      s.moved = true;
      s.el?.classList.add("is-dragging");
    }
    // Only over the grid does a drop count: letting go anywhere else (back where it started, say) changes nothing.
    // A little room above and below lets a drag run past the edge, which scrolls.
    const over =
      e.clientX >= area.left &&
      e.clientX <= area.right &&
      e.clientY >= area.top - EDGE &&
      e.clientY <= area.bottom + EDGE;
    if (s.kind.startsWith("resize")) {
      const col = s.el.closest("[data-cal-col]"),
        at = minuteAt(col, e.clientY);
      s.target = s.kind === "resize-top" ? resizeStart(s.origin, at) : resizeEnd(s.origin, at);
      s.target = { ...s.target, date: s.origin.date };
      s.target.cost = scaleCost(s.cost, s.origin.dur, s.target.dur);
      s.el.style.setProperty("--start", String(s.target.start - win[0]));
      s.el.style.setProperty("--span", String(s.target.dur));
      // The points are shown as the length changes, on the block and to a screen reader.
      const meta = s.el.querySelector(".cal-meta"),
        points = Number.isInteger(s.cost) ? signed(s.target.cost) : "";
      if (meta)
        meta.textContent = [slotText({ t: fromMinutes(s.target.start), dur: s.target.dur }), points]
          .filter(Boolean)
          .join(" · ");
      announce(
        `${fromMinutes(s.target.start)} to ${fromMinutes(Math.min(s.target.start + s.target.dur, DAY))}${points ? `, ${points} points` : ""}`,
      );
    } else {
      const col = over ? colAt(e.clientX) : null;
      if (!col) {
        s.target = null;
        drop.hidden = true;
      } else {
        const at = minuteAt(col, e.clientY),
          next = moveTo({ start: 0, dur: s.origin.dur }, at - s.grab);
        s.target = { start: next.start, dur: next.dur, date: col.dataset.date };
        preview(s.target.date, s.target.start, s.target.dur, s.payload?.preset?.a);
      }
    }
    // Near the top or bottom of the scroller, keep scrolling so the rest of the day can be reached.
    const r = area,
      near = Math.min(e.clientY - r.top, r.bottom - e.clientY);
    // A drag that comes in from outside (an activity from the list) crosses the edge on its way in: only once it has
    // been well inside the grid does reaching an edge scroll.
    if (near > EDGE && e.clientX >= r.left && e.clientX <= r.right) s.armed = true;
    const dir =
        !over || !s.armed ? 0 : e.clientY < r.top + EDGE ? -1 : e.clientY > r.bottom - EDGE ? 1 : 0,
      speed = Math.max(2, Math.round((1 - Math.max(0, near) / EDGE) * 12));
    // Something picked up from a list elsewhere on the page: near the top or bottom of the window, the page scrolls so
    // the list and the timeline can both be reached.
    cancelAnimationFrame(s.pageRaf);
    const pageDir =
      s.kind === "external" && s.moved
        ? e.clientY < PAGE_EDGE
          ? -1
          : e.clientY > innerHeight - PAGE_EDGE
            ? 1
            : 0
        : 0;
    if (pageDir) {
      const near = pageDir < 0 ? e.clientY : innerHeight - e.clientY,
        by = Math.max(4, Math.round((1 - Math.max(0, near) / PAGE_EDGE) * 22));
      const scrollPage = () => {
        scrollBy(0, pageDir * by);
        update(s.last);
        s.pageRaf = requestAnimationFrame(scrollPage);
      };
      s.pageRaf = requestAnimationFrame(scrollPage);
    }
    cancelAnimationFrame(s.raf);
    if (dir && !s.kind.startsWith("resize")) {
      const step = () => {
        sc.scrollTop += dir * speed;
        update(s.last);
        s.raf = requestAnimationFrame(step);
      };
      s.raf = requestAnimationFrame(step);
    }
  }
  const onMove = (e) => {
    if (session && e.pointerId === session.pointerId) update(e);
  };
  // A drag ends with a click on whatever is under the pointer. That click is not wanted: ignore it until the button is
  // let go (it may still be held after Escape), with a limit so a lost release can never leave clicks switched off.
  function holdClick(released) {
    suppressClick = true;
    const free = () => setTimeout(() => (suppressClick = false), 60);
    if (released) free();
    else {
      window.addEventListener("pointerup", free, { once: true });
      setTimeout(() => (suppressClick = false), 10_000);
    }
  }
  function onUp(e) {
    if (!session || e.pointerId !== session.pointerId) return;
    update(e);
    const s = end();
    if (!s.moved) return;
    holdClick(true);
    if (!s.target) return;
    const t = s.target;
    if (s.kind === "external")
      hooks.onDrop(s.payload, { date: t.date, start: t.start, dur: t.dur });
    else if (
      t.date !== s.origin.date ||
      t.start !== s.origin.start ||
      t.dur !== s.origin.dur ||
      s.origin.untimed
    )
      hooks.onChange({
        id: s.id,
        fromDate: s.origin.date,
        toDate: t.date,
        start: t.start,
        dur: t.dur,
        cost: t.cost,
        source: "pointer",
      });
  }
  function onCancel(e) {
    if (!session || e.pointerId !== session.pointerId) return;
    if (end().moved) holdClick(true);
  }
  function onEscape(e) {
    if (e.key === "Escape" && session) {
      e.preventDefault();
      e.stopPropagation();
      end();
      holdClick(false);
    }
  }

  root.addEventListener("pointerdown", (e) => {
    if ((e.pointerType === "mouse" && e.button !== 0) || session || !model || !hooks.editable())
      return;
    const el = e.target.closest(".cal-block.is-editable, .cal-chip.is-editable");
    if (!el || e.target.closest(".cal-remove")) return;
    const resize = e.target.closest(".cal-resize"),
      date = el.dataset.date,
      untimed = el.classList.contains("cal-chip");
    // A finger scrolls the page unless it starts on the grip, or presses and holds an edge: the invisible edges must
    // not turn an ordinary scroll that happens to start on a block into a resize.
    if (e.pointerType === "touch" && !resize && !e.target.closest(".cal-grip")) return;
    if (untimed && e.pointerType === "touch") return;
    if (e.pointerType === "touch" && resize) {
      holdThen(e, () => startDrag(e, el, resize, date, untimed));
      return;
    }
    startDrag(e, el, resize, date, untimed);
  });
  // Waits for a finger to rest on an edge before it becomes a resize; moving first means it is a scroll.
  const HOLD_MS = 300,
    HOLD_SLOP = 8;
  function holdThen(e, start) {
    const pointerId = e.pointerId,
      x0 = e.clientX,
      y0 = e.clientY;
    let timer = 0;
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
    const move = (ev) => {
      if (ev.pointerId === pointerId && Math.hypot(ev.clientX - x0, ev.clientY - y0) > HOLD_SLOP)
        stop();
    };
    timer = setTimeout(() => {
      stop();
      if (!session) start();
    }, HOLD_MS);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }
  function startDrag(e, el, resize, date, untimed) {
    const origin = untimed
      ? { date, start: 0, dur: NEW_DUR, untimed: true }
      : { date, start: Number(el.dataset.s) + win[0], dur: Number(el.dataset.d) };
    const col = el.closest("[data-cal-col]");
    begin(e, {
      kind: resize ? "resize-" + resize.dataset.edge : "move",
      id: el.dataset.id,
      el,
      origin,
      cost: Number(el.dataset.cost),
      meta: el.querySelector(".cal-meta")?.textContent,
      grab: untimed || !col ? 0 : minuteAt(col, e.clientY) - origin.start,
    });
    try {
      (resize || el).setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that is already gone cannot be captured */
    }
  }
  // While a finger is carrying a held edge the page must not scroll under it. (The grip stops scrolling by itself with
  // touch-action: none.) The listener has to exist before the touch starts, or the browser has already begun to scroll.
  root.addEventListener(
    "touchmove",
    (ev) => {
      if (session?.kind.startsWith("resize") && ev.cancelable) ev.preventDefault();
    },
    { passive: false },
  );
  root.addEventListener(
    "click",
    (e) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
    true,
  );
  root.addEventListener("click", (e) => {
    const head = e.target.closest("[data-cal-day]");
    if (head) return hooks.onSelectDay(head.dataset.calDay);
    const el = e.target.closest(".cal-block, .cal-chip");
    if (el && e.target.closest(".cal-remove")) {
      if (hooks.editable()) hooks.onRemove?.({ date: el.dataset.date, id: el.dataset.id });
      return;
    }
    if (el) return hooks.onOpen({ date: el.dataset.date, id: el.dataset.id });
    const col = e.target.closest("[data-cal-col]");
    if (col && hooks.editable() && model?.editable)
      hooks.onCreate({
        date: col.dataset.date,
        start: Math.max(
          0,
          Math.min(DAY - STEP, Math.floor(minuteAt(col, e.clientY) / STEP) * STEP),
        ),
      });
  });

  // A right-click (or the menu key, which reports no pointer position) on a block asks the view for its menu.
  root.addEventListener("contextmenu", (e) => {
    const el = e.target.closest?.(".cal-block.is-editable, .cal-chip.is-editable");
    if (!el || !hooks.onMenu || !hooks.editable()) return;
    e.preventDefault();
    if (session) return;
    const r = el.getBoundingClientRect(),
      keyboard = e.clientX === 0 && e.clientY === 0;
    hooks.onMenu({
      date: el.dataset.date,
      id: el.dataset.id,
      x: keyboard ? r.left + r.width / 2 : e.clientX,
      y: keyboard ? r.top + r.height / 2 : e.clientY,
      el,
    });
  });

  // ---- the keyboard: arrows move a focused block, Shift with Up or Down changes its length ----
  root.addEventListener("keydown", (e) => {
    const el = e.target.closest?.(".cal-block.is-editable, .cal-chip.is-removable");
    if (!el || session || !hooks.editable()) return;
    if (e.key === "Delete" && el.classList.contains("is-removable")) {
      e.preventDefault();
      hooks.onRemove({ date: el.dataset.date, id: el.dataset.id });
      return;
    }
    if (!el.classList.contains("cal-block")) return;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const date = el.dataset.date,
      from = { start: Number(el.dataset.s) + win[0], dur: Number(el.dataset.d) },
      dates = model.days.map((d) => d.date),
      title = q(".cal-title", el).textContent.replace(/^✓ /, "");
    let to = date,
      next = from;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      to = dates[dates.indexOf(date) + (e.key === "ArrowLeft" ? -1 : 1)];
      if (!to) return announce(`No ${e.key === "ArrowLeft" ? "earlier" : "later"} day is shown.`);
    } else {
      const by = e.key === "ArrowUp" ? -STEP : STEP;
      next = e.shiftKey
        ? resizeEnd(from, from.start + from.dur + by)
        : moveTo(from, from.start + by);
      if (next.start === from.start && next.dur === from.dur)
        return announce(
          by < 0 ? "Already at the earliest it can go." : "Already at the end of the day.",
        );
    }
    focusKey = `${to}|${el.dataset.id}`;
    const day = model.days.find((d) => d.date === to),
      cost = Number(el.dataset.cost),
      scaled = next.dur === from.dur ? undefined : scaleCost(cost, from.dur, next.dur);
    announce(
      `${title}, ${day?.label ?? to}, ${fromMinutes(next.start)} to ${fromMinutes(Math.min(next.start + next.dur, DAY))}${Number.isInteger(scaled) ? `, ${signed(scaled)} points` : ""}`,
    );
    hooks.onChange({
      id: el.dataset.id,
      fromDate: date,
      toDate: to,
      start: next.start,
      dur: next.dur,
      cost: scaled,
      source: "keyboard",
    });
  });

  return {
    render(m) {
      if (session) pending = m;
      else paint(m);
    },
    // Lets something outside the grid (the activity palette) start a drag that ends on it.
    beginExternalDrag(e, payload) {
      if (session || !model || !hooks.editable() || !model.editable) return;
      begin(e, {
        kind: "external",
        payload,
        el: null,
        origin: { date: null, start: 0, dur: payload.dur ?? NEW_DUR },
        grab: 0,
      });
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch {
        /* nothing to capture */
      }
    },
    active: () => !!session,
    justDropped: () => suppressClick,
    destroy() {
      clearInterval(clock);
      if (session) end();
    },
  };
}
