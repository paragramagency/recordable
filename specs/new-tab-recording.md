# Spec: New-tab recording (`followNewTab`)

ROADMAP #5. A click that opens a link in a **new tab** continues recording in that tab,
stitched seamlessly into the same output. Today capture is bound to one page.

## Decisions

- **Explicit opt-in on `click`** — not a separate action and not implicit. A click only
  follows a new tab when asked: `click(target, { followNewTab: true })`.
- **Leave the old tab open.** No close; the new tab simply becomes the active page for
  subsequent actions.
- **The new tab gets full setup** — viewport, the `framenavigated` cursor/zoom re-inject
  listener, and cursor injection — same as the original page.
- **Tab switch = segment boundary.** No cross-session frame muxing: seal the current
  segment on the old tab, start a fresh segment on the new tab. The existing
  `src/video/stitch.ts` joins them.
- **Trim the loading time by default.** Capture stops at the click and only restarts once
  the new tab has loaded, so the dead loading stretch is not recorded.

### Why it's not a deep rewrite

Capture already runs in **segments** that are stitched, and CDP screencast is per-target
anyway — so a new tab is just the next segment. The work is plumbing, not a new capture
pipeline.

## Behaviour

`click(target, { followNewTab: true })`:

1. Performs the normal on-camera click (cursor move + click effect) on the **current**
   tab — the viewer sees the link being clicked.
2. Detects the new tab the click opens (`target="_blank"` / `window.open`).
3. **Seals the current segment at the click** — the dead loading stretch is **not**
   recorded (loading time trimmed by default).
4. Makes the new tab active: sets its viewport, attaches the cursor/zoom re-inject
   listener, brings it to front, waits for it to finish loading (off-camera), and
   injects the cursor overlay.
5. Recording resumes automatically: the next action opens a fresh segment on the new
   tab. The existing stitcher joins the two segments.
6. The **old tab is left open** (not closed). All subsequent actions target the new tab.

If no new tab appears within the navigation timeout, log a warning and continue as a
normal click (no swap) — never hang the run.

### Trimming / navigation duration

Loading time is trimmed because capture stops at the click and only restarts once the new
tab has loaded. The load wait is best-effort and bounded by the existing `visitTimeout`
config (`waitForNavigation{load}` then `waitForNetworkIdle`, both `.catch()`ed) — so a
slow new tab gets time to commit, and a perpetually-busy one can't stall the run.

## API

`ClickOptions` (`src/config.ts`) gains:

```ts
/** Follow a link that opens in a new tab: continue recording in the new tab,
 *  trimming the load. The old tab stays open. Default: false. */
followNewTab?: boolean;
```

JSON / Markdown get it for free — the `click` action schema in `src/actions.ts` is the
single source of truth and an optional boolean lands in the trailing options bag:

```json
{ "action": "click", "target": "text:Open report", "followNewTab": true }
```

```
click(`text:Open report`, { followNewTab: true })
```

## Implementation

| File                        | Change                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`             | Add `followNewTab?: boolean` to `ClickOptions` (doc’d).                                                                                                                                                                                                                                                                                                                                         |
| `src/actions.ts`            | Add `followNewTab: z.boolean().optional()` to the `click` schema.                                                                                                                                                                                                                                                                                                                               |
| `src/browser/runtime.ts`    | `click()` returns `Promise<Page \| void>`. When `followNewTab`, arm `page.once("popup")` **before** the click, do the visual click (no `waitForNav`), then race the popup against `visitTimeout`; return the new `Page` (or warn + return void). The runtime does **not** touch the recorder — it only discovers the tab.                                                                       |
| `src/compose/recordable.ts` | `_enqueue` run type → `(page: Page) => Promise<Page \| void>`; `click()` returns the runtime result so the new page propagates to the session.                                                                                                                                                                                                                                                  |
| `src/compose/session.ts`    | `QueueItem.run` returns `Promise<Page \| void>`. Loop uses a mutable `page`; extract `_setupPage(page)` (viewport + `framenavigated` re-inject) used for both the first page and new tabs. After `item.run`, if it returns a `Page`, call `_switchTab`: `recorder.end()` (seal segment A) → `_setupPage(newPage)` → `bringToFront` → bounded load wait → `injectCursor` → rebind active `page`. |
| `src/video/recorder.ts`     | `_ensureCdp` tracks the page its `CDPSession` belongs to; when `begin()` is called with a different page, detach the old session and create a fresh one on the new target. Reset on `dispose`.                                                                                                                                                                                                  |

### Why the recorder change is required

`_ensureCdp` currently caches one `CDPSession` for the recorder's lifetime. After a tab
switch, `begin(newPage)` would reuse the session bound to the **old** target and capture
the wrong tab. Re-creating the session when the page changes fixes this; it's transparent
to the single-tab path (same page → cached session).

### Boundary preserved

The runtime stays free of recorder/recording concerns (its documented contract): it
discovers the new tab and hands the `Page` back. The session owns segment orchestration
and the active-page swap — mirroring how pause/resume already drive `recorder.end/begin`.

## Tests

- **Unit** — `recorder` re-creates its CDP session when `begin()` receives a new page;
  `click` schema accepts `followNewTab` and rejects a non-boolean. Manifest: `followNewTab`
  lands in the options bag for JSON + Markdown (`callToAction` / `buildArgs`).
- **E2E (opt-in)** — a fixture page with a `target="_blank"` link: clicking with
  `followNewTab` produces a single MP4 whose tail shows the new tab, with no loading gap.

## Out of scope

- Switching to a pre-existing tab by index, or closing the old tab.
- Recording the load (a `keepLoading` opt-out) — deferred; trim is the only mode for now.
