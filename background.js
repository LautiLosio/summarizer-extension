const MENU_ID = "sts-summarize-selection";

function createContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Summarize selection",
      contexts: ["selection"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const selectionText = String(info.selectionText || "").trim();
  if (!selectionText || !tab?.id) return;

  chrome.tabs.sendMessage(
    tab.id,
    {
      type: "sts-manual-summarize",
      selectionText,
    },
    () => {
      void chrome.runtime.lastError;
    },
  );
});
