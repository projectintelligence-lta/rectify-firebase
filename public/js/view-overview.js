/* js/view-overview.js */
/* Rectify — Overview: a dashboard for each role */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain,
    UI = DT.ui,
    S = DT.state,
    W = DT.workflow,
    esc = U.esc;
  const V = (DT.views.overview = {});

  const PALETTE = ['#0071e3', '#5ac8fa', '#af52de', '#ff9f0a', '#34c759', '#ff6482', '#8e8e93'];
  const QUEUE_LIMIT = 8;
  const DUE_SOON_DAYS = 7;
  const inStages = (list, ids) => list.filter((r) => ids.includes(r.stage)).length;

  /* KPI tiles per role: [label, value, colour, filters to open on click, highlight when > 0] */
  function tiles(all, st) {
    const today = U.isoToday();
    const soon = U.addDays(today, DUE_SOON_DAYS);
    const withLta = ['new', 'info', 'submitted', 'returned'];
    switch (S.user.role) {
      case 'stel':
        return [
          ['Awaiting my acceptance', st.byStage.awaiting, '#30b0c7', { stage: ['awaiting'] }, true],
          ['Open', st.open, '#ff9f0a', { stage: D.OPEN_STAGES.slice() }],
          ['Safety Related, open', st.safetyOpen, '#ff3b30', { stage: D.OPEN_STAGES.slice(), cls: ['Safety Related'] }, true],
          ['Overdue', st.overdue, '#ff3b30', { overdue: true }],
          ['Closed', st.closed, '#34c759', { stage: ['closed'] }],
          ['Total raised', st.total, '#6e6e73', {}],
        ];
      case 'lta':
        return [
          ['To assign', st.byStage.new + st.byStage.returned, '#5e5ce6', { stage: ['new', 'returned'] }, true],
          ['Information requests', st.byStage.info, '#bf5af2', { stage: ['info'] }, true],
          ['Fixes to review', st.byStage.submitted, '#0071e3', { stage: ['submitted'] }, true],
          ['With contractors', st.byStage.assigned, '#ff9f0a', { stage: ['assigned'] }],
          ['Overdue', st.overdue, '#ff3b30', { overdue: true }],
          ['Closed', st.closed, '#34c759', { stage: ['closed'] }],
        ];
      case 'contractor':
        return [
          ['My open jobs', inStages(all, D.CONTRACTOR_STAGES), '#ff9f0a', { stage: D.CONTRACTOR_STAGES.slice() }],
          ['Due within ' + DUE_SOON_DAYS + ' days', all.filter((r) => D.CONTRACTOR_STAGES.includes(r.stage) && !r.overdue && r.dueDate && r.dueDate <= soon).length, '#0071e3', { stage: D.CONTRACTOR_STAGES.slice() }],
          ['Overdue', st.overdue, '#ff3b30', { overdue: true }, true],
          ['Rework', st.rework, '#ff3b30', { rework: true }, true],
          ['With LTA / STEL', inStages(all, ['submitted', 'awaiting', 'returned']), '#30b0c7', { stage: ['submitted', 'awaiting', 'returned'] }],
          ['Closed', st.closed, '#34c759', { stage: ['closed'] }],
        ];
      default:
        return [
          ['Open', st.open, '#ff9f0a', { stage: D.OPEN_STAGES.slice() }],
          ['With LTA', inStages(all, withLta), '#5e5ce6', { stage: withLta }],
          ['With contractors', st.byStage.assigned + st.byStage.info, '#ff9f0a', { stage: D.CONTRACTOR_STAGES.slice() }],
          ['Awaiting STEL', st.byStage.awaiting, '#30b0c7', { stage: ['awaiting'] }],
          ['Overdue', st.overdue, '#ff3b30', { overdue: true }, true],
          ['Closed', st.closed, '#34c759', { stage: ['closed'] }],
        ];
    }
  }

  V.render = (root) => {
    const all = DT.app.scoped();
    const compareDisciplines = DT.app.seesBothDisciplines() && S.discipline === 'all';
    const st = D.summarize(all);
    const viewAll = DT.auth.can('viewAll');
    const kpis = tiles(all, st);
    const queue = queueItems(all);
    const queueTitle = S.user.role === 'admin' ? 'Needs attention' : 'Your queue';
    const queueSub = S.user.role === 'admin' ? 'Overdue and Safety Related defects that are still open' : 'Defects waiting for your action, most urgent first';
    const greeting = S.user.name + (S.discipline === 'all' ? '' : ' · ' + D.disciplineById[S.discipline].label + ' only');

    root.innerHTML =
      '<div class="page-head"><div><h1>Overview</h1><p class="lede">' + esc(greeting) + ' · ' + esc(U.plural(st.open, 'open defect')) + ', ' + esc(U.plural(queue.total, 'item')) + ' ' + (S.user.role === 'admin' ? 'needing attention' : 'waiting for you') + '.</p></div>' +
      '<div class="head-actions"><div id="ovDisc"></div><button class="btn" id="ovExport">' + UI.icon('download', 16) + '<span>Export</span></button></div></div>' +
      '<section class="kpis">' +
      kpis.map((t, i) => '<button class="kpi' + (t[4] && t[1] > 0 ? ' hot' : '') + '" data-i="' + i + '" style="--c:' + t[2] + ';--d:' + i * 60 + 'ms"><span class="kpi-l">' + esc(t[0]) + '</span><span class="kpi-v" data-to="' + t[1] + '">0</span></button>').join('') +
      '</section>' +
      '<section class="grid g3">' +
      '<article class="card span2"><header class="card-h"><h2>' + esc(queueTitle) + '</h2><p>' + esc(queueSub) + '</p></header><div id="cQueue"></div></article>' +
      '<article class="card"><header class="card-h"><h2>Where defects stand</h2><p>By workflow stage</p></header><div id="cStage"></div></article>' +
      '</section>' +
      (compareDisciplines ? '<section class="grid"><article class="card"><header class="card-h"><h2>Civil and E&amp;M</h2><p>Open defects of each discipline by stage. Click a bar to see those defects.</p></header><div id="cDisc"></div></article></section>' : '') +
      '<section class="grid g3">' +
      '<article class="card span2"><header class="card-h"><h2>Open and closed over time</h2><p>' + (viewAll ? 'All defects' : 'Your defects') + '</p></header><div id="cTrend"></div></article>' +
      '<article class="card"><header class="card-h"><h2>Classification</h2><p>' + (viewAll ? 'All defects' : 'Your defects') + '</p></header><div id="cClass"></div></article>' +
      '</section>' +
      (viewAll
        ? '<section class="grid g2"><article class="card"><header class="card-h"><h2>Contractor workload</h2><p>Open defects by stage</p></header><div id="cParty"></div></article>' +
          '<article class="card"><header class="card-h"><h2>Contractor performance</h2><p>Across all their defects</p></header><div id="cPerf"></div></article></section>'
        : '') +
      '<section class="grid g2">' +
      '<article class="card"><header class="card-h"><h2>How long open defects have waited</h2><p>Days since inspection</p></header><div id="cAge"></div></article>' +
      (viewAll ? '<article class="card"><header class="card-h"><h2>By building</h2><p>Defect count, top 8</p></header><div id="cBuilding"></div></article>' : '<article class="card"><header class="card-h"><h2>Coming up</h2><p>Your open jobs by target date</p></header><div id="cDue"></div></article>') +
      '</section>' +
      (viewAll
        ? '<section class="grid g2"><article class="card"><header class="card-h"><h2>By location</h2><p>Defect count, top 8</p></header><div id="cLocation"></div></article>' +
          '<article class="card"><header class="card-h"><h2>Raised by</h2><p>Inspection officer / department</p></header><div id="cOfficer"></div></article></section>'
        : '');

    DT.app.disciplineSwitch(U.$('#ovDisc'), () => V.render(root));
    U.$$('.kpi-v', root).forEach((el) => U.countUp(el, +el.dataset.to));
    if (compareDisciplines) paintDisciplineChart(all);
    U.$$('.kpi', root).forEach((k) => k.addEventListener('click', () => DT.views.goDefects(kpis[+k.dataset.i][3])));
    U.$('#ovExport').addEventListener('click', (e) => DT.views.exportMenu(e.currentTarget, () => all));

    paintQueue(U.$('#cQueue'), queue);
    DT.charts.donut(U.$('#cStage'), {
      label: 'Defects by stage',
      centerValue: st.open,
      centerLabel: 'open',
      items: D.STAGES.map((s) => ({ id: s.id, label: s.label, value: st.byStage[s.id], color: s.color })),
      onClick: (it) => DT.views.goDefects({ stage: [it.id] }),
    });
    const trend = trendSeries(all);
    DT.charts.line(U.$('#cTrend'), {
      label: 'Open and closed over time',
      labels: trend.labels,
      series: [
        { name: 'Open', color: '#ff9f0a', values: trend.open, area: true },
        { name: 'Closed', color: '#34c759', values: trend.closed },
      ],
      emptyTitle: 'The trend builds up over the coming days.',
      emptyText: 'Each day adds a point as defects move through the flow.',
    });
    DT.charts.hbar(U.$('#cClass'), {
      items: D.CLASSES.map((c) => ({ id: c.id, label: c.id, value: st.byClass[c.id] || 0, color: c.color })).filter((x) => x.value),
      onClick: (it) => DT.views.goDefects({ cls: [it.id] }),
      unit: 'defects',
    });

    const open = all.filter((r) => r.open);
    const ramp = ['#86c8ff', '#4aa3ff', '#0071e3', '#ff9f0a', '#ff3b30'];
    DT.charts.vbar(U.$('#cAge'), {
      items: D.ageBucketLabels().map((b, i) => ({ label: b.label, value: open.filter((r) => r.ageDays >= b.min && r.ageDays <= b.max).length, color: ramp[Math.min(i, ramp.length - 1)] })),
      unit: 'open defects',
    });

    if (viewAll) {
      paintContractorCharts(all);
      const top = (fn) => Array.from(D.countBy(all, fn).entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
      DT.charts.hbar(U.$('#cBuilding'), { items: top((r) => r.building || '—').map(([k, v]) => ({ label: k, value: v })), onClick: (it) => DT.views.goDefects({ building: [it.label] }), unit: 'defects' });
      DT.charts.hbar(U.$('#cLocation'), { items: top((r) => r.location || '—').map(([k, v]) => ({ label: k, value: v, color: '#5ac8fa' })), onClick: (it) => DT.views.goDefects({ location: [it.label] }), unit: 'defects' });
      DT.charts.hbar(U.$('#cOfficer'), { items: top((r) => r.officer || '—').map(([k, v]) => ({ label: k, value: v, color: '#af52de' })), onClick: (it) => DT.views.goDefects({ officer: [it.label] }), unit: 'defects' });
    } else paintDueSoon(U.$('#cDue'), all);
  };

  /* ---------- queue ---------- */
  function queueItems(all) {
    const items = S.user.role === 'admin' ? all.filter((r) => r.open && (r.overdue || r.classification === 'Safety Related')) : all.filter((r) => W.isMine(r, S.user));
    items.sort((a, b) => b.overdue - a.overdue || b.daysOverdue - a.daysOverdue || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.ageDays - a.ageDays || D.refOrder(a) - D.refOrder(b));
    return { list: items.slice(0, QUEUE_LIMIT), total: items.length };
  }
  function paintQueue(box, q) {
    if (!q.total) {
      box.innerHTML = UI.empty('check', 'All clear', S.user.role === 'admin' ? 'No overdue or Safety Related defects are open.' : 'Nothing is waiting for you right now.');
      return;
    }
    box.innerHTML =
      '<ul class="attn">' +
      q.list.map((r) => '<li><button data-id="' + r.id + '"><span class="attn-sn">' + esc(r.refLabel) + '</span><span class="attn-main"><b>' + esc(U.truncate(r.description, 70)) + '</b><span>' + esc(D.stageById[r.stage].label) + ' · ' + esc([r.location, r.building].filter(Boolean).join(' · ')) + (r.contractorName && S.user.role !== 'contractor' ? ' · ' + esc(r.contractorName) : '') + '</span></span><span class="attn-tags">' + (DT.app.seesBothDisciplines() ? UI.disciplineTag(r.discipline) : '') + (r.classification === 'Safety Related' ? UI.classTag('Safety Related') : '') + (r.overdue ? '<span class="tag" style="--c:#ff9f0a">Overdue ' + r.daysOverdue + ' d</span>' : '') + (r.open && r.rework ? '<span class="tag" style="--c:#ff3b30">Rework</span>' : '') + '</span></button></li>').join('') +
      '</ul>' +
      (q.total > q.list.length || S.user.role !== 'admin' ? '<button class="link" id="qAll">See all ' + q.total + ' ' + UI.icon('right', 14) + '</button>' : '');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-id]');
      if (b) DT.views.defects.openDefect(b.dataset.id);
      if (e.target.closest('#qAll')) DT.views.goDefects(S.user.role === 'admin' ? { stage: D.OPEN_STAGES.slice() } : { mine: true });
    });
  }

  /* ---------- Civil and E&M side by side (accounts that see both) ---------- */
  function paintDisciplineChart(all) {
    DT.charts.stacked(U.$('#cDisc'), {
      rows: D.DISCIPLINES.map((dc) => ({
        id: dc.id,
        label: dc.label,
        segments: D.STAGES.filter((s) => s.id !== 'closed').map((s) => ({ id: s.id, label: s.label, color: s.color, value: all.filter((r) => r.discipline === dc.id && r.stage === s.id).length })),
      })),
      onClick: (row, seg) => {
        S.discipline = row.id;
        DT.views.goDefects({ stage: [seg.id] });
      },
    });
    U.$('#cDisc').insertAdjacentHTML('beforeend', '<div class="legend inline">' + D.STAGES.filter((s) => s.id !== 'closed').map((s) => '<span class="legend-row static"><i style="background:' + s.color + '"></i>' + esc(s.short) + '</span>').join('') + '</div>');
  }

  /* ---------- contractor charts (Admin, STEL, LTA) ---------- */
  function paintContractorCharts(all) {
    const assigned = all.filter((r) => r.contractorId);
    const names = Array.from(S.contractors.values()).map((c) => c.name);
    DT.charts.stacked(U.$('#cParty'), {
      rows: names
        .map((n) => ({ label: n, segments: D.STAGES.filter((s) => s.id !== 'closed').map((s) => ({ id: s.id, label: s.label, color: s.color, value: assigned.filter((r) => r.contractorName === n && r.stage === s.id).length })) }))
        .sort((a, b) => b.segments.reduce((x, s) => x + s.value, 0) - a.segments.reduce((x, s) => x + s.value, 0)),
      onClick: (row, seg) => DT.views.goDefects({ contractor: [row.label], stage: [seg.id] }),
    });
    const perf = names.map((n) => {
      const mine = assigned.filter((r) => r.contractorName === n);
      const fixed = mine.filter((r) => r.submittedAt && r.assignedAt && r.submittedAt > r.assignedAt);
      const avg = fixed.length ? Math.round(fixed.reduce((a, r) => a + (r.submittedAt - r.assignedAt), 0) / fixed.length / 864e5) : null;
      return { n, open: mine.filter((r) => r.open).length, overdue: mine.filter((r) => r.overdue).length, rework: mine.filter((r) => r.open && r.rework).length, closed: mine.filter((r) => r.closed).length, avg };
    });
    U.$('#cPerf').innerHTML = perf.length
      ? '<div class="hscroll"><table class="mini-table perf"><thead><tr><th>Contractor</th><th class="r">Open</th><th class="r">Overdue</th><th class="r">Rework</th><th class="r">Closed</th><th class="r">Avg days to fix</th></tr></thead><tbody>' +
        perf.map((p) => '<tr><td><b>' + esc(p.n) + '</b></td><td class="r">' + p.open + '</td><td class="r' + (p.overdue ? ' late' : '') + '">' + p.overdue + '</td><td class="r">' + p.rework + '</td><td class="r">' + p.closed + '</td><td class="r">' + (p.avg == null ? '–' : p.avg) + '</td></tr>').join('') +
        '</tbody></table></div>'
      : '<div class="muted">No contractors set up yet.</div>';
  }

  /* ---------- contractor: upcoming target dates ---------- */
  function paintDueSoon(box, all) {
    const jobs = all.filter((r) => D.CONTRACTOR_STAGES.includes(r.stage) && r.dueDate).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    if (!jobs.length) {
      box.innerHTML = '<div class="muted">No open jobs with a target date.</div>';
      return;
    }
    DT.charts.hbar(box, {
      items: jobs.slice(0, 8).map((r) => ({ label: r.refLabel + ' · ' + U.fmtDateShort(r.dueDate), value: r.overdue ? r.daysOverdue : U.daysBetween(U.isoToday(), r.dueDate), color: r.overdue ? '#ff3b30' : PALETTE[0], id: r.id })),
      onClick: (it) => DT.views.defects.openDefect(it.id),
      unit: 'days (overdue in red)',
    });
  }

  /* ---------- trend: open / closed count at the end of each day (weekly over longer spans) ---------- */
  function trendSeries(all) {
    const dayOf = (ms) => U.isoFromDate(new Date(ms));
    const today = U.isoToday();
    const created = all.map((r) => dayOf(r.createdAt));
    const closed = all.map((r) => (r.closedAt ? dayOf(r.closedAt) : null));
    if (!created.length) return { labels: [], open: [], closed: [] };
    const first = created.reduce((a, b) => (a < b ? a : b));
    const span = U.daysBetween(first, today);
    const step = span > 60 ? 7 : 1;
    /* oldest first; counted back from today so the last point is always today */
    const points = [];
    for (let d = 0; d <= span; d += step) points.unshift(U.addDays(today, -d));
    if (points[0] !== first) points.unshift(first);
    return {
      labels: points.map(U.fmtDateShort),
      open: points.map((p) => created.filter((c, i) => c <= p && !(closed[i] && closed[i] <= p)).length),
      closed: points.map((p) => closed.filter((c) => c && c <= p).length),
    };
  }
})();


