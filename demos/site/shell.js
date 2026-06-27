// Shared chrome for the Dispatch demo site — fills the sidebar + topbar so every
// page stays identical. Pages provide: <aside class="sidebar" id="sidebar">,
// <header class="topbar" id="topbar">, and body data-active / data-search.
(function () {
  const I = {
    logo: `<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="url(#lg)"/><path d="M9 12.5 16 9l7 3.5v7L16 23l-7-3.5z" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12.5 16 16l7-3.5M16 16v7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><defs><linearGradient id="lg" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse"><stop stop-color="#818cf8"/><stop offset="1" stop-color="#4f46e5"/></linearGradient></defs></svg>`,
    package: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
    truck: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>`,
    returns: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>`,
    customers: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    reports: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg>`,
    settings: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
    activity: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`,
    search: `<svg class="icon-sm search-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    plus: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>`,
    help: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>`,
    bell: `<svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  };

  const active = document.body.dataset.active || "";
  const placeholder = document.body.dataset.search || "Search shipments, recipients, tracking…";

  const link = (key, href, label, icon, badge) =>
    `<a href="${href}"${active === key ? ' class="active"' : ""}>${icon}<span>${label}</span>${badge ? `<span class="badge">${badge}</span>` : ""}</a>`;

  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    sidebar.innerHTML = `
      <div class="brand">${I.logo} Dispatch</div>
      <nav class="nav">
        <div class="nav-label">Operations</div>
        ${link("shipments", "index.html", "Shipments", I.package, "6")}
        ${link("tracking", "track.html", "Tracking", I.truck)}
        ${link("returns", "#", "Returns", I.returns)}
        ${link("customers", "#", "Customers", I.customers)}
        <div class="nav-label">Insights</div>
        ${link("activity", "activity.html", "Activity", I.activity)}
        ${link("reports", "reports.html", "Reports", I.reports)}
        ${link("settings", "settings.html", "Settings", I.settings)}
      </nav>
      <div class="side-foot">
        <div class="workspace">
          <div class="ws-badge">NG</div>
          <div>
            <div class="ws-name">Northwind Goods</div>
            <div class="ws-plan">Pro plan</div>
          </div>
        </div>
      </div>`;
  }

  const topbar = document.getElementById("topbar");
  if (topbar) {
    topbar.innerHTML = `
      <div class="search-wrap">${I.search}<input class="search" id="search" placeholder="${placeholder}" autocomplete="off" /></div>
      <div class="spacer"></div>
      <a class="btn" id="newShipment" href="new.html">${I.plus} New shipment</a>
      <button class="icon-btn" aria-label="Help">${I.help}</button>
      <button class="icon-btn has-dot" aria-label="Notifications">${I.bell}</button>
      <div class="menu">
        <div class="avatar" id="avatar">MC</div>
        <div class="menu-pop">
          <a href="settings.html">Account settings</a>
          <a href="#">Billing</a>
          <a href="signin.html">Sign out</a>
        </div>
      </div>`;
  }

  // Close the avatar menu on Escape (so key("Escape") has a visible effect).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") document.activeElement?.blur();
  });
})();
