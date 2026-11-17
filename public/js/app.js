/* js/app.js */
/* Rectify — app core: state, data, routing and the page shell */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain,
    UI = DT.ui,
    esc = U.esc;
  DT.views = DT.views || {};

  const S = (DT.state = {
    user: null,
    raw: new Map() /* id → stored defect */,
    all: [] /* derived defects this user may see */,
    contractors: new Map(),
    imports: [],
    outbox: [],
    filters: DT.filters.empty(),
    sort: [{ id: 'ref', dir: 1 }],
    view: 'table',
    page: 1,
    pageSize: 25,
    cols: null,
    route: 'overview',
    openId: null,
    discipline: 'all' /* 'all', or a discipline id: the Civil / E&M switch on Overview and Defects */,
  });
  const App = (DT.app = {});

  /* The two demo contractor companies, created once on first start. Admin can rename, add or remove companies. */
  const STARTER_CONTRACTORS = ['Contractor A', 'Contractor B'];

  /* ---------- settings ---------- */
  /* Only known settings are read, so values from older builds are dropped. */
  App.loadSettings = async () => {
    const saved = (await DT.store.getKV('settings')) || {};
    D.settings = U.clone(D.DEFAULTS);
    Object.keys(D.DEFAULTS).forEach((k) => {
      if (saved[k] === undefined) return;
      const isMap = typeof D.DEFAULTS[k] === 'object' && !Array.isArray(D.DEFAULTS[k]);
      D.settings[k] = isMap ? Object.assign({}, D.DEFAULTS[k], saved[k]) : saved[k];
    });
    S.cols = (await DT.store.getKV('cols')) || DT.exporter.COLUMNS.filter((c) => c.def).map((c) => c.id);
  };
  App.saveSettings = () => DT.store.setKV('settings', D.settings);

  /* ---------- contractors ---------- */
  App.loginFor = (name, exceptId) => {
    const base = (D.norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'contractor') + '@rectify.local';
    const taken = new Set(DT.auth.users().filter((u) => u.id !== 'contractor:' + exceptId).map((u) => u.email));
    let login = base,
      n = 2;
    while (taken.has(login)) login = base.replace('@', '-' + n++ + '@');
    return login;
  };
  App.saveContractor = async (c) => {
    const rec = Object.assign({ id: U.uid(), createdAt: Date.now(), email: '' }, c);
    rec.name = String(rec.name || '').trim();
    if (!rec.name) throw new Error('Enter the company name.');
    if (Array.from(S.contractors.values()).some((x) => x.id !== rec.id && D.norm(x.name) === D.norm(rec.name))) throw new Error('A contractor with this name already exists.');
    rec.email = String(rec.email || '').trim();
    rec.login = rec.login || App.loginFor(rec.name, rec.id);
    await DT.store.putContractor(rec);
    await App.reload();
    return rec;
  };
  App.contractorWorkload = (id) => Array.from(S.raw.values()).filter((d) => d.contractorId === id && d.stage !== 'closed').length;
  App.removeContractor = async (id) => {
    if (App.contractorWorkload(id)) throw new Error('This contractor still has open defects. Reassign them first.');
    await DT.store.deleteContractor(id);
    await App.reload();
  };
  async function ensureStarterContractors() {
    if (await DT.store.getKV('contractorsInitialised')) return;
    const existing = await DT.store.getContractors();
    if (!existing.length) {
      for (const [i, name] of STARTER_CONTRACTORS.entries()) {
        const c = { id: U.uid(), name, email: '', createdAt: Date.now() + i };
        c.login = App.loginFor(name, c.id);
        await DT.store.putContractor(c);
        DT.auth.setContractors(await DT.store.getContractors());
      }
    }
    await DT.store.setKV('contractorsInitialised', true);
  }

  /* ---------- data ---------- */
  App.reload = async () => {
    const [contractors, defects, imports, outbox] = await Promise.all([DT.store.getContractors(), DT.store.getDefects(), DT.store.getImports(), DT.store.getOutbox()]);
    S.contractors = new Map(contractors.map((c) => [c.id, c]));
    DT.auth.setContractors(contractors);
    S.raw = new Map(defects.map((d) => [d.id, d]));
    const today = U.isoToday();
    S.all = S.user ? D.deriveAll(defects, today, S.contractors).filter((d) => DT.workflow.canSee(d, S.user)) : [];
    S.imports = imports;
    S.outbox = outbox;
  };
  App.ctx = () => ({ contractors: S.contractors });

  /* ---------- Civil / E&M switch ----------
   * Shown to accounts that can see both disciplines (Admin, STEL, contractors); an LTA account only sees its own. */
  App.seesBothDisciplines = () => S.user.role !== 'lta';
  App.scoped = () => (S.discipline === 'all' ? S.all : S.all.filter((d) => d.discipline === S.discipline));
  App.scopeText = () => (S.discipline === 'all' ? '' : 'Discipline: ' + D.disciplineById[S.discipline].label);
  App.disciplineSwitch = (host, onChange) => {
    if (!App.seesBothDisciplines()) return;
    const count = (id) => S.all.filter((d) => d.discipline === id).length;
    UI.segmented(host, {
      value: S.discipline,
      options: [{ id: 'all', label: 'Civil and E&M', count: S.all.length }].concat(D.DISCIPLINES.map((d) => ({ id: d.id, label: d.label, count: count(d.id) }))),
      onChange: (v) => {
        S.discipline = v;
        S.page = 1;
        onChange();
      },
    });
  };
  App.findDefect = (id) => S.all.find((d) => d.id === id) || null;

  /* Rows of an upload are only ever matched against real (not sample) defects of the same discipline,
   * so S/N 1 of the Civil register and S/N 1 of the E&M register stay separate defects. */
  App.matchUpload = (records, discipline) => DT.match.run(Array.from(S.raw.values()).filter((d) => d.discipline === discipline && !d.sample), records);

  /* Save the new rows of an uploaded register as defects with the LTA of its discipline.
   * meta = { fileName, note, discipline, decisions }; decisions: Map row S/N → 'new' for doubtful
   * matches STEL marked as different defects. */
  App.importDefects = async (result, meta) => {
    const existing = Array.from(S.raw.values());
    const m = App.matchUpload(result.records, meta.discipline);
    const asNew = m.pairs.filter((p) => p.doubtful && meta.decisions.get(p.row.sn) === 'new').map((p) => p.row);
    const rows = m.fresh.concat(asNew);
    const now = Date.now();
    const by = { id: S.user.id, name: S.user.name, role: S.user.role, contractorId: null };
    const importRec = { id: U.uid(), at: now, discipline: meta.discipline, fileName: meta.fileName, sheetName: result.sheetName, note: meta.note || '', by, added: rows.length, skipped: result.records.length - rows.length, photos: 0 };
    let ref = D.nextRef(existing, meta.discipline, false) - 1;
    const defects = rows.map((row) =>
      Object.assign({}, row, {
        id: U.uid(),
        ref: ++ref,
        importId: importRec.id,
        discipline: meta.discipline,
        stage: 'new',
        contractorId: null,
        dueDate: null /* the register's follow-up text stays in `followUp`; the target date is set by LTA */,
        rework: false,
        createdAt: now,
        updatedAt: now,
      })
    );
    const events = defects.map((d) => ({ id: U.uid(), defectId: d.id, at: now, action: 'import', fromStage: null, toStage: 'new', note: '', by, fileName: meta.fileName }));
    const media = new Map();
    defects.forEach((d) => d.photos.forEach((p) => result.media.has(p.hash) && media.set(p.hash, result.media.get(p.hash))));
    importRec.photos = defects.reduce((n, d) => n + d.photos.length, 0);
    await DT.store.saveImport(importRec, defects, events, DT.notify.forImport(defects, { fileName: meta.fileName, note: meta.note, uploader: S.user.name, at: now, discipline: meta.discipline }), media);
    await App.reload();
    return importRec;
  };

  /* ---------- sample defects ---------- */
  App.sampleDefects = () => Array.from(S.raw.values()).filter((d) => d.sample);
  App.addSample = async () => {
    const s = await DT.sample.build(Array.from(S.contractors.values()), Array.from(S.raw.values()));
    await DT.store.saveImports(s.imports, s.defects, s.events, s.outbox, s.media);
    await App.reload();
  };
  App.removeSample = async () => {
    const importIds = S.imports.filter((i) => i.sample).map((i) => i.id);
    await DT.store.removeDefects(App.sampleDefects().map((d) => d.id), importIds);
    await App.reload();
  };
  /* The shared database starts empty: Admin can add the sample defects from Settings. */

  /* Perform a workflow action on a defect and save it. */
  App.act = async (actionId, defectId, input) => {
    const res = DT.workflow.perform(actionId, S.raw.get(defectId), input, S.user, App.ctx());
    await DT.store.saveAction(res.defect, res.event, res.outbox, res.media);
    await App.reload();
    return res;
  };

  /* Assign many defects to one contractor with one target date. Every defect is checked first, so either all
   * are assigned or none; each gets its own history entry, and the contractor gets one email listing them. */
  App.assignMany = async (defectIds, input) => {
    const ctx = Object.assign({ now: Date.now() }, App.ctx());
    const results = defectIds.map((id) => {
      const d = S.raw.get(id);
      if (!d) throw new Error('A selected defect is no longer available. Refresh and try again.');
      try {
        return DT.workflow.perform('assign', d, input, S.user, ctx);
      } catch (e) {
        throw new Error(D.refLabel(d) + ': ' + e.message);
      }
    });
    const defects = results.map((r) => r.defect),
      events = results.map((r) => r.event);
    const outbox = DT.notify.forBulkAssign(defects, events, ctx);
    await DT.store.saveActions(defects, events, outbox, new Map());
    await App.reload();
    return { defects, outbox };
  };

  /* ---------- routing ---------- */
  const ROUTES = [
    { id: 'overview', label: 'Overview', can: 'insights' },
    { id: 'defects', label: 'Defects' },
    { id: 'imports', label: 'Uploads', can: 'imports' },
    { id: 'emails', label: 'Emails' },
    { id: 'settings', label: 'Settings', can: 'settings' },
  ];
  const allowedRoutes = () => ROUTES.filter((r) => !r.can || DT.auth.can(r.can));
  /* The first page this user may open: Overview, or Defects for roles without the dashboard */
  const homeRoute = () => allowedRoutes()[0].id;
  App.route = () => {
    const parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    const r = allowedRoutes().find((x) => x.id === parts[0]);
    return { id: r ? r.id : homeRoute(), param: r && parts[1] ? decodeURIComponent(parts[1]) : null };
  };
  App.go = (r) => {
    if (location.hash === '#/' + r) App.render();
    else location.hash = '#/' + r;
  };

  function layoutTabs(animate) {
    const tabs = U.$('#tabs');
    if (!tabs) return;
    const a = U.$('a[data-r="' + S.route + '"]', tabs);
    U.$$('a', tabs).forEach((x) => x.classList.toggle('on', x === a));
    const ind = U.$('.tab-ind', tabs);
    if (!a) return;
    if (!animate) ind.style.transition = 'none';
    ind.style.width = a.offsetWidth + 'px';
    ind.style.transform = 'translateX(' + a.offsetLeft + 'px)';
    if (!animate) {
      void ind.offsetWidth;
      ind.style.transition = '';
    }
  }

  App.unsentForMe = () => S.outbox.filter((m) => !m.sentAt && DT.notify.visibleTo(m, S.user)).length;
  App.paintBadges = () => {
    const b = U.$('#emailBadge');
    if (!b) return;
    const n = App.unsentForMe();
    b.textContent = n;
    b.hidden = !n;
  };

  App.render = () => {
    UI.drawer.close(true); /* a page change never leaves a defect panel open over the new page */
    const r = App.route();
    S.route = r.id;
    S.openId = r.id === 'defects' ? r.param : null;
    layoutTabs(true);
    App.paintBadges();
    const root = U.$('#view');
    root.className = 'page';
    void root.offsetWidth;
    root.classList.add('view-enter');
    if (!S.all.length && (S.route === 'overview' || S.route === 'defects')) {
      root.innerHTML = emptyState();
      return;
    }
    DT.views[S.route].render(root);
    if (!S.openId) window.scrollTo(0, 0);
  };

  function emptyState() {
    if (DT.auth.can('upload')) return UI.empty('file', 'No defects yet', 'Upload the defect register to start the flow.', '<div class="empty-actions"><button class="btn primary" data-act="upload">Upload Excel</button></div>');
    if (S.user.role === 'contractor') return UI.empty('check', 'Nothing assigned to you yet', 'Defects appear here once LTA assigns them to ' + S.user.name + '.');
    return UI.empty('file', 'No defects yet', 'Defects appear here once STEL uploads the register.');
  }

  /* ---------- shell ---------- */
  function buildShell() {
    const app = U.$('#app');
    app.innerHTML =
      '<header class="nav"><div class="nav-in">' +
      '<a class="brand" href="#/' + homeRoute() + '"><span class="logo">' + UI.logo(26) + '</span><span>' + esc(D.APP_NAME) + '</span></a>' +
      '<nav class="tabs" id="tabs" aria-label="Main"><span class="tab-ind"></span>' +
      allowedRoutes().map((r) => '<a href="#/' + r.id + '" data-r="' + r.id + '">' + esc(r.label) + (r.id === 'emails' ? '<em class="badge" id="emailBadge" hidden></em>' : '') + '</a>').join('') +
      '</nav>' +
      '<div class="nav-r"><button class="btn primary" id="btnUpload">' + UI.icon('upload', 16) + '<span>Upload</span></button><button class="avatar-btn" id="btnUser" aria-label="Account" aria-haspopup="menu"></button></div>' +
      '</div></header><main id="view" class="page" tabindex="-1"></main>';
    U.$('#btnUser').innerHTML = '<span class="avatar">' + esc(U.initials(S.user.name)) + '</span>';
    U.$('#btnUpload').hidden = !DT.auth.can('upload');
    U.$('#btnUpload').addEventListener('click', () => DT.views.upload.open());
    U.$('#btnUser').addEventListener('click', (e) => userMenu(e.currentTarget));
  }

  function userMenu(anchor) {
    const items = [{ header: 'Signed in as ' + DT.auth.roleLabel(S.user) }, { header: S.user.email }];
    items.push({ divider: true }, { label: 'Change password', icon: 'user', onClick: changePassword }, { label: 'Sign out', icon: 'logout', onClick: signOut });
    UI.menu(anchor, items);
  }
  function changePassword() {
    const m = UI.modal({
      title: 'Change password',
      width: 440,
      cls: 'sheet-sm',
      body:
        '<form class="pw-form" novalidate><label class="field"><span>Current password</span><input name="cur" type="password" autocomplete="current-password" required></label>' +
        '<label class="field"><span>New password (at least 10 characters)</span><input name="pw" type="password" autocomplete="new-password" required></label>' +
        '<label class="field"><span>New password again</span><input name="pw2" type="password" autocomplete="new-password" required></label><div class="login-err" role="alert"></div></form>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Save</button>',
    });
    const f = U.$('form', m.el),
      err = U.$('.login-err', m.el);
    const save = async () => {
      err.textContent = '';
      if (f.pw.value !== f.pw2.value) return (err.textContent = 'The new passwords do not match.');
      try {
        await DT.store.changeMyPassword(f.cur.value, f.pw.value);
        m.close();
        UI.toast('Password changed', 'success');
      } catch (e) {
        err.textContent = e.message;
      }
    };
    U.$('[data-ok]', m.el).addEventListener('click', save);
    f.addEventListener('submit', (e) => (e.preventDefault(), save()));
  }
  async function signOut() {
    await DT.auth.signOut();
    location.hash = '';
    location.reload();
  }

  /* ---------- global events ---------- */
  function globalEvents() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (a && a.dataset.act === 'upload') DT.views.upload.open();
    });
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.metaKey || e.ctrlKey || e.altKey || UI.top()) return;
      if (e.key === '/') {
        const s = U.$('#q');
        if (s) {
          e.preventDefault();
          s.focus();
        }
      } else if (e.key === 'u' && DT.auth.can('upload')) DT.views.upload.open();
    });
    window.addEventListener('hashchange', () => App.render());
    window.addEventListener('resize', U.debounce(() => layoutTabs(false), 100));
  }

  /* ---------- start ---------- */
  App.start = async () => {
    const boot = U.$('#boot');
    let signedIn;
    try {
      signedIn = await DT.store.init();
    } catch (e) {
      boot.innerHTML = '<div class="boot-err"><h2>Rectify is not available right now</h2><p>' + esc(e.message) + '</p></div>';
      return;
    }
    DT.auth.setSession(signedIn);
    const open = async (user) => {
      S.user = user;
      try {
        await App.loadSettings();
        if (user.role === 'admin') await ensureStarterContractors();
        await App.reload();
      } catch (e) {
        U.$('#login').hidden = false;
        U.$('#login').innerHTML = '<div class="boot-err"><h2>Your data could not be loaded</h2><p>' + esc(e.message) + '</p></div>';
        return;
      }
      /* a session that ends while the app is open sends the user back to sign-in */
      DT.store.onSignedOut = () => location.reload();
      U.$('#login').hidden = true;
      U.$('#app').hidden = false;
      buildShell();
      globalEvents();
      App.render();
      requestAnimationFrame(() => layoutTabs(false));
    };
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 500);
    const u = DT.auth.current();
    if (u) open(u);
    else DT.auth.renderLogin(U.$('#login'), open);
  };
  document.addEventListener('DOMContentLoaded', App.start);
})();


