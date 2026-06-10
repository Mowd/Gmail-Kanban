# Project Memory

This repository ships two browser extension packages:

- `chrome/`
- `firefox/`

All future feature work, bug fixes, UI changes, and Gmail API behavior changes must be applied to both versions. The common files under both folders are intentionally kept byte-identical, and `npm run check` enforces that synchronization.

When changing extension behavior:

1. Update the relevant file in both `chrome/` and `firefox/`, or update one and copy it to the other.
2. Keep browser-specific differences limited to manifests and Firefox OAuth config unless there is a clear compatibility reason.
3. Run `npm run check` before reporting completion.
4. If a browser-specific exception is required, document it in `README.md` and update `scripts/check.js` deliberately.

Mail action interaction invariants:

1. The archive and trash icons on uncategorized mail cards must only move mail to the `待封存` and `待刪除` boards. They must not directly call Gmail archive or trash APIs.
2. The archive and trash icons in the mail detail panel have the same semantics: move to `待封存` or `待刪除`, then open the next message from the original board when available.
3. The actual Gmail archive/trash API calls belong only to the bulk action buttons on the `待封存` and `待刪除` boards.
4. Do not use root-level event delegation for extension controls. Buttons, selects, textareas, cards, attachments, and board actions must bind their own event handlers directly when they are created.
5. Card quick action buttons, bulk board action buttons, and detail panel action buttons must have direct click handlers with `preventDefault()` and `stopPropagation()` where the event could otherwise reach a card, Gmail, or another container.
6. Direct-handler controls must not reuse stale DOM from a previous content-script instance. Shell, Gmail nav link, and launcher elements need instance guards and must be rebuilt when the instance changes.
7. Popup and in-app options buttons must route through the background `GKANBAN_OPEN_OPTIONS` message and keep a browser-compatible fallback. Do not reintroduce direct `openOptionsPage()` click handlers.
8. Gmail settings draft parsing must be recoverable. Invalid draft JSON should fall back to local settings or label recovery instead of blocking the whole extension.
9. Gmail label recovery must recognize both the current `gKanban/<board>` labels and legacy `gkanban/<board>` labels. Mail classification and move operations must include legacy label aliases so a new computer can show mail categorized on an older install.
10. Any change touching card click, drag/drop, detail panel controls, mail movement, shell controls, launcher/nav controls, or load-more behavior must manually re-check: top refresh, top add board, top settings, top close, Gmail nav open, launcher open, card quick archive, card quick delete, `待封存` bulk archive, `待刪除` bulk trash, detail archive, detail delete, detail close, and attachment open.
