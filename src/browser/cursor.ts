import { type Page } from "puppeteer";
import { sleep } from "../utils.js";
import {
  cursorMoveMs,
  PRESS_DOWN_MS,
  PRESS_SETTLE_MS,
  PRESS_TRANSITION_MS,
} from "../timing.js";

const CURSOR_ID = "__recordable_cursor__";
const CURSOR_STYLE_ID = "__recordable_cursor_style__";

/** Press-dip scale — presentation only. */
const CURSOR_PRESS_SCALE = 0.88;
/** Base move transition (ms) — presentation only. */
const CURSOR_MOVE_TRANSITION_MS = 150;

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

  // Position snapshotted at pause() so resume() can restore the cursor to exactly
  // where the camera left it — off-camera steps between pause and resume may move
  // `pos`, but the resumed segment should open where the last one ended.
  private parked: { x: number; y: number } | null = null;

  /** Snapshot the current position (called on pause) for a later unpark(). */
  park(): void {
    this.parked = { ...this.pos };
  }

  /** Restore the parked position (if any) and re-inject — called on resume so the
   *  new segment opens with the cursor where the previous one ended. */
  async unpark(page: Page, zoom: ZoomState = { tx: 0, ty: 0, s: 1 }): Promise<void> {
    if (this.parked) {
      this.pos = this.parked;
      this.parked = null;
    }
    await this.inject(page, zoom);
  }

  /**
   * Ensure the cursor overlay exists and sits at the carried position, then sync
   * the real mouse there. Safe to call repeatedly: it creates the overlay if the
   * document doesn't have one (e.g. after a navigation) and otherwise just
   * repositions it — so a resume() can restore the cursor even when the overlay
   * survived the off-camera gap.
   */
  async inject(page: Page, zoom: ZoomState = { tx: 0, ty: 0, s: 1 }): Promise<void> {
    // Can't draw into an iframe or before the document's <body> has parsed. A
    // too-early call (e.g. from a navigation event) is a no-op; the next moveTo
    // re-injects when ready.
    const ready = await page.evaluate(
      () => window === window.parent && !!document.body,
    );
    if (!ready) return;

    const { cx, cy } = await this._toDocCoords(page, this.pos.x, this.pos.y, zoom);
    await page.evaluate(
      ({ id, styleId, cx, cy, moveMs, pressScale, pressMs }) => {
        // Note: we intentionally do NOT hide the native pointer. The screencast
        // doesn't capture the OS cursor, so it never reaches the video; hiding it
        // only blanked the real pointer in the live headful window (incl. during
        // manual wait-for-input steps). Both cursors showing live is harmless.
        if (!document.getElementById(styleId)) {
          const style = document.createElement("style");
          style.id = styleId;
          style.textContent = `
            #${id} {
              position: fixed;
              top: 0; left: 0;
              margin: -2px 0 0 -4px;
              z-index: 2147483647;
              pointer-events: none;
              will-change: transform;
              transition: transform ${moveMs}ms;
              filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));
            }
            #${id}.pressing {
              transform: var(--recordable-pos) scale(${pressScale}) !important;
              transition: transform ${pressMs}ms !important;
            }
          `;
          document.head.appendChild(style);
        }

        let cursor = document.getElementById(id);
        if (!cursor) {
          cursor = document.createElement("div");
          cursor.id = id;
          cursor.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path d="M4 2 L4 19 L8.5 14.5 L12 22 L14 21 L10.5 13.5 L17 13.5 Z"
                  fill="white" stroke="#1e1b4b" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>`;
          document.body.appendChild(cursor);
        }
        // Place at the carried position with no transition, so it appears there
        // immediately instead of animating in from wherever it was.
        cursor.style.transition = "none";
        cursor.style.setProperty("--recordable-pos", `translate(${cx}px, ${cy}px)`);
        cursor.style.transform = `translate(${cx}px, ${cy}px)`;
      },
      {
        id: CURSOR_ID,
        styleId: CURSOR_STYLE_ID,
        cx,
        cy,
        moveMs: CURSOR_MOVE_TRANSITION_MS,
        pressScale: CURSOR_PRESS_SCALE,
        pressMs: PRESS_TRANSITION_MS,
      },
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
   *
   * Note: the `pageZoom` config (genuine browser zoom via chrome.tabs.setZoom)
   * needs no handling here. Page zoom rescales the CSS pixel itself, so the
   * overlay, the content, and Puppeteer's `boundingBox()`/`mouse` coords all share
   * one post-zoom coordinate space — feeding the overlay those raw coords keeps it
   * aligned with the target automatically.
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
