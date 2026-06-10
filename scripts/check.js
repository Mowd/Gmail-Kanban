const fs = require("fs");
const { execFileSync } = require("child_process");

const commonFiles = [
  "src/background.js",
  "content/gmail-kanban.js",
  "content/gmail-kanban.css",
  "options/options.html",
  "options/options.js",
  "options/options.css",
  "popup/popup.html",
  "popup/popup.js",
  "popup/popup.css"
];

const javascriptFiles = [
  "src/background.js",
  "content/gmail-kanban.js",
  "options/options.js",
  "popup/popup.js"
];

checkChrome();
checkFirefox();
checkSynchronizedFiles();
checkDetailPanelDirectHandlers();
checkMailActionSemantics();
checkNoRootDelegation();
checkStaleDomReplacement();
checkPopupOptionsFallback();
checkBackgroundRecoveryGuards();
checkLegacyLabelRecovery();
checkCategorizedColumnSeeding();
console.log("Chrome and Firefox extension files look valid.");

function checkChrome() {
  const manifest = readManifest("chrome");
  checkManifestVersion(manifest, "chrome");
  checkRequiredFiles("chrome", commonFiles);
  checkJavaScript("chrome", javascriptFiles);

  if (!manifest.background?.service_worker) {
    throw new Error("Chrome manifest must define background.service_worker.");
  }
  if (!manifest.oauth2?.client_id?.includes("__REPLACE_WITH")) {
    console.warn("Chrome OAuth client ID has been customized.");
  }
}

function checkFirefox() {
  const manifest = readManifest("firefox");
  checkManifestVersion(manifest, "firefox");
  checkRequiredFiles("firefox", [...commonFiles, "src/oauth-config.js"]);
  checkJavaScript("firefox", [...javascriptFiles, "src/oauth-config.js"]);

  if (!Array.isArray(manifest.background?.scripts) || !manifest.background.scripts.includes("src/background.js")) {
    throw new Error("Firefox manifest must define background.scripts with src/background.js.");
  }
  if (!manifest.browser_specific_settings?.gecko?.id) {
    throw new Error("Firefox manifest must define browser_specific_settings.gecko.id.");
  }

  const oauthConfig = fs.readFileSync("firefox/src/oauth-config.js", "utf8");
  if (oauthConfig.includes("__REPLACE_WITH_GOOGLE_DESKTOP_CLIENT_ID__")) {
    console.warn("Firefox OAuth client ID still uses the placeholder.");
  }
  if (oauthConfig.includes("__REPLACE_WITH_GOOGLE_DESKTOP_CLIENT_SECRET__")) {
    console.warn("Firefox OAuth client secret still uses the placeholder.");
  }
}

function checkSynchronizedFiles() {
  for (const file of commonFiles) {
    const chromeFile = fs.readFileSync(`chrome/${file}`, "utf8");
    const firefoxFile = fs.readFileSync(`firefox/${file}`, "utf8");
    if (chromeFile !== firefoxFile) {
      throw new Error(`Chrome and Firefox versions are out of sync: ${file}`);
    }
  }
}

function checkDetailPanelDirectHandlers() {
  const content = fs.readFileSync("chrome/content/gmail-kanban.js", "utf8");
  const requiredHandlers = [
    ["detail action buttons", "runDetailAction(action);"],
    ["detail close button", "closeButton.addEventListener(\"click\""],
    ["detail error close button", "close.addEventListener(\"click\""],
    ["detail attachment button", "openAttachment(index);"]
  ];

  for (const [name, needle] of requiredHandlers) {
    if (!content.includes(needle)) {
      throw new Error(`Missing direct ${name} handler in detail panel.`);
    }
  }
}

function checkMailActionSemantics() {
  const content = fs.readFileSync("chrome/content/gmail-kanban.js", "utf8");
  const requiredSnippets = [
    ["shell controls direct handlers", "function bindShellControls(root)"],
    ["column action direct handler", "async function handleColumnActionButton(button)"],
    ["bulk archive direct path", "completed = await bulkArchiveColumn(columnId);"],
    ["bulk trash direct path", "completed = await bulkTrashColumn(columnId);"],
    ["quick action direct handler", "button.addEventListener(\"click\", (event) => {\n      event.preventDefault();\n      event.stopPropagation();\n      handleQuickMoveButton(button);"],
    ["quick action shared handler", "async function handleQuickMoveButton(button)"],
    ["quick action move path", "return moveMessageWithOptimisticUi(messageId, targetColumnId,"],
    ["detail archive moves to waiting board", "await moveDetailMessageToSpecialColumn(getArchiveColumn(),"],
    ["detail delete moves to waiting board", "await moveDetailMessageToSpecialColumn(getDeleteColumn(),"]
  ];

  for (const [name, needle] of requiredSnippets) {
    if (!content.includes(needle)) {
      throw new Error(`Missing or changed mail action semantic: ${name}.`);
    }
  }
}

function checkNoRootDelegation() {
  const content = fs.readFileSync("chrome/content/gmail-kanban.js", "utf8");
  const forbiddenSnippets = [
    "root.addEventListener(\"click\"",
    "root.addEventListener(\"focusin\"",
    "root.addEventListener(\"input\"",
    "function handleRootClick",
    "function handleRootFocusIn",
    "function handleRootInput",
    "event.target.closest(\"button[data-action]\")"
  ];

  for (const needle of forbiddenSnippets) {
    if (content.includes(needle)) {
      throw new Error(`Root-level event delegation is forbidden in content script: ${needle}`);
    }
  }
}

function checkStaleDomReplacement() {
  const content = fs.readFileSync("chrome/content/gmail-kanban.js", "utf8");
  const requiredSnippets = [
    ["instance id", "const INSTANCE_ID = String(Math.random()).slice(2);"],
    ["shell stale instance removal", "root.dataset.gkanbanInstanceId === INSTANCE_ID"],
    ["nav stale instance removal", "navLink && navLink.dataset.gkanbanInstanceId !== INSTANCE_ID"],
    ["launcher stale instance removal", "launcher && launcher.dataset.gkanbanInstanceId !== INSTANCE_ID"]
  ];

  for (const [name, needle] of requiredSnippets) {
    if (!content.includes(needle)) {
      throw new Error(`Missing stale DOM replacement guard: ${name}.`);
    }
  }
}

function checkPopupOptionsFallback() {
  const popup = fs.readFileSync("chrome/popup/popup.js", "utf8");
  const obsoleteDirectHandler = `document.getElementById("options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});`;
  if (popup.includes(obsoleteDirectHandler)) {
    throw new Error("Popup options button must use the background GKANBAN_OPEN_OPTIONS fallback path.");
  }

  const requiredSnippets = [
    ["popup options background message", "await sendMessage(\"GKANBAN_OPEN_OPTIONS\");"],
    ["popup options fallback page", "chrome.runtime.getURL(\"options/options.html\")"],
    ["popup message helper", "function sendMessage(type, payload = {})"]
  ];

  for (const [name, needle] of requiredSnippets) {
    if (!popup.includes(needle)) {
      throw new Error(`Missing popup options safety guard: ${name}.`);
    }
  }
}

function checkBackgroundRecoveryGuards() {
  const background = fs.readFileSync("chrome/src/background.js", "utf8");
  const requiredSnippets = [
    ["safe Gmail API JSON parsing", "function parseJsonResponse(text)"],
    ["safe settings draft parsing", "function parseSettingsDraftBody(body)"],
    ["invalid draft recovery", "Ignoring invalid Gmail Kanban settings draft JSON."]
  ];

  for (const [name, needle] of requiredSnippets) {
    if (!background.includes(needle)) {
      throw new Error(`Missing background recovery guard: ${name}.`);
    }
  }
}

function checkLegacyLabelRecovery() {
  const background = fs.readFileSync("chrome/src/background.js", "utf8");
  const requiredSnippets = [
    ["label alias map", "function buildLabelIdsByColumn(columns)"],
    ["column alias ids", "function getColumnLabelIds(column)"],
    ["legacy root match", "function getManagedColumnLabelMatch(labelName, rootLabelName)"],
    ["legacy label alias", "updatedColumn.aliasLabelIds = aliasLabelIds;"],
    ["move removes aliases", ".flatMap((column) => getColumnLabelIds(column))"]
  ];

  for (const [name, needle] of requiredSnippets) {
    if (!background.includes(needle)) {
      throw new Error(`Missing legacy label recovery behavior: ${name}.`);
    }
  }
}

function checkCategorizedColumnSeeding() {
  const background = fs.readFileSync("chrome/src/background.js", "utf8");
  const requiredSnippets = [
    ["column seed page size", "const COLUMN_SEED_PAGE_SIZE = 20;"],
    ["empty categorized column seeding", "async function seedEmptyCategorizedColumns"],
    ["column inbox label query", "async function listInboxMessagesForColumn"],
    ["multi-label Gmail list", "function listMessagesByLabelIds"],
    ["INBOX plus board label", "labelIds: [\"INBOX\", labelId]"]
  ];

  for (const [name, needle] of requiredSnippets) {
    if (!background.includes(needle)) {
      throw new Error(`Missing categorized column seed behavior: ${name}.`);
    }
  }
}

function readManifest(folder) {
  return JSON.parse(fs.readFileSync(`${folder}/manifest.json`, "utf8"));
}

function checkManifestVersion(manifest, folder) {
  if (manifest.manifest_version !== 3) {
    throw new Error(`${folder} manifest must use version 3.`);
  }
}

function checkRequiredFiles(folder, files) {
  for (const file of files) {
    const path = `${folder}/${file}`;
    if (!fs.existsSync(path)) {
      throw new Error(`Missing required file: ${path}`);
    }
  }
}

function checkJavaScript(folder, files) {
  for (const file of files) {
    execFileSync(process.execPath, ["--check", `${folder}/${file}`], {
      stdio: "inherit"
    });
  }
}
