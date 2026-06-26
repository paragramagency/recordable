import { type Page } from "puppeteer";
import { sleep } from "../utils.js";
import { cursorMoveMs, PRESS_DOWN_MS, PRESS_SETTLE_MS } from "../timing.js";

const CURSOR_ID = "__recordable_cursor__";

/** The page's current zoom transform, needed to position the overlay correctly. */
export interface ZoomState {
  tx: number;
  ty: number;
  s: number;
}

/**
 * An animated cursor overlay drawn into the page. Tracks its own position so
 * each move can ease from where it last was, and dips on click for a tactile
 * press effect. Also drives the real Puppeteer mouse so hover/click still fire.
 */
export class Cursor {
  // Persisted across injects so the overlay survives navigation: a fresh page
  // re-injects, and we want the cursor to reappear where it last was (like a
  // real pointer) rather than snapping to the top-left corner.
  private pos = { x: 0, y: 0 };

  /**
   * Draw the cursor SVG and hide the native pointer. Idempotent per document.
   * Renders the overlay at the last-known position (carried across navigations)
   * and syncs the real mouse there so hover state stays consistent.
   */
  async inject(page: Page, zoom: ZoomState = { tx: 0, ty: 0, s: 1 }): Promise<void> {
    // Bail early when there's nothing to do or we can't yet: already present, an
    // iframe, or the new document's <body> hasn't parsed. A too-early call (e.g.
    // from a navigation event) is a no-op; the next moveTo re-injects when ready.
    const skip = await page.evaluate(
      (id) =>
        window !== window.parent ||
        !document.body ||
        !!document.getElementById(id),
      CURSOR_ID,
    );
    if (skip) return;

    const { cx, cy } = await this._toDocCoords(page, this.pos.x, this.pos.y, zoom);
    await page.evaluate(
      ({ id, cx, cy }) => {
        const style = document.createElement("style");
        style.textContent = `
          * { cursor: none !important; }
          #${id} {
            position: fixed;
            top: 0; left: 0;
            margin: -2px 0 0 -4px;
            z-index: 2147483647;
            pointer-events: none;
            will-change: transform;
            transition: transform 0.15s;
            filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));
          }
          #${id}.pressing {
            transform: var(--recordable-pos) scale(0.88) !important;
            transition: transform 0.08s !important;
          }
        `;
        document.head.appendChild(style);

        const cursor = document.createElement("div");
        cursor.id = id;
        // Place at the carried-over position with no transition, so it appears
        // there immediately instead of animating in from the corner.
        cursor.style.transition = "none";
        cursor.style.setProperty("--recordable-pos", `translate(${cx}px, ${cy}px)`);
        cursor.style.transform = `translate(${cx}px, ${cy}px)`;
        cursor.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
          <path d="M4 2 L4 19 L8.5 14.5 L12 22 L14 21 L10.5 13.5 L17 13.5 Z"
                fill="white" stroke="#1e1b4b" stroke-width="1.2" stroke-linejoin="round"/>
        </svg>`;
        document.body.appendChild(cursor);
      },
      { id: CURSOR_ID, cx, cy },
    );
    await page.mouse.move(this.pos.x, this.pos.y);
  }

  /** Ease the overlay (and the real mouse) to viewport coords `toX,toY`. */
  async moveTo(
    page: Page,
    toX: number,
    toY: number,
    zoom: ZoomState,
  ): Promise<void> {
    // Self-heal: a navigation (incl. click-triggered ones with no following
    // visit/waitFor) wipes the overlay. Re-inject at the carried position before
    // animating, so the move is always visible — never an instant, cursor-less jump.
    await this.inject(page, zoom);

    const dx = toX - this.pos.x;
    const dy = toY - this.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dur = cursorMoveMs(dist);

    const { cx, cy } = await this._toDocCoords(page, toX, toY, zoom);

    await page.evaluate(
      ({ id, cx, cy, dur }) =>
        new Promise<void>((resolve) => {
          const cursor = document.getElementById(id);
          if (!cursor) {
            resolve();
            return;
          }
          cursor.style.transition = `transform ${dur}ms cubic-bezier(0.4,0,0.2,1)`;
          cursor.style.setProperty("--recordable-pos", `translate(${cx}px, ${cy}px)`);
          cursor.style.transform = `translate(${cx}px, ${cy}px)`;
          setTimeout(resolve, dur);
        }),
      { id: CURSOR_ID, cx, cy, dur },
    );

    await page.mouse.move(toX, toY);
    this.pos = { x: toX, y: toY };
  }

  /**
   * Convert viewport coords → document coords for the overlay's transform.
   * When documentElement has a CSS transform (zoom), position:fixed children
   * are positioned relative to that ancestor (not the viewport) and scroll with
   * the page, so we add scroll and apply the inverse zoom transform.
   */
  private async _toDocCoords(
    page: Page,
    x: number,
    y: number,
    { tx, ty, s }: ZoomState,
  ): Promise<{ cx: number; cy: number }> {
    const hasTransform = s !== 1 || tx !== 0 || ty !== 0;
    const scroll = hasTransform
      ? await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
      : { x: 0, y: 0 };
    return { cx: (x + scroll.x - tx) / s, cy: (y + scroll.y - ty) / s };
  }

  /** Briefly scale the cursor down to signal a press. */
  async clickEffect(page: Page): Promise<void> {
    await page.evaluate((id) => {
      const cursor = document.getElementById(id);
      if (!cursor) return;
      cursor.classList.add("pressing");
      void cursor.offsetWidth;
    }, CURSOR_ID);
    await sleep(PRESS_DOWN_MS);
    await page.evaluate((id) => {
      document.getElementById(id)?.classList.remove("pressing");
    }, CURSOR_ID);
    await sleep(PRESS_SETTLE_MS);
  }
}
