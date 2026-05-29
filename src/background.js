function drainLastError() {
  void chrome.runtime.lastError;
}

function handleInstalled(details) {
  if (details.reason !== chrome.runtime.OnInstalledReason.INSTALL) return;
  chrome.runtime.openOptionsPage(drainLastError);
}

chrome.runtime.onInstalled.addListener(handleInstalled);

chrome.action.onClicked.addListener((tab) => {
  if (!tab?.id) return;
  sendMessageToTab(tab.id, { type: "sts-open-assistant" });
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
