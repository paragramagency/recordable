# Recordable Selector Picker

A tiny Chrome (MV3) dev tool for authoring recordable scripts: click any element
on a page and it copies a **unique target selector** to your clipboard, in
recordable's own grammar.

## What it emits

It first promotes the clicked node to its nearest enclosing **control** (so an
icon `<svg>` becomes the `<a>`/`<button>` you meant) — hold **Alt** while
clicking to pick the exact element instead.

Then it picks the shortest, most readable selector that still resolves uniquely,
preferring (in order):

1. **`tag:text(…)`** — recordable's text pseudo. Only used when the text resolves
   to exactly one element (matched the way recordable does: substring on the
   _smallest_ element containing it). If it isn't unique, it's skipped.
2. **`#id`** — when the id is present, unique, and not framework-generated
   (ids with `:`, long digit runs, or hash/uuid shapes are skipped as volatile).
3. **`tag[attr='…']`** — a distinguishing attribute, e.g. `a[title='LinkedIn']`.
   Used when it resolves uniquely, preferring (in order): test hooks
   (`data-testid`/`-test`/`-test-id`/`-cy`/`-qa`) → accessible name (`aria-label`,
   `alt`) → any other `data-*` → `name`, `title`, `placeholder`, `role`, `type`.
   (Only `aria-label` of the aria-\* family — the rest is runtime state or id
   references. Values that look like volatile numeric ids are skipped.)
4. **`…:nth(K)`** — when the best short selector (`:text()` or `[attr]`) matches a
   few elements rather than one, it appends recordable's `:nth(K)` (1-based,
   counted among _visible_ matches) — e.g. `a:text(Submit):nth(2)` — in
   preference to a long positional chain.
5. **CSS path** — a minimal `>` child-combinator path; each step disambiguated by
   a distinguishing attribute or `:nth-of-type`, anchored on the nearest stable
   id. Last resort.

These drop straight into a recordable `click` / `waitFor` target (see
`src/browser/targets.ts`).

**Iframes:** the picker runs in every frame, so you can pick elements inside an
`<iframe>`. The selector only needs to be unique *within that frame* — which is
exactly how recordable's `getHandle` resolves a target (it races the selector
across all frames). No frame path is needed.

## Use

1. Load it (see below).
2. Click the toolbar button to arm it — the badge shows `ON` and the cursor
   becomes a crosshair.
3. Hover to highlight; the live selector shows above the element (green = a
   preferred `:text()`/`#id` match).
4. Click to copy. A pill confirms what was copied.
5. Press **Esc** or click the toolbar button again to stop.

## Load it

**Prebuilt zip** — drag `extensions/selector-picker.zip` onto
`chrome://extensions` (Developer mode on).

**Unpacked (for hacking on it)** — `chrome://extensions` → _Load unpacked_ →
select this `selector-picker/` folder.

**Rebuild the zip** after editing the source:

```sh
npm run build:extension
```
