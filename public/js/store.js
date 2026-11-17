/* js/store.js */
/* Rectify — storage layer (Firebase).
 * Sign-in uses Firebase Authentication (email + password). Data lives in Cloud Firestore, so everyone who
 * signs in sees the same defects. Who may read or change what is enforced by firestore.rules, not by this file.
 *
 * Firestore layout (every record is stored as JSON text in `j`, next to the few fields the rules need):
 *   users/{uid}                    name, email, role, discipline, contractorId, status (pending | active)
 *   defects/{id}                   j, discipline, contractorId, updatedAt   (deleted: true once removed)
 *   defects/{id}/events/{id}       j, at
 *   imports/{id}                   j, at, sample, updatedAt
 *   outbox/{id}                    j, at, toRole, discipline, contractorId, sentAt, updatedAt
 *   contractors/{id}               j, createdAt
 *   kv/{key}                       v (JSON text)
 *   photos/{hash}_{full|thumb}     b (bytes), type, w, h
 *   meta/setup                     who created the first Admin (sign-in screen offers setup until it exists)
 *   meta/teams                     contractor company names for the sign-up form (readable before sign-in)
 *
 * To stay inside Firestore's free daily read quota, defects, imports and emails are kept in a cache in this
 * browser and only records changed since the last visit are fetched. The cache is cleared on sign-out.
 * View preferences (table columns) stay in this browser. */
(function () {
  'use strict';
  const DT = window.DT;
  const S = (DT.store = {});
  const LOCAL_KEYS = new Set(['cols']);
  const CFG = window.RECTIFY_FIREBASE;

  let fb, auth, db, FV, TS;
  let me = null; /* signed-in profile */

  /* ---------- errors people can read ---------- */
  const AUTH_MSG = {
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/invalid-login-credentials': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'Wrong email or password.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/email-already-in-use': 'This email already has an account. Sign in, or ask an Admin to help.',
    'auth/weak-password': 'Passwords need at least 10 characters.',
    'auth/network-request-failed': 'Cannot reach Firebase. Check your connection and try again.',
    'auth/user-disabled': 'This account has been switched off.',
    'auth/requires-recent-login': 'Please sign out and sign in again, then retry.',
    'auth/operation-not-allowed': 'Email and password sign-in is not switched on in the Firebase project (see SETUP.md).',
    'auth/configuration-not-found': 'Firebase Authentication is not set up for this project yet (see SETUP.md).',
  };
  function friendly(e) {
    if (!e) return new Error('Something went wrong.');
    const code = e.code || '';
    let msg = AUTH_MSG[code];
    if (!msg && (code === 'permission-denied' || code === 'firestore/permission-denied')) msg = 'Your role cannot do this, or your account is not active.';
    if (!msg && (code === 'unavailable' || code === 'firestore/unavailable')) msg = 'Cannot reach Firebase. Check your connection and try again.';
    if (!msg && (code === 'resource-exhausted' || code === 'firestore/resource-exhausted')) msg = 'The free Firebase quota for today is used up. It resets at midnight Pacific time.';
    if (!msg && (code === 'failed-precondition' || code === 'firestore/failed-precondition') && /index/i.test(e.message || '')) msg = 'A Firestore index is missing. Deploy firestore.indexes.json (see SETUP.md).';
    const err = new Error(msg || e.message || 'Something went wrong.');
    err.code = code;
    return err;
  }
  const guard = (fn) =>
    async function () {
      try {
        return await fn.apply(this, arguments);
      } catch (e) {
        if (e && e.code && /permission-denied/.test(e.code) && me && S.onSignedOut) checkStillActive();
        throw friendly(e);
      }
    };
  async function checkStillActive() {
    try {
      const p = await db.collection('users').doc(me.id).get();
      if (!p.exists || p.data().status !== 'active') S.onSignedOut();
    } catch (e) {
      /* a rejected read here also means the account lost access */
      S.onSignedOut();
    }
  }

  /* ---------- small helpers ---------- */
  const norm = (e) => String(e || '').trim().toLowerCase();
  const pj = (s) => {
    try {
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  };
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  const now = () => FV.serverTimestamp();
  const chunk = (a, n) => {
    const out = [];
    for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
    return out;
  };
  /* runs fn over items with at most `limit` running at once */
  async function pool(items, limit, fn) {
    let i = 0;
    const worker = async () => {
      while (i < items.length) {
        const k = i++;
        await fn(items[k], k);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  }
  /* Writes ops ([ref, 'set'|'update'|'delete', data]) in small batches. Firestore's rules may look up at most 20
   * documents per batch, and each write here looks up the writer's profile, so batches stay small. */
  async function writeAll(groups, perBatch) {
    perBatch = perBatch || 8;
    const batches = [];
    let cur = [];
    groups.forEach((g) => {
      if (cur.length && cur.length + g.length > perBatch) (batches.push(cur), (cur = []));
      cur = cur.concat(g);
    });
    if (cur.length) batches.push(cur);
    await pool(batches, 6, async (ops) => {
      const b = db.batch();
      ops.forEach(([ref, kind, data]) => (kind === 'delete' ? b.delete(ref) : kind === 'update' ? b.update(ref, data) : b.set(ref, data)));
      await b.commit();
    });
  }

  /* ---------- local cache of synced collections (IndexedDB) ---------- */
  const CACHE_DB = 'rectify-firebase-cache';
  let cdbp = null;
  function cdb() {
    if (cdbp) return cdbp;
    cdbp = new Promise((res) => {
      if (!window.indexedDB) return res(null);
      const r = indexedDB.open(CACHE_DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore('c', { keyPath: 'k' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    });
    return cdbp;
  }
  async function cacheGet(k) {
    const d = await cdb();
    if (!d) return null;
    return new Promise((res) => {
      try {
        const r = d.transaction('c', 'readonly').objectStore('c').get(k);
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      } catch (e) {
        res(null);
      }
    });
  }
  async function cachePut(rec) {
    const d = await cdb();
    if (!d) return;
    return new Promise((res) => {
      try {
        const tx = d.transaction('c', 'readwrite');
        tx.objectStore('c').put(rec);
        tx.oncomplete = tx.onerror = tx.onabort = () => res();
      } catch (e) {
        res();
      }
    });
  }
  async function cacheClear() {
    const d = await cdb();
    if (!d) return;
    return new Promise((res) => {
      try {
        const tx = d.transaction('c', 'readwrite');
        tx.objectStore('c').clear();
        tx.oncomplete = tx.onerror = tx.onabort = () => res();
      } catch (e) {
        res();
      }
    });
  }

  /* Returns every live record of a collection the user may see. Only records changed since the last sync are
   * read from Firestore; `scope` narrows the query to what the rules let this user read. */
  const syncing = new Map();
  function synced(coll, scope) {
    const key = [me.id, coll, scope.key].join('|');
    if (syncing.has(key)) return syncing.get(key);
    const p = (async () => {
      const cached = (await cacheGet(key)) || { k: key, wm: 0, docs: {} };
      let q = scope.query(db.collection(coll));
      /* contractors' scope can change when defects are re-assigned, so they always read their (small) set in full */
      const full = !scope.delta || !cached.wm;
      if (!full) q = q.where('updatedAt', '>=', TS.fromMillis(cached.wm));
      const snap = await q.get();
      const docs = full ? {} : cached.docs;
      let wm = full ? 0 : cached.wm;
      snap.forEach((doc) => {
        const x = doc.data();
        wm = Math.max(wm, ms(x.updatedAt));
        if (x.deleted) return delete docs[doc.id];
        const v = pj(x.j);
        if (!v) return;
        if (coll === 'outbox') v.sentAt = x.sentAt || null;
        docs[doc.id] = v;
      });
      await cachePut({ k: key, wm, docs });
      return Object.values(docs);
    })();
    syncing.set(key, p);
    p.finally(() => syncing.delete(key));
    return p;
  }
  const isStaff = () => me.role === 'admin' || me.role === 'stel';
  const scopes = {
    defects: () =>
      isStaff()
        ? { key: 'all', delta: true, query: (c) => c }
        : me.role === 'lta'
          ? { key: 'lta-' + me.discipline, delta: true, query: (c) => c.where('discipline', '==', me.discipline) }
          : { key: 'c-' + me.contractorId, delta: false, query: (c) => c.where('contractorId', '==', me.contractorId || '-') },
    imports: () => ({ key: 'all', delta: true, query: (c) => c }),
    outbox: () =>
      isStaff()
        ? { key: 'all', delta: true, query: (c) => c }
        : me.role === 'lta'
          ? { key: 'lta-' + me.discipline, delta: true, query: (c) => c.where('toRole', '==', 'lta').where('discipline', '==', me.discipline) }
          : { key: 'c-' + me.contractorId, delta: false, query: (c) => c.where('toRole', '==', 'contractor').where('contractorId', '==', me.contractorId || '-') },
  };

  /* ---------- start / sign-in ---------- */
  function profileFrom(uid, x) {
    return { id: uid, email: x.email, name: x.name, role: x.role, discipline: x.discipline || null, contractorId: x.contractorId || null, status: x.status || 'pending' };
  }
  async function loadProfile(user) {
    const snap = await db.collection('users').doc(user.uid).get();
    return snap.exists ? profileFrom(user.uid, snap.data()) : null;
  }

  /* Returns the signed-in user, or null. */
  S.init = async () => {
    if (!CFG || !CFG.apiKey || /^PASTE/.test(CFG.apiKey)) throw new Error('Firebase is not connected yet. Fill in js/firebase-config.js with your project’s settings (see SETUP.md).');
    if (!window.firebase || !firebase.firestore) throw new Error('The Firebase libraries could not be loaded. Check your internet connection.');
    fb = firebase.apps.length ? firebase.app() : firebase.initializeApp(CFG);
    auth = fb.auth();
    db = fb.firestore();
    try {
      db.settings({ ignoreUndefinedProperties: true, merge: true });
    } catch (e) {
      /* already configured */
    }
    if (CFG.useEmulator) {
      auth.useEmulator('http://127.0.0.1:9099');
      db.useEmulator('127.0.0.1', 8080);
    }
    FV = firebase.firestore.FieldValue;
    TS = firebase.firestore.Timestamp;
    const user = await new Promise((res) => {
      const off = auth.onAuthStateChanged((u) => (off(), res(u)));
    });
    if (!user) return null;
    try {
      const p = await loadProfile(user);
      if (p && p.status === 'active') {
        me = p;
        watchSession();
        return p;
      }
    } catch (e) {
      if (!/permission-denied|unavailable/.test(e.code || '')) throw friendly(e);
    }
    await auth.signOut();
    return null;
  };
  /* a session that ends while the app is open (signed out in another tab) sends the user back to sign-in */
  function watchSession() {
    auth.onAuthStateChanged((u) => {
      if (!u && me && S.onSignedOut) S.onSignedOut();
    });
  }

  S.signIn = guard(async (email, password) => {
    const cred = await auth.signInWithEmailAndPassword(norm(email), password);
    let p = null;
    try {
      p = await loadProfile(cred.user);
    } catch (e) {
      /* no readable profile */
    }
    if (!p || p.status !== 'active') {
      await auth.signOut();
      if (!p) throw new Error('This account has no access to Rectify. Ask an Admin to add you.');
      throw new Error('Your account is waiting for an Admin to approve it.');
    }
    me = p;
    watchSession();
    return p;
  });
  S.signOut = async () => {
    me = null;
    await cacheClear();
    try {
      await auth.signOut();
    } catch (e) {
      /* already signed out */
    }
  };
  /* "Forgot password?": the reset link is emailed by the Rectify mailer (from the Gmail that already reaches
   * people's inboxes). If the mailer is not set up or cannot be reached, Firebase sends its own reset email. */
  S.sendPasswordReset = guard(async (email) => {
    email = norm(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter your email address first.');
    let url = '';
    try {
      const s = await db.collection('meta').doc('mailer').get();
      if (s.exists && s.data().on && s.data().url) url = s.data().url;
    } catch (e) {
      /* no public mailer address: fall back below */
    }
    if (url) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ reset: email }) });
        const data = await res.json();
        if (data && data.ok) return 'mailer';
      } catch (e) {
        /* mailer unreachable: fall back below */
      }
    }
    await auth.sendPasswordResetEmail(email);
    return 'firebase';
  });

  /* ---------- first Admin (only until meta/setup exists) ---------- */
  S.needsSetup = async () => {
    try {
      return !(await db.collection('meta').doc('setup').get()).exists;
    } catch (e) {
      return false;
    }
  };
  S.createFirstAdmin = guard(async (u) => {
    const name = String(u.name || '').trim().slice(0, 80);
    if (!name) throw new Error('Enter your name.');
    checkPw(u.password);
    const cred = await auth.createUserWithEmailAndPassword(norm(u.email), u.password);
    const uid = cred.user.uid;
    try {
      const b = db.batch();
      b.set(db.collection('users').doc(uid), { email: norm(u.email), name, role: 'admin', discipline: null, contractorId: null, status: 'active', createdAt: now() });
      b.set(db.collection('meta').doc('setup'), { adminUid: uid, at: now() });
      await b.commit();
    } catch (e) {
      await cred.user.delete().catch(() => {});
      throw e.code === 'permission-denied' ? new Error('Rectify already has an Admin. Ask them to add you.') : e;
    }
    me = profileFrom(uid, { email: norm(u.email), name, role: 'admin', status: 'active' });
    watchSession();
    return me;
  });

  /* ---------- sign-up: anyone can ask for an account; an Admin approves it before it can be used ---------- */
  const checkPw = (pw) => {
    if (String(pw || '').length < 10) throw new Error('Passwords need at least 10 characters.');
  };
  function cleanUser(u, existing) {
    const x = {
      email: norm(u.email !== undefined ? u.email : existing && existing.email),
      name: String(u.name !== undefined ? u.name : (existing && existing.name) || '').trim().slice(0, 80),
      role: u.role !== undefined ? u.role : existing && existing.role,
      discipline: u.discipline !== undefined ? u.discipline : existing && existing.discipline,
      contractorId: u.contractorId !== undefined ? u.contractorId : existing && existing.contractorId,
    };
    if (!/^[^\s@]+@[^\s@]+$/.test(x.email)) throw new Error('Enter a valid email address.');
    if (!x.name) throw new Error('Enter the person’s name.');
    if (!['admin', 'stel', 'lta', 'contractor'].includes(x.role)) throw new Error('Choose a role.');
    if (x.role === 'lta') {
      if (!DT.domain.DISCIPLINES.some((d) => d.id === x.discipline)) throw new Error('Choose the LTA discipline (Civil or E&M).');
    } else x.discipline = null;
    if (x.role === 'contractor') {
      if (!x.contractorId) throw new Error('Choose the contractor company.');
    } else x.contractorId = null;
    return x;
  }
  S.publicTeams = async () => {
    try {
      const s = await db.collection('meta').doc('teams').get();
      return { contractors: (s.exists && s.data().contractors) || [] };
    } catch (e) {
      return { contractors: [] };
    }
  };
  S.signUp = guard(async (u) => {
    if (!['stel', 'lta', 'contractor'].includes(u.role)) throw new Error('Choose your role.');
    const x = cleanUser(u);
    checkPw(u.password);
    const cred = await auth.createUserWithEmailAndPassword(x.email, u.password);
    try {
      await db.collection('users').doc(cred.user.uid).set(Object.assign(x, { status: 'pending', createdAt: now() }));
    } catch (e) {
      await cred.user.delete().catch(() => {});
      throw e;
    }
    await auth.signOut();
    return { ok: true };
  });

  /* ---------- key-value (settings, view preferences) ---------- */
  S.getKV = guard(async (k) => {
    if (LOCAL_KEYS.has(k)) {
      try {
        const v = localStorage.getItem('rectify.' + k);
        return v == null ? undefined : JSON.parse(v);
      } catch (e) {
        return undefined;
      }
    }
    const s = await db.collection('kv').doc(k).get();
    return s.exists ? pj(s.data().v) : undefined;
  });
  S.setKV = guard(async (k, v) => {
    if (LOCAL_KEYS.has(k)) {
      try {
        localStorage.setItem('rectify.' + k, JSON.stringify(v));
      } catch (e) {
        /* preference not kept; nothing else breaks */
      }
      return;
    }
    await db.collection('kv').doc(k).set({ v: JSON.stringify(v === undefined ? null : v) });
  });

  /* ---------- photos ----------
   * A Firestore document holds at most 1 MB, so a photo larger than that is re-saved smaller first. */
  const MAX_PHOTO = 900 * 1024;
  async function shrink(blob) {
    let out = blob;
    for (let i = 0; i < 6 && out.size > MAX_PHOTO; i++) {
      const bmp = await createImageBitmap(out);
      const k = Math.sqrt(MAX_PHOTO / out.size) * 0.92;
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(bmp.width * k));
      cv.height = Math.max(1, Math.round(bmp.height * k));
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      if (bmp.close) bmp.close();
      out = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.8));
    }
    return out;
  }
  const photoRef = (hash, size) => db.collection('photos').doc(String(hash).replace(/[^\w-]/g, '_') + '_' + size);
  async function uploadMedia(media) {
    if (!media || !media.size) return;
    await pool(Array.from(media.entries()), 4, async ([hash, m]) => {
      for (const size of ['thumb', 'full']) {
        /* photos never change once saved, so one already there (same picture) is kept */
        if ((await photoRef(hash, size).get()).exists) continue;
        const blob = await shrink(m[size]);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await photoRef(hash, size).set({ b: firebase.firestore.Blob.fromUint8Array(bytes), type: blob.type || 'image/jpeg', w: m.w || null, h: m.h || null });
      }
    });
  }
  const urlCache = new Map();
  S.photoURL = async (hash, size) => {
    size = size === 'full' ? 'full' : 'thumb';
    const ck = hash + size;
    if (urlCache.has(ck)) return urlCache.get(ck);
    const p = (async () => {
      try {
        const s = await photoRef(hash, size).get();
        if (!s.exists) return '';
        const x = s.data();
        return URL.createObjectURL(new Blob([x.b.toUint8Array()], { type: x.type || 'image/jpeg' }));
      } catch (e) {
        urlCache.delete(ck);
        return '';
      }
    })();
    urlCache.set(ck, p);
    return p;
  };

  /* ---------- defects, history, uploads, emails ---------- */
  const defectDoc = (d) => ({ j: JSON.stringify(d), discipline: d.discipline || null, contractorId: d.contractorId || null, updatedAt: now() });
  const eventRef = (e) => db.collection('defects').doc(e.defectId).collection('events').doc(e.id);
  const eventDoc = (e) => ({ j: JSON.stringify(e), at: Number(e.at) || Date.now() });
  const importDoc = (i) => ({ j: JSON.stringify(i), at: Number(i.at) || Date.now(), sample: !!i.sample, updatedAt: now() });
  const outboxDoc = (m) => {
    const copy = Object.assign({}, m);
    delete copy.sentAt;
    return { j: JSON.stringify(copy), at: Number(m.at) || Date.now(), toRole: m.toRole || null, discipline: m.discipline || null, contractorId: m.contractorId || null, sentAt: m.sentAt || null, updatedAt: now() };
  };

  S.getDefects = guard(() => synced('defects', scopes.defects()));
  S.getEvents = guard(async (defectId) => {
    const snap = await db.collection('defects').doc(defectId).collection('events').get();
    const out = [];
    snap.forEach((d) => {
      const v = pj(d.data().j);
      if (v) out.push(v);
    });
    return out.sort((x, y) => x.at - y.at);
  });
  S.getImports = guard(async () => {
    if (!['admin', 'stel', 'lta'].includes(me.role)) return [];
    return (await synced('imports', scopes.imports())).sort((x, y) => y.at - x.at);
  });
  S.getOutbox = guard(async () => (await synced('outbox', scopes.outbox())).sort((x, y) => y.at - x.at));
  S.markSent = guard((id, at) => db.collection('outbox').doc(id).update({ sentAt: Number(at) || Date.now(), updatedAt: now() }));

  /* An upload: photos first (each once), then each defect with its history, then the emails, and the upload
   * record last, so an interrupted upload never shows as finished. */
  S.saveImports = guard(async (importRecs, defects, events, outbox, media) => {
    await uploadMedia(media);
    const evBy = new Map();
    (events || []).forEach((e) => evBy.set(e.defectId, (evBy.get(e.defectId) || []).concat([e])));
    const groups = (defects || []).map((d) => [[db.collection('defects').doc(d.id), 'set', defectDoc(d)]].concat((evBy.get(d.id) || []).map((e) => [eventRef(e), 'set', eventDoc(e)])));
    const seen = new Set((defects || []).map((d) => d.id));
    evBy.forEach((list, id) => !seen.has(id) && list.forEach((e) => groups.push([[eventRef(e), 'set', eventDoc(e)]])));
    await writeAll(groups);
    await writeAll((outbox || []).map((m) => [[db.collection('outbox').doc(m.id), 'set', outboxDoc(m)]]));
    await writeAll((importRecs || []).map((i) => [[db.collection('imports').doc(i.id), 'set', importDoc(i)]]));
    /* sample defects come with made-up emails: those are never sent */
    if (!(importRecs || []).some((i) => i.sample)) autoMail(outbox);
  });
  S.saveImport = (importRec, defects, events, outbox, media) => S.saveImports([importRec], defects, events, outbox, media);
  /* A workflow action: the defect, its history entry and the emails it triggers are saved together. */
  S.saveAction = guard(async (defect, event, outbox, media) => {
    await uploadMedia(media);
    const b = db.batch();
    b.set(db.collection('defects').doc(defect.id), defectDoc(defect));
    b.set(eventRef(event), eventDoc(event));
    (outbox || []).forEach((m) => b.set(db.collection('outbox').doc(m.id), outboxDoc(m)));
    await b.commit();
    if (!defect.sample) autoMail(outbox);
  });

  /* Several workflow steps at once (e.g. assigning many defects to one contractor): each defect is saved with its
   * own history entry; the emails are sent after all of them are saved. */
  S.saveActions = guard(async (defects, events, outbox, media) => {
    await uploadMedia(media);
    const evBy = new Map(events.map((e) => [e.defectId, e]));
    await writeAll(defects.map((d) => [[db.collection('defects').doc(d.id), 'set', defectDoc(d)]].concat(evBy.has(d.id) ? [[eventRef(evBy.get(d.id)), 'set', eventDoc(evBy.get(d.id))]] : [])), 6);
    await writeAll((outbox || []).map((m) => [[db.collection('outbox').doc(m.id), 'set', outboxDoc(m)]]));
    const sample = new Set(defects.filter((d) => d.sample).map((d) => d.id));
    autoMail((outbox || []).filter((m) => (m.defectIds || []).some((id) => !sample.has(id))));
  });

  /* Removes the given defects with their history, the emails that are only about them, the given upload
   * records, and every photo that no remaining defect uses. Admin only. Removed records stay as small
   * "deleted" markers so other people's browsers drop them from their caches. */
  S.removeDefects = guard(async (defectIds, importIds) => {
    const gone = new Set(defectIds);
    const all = Array.from((DT.state.raw || new Map()).values());
    const kept = new Set(),
      dropped = new Set();
    all.forEach((d) => (d.photos || []).forEach((p) => (gone.has(d.id) ? dropped : kept).add(p.hash)));
    const ops = [];
    await pool(defectIds, 6, async (id) => {
      const d = DT.state.raw && DT.state.raw.get(id);
      const evs = await db.collection('defects').doc(id).collection('events').get();
      const g = [];
      evs.forEach((e) => g.push([e.ref, 'delete']));
      g.push([db.collection('defects').doc(id), 'set', { deleted: true, discipline: (d && d.discipline) || null, contractorId: (d && d.contractorId) || null, updatedAt: now() }]);
      ops.push(g);
    });
    (DT.state.outbox || []).forEach((m) => (m.defectIds || []).length && m.defectIds.every((id) => gone.has(id)) && ops.push([[db.collection('outbox').doc(m.id), 'set', { deleted: true, toRole: m.toRole || null, discipline: m.discipline || null, contractorId: m.contractorId || null, updatedAt: now() }]]));
    (importIds || []).forEach((id) => ops.push([[db.collection('imports').doc(id), 'set', { deleted: true, updatedAt: now() }]]));
    dropped.forEach((h) => !kept.has(h) && ops.push([[photoRef(h, 'full'), 'delete'], [photoRef(h, 'thumb'), 'delete']]));
    await writeAll(ops);
    dropped.forEach((h) => {
      if (kept.has(h)) return;
      ['thumb', 'full'].forEach((size) => {
        const p = urlCache.get(h + size);
        if (p) p.then((u) => u && URL.revokeObjectURL(u));
        urlCache.delete(h + size);
      });
    });
  });
  /* Deletes every defect, its history, photos, uploads and emails. Contractors, users and settings are kept. */
  S.wipeDefects = guard(async () => {
    const st = DT.state;
    await S.removeDefects(Array.from((st.raw || new Map()).keys()), (st.imports || []).map((i) => i.id));
    await writeAll((st.outbox || []).map((m) => [[db.collection('outbox').doc(m.id), 'set', { deleted: true, toRole: m.toRole || null, discipline: m.discipline || null, contractorId: m.contractorId || null, updatedAt: now() }]]));
  });

  /* ---------- contractor companies ---------- */
  async function contractorsNow() {
    const snap = await db.collection('contractors').get();
    const out = [];
    snap.forEach((d) => {
      const v = pj(d.data().j);
      if (v) out.push(v);
    });
    return out.sort((x, y) => x.createdAt - y.createdAt);
  }
  /* the company names people choose from when they ask for a contractor account */
  async function publishTeams() {
    const list = await contractorsNow();
    await db.collection('meta').doc('teams').set({ contractors: list.map((c) => ({ id: c.id, name: c.name })) });
  }
  S.getContractors = guard(contractorsNow);
  S.putContractor = guard(async (c) => {
    await db.collection('contractors').doc(c.id).set({ j: JSON.stringify(c), createdAt: Number(c.createdAt) || Date.now() });
    await publishTeams();
  });
  S.deleteContractor = guard(async (id) => {
    const users = await db.collection('users').where('contractorId', '==', id).get();
    if (!users.empty) throw new Error('Remove or move this company’s users first (Settings → Users).');
    await db.collection('contractors').doc(id).delete();
    await publishTeams();
  });

  /* ---------- people who can sign in (Admin manages them) ---------- */
  S.getUsers = guard(async () => {
    const snap = await db.collection('users').get();
    const out = [];
    snap.forEach((d) => out.push(Object.assign(profileFrom(d.id, d.data()), { createdAt: ms(d.data().createdAt) })));
    return out.sort((a, b) => a.createdAt - b.createdAt);
  });
  const activeAdmins = async () => (await S.getUsers()).filter((u) => u.role === 'admin' && u.status === 'active');
  /* A new login is made through a second, private Firebase connection, so the Admin stays signed in. */
  S.createUser = guard(async (u) => {
    const x = cleanUser(u);
    checkPw(u.password);
    const second = firebase.apps.find((a) => a.name === 'rectify-admin') || firebase.initializeApp(CFG, 'rectify-admin');
    const sAuth = second.auth();
    if (CFG.useEmulator && !sAuth.emulatorConfig) sAuth.useEmulator('http://127.0.0.1:9099');
    await sAuth.setPersistence(firebase.auth.Auth.Persistence.NONE);
    const cred = await sAuth.createUserWithEmailAndPassword(x.email, u.password);
    try {
      await db.collection('users').doc(cred.user.uid).set(Object.assign(x, { status: 'active', createdAt: now() }));
    } catch (e) {
      await cred.user.delete().catch(() => {});
      throw e;
    } finally {
      await sAuth.signOut().catch(() => {});
    }
    return profileFrom(cred.user.uid, x);
  });
  S.updateUser = guard(async (id, patch) => {
    const ref = db.collection('users').doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new Error('No such user.');
    const existing = profileFrom(id, snap.data());
    if (patch.email !== undefined && norm(patch.email) !== existing.email) throw new Error('A login email cannot be changed here. Add the person again with the new email, then remove the old account.');
    if (patch.password) throw new Error('Use “Send reset link” so the person sets their own password.');
    const x = cleanUser(Object.assign({}, patch, { email: existing.email }), existing);
    if (existing.role === 'admin' && x.role !== 'admin' && (await activeAdmins()).length <= 1) throw new Error('Keep at least one Admin.');
    const upd = { name: x.name, role: x.role, discipline: x.discipline, contractorId: x.contractorId };
    if (patch.status === 'active') upd.status = 'active';
    await ref.update(upd);
    return profileFrom(id, Object.assign(snap.data(), upd));
  });
  /* Removing a user takes away their access to Rectify. Their Firebase login itself can be deleted in the
   * Firebase console (Authentication) if the email should be usable for a new account. */
  S.deleteUser = guard(async (id) => {
    if (id === me.id) throw new Error('You cannot remove yourself.');
    await db.collection('users').doc(id).delete();
  });
  S.changeMyPassword = guard(async (current, password) => {
    checkPw(password);
    const u = auth.currentUser;
    if (!u) throw new Error('Please sign in again.');
    try {
      await u.reauthenticateWithCredential(firebase.auth.EmailAuthProvider.credential(u.email, current));
    } catch (e) {
      throw new Error('Your current password is wrong.');
    }
    await u.updatePassword(password);
  });

  /* ---------- automatic emails (Rectify mailer on Google Apps Script, see mailer/ and SETUP.md) ----------
   * The browser sends only the signed-in person's token and the ids of the emails to send. The mailer checks
   * the token, reads each email from Firestore, sends it to the address set in Settings and marks it sent. */
  let mailerCfg;
  S.getMailer = async () => {
    if (mailerCfg === undefined) {
      mailerCfg = (await S.getKV('mailer').catch(() => null)) || {};
      /* the sign-in screen needs the mailer address for "Forgot password?": Admin keeps a public copy */
      if (me && me.role === 'admin' && mailerCfg.url) {
        const pub = await db.collection('meta').doc('mailer').get().catch(() => null);
        if (pub && (!pub.exists || pub.data().url !== mailerCfg.url || pub.data().on !== !!mailerCfg.on)) await db.collection('meta').doc('mailer').set({ url: mailerCfg.url, on: !!mailerCfg.on }).catch(() => {});
      }
    }
    return mailerCfg;
  };
  S.setMailer = guard(async (cfg) => {
    const url = String(cfg.url || '').trim();
    const testMailer = CFG.useEmulator && /^http:\/\/127\.0\.0\.1:\d+\//.test(url);
    if (url && !testMailer && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)) throw new Error('Paste the web app address that ends in /exec (from Apps Script → Deploy → Manage deployments).');
    mailerCfg = { url, on: !!url && cfg.on !== false };
    await S.setKV('mailer', mailerCfg);
    await db.collection('meta').doc('mailer').set(mailerCfg);
    return mailerCfg;
  });
  S.mailerOn = async () => {
    const c = await S.getMailer();
    return !!(c.on && c.url);
  };
  /* Returns [{ id, status: sent | already-sent | no-address | quota | missing, to }] */
  S.sendEmails = guard(async (ids, test) => {
    const c = await S.getMailer();
    if (!c.url) throw new Error('Automatic emails are not set up yet (Settings → Automatic emails).');
    const idToken = await auth.currentUser.getIdToken();
    let res;
    try {
      /* text/plain keeps this a "simple" request, which Apps Script accepts from any site */
      res = await fetch(c.url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(test ? { idToken, test: true } : { idToken, ids }) });
    } catch (e) {
      throw new Error('Cannot reach the Rectify mailer. Check the address in Settings → Automatic emails.');
    }
    const data = await res.json().catch(() => null);
    if (!data) throw new Error('The Rectify mailer did not answer properly. Check that it is deployed for “Anyone”.');
    if (!data.ok) throw new Error('Mailer: ' + (data.error || 'unknown error'));
    return data.results || [];
  });
  /* After a workflow step or upload: send its emails in the background and say what happened. */
  function autoMail(outbox) {
    const ids = (outbox || []).map((m) => m.id);
    if (!ids.length) return;
    S.mailerOn()
      .then((on) => on && Promise.all(chunk(ids, 50).map((part) => S.sendEmails(part))))
      .then((parts) => {
        if (!parts) return;
        const r = [].concat.apply([], parts);
        const sent = r.filter((x) => x.status === 'sent');
        const noAddr = r.filter((x) => x.status === 'no-address');
        const quota = r.some((x) => x.status === 'quota');
        const UI = DT.ui;
        if (sent.length) UI.toast(sent.length === 1 ? 'Email sent to ' + sent[0].to : sent.length + ' emails sent', 'success');
        if (noAddr.length) UI.toast(noAddr.length + ' email' + (noAddr.length > 1 ? 's' : '') + ' not sent: no address for ' + Array.from(new Set(noAddr.map((x) => x.to))).join(', ') + ' (Settings)', 'error');
        if (quota) UI.toast('Gmail’s daily sending limit is reached. The rest can be sent from the Emails page tomorrow.', 'error');
        if (DT.app && DT.app.reload) return DT.app.reload().then(() => DT.app.paintBadges && DT.app.paintBadges());
      })
      .catch((e) => DT.ui && DT.ui.toast('Emails not sent automatically: ' + e.message + ' They are waiting on the Emails page.', 'error'));
  }

  S.usage = async () => null;
})();
