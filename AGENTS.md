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
4. Card quick action buttons and detail panel action buttons must have direct click handlers with `preventDefault()` and `stopPropagation()`. Root-level delegation may remain only as fallback.
5. Any change touching card click, drag/drop, detail panel controls, mail movement, or load-more behavior must manually re-check: card quick archive, card quick delete, detail archive, detail delete, detail close, and attachment open.
