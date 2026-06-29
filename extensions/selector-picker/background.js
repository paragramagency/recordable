// Toolbar click toggles the picker in the active tab. We track armed state per
// tab and broadcast an explicit on/off to *every* frame (the content script
// runs in all frames), so the top document and any iframes stay in sync.

const armedByTab = new Map();

function setTab(tabId, armed) {
  armedByTab.set(tabId, armed);
  // No frameId → delivered to all frames in the tab.
  chrome.tabs
    .sendMessage(tabId, { type: "recordable-picker-set", armed })
    .catch(() => {
      // No content script here (chrome://, the web store, the PDF viewer, …).
    });
  chrome.action.setBadgeText({ tabId, text: armed ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#0a7d5a" });
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) setTab(tab.id, !armedByTab.get(tab.id));
});

// A frame disarming itself (Esc) asks us to turn the whole tab off.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === "recordable-picker-off" && sender.tab?.id != null)
    setTab(sender.tab.id, false);
});

chrome.tabs.onRemoved.addListener((tabId) => armedByTab.delete(tabId));
