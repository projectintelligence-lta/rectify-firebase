/* js/domain.js */
/* Rectify — domain model & business rules */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U;
  const D = (DT.domain = {});

  /* The 20 columns of the defect register. `match` = header patterns (lower-case, whitespace collapsed). */
  D.FIELDS = [
    { id: 'sn', label: 'S/N', req: true, match: [/^s\/?n\b/, /^serial/, /^no\.?$/, /^item no/] },
    { id: 'status', label: 'Status', match: [/^status/] },
    { id: 'officer', label: 'Inspection Officer / Comment by (Dept & Name)', match: [/inspection officer/, /comment by/] },
    { id: 'inspDates', label: 'Dates of Inspection(s)', type: 'dates', match: [/dates? of inspection/] },
    { id: 'rectDates', label: 'Dates of Rectification(s) by LTA', type: 'dates', match: [/dates? of rectification/] },
    { id: 'closedDate', label: "Defect's Date Closed", type: 'dates', match: [/date closed/, /closed date/, /date of closure/] },
    { id: 'location', label: 'Location', match: [/^location/] },
    { id: 'building', label: 'Building No', match: [/^building/] },
    { id: 'level', label: 'Level / Rm Name / Rm No.', match: [/^level/, /rm name/, /^room/] },
    { id: 'description', label: 'Defect Description', req: true, match: [/defect description/, /^description/] },
    { id: 'proposed', label: 'Proposed Rectification / Improvements', match: [/proposed rectification/, /^proposed/] },
    { id: 'classification', label: 'Defect Classification', match: [/classification/] },
    { id: 'photos', label: 'Defect Photos with dates (Before by STEL)', kind: 'photo', match: [/defect photos?/, /^photos?\b/] },
    { id: 'action', label: 'Action', match: [/^remarks$/, /^action$/] },
    { id: 'followUp', label: 'Timeline to Follow-up (by LTA)', match: [/timeline/, /follow-?\s?up/] },
    { id: 'contact', label: 'Contact Person (STEL)', match: [/contact person/, /^contact/] },
    { id: 'actionParty', label: 'Action Party (LTA)', match: [/action party/] },
    { id: 'rectification', label: 'Defect Rectification (by LTA)', match: [/^defect rectification/, /^rectification/] },
    { id: 'signoff', label: 'Sign-Off by STEL', match: [/sign-?\s?off/] },
    { id: 'remark', label: 'Remark', match: [/^remark$/] },
  ];

  /* Workflow stages, in flow order. `owner` is the role that has to act next. */
  D.STAGES = [
    { id: 'new', label: 'New', short: 'New', owner: 'lta', color: '#5e5ce6', hint: 'Waiting for LTA to assign a contractor' },
    { id: 'assigned', label: 'With contractor', short: 'Contractor', owner: 'contractor', color: '#ff9f0a', hint: 'The contractor is fixing it' },
    { id: 'info', label: 'Info requested', short: 'Info', owner: 'lta', color: '#bf5af2', hint: 'The contractor needs more information from LTA' },
    { id: 'submitted', label: 'Fix submitted', short: 'Fix submitted', owner: 'lta', color: '#0071e3', hint: 'LTA is reviewing the contractor’s fix' },
    { id: 'returned', label: 'Returned by STEL', short: 'Returned', owner: 'lta', color: '#ff3b30', hint: 'STEL did not accept the fix; LTA decides the next step' },
    { id: 'awaiting', label: 'Awaiting STEL acceptance', short: 'STEL acceptance', owner: 'stel', color: '#30b0c7', hint: 'LTA approved the fix; STEL accepts or returns it' },
    { id: 'closed', label: 'Closed', short: 'Closed', owner: null, color: '#34c759', hint: 'Accepted by STEL' },
  ];
  D.stageById = Object.fromEntries(D.STAGES.map((s) => [s.id, s]));
  D.OPEN_STAGES = D.STAGES.filter((s) => s.id !== 'closed').map((s) => s.id);
  /* Stages in which the target date is the contractor's to meet; only these can be overdue. */
  D.CONTRACTOR_STAGES = ['assigned', 'info'];

  D.CLASSES = [
    { id: 'Safety Related', color: '#ff3b30' },
    { id: 'Major', color: '#ff9f0a' },
    { id: 'Minor', color: '#5ac8fa' },
    { id: 'Improvement', color: '#af52de' },
    { id: 'Unclassified', color: '#aeaeb2' },
  ];
  D.classById = Object.fromEntries(D.CLASSES.map((c) => [c.id, c]));

  /* Each register upload is either Civil or E&M; every defect keeps the discipline of its upload.
   * The LTA account of that discipline reviews it. */
  D.DISCIPLINES = [
    { id: 'civil', label: 'Civil', color: '#a2845e', prefix: 'C' },
    { id: 'em', label: 'E&M', color: '#0e7c86', prefix: 'E' },
  ];
  D.disciplineById = Object.fromEntries(D.DISCIPLINES.map((d) => [d.id, d]));

  /* Rectify reference: numbered separately per discipline and shown with its prefix (C1, C2 … / E1, E2 …).
   * Sample defects have their own numbering, shown as S-C1 … / S-E1 …, so real defects always start at 1
   * and never depend on the sample. `ref` stores the number; refLabel() is how it is shown everywhere.
   * A reference never changes once given. */
  D.refLabel = (d) => (d.sample ? 'S-' : '') + D.disciplineById[d.discipline].prefix + d.ref;
  D.nextRef = (defects, discipline, sample) => defects.filter((d) => d.discipline === discipline && !!d.sample === !!sample).reduce((mx, d) => Math.max(mx, d.ref), 0) + 1;
  /* sort key: Civil first, then E&M; within each, real defects in number order, then the sample */
  D.refOrder = (d) => D.DISCIPLINES.findIndex((x) => x.id === d.discipline) * 1e6 + (d.sample ? 5e5 : 0) + d.ref;

  D.APP_NAME = 'Rectify';

  D.DEFAULTS = {
    classMap: {
      minor: 'Minor',
      major: 'Major',
      safety: 'Safety Related',
      'safety related': 'Safety Related',
      'safety-related': 'Safety Related',
      'major / safety related': 'Safety Related',
      improvement: 'Improvement',
      improvements: 'Improvement',
    },
    mailboxes: { stel: '', 'lta-civil': '', 'lta-em': '' } /* keyed by account id */,
    ageBuckets: [7, 14, 30, 60],
    columnOverrides: {},
  };
  D.settings = U.clone(D.DEFAULTS);

  D.norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();

  /* returns {value, suspect, mapped} */
  D.normClass = (raw) => {
    const k = D.norm(raw);
    if (!k) return { value: 'Unclassified', suspect: false, blank: true };
    const m = D.settings.classMap[k];
    if (m) return { value: m, suspect: false, mapped: k !== D.norm(m) };
    if (k.length <= 40) {
      if (k.includes('safety')) return { value: 'Safety Related', suspect: false, mapped: true };
      if (k.includes('major')) return { value: 'Major', suspect: false, mapped: true };
      if (k.includes('minor')) return { value: 'Minor', suspect: false, mapped: true };
      if (k.includes('improve')) return { value: 'Improvement', suspect: false, mapped: true };
    }
    return { value: 'Unclassified', suspect: true };
  };

  /* Add the working fields the screens need to a stored defect. `contractors` = Map id → contractor. */
  D.derive = (rec, today, contractors) => {
    const cls = D.normClass(rec.classificationRaw);
    const closed = rec.stage === 'closed';
    const raisedOn = rec.inspDates && rec.inspDates.length ? rec.inspDates[0] : U.isoFromDate(new Date(rec.createdAt));
    const closedOn = closed && rec.closedAt ? U.isoFromDate(new Date(rec.closedAt)) : null;
    const contractor = rec.contractorId && contractors ? contractors.get(rec.contractorId) : null;
    const overdue = !!rec.dueDate && D.CONTRACTOR_STAGES.includes(rec.stage) && rec.dueDate < today;
    return Object.assign({}, rec, {
      disciplineLabel: D.disciplineById[rec.discipline].label,
      refLabel: D.refLabel(rec),
      classification: cls.value,
      classSuspect: cls.suspect,
      closed,
      open: !closed,
      owner: D.stageById[rec.stage].owner,
      raisedOn,
      closedOn,
      ageDays: Math.max(0, U.daysBetween(raisedOn, closedOn || today)),
      overdue,
      daysOverdue: overdue ? U.daysBetween(rec.dueDate, today) : 0,
      contractorName: contractor ? contractor.name : rec.contractorId ? 'Removed contractor' : '',
      nRegister: rec.photos.filter((p) => p.kind !== 'fix').length,
      nFix: rec.photos.filter((p) => p.kind === 'fix').length,
    });
  };
  D.deriveAll = (recs, today, contractors) => recs.map((r) => D.derive(r, today, contractors));

  /* Aggregate counts for KPIs and reports */
  D.summarize = (list) => {
    const s = { total: list.length, open: 0, closed: 0, safetyOpen: 0, overdue: 0, rework: 0, byStage: {}, byClass: {} };
    D.STAGES.forEach((st) => (s.byStage[st.id] = 0));
    list.forEach((r) => {
      s.byStage[r.stage]++;
      if (r.open) s.open++;
      else s.closed++;
      if (r.open && r.classification === 'Safety Related') s.safetyOpen++;
      if (r.overdue) s.overdue++;
      if (r.open && r.rework) s.rework++;
      s.byClass[r.classification] = (s.byClass[r.classification] || 0) + 1;
    });
    return s;
  };

  D.ageBucketLabels = () => {
    const b = D.settings.ageBuckets;
    const out = [];
    let prev = -1;
    b.forEach((n) => {
      out.push({ label: prev + 1 + '–' + n + ' d', min: prev + 1, max: n });
      prev = n;
    });
    out.push({ label: b[b.length - 1] + '+ d', min: b[b.length - 1] + 1, max: Infinity });
    return out;
  };

  D.countBy = (list, fn) => {
    const m = new Map();
    list.forEach((r) => {
      const k = fn(r);
      m.set(k, (m.get(k) || 0) + 1);
    });
    return m;
  };

  /* Fingerprint for recognising a register row that is already in the system */
  D.fingerprint = (r) => [r.location, r.building, r.level, r.description].map((x) => D.norm(x)).join(' | ');

  D.photoLabel = (kind) => ({ before: 'Register photo', after: 'Register photo (rectification column)', signoff: 'Register photo (sign-off column)', fix: 'Contractor fix' }[kind] || kind);
})();


