document.getElementById("open-gmail").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://mail.google.com/mail/u/0/?gkanban=1#inbox" });
});

document.getElementById("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
