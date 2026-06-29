// recordable selector picker — armed by the toolbar button, then: hover to
// highlight, click to copy a unique target selector in recordable's grammar.
//
// Priority (shortest, most readable first):
//   `:text(…)` → `#id` → `tag[attr='…']` → minimal CSS path.
// `:text(…)` and attributes/ids are only emitted when they resolve *uniquely*,
// so the copied selector always identifies exactly the target element.
//
// Runs in every frame (`all_frames`): each frame's `document` is scoped to
// itself, which matches how recordable's getHandle races a selector across all
// frames — a selector only needs to be unique within its own frame.

(() => {
  // Static content scripts inject once per load; this also makes a manual
  // re-inject / SPA re-run a no-op rather than stacking a second instance.
  if (window.__recordablePicker) return;
  window.__recordablePicker = true;

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const tagOf = (el) => el.tagName.toLowerCase();
  const isVisible = (el) =>
    !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  // Above this many matches, `:nth(N)` is too brittle to be worth it — fall back
  // to a positional CSS path instead.
  const MAX_NTH = 9;

  // Given a short candidate selector and the (document-order) elements it matches,
  // return the candidate when it's unique, `candidate:nth(K)` when `el` is the
  // Kth of a few *visible* matches, or null when it's not worth it. Indexing
  // visible-only mirrors how recordable's getHandle resolves `:nth(N)`.
  function indexedSelector(candidate, matches, el) {
    const visible = matches.filter(isVisible);
    const k = visible.indexOf(el);
    if (k === -1) return null;
    if (visible.length === 1) return candidate;
    if (visible.length > MAX_NTH) return null;
    return `${candidate}:nth(${k + 1})`;
  }

  // ─── clickable-ancestor promotion ───────────────────────────────────────────
  // Clicking an icon/label usually means "click the control around it". Promote
  // the clicked node to its nearest enclosing control so we select the <a> or
  // <button>, not the inner <span>/<svg>. Hold Alt to pick the exact element.

  const CLICKABLE =
    "a, button, input, select, textarea, label, summary, [role='button']," +
    "[role='link'], [role='tab'], [role='menuitem'], [role='checkbox']," +
    "[role='radio'], [onclick], [tabindex]";

  function isClickable(el) {
    if (el.matches(CLICKABLE)) return true;
    // `cursor:pointer` is inherited, so it only signals a control where it
    // *originates* — i.e. the parent isn't also pointer.
    const parent = el.parentElement;
    return (
      getComputedStyle(el).cursor === "pointer" &&
      (!parent || getComputedStyle(parent).cursor !== "pointer")
    );
  }

  function clickableTarget(el) {
    let cur = el;
    for (let i = 0; cur && cur !== document.body && i < 8; i++) {
      if (isClickable(cur)) return cur;
      cur = cur.parentElement;
    }
    return el;
  }

  // ─── selector generation ──────────────────────────────────────────────────

  // recordable resolves `:text(X)` to Puppeteer's `::-p-text(X)`: a substring
  // match on the *smallest* element whose visible text contains X. We mirror
  // that here to test uniqueness without Puppeteer. Returns the smallest
  // (innermost) elements containing `text`.
  function smallestContaining(text) {
    const hits = [];
    for (const el of document.body.getElementsByTagName("*")) {
      if (isOurs(el)) continue;
      if (norm(el.textContent).includes(text)) hits.push(el);
    }
    // "Smallest" = no other hit nested inside it.
    return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o)));
  }

  // A `tag:text(…)` candidate for `el` plus the elements it matches, or null.
  // The closing `)` can't appear in the text (the resolver captures up to the
  // first `)`), and overlong/blank text makes a poor selector — reject those.
  function textCandidate(el) {
    const text = norm(el.innerText || el.textContent);
    if (!text || text.length > 40 || text.includes(")")) return null;
    const smallest = smallestContaining(text);
    // The element `:text()` would actually resolve to: `el` if it's the smallest
    // text holder, else a smallest holder inside it (clicking it hits the same
    // control). Reject unrelated/ancestor holders.
    const holder = smallest.includes(el)
      ? el
      : smallest.find((h) => el.contains(h));
    if (!holder) return null;
    // `tag:text(text)` matches the smallest text holders sharing that tag.
    const matches = smallest.filter((h) => h.tagName === holder.tagName);
    return { cand: `${tagOf(holder)}:text(${text})`, matches, holder };
  }

  // Skip ids that look framework-generated (React useId, counters, hashes) —
  // they change between runs and make brittle selectors.
  function stableId(id) {
    if (!id) return false;
    if (id.includes(":")) return false; // `:r1:`, Angular, …
    if (/\d{4,}/.test(id)) return false; // counters / timestamps
    if (/^[0-9a-f]{8,}$/i.test(id)) return false; // hashes / uuids
    return true;
  }

  function idSelector(el) {
    if (!stableId(el.id)) return null;
    const sel = `#${CSS.escape(el.id)}`;
    return document.querySelectorAll(sel).length === 1 ? sel : null;
  }

  // Intentional test hooks — the most stable identifiers when present.
  const TEST_ATTRS = [
    "data-testid",
    "data-test",
    "data-test-id",
    "data-cy",
    "data-qa",
  ];
  // Accessible name: stable and readable. Only `aria-label` of the aria-* family
  // — the rest is runtime state (aria-expanded/-checked) or id references
  // (aria-labelledby/-controls), which make brittle selectors.
  const LABEL_ATTRS = ["aria-label", "alt"];
  // Other common identifying attributes, best first.
  const NAMED_ATTRS = ["name", "title", "placeholder", "role", "type"];

  const cleanValue = (v) => !!v && v.length <= 40 && !v.includes("'");
  // Reject volatile numeric ids (counters/timestamps) for non-hook attributes.
  const stableValue = (v) => cleanValue(v) && !/\d{4,}/.test(v);

  // Best [attribute, value] to identify `el`: test hooks → accessible name →
  // any other data-* (app-defined semantics) → common attributes.
  function attrPair(el) {
    for (const a of TEST_ATTRS) {
      const v = el.getAttribute(a);
      if (cleanValue(v)) return [a, v];
    }
    for (const a of LABEL_ATTRS) {
      const v = el.getAttribute(a);
      if (stableValue(v)) return [a, v];
    }
    for (const at of el.attributes) {
      if (at.name.startsWith("data-") && stableValue(at.value))
        return [at.name, at.value];
    }
    for (const a of NAMED_ATTRS) {
      const v = el.getAttribute(a);
      if (stableValue(v)) return [a, v];
    }
    return null;
  }

  // A `tag[attr='val']` candidate for `el` plus the elements it matches, or null.
  function attrCandidate(el) {
    const p = attrPair(el);
    if (!p) return null;
    const cand = `${tagOf(el)}[${p[0]}='${p[1]}']`;
    return { cand, matches: [...document.querySelectorAll(cand)] };
  }

  // One CSS-path segment for `el`, disambiguated among same-tag siblings —
  // preferring a distinguishing attribute, then `:nth-of-type`.
  function segment(el) {
    const tag = tagOf(el);
    const parent = el.parentElement;
    if (!parent) return tag;
    const p = attrPair(el);
    if (p) {
      const cand = `${tag}[${p[0]}='${p[1]}']`;
      if ([...parent.children].filter((c) => c.matches(cand)).length === 1)
        return cand;
    }
    const sameTag = [...parent.children].filter((c) => c.tagName === el.tagName);
    return sameTag.length > 1
      ? `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`
      : tag;
  }

  // Minimal child-combinator path, anchored on the nearest stable id, each
  // segment disambiguated by attribute or nth-of-type. Stops once unique.
  function cssPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
      const anchor = idSelector(cur);
      if (anchor) {
        parts.unshift(anchor);
        break;
      }
      parts.unshift(segment(cur));
      if (document.querySelectorAll(parts.join(" > ")).length === 1) break;
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  // Priority: unique :text() → #id → unique [attr] → :nth() on the best short
  // candidate (text, then attr) → CSS path. A short readable selector with a
  // small `:nth(K)` beats a long positional chain.
  function uniqueSelector(el) {
    try {
      const t = textCandidate(el);
      const textSel = t && indexedSelector(t.cand, t.matches, t.holder);
      if (textSel && !textSel.includes(":nth(")) return textSel; // unique text
      const id = idSelector(el);
      if (id) return id;
      const a = attrCandidate(el);
      const attrSel = a && indexedSelector(a.cand, a.matches, el);
      if (attrSel) return attrSel; // unique attr, or attr:nth(K)
      if (textSel) return textSel; // text:nth(K)
      return cssPath(el);
    } catch {
      return cssPath(el);
    }
  }

  // ─── overlay UI (shadow-isolated from page styles) ──────────────────────────

  const host = document.createElement("div");
  host.dataset.recordablePicker = ""; // marker so we never select our own UI
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      .box { position: fixed; pointer-events: none; box-sizing: border-box;
             border: 2px solid #0a7d5a; background: rgba(10,125,90,.12);
             border-radius: 2px; transition: all .04s ease-out; display: none; }
      .tip { position: fixed; pointer-events: none; max-width: 60vw;
             font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
             background: #16181d; color: #e8e8e8; padding: 3px 6px;
             border-radius: 4px; white-space: nowrap; overflow: hidden;
             text-overflow: ellipsis; box-shadow: 0 1px 4px rgba(0,0,0,.4);
             display: none; }
      .tip.good { color: #4ade80; }
      .bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
             font: 12px/1 ui-sans-serif, system-ui, sans-serif; color: #fff;
             background: #16181d; padding: 7px 12px; border-radius: 999px;
             box-shadow: 0 2px 8px rgba(0,0,0,.4); white-space: nowrap;
             display: none; }
      .bar.copied { background: #0a7d5a; }
    </style>
    <div class="box"></div>
    <div class="tip"></div>
    <div class="bar"></div>`;

  const box = root.querySelector(".box");
  const tip = root.querySelector(".tip");
  const bar = root.querySelector(".bar");

  // Crosshair cursor while armed, applied via a toggled <style> so we don't
  // clobber the page's own inline cursor styles.
  const cursorStyle = document.createElement("style");
  cursorStyle.textContent = "* { cursor: crosshair !important; }";

  const isOurs = (el) =>
    el === host || (el.closest && el.closest("[data-recordable-picker]"));

  function drawBox(el) {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: "block",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
    const sel = uniqueSelector(el);
    tip.textContent = sel;
    tip.classList.toggle(
      "good",
      sel.includes(":text(") || sel.startsWith("#") || sel.includes("["),
    );
    tip.style.display = "block";
    // Place the tip just above the box, or below if there's no room.
    const top = r.top > 22 ? r.top - 20 : r.bottom + 4;
    Object.assign(tip.style, {
      left: `${Math.max(2, r.left)}px`,
      top: `${top}px`,
    });
  }

  // ─── arming / picking ───────────────────────────────────────────────────────

  let armed = false;
  let current = null;

  // The element we'd actually target: the clickable ancestor, unless Alt is held.
  const pick = (e) => (e.altKey ? e.target : clickableTarget(e.target));

  function onMove(e) {
    if (isOurs(e.target)) return;
    const el = pick(e);
    if (!el || el === current) return;
    current = el;
    drawBox(el);
  }

  function onClick(e) {
    if (isOurs(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const sel = uniqueSelector(pick(e));
    copy(sel);
    bar.textContent = `copied  ${sel}`;
    bar.classList.add("copied");
  }

  function onKey(e) {
    if (e.key === "Escape" && armed) {
      setState(false);
      chrome.runtime.sendMessage({ type: "recordable-picker-off" }).catch(() => {});
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* clipboard blocked (e.g. cross-origin frame) — the tip still shows it */
      }
      ta.remove();
    }
  }

  function setState(on) {
    if (on === armed) return; // idempotent: background may broadcast repeatedly
    armed = on;
    const m = on ? "addEventListener" : "removeEventListener";
    document[m]("mousemove", onMove, true);
    document[m]("click", onClick, true);
    document[m]("keydown", onKey, true);
    if (on) {
      document.documentElement.appendChild(host);
      document.documentElement.appendChild(cursorStyle);
      bar.textContent =
        "Recordable: click an element · Alt = exact · Esc to stop";
      bar.classList.remove("copied");
      bar.style.display = "block";
    } else {
      current = null;
      box.style.display = "none";
      tip.style.display = "none";
      bar.style.display = "none";
      cursorStyle.remove();
      host.remove();
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "recordable-picker-set") setState(msg.armed);
  });
})();
