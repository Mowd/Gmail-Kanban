const STORAGE_KEY = "gkanban.settings";
const ROOT_LABEL_NAME = "gKanban";
const LEGACY_ROOT_LABEL_NAME = "gkanban";
const EXPORT_VERSION = 1;
const UNCATEGORIZED_COLUMN_ID = "__uncategorized";
const SETTINGS_DRAFT_SUBJECT = "Gmail Kanban Settings - Do Not Send";
const SETTINGS_DRAFT_HEADER = "X-Gmail-Kanban-Settings";
const SETTINGS_DRAFT_TO = "gkanban-settings@local.invalid";
const DEFAULT_PAGE_SIZE = 80;
const GMAIL_LIST_PAGE_SIZE = 100;
const MESSAGE_FETCH_CONCURRENCY = 4;
const FIREFOX_TOKEN_KEY = "gkanban.firefox.oauth";
const FIREFOX_OAUTH_CLIENT_ID =
  globalThis.GKANBAN_FIREFOX_OAUTH_CLIENT_ID || "__REPLACE_WITH_GOOGLE_DESKTOP_CLIENT_ID__";
const FIREFOX_OAUTH_CLIENT_SECRET =
  globalThis.GKANBAN_FIREFOX_OAUTH_CLIENT_SECRET || "__REPLACE_WITH_GOOGLE_DESKTOP_CLIENT_SECRET__";
const OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.labels"
];
const DEFAULT_COLUMNS = [
  { id: "in-progress", name: "處理中", builtIn: true },
  { id: "to-archive", name: "待封存", builtIn: true },
  { id: "to-delete", name: "待刪除", builtIn: true }
];
const MESSAGE_METADATA_HEADERS = ["Subject", "From", "Date", "To"];
const DETAIL_HEADERS = ["Subject", "From", "To", "Cc", "Date", "Message-ID", "References", "Reply-To"];
let currentBoardRequest = null;

chrome.runtime.onInstalled.addListener(() => {
  getSettings().catch(console.error);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: normalizeError(error) }));
  return true;
});

async function handleMessage(message) {
  switch (message?.type) {
    case "GKANBAN_AUTH":
      return ensureGmailSetup({ interactive: true });
    case "GKANBAN_GET_AUTH_STATUS":
      return getAuthStatus();
    case "GKANBAN_GET_BOARD":
      return getSharedBoard({ interactive: Boolean(message.interactive), maxResults: message.maxResults });
    case "GKANBAN_LOAD_MORE":
      return getBoard({
        interactive: Boolean(message.interactive),
        maxResults: message.maxResults,
        pageToken: message.pageToken
      });
    case "GKANBAN_CHECK_INBOX_UPDATES":
      return listInboxMessages({
        interactive: false,
        maxResults: message.maxResults || 20
      });
    case "GKANBAN_ADD_COLUMN":
      return addColumn(message.name);
    case "GKANBAN_DELETE_COLUMN":
      return deleteColumn(message.columnId);
    case "GKANBAN_RENAME_COLUMN":
      return renameColumn(message.columnId, message.name);
    case "GKANBAN_SET_COLUMN_ORDER":
      return setColumnOrder(message.columnIds, message.columnRows);
    case "GKANBAN_MOVE_MESSAGE":
      return moveMessage(message.messageId, message.targetColumnId);
    case "GKANBAN_BULK_ARCHIVE":
      return bulkArchiveMessages(message.messageIds);
    case "GKANBAN_BULK_TRASH":
      return bulkTrashMessages(message.messageIds);
    case "GKANBAN_GET_MESSAGE":
      return getMessageDetail(message.messageId, { markRead: Boolean(message.markRead) });
    case "GKANBAN_GET_ATTACHMENT":
      return getMessageAttachment(message.messageId, message.attachmentId);
    case "GKANBAN_SEND_REPLY":
      return sendReply(message.messageId, message.body);
    case "GKANBAN_SEND_FORWARD":
      return sendForward(message.messageId, message.to, message.body);
    case "GKANBAN_EXPORT_SETTINGS":
      return exportSettings();
    case "GKANBAN_IMPORT_SETTINGS":
      return importSettings(message.settings);
    case "GKANBAN_GET_SETTINGS":
      return getSettings();
    case "GKANBAN_OPEN_OPTIONS":
      return openOptionsPage();
    default:
      throw new Error(`Unknown message type: ${message?.type || "empty"}`);
  }
}

async function openOptionsPage() {
  if (typeof chrome.runtime.openOptionsPage === "function") {
    await chrome.runtime.openOptionsPage();
    return { opened: true };
  }

  await chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") });
  return { opened: true };
}

function getSharedBoard(options) {
  if (currentBoardRequest) {
    return currentBoardRequest;
  }

  currentBoardRequest = getBoard(options).finally(() => {
    currentBoardRequest = null;
  });
  return currentBoardRequest;
}

async function getAuthStatus() {
  try {
    await getAuthToken({ interactive: false });
    return { authorized: true };
  } catch (error) {
    return {
      authorized: false,
      reason: normalizeError(error)
    };
  }
}

async function getBoard({ interactive = false, maxResults = DEFAULT_PAGE_SIZE, pageToken = "" } = {}) {
  const settings = await ensureGmailSetup({ interactive });
  const labelIdsByColumn = new Map(settings.columns.map((column) => [column.labelId, column]));
  const inboxResult = await listInboxMessages({ interactive, maxResults, pageToken });
  const inboxMessages = inboxResult.messages;
  const boardColumns = [
    { id: UNCATEGORIZED_COLUMN_ID, name: "未分類", virtual: true, messages: [] },
    ...settings.columns.map((column) => ({ ...column, messages: [] }))
  ];
  const boardColumnById = new Map(boardColumns.map((column) => [column.id, column]));

  for (const message of inboxMessages) {
    const assignedColumn = (message.labelIds || [])
      .map((labelId) => labelIdsByColumn.get(labelId))
      .find(Boolean);
    const columnId = assignedColumn?.id || UNCATEGORIZED_COLUMN_ID;
    boardColumnById.get(columnId)?.messages.push(message);
  }

  return {
    rootLabelName: settings.rootLabelName,
    columns: boardColumns,
    columnRows: normalizeColumnRows(settings.columnRows, settings.columns),
    loadedMessageCount: inboxMessages.length,
    resultSizeEstimate: inboxResult.resultSizeEstimate,
    nextPageToken: inboxResult.nextPageToken,
    fetchedAt: new Date().toISOString()
  };
}

async function ensureGmailSetup({ interactive = false } = {}) {
  let settings = await getSyncedSettings({ interactive });
  const labels = await listLabels({ interactive });
  let changed = false;

  const labelsByName = new Map(labels.map((label) => [label.name, label]));
  let rootLabel = labelsByName.get(settings.rootLabelName);
  if (!rootLabel) {
    rootLabel = await createLabel(settings.rootLabelName, { interactive });
    labelsByName.set(rootLabel.name, rootLabel);
  }

  const recoveredColumns = recoverColumnsFromLabels(labels, settings);
  if (shouldUseRecoveredColumns(settings.columns, recoveredColumns)) {
    settings = {
      ...settings,
      columns: recoveredColumns,
      columnRows: normalizeColumnRows(settings.columnRows, recoveredColumns)
    };
    changed = true;
  }

  const columns = [];
  for (const column of settings.columns) {
    const labelName = `${settings.rootLabelName}/${column.name}`;
    let label = labelsByName.get(labelName);
    if (!label) {
      label = await createLabel(labelName, { interactive });
      labelsByName.set(label.name, label);
    }
    const updatedColumn = { ...column, labelId: label.id, labelName };
    columns.push(updatedColumn);
    if (column.labelId !== updatedColumn.labelId || column.labelName !== updatedColumn.labelName) {
      changed = true;
    }
  }

  const hydratedSettings = {
    ...settings,
    rootLabelId: rootLabel.id,
    columns
  };

  if (settings.rootLabelId !== rootLabel.id) {
    changed = true;
  }

  if (changed || !settings.settingsDraftId) {
    await saveSettingsEverywhere(hydratedSettings, { interactive });
  }

  return hydratedSettings;
}

async function getSyncedSettings({ interactive = false } = {}) {
  const localRecord = await storageGet(STORAGE_KEY);
  const hasLocalSettings = Boolean(localRecord[STORAGE_KEY]);
  const localSettings = normalizeSettings(localRecord[STORAGE_KEY]);
  if (!hasLocalSettings) {
    await saveSettings(localSettings);
  }

  const draftRecord = await readSettingsDraft({ interactive });
  if (!draftRecord?.settings) {
    if (localSettings.settingsDraftId) {
      const resetSettings = { ...localSettings, settingsDraftId: undefined };
      await saveSettings(resetSettings);
      return resetSettings;
    }
    return localSettings;
  }

  const draftSettings = normalizeSettings({
    ...draftRecord.settings,
    settingsDraftId: draftRecord.draftId,
    updatedAt: draftRecord.updatedAt || draftRecord.settings.updatedAt
  });

  if (hasLocalSettings && isSettingsNewer(localSettings, draftSettings)) {
    return localSettings;
  }

  await saveSettings(draftSettings);
  return draftSettings;
}

function recoverColumnsFromLabels(labels, settings) {
  const prefix = `${settings.rootLabelName}/`;
  const columnsByName = new Map((settings.columns || []).map((column) => [column.name, column]));
  const recovered = [];
  const seenNames = new Set();

  for (const label of labels) {
    const labelName = String(label.name || "");
    if (!labelName.startsWith(prefix)) {
      continue;
    }

    const columnName = labelName.slice(prefix.length).trim();
    if (!columnName || columnName.includes("/")) {
      continue;
    }

    const key = columnName.toLocaleLowerCase();
    if (seenNames.has(key)) {
      continue;
    }
    seenNames.add(key);

    const existing = columnsByName.get(columnName) || getDefaultColumnByName(columnName);
    recovered.push({
      id: existing?.id || `label-${label.id}`,
      name: columnName,
      builtIn: Boolean(existing?.builtIn),
      labelId: label.id,
      labelName
    });
  }

  return orderRecoveredColumns(recovered, settings.columns || []);
}

function shouldUseRecoveredColumns(settingsColumns, recoveredColumns) {
  if (!recoveredColumns.length) {
    return false;
  }

  const settingsNames = new Set((settingsColumns || []).map((column) => column.name));
  const recoveredNames = new Set(recoveredColumns.map((column) => column.name));
  if (isDefaultColumnSet(settingsColumns)) {
    return true;
  }
  if (recoveredColumns.length > (settingsColumns || []).length) {
    return true;
  }
  for (const name of recoveredNames) {
    if (!settingsNames.has(name)) {
      return true;
    }
  }
  return false;
}

function isDefaultColumnSet(columns) {
  if (!Array.isArray(columns) || columns.length !== DEFAULT_COLUMNS.length) {
    return false;
  }
  return DEFAULT_COLUMNS.every((defaultColumn) => {
    return columns.some((column) => column.id === defaultColumn.id && column.name === defaultColumn.name);
  });
}

function getDefaultColumnByName(name) {
  return DEFAULT_COLUMNS.find((column) => column.name === name);
}

function orderRecoveredColumns(recoveredColumns, settingsColumns) {
  const byName = new Map(recoveredColumns.map((column) => [column.name, column]));
  const ordered = [];
  for (const settingsColumn of settingsColumns) {
    const recovered = byName.get(settingsColumn.name);
    if (recovered) {
      ordered.push({ ...settingsColumn, ...recovered });
      byName.delete(settingsColumn.name);
    }
  }
  return [...ordered, ...byName.values()];
}

async function addColumn(name) {
  const safeName = normalizeColumnName(name);
  let settings = await getSyncedSettings({ interactive: true });
  ensureUniqueColumnName(settings.columns, safeName);
  const newColumn = { id: createColumnId(), name: safeName, builtIn: false };
  const nextColumns = [...settings.columns, newColumn];
  settings = {
    ...settings,
    columns: nextColumns,
    columnRows: [...normalizeColumnRows(settings.columnRows, settings.columns), [newColumn.id]]
  };
  await saveSettings(settings);
  currentBoardRequest = null;
  return ensureGmailSetup({ interactive: true });
}

async function deleteColumn(columnId) {
  if (!columnId || columnId === UNCATEGORIZED_COLUMN_ID) {
    throw new Error("Cannot delete this Kanban column.");
  }

  const settings = await ensureGmailSetup({ interactive: true });
  const column = settings.columns.find((item) => item.id === columnId);
  if (!column) {
    throw new Error("Column not found.");
  }

  if (column.labelId) {
    await gmailFetch(`labels/${encodeURIComponent(column.labelId)}`, {
      method: "DELETE",
      interactive: true
    });
  }

  const nextSettings = {
    ...settings,
    columns: settings.columns.filter((item) => item.id !== columnId),
    columnRows: normalizeColumnRows(settings.columnRows, settings.columns.filter((item) => item.id !== columnId))
  };
  await saveSettingsEverywhere(nextSettings, { interactive: true });
  currentBoardRequest = null;
  return nextSettings;
}

async function renameColumn(columnId, name) {
  const safeName = normalizeColumnName(name);
  const settings = await ensureGmailSetup({ interactive: true });
  const column = settings.columns.find((item) => item.id === columnId);
  if (!column) {
    throw new Error("Column not found.");
  }

  ensureUniqueColumnName(settings.columns, safeName, columnId);
  const labelName = `${settings.rootLabelName}/${safeName}`;
  if (column.labelId) {
    await gmailFetch(`labels/${encodeURIComponent(column.labelId)}`, {
      method: "PATCH",
      interactive: true,
      body: {
        name: labelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show"
      }
    });
  }

  const nextSettings = {
    ...settings,
    columns: settings.columns.map((item) => {
      if (item.id !== columnId) {
        return item;
      }
      return {
        ...item,
        name: safeName,
        labelName
      };
    })
  };

  await saveSettingsEverywhere(nextSettings, { interactive: true });
  currentBoardRequest = null;
  return nextSettings;
}

async function setColumnOrder(columnIds, columnRows) {
  if (!Array.isArray(columnIds)) {
    throw new Error("Column order is required.");
  }

  const settings = await getSettings();
  const columnsById = new Map(settings.columns.map((column) => [column.id, column]));
  const orderedColumns = [];
  const seenIds = new Set();

  for (const columnId of columnIds) {
    const column = columnsById.get(columnId);
    if (column && !seenIds.has(column.id)) {
      orderedColumns.push(column);
      seenIds.add(column.id);
    }
  }

  for (const column of settings.columns) {
    if (!seenIds.has(column.id)) {
      orderedColumns.push(column);
    }
  }

  const nextSettings = await saveSettingsEverywhere({
    ...settings,
    columns: orderedColumns,
    columnRows: normalizeColumnRows(columnRows, orderedColumns)
  }, { interactive: true });
  currentBoardRequest = null;
  return nextSettings;
}

async function moveMessage(messageId, targetColumnId) {
  if (!messageId) {
    throw new Error("Missing message ID.");
  }

  const settings = await ensureGmailSetup({ interactive: true });
  const targetColumn = settings.columns.find((column) => column.id === targetColumnId);
  const addLabelIds = targetColumn ? [targetColumn.labelId] : [];
  const addLabelIdSet = new Set(addLabelIds);
  const removeLabelIds = settings.columns
    .map((column) => column.labelId)
    .filter((labelId) => labelId && !addLabelIdSet.has(labelId));

  if (targetColumnId !== UNCATEGORIZED_COLUMN_ID && !targetColumn) {
    throw new Error("Target column not found.");
  }

  await gmailFetch(`messages/${encodeURIComponent(messageId)}/modify`, {
    method: "POST",
    interactive: true,
    body: {
      addLabelIds,
      removeLabelIds
    }
  });

  currentBoardRequest = null;
  return { messageId, targetColumnId };
}

async function bulkArchiveMessages(messageIds) {
  const ids = normalizeMessageIds(messageIds);
  if (!ids.length) {
    return { changed: 0 };
  }

  await gmailFetch("messages/batchModify", {
    method: "POST",
    interactive: true,
    body: {
      ids,
      removeLabelIds: ["INBOX"]
    }
  });

  currentBoardRequest = null;
  return { changed: ids.length };
}

async function bulkTrashMessages(messageIds) {
  const ids = normalizeMessageIds(messageIds);
  if (!ids.length) {
    return { changed: 0 };
  }

  await mapWithConcurrency(ids, MESSAGE_FETCH_CONCURRENCY, (messageId) => {
    return gmailFetch(`messages/${encodeURIComponent(messageId)}/trash`, {
      method: "POST",
      interactive: true
    });
  });

  currentBoardRequest = null;
  return { changed: ids.length };
}

async function getMessageDetail(messageId, { markRead = false } = {}) {
  if (!messageId) {
    throw new Error("Missing message ID.");
  }

  const query = new URLSearchParams({ format: "full" });
  const message = await gmailFetch(`messages/${encodeURIComponent(messageId)}?${query.toString()}`, {
    interactive: true
  });

  if (markRead && (message.labelIds || []).includes("UNREAD")) {
    await gmailFetch(`messages/${encodeURIComponent(messageId)}/modify`, {
      method: "POST",
      interactive: true,
      body: {
        removeLabelIds: ["UNREAD"]
      }
    });
    message.labelIds = (message.labelIds || []).filter((labelId) => labelId !== "UNREAD");
  }

  return serializeMessageDetail(message);
}

async function getMessageAttachment(messageId, attachmentId) {
  if (!messageId || !attachmentId) {
    throw new Error("Missing attachment ID.");
  }

  const attachment = await gmailFetch(
    `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { interactive: true }
  );
  return {
    data: attachment.data || ""
  };
}

async function sendReply(messageId, body) {
  const safeBody = normalizeOutgoingBody(body);
  const original = await getMessageDetail(messageId);
  const to = original.replyTo || original.from;
  if (!to) {
    throw new Error("Cannot determine reply recipient.");
  }

  const subject = ensureSubjectPrefix(original.subject, "Re:");
  const headers = [
    ["To", to],
    ["Subject", subject],
    ["In-Reply-To", original.messageId],
    ["References", [original.references, original.messageId].filter(Boolean).join(" ")]
  ].filter(([, value]) => Boolean(value));

  const raw = buildRawEmail(headers, safeBody);
  await gmailFetch("messages/send", {
    method: "POST",
    interactive: true,
    body: {
      raw,
      threadId: original.threadId
    }
  });

  return { sent: true, threadId: original.threadId };
}

async function sendForward(messageId, to, body) {
  const safeTo = String(to || "").trim();
  if (!safeTo) {
    throw new Error("Forward recipient is required.");
  }

  const original = await getMessageDetail(messageId);
  const subject = ensureSubjectPrefix(original.subject, "Fwd:");
  const forwardedBody = [
    String(body || "").trim(),
    "",
    "---------- Forwarded message ---------",
    `From: ${original.from || ""}`,
    `Date: ${original.date || ""}`,
    `Subject: ${original.subject || ""}`,
    `To: ${original.to || ""}`,
    "",
    original.textBody || original.snippet || ""
  ].join("\r\n");

  const raw = buildRawEmail(
    [
      ["To", safeTo],
      ["Subject", subject]
    ],
    forwardedBody
  );

  await gmailFetch("messages/send", {
    method: "POST",
    interactive: true,
    body: { raw }
  });

  return { sent: true };
}

async function exportSettings() {
  const settings = await getSettings();
  return {
    app: "gmail-kanban",
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    rootLabelName: settings.rootLabelName,
    columns: settings.columns.map((column) => ({
      id: column.id,
      name: column.name,
      builtIn: Boolean(column.builtIn)
    }))
  };
}

async function importSettings(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid settings file.");
  }

  const columnsSource = Array.isArray(payload.columns) ? payload.columns : [];
  const importedColumns = [];
  const seenNames = new Set();
  const seenIds = new Set();

  for (const item of columnsSource) {
    const name = normalizeColumnName(item?.name);
    const key = name.toLocaleLowerCase();
    if (seenNames.has(key)) {
      continue;
    }
    const id = normalizeColumnId(item?.id, seenIds);
    seenNames.add(key);
    importedColumns.push({
      id,
      name,
      builtIn: Boolean(item?.builtIn)
    });
  }

  if (!importedColumns.length) {
    throw new Error("Settings file does not contain any Kanban columns.");
  }

  const settings = {
    rootLabelName: ROOT_LABEL_NAME,
    columns: importedColumns,
    updatedAt: new Date().toISOString()
  };
  await saveSettings(settings);
  currentBoardRequest = null;
  return ensureGmailSetup({ interactive: true });
}

async function listInboxMessages({ interactive = false, maxResults = DEFAULT_PAGE_SIZE, pageToken = "" } = {}) {
  const limit = normalizeMaxResults(maxResults);
  const messages = [];
  let resultSizeEstimate = 0;
  let nextPageToken = pageToken || "";

  do {
    const remaining = Number.isFinite(limit) ? limit - messages.length : GMAIL_LIST_PAGE_SIZE;
    if (remaining <= 0) {
      break;
    }

    const query = new URLSearchParams({
      labelIds: "INBOX",
      maxResults: String(Math.min(GMAIL_LIST_PAGE_SIZE, remaining))
    });
    if (nextPageToken) {
      query.set("pageToken", nextPageToken);
    }

    const listResponse = await gmailFetch(`messages?${query.toString()}`, { interactive });
    messages.push(...(listResponse.messages || []));
    resultSizeEstimate = Math.max(resultSizeEstimate, Number(listResponse.resultSizeEstimate) || 0);
    nextPageToken = listResponse.nextPageToken || "";
  } while (nextPageToken && messages.length < limit);

  const detailedMessages = await mapWithConcurrency(messages, MESSAGE_FETCH_CONCURRENCY, (message) => {
    return getMessageMetadata(message.id, { interactive });
  });
  return {
    messages: detailedMessages,
    resultSizeEstimate,
    nextPageToken
  };
}

async function getMessageMetadata(messageId, { interactive = false } = {}) {
  const query = new URLSearchParams({ format: "metadata" });
  for (const header of MESSAGE_METADATA_HEADERS) {
    query.append("metadataHeaders", header);
  }

  const message = await gmailFetch(`messages/${encodeURIComponent(messageId)}?${query.toString()}`, {
    interactive
  });
  const headers = new Map((message.payload?.headers || []).map((header) => [header.name.toLowerCase(), header.value]));

  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds || [],
    subject: headers.get("subject") || "(no subject)",
    from: headers.get("from") || "",
    to: headers.get("to") || "",
    date: headers.get("date") || "",
    snippet: message.snippet || "",
    unread: (message.labelIds || []).includes("UNREAD")
  };
}

async function serializeMessageDetail(message) {
  const headers = collectHeaders(message.payload?.headers || []);
  const body = extractMessageBody(message.payload);
  const attachments = await hydrateInlineAttachments(message.id, extractAttachments(message.payload));
  const htmlBody = inlineCidAttachments(body.html || "", attachments);

  return {
    id: message.id,
    threadId: message.threadId,
    labelIds: message.labelIds || [],
    subject: headers.subject || "(no subject)",
    from: headers.from || "",
    to: headers.to || "",
    cc: headers.cc || "",
    date: headers.date || "",
    messageId: headers["message-id"] || "",
    references: headers.references || "",
    replyTo: headers["reply-to"] || headers.from || "",
    snippet: message.snippet || "",
    htmlBody,
    textBody: body.text || "",
    attachments: attachments.filter((attachment) => !attachment.embedded).map(serializeAttachment),
    unread: (message.labelIds || []).includes("UNREAD")
  };
}

function serializeAttachment(attachment) {
  return {
    id: attachment.id,
    attachmentId: attachment.attachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    data: attachment.attachmentId ? "" : attachment.data
  };
}

function collectHeaders(headers) {
  const wanted = new Set(DETAIL_HEADERS.map((header) => header.toLowerCase()));
  const result = {};
  for (const header of headers) {
    const name = String(header.name || "").toLowerCase();
    if (wanted.has(name)) {
      result[name] = header.value || "";
    }
  }
  return result;
}

function extractMessageBody(payload) {
  const bodies = { html: "", text: "" };
  walkPayload(payload, (part) => {
    const mimeType = String(part.mimeType || "").toLowerCase();
    const data = part.body?.data;
    if (!data) {
      return;
    }

    if (mimeType === "text/html" && !bodies.html) {
      bodies.html = base64UrlDecode(data);
    }
    if (mimeType === "text/plain" && !bodies.text) {
      bodies.text = base64UrlDecode(data);
    }
  });
  return bodies;
}

function extractAttachments(payload) {
  const attachments = [];
  walkPayload(payload, (part) => {
    const filename = String(part.filename || "").trim();
    const attachmentId = part.body?.attachmentId || "";
    const size = Number(part.body?.size) || 0;
    const mimeType = String(part.mimeType || "application/octet-stream").toLowerCase();
    const headers = collectAllHeaders(part.headers || []);
    const disposition = String(headers["content-disposition"] || "").toLowerCase();
    const contentId = normalizeContentId(headers["content-id"]);
    const isBodyPart = mimeType === "text/plain" || mimeType === "text/html" || mimeType.startsWith("multipart/");
    const hasAttachmentShape = Boolean(
      filename ||
      contentId ||
      disposition.includes("attachment") ||
      disposition.includes("inline") ||
      (attachmentId && !isBodyPart)
    );
    if (!hasAttachmentShape || (!attachmentId && !part.body?.data)) {
      return;
    }

    const embedded = Boolean(contentId) && mimeType.startsWith("image/");
    attachments.push({
      id: attachmentId || `${part.partId || filename}`,
      attachmentId,
      filename: filename || contentId || "inline attachment",
      mimeType,
      size,
      embedded,
      contentId,
      data: part.body?.data || ""
    });
  });
  return attachments;
}

function inlineCidAttachments(html, attachments) {
  if (!html || !attachments.length) {
    return html;
  }

  let output = html;
  for (const attachment of attachments) {
    if (!attachment.embedded || !attachment.contentId || !attachment.dataUrl) {
      continue;
    }
    const escapedCid = escapeRegExp(attachment.contentId);
    output = output.replace(new RegExp(`cid:${escapedCid}`, "gi"), attachment.dataUrl);
  }
  return output;
}

async function hydrateInlineAttachments(messageId, attachments) {
  return Promise.all(attachments.map(async (attachment) => {
    if (!attachment.embedded) {
      return attachment;
    }

    const dataUrl = attachment.data
      ? buildAttachmentDataUrl(attachment.mimeType, attachment.data)
      : await fetchAttachmentDataUrl(messageId, attachment);
    return dataUrl ? { ...attachment, dataUrl } : attachment;
  }));
}

async function fetchAttachmentDataUrl(messageId, attachment) {
  if (!attachment.id) {
    return "";
  }

  try {
    const data = await gmailFetch(
      `messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachment.id)}`,
      { interactive: true }
    );
    return buildAttachmentDataUrl(attachment.mimeType, data?.data || "");
  } catch (error) {
    console.warn("Failed to load inline Gmail attachment", error);
    return "";
  }
}

function buildAttachmentDataUrl(mimeType, base64UrlData) {
  if (!base64UrlData) {
    return "";
  }
  return `data:${mimeType || "application/octet-stream"};base64,${base64UrlToBase64(base64UrlData)}`;
}

function normalizeContentId(value) {
  return String(value || "").trim().replace(/^<|>$/g, "");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walkPayload(part, visitor) {
  if (!part) {
    return;
  }
  visitor(part);
  for (const child of part.parts || []) {
    walkPayload(child, visitor);
  }
}

async function listLabels({ interactive = false } = {}) {
  const response = await gmailFetch("labels", { interactive });
  return response.labels || [];
}

async function createLabel(name, { interactive = false } = {}) {
  return gmailFetch("labels", {
    method: "POST",
    interactive,
    body: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show"
    }
  });
}

async function gmailFetch(path, { method = "GET", body, interactive = false, retry = true, rateRetries = 3 } = {}) {
  const token = await getAuthToken({ interactive });
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (response.status === 401 && retry) {
    await removeCachedToken(token);
    return gmailFetch(path, { method, body, interactive, retry: false, rateRetries });
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    if (shouldRetryRateLimit(response.status, data) && rateRetries > 0) {
      await delay(getRetryDelay(rateRetries));
      return gmailFetch(path, { method, body, interactive, retry, rateRetries: rateRetries - 1 });
    }
    throw new Error(data?.error?.message || `Gmail API request failed: ${response.status}`);
  }

  return data;
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await task(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(workers);
  return results;
}

function shouldRetryRateLimit(status, data) {
  const message = String(data?.error?.message || "").toLocaleLowerCase();
  const reason = String(data?.error?.errors?.[0]?.reason || "").toLocaleLowerCase();
  return (
    status === 429 ||
    status === 503 ||
    status === 500 ||
    message.includes("rate") ||
    message.includes("too many concurrent") ||
    reason.includes("ratelimit") ||
    reason.includes("userratelimit")
  );
}

function getRetryDelay(rateRetries) {
  const attempt = 4 - rateRetries;
  return 700 * 2 ** attempt + Math.floor(Math.random() * 250);
}

function normalizeOutgoingBody(body) {
  const value = String(body || "").trim();
  if (!value) {
    throw new Error("Message body is required.");
  }
  return value;
}

function normalizeMaxResults(maxResults) {
  if (maxResults === undefined || maxResults === null) {
    return DEFAULT_PAGE_SIZE;
  }
  if (maxResults === "all") {
    return Number.POSITIVE_INFINITY;
  }

  const numeric = Number(maxResults);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.floor(numeric);
}

function normalizeMessageIds(messageIds) {
  if (!Array.isArray(messageIds)) {
    throw new Error("Message IDs are required.");
  }
  return [...new Set(messageIds.map((id) => String(id || "").trim()).filter(Boolean))];
}

function ensureSubjectPrefix(subject, prefix) {
  const safeSubject = String(subject || "(no subject)").trim();
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escapedPrefix}\\s*`, "i");
  return regex.test(safeSubject) ? safeSubject : `${prefix} ${safeSubject}`;
}

function buildRawEmail(headers, body) {
  const lines = [
    ["MIME-Version", "1.0"],
    ["Content-Type", "text/plain; charset=UTF-8"],
    ["Content-Transfer-Encoding", "8bit"],
    ...headers
  ]
    .filter(([, value]) => Boolean(value))
    .map(([name, value]) => `${name}: ${formatHeaderValue(name, value)}`);

  return base64UrlEncode(`${lines.join("\r\n")}\r\n\r\n${body}`);
}

function formatHeaderValue(name, value) {
  const sanitized = sanitizeHeaderValue(value);
  if (String(name).toLowerCase() === "subject") {
    return encodeMimeHeader(sanitized);
  }
  return sanitized;
}

function encodeMimeHeader(value) {
  if (/^[\x00-\x7F]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${base64Encode(value)}?=`;
}

function sanitizeHeaderValue(value) {
  return String(value).replace(/[\r\n]+/g, " ").trim();
}

function base64UrlDecode(value) {
  const padded = base64UrlToBase64(value);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder().decode(bytes);
}

function base64UrlToBase64(value) {
  const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

function base64UrlEncode(value) {
  return base64Encode(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Encode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getSettings() {
  const result = await storageGet(STORAGE_KEY);
  const settings = normalizeSettings(result[STORAGE_KEY]);
  if (!result[STORAGE_KEY]) {
    await saveSettings(settings);
  }
  return settings;
}

async function saveSettingsEverywhere(settings, { interactive = true } = {}) {
  const localSettings = await saveSettings(settings);
  const settingsDraftId = await upsertSettingsDraft(localSettings, { interactive });
  if (settingsDraftId && localSettings.settingsDraftId !== settingsDraftId) {
    return saveSettings({ ...localSettings, settingsDraftId });
  }
  return localSettings;
}

async function readSettingsDraft({ interactive = false } = {}) {
  const draft = await findSettingsDraft({ interactive });
  if (!draft) {
    return null;
  }

  const body = extractMessageBody(draft.message?.payload).text || "";
  if (!body.trim()) {
    return null;
  }

  const payload = JSON.parse(body);
  const settings = {
    ...(payload.settings || payload),
    updatedAt: payload.settings?.updatedAt || payload.updatedAt
  };
  return {
    draftId: draft.id,
    settings,
    updatedAt: settings.updatedAt
  };
}

async function upsertSettingsDraft(settings, { interactive = true } = {}) {
  const raw = buildSettingsRawEmail(settings);
  if (settings.settingsDraftId) {
    try {
      const updated = await gmailFetch(`drafts/${encodeURIComponent(settings.settingsDraftId)}`, {
        method: "PUT",
        interactive,
        body: {
          id: settings.settingsDraftId,
          message: { raw }
        }
      });
      return updated.id;
    } catch (_error) {
      // The draft may have been deleted manually. Fall through and recreate it.
    }
  }

  const existingDraft = await findSettingsDraft({ interactive });
  if (existingDraft?.id) {
    const updated = await gmailFetch(`drafts/${encodeURIComponent(existingDraft.id)}`, {
      method: "PUT",
      interactive,
      body: {
        id: existingDraft.id,
        message: { raw }
      }
    });
    return updated.id;
  }

  const created = await gmailFetch("drafts", {
    method: "POST",
    interactive,
    body: {
      message: { raw }
    }
  });
  return created.id;
}

async function findSettingsDraft({ interactive = false } = {}) {
  let pageToken = "";
  do {
    const query = new URLSearchParams({ maxResults: "100" });
    if (pageToken) {
      query.set("pageToken", pageToken);
    }

    const response = await gmailFetch(`drafts?${query.toString()}`, { interactive });
    for (const draft of response.drafts || []) {
      const detail = await gmailFetch(`drafts/${encodeURIComponent(draft.id)}?format=full`, { interactive });
      const headers = collectAllHeaders(detail.message?.payload?.headers || []);
      if (isSettingsDraft(headers)) {
        return detail;
      }
    }
    pageToken = response.nextPageToken || "";
  } while (pageToken);

  return null;
}

function isSettingsDraft(headers) {
  if (headers.subject !== SETTINGS_DRAFT_SUBJECT) {
    return false;
  }
  if (headers[SETTINGS_DRAFT_HEADER.toLowerCase()] === "1") {
    return true;
  }
  return String(headers.to || "").includes(SETTINGS_DRAFT_TO);
}

function buildSettingsRawEmail(settings) {
  const payload = {
    app: "gmail-kanban",
    version: EXPORT_VERSION,
    updatedAt: new Date().toISOString(),
    settings: serializeSettingsForDraft(settings)
  };

  return buildRawEmail(
    [
      ["To", SETTINGS_DRAFT_TO],
      ["Subject", SETTINGS_DRAFT_SUBJECT],
      [SETTINGS_DRAFT_HEADER, "1"]
    ],
    JSON.stringify(payload, null, 2)
  );
}

function serializeSettingsForDraft(settings) {
  return {
    rootLabelName: settings.rootLabelName || ROOT_LABEL_NAME,
    rootLabelId: settings.rootLabelId,
    updatedAt: settings.updatedAt,
    columnRows: normalizeColumnRows(settings.columnRows, settings.columns || []),
    columns: (settings.columns || []).map((column) => ({
      id: column.id,
      name: column.name,
      builtIn: Boolean(column.builtIn),
      labelId: column.labelId,
      labelName: column.labelName
    }))
  };
}

function isSettingsNewer(candidate, baseline) {
  const candidateTime = Date.parse(candidate?.updatedAt || "");
  const baselineTime = Date.parse(baseline?.updatedAt || "");
  if (!Number.isFinite(candidateTime)) {
    return false;
  }
  if (!Number.isFinite(baselineTime)) {
    return true;
  }
  return candidateTime > baselineTime;
}

function collectAllHeaders(headers) {
  const result = {};
  for (const header of headers) {
    result[String(header.name || "").toLowerCase()] = header.value || "";
  }
  return result;
}

function normalizeSettings(raw) {
  const sourceColumns = Array.isArray(raw?.columns) && raw.columns.length ? raw.columns : DEFAULT_COLUMNS;
  const columns = [];
  const seenNames = new Set();
  const seenIds = new Set();

  for (const item of sourceColumns) {
    try {
      const name = normalizeColumnName(item.name);
      const key = name.toLocaleLowerCase();
      if (seenNames.has(key)) {
        continue;
      }
      const id = normalizeColumnId(item.id, seenIds);
      seenNames.add(key);
      columns.push({
        id,
        name,
        builtIn: Boolean(item.builtIn),
        labelId: typeof item.labelId === "string" ? item.labelId : undefined,
        labelName: typeof item.labelName === "string" ? item.labelName : undefined
      });
    } catch (_error) {
      continue;
    }
  }

  return {
    rootLabelName: ROOT_LABEL_NAME,
    rootLabelId: typeof raw?.rootLabelId === "string" ? raw.rootLabelId : undefined,
    settingsDraftId: typeof raw?.settingsDraftId === "string" ? raw.settingsDraftId : undefined,
    columns: columns.length ? columns : DEFAULT_COLUMNS.map((column) => ({ ...column })),
    columnRows: normalizeColumnRows(raw?.columnRows, columns.length ? columns : DEFAULT_COLUMNS),
    updatedAt: typeof raw?.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
  };
}

function normalizeColumnRows(rows, columns) {
  const columnIds = new Set((columns || []).map((column) => column.id));
  const seenIds = new Set();
  const normalizedRows = [];

  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (!Array.isArray(row)) {
        continue;
      }
      const normalizedRow = [];
      for (const columnId of row) {
        if (columnIds.has(columnId) && !seenIds.has(columnId)) {
          normalizedRow.push(columnId);
          seenIds.add(columnId);
        }
      }
      if (normalizedRow.length) {
        normalizedRows.push(normalizedRow);
      }
    }
  }

  for (const column of columns || []) {
    if (!seenIds.has(column.id)) {
      normalizedRows.push([column.id]);
    }
  }

  return normalizedRows;
}

function normalizeColumnName(name) {
  const safeName = String(name || "").trim().replace(/\s+/g, " ");
  if (!safeName) {
    throw new Error("Column name is required.");
  }
  if (safeName.includes("/")) {
    throw new Error("Column name cannot contain '/'.");
  }
  if (safeName === ROOT_LABEL_NAME || safeName === LEGACY_ROOT_LABEL_NAME || safeName === "未分類") {
    throw new Error("This column name is reserved.");
  }
  if (safeName.length > 40) {
    throw new Error("Column name must be 40 characters or less.");
  }
  return safeName;
}

function ensureUniqueColumnName(columns, name, currentColumnId) {
  const key = name.toLocaleLowerCase();
  if (columns.some((column) => column.id !== currentColumnId && column.name.toLocaleLowerCase() === key)) {
    throw new Error("A column with this name already exists.");
  }
}

function normalizeColumnId(rawId, seenIds) {
  let id = typeof rawId === "string" && rawId.trim() ? rawId.trim() : createColumnId();
  if (id === UNCATEGORIZED_COLUMN_ID || seenIds.has(id)) {
    id = createColumnId();
  }
  while (seenIds.has(id)) {
    id = createColumnId();
  }
  seenIds.add(id);
  return id;
}

function createColumnId() {
  if (globalThis.crypto?.randomUUID) {
    return `col-${globalThis.crypto.randomUUID()}`;
  }
  return `col-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function saveSettings(settings) {
  const nextSettings = {
    ...settings,
    updatedAt: new Date().toISOString()
  };
  await storageSet({ [STORAGE_KEY]: nextSettings });
  return nextSettings;
}

function getAuthToken({ interactive = false } = {}) {
  if (chrome.identity?.getAuthToken) {
    return getChromeAuthToken({ interactive });
  }
  return getFirefoxAuthToken({ interactive });
}

function getChromeAuthToken({ interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!token) {
        reject(new Error("No OAuth token returned."));
        return;
      }
      resolve(token);
    });
  });
}

async function getFirefoxAuthToken({ interactive = false } = {}) {
  const cached = await getStoredFirefoxToken();
  if (cached?.accessToken && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  if (cached?.refreshToken) {
    try {
      const refreshed = await refreshFirefoxToken(cached.refreshToken);
      return refreshed.accessToken;
    } catch (_error) {
      await clearStoredFirefoxToken();
    }
  }

  if (!interactive) {
    throw new Error("Gmail authorization is required.");
  }

  const authorized = await authorizeFirefoxToken();
  return authorized.accessToken;
}

async function authorizeFirefoxToken() {
  const clientId = getFirefoxOAuthClientId();
  const clientSecret = getFirefoxOAuthClientSecret();
  const redirectUri = getFirefoxRedirectUri();
  const verifier = createPkceVerifier();
  const challenge = await createPkceChallenge(verifier);
  const state = createPkceVerifier();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state
  });

  const redirectUrl = await launchWebAuthFlow({
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    interactive: true
  });
  const resultUrl = new URL(redirectUrl);
  const error = resultUrl.searchParams.get("error");
  if (error) {
    throw new Error(error);
  }
  if (resultUrl.searchParams.get("state") !== state) {
    throw new Error("OAuth state mismatch.");
  }

  const code = resultUrl.searchParams.get("code");
  if (!code) {
    throw new Error("OAuth authorization code was not returned.");
  }

  return exchangeFirefoxCodeForToken({ clientId, clientSecret, redirectUri, code, verifier });
}

function launchWebAuthFlow(details) {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(details, (redirectUrl) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

async function exchangeFirefoxCodeForToken({ clientId, clientSecret, redirectUri, code, verifier }) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
      grant_type: "authorization_code"
    })
  });
  return storeFirefoxTokenResponse(response);
}

async function refreshFirefoxToken(refreshToken) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: getFirefoxOAuthClientId(),
      client_secret: getFirefoxOAuthClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });
  return storeFirefoxTokenResponse(response, refreshToken);
}

async function storeFirefoxTokenResponse(response, existingRefreshToken = "") {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.error || `OAuth token request failed: ${response.status}`);
  }

  const token = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || existingRefreshToken,
    expiresAt: Date.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000
  };
  if (!token.accessToken) {
    throw new Error("OAuth access token was not returned.");
  }
  await storageLocalSet({ [FIREFOX_TOKEN_KEY]: token });
  return token;
}

function getFirefoxOAuthClientId() {
  const clientId = chrome.runtime.getManifest().oauth2?.client_id || FIREFOX_OAUTH_CLIENT_ID;
  if (!clientId || clientId.includes("__REPLACE_WITH")) {
    throw new Error("Firefox Google OAuth client ID is not configured.");
  }
  return clientId;
}

function getFirefoxOAuthClientSecret() {
  const clientSecret = FIREFOX_OAUTH_CLIENT_SECRET;
  if (!clientSecret || clientSecret.includes("__REPLACE_WITH")) {
    throw new Error("Firefox Google OAuth client secret is not configured.");
  }
  return clientSecret;
}

function getFirefoxRedirectUri() {
  const redirectUrl = new URL(chrome.identity.getRedirectURL());
  const subdomain = redirectUrl.hostname.split(".")[0];
  if (!subdomain) {
    throw new Error("Firefox OAuth redirect URL could not be determined.");
  }
  return `http://127.0.0.1/mozoauth2/${subdomain}`;
}

async function getStoredFirefoxToken() {
  const result = await storageLocalGet(FIREFOX_TOKEN_KEY);
  return result[FIREFOX_TOKEN_KEY] || null;
}

function clearStoredFirefoxToken() {
  return storageLocalRemove(FIREFOX_TOKEN_KEY);
}

function createPkceVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncodeBytes(bytes);
}

async function createPkceChallenge(verifier) {
  const bytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncodeBytes(new Uint8Array(digest));
}

function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function removeCachedToken(token) {
  if (!chrome.identity?.getAuthToken) {
    const cached = await getStoredFirefoxToken();
    if (!cached || cached.accessToken === token) {
      await clearStoredFirefoxToken();
    }
    return;
  }

  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

function storageGet(key) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(key, resolve);
  });
}

function storageSet(value) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(value, resolve);
  });
}

function storageLocalGet(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, resolve);
  });
}

function storageLocalSet(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, resolve);
  });
}

function storageLocalRemove(key) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(key, resolve);
  });
}

function normalizeError(error) {
  return error instanceof Error ? error.message : String(error);
}
