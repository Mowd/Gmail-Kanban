document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("authorize").addEventListener("click", authorize);
  refreshAuthStatus();
  refreshSettings();
});

async function authorize() {
  try {
    setStatus("正在授權 Gmail...");
    await sendMessage("GKANBAN_AUTH");
    await refreshAuthStatus();
    await refreshSettings("Gmail labels 已就緒。");
  } catch (error) {
    setStatus(error.message);
    renderAuthState(false);
  }
}

async function refreshAuthStatus() {
  try {
    const status = await sendMessage("GKANBAN_GET_AUTH_STATUS");
    renderAuthState(Boolean(status.authorized), status.reason);
  } catch (error) {
    renderAuthState(false, error.message);
  }
}

async function refreshSettings(statusText = "設定已載入。") {
  try {
    const settings = await sendMessage("GKANBAN_GET_SETTINGS");
    renderColumns(settings.columns || []);
    setStatus(statusText);
  } catch (error) {
    setStatus(error.message);
  }
}

function renderAuthState(authorized, reason = "") {
  const state = document.getElementById("auth-state");
  const authorizeButton = document.getElementById("authorize");
  state.classList.toggle("auth-state-ok", authorized);
  state.classList.toggle("auth-state-needed", !authorized);
  state.classList.remove("auth-state-pending");
  state.textContent = authorized ? "已授權 Gmail" : "尚未授權 Gmail";
  state.title = authorized ? "Chrome 可取得 Gmail OAuth token。" : reason;
  authorizeButton.hidden = authorized;
}

function renderColumns(columns) {
  const list = document.getElementById("columns");
  list.innerHTML = "";
  for (const column of columns) {
    const item = document.createElement("li");
    item.textContent = column.name;
    list.appendChild(item);
  }
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

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
