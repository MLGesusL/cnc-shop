# cnc-shop
My CNC Workshop Assistant — speeds and feeds, cut log and cutting data for hyperMILL work (metric), hosted on GitHub Pages with a Google Sheet (Apps Script, `apps-script/Code.gs`) as the live database.

- `index.html` — the whole app (the user guide is inside it: User Guide in the menu).
- `sheets.json` — the Sheet ID, the readable tabs and the live web-app URL.
- `mfr.json` — manufacturer catalogue data used for the bases.
- `tests/v9.test.js` — engine checks: `node tests/v9.test.js`.

Workflow (since 2026-10-20): material group › material (optional) › 3-axis / 3+2 / 5-axis › tool › machine (optional) › operation › style › pass › hyperMILL cycle (record only). Values = base × engagement × pass table, chip thinning always on; limits and physics are information only.
