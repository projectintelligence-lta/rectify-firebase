/* js/notify.js */
/* Rectify — email notifications.
 * Every workflow step writes the emails it triggers to the outbox. In this browser-only build the
 * outbox is shown on the Emails page, where each message can be opened in the user's email app.
 * For production, the server sends these messages instead (see README.md → "Going multi-user"). */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain;
  const N = (DT.notify = {});
  const MAX_LISTED = 10;

  N.appLink = (defectId) => location.href.split('#')[0] + '#/defects' + (defectId ? '/' + defectId : '');

  /* Messages store who they are for (a role, the LTA of a discipline, or a contractor company); the email
   * address is looked up when the message is shown or sent, so addresses Admin adds later still apply. */
  function recipient(kind, ctx, contractorId, discipline) {
    if (kind === 'contractor') {
      const c = ctx.contractors.get(contractorId);
      return { toRole: 'contractor', contractorId, discipline: null, toName: c ? c.name : 'Contractor' };
    }
    const account = kind === 'lta' ? DT.auth.ltaFor(discipline) : DT.auth.userById(kind);
    return { toRole: kind, contractorId: null, discipline: kind === 'lta' ? discipline : null, toName: account.name };
  }
  /* settings.mailboxes is keyed by account id: 'stel', 'lta-civil', 'lta-em' */
  const accountIdOf = (m) => (m.toRole === 'lta' ? 'lta-' + m.discipline : m.toRole);
  N.addressOf = (m, contractors) => {
    if (m.toRole !== 'contractor') return D.settings.mailboxes[accountIdOf(m)] || '';
    const c = contractors.get(m.contractorId);
    return c ? c.email || '' : '';
  };
  N.nameOf = (m, contractors) => (m.toRole === 'contractor' && contractors.has(m.contractorId) ? contractors.get(m.contractorId).name : m.toName);

  function summary(d) {
    return [
      'Defect ' + D.refLabel(d) + ' (S/N ' + d.sn + ')',
      d.description,
      'Location: ' + ([d.location, d.building, d.level].filter(Boolean).join(' · ') || 'not given'),
      'Discipline: ' + D.disciplineById[d.discipline].label,
      'Classification: ' + D.normClass(d.classificationRaw).value,
    ].join('\n');
  }

  /* `at` is the time of the action that produced the message */
  function createMessage(to, subject, lines, defectIds, at) {
    return Object.assign({ id: U.uid(), at, subject: '[Rectify] ' + subject, body: ['Hello ' + to.toName + ','].concat(lines, ['', 'This message was sent by Rectify.']).join('\n'), defectIds, sentAt: null }, to);
  }

  /* Emails for one workflow event. `d` is the defect after the action. */
  N.forEvent = (e, d, ctx) => {
    const ref = D.refLabel(d);
    const noteLine = e.note ? ['', 'Note from ' + e.by.name + ':', e.note] : [];
    const link = ['', 'Open it in Rectify: ' + N.appLink(d.id)];
    const body = (lead, extra) => ['', lead, '', summary(d)].concat(extra || [], noteLine, link);
    const to = (kind, contractorId) => recipient(kind, ctx, contractorId, d.discipline);
    const message = (recipientInfo, subject, lines) => createMessage(recipientInfo, subject, lines, [d.id], e.at);
    switch (e.action) {
      case 'assign': {
        const out = [message(to('contractor', e.contractorId), 'Defect ' + ref + ' assigned to you, target ' + U.fmtDate(e.dueDate), body('LTA has assigned this defect to ' + to('contractor', e.contractorId).toName + '.', ['Target date: ' + U.fmtDate(e.dueDate)]))];
        if (e.previousContractorId) out.push(message(to('contractor', e.previousContractorId), 'Defect ' + ref + ' reassigned', body('LTA has reassigned this defect to another contractor. No further action is needed from you.')));
        return out;
      }
      case 'requestInfo':
        return [message(to('lta'), e.by.name + ' needs more information on defect ' + ref, body(e.by.name + ' has asked for more information before fixing this defect.'))];
      case 'answerInfo':
        return [message(to('contractor', d.contractorId), 'LTA answered your question on defect ' + ref, body('LTA has answered your question. The defect is back with you.', ['Target date: ' + U.fmtDate(d.dueDate)]))];
      case 'submitFix':
        return [message(to('lta'), 'Fix submitted for defect ' + ref + ', please review', body(e.by.name + ' has submitted a fix with ' + U.plural((e.photos || []).length, 'photo') + '.'))];
      case 'approveFix':
        return [message(to('stel'), 'Defect ' + ref + ' is ready for your acceptance', body('LTA has approved the fix and sent it to you for acceptance.'))];
      case 'rejectFix':
        return [message(to('contractor', d.contractorId), 'Fix not accepted for defect ' + ref + ', rework needed', body('LTA did not accept the fix. Please rework it and submit again.', ['Target date: ' + U.fmtDate(d.dueDate)]))];
      case 'accept': {
        const out = [message(to('lta'), 'Defect ' + ref + ' accepted and closed', body('STEL has accepted the fix. The defect is closed.'))];
        if (d.contractorId) out.push(message(to('contractor', d.contractorId), 'Defect ' + ref + ' accepted and closed', body('STEL has accepted your fix. The defect is closed.')));
        return out;
      }
      case 'returnToLta':
        return [message(to('lta'), 'STEL returned defect ' + ref, body('STEL did not accept the fix and has returned the defect to LTA.'))];
      default:
        return [];
    }
  };

  /* Many defects assigned in one go: one email to the contractor listing them all (instead of one per defect),
   * and one to each contractor the defects were taken away from. defects = after the action, events = their entries. */
  N.forBulkAssign = (defects, events, ctx) => {
    if (!defects.length) return [];
    const e0 = events[0];
    const at = e0.at;
    const line = (d) => '• ' + D.refLabel(d) + ' (S/N ' + d.sn + ') ' + U.truncate(d.description, 80);
    /* the contractor needs every defect it now owns, so the list is longer here than in other emails */
    const MAX = 100;
    const list = (ds) => ds.slice(0, MAX).map(line).concat(ds.length > MAX ? ['… and ' + (ds.length - MAX) + ' more (see Rectify).'] : []);
    const noteLine = e0.note ? ['', 'Note from ' + e0.by.name + ':', e0.note] : [];
    const to = recipient('contractor', ctx, e0.contractorId, null);
    const out = [
      createMessage(
        to,
        U.plural(defects.length, 'defect') + ' assigned to you, target ' + U.fmtDate(e0.dueDate),
        ['', 'LTA has assigned ' + U.plural(defects.length, 'defect') + ' to ' + to.toName + '.', 'Target date: ' + U.fmtDate(e0.dueDate), ''].concat(list(defects), noteLine, ['', 'Open them in Rectify: ' + N.appLink()]),
        defects.map((d) => d.id),
        at
      ),
    ];
    const byPrev = new Map();
    events.forEach((e, i) => e.previousContractorId && byPrev.set(e.previousContractorId, (byPrev.get(e.previousContractorId) || []).concat([defects[i]])));
    byPrev.forEach((ds, cid) =>
      out.push(createMessage(recipient('contractor', ctx, cid, null), U.plural(ds.length, 'defect') + ' reassigned', ['', 'LTA has reassigned ' + (ds.length === 1 ? 'this defect' : 'these defects') + ' to another contractor. No further action is needed from you.', ''].concat(list(ds)), ds.map((d) => d.id), at))
    );
    return out;
  };

  /* One email per upload to the LTA of its discipline, listing the new defects. meta = { fileName, note, uploader, at, discipline } */
  N.forImport = (defects, meta) => {
    const { fileName, note, uploader, at, discipline } = meta;
    if (!defects.length) return [];
    const lines = defects.slice(0, MAX_LISTED).map((d) => '• ' + D.refLabel(d) + ' (S/N ' + d.sn + ') ' + U.truncate(d.description, 80));
    if (defects.length > MAX_LISTED) lines.push('… and ' + (defects.length - MAX_LISTED) + ' more.');
    const to = recipient('lta', null, null, discipline);
    return [createMessage(to, U.plural(defects.length, 'new ' + D.disciplineById[discipline].label + ' defect') + ' to review', ['', uploader + ' has uploaded ' + fileName + ' with ' + U.plural(defects.length, 'new defect') + ' for you to review and assign:', ''].concat(lines, note ? ['', 'Note from ' + uploader + ':', note] : [], ['', 'Open them in Rectify: ' + N.appLink()]), defects.map((d) => d.id), at)];
  };

  N.mailto = (m, address) => 'mailto:' + encodeURIComponent(address) + '?subject=' + encodeURIComponent(m.subject) + '&body=' + encodeURIComponent(m.body);

  /* Which outbox messages a user should see: Admin sees all, everyone else the ones addressed to them. */
  N.visibleTo = (m, user) => {
    if (user.role === 'admin') return true;
    if (user.role === 'contractor') return m.toRole === 'contractor' && m.contractorId === user.contractorId;
    if (user.role === 'lta') return m.toRole === 'lta' && m.discipline === user.discipline;
    return m.toRole === user.role;
  };
})();


