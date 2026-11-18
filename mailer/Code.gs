/**
 * Rectify mailer — sends Rectify's workflow emails from the Gmail account that owns the Firebase project.
 * Free: runs on Google Apps Script. Gmail allows about 100 recipients a day (1,500 with Google Workspace).
 *
 * How it stays safe:
 *  - Rectify sends only { idToken, ids }: the signed-in person's Firebase token and the ids of emails in the
 *    Firestore outbox. Nobody can make this script send arbitrary text to arbitrary addresses.
 *  - The token is checked with Firebase, and the person must have an active Rectify account.
 *  - Each email is read from Firestore, sent to the address the Admin set in Rectify Settings
 *    (team mailboxes, or the contractor company's email), and marked sent, so it is never sent twice.
 *
 * Setup: see SETUP.md → "Automatic emails".
 */
var CONFIG = {
  projectId: 'rectify-b5f55',
  senderName: 'Rectify',
};
/* The Firebase web API key is set in Config.gs (not in GitHub). Copy Config.gs.example to Config.gs and fill it in.
 * The key is restricted to Rectify's websites, so requests send Rectify's address as the Referer. */
var RECTIFY_REFERER = 'https://rectify-b5f55.web.app/';

var FS = 'https://firestore.googleapis.com/v1/projects/' + CONFIG.projectId + '/databases/(default)/documents/';

function doPost(e) {
  var out;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    out = handle(req);
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* Opening the web app address in a browser shows that it is running. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'Rectify mailer', quotaLeftToday: MailApp.getRemainingDailyQuota() })).setMimeType(ContentService.MimeType.JSON);
}

function handle(req) {
  /* "Forgot password?" works without signing in, so it is handled before the sign-in check */
  if (req.reset) return sendReset(req.reset);

  var uid = verifyToken(req.idToken);
  var me = getDoc('users/' + uid);
  if (!me || str(me.status) !== 'active') throw new Error('Your Rectify account is not active.');

  if (req.test) return sendTest(me);

  var ids = (req.ids || []).filter(function (id) {
    return /^[\w-]{1,64}$/.test(id);
  }).slice(0, 50);
  if (!ids.length) return { ok: true, results: [] };

  var settings = parseJ(getDoc('kv/settings'), 'v') || {};
  var mailboxes = settings.mailboxes || {};
  var contractors = {};

  /* one sender at a time, so the same email is never sent twice */
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var results = ids.map(function (id) {
      var doc = getDoc('outbox/' + id);
      if (!doc || doc.deleted) return { id: id, status: 'missing' };
      if (doc.sentAt != null) return { id: id, status: 'already-sent' };
      var m = parseJ(doc, 'j');
      if (!m) return { id: id, status: 'unreadable' };
      var to = addressOf(m, mailboxes, contractors);
      if (!to) return { id: id, status: 'no-address', to: m.toName || '' };
      if (MailApp.getRemainingDailyQuota() < 1) return { id: id, status: 'quota' };
      MailApp.sendEmail({ to: to, subject: String(m.subject || '[Rectify]'), body: String(m.body || ''), name: CONFIG.senderName });
      markSent(id, to);
      return { id: id, status: 'sent', to: to };
    });
    return { ok: true, results: results };
  } finally {
    lock.releaseLock();
  }
}

function sendTest(me) {
  var to = str(me.email);
  MailApp.sendEmail({ to: to, subject: '[Rectify] Test email', body: 'Hello ' + str(me.name) + ',\n\nAutomatic emails from Rectify are working.\n\nThis message was sent by Rectify.', name: CONFIG.senderName });
  return { ok: true, results: [{ id: 'test', status: 'sent', to: to }], quotaLeftToday: MailApp.getRemainingDailyQuota() };
}

/* ---------- password recovery ----------
 * Emails a one-hour link (from Firebase) to set a new password, to people with an active Rectify account.
 * The answer is the same whether or not the email has an account, so nobody can use this to find out who
 * is registered. Limits: one email per address every 5 minutes, 30 per hour in total. */
function sendReset(email) {
  email = String(email || '').trim().toLowerCase();
  var done = { ok: true, results: [{ id: 'reset', status: 'requested' }] };
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) return done;
  var cache = CacheService.getScriptCache();
  if (cache.get('reset:' + email)) return done;
  var count = Number(cache.get('reset:count') || 0);
  if (count >= 30) return done;
  cache.put('reset:' + email, '1', 300);
  cache.put('reset:count', String(count + 1), 3600);

  var user = findUserByEmail(email);
  if (!user || str(user.status) !== 'active') return done;
  if (MailApp.getRemainingDailyQuota() < 1) return { ok: false, error: 'quota' };

  var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/projects/' + CONFIG.projectId + '/accounts:sendOobCode', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ requestType: 'PASSWORD_RESET', email: email, returnOobLink: true }),
    muteHttpExceptions: true,
  });
  var body = JSON.parse(r.getContentText() || '{}');
  if (r.getResponseCode() !== 200 || !body.oobLink) throw new Error('Could not create a reset link (' + r.getResponseCode() + ').');
  MailApp.sendEmail({
    to: email,
    subject: '[Rectify] Reset your password',
    body:
      'Hello ' + str(user.name) + ',\n\n' +
      'Someone asked to reset the password of your Rectify account (' + email + ').\n\n' +
      'To choose a new password, open this link within the next hour:\n' + body.oobLink + '\n\n' +
      'Then sign in to Rectify with your new password.\n\n' +
      'If you did not ask for this, ignore this email. Your password stays the same.\n\n' +
      'This message was sent by Rectify.',
    name: CONFIG.senderName,
  });
  return done;
}

function findUserByEmail(email) {
  var r = UrlFetchApp.fetch(FS.replace(/documents\/$/, 'documents:runQuery'), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'users' }], where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: email } } }, limit: 1 } }),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error('Could not read Rectify users (' + r.getResponseCode() + ').');
  var rows = JSON.parse(r.getContentText()).filter(function (x) {
    return x.document;
  });
  if (!rows.length) return null;
  var out = {};
  var f = rows[0].document.fields || {};
  Object.keys(f).forEach(function (k) {
    out[k] = plain(f[k]);
  });
  return out;
}

/* Same rules as Rectify's Emails page: team mailboxes from Settings, or the contractor company's email. */
function addressOf(m, mailboxes, contractors) {
  var addr = '';
  if (m.toRole === 'contractor') {
    if (!(m.contractorId in contractors)) contractors[m.contractorId] = parseJ(getDoc('contractors/' + m.contractorId), 'j');
    var c = contractors[m.contractorId];
    addr = c ? c.email : '';
  } else {
    addr = mailboxes[m.toRole === 'lta' ? 'lta-' + m.discipline : m.toRole];
  }
  addr = String(addr || '').trim();
  return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(addr) ? addr : '';
}

/* ---------- Firebase ---------- */
function verifyToken(idToken) {
  if (!idToken) throw new Error('Please sign in to Rectify again.');
  var r = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + MAILER_API_KEY, {
    method: 'post',
    contentType: 'application/json',
    headers: { Referer: RECTIFY_REFERER },
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true,
  });
  var body = JSON.parse(r.getContentText() || '{}');
  var why = JSON.stringify(body.error || '');
  if (/API_KEY|referer|PERMISSION_DENIED|blocked/i.test(why)) throw new Error('Mailer setup problem: the API key was refused (' + why.slice(0, 160) + ').');
  if (r.getResponseCode() !== 200 || !body.users || !body.users.length) throw new Error('Your sign-in has expired. Reload Rectify and try again.');
  return body.users[0].localId;
}

/* Reads a document as the script owner (who owns the Firebase project), returned as plain values. */
function getDoc(path) {
  var r = UrlFetchApp.fetch(FS + path, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (r.getResponseCode() === 404) return null;
  if (r.getResponseCode() !== 200) throw new Error('Could not read Rectify data (' + r.getResponseCode() + ').');
  var fields = JSON.parse(r.getContentText()).fields || {};
  var out = {};
  Object.keys(fields).forEach(function (k) {
    out[k] = plain(fields[k]);
  });
  return out;
}

/* Marks the email as sent; updatedAt uses Firestore's own clock so every browser picks up the change. */
function markSent(id, to) {
  var name = 'projects/' + CONFIG.projectId + '/databases/(default)/documents/outbox/' + id;
  var payload = {
    writes: [
      {
        update: { name: name, fields: { sentAt: { integerValue: String(Date.now()) }, mailedTo: { stringValue: to } } },
        updateMask: { fieldPaths: ['sentAt', 'mailedTo'] },
        updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
        currentDocument: { exists: true },
      },
    ],
  };
  var r = UrlFetchApp.fetch(FS.replace(/documents\/$/, 'documents:commit'), {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error('Email sent, but it could not be marked as sent (' + r.getResponseCode() + ').');
}

function plain(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  if ('mapValue' in v) {
    var o = {};
    var f = v.mapValue.fields || {};
    Object.keys(f).forEach(function (k) {
      o[k] = plain(f[k]);
    });
    return o;
  }
  return null;
}
function parseJ(doc, field) {
  try {
    return doc && doc[field] ? JSON.parse(doc[field]) : null;
  } catch (e) {
    return null;
  }
}
function str(x) {
  return x == null ? '' : String(x);
}

/* Run this once from the Apps Script editor: it asks for the permissions the mailer needs. */
function authorize() {
  getDoc('meta/setup');
  Logger.log('Mail quota left today: ' + MailApp.getRemainingDailyQuota());
}
