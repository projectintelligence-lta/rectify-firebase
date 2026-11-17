/* js/filters.js */
/* Rectify — filtering model */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain;
  const F = (DT.filters = {});

  F.empty = () => ({ q: '', stage: [], cls: [], contractor: [], building: [], location: [], officer: [], remark: [], photo: '', overdue: false, rework: false, mine: false, upload: '', from: '', to: '' });

  F.FACETS = [
    { id: 'stage', label: 'Stage', get: (r) => r.stage, name: (v) => D.stageById[v].label, order: D.STAGES.map((s) => s.id) },
    { id: 'cls', label: 'Classification', get: (r) => r.classification, name: (v) => v, order: D.CLASSES.map((c) => c.id) },
    { id: 'contractor', label: 'Contractor', get: (r) => r.contractorName || 'Not assigned', name: (v) => v, viewAll: true },
    { id: 'building', label: 'Building', get: (r) => r.building || '—', name: (v) => v },
    { id: 'location', label: 'Location', get: (r) => r.location || '—', name: (v) => v },
    { id: 'officer', label: 'Inspection officer', get: (r) => r.officer || '—', name: (v) => v },
    { id: 'remark', label: 'Remark', get: (r) => r.remark || '—', name: (v) => v },
  ];
  /* Facets a user is offered (contractors only ever see their own company) */
  F.facetsFor = (user) => F.FACETS.filter((fc) => !fc.viewAll || DT.auth.ROLES[user.role].can.includes('viewAll'));

  const hay = (r) =>
    r._hay ||
    (r._hay = [r.refLabel, r.disciplineLabel, r.sn, r.description, r.location, r.building, r.level, r.officer, r.action, r.proposed, r.contact, r.contractorName, r.remark, r.followUp, r.classificationRaw, r.fixNote]
      .join(' \n ')
      .toLowerCase());

  F.apply = (list, f, user) => {
    const terms = f.q.trim() ? f.q.trim().toLowerCase().split(/\s+/) : [];
    return list.filter((r) => {
      for (const fc of F.FACETS) {
        const sel = f[fc.id];
        if (sel.length && !sel.includes(fc.get(r))) return false;
      }
      if (f.upload && r.importId !== f.upload) return false;
      if (f.overdue && !r.overdue) return false;
      if (f.rework && !(r.open && r.rework)) return false;
      if (f.mine && !DT.workflow.isMine(r, user)) return false;
      if (f.photo) {
        if (f.photo === 'none' && r.photos.length) return false;
        if (f.photo === 'fix' && !r.nFix) return false;
        if (f.photo === 'nofix' && r.nFix) return false;
      }
      if (f.from || f.to) {
        const ds = r.inspDates || [];
        if (!ds.some((d) => (!f.from || d >= f.from) && (!f.to || d <= f.to))) return false;
      }
      for (const t of terms) if (!hay(r).includes(t)) return false;
      return true;
    });
  };

  const FLAGS = { mine: 'Needs my action', overdue: 'Overdue', rework: 'Rework' };
  F.FLAGS = FLAGS;
  F.count = (f) => F.FACETS.reduce((n, fc) => n + f[fc.id].length, 0) + Object.keys(FLAGS).filter((k) => f[k]).length + (f.photo ? 1 : 0) + (f.upload ? 1 : 0) + (f.from || f.to ? 1 : 0) + (f.q.trim() ? 1 : 0);

  const PHOTO = { none: 'No photos', fix: 'Has contractor fix photos', nofix: 'No contractor fix photos yet' };
  F.PHOTO_OPTIONS = PHOTO;
  F.chips = (f) => {
    const out = [];
    if (f.q.trim()) out.push({ k: 'q', label: 'Search: ' + f.q.trim() });
    Object.keys(FLAGS).forEach((k) => f[k] && out.push({ k, label: FLAGS[k] }));
    F.FACETS.forEach((fc) => f[fc.id].forEach((v) => out.push({ k: fc.id, v, label: fc.label + ': ' + fc.name(v) })));
    if (f.upload) {
      const imp = DT.state.imports.find((i) => i.id === f.upload);
      out.push({ k: 'upload', label: 'Upload: ' + (imp ? imp.fileName + ', ' + U.fmtDate(U.isoFromDate(new Date(imp.at))) : 'removed') });
    }
    if (f.photo) out.push({ k: 'photo', label: PHOTO[f.photo] });
    if (f.from || f.to) out.push({ k: 'date', label: 'Inspected ' + (f.from ? U.fmtDate(f.from) : '…') + ' – ' + (f.to ? U.fmtDate(f.to) : '…') });
    return out;
  };
  F.describe = (f) => F.chips(f).map((c) => c.label).join('; ');

  /* option lists with counts */
  F.options = (list, fc) => {
    const m = D.countBy(list, fc.get);
    const keys = Array.from(m.keys());
    if (fc.order) keys.sort((a, b) => fc.order.indexOf(a) - fc.order.indexOf(b));
    else keys.sort((a, b) => U.natCompare(a, b));
    return keys.map((k) => ({ v: k, label: fc.name(k), n: m.get(k) }));
  };
})();


