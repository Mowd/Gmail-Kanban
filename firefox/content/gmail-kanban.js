(() => {
  const APP_HASH = "gkanban";
  const APP_QUERY = "gkanban";
  const UNCATEGORIZED_COLUMN_ID = "__uncategorized";
  const ARCHIVE_COLUMN_ID = "to-archive";
  const DELETE_COLUMN_ID = "to-delete";
  const PAGE_SIZE = 80;
  const UPDATE_PAGE_SIZE = 20;
  const UPDATE_POLL_MS = 60_000;
  const SESSION_KEY = "gkanban.open";
  const DETAIL_WIDTH_KEY = "gkanban.detailWidth";
  const ROOT_ID = "gkanban-root";
  const NAV_ID = "gkanban-nav-link";
  const LAUNCHER_ID = "gkanban-launcher";
  const FALLBACK_NAV_CLASS = "gkanban-nav-fallback";
  const state = {
    board: null,
    detailMessage: null,
    loading: false,
    loadingMore: false,
    loadedOnce: false,
    draggedMessageId: null,
    draggedColumnId: null,
    dragEndedAt: 0,
    loadedMessageIds: new Set(),
    nextPageToken: "",
    updateTimer: 0,
    updateRunning: false,
    statusNotice: ""
  };

  init();

  function init() {
    ensureShell();
    ensureNavLink();
    ensureLauncherButton();
    syncRoute();

    window.addEventListener("hashchange", syncRoute);
    const observer = new MutationObserver(() => {
      ensureNavLink();
      ensureLauncherButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function syncRoute() {
    const isHashRoute = getRouteHash().startsWith(APP_HASH);
    if (isHashRoute) {
      sessionStorage.setItem(SESSION_KEY, "1");
      replaceQueryFlag(true);
    }

    const isKanbanRoute = isHashRoute || hasQueryFlag() || sessionStorage.getItem(SESSION_KEY) === "1";
    if (isKanbanRoute) {
      showKanban();
    } else {
      hideKanban();
    }
  }

  function getRouteHash() {
    return window.location.hash.replace(/^#/, "");
  }

  async function showKanban() {
    const root = ensureShell();
    root.hidden = false;
    setLauncherVisible(false);
    document.documentElement.classList.add("gkanban-open");
    if (!state.loadedOnce) {
      await loadBoard({ interactive: false });
    }
    startUpdatePolling();
  }

  function hideKanban() {
    const root = document.getElementById(ROOT_ID);
    if (root) {
      root.hidden = true;
    }
    setLauncherVisible(true);
    document.documentElement.classList.remove("gkanban-open");
    stopUpdatePolling();
  }

  async function loadBoard({ interactive }) {
    if (state.loading) {
      return;
    }

    state.loading = true;
    renderLoading();

    try {
      state.board = await sendMessage("GKANBAN_GET_BOARD", { interactive, maxResults: PAGE_SIZE });
      state.nextPageToken = state.board.nextPageToken || "";
      state.loadedMessageIds = collectLoadedMessageIds(state.board);
      state.statusNotice = "";
      renderBoard();
      startUpdatePolling();
    } catch (error) {
      renderError(error);
    } finally {
      state.loading = false;
    }
  }

  function ensureShell() {
    let root = document.getElementById(ROOT_ID);
    if (root) {
      return root;
    }

    root = document.createElement("section");
    root.id = ROOT_ID;
    root.hidden = true;
    root.innerHTML = `
      <header class="gkanban-header">
        <div>
          <h1>Gmail Kanban</h1>
          <p id="gkanban-status">尚未同步</p>
        </div>
        <div class="gkanban-actions">
          <button type="button" data-action="refresh" title="重新整理">重新整理</button>
          <button type="button" data-action="add-column" title="新增看板">新增看板</button>
          <button type="button" data-action="options" title="開啟設定">設定</button>
          <button type="button" data-action="close" title="回到 Gmail">關閉</button>
        </div>
      </header>
      <main id="gkanban-board" class="gkanban-board" aria-live="polite"></main>
      <aside id="gkanban-detail" class="gkanban-detail" hidden></aside>
    `;
    root.addEventListener("click", handleRootClick);
    root.addEventListener("focusin", handleRootFocusIn);
    root.addEventListener("input", handleRootInput);
    document.body.appendChild(root);
    return root;
  }

  function ensureNavLink() {
    if (!document.body) {
      return;
    }

    let navLink = document.getElementById(NAV_ID);
    const inboxAnchor = findInboxAnchor();
    const targetRow = inboxAnchor ? findNavRow(inboxAnchor) : null;

    if (!navLink) {
      navLink = document.createElement("button");
      navLink.id = NAV_ID;
      navLink.type = "button";
      navLink.className = "gkanban-nav-link";
      navLink.textContent = "Kanban";
      navLink.addEventListener("click", () => {
        openKanban();
      });
    }

    if (targetRow?.parentElement) {
      navLink.classList.remove(FALLBACK_NAV_CLASS);
      if (navLink.nextSibling !== targetRow) {
        targetRow.parentElement.insertBefore(navLink, targetRow);
      }
      return;
    }

    if (!targetRow && !navLink.parentElement) {
      navLink.classList.add(FALLBACK_NAV_CLASS);
      document.body.appendChild(navLink);
    }
  }

  function ensureLauncherButton() {
    if (!document.body) {
      return;
    }

    let launcher = document.getElementById(LAUNCHER_ID);
    if (!launcher) {
      launcher = document.createElement("button");
      launcher.id = LAUNCHER_ID;
      launcher.type = "button";
      launcher.className = "gkanban-launcher";
      launcher.textContent = "Kanban";
      launcher.title = "開啟 Gmail Kanban";
      launcher.addEventListener("click", openKanban);
      document.body.appendChild(launcher);
    }

    setLauncherVisible(!isKanbanOpen());
  }

  function setLauncherVisible(visible) {
    const launcher = document.getElementById(LAUNCHER_ID);
    if (launcher) {
      launcher.hidden = !visible;
    }
  }

  function isKanbanOpen() {
    return !document.getElementById(ROOT_ID)?.hidden;
  }

  function findInboxAnchor() {
    const anchors = Array.from(document.querySelectorAll("a[href*='#inbox'], a[href$='/inbox']"));
    return anchors.find((anchor) => {
      const href = anchor.getAttribute("href") || "";
      return href.includes("#inbox") || href.endsWith("/inbox");
    });
  }

  function findNavRow(anchor) {
    return anchor.closest("[role='link'], [role='treeitem'], .TO, .TN, .aim, .aio") || anchor.parentElement;
  }

  async function handleRootClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      const card = event.target.closest("[data-open-message]");
      if (card) {
        if (Date.now() - state.dragEndedAt < 250) {
          return;
        }
        openMessage(card.dataset.openMessage);
      }
      return;
    }

    const action = button.dataset.action;
    if (action === "refresh") {
      await loadBoard({ interactive: false });
    }
    if (action === "add-column") {
      await addColumn();
    }
    if (action === "delete-column") {
      await deleteColumn(button.dataset.columnId, button.dataset.columnName);
    }
    if (action === "quick-move") {
      await quickMoveMessage(button.dataset.messageId, button.dataset.targetColumnId);
    }
    if (action === "bulk-archive") {
      await bulkArchiveColumn(button.dataset.columnId);
    }
    if (action === "bulk-trash") {
      await bulkTrashColumn(button.dataset.columnId);
    }
    if (action === "options") {
      await sendMessage("GKANBAN_OPEN_OPTIONS");
    }
    if (action === "close") {
      leaveKanban("inbox");
    }
    if (action === "close-detail") {
      closeDetail();
    }
    if (action === "detail-move") {
      await moveDetailMessage();
    }
    if (action === "detail-archive") {
      await archiveDetailMessage();
    }
    if (action === "detail-trash") {
      await trashDetailMessage();
    }
    if (action === "open-attachment") {
      await openAttachment(Number(button.dataset.attachmentIndex));
    }
    if (action === "send-reply") {
      await sendReply();
    }
    if (action === "send-forward") {
      await sendForward();
    }
  }

  function handleRootFocusIn(event) {
    const textarea = event.target.closest(".gkanban-compose textarea");
    if (textarea) {
      expandComposeTextarea(textarea);
    }
  }

  function handleRootInput(event) {
    const textarea = event.target.closest(".gkanban-compose textarea");
    if (textarea) {
      expandComposeTextarea(textarea);
    }
  }

  async function addColumn() {
    const name = window.prompt("新增 Kanban board 名稱");
    if (!name) {
      return;
    }

    try {
      setStatus("正在建立看板...");
      const settings = await sendMessage("GKANBAN_ADD_COLUMN", { name });
      mergeSettingsColumns(settings);
      setStatus("看板已建立。");
    } catch (error) {
      renderError(error);
    }
  }

  async function deleteColumn(columnId, columnName) {
    const confirmed = window.confirm(`刪除「${columnName}」看板與對應 Gmail label？郵件本身不會被刪除。`);
    if (!confirmed) {
      return;
    }

    try {
      setStatus("正在刪除看板...");
      await sendMessage("GKANBAN_DELETE_COLUMN", { columnId });
      deleteColumnFromState(columnId);
      setStatus("看板已刪除。");
    } catch (error) {
      renderError(error);
    }
  }

  function renderLoading() {
    const board = document.getElementById("gkanban-board");
    if (!board) {
      return;
    }
    setStatus("正在載入收件匣...");
    if (state.loadedOnce && state.board) {
      board.classList.add("gkanban-board-busy");
      return;
    }

    board.classList.remove("gkanban-board-busy");
    board.innerHTML = "";
    for (const columnName of ["未分類", "處理中", "待封存", "待刪除"]) {
      const row = document.createElement("div");
      row.className = "gkanban-board-row";
      row.appendChild(renderLoadingColumn(columnName));
      board.appendChild(row);
    }
  }

  function renderLoadingColumn(columnName) {
    const column = document.createElement("section");
    column.className = "gkanban-column gkanban-column-loading";

    const header = document.createElement("header");
    header.className = "gkanban-column-header";

    const titleWrap = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = columnName;
    const count = document.createElement("span");
    count.textContent = "0";
    titleWrap.append(title, count);
    header.appendChild(titleWrap);

    const list = document.createElement("div");
    list.className = "gkanban-card-list";
    const loading = document.createElement("div");
    loading.className = "gkanban-loading-card";
    const spinner = document.createElement("span");
    spinner.className = "gkanban-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = "正在載入郵件";
    loading.append(spinner, label);
    list.appendChild(loading);

    column.append(header, list);
    return column;
  }

  function renderError(error) {
    const board = document.getElementById("gkanban-board");
    if (!board) {
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    setStatus("需要處理。");
    board.classList.remove("gkanban-board-busy");
    board.innerHTML = "";
    const stateBlock = document.createElement("div");
    stateBlock.className = "gkanban-state gkanban-error";

    const title = document.createElement("strong");
    title.textContent = "Gmail Kanban 尚未就緒";
    const detail = document.createElement("p");
    detail.textContent = message;

    const authButton = document.createElement("button");
    authButton.type = "button";
    authButton.textContent = "授權 Gmail";
    authButton.addEventListener("click", async () => {
      try {
        setStatus("正在授權 Gmail...");
        await sendMessage("GKANBAN_AUTH");
        await loadBoard({ interactive: true });
      } catch (authError) {
        renderError(authError);
      }
    });

    stateBlock.append(title, detail, authButton);
    board.appendChild(stateBlock);
  }

  function renderBoard() {
    const board = document.getElementById("gkanban-board");
    if (!board || !state.board) {
      return;
    }

    board.innerHTML = "";
    board.classList.remove("gkanban-board-busy");
    state.loadedOnce = true;
    updateBoardStatus();

    for (const row of getBoardRows()) {
      board.appendChild(renderBoardRow(row));
    }
  }

  function renderBoardRow(columns) {
    const row = document.createElement("div");
    row.className = "gkanban-board-row";
    for (const column of columns) {
      row.appendChild(renderColumn(column));
    }
    return row;
  }

  function getBoardRows() {
    const columnsById = new Map((state.board?.columns || []).map((column) => [column.id, column]));
    const rows = [];
    const uncategorized = columnsById.get(UNCATEGORIZED_COLUMN_ID);
    if (uncategorized) {
      rows.push([uncategorized]);
    }

    const seenIds = new Set([UNCATEGORIZED_COLUMN_ID]);
    for (const rowIds of state.board?.columnRows || []) {
      const row = [];
      for (const columnId of rowIds) {
        const column = columnsById.get(columnId);
        if (column && !column.virtual && !seenIds.has(column.id)) {
          row.push(column);
          seenIds.add(column.id);
        }
      }
      if (row.length) {
        rows.push(row);
      }
    }

    for (const column of state.board?.columns || []) {
      if (!column.virtual && !seenIds.has(column.id)) {
        rows.push([column]);
        seenIds.add(column.id);
      }
    }
    return rows;
  }

  function updateBoardStatus() {
    if (!state.board) {
      return;
    }

    const fetchedTime = new Date(state.board.fetchedAt).toLocaleTimeString();
    const loaded = state.loadedMessageIds?.size || state.board.loadedMessageCount || 0;
    const estimated = Number(state.board.resultSizeEstimate) || loaded;
    const suffix = state.nextPageToken ? ` · 已載入 ${loaded}/${estimated} 封` : ` · 已載入 ${loaded} 封`;
    const prefix = state.statusNotice ? `${state.statusNotice} · ` : "";
    setStatus(`${prefix}已同步 ${fetchedTime}${suffix}`);
  }

  function renderColumn(column) {
    const columnElement = document.createElement("section");
    columnElement.className = "gkanban-column";
    columnElement.dataset.columnId = column.id;

    const header = document.createElement("header");
    header.className = "gkanban-column-header";
    if (!column.virtual) {
      columnElement.dataset.columnDragId = column.id;
      columnElement.addEventListener("dragover", handleColumnDragOver);
      columnElement.addEventListener("dragleave", handleColumnDragLeave);
      columnElement.addEventListener("drop", handleColumnDrop);
      header.draggable = true;
      header.dataset.columnDragId = column.id;
      header.addEventListener("dragstart", handleColumnDragStart);
      header.addEventListener("dragend", handleColumnDragEnd);
    }

    const titleWrap = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = column.name;
    if (!column.virtual) {
      title.tabIndex = 0;
      title.className = "gkanban-column-title-editable";
      title.title = "點擊編輯名稱";
      title.addEventListener("click", (event) => {
        event.stopPropagation();
        startColumnRename(column.id);
      });
      title.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          startColumnRename(column.id);
        }
      });
    }
    const count = document.createElement("span");
    count.textContent = `${column.messages.length}`;
    titleWrap.append(title, count);

    const actions = document.createElement("div");
    actions.className = "gkanban-column-actions";

    if (isArchiveColumn(column)) {
      actions.appendChild(renderColumnActionButton("bulk-archive", "封存全部", column));
    } else if (isDeleteColumn(column)) {
      actions.appendChild(renderColumnActionButton("bulk-trash", "清空", column));
    } else if (!column.virtual) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.dataset.action = "delete-column";
      deleteButton.dataset.columnId = column.id;
      deleteButton.dataset.columnName = column.name;
      deleteButton.title = "刪除看板";
      deleteButton.textContent = "刪除";
      actions.appendChild(deleteButton);
    }
    header.append(titleWrap, actions);

    const list = document.createElement("div");
    list.className = "gkanban-card-list";
    list.addEventListener("scroll", handleCardListScroll);
    list.addEventListener("dragover", (event) => {
      if (state.draggedColumnId) {
        return;
      }
      event.preventDefault();
      columnElement.classList.add("gkanban-column-over");
    });
    list.addEventListener("dragleave", () => columnElement.classList.remove("gkanban-column-over"));
    list.addEventListener("drop", (event) => handleDrop(event, column.id, columnElement));

    if (column.messages.length) {
      for (const message of column.messages) {
        list.appendChild(renderCard(message, column));
      }
    } else {
      list.appendChild(renderEmptyState());
    }

    columnElement.append(header, list);
    return columnElement;
  }

  function handleCardListScroll(event) {
    const list = event.currentTarget;
    const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 240;
    if (nearBottom) {
      const columnId = list.closest(".gkanban-column")?.dataset.columnId || "";
      loadMoreMessages(columnId);
    }
  }

  async function loadMoreMessages(triggerColumnId = "") {
    if (state.loadingMore || !state.nextPageToken) {
      return;
    }

    state.loadingMore = true;
    showLoadMoreIndicator(triggerColumnId);
    setStatus("正在載入更多郵件...");

    try {
      const page = await sendMessage("GKANBAN_LOAD_MORE", {
        interactive: false,
        maxResults: PAGE_SIZE,
        pageToken: state.nextPageToken
      });
      appendBoardPage(page);
      state.nextPageToken = page.nextPageToken || "";
      updateBoardStatus();
    } catch (error) {
      setStatus(`無法載入更多郵件：${getErrorMessage(error)}`);
    } finally {
      removeLoadMoreIndicators();
      state.loadingMore = false;
    }
  }

  function showLoadMoreIndicator(columnId) {
    removeLoadMoreIndicators();
    const list = columnId ? getColumnListElement(columnId) : null;
    if (!list) {
      return;
    }

    const indicator = document.createElement("div");
    indicator.className = "gkanban-load-more";
    indicator.dataset.loadingMore = "1";
    const spinner = document.createElement("span");
    spinner.className = "gkanban-load-more-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = "正在載入更多郵件...";
    indicator.append(spinner, label);
    list.appendChild(indicator);
  }

  function removeLoadMoreIndicators() {
    document.querySelectorAll("[data-loading-more='1']").forEach((node) => {
      node.remove();
    });
  }

  function startUpdatePolling() {
    if (state.updateTimer || !state.loadedOnce) {
      return;
    }

    state.updateTimer = window.setInterval(() => {
      pollInboxUpdates();
    }, UPDATE_POLL_MS);
  }

  function stopUpdatePolling() {
    if (state.updateTimer) {
      window.clearInterval(state.updateTimer);
      state.updateTimer = 0;
    }
  }

  async function pollInboxUpdates() {
    if (state.updateRunning || state.loading || !state.board || document.getElementById(ROOT_ID)?.hidden) {
      return;
    }

    state.updateRunning = true;
    try {
      const page = await sendMessage("GKANBAN_CHECK_INBOX_UPDATES", {
        maxResults: UPDATE_PAGE_SIZE
      });
      const newMessages = (page.messages || []).filter((message) => !state.loadedMessageIds.has(message.id));
      if (newMessages.length) {
        prependNewMessages(newMessages);
        state.board.fetchedAt = new Date().toISOString();
        state.board.resultSizeEstimate = Math.max(
          Number(state.board.resultSizeEstimate) || 0,
          Number(page.resultSizeEstimate) || 0,
          state.loadedMessageIds.size
        );
        state.statusNotice = `有 ${newMessages.length} 封新信已加入`;
        updateBoardStatus();
      }
    } catch (error) {
      state.statusNotice = `無法檢查新信：${getErrorMessage(error)}`;
      updateBoardStatus();
    } finally {
      state.updateRunning = false;
    }
  }

  function prependNewMessages(messages) {
    for (const message of messages.reverse()) {
      const column = getColumnForMessage(message);
      if (!column) {
        continue;
      }
      state.loadedMessageIds.add(message.id);
      column.messages.unshift(message);
      prependCardToColumn(column, message);
    }
    state.board.loadedMessageCount = state.loadedMessageIds.size;
  }

  function prependCardToColumn(column, message) {
    const list = getColumnListElement(column.id);
    if (!list) {
      renderColumnsById([column.id]);
      return;
    }

    list.querySelector(".gkanban-empty")?.remove();
    list.prepend(renderCard(message, column));
    updateColumnCount(column.id);
  }

  function appendBoardPage(page) {
    const existingColumns = new Map((state.board?.columns || []).map((column) => [column.id, column]));

    for (const incomingColumn of page.columns || []) {
      const targetColumn = existingColumns.get(incomingColumn.id);
      if (!targetColumn) {
        continue;
      }

      for (const message of incomingColumn.messages || []) {
        if (state.loadedMessageIds.has(message.id)) {
          continue;
        }
        state.loadedMessageIds.add(message.id);
        targetColumn.messages.push(message);
        appendCardToColumn(targetColumn, message);
      }
    }

    state.board.loadedMessageCount = state.loadedMessageIds.size;
    state.board.resultSizeEstimate = Math.max(
      Number(state.board.resultSizeEstimate) || 0,
      Number(page.resultSizeEstimate) || 0
    );
  }

  function appendCardToColumn(column, message) {
    const columnElement = document.querySelector(`.gkanban-column[data-column-id="${CSS.escape(column.id)}"]`);
    const list = columnElement?.querySelector(".gkanban-card-list");
    if (!columnElement || !list) {
      renderColumnsById([column.id]);
      return;
    }

    list.querySelector(".gkanban-empty")?.remove();
    list.appendChild(renderCard(message, column));
    updateColumnCount(column.id);
  }

  function renderEmptyState() {
    const empty = document.createElement("div");
    empty.className = "gkanban-empty";
    empty.textContent = "沒有郵件";
    return empty;
  }

  function updateColumnCount(columnId) {
    const column = getColumnById(columnId);
    const count = document.querySelector(`.gkanban-column[data-column-id="${CSS.escape(columnId)}"] .gkanban-column-header span`);
    if (column && count) {
      count.textContent = `${column.messages.length}`;
    }
    updateColumnActionState(columnId);
  }

  function updateColumnActionState(columnId) {
    const column = getColumnById(columnId);
    if (!column) {
      return;
    }

    const selector = `.gkanban-column[data-column-id="${CSS.escape(columnId)}"] button[data-action="bulk-archive"], .gkanban-column[data-column-id="${CSS.escape(columnId)}"] button[data-action="bulk-trash"]`;
    const button = document.querySelector(selector);
    if (button) {
      button.disabled = !column.messages.length;
    }
  }

  function renderColumnActionButton(action, label, column, disabled = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = action;
    button.dataset.columnId = column.id;
    button.dataset.columnName = column.name;
    button.disabled = disabled || (["bulk-archive", "bulk-trash"].includes(action) && !column.messages.length);
    button.textContent = label;
    return button;
  }

  function startColumnRename(columnId) {
    const column = getColumnById(columnId);
    const title = document.querySelector(`.gkanban-column[data-column-id="${CSS.escape(columnId)}"] h2`);
    if (!column || !title || title.dataset.editing === "1") {
      return;
    }

    title.dataset.editing = "1";
    const input = document.createElement("input");
    input.className = "gkanban-column-title-input";
    input.value = column.name;
    input.setAttribute("aria-label", "看板名稱");
    title.replaceWith(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = async (shouldSave) => {
      if (finished) {
        return;
      }
      finished = true;
      const nextName = input.value.trim();
      if (!shouldSave || !nextName || nextName === column.name) {
        renderColumnsById([columnId]);
        return;
      }

      try {
        setStatus("正在更新看板名稱...");
        const settings = await sendMessage("GKANBAN_RENAME_COLUMN", {
          columnId,
          name: nextName
        });
        applyColumnSettings(settings.columns || []);
        setStatus("看板名稱已更新。");
      } catch (error) {
        renderColumnsById([columnId]);
        setStatus(`無法更新看板名稱：${getErrorMessage(error)}`);
      }
    };

    input.addEventListener("blur", () => {
      finish(true);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
  }

  function handleColumnDragStart(event) {
    if (event.target.closest("button,input,textarea,select,a")) {
      event.preventDefault();
      return;
    }

    const columnId = event.currentTarget.dataset.columnDragId;
    if (!columnId) {
      return;
    }
    state.draggedColumnId = columnId;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/x-gkanban-column", columnId);
    event.currentTarget.closest(".gkanban-column")?.classList.add("gkanban-column-dragging");
  }

  function handleColumnDragOver(event) {
    const targetColumnId = event.currentTarget.dataset.columnDragId;
    if (!state.draggedColumnId || !targetColumnId || state.draggedColumnId === targetColumnId) {
      return;
    }

    event.preventDefault();
    const column = event.currentTarget.closest(".gkanban-column");
    const dropMode = getColumnDropMode(event, event.currentTarget);
    column?.classList.add("gkanban-column-order-over");
    column?.classList.toggle("gkanban-column-order-after", dropMode === "same-row-after");
    column?.classList.toggle("gkanban-column-order-row", dropMode === "own-row-before");
  }

  function handleColumnDragLeave(event) {
    if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget)) {
      return;
    }
    const column = event.currentTarget.closest(".gkanban-column");
    column?.classList.remove("gkanban-column-order-over", "gkanban-column-order-after", "gkanban-column-order-row");
  }

  async function handleColumnDrop(event) {
    const targetColumnId = event.currentTarget.dataset.columnDragId;
    const draggedColumnId = state.draggedColumnId || event.dataTransfer.getData("text/x-gkanban-column");
    cleanupColumnDragClasses();
    if (!draggedColumnId || !targetColumnId || draggedColumnId === targetColumnId) {
      return;
    }

    event.preventDefault();
    const previousOrder = state.board.columns.map((column) => column.id);
    const previousRows = cloneColumnRows(state.board.columnRows);
    reorderColumnInState(draggedColumnId, targetColumnId, getColumnDropMode(event, event.currentTarget));

    try {
      await saveColumnOrder();
      setStatus("看板順序已更新。");
    } catch (error) {
      state.board.columnRows = previousRows;
      restoreColumnOrder(previousOrder);
      setStatus(`無法更新看板順序：${getErrorMessage(error)}`);
    }
  }

  function handleColumnDragEnd() {
    state.draggedColumnId = null;
    cleanupColumnDragClasses();
  }

  function getColumnDropMode(event, element) {
    const rect = element.getBoundingClientRect();
    const yRatio = (event.clientY - rect.top) / rect.height;
    if (yRatio >= 0.5) {
      return "same-row-after";
    }
    return "own-row-before";
  }

  function reorderColumnInState(draggedColumnId, targetColumnId, dropMode) {
    const columns = state.board?.columns || [];
    const draggedIndex = columns.findIndex((column) => column.id === draggedColumnId);
    const targetIndex = columns.findIndex((column) => column.id === targetColumnId);
    if (draggedIndex < 0 || targetIndex < 0) {
      return;
    }

    const [draggedColumn] = columns.splice(draggedIndex, 1);
    const adjustedTargetIndex = columns.findIndex((column) => column.id === targetColumnId);
    columns.splice(adjustedTargetIndex + 1, 0, draggedColumn);
    state.board.columnRows = moveColumnInRows(draggedColumnId, targetColumnId, dropMode);
    renderBoard();
  }

  function moveColumnInRows(draggedColumnId, targetColumnId, dropMode) {
    const rows = normalizeBoardRows(state.board?.columnRows);
    const withoutDragged = rows
      .map((row) => row.filter((columnId) => columnId !== draggedColumnId))
      .filter((row) => row.length);
    const targetRowIndex = withoutDragged.findIndex((row) => row.includes(targetColumnId));
    if (targetRowIndex < 0) {
      return [...withoutDragged, [draggedColumnId]];
    }

    if (dropMode === "same-row-after") {
      const row = withoutDragged[targetRowIndex];
      const targetIndex = row.indexOf(targetColumnId);
      row.splice(targetIndex + 1, 0, draggedColumnId);
      return withoutDragged;
    }

    withoutDragged.splice(targetRowIndex, 0, [draggedColumnId]);
    return withoutDragged;
  }

  function normalizeBoardRows(rows = state.board?.columnRows) {
    const movableIds = new Set(getMovableColumns().map((column) => column.id));
    const seenIds = new Set();
    const normalized = [];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (!Array.isArray(row)) {
          continue;
        }
        const normalizedRow = row.filter((columnId) => {
          if (!movableIds.has(columnId) || seenIds.has(columnId)) {
            return false;
          }
          seenIds.add(columnId);
          return true;
        });
        if (normalizedRow.length) {
          normalized.push(normalizedRow);
        }
      }
    }
    for (const column of getMovableColumns()) {
      if (!seenIds.has(column.id)) {
        normalized.push([column.id]);
      }
    }
    return normalized;
  }

  function cloneColumnRows(rows) {
    return (rows || []).map((row) => [...row]);
  }

  async function saveColumnOrder() {
    const columnIds = getMovableColumns().map((column) => column.id);
    const settings = await sendMessage("GKANBAN_SET_COLUMN_ORDER", {
      columnIds,
      columnRows: normalizeBoardRows()
    });
    state.board.columnRows = settings.columnRows || normalizeBoardRows();
    applyColumnOrder(settings.columns || []);
  }

  function restoreColumnOrder(columnIds) {
    const columnsById = new Map((state.board?.columns || []).map((column) => [column.id, column]));
    state.board.columns = columnIds.map((columnId) => columnsById.get(columnId)).filter(Boolean);
    renderBoard();
  }

  function cleanupColumnDragClasses() {
    document.querySelectorAll(".gkanban-column-dragging, .gkanban-column-order-over, .gkanban-column-order-after, .gkanban-column-order-row").forEach((node) => {
      node.classList.remove("gkanban-column-dragging", "gkanban-column-order-over", "gkanban-column-order-after", "gkanban-column-order-row");
    });
  }

  function renderCard(message, column) {
    const card = document.createElement("article");
    card.className = `gkanban-card${message.unread ? " gkanban-card-unread" : ""}`;
    if (column?.id === UNCATEGORIZED_COLUMN_ID) {
      card.classList.add("gkanban-card-quick");
    }
    card.draggable = true;
    card.dataset.messageId = message.id;
    card.dataset.openMessage = message.id;

    const subject = document.createElement("h3");
    subject.textContent = message.subject || "(no subject)";
    const meta = document.createElement("p");
    meta.className = "gkanban-card-meta";
    meta.textContent = compactSender(message.from);
    const snippet = document.createElement("p");
    snippet.className = "gkanban-card-snippet";
    snippet.textContent = message.snippet || "";
    const date = document.createElement("time");
    date.textContent = formatMessageDate(message.date);

    card.append(subject, meta, snippet, date);
    if (column?.id === UNCATEGORIZED_COLUMN_ID) {
      card.appendChild(renderQuickActions(message));
    }
    card.addEventListener("dragstart", (event) => {
      if (event.target.closest("button")) {
        event.preventDefault();
        return;
      }
      state.draggedMessageId = message.id;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", message.id);
      card.classList.add("gkanban-card-dragging");
    });
    card.addEventListener("dragend", () => {
      state.draggedMessageId = null;
      state.dragEndedAt = Date.now();
      card.classList.remove("gkanban-card-dragging");
    });
    card.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      if (Date.now() - state.dragEndedAt < 250) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      openMessage(message.id);
    });
    return card;
  }

  function renderQuickActions(message) {
    const actions = document.createElement("div");
    actions.className = "gkanban-card-actions";

    const archiveColumn = getArchiveColumn();
    const deleteColumn = getDeleteColumn();
    if (archiveColumn) {
      actions.appendChild(renderQuickMoveButton(message, archiveColumn, "archive", "移到待封存"));
    }
    if (deleteColumn) {
      actions.appendChild(renderQuickMoveButton(message, deleteColumn, "trash", "移到待刪除"));
    }
    return actions;
  }

  function renderQuickMoveButton(message, targetColumn, icon, title) {
    const button = document.createElement("button");
    button.type = "button";
    button.draggable = false;
    button.dataset.action = "quick-move";
    button.dataset.messageId = message.id;
    button.dataset.targetColumnId = targetColumn.id;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.appendChild(renderIcon(icon));
    return button;
  }

  function renderIcon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "15");
    svg.setAttribute("height", "15");
    svg.setAttribute("aria-hidden", "true");

    const paths = {
      archive: [
        "M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8",
        "M3 3h18v5H3z",
        "M10 12h4"
      ],
      trash: [
        "M3 6h18",
        "M8 6V4h8v2",
        "M19 6l-1 15H6L5 6",
        "M10 11v6",
        "M14 11v6"
      ],
      close: [
        "M18 6 6 18",
        "M6 6l12 12"
      ]
    };

    for (const d of paths[name] || []) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      svg.appendChild(path);
    }
    return svg;
  }

  async function handleDrop(event, targetColumnId, columnElement) {
    if (state.draggedColumnId) {
      return;
    }
    event.preventDefault();
    columnElement.classList.remove("gkanban-column-over");
    const messageId = event.dataTransfer.getData("text/plain") || state.draggedMessageId;
    if (!messageId) {
      return;
    }

    const sourceColumn = findMessageColumn(messageId);
    if (sourceColumn?.id === targetColumnId) {
      return;
    }

    await moveMessageWithOptimisticUi(messageId, targetColumnId, {
      pendingStatus: "郵件已移動，正在同步 Gmail...",
      successStatus: "郵件已移動。",
      errorPrefix: "無法移動郵件"
    });
    state.draggedMessageId = null;
    state.dragEndedAt = Date.now();
  }

  async function quickMoveMessage(messageId, targetColumnId) {
    if (!messageId || !targetColumnId) {
      return;
    }

    await moveMessageWithOptimisticUi(messageId, targetColumnId, {
      pendingStatus: "郵件已移動，正在同步 Gmail...",
      successStatus: "郵件已移動。",
      errorPrefix: "無法移動郵件"
    });
  }

  async function moveMessageWithOptimisticUi(messageId, targetColumnId, options = {}) {
    const sourceColumn = findMessageColumn(messageId);
    const targetColumn = getColumnById(targetColumnId);
    if (!sourceColumn || !targetColumn || sourceColumn.id === targetColumn.id) {
      return false;
    }

    moveMessageInState(messageId, targetColumnId);
    setStatus(options.pendingStatus || "正在同步 Gmail...");

    try {
      await sendMessage("GKANBAN_MOVE_MESSAGE", { messageId, targetColumnId });
      setStatus(options.successStatus || "已同步 Gmail。");
      return true;
    } catch (error) {
      moveMessageInState(messageId, sourceColumn.id);
      setStatus(`${options.errorPrefix || "操作失敗"}：${getErrorMessage(error)}`);
      return false;
    }
  }

  async function bulkArchiveColumn(columnId) {
    const column = getColumnById(columnId);
    if (!column?.messages.length) {
      return;
    }

    const confirmed = window.confirm(`封存「${column.name}」中的 ${column.messages.length} 封郵件？`);
    if (!confirmed) {
      return;
    }

    const messageIds = column.messages.map((message) => message.id);
    try {
      setStatus("正在封存郵件...");
      await sendMessage("GKANBAN_BULK_ARCHIVE", { messageIds });
      removeMessagesFromColumn(columnId, messageIds);
      closeDetailIfIncluded(messageIds);
      setStatus(`已封存 ${messageIds.length} 封郵件。`);
    } catch (error) {
      setStatus(`無法封存郵件：${getErrorMessage(error)}`);
    }
  }

  async function bulkTrashColumn(columnId) {
    const column = getColumnById(columnId);
    if (!column?.messages.length) {
      return;
    }

    const confirmed = window.confirm(`將「${column.name}」中的 ${column.messages.length} 封郵件移到垃圾桶？`);
    if (!confirmed) {
      return;
    }

    const messageIds = column.messages.map((message) => message.id);
    try {
      setStatus("正在移到垃圾桶...");
      await sendMessage("GKANBAN_BULK_TRASH", { messageIds });
      removeMessagesFromColumn(columnId, messageIds);
      closeDetailIfIncluded(messageIds);
      setStatus(`已移到垃圾桶 ${messageIds.length} 封郵件。`);
    } catch (error) {
      setStatus(`無法移到垃圾桶：${getErrorMessage(error)}`);
    }
  }

  async function openMessage(messageId) {
    if (!messageId) {
      return;
    }

    const detail = ensureDetailPanel();
    detail.hidden = false;
    applyStoredDetailWidth(detail);
    detail.innerHTML = "";
    detail.appendChild(renderResizeHandle());
    const loadingState = document.createElement("div");
    loadingState.className = "gkanban-detail-state";
    const loadingText = document.createElement("strong");
    loadingText.textContent = "正在讀取郵件";
    loadingState.appendChild(loadingText);
    detail.appendChild(loadingState);

    try {
      const message = await sendMessage("GKANBAN_GET_MESSAGE", { messageId, markRead: true });
      state.detailMessage = message;
      markCardRead(messageId);
      renderMessageDetail(message);
    } catch (error) {
      renderDetailError(error);
    }
  }

  function ensureDetailPanel() {
    const detail = document.getElementById("gkanban-detail");
    if (!detail) {
      throw new Error("Detail panel not found.");
    }
    return detail;
  }

  function closeDetail() {
    const detail = ensureDetailPanel();
    detail.hidden = true;
    detail.innerHTML = "";
    state.detailMessage = null;
  }

  function renderMessageDetail(message) {
    const detail = ensureDetailPanel();
    detail.innerHTML = "";
    detail.appendChild(renderResizeHandle());

    const header = document.createElement("header");
    header.className = "gkanban-detail-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "gkanban-detail-title";
    const subject = document.createElement("h2");
    subject.textContent = message.subject || "(no subject)";
    const meta = document.createElement("p");
    meta.className = "gkanban-detail-summary";
    meta.textContent = `${compactSender(message.from)} → ${compactAddressList(message.to)} · ${formatFullDate(message.date)}`;
    meta.title = buildDetailMetaTitle(message);
    titleWrap.append(subject, meta);

    const tools = document.createElement("div");
    tools.className = "gkanban-detail-tools";
    tools.appendChild(renderDetailBoardSelect(message));

    const actionGroup = document.createElement("div");
    actionGroup.className = "gkanban-detail-action-group";
    actionGroup.appendChild(renderDetailActionButton("detail-archive", "archive", "移到待封存"));
    actionGroup.appendChild(renderDetailActionButton("detail-trash", "trash", "移到待刪除", true));
    tools.appendChild(actionGroup);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "gkanban-icon-button";
    closeButton.dataset.action = "close-detail";
    closeButton.title = "關閉";
    closeButton.setAttribute("aria-label", "關閉郵件");
    closeButton.appendChild(renderIcon("close"));
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeDetail();
    });
    tools.appendChild(closeButton);
    header.append(titleWrap, tools);

    const bodyFrame = renderBodyFrame(message);
    const attachments = renderAttachmentBar(message);

    detail.append(header, bodyFrame);
    if (attachments) {
      detail.appendChild(attachments);
    }
  }

  function renderDetailActionButton(action, icon, title, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `gkanban-icon-button gkanban-detail-action${danger ? " gkanban-icon-button-danger" : ""}`;
    button.dataset.action = action;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.appendChild(renderIcon(icon));
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      runDetailAction(action);
    });
    return button;
  }

  async function runDetailAction(action) {
    try {
      if (action === "detail-archive") {
        await archiveDetailMessage();
      }
      if (action === "detail-trash") {
        await trashDetailMessage();
      }
    } catch (error) {
      setDetailActionButtonsDisabled(false);
      setStatus(`操作失敗：${getErrorMessage(error)}`);
    }
  }

  function renderResizeHandle() {
    const handle = document.createElement("div");
    handle.className = "gkanban-resize-handle";
    handle.title = "調整寬度";
    handle.addEventListener("pointerdown", startDetailResize);
    return handle;
  }

  function appendMeta(parent, label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value || "";
    parent.append(term, detail);
  }

  function renderDetailBoardSelect(message) {
    const select = document.createElement("select");
    select.id = "gkanban-detail-board";
    select.className = "gkanban-detail-board-select";
    select.title = "移到看板";
    select.setAttribute("aria-label", "移到看板");
    for (const column of state.board?.columns || []) {
      const option = document.createElement("option");
      option.value = column.id;
      option.textContent = column.name;
      select.appendChild(option);
    }
    select.value = getMessageColumnId(message);
    select.addEventListener("change", () => {
      moveDetailMessage();
    });
    return select;
  }

  function renderBodyFrame(message) {
    const frame = document.createElement("iframe");
    frame.className = "gkanban-message-frame";
    frame.title = "郵件內容";
    frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
    frame.srcdoc = buildMessageSrcdoc(message);
    return frame;
  }

  function renderAttachmentBar(message) {
    const attachments = message.attachments || [];
    if (!attachments.length) {
      return null;
    }

    const section = document.createElement("section");
    section.className = "gkanban-attachments";
    section.setAttribute("aria-label", "附件");

    const title = document.createElement("p");
    title.className = "gkanban-attachments-title";
    title.textContent = `附件 ${attachments.length}`;
    section.appendChild(title);

    const list = document.createElement("div");
    list.className = "gkanban-attachment-list";
    attachments.forEach((attachment, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gkanban-attachment";
      button.dataset.action = "open-attachment";
      button.dataset.attachmentIndex = String(index);
      button.title = attachment.filename || "開啟附件";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openAttachment(index);
      });

      const icon = document.createElement("span");
      icon.className = "gkanban-attachment-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = getAttachmentIcon(attachment);

      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "gkanban-attachment-name";
      name.textContent = attachment.filename || "attachment";
      const meta = document.createElement("span");
      meta.className = "gkanban-attachment-meta";
      meta.textContent = [getAttachmentMimeType(attachment), formatFileSize(attachment.size)].filter(Boolean).join(" · ");
      text.append(name, meta);
      button.append(icon, text);
      list.appendChild(button);
    });
    section.appendChild(list);
    return section;
  }

  async function openAttachment(index) {
    const attachment = state.detailMessage?.attachments?.[index];
    if (!attachment || !state.detailMessage) {
      return;
    }

    const popup = window.open("about:blank", "_blank");
    setStatus("正在開啟附件...");

    try {
      const data = attachment.data || (await sendMessage("GKANBAN_GET_ATTACHMENT", {
        messageId: state.detailMessage.id,
        attachmentId: attachment.attachmentId || attachment.id
      })).data;
      if (!data) {
        throw new Error("Attachment data is empty.");
      }

      const mimeType = getAttachmentMimeType(attachment);
      const filename = getAttachmentFilename(attachment);
      const blob = base64UrlToBlob(data, mimeType);
      const url = URL.createObjectURL(blob);

      if (isPreviewableAttachment(mimeType)) {
        openAttachmentPreview(popup, url, filename, mimeType);
      } else {
        popup?.close();
        downloadAttachment(url, filename);
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 30 * 60 * 1000);
      setStatus("附件已開啟。");
    } catch (error) {
      if (popup) {
        openAttachmentStatusPage(popup, "無法開啟附件", getErrorMessage(error));
      }
      setStatus(`無法開啟附件：${getErrorMessage(error)}`);
    }
  }

  function openAttachmentPreview(popup, url, filename, mimeType) {
    const target = popup || window.open("about:blank", "_blank");
    if (!target) {
      downloadAttachment(url, filename);
      return;
    }

    const safeUrl = escapeHtml(url);
    const safeFilename = escapeHtml(filename);
    const viewer = mimeType.startsWith("image/")
      ? `<img src="${safeUrl}" alt="${safeFilename}">`
      : `<iframe src="${safeUrl}" title="${safeFilename}"></iframe>`;
    const viewerHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${safeFilename}</title>
    <style>
      html, body { width: 100%; height: 100%; margin: 0; background: #f8fafd; color: #202124; font: 14px Arial, sans-serif; }
      body { display: grid; grid-template-rows: auto minmax(0, 1fr); }
      header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; border-bottom: 1px solid #d7dde8; background: #fff; }
      strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      a { flex: 0 0 auto; border: 1px solid #c8d1dd; border-radius: 6px; padding: 6px 10px; color: #0b57d0; text-decoration: none; }
      iframe { width: 100%; height: 100%; border: 0; background: #fff; }
      img { display: block; max-width: 100%; max-height: 100%; margin: auto; object-fit: contain; }
    </style>
  </head>
  <body>
    <header>
      <strong>${safeFilename}</strong>
      <a href="${safeUrl}" download="${safeFilename}">下載</a>
    </header>
    ${viewer}
  </body>
</html>`;
    const viewerUrl = URL.createObjectURL(new Blob([viewerHtml], { type: "text/html" }));
    target.location.href = viewerUrl;
    window.setTimeout(() => URL.revokeObjectURL(viewerUrl), 30 * 60 * 1000);
  }

  function openAttachmentStatusPage(popup, title, message) {
    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtml(message);
    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${safeTitle}</title>
    <style>
      body { margin: 0; padding: 24px; color: #202124; background: #f8fafd; font: 14px/1.5 Arial, sans-serif; }
      main { max-width: 680px; border: 1px solid #d7dde8; border-radius: 8px; padding: 18px; background: #fff; }
      h1 { margin: 0 0 10px; font-size: 18px; }
      p { margin: 0; color: #5f6368; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
    </main>
  </body>
</html>`;
    const statusUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    popup.location.href = statusUrl;
    window.setTimeout(() => URL.revokeObjectURL(statusUrl), 5 * 60 * 1000);
  }

  function downloadAttachment(url, filename) {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function renderComposeBox({ title, textareaId, buttonAction, buttonText, includeRecipient = false }) {
    const section = document.createElement("section");
    section.className = "gkanban-compose";

    const heading = document.createElement("h3");
    heading.textContent = title;
    section.appendChild(heading);

    if (includeRecipient) {
      const recipient = document.createElement("input");
      recipient.id = "gkanban-forward-to";
      recipient.type = "email";
      recipient.placeholder = "收件者";
      section.appendChild(recipient);
    }

    const textarea = document.createElement("textarea");
    textarea.id = textareaId;
    textarea.rows = 1;
    textarea.className = "gkanban-compose-collapsed";
    textarea.placeholder = "輸入內容";

    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = buttonAction;
    button.textContent = buttonText;

    section.append(textarea, button);
    return section;
  }

  function renderDetailError(error) {
    const detail = ensureDetailPanel();
    const message = error instanceof Error ? error.message : String(error);
    detail.hidden = false;
    detail.innerHTML = "";
    detail.appendChild(renderResizeHandle());

    const stateBlock = document.createElement("div");
    stateBlock.className = "gkanban-detail-state gkanban-error";
    const title = document.createElement("strong");
    title.textContent = "無法開啟郵件";
    const body = document.createElement("p");
    body.textContent = message;
    const close = document.createElement("button");
    close.type = "button";
    close.dataset.action = "close-detail";
    close.textContent = "關閉";
    close.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeDetail();
    });
    stateBlock.append(title, body, close);
    detail.appendChild(stateBlock);
  }

  async function moveDetailMessage() {
    if (!state.detailMessage) {
      return;
    }

    const select = document.getElementById("gkanban-detail-board");
    const targetColumnId = select?.value;
    if (!targetColumnId) {
      return;
    }

    await moveMessageWithOptimisticUi(state.detailMessage.id, targetColumnId, {
      pendingStatus: "看板已更新，正在同步 Gmail...",
      successStatus: "看板已更新。",
      errorPrefix: "無法更新看板"
    });
  }

  async function archiveDetailMessage() {
    await moveDetailMessageToSpecialColumn(getArchiveColumn(), {
      pendingStatus: "正在移到待封存...",
      doneStatus: "郵件已移到待封存。",
      nextStatus: "郵件已移到待封存，正在開啟下一封...",
      emptyStatus: "郵件已移到待封存，這個看板沒有下一封。",
      errorPrefix: "無法移到待封存"
    });
  }

  async function trashDetailMessage() {
    await moveDetailMessageToSpecialColumn(getDeleteColumn(), {
      pendingStatus: "正在移到待刪除...",
      doneStatus: "郵件已移到待刪除。",
      nextStatus: "郵件已移到待刪除，正在開啟下一封...",
      emptyStatus: "郵件已移到待刪除，這個看板沒有下一封。",
      errorPrefix: "無法移到待刪除"
    });
  }

  async function moveDetailMessageToSpecialColumn(targetColumn, config) {
    const messageId = state.detailMessage?.id;
    if (!messageId) {
      return;
    }
    if (!targetColumn) {
      setStatus(`${config.errorPrefix}：找不到目標看板`);
      return;
    }

    const nextMessageId = getNextMessageIdInCurrentColumn(messageId);
    setDetailActionButtonsDisabled(true);

    const moved = await moveMessageWithOptimisticUi(messageId, targetColumn.id, {
      pendingStatus: config.pendingStatus,
      successStatus: config.doneStatus,
      errorPrefix: config.errorPrefix
    });
    if (!moved) {
      setDetailActionButtonsDisabled(false);
      return;
    }

    if (nextMessageId) {
      setStatus(config.nextStatus);
      await openMessage(nextMessageId);
      setStatus(config.doneStatus);
    } else {
      closeDetail();
      setStatus(config.emptyStatus);
    }
  }

  function setDetailActionButtonsDisabled(disabled) {
    document.querySelectorAll(".gkanban-detail-action").forEach((button) => {
      button.disabled = disabled;
    });
  }

  async function sendReply() {
    if (!state.detailMessage) {
      return;
    }

    const textarea = document.getElementById("gkanban-reply-body");
    const body = textarea?.value || "";

    try {
      setStatus("正在送出回覆...");
      await sendMessage("GKANBAN_SEND_REPLY", {
        messageId: state.detailMessage.id,
        body
      });
      if (textarea) {
        textarea.value = "";
      }
      setStatus("回覆已送出。");
    } catch (error) {
      setStatus(`無法送出回覆：${getErrorMessage(error)}`);
    }
  }

  async function sendForward() {
    if (!state.detailMessage) {
      return;
    }

    const recipient = document.getElementById("gkanban-forward-to");
    const textarea = document.getElementById("gkanban-forward-body");

    try {
      setStatus("正在送出轉寄...");
      await sendMessage("GKANBAN_SEND_FORWARD", {
        messageId: state.detailMessage.id,
        to: recipient?.value || "",
        body: textarea?.value || ""
      });
      if (recipient) {
        recipient.value = "";
      }
      if (textarea) {
        textarea.value = "";
      }
      setStatus("轉寄已送出。");
    } catch (error) {
      setStatus(`無法送出轉寄：${getErrorMessage(error)}`);
    }
  }

  function getMessageColumnId(message) {
    return getColumnForMessage(message)?.id || UNCATEGORIZED_COLUMN_ID;
  }

  function getColumnForMessage(message) {
    const labelIds = new Set(message.labelIds || []);
    const assignedColumn = (state.board?.columns || [])
      .filter((column) => !column.virtual)
      .find((column) => labelIds.has(column.labelId));
    return assignedColumn || getColumnById(UNCATEGORIZED_COLUMN_ID) || state.board?.columns?.[0];
  }

  function moveMessageInState(messageId, targetColumnId) {
    const sourceColumn = findMessageColumn(messageId);
    const targetColumn = getColumnById(targetColumnId);
    if (!sourceColumn || !targetColumn || sourceColumn.id === targetColumn.id) {
      return;
    }

    const messageIndex = sourceColumn.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) {
      return;
    }

    const [message] = sourceColumn.messages.splice(messageIndex, 1);
    message.labelIds = getUpdatedLabelIds(message.labelIds || [], targetColumn);
    targetColumn.messages.push(message);
    moveMessageCardElement(message, sourceColumn, targetColumn);
    updateColumnCount(sourceColumn.id);
    updateColumnCount(targetColumn.id);
    syncColumnEmptyState(sourceColumn.id);
    syncColumnEmptyState(targetColumn.id);

    if (state.detailMessage?.id === messageId) {
      state.detailMessage.labelIds = [...message.labelIds];
      const select = document.getElementById("gkanban-detail-board");
      if (select) {
        select.value = targetColumn.id;
      }
    }
  }

  function moveMessageCardElement(message, sourceColumn, targetColumn) {
    const targetList = getColumnListElement(targetColumn.id);
    if (!targetList) {
      renderColumnsById([sourceColumn.id, targetColumn.id]);
      return;
    }

    const existingCard = document.querySelector(`.gkanban-card[data-message-id="${CSS.escape(message.id)}"]`);
    existingCard?.remove();
    targetList.querySelector(".gkanban-empty")?.remove();
    targetList.appendChild(renderCard(message, targetColumn));
  }

  function getColumnListElement(columnId) {
    return document.querySelector(`.gkanban-column[data-column-id="${CSS.escape(columnId)}"] .gkanban-card-list`);
  }

  function syncColumnEmptyState(columnId) {
    const column = getColumnById(columnId);
    const list = getColumnListElement(columnId);
    if (!column || !list) {
      return;
    }

    list.querySelector(".gkanban-empty")?.remove();
    if (!column.messages.length) {
      list.appendChild(renderEmptyState());
    }
  }

  function removeSingleMessageFromBoard(messageId) {
    const column = findMessageColumn(messageId);
    if (!column) {
      state.loadedMessageIds.delete(messageId);
      state.board.loadedMessageCount = state.loadedMessageIds.size;
      updateBoardStatus();
      return;
    }

    const messageIndex = column.messages.findIndex((message) => message.id === messageId);
    if (messageIndex >= 0) {
      column.messages.splice(messageIndex, 1);
    }
    state.loadedMessageIds.delete(messageId);
    state.board.loadedMessageCount = state.loadedMessageIds.size;

    document.querySelector(`.gkanban-card[data-message-id="${CSS.escape(messageId)}"]`)?.remove();
    updateColumnCount(column.id);
    syncColumnEmptyState(column.id);
    updateBoardStatus();
  }

  function getNextMessageIdInCurrentColumn(messageId) {
    const column = findMessageColumn(messageId);
    if (!column) {
      return "";
    }

    const messageIndex = column.messages.findIndex((message) => message.id === messageId);
    if (messageIndex < 0) {
      return "";
    }

    return column.messages[messageIndex + 1]?.id || column.messages[messageIndex - 1]?.id || "";
  }

  function removeMessagesFromColumn(columnId, messageIds) {
    const column = getColumnById(columnId);
    if (!column) {
      return;
    }

    const idSet = new Set(messageIds);
    column.messages = column.messages.filter((message) => !idSet.has(message.id));
    for (const messageId of idSet) {
      state.loadedMessageIds.delete(messageId);
    }
    state.board.loadedMessageCount = state.loadedMessageIds.size;
    renderColumnsById([columnId]);
    updateBoardStatus();
  }

  function mergeSettingsColumns(settings) {
    if (!state.board) {
      loadBoard({ interactive: true });
      return;
    }

    if (settings.columnRows) {
      state.board.columnRows = settings.columnRows;
    }
    const board = document.getElementById("gkanban-board");
    const columnsById = new Map(state.board.columns.map((column) => [column.id, column]));
    for (const settingsColumn of settings.columns || []) {
      const existing = columnsById.get(settingsColumn.id);
      if (existing) {
        Object.assign(existing, settingsColumn);
        renderColumnsById([existing.id]);
      } else {
        const column = { ...settingsColumn, messages: [] };
        state.board.columns.push(column);
        board?.appendChild(renderColumn(column));
      }
    }
  }

  function applyColumnOrder(settingsColumns) {
    if (!state.board) {
      return;
    }

    applyColumnSettings(settingsColumns);
    const columnsById = new Map(state.board.columns.map((column) => [column.id, column]));
    const virtualColumns = state.board.columns.filter((column) => column.virtual);
    const orderedColumns = [];

    for (const settingsColumn of settingsColumns) {
      const existing = columnsById.get(settingsColumn.id);
      if (existing) {
        Object.assign(existing, settingsColumn);
        orderedColumns.push(existing);
      }
    }

    for (const column of state.board.columns) {
      if (!column.virtual && !orderedColumns.some((item) => item.id === column.id)) {
        orderedColumns.push(column);
      }
    }

    state.board.columns = [...virtualColumns, ...orderedColumns];
    renderBoard();
  }

  function applyColumnSettings(settingsColumns) {
    const changedColumnIds = [];
    for (const settingsColumn of settingsColumns) {
      const column = getColumnById(settingsColumn.id);
      if (!column) {
        continue;
      }
      Object.assign(column, settingsColumn);
      changedColumnIds.push(column.id);
    }
    renderColumnsById(changedColumnIds);
    refreshDetailBoardOptions();
  }

  function refreshDetailBoardOptions() {
    if (state.detailMessage && !document.getElementById("gkanban-detail")?.hidden) {
      renderMessageDetail(state.detailMessage);
    }
  }

  function deleteColumnFromState(columnId) {
    if (!state.board) {
      return;
    }

    const column = getColumnById(columnId);
    const uncategorizedColumn = getColumnById(UNCATEGORIZED_COLUMN_ID);
    if (!column) {
      return;
    }

    if (uncategorizedColumn) {
      for (const message of column.messages) {
        message.labelIds = getUpdatedLabelIds(message.labelIds || [], uncategorizedColumn);
        uncategorizedColumn.messages.push(message);
      }
    }

    state.board.columns = state.board.columns.filter((item) => item.id !== columnId);
    document.querySelector(`.gkanban-column[data-column-id="${CSS.escape(columnId)}"]`)?.remove();
    renderColumnsById([UNCATEGORIZED_COLUMN_ID]);

    if (state.detailMessage && column.messages.some((message) => message.id === state.detailMessage.id)) {
      state.detailMessage.labelIds = getUpdatedLabelIds(state.detailMessage.labelIds || [], uncategorizedColumn);
      const select = document.getElementById("gkanban-detail-board");
      if (select) {
        select.value = UNCATEGORIZED_COLUMN_ID;
      }
    }
  }

  function renderColumnsById(columnIds) {
    const uniqueColumnIds = [...new Set(columnIds)];
    const scrollPositions = new Map(
      uniqueColumnIds.map((columnId) => [columnId, getColumnScrollPosition(columnId)])
    );

    for (const columnId of uniqueColumnIds) {
      const column = getColumnById(columnId);
      const existing = document.querySelector(`.gkanban-column[data-column-id="${CSS.escape(columnId)}"]`);
      if (column && existing) {
        const replacement = renderColumn(column);
        existing.replaceWith(replacement);
        restoreColumnScrollPosition(replacement, scrollPositions.get(columnId));
      }
    }
  }

  function getColumnScrollPosition(columnId) {
    const list = document.querySelector(`.gkanban-column[data-column-id="${CSS.escape(columnId)}"] .gkanban-card-list`);
    if (!list) {
      return null;
    }
    return {
      left: list.scrollLeft,
      top: list.scrollTop
    };
  }

  function restoreColumnScrollPosition(columnElement, position) {
    if (!position) {
      return;
    }

    const list = columnElement.querySelector(".gkanban-card-list");
    if (list) {
      list.scrollLeft = position.left;
      list.scrollTop = position.top;
    }
  }

  function findMessageColumn(messageId) {
    return (state.board?.columns || []).find((column) => {
      return column.messages.some((message) => message.id === messageId);
    });
  }

  function getColumnById(columnId) {
    return (state.board?.columns || []).find((column) => column.id === columnId);
  }

  function collectLoadedMessageIds(board) {
    const ids = new Set();
    for (const column of board?.columns || []) {
      for (const message of column.messages || []) {
        ids.add(message.id);
      }
    }
    return ids;
  }

  function getMovableColumns() {
    return (state.board?.columns || []).filter((column) => !column.virtual);
  }

  function getArchiveColumn() {
    return (state.board?.columns || []).find((column) => isArchiveColumn(column));
  }

  function getDeleteColumn() {
    return (state.board?.columns || []).find((column) => isDeleteColumn(column));
  }

  function getUpdatedLabelIds(labelIds, targetColumn) {
    const kanbanLabelIds = new Set(
      (state.board?.columns || [])
        .filter((column) => !column.virtual && column.labelId)
        .map((column) => column.labelId)
    );
    const nextLabelIds = labelIds.filter((labelId) => !kanbanLabelIds.has(labelId));
    if (targetColumn?.labelId) {
      nextLabelIds.push(targetColumn.labelId);
    }
    return nextLabelIds;
  }

  function closeDetailIfIncluded(messageIds) {
    if (state.detailMessage && messageIds.includes(state.detailMessage.id)) {
      closeDetail();
    }
  }

  function isArchiveColumn(column) {
    return column.id === ARCHIVE_COLUMN_ID || column.name === "待封存";
  }

  function isDeleteColumn(column) {
    return column.id === DELETE_COLUMN_ID || column.name === "待刪除";
  }

  function markCardRead(messageId) {
    const card = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`);
    card?.classList.remove("gkanban-card-unread");
  }

  function buildMessageSrcdoc(message) {
    const body = message.htmlBody
      ? getMessageHtmlFragment(message.htmlBody)
      : `<pre>${escapeHtml(message.textBody || message.snippet || "")}</pre>`;
    return `<!doctype html>
<html>
  <head>
    <base target="_blank">
    <meta charset="utf-8">
    <style>
      html { box-sizing: border-box; }
      *, *::before, *::after { box-sizing: inherit; }
      body { min-width: 0; margin: 0 !important; padding: 0 !important; color: #202124; font: 14px/1.5 Arial, sans-serif; overflow-wrap: anywhere; }
      .gkanban-message-body { box-sizing: border-box !important; width: 100% !important; min-height: 100vh; padding: 18px 24px 24px !important; overflow-wrap: anywhere; }
      .gkanban-message-body > *:first-child { margin-top: 0; }
      img { max-width: 100%; height: auto; }
      table { max-width: 100%; }
      div, p, table, blockquote, pre { max-width: 100%; }
      pre { white-space: pre-wrap; font: inherit; margin: 0; }
    </style>
  </head>
  <body><main class="gkanban-message-body" style="box-sizing: border-box !important; width: 100% !important; min-height: 100vh; padding: 18px 24px 24px !important; overflow-wrap: anywhere;">${body}</main></body>
</html>`;
  }

  function getMessageHtmlFragment(html) {
    const source = String(html || "");
    const bodyMatch = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      return bodyMatch[1];
    }
    return source
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<\/?(?:html|head)\b[^>]*>/gi, "");
  }

  function formatFileSize(bytes) {
    const size = Number(bytes) || 0;
    if (!size) {
      return "";
    }
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${Math.round(size / 1024)} KB`;
    }
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  function getAttachmentIcon(attachment) {
    const mimeType = getAttachmentMimeType(attachment);
    const filename = String(attachment.filename || "").toLowerCase();
    if (mimeType.includes("pdf") || filename.endsWith(".pdf")) {
      return "PDF";
    }
    if (mimeType.startsWith("image/")) {
      return "IMG";
    }
    return "FILE";
  }

  function getAttachmentFilename(attachment) {
    return String(attachment?.filename || "attachment").trim() || "attachment";
  }

  function getAttachmentMimeType(attachment) {
    const rawMimeType = String(attachment?.mimeType || "").toLowerCase();
    const filename = getAttachmentFilename(attachment).toLowerCase();
    if (filename.endsWith(".pdf") || rawMimeType.includes("pdf")) {
      return "application/pdf";
    }
    if (filename.endsWith(".png")) {
      return "image/png";
    }
    if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) {
      return "image/jpeg";
    }
    if (filename.endsWith(".gif")) {
      return "image/gif";
    }
    if (filename.endsWith(".webp")) {
      return "image/webp";
    }
    if (rawMimeType && rawMimeType !== "application/octet-stream" && rawMimeType !== "binary/octet-stream") {
      return rawMimeType;
    }
    return rawMimeType || "application/octet-stream";
  }

  function isPreviewableAttachment(mimeType) {
    return mimeType === "application/pdf" || mimeType.startsWith("image/");
  }

  function base64UrlToBlob(value, mimeType) {
    const base64 = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  function expandComposeTextarea(textarea) {
    textarea.classList.remove("gkanban-compose-collapsed");
    textarea.classList.add("gkanban-compose-expanded");
  }

  function applyStoredDetailWidth(detail) {
    const storedWidth = Number(sessionStorage.getItem(DETAIL_WIDTH_KEY));
    if (Number.isFinite(storedWidth) && storedWidth > 0) {
      detail.style.width = `${clampDetailWidth(storedWidth)}px`;
    }
  }

  function startDetailResize(event) {
    event.preventDefault();
    const detail = ensureDetailPanel();
    const handle = event.currentTarget;
    const onPointerMove = (moveEvent) => {
      const width = clampDetailWidth(window.innerWidth - moveEvent.clientX);
      detail.style.width = `${width}px`;
    };
    const onPointerUp = (upEvent) => {
      const width = Math.round(detail.getBoundingClientRect().width);
      sessionStorage.setItem(DETAIL_WIDTH_KEY, String(width));
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
      if (handle.hasPointerCapture(upEvent.pointerId)) {
        handle.releasePointerCapture(upEvent.pointerId);
      }
      document.body.classList.remove("gkanban-resizing");
    };

    document.body.classList.add("gkanban-resizing");
    handle.setPointerCapture(event.pointerId);
    handle.addEventListener("pointermove", onPointerMove);
    handle.addEventListener("pointerup", onPointerUp);
    handle.addEventListener("pointercancel", onPointerUp);
  }

  function clampDetailWidth(width) {
    const minWidth = Math.min(420, window.innerWidth);
    const maxWidth = Math.max(minWidth, Math.round(window.innerWidth * 0.82));
    return Math.min(Math.max(Math.round(width), minWidth), maxWidth);
  }

  function openKanban() {
    sessionStorage.setItem(SESSION_KEY, "1");
    replaceQueryFlag(true);
    showKanban();
  }

  function leaveKanban(hash) {
    sessionStorage.removeItem(SESSION_KEY);
    replaceQueryFlag(false);
    hideKanban();
    if (hash) {
      window.location.hash = hash;
    }
  }

  function hasQueryFlag() {
    return new URL(window.location.href).searchParams.get(APP_QUERY) === "1";
  }

  function replaceQueryFlag(enabled) {
    const url = new URL(window.location.href);
    if (enabled) {
      url.searchParams.set(APP_QUERY, "1");
      if (url.hash === `#${APP_HASH}`) {
        url.hash = "#inbox";
      }
    } else {
      url.searchParams.delete(APP_QUERY);
    }
    window.history.replaceState(null, "", url.toString());
  }

  function setStatus(text) {
    const status = document.getElementById("gkanban-status");
    if (status) {
      status.textContent = text;
    }
  }

  function getErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
  }

  function compactSender(sender) {
    return String(sender || "")
      .replace(/<[^>]+>/g, "")
      .replace(/"/g, "")
      .trim();
  }

  function compactAddressList(addresses) {
    const items = String(addresses || "")
      .split(",")
      .map((item) => compactSender(item))
      .filter(Boolean);
    if (!items.length) {
      return "";
    }
    const visible = items.slice(0, 2).join(", ");
    return items.length > 2 ? `${visible} +${items.length - 2}` : visible;
  }

  function buildDetailMetaTitle(message) {
    return [
      `From: ${message.from || ""}`,
      `To: ${message.to || ""}`,
      message.cc ? `Cc: ${message.cc}` : "",
      formatFullDate(message.date)
    ].filter(Boolean).join("\n");
  }

  function formatMessageDate(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function formatFullDate(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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
})();
