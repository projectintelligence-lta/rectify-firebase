/* js/view-upload.js */
/* Rectify — upload flow */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain,
    UI = DT.ui,
    S = DT.state,
    P = DT.parser,
    esc = U.esc;
  const V = (DT.views.upload = {});

  V.open = () => {
    if (!DT.auth.can('upload')) return UI.toast('Your role cannot upload files.', 'error');
    const st = { step: 'pick', discipline: D.DISCIPLINES[0].id, session: null, sheet: null, overrides: {}, result: null, matching: null, decisions: new Map(), tab: 'summary', file: null, busy: false };
    const m = UI.modal({ title: 'Upload defect register', width: 900, cls: 'sheet-upload', body: '', footer: '', onBeforeClose: () => !st.busy });
    const body = m.body,
      foot = m.foot;
    const lta = () => DT.auth.ltaFor(st.discipline).name;

    /* ---------- Civil / E&M tabs: the register's discipline decides which LTA receives its defects ---------- */
    const tabsHost = document.createElement('div');
    tabsHost.className = 'disc-tabs';
    m.sheet.insertBefore(tabsHost, body);
    const tabs = UI.segmented(tabsHost, {
      value: st.discipline,
      options: D.DISCIPLINES.map((d) => ({ id: d.id, label: d.label + ' Defects' })),
      onChange: (v) => {
        if (st.busy || st.step === 'done') return tabs.set(st.discipline);
        st.discipline = v;
        if (st.step === 'review') {
          matchRows();
          review();
        } else pick();
      },
    });
    pick();

    /* ---------- step 1: choose a file ---------- */
    function pick(err) {
      st.step = 'pick';
      foot.innerHTML = '<button class="btn" data-close>Cancel</button>';
      body.innerHTML =
        '<div class="drop" id="drop" tabindex="0" role="button" aria-label="Choose an Excel file"><div class="drop-ic">' + UI.icon('upload', 30) + '</div><h3>Drop your ' + esc(D.disciplineById[st.discipline].label) + ' defect register here</h3><p>or <u>browse</u> to choose one</p><span class="muted small">.xlsx, .xlsm or .csv</span><input type="file" id="file" accept=".xlsx,.xlsm,.xls,.csv" hidden></div>' +
        (err ? '<div class="note-box warn">' + esc(err) + '</div>' : '') +
        '<div class="upload-facts"><div>' + UI.icon('shield', 18) + '<span><b>Your file is read on this device.</b> The original Excel file is not stored; its defects and photos are saved to Rectify for your team.</span></div>' +
        '<div>' + UI.icon('swap', 18) + '<span><b>Only new defects are added.</b> Rows already in Rectify are left as they are, because their progress is followed up in the app.</span></div>' +
        '<div>' + UI.icon('camera', 18) + '<span><b>Photos follow their row.</b> Each picture is attached to the defect row it sits on, before or after depending on its column.</span></div>' +
        '<div>' + UI.icon('file', 18) + '<span><b>New to this?</b> <button class="link" id="tpl">Download the Excel template</button></span></div></div>';
      const drop = U.$('#drop', body),
        input = U.$('#file', body);
      drop.addEventListener('click', () => input.click());
      drop.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()));
      input.addEventListener('change', () => input.files[0] && read(input.files[0]));
      ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.add('over'))));
      ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => (e.preventDefault(), drop.classList.remove('over'))));
      drop.addEventListener('drop', (e) => e.dataTransfer.files[0] && read(e.dataTransfer.files[0]));
      U.$('#tpl', body).addEventListener('click', () => U.download(P.makeTemplate(), 'Defect_Register_Template.xlsx'));
    }

    /* ---------- step 2: reading ---------- */
    function progressUI(file) {
      foot.innerHTML = '';
      body.innerHTML =
        '<div class="reading"><div class="ring"><svg viewBox="0 0 100 100"><circle class="bg" cx="50" cy="50" r="42"/><circle class="fg" cx="50" cy="50" r="42" pathLength="100" stroke-dasharray="0 100"/></svg><b id="pct">0%</b></div><h3 id="phase">Opening file…</h3><p class="muted">' + esc(file.name) + ' · ' + U.fmtBytes(file.size) + '</p></div>';
      return (label, pct) => {
        const fg = U.$('.fg', body);
        if (!fg) return;
        fg.setAttribute('stroke-dasharray', Math.max(1, pct) + ' 100');
        U.$('#pct', body).textContent = Math.round(pct) + '%';
        U.$('#phase', body).textContent = label;
      };
    }
    function bestSheet(session) {
      let best = session.sheetNames[0],
        bs = -1;
      session.sheetNames.forEach((n) => {
        const ws = session.wb.Sheets[n];
        if (!ws || !ws['!ref']) return;
        const orig = ws['!ref'];
        const ref = XLSX.utils.decode_range(orig);
        ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.min(ref.e.r, 40), c: ref.e.c } });
        const mx = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
        ws['!ref'] = orig;
        const sc = P.detectColumns(mx).score;
        if (sc > bs) (bs = sc), (best = n);
      });
      return best;
    }
    async function read(file) {
      st.file = file;
      st.busy = true;
      const prog = progressUI(file);
      try {
        prog('Reading the workbook…', 6);
        await U.sleep(60);
        st.session = await P.open(file);
        prog('Finding the header row…', 14);
        st.sheet = bestSheet(st.session);
        st.overrides = Object.assign({}, D.settings.columnOverrides || {});
        await analyze(prog);
        st.busy = false;
        review();
      } catch (e) {
        st.busy = false;
        console.error(e);
        pick(e.message || 'That file could not be read.');
      }
    }
    async function analyze(prog) {
      prog = prog || progressUI(st.file);
      prog('Matching columns and reading rows…', 22);
      await U.yield();
      st.result = await st.session.analyze(st.sheet, st.overrides, (i, n) => prog('Extracting photos… ' + i + ' of ' + n, 30 + (n ? (60 * i) / n : 60)));
      prog('Checking your data…', 94);
      matchRows();
      st.decisions = new Map();
      prog('Done', 100);
      await U.sleep(250);
    }

    /* ---------- step 3: review ---------- */
    function matchRows() {
      st.matching = st.result.fatal ? null : DT.app.matchUpload(st.result.records, st.discipline);
      st.decisions = new Map();
    }
    const doubtful = () => st.matching.pairs.filter((p) => p.doubtful);
    const newRows = () => st.matching.fresh.concat(doubtful().filter((p) => st.decisions.get(p.row.sn) === 'new').map((p) => p.row));

    function review() {
      st.step = 'review';
      const r = st.result;
      body.innerHTML =
        '<div class="rv-head" id="rvHead"></div><div class="rv-tabs"><div id="rvTabs"></div></div><div class="rv-body" id="rvBody"></div>';
      UI.segmented(U.$('#rvTabs', body), {
        value: st.tab,
        options: [
          { id: 'summary', label: 'Summary' },
          { id: 'columns', label: 'Columns' },
          { id: 'quality', label: 'Data quality', count: r.fatal ? undefined : r.warnings.length },
          { id: 'matching', label: 'Already in Rectify', count: r.fatal ? undefined : st.matching.pairs.length },
        ],
        onChange: (v) => {
          st.tab = v;
          paintTab();
        },
      });
      foot.innerHTML =
        '<div class="foot-fields"><label class="field inline grow"><span>Note for LTA (optional)</span><input id="upNote" placeholder="e.g. Findings from the site walk on Tuesday" maxlength="140"></label></div>' +
        '<div class="foot-btns"><button class="btn" id="upBack">Choose another file</button><button class="btn primary" id="upGo"></button></div>';
      paintGo();
      U.$('#upBack', foot).addEventListener('click', () => pick());
      U.$('#upGo', foot).addEventListener('click', confirm);
      paintHead();
      paintTab();
    }

    function paintHead() {
      const r = st.result;
      const head = U.$('#rvHead', body);
      if (r.fatal) {
        head.innerHTML = '<div class="verdict bad">' + UI.icon('alert', 22) + '<div><b>This file can’t be loaded yet</b><span>' + esc(r.fatal) + '</span></div></div>';
        return;
      }
      const ok = r.rowsWithData === r.records.length;
      head.innerHTML =
        '<div class="verdict ' + (ok ? 'ok' : 'warn') + '">' + UI.icon(ok ? 'check' : 'alert', 22) + '<div><b>' + (ok ? 'Row count matches' : 'Row count needs a look') + '</b><span>' + r.rowsWithData + ' rows with data in Excel · ' + r.records.length + ' defects read' + (ok ? '' : ' · ' + (r.rowsWithData - r.records.length) + ' row(s) were not read, see Data quality') + '</span></div></div>';
    }

    function paintGo() {
      const btn = U.$('#upGo', foot);
      const n = st.result.fatal ? 0 : newRows().length;
      btn.disabled = !n;
      btn.textContent = n ? 'Send ' + U.plural(n, 'new defect') + ' to ' + lta() : 'No new defects to add';
    }

    function paintTab() {
      const box = U.$('#rvBody', body);
      box.classList.remove('swap');
      void box.offsetWidth;
      box.classList.add('swap');
      ({ summary: tabSummary, columns: tabColumns, quality: tabQuality, matching: tabMatching }[st.tab])(box);
    }

    function tabSummary(box) {
      const r = st.result;
      if (r.fatal) {
        box.innerHTML = '<p class="muted">Open the <b>Columns</b> tab to match the register columns to your file.</p>';
        return;
      }
      const fresh = newRows();
      const noPhoto = r.records.filter((x) => !x.photos.length).length;
      const stat = (n, l, c) => '<div class="stat"><b' + (c ? ' style="color:' + c + '"' : '') + '>' + n + '</b><span>' + l + '</span></div>';
      box.innerHTML =
        '<div class="stats">' + stat(fresh.length, 'New defects', '#0071e3') + stat(r.records.length - fresh.length, 'Already in Rectify') + stat(r.photosAttached + (r.photosFound > r.photosAttached ? ' of ' + r.photosFound : ''), 'Photos attached') + stat(noPhoto, 'Rows without photos') + stat(r.warnings.filter((w) => w.level === 'warn').length, 'Items to check', r.warnings.some((w) => w.level === 'warn') ? '#ff9f0a' : '') + '</div>' +
        '<div class="rv-grid"><div class="card flat"><h4>What happens next</h4><p class="muted small">' +
        (fresh.length ? esc(U.plural(fresh.length, 'new defect')) + ' will be sent to <b>' + esc(lta()) + '</b> with the stage <b>New</b>, and ' + esc(lta()) + ' receives one email listing them.' : 'Every row in this file is already in Rectify, so nothing new will be added.') +
        (r.records.length - fresh.length ? ' ' + esc(U.plural(r.records.length - fresh.length, 'row')) + ' already in Rectify will be left unchanged.' : '') +
        (doubtful().length ? ' <b>' + doubtful().length + ' row(s) need your confirmation</b> in the “Already in Rectify” tab.' : '') + '</p></div>' +
        '<div class="card flat"><h4>Source</h4><div class="mini-row"><span>File</span><b class="r">' + esc(st.file.name) + '</b></div><div class="mini-row"><span>Sheet</span>' + (st.session.sheetNames.length > 1 ? '<select id="sheetSel">' + st.session.sheetNames.map((n) => '<option' + (n === st.sheet ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select>' : '<b>' + esc(st.sheet) + '</b>') + '</div><div class="mini-row"><span>Header row</span><b>' + (r.headerRow + 1) + '</b></div><div class="mini-row"><span>Columns matched</span><b>' + Object.keys(r.map).length + ' of ' + D.FIELDS.length + '</b></div></div></div>';
      const sel = U.$('#sheetSel', box);
      if (sel)
        sel.addEventListener('change', async () => {
          st.sheet = sel.value;
          st.overrides = {};
          st.busy = true;
          await analyze();
          st.busy = false;
          review();
        });
    }

    function tabColumns(box) {
      const r = st.result;
      const headers = r.headers;
      const opts = (sel) => '<option value="">Not in my file</option>' + headers.map((h, i) => (h ? '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' + esc(U.truncate(h, 56)) + '  (col ' + XLSX.utils.encode_col(i) + ')</option>' : '')).join('');
      box.innerHTML =
        '<p class="muted small">Each register column below is matched to a column of your file by its heading. Change a match if it is wrong, then re-read.</p><div class="map">' +
        D.FIELDS.map((f) => {
          const cur = r.map[f.id],
            det = r.detected ? r.detected[f.id] : undefined;
          const changed = cur !== det;
          return '<div class="map-row' + (cur == null && f.req ? ' miss' : '') + '"><span class="map-f"><b>' + esc(f.label) + '</b>' + (f.req ? '<em>required</em>' : '') + '</span><select data-f="' + f.id + '">' + opts(cur) + '</select><span class="map-s ' + (cur == null ? 'none' : changed ? 'chg' : 'ok') + '">' + (cur == null ? 'Not matched' : changed ? 'Changed by you' : 'Matched') + '</span></div>';
        }).join('') + '</div>' +
        (r.columnsUnmapped && r.columnsUnmapped.length ? '<p class="muted small">Not used: ' + r.columnsUnmapped.map((c) => esc(U.truncate(c.h, 30))).join(', ') + '</p>' : '') +
        '<div class="map-actions"><label class="check"><input type="checkbox" id="remember" checked><span>Remember these matches for next time</span></label><button class="btn primary" id="reread">Re-read file</button></div>';
      box.addEventListener('change', (e) => {
        const f = e.target.dataset.f;
        if (f) st.overrides[f] = e.target.value === '' ? null : +e.target.value;
      });
      U.$('#reread', box).addEventListener('click', async () => {
        if (U.$('#remember', box).checked) {
          D.settings.columnOverrides = Object.assign({}, st.overrides);
          DT.app.saveSettings();
        }
        st.busy = true;
        progressUI(st.file);
        await analyze();
        st.busy = false;
        review();
      });
    }

    function tabQuality(box) {
      const w = st.result.warnings;
      if (!w.length) {
        box.innerHTML = UI.empty('shield', 'No issues found', 'Every row was read cleanly.');
        return;
      }
      const order = { warn: 0, info: 1 };
      const list = w.slice().sort((a, b) => order[a.level] - order[b.level]);
      box.innerHTML =
        '<div class="q-head"><span class="muted small">' + w.filter((x) => x.level === 'warn').length + ' to check · ' + w.filter((x) => x.level === 'info').length + ' for information</span><button class="link" id="qCsv">Download list</button></div><ul class="qlist">' +
        list.map((x) => '<li class="' + x.level + '"><i>' + UI.icon(x.level === 'warn' ? 'alert' : 'info', 16) + '</i><span>' + esc(x.text) + '</span></li>').join('') + '</ul>';
      U.$('#qCsv', box).addEventListener('click', () => U.download(new Blob(['\ufeffType,Message\r\n' + list.map((x) => U.csvEscape(x.level === 'warn' ? 'To check' : 'Info') + ',' + U.csvEscape(x.text)).join('\r\n')], { type: 'text/csv' }), 'data_quality_' + U.stamp() + '.csv'));
    }

    function tabMatching(box) {
      if (st.result.fatal) {
        box.innerHTML = '<p class="muted">Fix the columns first.</p>';
        return;
      }
      const pairs = st.matching.pairs;
      if (!pairs.length) {
        box.innerHTML = UI.empty('check', 'All rows are new', 'None of the rows in this file are in Rectify yet.');
        return;
      }
      const line = (r) => '<b class="sn">' + esc(r.sn) + '</b><span>' + esc(U.truncate(r.description, 80)) + '</span>';
      const unsure = pairs.filter((p) => p.doubtful);
      const sure = pairs.filter((p) => !p.doubtful);
      box.innerHTML =
        (unsure.length
          ? '<div class="confirm-box"><h4>Please confirm ' + unsure.length + ' row' + (unsure.length > 1 ? 's' : '') + '</h4><p class="muted small">These rows look like a defect already in Rectify, but something does not line up. Choose “New defect” to add a row as a separate defect.</p>' +
            unsure.map((p, i) => '<div class="pair"><div><span class="muted small">' + esc(p.reason) + '</span><div class="pair-cols"><div><em>In Rectify (' + esc(D.refLabel(p.existing)) + ')</em>' + line(p.existing) + '</div><div><em>This file</em>' + line(p.row) + '</div></div></div><div class="pair-seg" data-i="' + i + '"></div></div>').join('') + '</div>'
          : '') +
        (sure.length ? '<details class="chg"' + (unsure.length ? '' : ' open') + '><summary>Already in Rectify, left unchanged<em>' + sure.length + '</em>' + UI.icon('down', 14) + '</summary><ul class="dlist">' + sure.map((p) => '<li>' + line(p.row) + '<span class="muted small">' + esc(D.refLabel(p.existing)) + ' · ' + esc(D.stageById[p.existing.stage].label) + '</span></li>').join('') + '</ul></details>' : '');
      U.$$('.pair-seg', box).forEach((el) => {
        const p = unsure[+el.dataset.i];
        UI.segmented(el, {
          value: st.decisions.get(p.row.sn) === 'new' ? 'new' : 'same',
          options: [{ id: 'same', label: 'Same defect' }, { id: 'new', label: 'New defect' }],
          onChange: (v) => {
            if (v === 'new') st.decisions.set(p.row.sn, 'new');
            else st.decisions.delete(p.row.sn);
            paintGo();
          },
        });
      });
    }

    /* ---------- step 4: save ---------- */
    async function confirm() {
      const btn = U.$('#upGo', foot);
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner sm"></span>Saving…';
      st.busy = true;
      try {
        const rec = await DT.app.importDefects(st.result, { fileName: st.file.name, note: U.$('#upNote', foot).value.trim(), discipline: st.discipline, decisions: st.decisions });
        st.busy = false;
        done(rec);
      } catch (e) {
        console.error(e);
        st.busy = false;
        paintGo();
        UI.toast('Could not save: ' + e.message, 'error');
      }
    }
    function done(rec) {
      st.step = 'done';
      tabsHost.hidden = true;
      foot.innerHTML = '<button class="btn" data-close>Done</button><button class="btn primary" id="dGo">View new defects</button>';
      body.innerHTML =
        '<div class="success"><svg viewBox="0 0 80 80" width="84" height="84"><circle class="sc" cx="40" cy="40" r="34" pathLength="1"/><path class="sk" pathLength="1" d="M26 41l10 10 19-22"/></svg><h3>' + esc(U.plural(rec.added, 'new ' + D.disciplineById[rec.discipline].label + ' defect')) + ' sent to ' + esc(lta()) + '</h3><p>' +
        (rec.skipped ? esc(U.plural(rec.skipped, 'row')) + ' already in Rectify were left unchanged. ' : '') + 'An email to ' + esc(lta()) + ' is waiting in the Emails page.</p></div>';
      U.$('#dGo', foot).addEventListener('click', () => {
        m.close();
        DT.views.goDefects({ stage: ['new'], upload: rec.id });
      });
      DT.app.render();
    }
  };
})();


