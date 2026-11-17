/* js/exporter.js */
/* Rectify — column definitions and exports (CSV, Excel, PDF via print) */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain;
  const E = (DT.exporter = {});
  const esc = U.esc;

  const stageIdx = (r) => D.STAGES.findIndex((s) => s.id === r.stage);
  const clsIdx = (r) => D.CLASSES.findIndex((c) => c.id === r.classification);

  const ownerLabel = (r) => (r.owner === 'contractor' ? r.contractorName || 'Contractor' : r.owner ? r.owner.toUpperCase() : '');
  const fixDate = (r) => (r.submittedAt ? U.isoFromDate(new Date(r.submittedAt)) : '');

  /* Table and export columns. `text` = plain text for export & search; `sort` = comparable value. */
  E.COLUMNS = [
    { id: 'ref', label: 'Ref', def: true, text: (r) => r.refLabel, sort: D.refOrder, num: true },
    { id: 'discipline', label: 'Discipline', def: true, text: (r) => r.disciplineLabel, sort: (r) => r.discipline },
    { id: 'sn', label: 'S/N', def: true, text: (r) => r.sn, sort: (r) => r.sn, nat: true },
    { id: 'stage', label: 'Stage', def: true, text: (r) => D.stageById[r.stage].label, sort: stageIdx },
    { id: 'classification', label: 'Classification', def: true, text: (r) => r.classification, sort: clsIdx },
    { id: 'location', label: 'Location', def: true, text: (r) => r.location, sort: (r) => D.norm(r.location) },
    { id: 'building', label: 'Building', def: true, text: (r) => r.building, sort: (r) => D.norm(r.building), nat: true },
    { id: 'level', label: 'Level / Room', def: false, text: (r) => r.level, sort: (r) => D.norm(r.level), nat: true },
    { id: 'description', label: 'Description', def: true, text: (r) => r.description, sort: (r) => D.norm(r.description) },
    { id: 'contractor', label: 'Contractor', def: true, text: (r) => r.contractorName, sort: (r) => D.norm(r.contractorName) },
    { id: 'due', label: 'Target date', def: true, text: (r) => U.fmtDate(r.dueDate), sort: (r) => r.dueDate || '9999' },
    { id: 'age', label: 'Age', def: true, insight: true, text: (r) => r.ageDays + ' d', sort: (r) => r.ageDays, num: true },
    { id: 'photos', label: 'Photos', def: true, text: (r) => r.nRegister + ' register / ' + r.nFix + ' fix', sort: (r) => r.nRegister + r.nFix, num: true },
    { id: 'owner', label: 'Waiting on', def: false, text: ownerLabel, sort: ownerLabel },
    { id: 'officer', label: 'Inspection officer', def: false, text: (r) => r.officer, sort: (r) => D.norm(r.officer) },
    { id: 'inspDates', label: 'Dates of inspection', def: false, text: (r) => U.fmtDateList(r.inspDates) || r.inspRaw, sort: (r) => r.raisedOn },
    { id: 'proposed', label: 'Proposed rectification', def: false, text: (r) => r.proposed, sort: (r) => D.norm(r.proposed) },
    { id: 'action', label: 'Action (register)', def: false, text: (r) => r.action, sort: (r) => D.norm(r.action) },
    { id: 'contact', label: 'Contact person', def: false, text: (r) => r.contact, sort: (r) => D.norm(r.contact) },
    { id: 'fixNote', label: 'Contractor’s fix note', def: false, text: (r) => r.fixNote || '', sort: (r) => D.norm(r.fixNote) },
    { id: 'closedDate', label: 'Date closed', def: false, text: (r) => U.fmtDate(r.closedOn), sort: (r) => r.closedOn || '' },
    { id: 'remark', label: 'Remark', def: false, text: (r) => r.remark, sort: (r) => D.norm(r.remark) },
  ];

  /* Export layout = the 20 register columns in their original order, filled from the app, then the workflow columns.
   * h = header, w = column width in Excel, v = value; `insight` columns are left out for users without that permission. */
  const ORIGINAL = [
    { h: 'S/N', w: 5, v: (r) => r.sn },
    { h: 'Status', w: 9, v: (r) => (r.closed ? 'Closed' : 'Open') },
    { h: 'Inspection Officer / Comment by (Dept & Name)', w: 24, v: (r) => r.officer },
    { h: 'Dates of Inspection(s)', w: 18, v: (r) => U.fmtDateList(r.inspDates) || r.inspRaw },
    { h: 'Dates of Rectification(s) by LTA', w: 16, v: (r) => U.fmtDate(fixDate(r)) },
    { h: "Defect's Date Closed", w: 14, v: (r) => U.fmtDate(r.closedOn) },
    { h: 'Location', w: 16, v: (r) => r.location },
    { h: 'Building No', w: 12, v: (r) => r.building },
    { h: 'Level / Rm Name / Rm No.', w: 20, v: (r) => r.level },
    { h: 'Defect Description', w: 44, v: (r) => r.description },
    { h: 'Proposed Rectification / Improvements', w: 40, v: (r) => r.proposed },
    { h: 'Defect Classification', w: 16, v: (r) => r.classification },
    { h: 'Defect Photos (register / fix count)', w: 12, v: (r) => r.nRegister + ' / ' + r.nFix },
    { h: 'Action', w: 26, v: (r) => r.action },
    { h: 'Timeline to Follow-up (by LTA)', w: 16, v: (r) => U.fmtDate(r.dueDate) },
    { h: 'Contact Person (STEL)', w: 16, v: (r) => r.contact },
    { h: 'Action Party (LTA)', w: 20, v: (r) => r.contractorName },
    { h: 'Defect Rectification (by LTA)', w: 40, v: (r) => r.fixNote || '' },
    { h: 'Sign-Off by STEL', w: 26, v: (r) => (r.closed ? 'Accepted by STEL on ' + U.fmtDate(r.closedOn) : '') },
    { h: 'Remark', w: 14, v: (r) => r.remark },
    { h: 'Rectify ref', w: 10, v: (r) => r.refLabel },
    { h: 'Discipline', w: 10, v: (r) => r.disciplineLabel },
    { h: 'Stage', w: 24, v: (r) => D.stageById[r.stage].label },
    { h: 'Waiting on', w: 16, v: ownerLabel },
    { h: 'Rework', w: 9, v: (r) => (r.open && r.rework ? 'Yes' : '') },
    { h: 'Age (days)', w: 10, insight: true, v: (r) => r.ageDays },
    { h: 'Overdue', w: 12, v: (r) => (r.overdue ? 'Yes (' + r.daysOverdue + ' d)' : '') },
  ];
  const exportColumns = () => ORIGINAL.filter((c) => !c.insight || DT.auth.can('insights'));
  const matrix = (rows, cols) => [cols.map((c) => c.h)].concat(rows.map((r) => cols.map((c) => c.v(r))));
  /* Table columns the current user may see */
  E.visibleColumns = () => E.COLUMNS.filter((c) => !c.insight || DT.auth.can('insights'));

  E.csv = (rows) => {
    const body = matrix(rows, exportColumns()).map((r) => r.map(U.csvEscape).join(',')).join('\r\n');
    return new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' });
  };

  /* Summary sheet: overall counts by stage and classification */
  function appendSummary(wb, rows, ctx) {
    const s = D.summarize(rows);
    const sum = [
      [D.APP_NAME + ' – defect summary'],
      ['As of', U.fmtDate(U.isoToday())],
      ['Filters', ctx.filtersText || 'None'],
      [],
      ['Measure', 'Count'],
      ['Total defects', s.total],
      ['Open', s.open],
      ['Closed', s.closed],
      ['Safety Related, still open', s.safetyOpen],
      ['Overdue (past target date)', s.overdue],
      ['In rework', s.rework],
      [],
      ['Stage', 'Count'],
    ]
      .concat(D.STAGES.map((st) => [st.label, s.byStage[st.id]]))
      .concat([[], ['Classification', 'Count']])
      .concat(D.CLASSES.map((c) => [c.id, s.byClass[c.id] || 0]));
    const w2 = XLSX.utils.aoa_to_sheet(sum);
    w2['!cols'] = [{ wch: 34 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(wb, w2, 'Summary');
  }

  E.xlsx = (rows, ctx) => {
    const wb = XLSX.utils.book_new();
    const cols = exportColumns();
    const m = matrix(rows, cols);
    const ws = XLSX.utils.aoa_to_sheet(m);
    ws['!cols'] = cols.map((c) => ({ wch: c.w }));
    ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: m.length - 1, c: m[0].length - 1 } }) };
    XLSX.utils.book_append_sheet(wb, ws, 'Defects');
    if (DT.auth.can('insights')) appendSummary(wb, rows, ctx);

    if (ctx.imports && ctx.imports.length) {
      const up = [['Uploaded', 'File', 'By', 'New defects', 'Already in system']].concat(ctx.imports.map((i) => [U.fmtDateTime(i.at), i.fileName, i.by.name, i.added, i.skipped]));
      const w3 = XLSX.utils.aoa_to_sheet(up);
      w3['!cols'] = [{ wch: 20 }, { wch: 36 }, { wch: 14 }, { wch: 12 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, w3, 'Uploads');
    }
    return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' });
  };

  /* ---------- printable report (Save as PDF from the print dialog) ---------- */
  E.print = async (rows, ctx, opts) => {
    opts = opts || {};
    const insights = DT.auth.can('insights');
    const s = D.summarize(rows);
    const root = U.$('#printRoot');
    const kpi = (n, l) => '<div class="pr-kpi"><b>' + n + '</b><span>' + esc(l) + '</span></div>';
    const bar = (label, n, color) =>
      '<tr><td>' + esc(label) + '</td><td class="pr-bar"><i style="width:' + (s.total ? (n / s.total) * 100 : 0) + '%;background:' + color + '"></i></td><td class="r">' + n + '</td></tr>';
    let html =
      '<section class="pr-page"><header class="pr-head"><div><h1>' + esc(D.APP_NAME) + '</h1><p>Defect report</p></div><div class="pr-meta">' +
      'As of ' + U.fmtDate(U.isoToday()) + (ctx.user ? '<br>Printed by ' + esc(ctx.user) : '') + '</div></header>' +
      (ctx.filtersText ? '<p class="pr-filter">Filtered view: ' + esc(ctx.filtersText) + '</p>' : '') +
      (insights ? '<div class="pr-kpis">' + kpi(s.total, 'Defects') + kpi(s.open, 'Open') + kpi(s.safetyOpen, 'Safety Related, open') + kpi(s.byStage.awaiting, 'Awaiting STEL acceptance') + kpi(s.overdue, 'Overdue') + kpi(s.closed, 'Closed') + '</div>' +
      '<div class="pr-cols"><div><h2>By stage</h2><table class="pr-mini">' + D.STAGES.map((st) => bar(st.label, s.byStage[st.id], st.color)).join('') + '</table></div>' +
      '<div><h2>By classification</h2><table class="pr-mini">' + D.CLASSES.map((c) => bar(c.id, s.byClass[c.id] || 0, c.color)).join('') + '</table></div></div>' : '') +
      '<h2>Defect list (' + rows.length + ')</h2><table class="pr-table"><thead><tr><th>Ref</th><th>Discipline</th><th>S/N</th><th>Stage</th><th>Class</th><th>Location · Building · Level</th><th>Description</th><th>Contractor</th><th>Target</th>' + (insights ? '<th>Age</th>' : '') + '</tr></thead><tbody>' +
      rows.map((r) =>
        '<tr><td>' + esc(r.refLabel) + '</td><td>' + esc(r.disciplineLabel) + '</td><td>' + esc(r.sn) + '</td><td>' + esc(D.stageById[r.stage].short) + (r.overdue ? '<br><em>overdue</em>' : '') + '</td><td>' + esc(r.classification) + '</td><td>' + esc([r.location, r.building, r.level].filter(Boolean).join(' · ')) + '</td><td>' + esc(r.description) + '</td><td>' + esc(r.contractorName) + '</td><td>' + esc(U.fmtDate(r.dueDate)) + '</td>' + (insights ? '<td>' + r.ageDays + ' d</td>' : '') + '</tr>'
      ).join('') + '</tbody></table></section>';

    if (opts.photos) {
      html += rows.map((r) => {
        const fig = (fix) => r.photos.filter((p) => (p.kind === 'fix') === fix).slice(0, 6).map((p) => '<figure><img data-hash="' + p.hash + '" alt=""></figure>').join('');
        const f = (l, v) => (v ? '<dt>' + esc(l) + '</dt><dd>' + esc(v).replace(/\n/g, '<br>') + '</dd>' : '');
        return '<section class="pr-page pr-detail"><h2>' + esc(r.refLabel) + ' · ' + esc(r.disciplineLabel) + ' · S/N ' + esc(r.sn) + ' · ' + esc(D.stageById[r.stage].label) + ' · ' + esc(r.classification) + '</h2><dl>' +
          f('Location', [r.location, r.building, r.level].filter(Boolean).join(' · ')) + f('Description', r.description) + f('Proposed rectification', r.proposed) +
          f('Inspection', U.fmtDateList(r.inspDates) || r.inspRaw) + f('Contractor', r.contractorName) + f('Target date', U.fmtDate(r.dueDate)) + f('Contractor’s fix note', r.fixNote) +
          f('Accepted by STEL', U.fmtDate(r.closedOn)) + f('Remark', r.remark) +
          '</dl>' + (r.nRegister ? '<h3>Register photos</h3><div class="pr-photos">' + fig(false) + '</div>' : '') + (r.nFix ? '<h3>Contractor fix photos</h3><div class="pr-photos">' + fig(true) + '</div>' : '') + '</section>';
      }).join('');
    }
    root.innerHTML = html;
    if (opts.photos) {
      const imgs = U.$$('img[data-hash]', root);
      await Promise.all(imgs.map(async (im) => {
        im.src = await DT.store.photoURL(im.dataset.hash, 'thumb');
        try { await im.decode(); } catch (e) { /* ignore */ }
      }));
    }
    document.body.classList.add('printing');
    const done = () => {
      document.body.classList.remove('printing');
      root.innerHTML = '';
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    await U.sleep(60);
    window.print();
    setTimeout(() => document.body.classList.contains('printing') && done(), 1500);
  };
})();


