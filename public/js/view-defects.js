/* js/view-defects.js */
/* Rectify — Defects list, board, filters and the defect panel with its workflow actions */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain,
    UI = DT.ui,
    S = DT.state,
    F = DT.filters,
    E = DT.exporter,
    W = DT.workflow,
    esc = U.esc;
  const V = (DT.views.defects = {});

  /* jump to the defect list with some filters preset */
  DT.views.goDefects = (preset) => {
    S.filters = Object.assign(F.empty(), preset || {});
    S.page = 1;
    DT.app.go('defects');
  };

  /* ---------- export menu (shared with Overview) ---------- */
  DT.views.exportMenu = (anchor, getRows) => {
    const ctx = () => ({ filtersText: [DT.app.scopeText(), F.describe(S.filters)].filter(Boolean).join('; '), imports: DT.auth.can('imports') ? S.imports : [], user: DT.auth.roleLabel(S.user) });
    const rows = () => sorted(getRows());
    UI.menu(anchor, [
      { header: 'Export ' + U.plural(getRows().length, 'defect') },
      { label: 'Excel workbook (.xlsx)', icon: 'sheet', onClick: () => (U.download(E.xlsx(rows(), ctx()), 'defects_' + U.stamp() + '.xlsx'), UI.toast('Excel file downloaded', 'success')) },
      { label: 'CSV (.csv)', icon: 'file', onClick: () => (U.download(E.csv(rows()), 'defects_' + U.stamp() + '.csv'), UI.toast('CSV file downloaded', 'success')) },
      { label: 'PDF report…', icon: 'printer', onClick: () => pdfDialog(rows(), ctx()) },
    ]);
  };
  function pdfDialog(rows, ctx) {
    const m = UI.modal({
      title: 'PDF report',
      width: 460,
      body: '<p class="confirm-text">A print-ready report opens in your browser’s print dialog. Choose <b>Save as PDF</b> as the destination.</p><label class="check"><input type="checkbox" id="pdfPhotos"><span>Add a page per defect with its photos <em>(' + rows.length + ' defects)</em></span></label>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>Create report</button>',
    });
    U.$('[data-ok]', m.el).addEventListener('click', async () => {
      const photos = U.$('#pdfPhotos', m.el).checked;
      m.close();
      await E.print(rows, ctx, { photos });
    });
  }

  /* Columns this user may see, by id (Age needs the 'insights' permission) */
  const visibleColById = () => Object.fromEntries(E.visibleColumns().map((c) => [c.id, c]));

  /* ---------- sorting ---------- */
  function sorted(list) {
    const cols = visibleColById();
    const keys = S.sort.map((s) => ({ c: cols[s.id], dir: s.dir })).filter((k) => k.c);
    return list.slice().sort((a, b) => {
      for (const k of keys) {
        const x = k.c.sort(a),
          y = k.c.sort(b);
        let r;
        if (k.c.num) r = (x || 0) - (y || 0);
        else if (k.c.nat) r = U.natCompare(x, y);
        else r = x < y ? -1 : x > y ? 1 : 0;
        if (r) return r * k.dir;
      }
      return D.refOrder(a) - D.refOrder(b);
    });
  }
  const current = () => sorted(F.apply(DT.app.scoped(), S.filters, S.user));

  /* ---------- page ---------- */
  V.render = (root) => {
    const noStage = Object.assign({}, S.filters, { stage: [] });
    const base = F.apply(DT.app.scoped(), noStage, S.user);
    const cnt = D.countBy(base, (r) => r.stage);
    const stageVal = S.filters.stage.length === 1 ? S.filters.stage[0] : 'all';
    const nFilters = F.count(S.filters);
    const mine = DT.app.scoped().filter((r) => W.isMine(r, S.user)).length;

    root.innerHTML =
      '<div class="page-head"><div><h1>Defects</h1><p class="lede" id="resCount"></p></div><div class="head-actions"><div id="segDisc"></div></div></div>' +
      '<div class="toolbar"><label class="search">' + UI.icon('search', 16) + '<input id="q" type="search" placeholder="Search description, location, ref, S/N…" autocomplete="off" value="' + esc(S.filters.q) + '"><kbd>/</kbd></label>' +
      (S.user.role === 'admin' ? '' : '<button class="btn toggle' + (S.filters.mine ? ' on' : '') + '" id="btnMine" aria-pressed="' + S.filters.mine + '">' + UI.icon('check', 16) + '<span>Needs my action</span><em class="badge">' + mine + '</em></button>') +
      '<button class="btn" id="btnFilters">' + UI.icon('filter', 16) + '<span>Filters</span>' + (nFilters ? '<em class="badge">' + nFilters + '</em>' : '') + '</button>' +
      '<div id="segView"></div>' +
      '<button class="btn" id="btnCols">' + UI.icon('columns', 16) + '<span>Columns</span></button>' +
      '<button class="btn" id="btnExport">' + UI.icon('download', 16) + '<span>Export</span></button></div>' +
      '<div class="stage-row"><div id="segStage"></div><div class="chips" id="chips"></div></div>' +
      '<div id="results"></div>';

    DT.app.disciplineSwitch(U.$('#segDisc'), () => V.render(root));
    UI.segmented(U.$('#segStage'), {
      value: stageVal,
      options: [{ id: 'all', label: 'All', count: base.length }].concat(D.STAGES.map((s) => ({ id: s.id, label: s.short, count: cnt.get(s.id) || 0 }))),
      onChange: (v) => {
        S.filters.stage = v === 'all' ? [] : [v];
        S.page = 1;
        V.render(root);
      },
    });
    UI.segmented(U.$('#segView'), {
      value: S.view,
      options: [{ id: 'table', label: 'Table', icon: 'table' }, { id: 'board', label: 'Board', icon: 'board' }],
      onChange: (v) => {
        S.view = v;
        paintResults();
        U.$('#btnCols').hidden = v === 'board';
      },
    });
    U.$('#btnCols').hidden = S.view === 'board';

    const q = U.$('#q');
    q.addEventListener(
      'input',
      U.debounce(() => {
        S.filters.q = q.value;
        S.page = 1;
        paintResults();
        paintChips();
      }, 160)
    );
    const mineBtn = U.$('#btnMine');
    if (mineBtn)
      mineBtn.addEventListener('click', () => {
        S.filters.mine = !S.filters.mine;
        S.page = 1;
        V.render(root);
      });
    U.$('#btnFilters').addEventListener('click', () => filterSheet(root));
    U.$('#btnCols').addEventListener('click', columnsSheet);
    U.$('#btnExport').addEventListener('click', (e) => DT.views.exportMenu(e.currentTarget, current));
    U.$('#chips').addEventListener('click', (e) => {
      const c = e.target.closest('[data-k]');
      if (!c) return;
      if (c.dataset.k === '__all') S.filters = F.empty();
      else clearChip(c.dataset.k, c.dataset.v);
      S.page = 1;
      V.render(root);
    });
    paintChips();
    paintResults();

    if (S.openId) {
      const id = S.openId;
      S.openId = null;
      V.openDefect(id);
    }
  };

  function clearChip(k, v) {
    const f = S.filters;
    if (k === 'q') f.q = '';
    else if (k in F.FLAGS) f[k] = false;
    else if (k === 'photo' || k === 'upload') f[k] = '';
    else if (k === 'date') f.from = f.to = '';
    else f[k] = f[k].filter((x) => x !== v);
  }
  function paintChips() {
    const chips = F.chips(S.filters).filter((c) => !(c.k === 'stage' && S.filters.stage.length === 1) && c.k !== 'mine');
    U.$('#chips').innerHTML =
      chips.map((c) => '<button class="chip" data-k="' + c.k + '" data-v="' + esc(c.v || '') + '">' + esc(c.label) + UI.icon('close', 12) + '</button>').join('') + (chips.length > 1 ? '<button class="chip clear" data-k="__all">Clear all</button>' : '');
  }

  /* ---------- results (table or board) ---------- */
  function paintResults() {
    const rows = current();
    const box = U.$('#results');
    const inScope = DT.app.scoped().length;
    const scopeName = S.user.role === 'lta' ? D.disciplineById[S.user.discipline].label + ' ' : S.discipline === 'all' ? '' : D.disciplineById[S.discipline].label + ' ';
    U.$('#resCount').textContent = rows.length === inScope ? U.plural(rows.length, scopeName + 'defect') + (S.user.role === 'contractor' ? ' assigned to ' + S.user.name : '') : 'Showing ' + rows.length + ' of ' + inScope + ' ' + scopeName + 'defects';
    if (!rows.length) {
      box.innerHTML = UI.empty('search', 'No defects match', 'Try removing a filter or searching for something else.', '<button class="btn" id="clr">Clear filters</button>');
      U.$('#clr').addEventListener('click', () => {
        S.filters = F.empty();
        V.render(U.$('#view'));
      });
      return;
    }
    if (S.view === 'board') boardView(box, rows);
    else tableView(box, rows);
  }

  const flagTags = (r) =>
    (r.overdue ? '<span class="od" title="Past the target date">Overdue ' + r.daysOverdue + ' d</span>' : '') + (r.open && r.rework ? '<span class="od rw" title="A fix was not accepted">Rework</span>' : '');

  function cell(c, r) {
    switch (c.id) {
      case 'discipline':
        return UI.disciplineTag(r.discipline);
      case 'ref':
        return '<b class="sn">' + esc(r.refLabel) + '</b>';
      case 'sn':
        return esc(r.sn) + (r.snIssue === 'duplicate' ? '<span class="dup" title="Duplicate S/N in the register, renumbered">dup</span>' : '');
      case 'stage':
        return UI.stagePill(r.stage) + flagTags(r);
      case 'classification':
        return UI.classTag(r.classification);
      case 'contractor':
        return r.contractorName ? esc(r.contractorName) : '<span class="muted">Not assigned</span>';
      case 'due':
        return r.dueDate ? '<span class="' + (r.overdue ? 'late' : '') + '">' + esc(U.fmtDate(r.dueDate)) + '</span>' : '<span class="muted">–</span>';
      case 'age':
        return '<span class="' + (r.open && r.ageDays > 30 ? 'old' : '') + '">' + r.ageDays + ' d</span>';
      case 'photos':
        return r.nRegister + r.nFix ? '<span class="ph" title="Register photos · contractor fix photos">' + UI.icon('camera', 14) + r.nRegister + '<i>·</i>' + r.nFix + '</span>' : '<span class="muted">–</span>';
      case 'description':
      case 'proposed':
      case 'action':
      case 'fixNote':
        return '<span class="clamp">' + esc(c.text(r)) + '</span>';
      default:
        return esc(c.text(r)) || '<span class="muted">–</span>';
    }
  }

  /* ---------- selecting many defects (LTA and Admin: assign them to one contractor in one go) ---------- */
  const sel = new Set();
  const canBulk = () => W.ACTIONS.assign.roles.includes(S.user.role);
  const assignable = (r) => {
    const raw = S.raw.get(r.id);
    return !!raw && W.allowed('assign', raw, S.user);
  };

  function paintSelBar(rows) {
    const bar = U.$('#selBar');
    if (!bar) return;
    const able = rows.filter(assignable);
    if (!sel.size) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    bar.innerHTML =
      '<b>' + U.plural(sel.size, 'defect') + ' selected</b>' +
      (able.length > sel.size ? '<button class="btn sm" data-selall>Select all ' + able.length + ' that can be assigned</button>' : '') +
      '<span class="sel-gap"></span><button class="btn sm" data-selclear>Clear</button>' +
      '<button class="btn sm primary" data-selassign>' + UI.icon('right', 14) + 'Assign to contractor</button>';
  }

  function bulkAssignDialog(rows) {
    const chosen = rows.filter((r) => sel.has(r.id));
    const contractors = Array.from(S.contractors.values());
    const refs = chosen.slice(0, 12).map((r) => r.refLabel).join(', ') + (chosen.length > 12 ? ' and ' + (chosen.length - 12) + ' more' : '');
    const m = UI.modal({
      title: 'Assign ' + U.plural(chosen.length, 'defect'),
      width: 520,
      body:
        '<p class="muted small act-ref">' + esc(refs) + '</p>' +
        '<label class="field"><span>Contractor</span><select id="bCon"><option value="">Choose a contractor…</option>' + contractors.map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('') + '</select></label>' +
        '<label class="field"><span>Target date (for all of them)</span><input type="date" id="bDue" value="' + U.addDays(U.isoToday(), 14) + '" min="' + U.isoToday() + '"></label>' +
        '<label class="field"><span>Note (optional)</span><textarea id="bNote" rows="3" placeholder="' + esc(PROMPTS.assign) + '"></textarea></label>' +
        '<p class="muted small">Each defect gets its own history entry. The contractor gets one email listing all of them.</p>' +
        '<div class="login-err" id="bErr" role="alert"></div>',
      footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="bGo">Assign ' + U.plural(chosen.length, 'defect') + '</button>',
    });
    U.$('#bGo', m.el).addEventListener('click', async () => {
      const btn = U.$('#bGo', m.el),
        err = U.$('#bErr', m.el);
      err.textContent = '';
      btn.disabled = true;
      try {
        const input = { contractorId: U.$('#bCon', m.el).value, dueDate: U.$('#bDue', m.el).value, note: U.$('#bNote', m.el).value };
        if (!input.contractorId) throw new Error('Choose a contractor.');
        if (!input.dueDate) throw new Error('Choose a target date.');
        const res = await DT.app.assignMany(chosen.map((r) => r.id), input);
        const name = S.contractors.get(input.contractorId).name;
        sel.clear();
        m.close();
        UI.toast('Assigned ' + U.plural(res.defects.length, 'defect') + ' to ' + name + ' · one email to ' + name, 'success');
        DT.app.paintBadges();
        V.render(U.$('#view'));
      } catch (e) {
        err.textContent = e.message;
        btn.disabled = false;
      }
    });
  }

  function tableView(box, rows) {
    const bulk = canBulk();
    if (bulk) {
      const keep = new Set(rows.filter(assignable).map((r) => r.id));
      Array.from(sel).forEach((id) => !keep.has(id) && sel.delete(id));
    } else sel.clear();
    const visible = visibleColById();
    const cols = S.cols.map((id) => visible[id]).filter(Boolean);
    const size = S.pageSize === 0 ? rows.length : S.pageSize;
    const pages = Math.max(1, Math.ceil(rows.length / size));
    S.page = Math.min(S.page, pages);
    const slice = rows.slice((S.page - 1) * size, S.page * size);
    const sortOf = (id) => S.sort.findIndex((s) => s.id === id);
    box.innerHTML =
      '<div class="table-card"><div class="table-scroll"><table class="grid-table"><thead><tr>' +
      (bulk ? '<th class="c-sel"><input type="checkbox" id="selPage" aria-label="Select every defect on this page that can be assigned"></th>' : '') +
      cols.map((c) => {
        const i = sortOf(c.id);
        return '<th class="' + (i >= 0 ? 'sorted' : '') + (c.num ? ' num' : '') + '" data-col="' + c.id + '" aria-sort="' + (i < 0 ? 'none' : S.sort[i].dir > 0 ? 'ascending' : 'descending') + '"><button>' + esc(c.label) + '<span class="sort">' + (i >= 0 ? UI.icon(S.sort[i].dir > 0 ? 'up' : 'down', 13) + (S.sort.length > 1 ? '<sup>' + (i + 1) + '</sup>' : '') : '') + '</span></button></th>';
      }).join('') +
      '</tr></thead><tbody>' +
      slice.map((r, n) => '<tr data-id="' + r.id + '" tabindex="0" class="' + (W.isMine(r, S.user) ? 'mine' : '') + '" style="--n:' + Math.min(n, 14) + ';--dc:' + D.disciplineById[r.discipline].color + '">' + (bulk ? '<td class="c-sel">' + (assignable(r) ? '<input type="checkbox" data-sel="' + r.id + '"' + (sel.has(r.id) ? ' checked' : '') + ' aria-label="Select ' + esc(r.refLabel) + '">' : '<input type="checkbox" disabled title="Can’t be assigned at this stage" aria-label="' + esc(r.refLabel) + ' can’t be assigned at this stage">') + '</td>' : '') + cols.map((c) => '<td class="c-' + c.id + (c.num ? ' num' : '') + '">' + cell(c, r) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>' +
      '<footer class="table-foot"><span>' + ((S.page - 1) * size + 1) + '–' + Math.min(rows.length, S.page * size) + ' of ' + rows.length + '</span>' +
      '<div class="pager"><label>Rows <select id="pgSize">' + [25, 50, 100, 0].map((n) => '<option value="' + n + '"' + (n === S.pageSize ? ' selected' : '') + '>' + (n || 'All') + '</option>').join('') + '</select></label>' +
      '<button class="icon-btn" id="pgPrev" aria-label="Previous page"' + (S.page <= 1 ? ' disabled' : '') + '>' + UI.icon('left') + '</button><span>' + S.page + ' / ' + pages + '</span><button class="icon-btn" id="pgNext" aria-label="Next page"' + (S.page >= pages ? ' disabled' : '') + '>' + UI.icon('right') + '</button></div></footer></div>' +
      (bulk ? '<div class="sel-bar" id="selBar" role="region" aria-label="Selected defects" hidden></div>' : '');

    const pageAble = slice.filter(assignable);
    const syncPageBox = () => {
      const pb = U.$('#selPage', box);
      if (!pb) return;
      const n = pageAble.filter((r) => sel.has(r.id)).length;
      pb.checked = !!pageAble.length && n === pageAble.length;
      pb.indeterminate = n > 0 && n < pageAble.length;
      pb.disabled = !pageAble.length;
    };
    const markRows = () => box.querySelectorAll('tr[data-id]').forEach((tr) => tr.classList.toggle('picked', sel.has(tr.dataset.id)));
    if (bulk) {
      syncPageBox();
      markRows();
      paintSelBar(rows);
    }
    box.onchange = (e) => {
      const t = e.target;
      if (t.id === 'selPage') {
        pageAble.forEach((r) => (t.checked ? sel.add(r.id) : sel.delete(r.id)));
        box.querySelectorAll('input[data-sel]').forEach((i) => (i.checked = sel.has(i.dataset.sel)));
      } else if (t.dataset.sel) {
        if (t.checked) sel.add(t.dataset.sel);
        else sel.delete(t.dataset.sel);
      } else return;
      syncPageBox();
      markRows();
      paintSelBar(rows);
    };

    box.onclick = (e) => {
      if (e.target.closest('.c-sel')) return;
      if (e.target.closest('[data-selclear]')) {
        sel.clear();
        return paintResults();
      }
      if (e.target.closest('[data-selall]')) {
        rows.filter(assignable).forEach((r) => sel.add(r.id));
        return paintResults();
      }
      if (e.target.closest('[data-selassign]')) return bulkAssignDialog(rows);
      const th = e.target.closest('th[data-col]');
      if (th) {
        const id = th.dataset.col;
        const i = sortOf(id);
        if (e.shiftKey) {
          if (i < 0) S.sort.push({ id, dir: 1 });
          else if (S.sort[i].dir === 1) S.sort[i].dir = -1;
          else S.sort.splice(i, 1);
        } else S.sort = [{ id, dir: i === 0 && S.sort[0].dir === 1 ? -1 : 1 }];
        if (!S.sort.length) S.sort = [{ id: 'ref', dir: 1 }];
        paintResults();
        return;
      }
      const tr = e.target.closest('tr[data-id]');
      if (tr) V.openDefect(tr.dataset.id);
    };
    box.onkeydown = (e) => {
      const tr = e.key === 'Enter' && e.target.closest('tr[data-id]');
      if (tr) V.openDefect(tr.dataset.id);
    };
    U.$('#pgSize').onchange = (e) => {
      S.pageSize = +e.target.value;
      S.page = 1;
      paintResults();
    };
    U.$('#pgPrev').onclick = () => {
      S.page--;
      paintResults();
    };
    U.$('#pgNext').onclick = () => {
      S.page++;
      paintResults();
    };
  }

  function boardView(box, rows) {
    const LIMIT = 60;
    box.onclick = (e) => {
      const c = e.target.closest('[data-id]');
      if (c) V.openDefect(c.dataset.id);
    };
    box.onkeydown = null;
    box.innerHTML =
      '<div class="board">' +
      D.STAGES.map((s) => {
        const items = rows.filter((r) => r.stage === s.id);
        return (
          '<section class="lane" style="--c:' + s.color + '"><header><i></i><b>' + esc(s.label) + '</b><em>' + items.length + '</em></header><div class="lane-body">' +
          (items
            .slice(0, LIMIT)
            .map((r, n) => '<button class="bcard' + (W.isMine(r, S.user) ? ' mine' : '') + '" data-id="' + r.id + '" style="--n:' + Math.min(n, 10) + '"><span class="bc-top"><b>' + esc(r.refLabel) + '</b><span class="bc-tags">' + UI.disciplineTag(r.discipline) + UI.classTag(r.classification) + '</span></span><span class="bc-desc">' + esc(U.truncate(r.description, 90)) + '</span><span class="bc-meta">' + esc([r.location, r.building].filter(Boolean).join(' · ')) + '</span><span class="bc-foot"><span>' + esc(r.contractorName || 'Not assigned') + '</span>' + flagTags(r) + (!r.overdue && r.dueDate && r.open ? '<span class="muted">Due ' + esc(U.fmtDateShort(r.dueDate)) + '</span>' : '') + '</span></button>')
            .join('') || '<p class="lane-empty">Nothing here</p>') +
          (items.length > LIMIT ? '<p class="lane-empty">+' + (items.length - LIMIT) + ' more. Use filters to narrow down.</p>' : '') +
          '</div></section>'
        );
      }).join('') +
      '</div>';
  }

  /* ---------- filters sheet ---------- */
  function filterSheet(root) {
    const f = S.filters;
    const body =
      F.facetsFor(S.user)
        .map((fc) => {
          const opts = F.options(DT.app.scoped(), fc);
          return (
            '<details class="facet"' + (f[fc.id].length || fc.id === 'stage' || fc.id === 'cls' ? ' open' : '') + '><summary><span>' + esc(fc.label) + '</span>' + (f[fc.id].length ? '<em class="badge">' + f[fc.id].length + '</em>' : '') + UI.icon('down', 14) + '</summary><div class="facet-list">' +
            opts.map((o) => '<label class="check"><input type="checkbox" data-f="' + fc.id + '" value="' + esc(o.v) + '"' + (f[fc.id].includes(o.v) ? ' checked' : '') + '><span>' + esc(o.label) + '</span><em>' + o.n + '</em></label>').join('') +
            '</div></details>'
          );
        })
        .join('') +
      '<div class="facet-misc"><label class="field"><span>Photos</span><select id="fPhoto"><option value="">Any</option>' + Object.keys(F.PHOTO_OPTIONS).map((k) => '<option value="' + k + '"' + (f.photo === k ? ' selected' : '') + '>' + F.PHOTO_OPTIONS[k] + '</option>').join('') + '</select></label>' +
      '<label class="field"><span>Inspected from</span><input type="date" id="fFrom" value="' + f.from + '"></label><label class="field"><span>Inspected to</span><input type="date" id="fTo" value="' + f.to + '"></label>' +
      '<label class="check"><input type="checkbox" data-flag="overdue"' + (f.overdue ? ' checked' : '') + '><span>Overdue only</span></label>' +
      '<label class="check"><input type="checkbox" data-flag="rework"' + (f.rework ? ' checked' : '') + '><span>In rework only</span></label></div>';
    const m = UI.modal({ title: 'Filters', width: 520, cls: 'sheet-tall', body, footer: '<button class="btn" id="fClear">Clear all</button><button class="btn primary" data-close>Show results</button>', onClose: () => V.render(root) });
    m.el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.f) {
        const arr = f[t.dataset.f];
        if (t.checked) arr.push(t.value);
        else arr.splice(arr.indexOf(t.value), 1);
      } else if (t.dataset.flag) f[t.dataset.flag] = t.checked;
      else if (t.id === 'fPhoto') f.photo = t.value;
      else if (t.id === 'fFrom') f.from = t.value;
      else if (t.id === 'fTo') f.to = t.value;
      S.page = 1;
    });
    U.$('#fClear', m.el).addEventListener('click', () => {
      S.filters = F.empty();
      m.close();
    });
  }

  function columnsSheet() {
    const sel = new Set(S.cols);
    const m = UI.modal({
      title: 'Columns',
      width: 420,
      body: '<p class="confirm-text">Choose what the table shows. Every field is always kept on the defect record.</p><div class="facet-list cols">' + E.visibleColumns().map((c) => '<label class="check"><input type="checkbox" value="' + c.id + '"' + (sel.has(c.id) ? ' checked' : '') + '><span>' + esc(c.label) + '</span></label>').join('') + '</div>',
      footer: '<button class="btn" id="colReset">Reset</button><button class="btn primary" data-close>Done</button>',
      /* columns hidden from this user keep their saved setting for the users who can see them */
      onClose: () => {
        S.cols = E.COLUMNS.filter((c) => sel.has(c.id)).map((c) => c.id);
        if (!S.cols.length) S.cols = ['ref', 'description'];
        DT.store.setKV('cols', S.cols);
        paintResults();
      },
    });
    m.el.addEventListener('change', (e) => (e.target.checked ? sel.add(e.target.value) : sel.delete(e.target.value)));
    U.$('#colReset', m.el).addEventListener('click', () => {
      sel.clear();
      E.COLUMNS.filter((c) => c.def).forEach((c) => sel.add(c.id));
      U.$$('input[type=checkbox]', m.el).forEach((i) => (i.checked = sel.has(i.value)));
    });
  }

  /* ---------- defect panel ---------- */
  const DEFECTS_HASH = '#/defects';
  const setHash = (id) => history.replaceState(null, '', id ? DEFECTS_HASH + '/' + encodeURIComponent(id) : DEFECTS_HASH);

  /* Opens (or refreshes, if already open) the panel for a defect. Arrow keys move through the current list. */
  V.openDefect = (id) => {
    const inList = current().some((r) => r.id === id);
    const list = S.route === 'defects' && inList ? current() : S.all;
    let idx = list.findIndex((r) => r.id === id);
    if (idx < 0) {
      UI.toast('That defect is not available to you.', 'error');
      return;
    }
    const show = (first) => {
      const r = list[idx];
      const html = panelHTML(r, idx, list.length);
      let inner;
      if (first) inner = UI.drawer.open(html, { onKey, onClose: () => S.route === 'defects' && setHash(null) });
      else {
        UI.drawer.setHTML(html);
        UI.drawer.setKeyHandler(onKey);
        inner = UI.drawer.inner;
      }
      if (S.route === 'defects') setHash(r.id);
      bind(inner, r);
    };
    const go = (d) => {
      idx = (idx + d + list.length) % list.length;
      show(false);
    };
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target.tagName || '').toUpperCase())) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), go(1));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), go(-1));
    };
    function bind(inner, r) {
      U.$('[data-dclose]', inner).addEventListener('click', () => UI.drawer.close());
      U.$('[data-dprev]', inner).addEventListener('click', () => go(-1));
      U.$('[data-dnext]', inner).addEventListener('click', () => go(1));
      UI.hydratePhotos(inner);
      inner.onclick = (e) => {
        const ph = e.target.closest('[data-photo]');
        if (ph) {
          const photos = W.visiblePhotos(r, S.user);
          const start = photos.findIndex((p) => p.hash === ph.dataset.photo);
          UI.lightbox(photos.map((p) => ({ hash: p.hash, label: D.photoLabel(p.kind), sub: r.refLabel + ' · ' + (r.location || '') })), Math.max(0, start));
          return;
        }
        const act = e.target.closest('[data-action]');
        if (act) actionDialog(act.dataset.action, r);
      };
      loadHistory(inner, r);
    }
    show(!UI.drawer.isOpen());
  };

  function panelHTML(r, idx, n) {
    const f = (l, v, wide) => (v ? '<div class="kv' + (wide ? ' wide' : '') + '"><dt>' + esc(l) + '</dt><dd>' + esc(v).replace(/\n/g, '<br>') + '</dd></div>' : '');
    const stage = D.stageById[r.stage];
    const actions = W.available(r, S.user);
    const photos = W.visiblePhotos(r, S.user);
    const gallery = (title, list) =>
      list.length ? '<h3>' + esc(title) + ' <em>' + list.length + '</em></h3><div class="gallery">' + list.map((p) => '<button data-photo="' + p.hash + '" aria-label="Open photo"><img data-ph="' + p.hash + '" data-size="thumb" alt="' + esc(title) + '"></button>').join('') + '</div>' : '';
    const step = (label, at, done) => '<li class="' + (done ? 'done' : '') + '"><i></i><b>' + esc(label) + '</b><span>' + (at ? esc(U.fmtDate(U.isoFromDate(new Date(at)))) : done ? '' : 'Not yet') + '</span></li>';
    /* The track shows the current round: after a rejected fix, "Fix submitted" is open again. */
    const fixed = ['submitted', 'awaiting', 'returned', 'closed'].includes(r.stage);
    const approved = r.stage === 'awaiting' || r.stage === 'closed';
    const waitingOn = stage.owner === 'contractor' ? r.contractorName : stage.owner ? stage.owner.toUpperCase() : '';
    return (
      '<header class="d-head"><div class="d-nav"><button class="icon-btn" data-dprev aria-label="Previous defect">' + UI.icon('left') + '</button><span>' + (idx + 1) + ' of ' + n + '</span><button class="icon-btn" data-dnext aria-label="Next defect">' + UI.icon('right') + '</button></div><button class="icon-btn" data-dclose aria-label="Close">' + UI.icon('close') + '</button></header>' +
      '<div class="d-body"><div class="d-title"><span class="d-sn">' + esc(r.refLabel) + ' · S/N ' + esc(r.sn) + '</span><h2>' + esc(r.description || '(No description)') + '</h2><div class="d-tags">' + UI.stagePill(r.stage) + UI.disciplineTag(r.discipline) + UI.classTag(r.classification) +
      (r.overdue ? '<span class="tag" style="--c:#ff9f0a">Overdue ' + r.daysOverdue + ' d</span>' : '') + (r.open && r.rework ? '<span class="tag" style="--c:#ff3b30">Rework</span>' : '') + (r.sample ? '<span class="tag" style="--c:#8e8e93">Sample</span>' : '') + '</div></div>' +
      '<section class="act-card" style="--c:' + stage.color + '"><div class="act-now"><b>' + esc(stage.hint) + '</b>' +
      (waitingOn ? '<span>Waiting on <strong>' + esc(waitingOn) + '</strong>' + (r.dueDate && r.open ? ' · target ' + esc(U.fmtDate(r.dueDate)) : '') + '</span>' : '<span>Closed on ' + esc(U.fmtDate(r.closedOn)) + '</span>') + '</div>' +
      (actions.length
        ? '<div class="act-btns">' + actions.map((id) => '<button class="btn ' + W.ACTIONS[id].tone + '" data-action="' + id + '">' + esc(W.ACTIONS[id].label(r)) + '</button>').join('') + '</div>'
        : '<p class="muted small">' + (r.closed ? 'This defect is closed.' : 'Nothing for you to do on this defect right now.') + '</p>') +
      '</section>' +
      '<ol class="track">' + step('Raised', r.createdAt, true) + step('Assigned', r.assignedAt, !!r.contractorId) + step('Fix submitted', fixed ? r.submittedAt : null, fixed) + step('LTA approved', null, approved) + step('Accepted', r.closedAt, r.closed) + '</ol>' +
      (r.snIssue === 'duplicate' ? '<div class="note-box">The register used S/N <b>' + esc(r.snRaw) + '</b> more than once. This one was numbered <b>' + esc(r.sn) + '</b> so nothing is mixed up.</div>' : '') +
      (r.classSuspect ? '<div class="note-box warn">The Classification cell did not contain a standard classification, so this defect shows as Unclassified. Original text: “' + esc(U.truncate(r.classificationRaw, 200)) + '”</div>' : '') +
      '<dl class="kvs">' + f('Location', r.location) + f('Building', r.building) + f('Level / Room', r.level) + f('Inspection officer', r.officer) + f('Contact person (STEL)', r.contact) + f('Dates of inspection', U.fmtDateList(r.inspDates) || r.inspRaw) +
      f('Contractor', r.contractorName || 'Not assigned') + f('Target date', U.fmtDate(r.dueDate)) + (DT.auth.can('insights') ? f('Age', r.ageDays + ' days' + (r.open ? ' and counting' : ' to close')) : '') + f('Remark', r.remark) + '</dl>' +
      '<dl class="kvs one">' + f('Proposed rectification', r.proposed, true) + f('Contractor’s latest fix note', r.fixNote, true) + '</dl>' +
      gallery('Register photos', photos.filter((p) => p.kind !== 'fix')) + gallery('Contractor fix photos', photos.filter((p) => p.kind === 'fix')) +
      (r.photoNotes && r.photoNotes.length ? '<div class="note-box">Text found on the photos: ' + esc(r.photoNotes.join(' · ')) + '</div>' : '') +
      registerDetails(r) +
      '<h3>History</h3><div id="dHist" class="hist"><div class="skeleton"></div></div>' +
      (W.allowed('comment', r, S.user) ? '<div class="note-form"><textarea rows="2" id="dComment" placeholder="Add a comment for the team…" aria-label="Comment"></textarea><button class="btn sm" data-action="comment">Add comment</button></div>' : '') +
      '</div>'
    );
  }

  /* What the uploaded register said, kept for reference. The workflow does not use these values. */
  function registerDetails(r) {
    const rows = [
      ['Status', r.statusRaw],
      ['Action', r.action],
      ['Timeline to follow-up', r.followUp],
      ['Action party', r.actionParty],
      ['Dates of rectification', r.rectRaw],
      ['Defect rectification', r.rectification],
      ['Date closed', r.closedRaw],
      ['Sign-off', r.signoff],
    ].filter((x) => x[1]);
    if (!rows.length) return '';
    return '<details class="reg"><summary>As written in the register' + UI.icon('down', 14) + '</summary><p class="muted small">For reference only. Progress is tracked in Rectify, not in these columns.</p><dl class="kvs one">' + rows.map((x) => '<div class="kv"><dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]).replace(/\n/g, '<br>') + '</dd></div>').join('') + '</dl></details>';
  }

  async function loadHistory(inner, r) {
    const box = U.$('#dHist', inner);
    const events = W.visibleEvents(await DT.store.getEvents(r.id), S.user);
    if (!box.isConnected) return;
    const fixPhotos = new Set(W.visiblePhotos(r, S.user).map((p) => p.hash));
    box.innerHTML = events
      .slice()
      .reverse()
      .map((e) => {
        const stage = e.toStage && e.toStage !== e.fromStage ? D.stageById[e.toStage] : null;
        const pics = (e.photos || []).filter((h) => fixPhotos.has(h));
        return (
          '<div class="hist-row"><i style="border-color:' + (stage ? stage.color : 'var(--fill2)') + '"></i><div><b>' + esc(W.describe(e, S.contractors)) + '</b><span>' + esc(e.by.name) + ' · ' + esc(U.fmtDateTime(e.at)) + '</span>' +
          (e.note ? '<p class="hist-note">' + esc(e.note).replace(/\n/g, '<br>') + '</p>' : '') +
          (pics.length ? '<div class="hist-pics">' + pics.map((h) => '<button data-photo="' + h + '" aria-label="Open photo"><img data-ph="' + h + '" data-size="thumb" alt="Fix photo"></button>').join('') + '</div>' : '') +
          '</div></div>'
        );
      })
      .join('');
    UI.hydratePhotos(box);
  }

  /* ---------- action dialogs ---------- */
  const PROMPTS = {
    assign: 'Anything the contractor should know (optional)',
    requestInfo: 'What do you need to know before you can fix this?',
    answerInfo: 'Your answer to the contractor',
    submitFix: 'What was done to fix the defect?',
    approveFix: 'Note for STEL (optional)',
    rejectFix: 'Why is the fix not acceptable? The contractor will see this.',
    accept: 'Note (optional)',
    returnToLta: 'Why is the fix not accepted? LTA will see this.',
  };

  function actionDialog(actionId, r) {
    if (actionId === 'comment') return submit(actionId, r, { note: U.$('#dComment').value });
    const a = W.ACTIONS[actionId];
    const photos = [];
    const contractors = Array.from(S.contractors.values());
    const defaultDue = r.dueDate || U.addDays(U.isoToday(), 14);
    const body =
      (actionId === 'assign'
        ? '<label class="field"><span>Contractor</span><select id="aCon"><option value="">Choose a contractor…</option>' + contractors.map((c) => '<option value="' + c.id + '"' + (c.id === r.contractorId ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select></label>' +
          '<label class="field"><span>Target date</span><input type="date" id="aDue" value="' + defaultDue + '" min="' + U.isoToday() + '"></label>'
        : '') +
      (a.photos
        ? '<div class="field"><span>Photos of the completed fix</span><div class="pick-photos" id="aPics"><label class="pick-add">' + UI.icon('camera', 22) + '<span>Add photos</span><input type="file" id="aFile" accept="image/*" multiple hidden></label></div></div>'
        : '') +
      '<label class="field"><span>' + (a.note === 'required' ? 'Note' : 'Note (optional)') + '</span><textarea id="aNote" rows="4" placeholder="' + esc(PROMPTS[actionId]) + '"></textarea></label>' +
      '<div class="login-err" id="aErr" role="alert"></div>';
    const m = UI.modal({
      title: a.label(r),
      width: 520,
      body: '<p class="muted small act-ref">' + esc(r.refLabel) + ' · ' + esc(U.truncate(r.description, 90)) + '</p>' + body,
      footer: '<button class="btn" data-close>Cancel</button><button class="btn ' + (a.tone || 'primary') + '" id="aGo">' + esc(a.label(r)) + '</button>',
    });
    if (a.photos) {
      const file = U.$('#aFile', m.el);
      const strip = U.$('#aPics', m.el);
      file.addEventListener('change', async () => {
        const chosen = Array.from(file.files);
        file.value = '';
        for (const fl of chosen) {
          try {
            const bytes = new Uint8Array(await fl.arrayBuffer());
            const media = await DT.parser.processImage(bytes, fl.type, { rot: 0 });
            const hash = U.hashBytes(bytes);
            if (photos.some((p) => p.hash === hash)) continue;
            photos.push({ hash, media });
            const tile = document.createElement('div');
            tile.className = 'pick-tile';
            tile.innerHTML = '<img alt="Fix photo"><button type="button" class="icon-btn sm" aria-label="Remove photo">' + UI.icon('close', 14) + '</button>';
            const url = URL.createObjectURL(media.thumb);
            U.$('img', tile).src = url;
            U.$('button', tile).addEventListener('click', () => {
              photos.splice(photos.findIndex((p) => p.hash === hash), 1);
              URL.revokeObjectURL(url);
              tile.remove();
            });
            strip.insertBefore(tile, U.$('.pick-add', strip));
          } catch (e) {
            UI.toast(fl.name + ' could not be read as a photo.', 'error');
          }
        }
      });
    }
    U.$('#aGo', m.el).addEventListener('click', async () => {
      const input = { note: U.$('#aNote', m.el).value, photos };
      if (actionId === 'assign') {
        input.contractorId = U.$('#aCon', m.el).value;
        input.dueDate = U.$('#aDue', m.el).value;
      }
      const ok = await submit(actionId, r, input, U.$('#aErr', m.el), U.$('#aGo', m.el));
      if (ok) m.close();
    });
  }

  async function submit(actionId, r, input, errEl, btn) {
    try {
      if (btn) btn.disabled = true;
      const res = await DT.app.act(actionId, r.id, input);
      const sentTo = Array.from(new Set(res.outbox.map((o) => o.toName)));
      UI.toast(actionId === 'comment' ? 'Comment added' : W.ACTIONS[actionId].past + (sentTo.length ? ' · email to ' + sentTo.join(' and ') + ' queued' : ''), 'success');
      refreshAfterAction(r.id);
      return true;
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
      else UI.toast(e.message, 'error');
      if (btn) btn.disabled = false;
      return false;
    }
  }

  /* Repaint the page behind the panel and the panel itself after data changed. */
  function refreshAfterAction(id) {
    DT.app.paintBadges();
    if (S.route === 'defects') {
      const y = window.scrollY;
      V.render(U.$('#view'));
      window.scrollTo(0, y);
    } else DT.views[S.route].render(U.$('#view'));
    if (DT.app.findDefect(id)) V.openDefect(id);
    else UI.drawer.close();
  }
})();


