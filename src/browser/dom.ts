import { type ElementHandle, type Page } from "puppeteer";
import { isPositionValue, resolveTarget } from "../targets.js";

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
    throw new Error(`Could not find target: "${target}"`);
  }
}

/** Centre coords of a target element, jittered up to 20% of each dimension. */
export async function getElementCenter(
  page: Page,
  target: string,
): Promise<Point> {
  const handle = await getHandle(page, target);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`No bounding box for "${target}"`);
  const offset = (range: number) => (Math.random() - 0.5) * range * 0.4;
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
 * Animate a scroller's vertical position to `targetTop` over `duration` ms with an
 * ease curve. `container` null scrolls the window; a handle scrolls that element's
 * `scrollTop`. The target is clamped to the scroller's range.
 */
export async function smoothScroll(
  page: Page,
  targetTop: number,
  duration: number,
  container: ElementHandle<Element> | null = null,
): Promise<void> {
  await page.evaluate(
    (el, { targetTop, duration }) => {
      return new Promise<void>((resolve) => {
        const max = el
          ? el.scrollHeight - el.clientHeight
          : document.documentElement.scrollHeight - window.innerHeight;
        const end = Math.max(0, Math.min(targetTop, max));
        const startY = el ? el.scrollTop : window.scrollY;
        const dist = end - startY;
        const frames = Math.ceil(duration / 16);
        let i = 0;
        const id = setInterval(() => {
          i++;
          const p = Math.min(i / frames, 1);
          const e =
            p < 0.5 ? 4 * p * p * p : (p - 1) * (2 * p - 2) * (2 * p - 2) + 1;
          const y = startY + dist * e;
          if (el) el.scrollTop = y;
          else window.scrollTo(0, y);
          if (p >= 1) {
            clearInterval(id);
            resolve();
          }
        }, 16);
      });
    },
    container,
    { targetTop, duration },
  );
}

/**
 * Smooth-scroll to an element or position. Without `container` the window scrolls;
 * with one, `target` is resolved against that scroll container instead:
 * - `"top"` / `"bottom"` → scroller extremes
 * - number → absolute scrollTop (px)
 * - CSS selector or `text:` prefix → element centred within the scroller
 */
export async function smoothScrollToTarget(
  page: Page,
  target: string | number,
  duration: number,
  container?: string,
): Promise<void> {
  const scroller = container ? await getHandle(page, container) : null;

  if (typeof target === "number")
    return smoothScroll(page, target, duration, scroller);
  if (target === "top") return smoothScroll(page, 0, duration, scroller);
  if (target === "bottom") {
    const bottom = await page.evaluate(
      (el) => (el ? el.scrollHeight : document.body.scrollHeight),
      scroller,
    );
    return smoothScroll(page, bottom, duration, scroller);
  }

  const handle = await getHandle(page, target);
  const top = await page.evaluate(
    (el, scrollEl, vh) => {
      const rect = el.getBoundingClientRect();
      if (scrollEl) {
        // Centre the child within the container's visible area.
        const box = scrollEl.getBoundingClientRect();
        return (
          scrollEl.scrollTop +
          (rect.top - box.top) +
          rect.height / 2 -
          scrollEl.clientHeight / 2
        );
      }
      return window.scrollY + rect.top + rect.height / 2 - vh / 2;
    },
    handle,
    scroller,
    page.viewport()?.height ?? 900,
  );
  return smoothScroll(page, top, duration, scroller);
}

/**
 * Scroll `target` into view if it lies outside the visible viewport (keeping
 * `margin` px clear on each side). No-op when the element is already fully
 * visible. `speed` (px/s) sets the scroll duration.
 */
export async function scrollIntoView(
  page: Page,
  target: string,
  margin: number,
  speed: number,
): Promise<void> {
  const handle = await getHandle(page, target);
  const scrollY = await page.evaluate(
    (el, margin) => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const comfort = margin * 2;
      if (rect.top >= comfort && rect.bottom <= vh - comfort) return null;

      // Tall element: top-align with margin
      if (rect.height > vh - margin * 2)
        return window.scrollY + rect.top - margin;

      // Element extends below the bottom comfort zone: scroll just enough to
      // show it fully, rather than trying to centre it (which often overshoots
      // the page's max scroll and leaves the element at the viewport edge).
      if (rect.bottom > vh - margin)
        return window.scrollY + rect.bottom - (vh - margin);

      // Element extends above the top comfort zone: scroll to show top
      if (rect.top < margin) return window.scrollY + rect.top - margin;

      // In view but within the comfort band: centre it
      return window.scrollY + rect.top + rect.height / 2 - vh / 2;
    },
    handle,
    margin,
  );
  if (scrollY === null) return;
  const currentY = await page.evaluate(() => window.scrollY);
  const dist = Math.abs(scrollY - currentY);
  const duration = Math.max(200, (dist / speed) * 1000);
  await smoothScroll(page, scrollY, duration);
}
