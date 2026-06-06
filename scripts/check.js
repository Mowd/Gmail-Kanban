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
    ["bulk archive direct path", "return await bulkArchiveColumn(button.dataset.columnId);"],
    ["bulk trash direct path", "return await bulkTrashColumn(button.dataset.columnId);"],
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
