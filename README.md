# Gmail Kanban

[繁體中文](#繁體中文) · [简体中文](#简体中文) · [English](#english)

---

## 繁體中文

Gmail Kanban 是一個 Chrome / Firefox 瀏覽器擴充功能，會在 Gmail 內加入 Kanban 看板介面。它以 Gmail 作為資料來源，使用 Gmail label 作為 board 欄位，只顯示仍在收件匣中的郵件。

[![Buy Me a Coffee](https://img.buymeacoffee.com/button-api/?text=Buy+me+a+coffee&emoji=&slug=mowd&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/mowd)

### 功能

- 在 Gmail 內加入 Gmail Kanban 入口與 overlay 看板介面。
- 自動使用 `gKanban` Gmail label 與子 label 作為看板欄位。
- 沒有任何 `gKanban/*` 子 label 的收件匣郵件會顯示在虛擬的「未分類」欄位。
- 支援拖拉郵件到不同看板。
- 支援拖拉看板標題調整順序，也支援把看板上下堆疊在同一個 lane。
- 支援在 Kanban 內閱讀郵件、移動看板、開啟附件。
- 「待封存」與「待刪除」是特殊看板，可批次封存或批次移到垃圾桶。
- 收件匣郵件會漸進載入，避免一次載入大量郵件造成等待。
- Kanban 開啟時會輪詢新收件匣郵件並更新狀態提醒。
- 看板設定會儲存在 Gmail 草稿中，讓同一個 Gmail 帳號可跨電腦同步設定。

### 專案結構

```text
chrome/    Chrome MV3 extension package
firefox/   Firefox MV3 add-on package
scripts/   Development checks
```

`chrome/` 與 `firefox/` 內的共用實作檔案必須保持同步。`npm run check` 會檢查兩個版本的必要檔案、JavaScript 語法，以及共用檔案是否一致。

### Chrome 安裝設定

1. 在 Google Cloud 專案中啟用 Gmail API。
2. 建立 OAuth client，Application type 選擇 `Chrome Extension`。
3. 在 Chrome 開啟 `chrome://extensions`，啟用 Developer mode。
4. 載入 `chrome/` 作為 unpacked extension。
5. 複製 Chrome 顯示的 extension ID，填入 Google Cloud OAuth client。
6. 將 `chrome/manifest.json` 的 `oauth2.client_id` 換成你的 Chrome Extension OAuth client ID。
7. 重新載入 extension。
8. 開啟 Gmail Kanban 或 extension options page，完成 Gmail 授權。

### Firefox 安裝設定

Firefox 無法使用 Chrome 的 `chrome.identity.getAuthToken` 流程。本 add-on 使用 `identity.launchWebAuthFlow`、OAuth PKCE，以及 Google Desktop app OAuth flow。

1. 在 Google Cloud 專案中啟用 Gmail API。
2. 建立 OAuth client，Application type 選擇 `Desktop app`。
3. 在 Firefox 開啟 `about:debugging#/runtime/this-firefox`。
4. 暫時載入 `firefox/` 作為 temporary add-on。
5. 將 `firefox/src/oauth-config.js` 中的 placeholder 換成你的 Google Desktop OAuth client ID 與 client secret。
6. 重新載入 add-on，並完成 Gmail 授權。

如果要簽署或發佈 Firefox add-on，請將 `firefox/manifest.json` 的 `browser_specific_settings.gecko.id` 改成你擁有的穩定 add-on ID。

### 進入 Kanban

可以使用 extension popup、Gmail 內的 Gmail Kanban 按鈕，或直接開啟：

```text
https://mail.google.com/mail/u/0/?gkanban=1#inbox
```

`gkanban=1` 是 extension 使用的內部路由參數。Gmail 本身會控制 URL hash router，因此 extension 使用 query flag 加上 session state 來維持 Kanban overlay 開啟。

### 權限

本 extension 需要以下 Gmail scopes：

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.labels`

用途包含建立 label、讀取收件匣郵件 metadata、移動郵件到不同 Kanban label、封存/刪除特殊看板中的郵件、開啟附件，以及把 Kanban 設定 JSON 儲存在 Gmail 草稿中。

### 開發

```sh
npm run check
```

### 授權

MIT License

---

## 简体中文

Gmail Kanban 是一个 Chrome / Firefox 浏览器扩展，会在 Gmail 内加入 Kanban 看板界面。它以 Gmail 作为数据来源，使用 Gmail label 作为 board 列，只显示仍在收件箱中的邮件。

[![Buy Me a Coffee](https://img.buymeacoffee.com/button-api/?text=Buy+me+a+coffee&emoji=&slug=mowd&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/mowd)

### 功能

- 在 Gmail 内加入 Gmail Kanban 入口与 overlay 看板界面。
- 自动使用 `gKanban` Gmail label 与子 label 作为看板列。
- 没有任何 `gKanban/*` 子 label 的收件箱邮件会显示在虚拟的“未分类”列。
- 支持拖拽邮件到不同看板。
- 支持拖拽看板标题调整顺序，也支持把看板上下堆叠在同一个 lane。
- 支持在 Kanban 内阅读邮件、移动看板、打开附件。
- “待封存”与“待删除”是特殊看板，可批量归档或批量移到垃圾桶。
- 收件箱邮件会渐进加载，避免一次加载大量邮件造成等待。
- Kanban 打开时会轮询新收件箱邮件并更新状态提醒。
- 看板设置会储存在 Gmail 草稿中，让同一个 Gmail 账号可跨电脑同步设置。

### 项目结构

```text
chrome/    Chrome MV3 extension package
firefox/   Firefox MV3 add-on package
scripts/   Development checks
```

`chrome/` 与 `firefox/` 内的共用实现文件必须保持同步。`npm run check` 会检查两个版本的必要文件、JavaScript 语法，以及共用文件是否一致。

### Chrome 安装设置

1. 在 Google Cloud 项目中启用 Gmail API。
2. 创建 OAuth client，Application type 选择 `Chrome Extension`。
3. 在 Chrome 打开 `chrome://extensions`，启用 Developer mode。
4. 加载 `chrome/` 作为 unpacked extension。
5. 复制 Chrome 显示的 extension ID，填入 Google Cloud OAuth client。
6. 将 `chrome/manifest.json` 的 `oauth2.client_id` 换成你的 Chrome Extension OAuth client ID。
7. 重新加载 extension。
8. 打开 Gmail Kanban 或 extension options page，完成 Gmail 授权。

### Firefox 安装设置

Firefox 无法使用 Chrome 的 `chrome.identity.getAuthToken` 流程。本 add-on 使用 `identity.launchWebAuthFlow`、OAuth PKCE，以及 Google Desktop app OAuth flow。

1. 在 Google Cloud 项目中启用 Gmail API。
2. 创建 OAuth client，Application type 选择 `Desktop app`。
3. 在 Firefox 打开 `about:debugging#/runtime/this-firefox`。
4. 临时加载 `firefox/` 作为 temporary add-on。
5. 将 `firefox/src/oauth-config.js` 中的 placeholder 换成你的 Google Desktop OAuth client ID 与 client secret。
6. 重新加载 add-on，并完成 Gmail 授权。

如果要签署或发布 Firefox add-on，请将 `firefox/manifest.json` 的 `browser_specific_settings.gecko.id` 改成你拥有的稳定 add-on ID。

### 进入 Kanban

可以使用 extension popup、Gmail 内的 Gmail Kanban 按钮，或直接打开：

```text
https://mail.google.com/mail/u/0/?gkanban=1#inbox
```

`gkanban=1` 是 extension 使用的内部路由参数。Gmail 本身会控制 URL hash router，因此 extension 使用 query flag 加上 session state 来维持 Kanban overlay 打开。

### 权限

本 extension 需要以下 Gmail scopes：

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.labels`

用途包含创建 label、读取收件箱邮件 metadata、移动邮件到不同 Kanban label、归档/删除特殊看板中的邮件、打开附件，以及把 Kanban 设置 JSON 储存在 Gmail 草稿中。

### 开发

```sh
npm run check
```

### 授权

MIT License

---

## English

Gmail Kanban is a Chrome / Firefox browser extension that adds a Kanban board interface inside Gmail. Gmail remains the source of truth, Gmail labels become board columns, and only mail still in the Inbox is shown.

[![Buy Me a Coffee](https://img.buymeacoffee.com/button-api/?text=Buy+me+a+coffee&emoji=&slug=mowd&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff)](https://buymeacoffee.com/mowd)

### Features

- Adds a Gmail Kanban entry point and overlay board inside Gmail.
- Uses the `gKanban` Gmail label and child labels as board columns.
- Shows Inbox messages without a `gKanban/*` child label in the virtual `未分類` column.
- Supports dragging mail between boards.
- Supports reordering boards by dragging board headers, including vertical stacks inside the same lane.
- Supports inline mail reading, board assignment, and attachment opening.
- Treats `待封存` and `待刪除` as special boards for bulk archive and bulk trash actions.
- Loads Inbox mail progressively instead of blocking on the full mailbox.
- Polls for new Inbox mail while the Kanban view is open and shows a status notice.
- Stores board settings in a Gmail draft so the same Gmail account can sync settings across computers.

### Repository Layout

```text
chrome/    Chrome MV3 extension package
firefox/   Firefox MV3 add-on package
scripts/   Development checks
```

The shared implementation files in `chrome/` and `firefox/` must stay synchronized. `npm run check` validates required files, JavaScript syntax, and byte-for-byte synchronization for shared files.

### Chrome Setup

1. Enable the Gmail API in a Google Cloud project.
2. Create an OAuth client with application type `Chrome Extension`.
3. Open `chrome://extensions` in Chrome and enable Developer mode.
4. Load `chrome/` as an unpacked extension.
5. Copy the extension ID from Chrome and add it to the Google Cloud OAuth client.
6. Replace `chrome/manifest.json` `oauth2.client_id` with your Chrome Extension OAuth client ID.
7. Reload the extension.
8. Open Gmail Kanban or the extension options page and authorize Gmail.

### Firefox Setup

Firefox cannot use Chrome's `chrome.identity.getAuthToken` flow. This add-on uses `identity.launchWebAuthFlow`, OAuth PKCE, and Google's Desktop app OAuth flow.

1. Enable the Gmail API in a Google Cloud project.
2. Create an OAuth client with application type `Desktop app`.
3. Open `about:debugging#/runtime/this-firefox` in Firefox.
4. Temporarily load `firefox/` as a temporary add-on.
5. Replace the placeholders in `firefox/src/oauth-config.js` with your Google Desktop OAuth client ID and client secret.
6. Reload the add-on and authorize Gmail.

For signing or publishing, change `firefox/manifest.json` `browser_specific_settings.gecko.id` to a stable add-on ID you own.

### Open the Kanban View

Use the extension popup, the Gmail Kanban button inside Gmail, or open:

```text
https://mail.google.com/mail/u/0/?gkanban=1#inbox
```

The `gkanban=1` query flag is the extension's internal route. Gmail owns the URL hash router, so the extension uses this query flag plus page session state to keep the Kanban overlay open.

### Permissions

The extension asks for these Gmail scopes:

- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.labels`

These scopes are used to create labels, read Inbox mail metadata, move mail between Kanban labels, archive/trash mail from special boards, open attachments, and store Kanban settings JSON in a Gmail draft.

### Development

```sh
npm run check
```

### License

MIT License
