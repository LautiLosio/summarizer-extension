const MENU_IDS = {
  ASK_SELECTION: "sts-ask-selection",
  SUMMARIZE_SELECTION: "sts-summarize-selection",
  SUMMARIZE_PAGE: "sts-summarize-page",
  OPEN_ASSISTANT: "sts-open-assistant",
};

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    drainLastError();
    chrome.contextMenus.create({
      id: MENU_IDS.OPEN_ASSISTANT,
      title: "Open Local AI",
      contexts: ["page"],
    }, drainLastError);
    chrome.contextMenus.create({
      id: MENU_IDS.SUMMARIZE_PAGE,
      title: "Summarize this page",
      contexts: ["page"],
    }, drainLastError);
    chrome.contextMenus.create({
      id: MENU_IDS.ASK_SELECTION,
      title: "Ask about selection",
      contexts: ["selection"],
    }, drainLastError);
    chrome.contextMenus.create({
      id: MENU_IDS.SUMMARIZE_SELECTION,
      title: "Summarize selection",
      contexts: ["selection"],
    }, drainLastError);
  });
}

function drainLastError() {
  void chrome.runtime.lastError;
}

function handleInstalled(details) {
  createContextMenus();

  if (details.reason !== chrome.runtime.OnInstalledReason.INSTALL) return;
  chrome.runtime.openOptionsPage(drainLastError);
}

chrome.runtime.onInstalled.addListener(handleInstalled);
chrome.runtime.onStartup.addListener(createContextMenus);

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  sendMessageToTab(tab.id, { type: "sts-open-assistant" });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;

  const selectionText = String(info.selectionText || "").trim();
  const messageByMenu = {
    [MENU_IDS.OPEN_ASSISTANT]: { type: "sts-open-assistant" },
    [MENU_IDS.SUMMARIZE_PAGE]: { type: "sts-summarize-page" },
    [MENU_IDS.ASK_SELECTION]: {
      type: "sts-ask-selection",
      selectionText,
    },
    [MENU_IDS.SUMMARIZE_SELECTION]: {
      type: "sts-summarize-selection",
      selectionText,
    },
  };

  const message = messageByMenu[info.menuItemId];
  if (!message) return;
  sendMessageToTab(tab.id, message);
});

function sendMessageToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, async () => {
    if (!chrome.runtime.lastError) return;
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"],
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      chrome.tabs.sendMessage(tabId, message, () => {
        drainLastError();
      });
    } catch (_) {}
  });
}
