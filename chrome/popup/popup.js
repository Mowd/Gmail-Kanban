document.getElementById("open-gmail").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://mail.google.com/mail/u/0/?gkanban=1#inbox" });
});

document.getElementById("options").addEventListener("click", async () => {
  try {
    await sendMessage("GKANBAN_OPEN_OPTIONS");
  } catch (_error) {
    if (typeof chrome.runtime.openOptionsPage === "function") {
      chrome.runtime.openOptionsPage();
      return;
    }
    chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") });
  }
});

function sendMessage(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Unknown extension error."));
        return;
      }
      resolve(response.data);
    });
  });
}
