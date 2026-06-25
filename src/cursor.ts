import { type Page } from "puppeteer";
import { sleep } from "./utils.js";

const CURSOR_ID = "__sr_cursor__";

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
  private pos = { x: 0, y: 0 };

  /** Draw the cursor SVG and hide the native pointer. Idempotent per document. */
  async inject(page: Page): Promise<void> {
    await page.evaluate((id) => {
      // Skip if already injected or running inside an iframe
      if (document.getElementById(id) || window !== window.parent) return;

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
          transform: var(--sr-pos) scale(0.88) !important;
          transition: transform 0.08s !important;
        }
      `;
      document.head.appendChild(style);

      const cursor = document.createElement("div");
      cursor.id = id;
      cursor.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <path d="M4 2 L4 19 L8.5 14.5 L12 22 L14 21 L10.5 13.5 L17 13.5 Z"
              fill="white" stroke="#1e1b4b" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>`;
      document.body.appendChild(cursor);
    }, CURSOR_ID);
    this.pos = { x: 0, y: 0 };
  }

  /** Ease the overlay (and the real mouse) to viewport coords `toX,toY`. */
  async moveTo(
    page: Page,
    toX: number,
    toY: number,
    zoom: ZoomState,
  ): Promise<void> {
    const dx = toX - this.pos.x;
    const dy = toY - this.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const dur = Math.min(700, Math.max(150, dist * 0.5));

    // When documentElement has a CSS transform, position:fixed children are
    // positioned relative to that ancestor (not the viewport), so they scroll
    // with the page. Convert viewport coords → document coords first, then
    // apply the inverse zoom transform.
    const { tx, ty, s } = zoom;
    const hasTransform = s !== 1 || tx !== 0 || ty !== 0;
    const scroll = hasTransform
      ? await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))
      : { x: 0, y: 0 };
    const cx = (toX + scroll.x - tx) / s;
    const cy = (toY + scroll.y - ty) / s;

    await page.evaluate(
      ({ id, cx, cy, dur }) =>
        new Promise<void>((resolve) => {
          const cursor = document.getElementById(id);
          if (!cursor) {
            resolve();
            return;
          }
          cursor.style.transition = `transform ${dur}ms cubic-bezier(0.4,0,0.2,1)`;
          cursor.style.setProperty("--sr-pos", `translate(${cx}px, ${cy}px)`);
          cursor.style.transform = `translate(${cx}px, ${cy}px)`;
          setTimeout(resolve, dur);
        }),
      { id: CURSOR_ID, cx, cy, dur },
    );

    await page.mouse.move(toX, toY);
    this.pos = { x: toX, y: toY };
  }

  /** Briefly scale the cursor down to signal a press. */
  async clickEffect(page: Page): Promise<void> {
    await page.evaluate((id) => {
      const cursor = document.getElementById(id);
      if (!cursor) return;
      cursor.classList.add("pressing");
      void cursor.offsetWidth;
    }, CURSOR_ID);
    await sleep(120);
    await page.evaluate((id) => {
      document.getElementById(id)?.classList.remove("pressing");
    }, CURSOR_ID);
    await sleep(60);
  }
}
