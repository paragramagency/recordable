import { type ElementHandle, type Page } from "puppeteer";
import { isPositionValue, resolveTarget } from "./targets.js";
import { RecordableError } from "../errors.js";

/** Jitter spread as a fraction of an element's dimension (±20% of each side). */
const JITTER_FRACTION = 0.4;
/** Frame interval in ms (≈ one 60fps frame). */
const FRAME_MS = 16;
/** Default viewport height (px) when the page has no viewport set. */
const DEFAULT_VIEWPORT_HEIGHT = 900;
/** Default viewport width (px) when the page has no viewport set. */
const DEFAULT_VIEWPORT_WIDTH = 1440;

/** Coordinates in viewport pixels. */
export interface Point {
  x: number;
  y: number;
}

/** Resolve a target and wait for the element to be *visible* in any frame, then
 *  return its handle.
 *
 *  Two reasons this is more than a bare `page.locator(...).waitHandle()`:
 *  - Visibility (not mere existence): callers immediately read `boundingBox()`
 *    to click/scroll, but Puppeteer's default locator resolves the instant the
 *    node enters the DOM (`waitForSelector(..., {visible:false})`) — so an
 *    element inserted-but-not-yet-laid-out yields a null box. `setVisibility`
 *    makes it wait for a real layout box.
 *  - Frames: modal dialogs (e.g. APEX `apex.navigation.dialog`) render their
 *    content in an `<iframe>`. The top frame can hold a hidden placeholder with
 *    the same id, so we race every frame and take the first *visible* match.
 *    An iframe element's `boundingBox()` is reported in main-frame coordinates,
 *    so the coordinate-based click still lands correctly. */
export async function getHandle(page: Page, target: string) {
  const selector = resolveTarget(target);
  try {
    return await Promise.any(
      page
        .frames()
        .map((f) => f.locator(selector).setVisibility("visible").waitHandle()),
    );
  } catch {
    throw new RecordableError(
      "TARGET_NOT_FOUND",
      `Could not find target: "${target}"`,
    );
  }
}

/** Centre coords of a target element, jittered up to 20% of each dimension. */
export async function getElementCenter(
  page: Page,
  target: string,
): Promise<Point> {
  const handle = await getHandle(page, target);
  const box = await handle.boundingBox();
  if (!box)
    throw new RecordableError(
      "TARGET_NOT_FOUND",
      `No bounding box for "${target}"`,
    );
  const offset = (range: number) =>
    (Math.random() - 0.5) * range * JITTER_FRACTION;
  return {
    x: box.x + box.width / 2 + offset(box.width),
    y: box.y + box.height / 2 + offset(box.height),
  };
}

/**
 * Resolve an origin string to viewport pixel coordinates.
 * Accepts CSS position keywords/percentages or an element selector.
 */
export async function originToCoords(
  page: Page,
  origin: string,
): Promise<Point> {
  if (!isPositionValue(origin)) return getElementCenter(page, origin);
  return page.evaluate((origin) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tokens = origin.trim().toLowerCase().split(/\s+/);
    const kw: Record<string, number> = {
      left: 0,
      top: 0,
      center: 50,
      right: 100,
      bottom: 100,
    };
    if (tokens.length === 1) {
      const [t] = tokens;
      const p = t in kw ? kw[t] : parseFloat(t);
      if (t === "top" || t === "bottom")
        return { x: vw / 2, y: (vh * p) / 100 };
      if (t === "left" || t === "right")
        return { x: (vw * p) / 100, y: vh / 2 };
      return { x: (vw * p) / 100, y: (vh * p) / 100 };
    }
    const yAxis = ["top", "bottom"];
    const [a, b] = yAxis.includes(tokens[0]) ? [tokens[1], tokens[0]] : tokens;
    const px = a in kw ? kw[a] : parseFloat(a);
    const py = b in kw ? kw[b] : parseFloat(b);
    return { x: (vw * px) / 100, y: (vh * py) / 100 };
  }, origin);
}

/**
 * Animate a scroller's position to `targetPos` over `duration` ms with an ease
 * curve, along `axis` (`"y"` = `scrollTop`/vertical, `"x"` = `scrollLeft`/
 * horizontal). `container` null scrolls the window; a handle scrolls that element.
 * The target is clamped to the scroller's range on that axis.
 */
export async function smoothScroll(
  page: Page,
  targetPos: number,
  duration: number,
  container: ElementHandle<Element> | null = null,
  axis: "x" | "y" = "y",
): Promise<void> {
  await page.evaluate(
    // frameMs is passed in: a module-level const isn't visible inside this
    // browser-context closure.
    (el, { targetPos, duration, frameMs, horiz }) => {
      return new Promise<void>((resolve) => {
        const max = el
          ? horiz
            ? el.scrollWidth - el.clientWidth
            : el.scrollHeight - el.clientHeight
          : horiz
            ? document.documentElement.scrollWidth - window.innerWidth
            : document.documentElement.scrollHeight - window.innerHeight;
        const end = Math.max(0, Math.min(targetPos, max));
        const start = el
          ? horiz
            ? el.scrollLeft
            : el.scrollTop
          : horiz
            ? window.scrollX
            : window.scrollY;
        const dist = end - start;
        const frames = Math.ceil(duration / frameMs);
        let i = 0;
        const id = setInterval(() => {
          i++;
          const p = Math.min(i / frames, 1);
          const e =
            p < 0.5 ? 4 * p * p * p : (p - 1) * (2 * p - 2) * (2 * p - 2) + 1;
          const pos = start + dist * e;
          if (el) {
            if (horiz) el.scrollLeft = pos;
            else el.scrollTop = pos;
          } else if (horiz) window.scrollTo(pos, window.scrollY);
          else window.scrollTo(window.scrollX, pos);
          if (p >= 1) {
            clearInterval(id);
            resolve();
          }
        }, frameMs);
      });
    },
    container,
    { targetPos, duration, frameMs: FRAME_MS, horiz: axis === "x" },
  );
}

/**
 * Smooth-scroll to an element or position. Without `container` the window scrolls;
 * with one, `target` is resolved against that scroll container instead:
 * - `"top"`/`"bottom"` (y) or `"left"`/`"right"` (x) → scroller extremes
 * - number → absolute scroll offset (px) along `axis`
 * - CSS selector or `text:` prefix → element centred within the scroller on `axis`
 *
 * Directional keywords pin the axis (`"left"`/`"right"` → x, `"top"`/`"bottom"` →
 * y); a number or selector takes the `axis` argument (default `"y"`).
 */
export async function smoothScrollToTarget(
  page: Page,
  target: string | number,
  duration: number,
  container?: string,
  axis: "x" | "y" = "y",
): Promise<void> {
  const ax: "x" | "y" =
    target === "left" || target === "right"
      ? "x"
      : target === "top" || target === "bottom"
        ? "y"
        : axis;
  const horiz = ax === "x";
  const scroller = container ? await getHandle(page, container) : null;

  if (typeof target === "number")
    return smoothScroll(page, target, duration, scroller, ax);
  if (target === "top" || target === "left")
    return smoothScroll(page, 0, duration, scroller, ax);
  if (target === "bottom" || target === "right") {
    const end = await page.evaluate(
      (el, h) =>
        el
          ? h
            ? el.scrollWidth
            : el.scrollHeight
          : h
            ? document.body.scrollWidth
            : document.body.scrollHeight,
      scroller,
      horiz,
    );
    return smoothScroll(page, end, duration, scroller, ax);
  }

  const handle = await getHandle(page, target);
  const pos = await page.evaluate(
    (el, scrollEl, viewport, h) => {
      const rect = el.getBoundingClientRect();
      if (scrollEl) {
        // Centre the child within the container's visible area, on this axis.
        const box = scrollEl.getBoundingClientRect();
        return h
          ? scrollEl.scrollLeft +
              (rect.left - box.left) +
              rect.width / 2 -
              scrollEl.clientWidth / 2
          : scrollEl.scrollTop +
              (rect.top - box.top) +
              rect.height / 2 -
              scrollEl.clientHeight / 2;
      }
      return h
        ? window.scrollX + rect.left + rect.width / 2 - viewport / 2
        : window.scrollY + rect.top + rect.height / 2 - viewport / 2;
    },
    handle,
    scroller,
    horiz
      ? (page.viewport()?.width ?? DEFAULT_VIEWPORT_WIDTH)
      : (page.viewport()?.height ?? DEFAULT_VIEWPORT_HEIGHT),
    horiz,
  );
  return smoothScroll(page, pos, duration, scroller, ax);
}

/** One scroller's reading of where the target sits, all in its own axis:
 *  `relTop` = element top relative to the scroller's visible area. */
interface ScrollMetrics {
  relTop: number;
  height: number;
  vh: number;
  scrollTop: number;
}

/** The scrollTop that brings the element comfortably into the scroller's view, or
 *  null when it's already comfortably visible. Pure geometry, shared by the window
 *  and container passes so both reveal an element the same way. */
function comfortTarget(m: ScrollMetrics, margin: number): number | null {
  const { relTop, height, vh, scrollTop } = m;
  const relBottom = relTop + height;
  const comfort = margin * 2;
  if (relTop >= comfort && relBottom <= vh - comfort) return null;
  // Tall element: top-align with margin.
  if (height > vh - margin * 2) return scrollTop + relTop - margin;
  // Below the bottom comfort zone: scroll just enough to show it fully (centring
  // would often overshoot the scroller's max and leave it pinned to the edge).
  if (relBottom > vh - margin) return scrollTop + relBottom - (vh - margin);
  // Above the top comfort zone: scroll to show the top.
  if (relTop < margin) return scrollTop + relTop - margin;
  // Within the comfort band but not comfortable: centre it.
  return scrollTop + relTop + height / 2 - vh / 2;
}

/** Read the target's position within `container` (an element scroller) or, when
 *  null, within the window. */
function readMetrics(
  page: Page,
  handle: ElementHandle<Element>,
  container: ElementHandle<Element> | null,
): Promise<ScrollMetrics> {
  return page.evaluate(
    (el, c) => {
      const r = el.getBoundingClientRect();
      if (c) {
        const b = c.getBoundingClientRect();
        return {
          relTop: r.top - b.top,
          height: r.height,
          vh: c.clientHeight,
          scrollTop: c.scrollTop,
        };
      }
      return {
        relTop: r.top,
        height: r.height,
        vh: window.innerHeight,
        scrollTop: window.scrollY,
      };
    },
    handle,
    container,
  );
}

/** The nearest ancestor that actually scrolls vertically (overflow auto/scroll +
 *  overflowing content), or null if none short of the document — in which case the
 *  window is the scroller. */
async function nearestScrollableAncestor(
  handle: ElementHandle<Element>,
): Promise<ElementHandle<Element> | null> {
  const h = await handle.evaluateHandle((el) => {
    let p = el.parentElement;
    while (p && p !== document.body && p !== document.documentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (
        (oy === "auto" || oy === "scroll" || oy === "overlay") &&
        p.scrollHeight > p.clientHeight
      )
        return p;
      p = p.parentElement;
    }
    return null;
  });
  const el = h.asElement() as ElementHandle<Element> | null;
  if (!el) await h.dispose();
  return el;
}

/**
 * Scroll `target` into view if it lies outside the visible area (keeping `margin`
 * px clear on each side). No-op when already comfortably visible. `speed` (px/s)
 * sets the scroll duration. Scrolls the target's nearest scrollable container
 * first (so it's revealed inside a modal / sidebar / pane), then the window so the
 * container itself is on screen.
 */
export async function scrollIntoView(
  page: Page,
  target: string,
  margin: number,
  speed: number,
): Promise<void> {
  const handle = await getHandle(page, target);
  const container = await nearestScrollableAncestor(handle);

  const reveal = async (scroller: ElementHandle<Element> | null) => {
    const metrics = await readMetrics(page, handle, scroller);
    const top = comfortTarget(metrics, margin);
    if (top === null) return;
    const dist = Math.abs(top - metrics.scrollTop);
    const duration = Math.max(200, (dist / speed) * 1000);
    await smoothScroll(page, top, duration, scroller);
  };

  if (container) await reveal(container);
  await reveal(null);

  await container?.dispose();
}
