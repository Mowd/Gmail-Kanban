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
