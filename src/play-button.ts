export const PLAY_BUTTON_ID = "__recordable_play__";
export const PLAY_BINDING = "__recordablePlay__";

/**
 * Injected into the page to render the in-page ▶ Play button. Runs in the
 * browser context, so it must be fully self-contained (no outer references).
 */
export function injectPlayButton(
  message: string,
  id: string,
  binding: string,
): void {
  // Skip iframes — only the top document gets the button.
  if (window !== window.parent) return;
  const build = () => {
    if (document.getElementById(id)) return;
    const wrap = document.createElement("div");
    wrap.id = id;
    wrap.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:32px",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "pointer-events:auto",
      "display:flex",
      "align-items:center",
      "gap:12px",
      "padding:10px 18px 10px 12px",
      "background:rgba(20,18,40,0.92)",
      "color:#fff",
      "border-radius:999px",
      "box-shadow:0 8px 28px rgba(0,0,0,0.4)",
      "font-family:system-ui,-apple-system,Segoe UI,sans-serif",
    ].join(";");
    const btn = document.createElement("button");
    btn.style.cssText = [
      "all:unset",
      "cursor:pointer",
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "width:34px",
      "height:34px",
      "border-radius:50%",
      "background:#5b54e8",
      "color:#fff",
      "font-size:13px",
    ].join(";");
    btn.textContent = "▶";
    const label = document.createElement("span");
    label.textContent = message;
    label.style.cssText =
      "font-size:14px;line-height:1;white-space:nowrap;cursor:default";
    wrap.appendChild(btn);
    wrap.appendChild(label);
    const fire = () => {
      wrap.remove();
      const fn = (window as unknown as Record<string, () => void>)[binding];
      if (typeof fn === "function") fn();
    };
    btn.addEventListener("click", fire);
    document.body.appendChild(wrap);
  };
  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
}
