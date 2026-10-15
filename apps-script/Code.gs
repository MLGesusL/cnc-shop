/* =====================================================================
   CNC Shop Assistant — live database (Google Apps Script)
   ---------------------------------------------------------------------
   Paste this whole file into the Sheet's Apps Script editor
   (Extensions → Apps Script), replacing what is there, then
   Deploy → New deployment → Web app:
       Execute as:      Me
       Who has access:  Anyone
   Copy the Web app URL into the app: Settings → Live database.

   What it does
   • Keeps every piece of app data in a hidden tab called "_db"
     (one row per record; big records are split across rows).
   • Anyone with the URL can READ (the app's view-only mode).
   • WRITING needs the write key. Set it from the Sheet menu
     CNC Shop → Set write key (only you can do this).
   • Every library table the app saves (tools, materials, cycles,
     bands …) is also written into its own readable tab, so the Sheet
     stays up to date without manual CSV imports.
   • Once a day it saves a full JSON copy to a Drive folder called
     "CNC Shop backups" (last 30 kept).
   ===================================================================== */

const DB_TAB = '_db';
const CHUNK = 45000;               // a Sheet cell holds max 50 000 characters
const BACKUP_FOLDER = 'CNC Shop backups';
const BACKUP_KEEP = 30;

/* ---------- menu in the Sheet ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('CNC Shop')
    .addItem('Set write key', 'menuSetKey')
    .addItem('Show status', 'menuStatus')
    .addItem('Save a backup to Drive now', 'menuBackup')
    .addToUi();
}
function menuSetKey() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Write key', 'Choose the key the app needs to save changes (at least 6 characters). ' +
    'Type the same key once on each PC that may edit: Settings → Live database.', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const k = r.getResponseText().trim();
  if (k.length < 6) { ui.alert('Too short — use at least 6 characters.'); return; }
  PropertiesService.getScriptProperties().setProperty('WRITE_KEY', k);
  ui.alert('Write key saved.');
}
function menuStatus() {
  const all = readAll_();
  SpreadsheetApp.getUi().alert('Live database\n\nRecords: ' + Object.keys(all).length +
    '\nRevision: ' + getRev_() + '\nWrite key set: ' + (getKey_() ? 'yes' : 'NO — use CNC Shop → Set write key') +
    '\nLast backup: ' + (PropertiesService.getScriptProperties().getProperty('LAST_BACKUP') || 'never'));
}
function menuBackup() { backup_(true); SpreadsheetApp.getUi().alert('Backup saved to Drive → ' + BACKUP_FOLDER); }

/* ---------- web app ---------- */
function doGet(e) {
  const a = (e && e.parameter && e.parameter.action) || 'all';
  try {
    if (a === 'rev') return out_({ ok: true, rev: getRev_() });
    if (a === 'all') return out_({ ok: true, rev: getRev_(), data: readAll_() });
    return out_({ ok: false, error: 'Unknown action ' + a });
  } catch (err) { return out_({ ok: false, error: String(err) }); }
}

function doPost(e) {
  let b;
  try { b = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'Bad request' }); }
  if (b.action === 'check') return out_({ ok: true, rev: getRev_(), canWrite: keyOk_(b.token), keySet: !!getKey_() });
  if (!getKey_()) return out_({ ok: false, code: 'nokey', error: 'No write key set yet — in the Sheet use CNC Shop → Set write key' });
  if (!keyOk_(b.token)) return out_({ ok: false, code: 'auth', error: 'Write key not accepted' });
  if (b.action !== 'write') return out_({ ok: false, error: 'Unknown action' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return out_({ ok: false, code: 'busy', error: 'Database busy — try again' });
  try {
    const ops = Array.isArray(b.ops) ? b.ops : [];
    const all = (b.replaceAll === true) ? {} : readAll_();
    const sheets = {};
    ops.forEach(function (op) {
      if (!op || typeof op.key !== 'string' || !op.key) return;
      if (op.op === 'del') delete all[op.key];
      else if (op.op === 'put') all[op.key] = op.value;
      if (op.sheet && op.sheet.tab && Array.isArray(op.sheet.rows)) sheets[op.sheet.tab] = op.sheet.rows;
    });
    writeAll_(all);
    Object.keys(sheets).forEach(function (t) { writeTab_(t, sheets[t]); });
    const rev = bumpRev_();
    try { backup_(false); } catch (err) { /* a failed backup never blocks a save */ }
    return out_({ ok: true, rev: rev, n: ops.length });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally { lock.releaseLock(); }
}

/* ---------- storage ---------- */
function dbSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(DB_TAB);
  if (!sh) {
    sh = ss.insertSheet(DB_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['key', 'part', 'json', 'updated']]);
    sh.hideSheet();
  }
  return sh;
}
function readAll_() {
  const sh = dbSheet_(), n = sh.getLastRow() - 1, outp = {};
  if (n < 1) return outp;
  const v = sh.getRange(2, 1, n, 3).getValues(), parts = {};
  v.forEach(function (r) { const k = String(r[0]); if (!k) return; (parts[k] = parts[k] || []).push([+r[1] || 0, String(r[2])]); });
  Object.keys(parts).forEach(function (k) {
    const s = parts[k].sort(function (a, b) { return a[0] - b[0]; }).map(function (p) { return p[1]; }).join('');
    try { outp[k] = JSON.parse(s); } catch (err) { /* skip a damaged record rather than fail everything */ }
  });
  return outp;
}
function writeAll_(all) {
  const sh = dbSheet_(), rows = [], now = new Date().toISOString();
  Object.keys(all).sort().forEach(function (k) {
    const s = JSON.stringify(all[k]);
    if (s === undefined) return;
    for (let i = 0, p = 0; i < s.length || p === 0; i += CHUNK, p++) rows.push([k, p, s.slice(i, i + CHUNK), now]);
  });
  const last = sh.getLastRow();
  if (last > 1) sh.getRange(2, 1, last - 1, 4).clearContent();
  if (rows.length) {
    const rg = sh.getRange(2, 1, rows.length, 4);
    rg.setNumberFormat('@');          // keep everything as plain text
    rg.setValues(rows);
  }
  const extra = sh.getMaxRows() - (rows.length + 1);
  if (extra > 200) sh.deleteRows(rows.length + 2, extra - 100);
}
/* readable copy of a library table in its own tab (all text, so nothing turns into dates or formulas) */
function writeTab_(name, rows) {
  if (!rows.length || /^_/.test(name)) return;
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const w = rows.reduce(function (m, r) { return Math.max(m, r.length); }, 1);
  const vals = rows.map(function (r) {
    const a = [];
    for (let i = 0; i < w; i++) { let c = r[i] == null ? '' : String(r[i]); if (c.length > 49000) c = c.slice(0, 49000); a.push(c); }
    return a;
  });
  sh.clearContents();
  const rg = sh.getRange(1, 1, vals.length, w);
  rg.setNumberFormat('@');
  rg.setValues(vals);
  sh.setFrozenRows(1);
}

/* ---------- revision, key, backups ---------- */
function getRev_() { return +(PropertiesService.getScriptProperties().getProperty('REV') || 0); }
function bumpRev_() { const r = getRev_() + 1; PropertiesService.getScriptProperties().setProperty('REV', String(r)); return r; }
function getKey_() { return PropertiesService.getScriptProperties().getProperty('WRITE_KEY') || ''; }
function keyOk_(t) { const k = getKey_(); return !!k && typeof t === 'string' && t === k; }

function backup_(force) {
  const P = PropertiesService.getScriptProperties(), last = P.getProperty('LAST_BACKUP');
  if (!force && last && (Date.now() - new Date(last).getTime()) < 24 * 3600 * 1000) return;
  const it = DriveApp.getFoldersByName(BACKUP_FOLDER);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_FOLDER);
  const stamp = Utilities.formatDate(new Date(), 'Europe/London', 'yyyy-MM-dd_HHmm');
  folder.createFile('cnc-live-' + stamp + '.json', JSON.stringify({ rev: getRev_(), at: new Date().toISOString(), data: readAll_() }), 'application/json');
  const files = [], fi = folder.getFiles();
  while (fi.hasNext()) files.push(fi.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });
  P.setProperty('LAST_BACKUP', new Date().toISOString());
}

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
