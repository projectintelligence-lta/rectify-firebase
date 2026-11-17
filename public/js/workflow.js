/* js/workflow.js */
/* Rectify — workflow rules.
 * STEL uploads a Civil or E&M register → the LTA of that discipline assigns → contractor fixes (or asks for information) → LTA approves or rejects
 * → STEL accepts (closed) or returns the defect to LTA.
 * Every action records a history event and the emails it triggers. */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain;
  const W = (DT.workflow = {});

  const OPEN = D.OPEN_STAGES;

  /* `from` = stages the action is offered in; `to` = resulting stage (null keeps the stage).
   * `note`: 'required' | 'optional'. `tone` styles the button. */
  W.ACTIONS = {
    assign: {
      roles: ['lta', 'admin'],
      from: OPEN,
      to: 'assigned',
      note: 'optional',
      label: (d) => (d.contractorId ? 'Reassign or change date' : 'Assign to contractor'),
      past: 'Assigned',
      tone: 'primary',
    },
    requestInfo: { roles: ['contractor', 'admin'], from: ['assigned'], to: 'info', note: 'required', label: () => 'Request more information', past: 'Requested more information', tone: '' },
    answerInfo: { roles: ['lta', 'admin'], from: ['info'], to: 'assigned', note: 'required', label: () => 'Answer and return to contractor', past: 'Answered', tone: 'primary' },
    submitFix: { roles: ['contractor', 'admin'], from: ['assigned'], to: 'submitted', note: 'required', photos: true, label: () => 'Submit fix to LTA', past: 'Submitted a fix', tone: 'primary' },
    approveFix: {
      roles: ['lta', 'admin'],
      from: ['submitted', 'returned'],
      to: 'awaiting',
      note: 'optional',
      label: (d) => (d.stage === 'returned' ? 'Send to STEL again' : 'Approve and send to STEL'),
      past: 'Approved the fix and sent it to STEL',
      tone: 'primary',
    },
    rejectFix: { roles: ['lta', 'admin'], from: ['submitted'], to: 'assigned', note: 'required', label: () => 'Reject fix', past: 'Rejected the fix', tone: 'danger' },
    accept: { roles: ['stel', 'admin'], from: ['awaiting'], to: 'closed', note: 'optional', label: () => 'Accept and close', past: 'Accepted and closed', tone: 'primary' },
    returnToLta: { roles: ['stel', 'admin'], from: ['awaiting'], to: 'returned', note: 'required', label: () => 'Return to LTA', past: 'Returned to LTA', tone: 'danger' },
    comment: { roles: ['admin', 'stel', 'lta', 'contractor'], from: D.STAGES.map((s) => s.id), to: null, note: 'required', label: () => 'Add comment', past: 'Commented', tone: '' },
  };
  /* Order in which actions are offered in the defect panel */
  const ORDER = ['submitFix', 'answerInfo', 'approveFix', 'accept', 'assign', 'requestInfo', 'rejectFix', 'returnToLta'];

  /* ---------- who can see what ----------
   * Admin and STEL: every defect. LTA: the defects of its own discipline. Contractor: the defects assigned to it. */
  W.canSee = (defect, user) => {
    if (user.role === 'lta') return defect.discipline === user.discipline;
    if (user.role === 'contractor') return defect.contractorId === user.contractorId;
    return true;
  };

  /* A contractor sees the defect's history from the moment it was (last) assigned to them, plus how it was raised. */
  W.visibleEvents = (events, user) => {
    if (user.role !== 'contractor') return events;
    let start = -1;
    events.forEach((e, i) => e.action === 'assign' && e.contractorId === user.contractorId && (start = i));
    return events.filter((e, i) => e.action === 'import' || (start >= 0 && i >= start));
  };
  W.visiblePhotos = (defect, user) => (user.role !== 'contractor' ? defect.photos : defect.photos.filter((p) => p.kind !== 'fix' || p.contractorId === user.contractorId));

  /* ---------- what the current user can do ---------- */
  W.allowed = (actionId, defect, user) => {
    const a = W.ACTIONS[actionId];
    if (!a.roles.includes(user.role) || !a.from.includes(defect.stage)) return false;
    return W.canSee(defect, user);
  };
  W.available = (defect, user) => ORDER.filter((id) => W.allowed(id, defect, user));
  /* Does this defect need an action from this user right now? (drives "Your queue") */
  W.isMine = (defect, user) => {
    const owner = D.stageById[defect.stage].owner;
    if (!owner) return false;
    return owner === user.role && W.canSee(defect, user);
  };

  /* ---------- performing an action ----------
   * defect = the stored record (not the derived one); input = { note, contractorId, dueDate, photos: [{hash, media}] }.
   * ctx = { contractors, now? }: `now` (ms) dates the action; it defaults to the current time.
   * Returns { defect, event, outbox, media } ready for DT.store.saveAction. Throws Error with a readable message. */
  W.perform = (actionId, defect, input, user, ctx) => {
    const a = W.ACTIONS[actionId];
    if (!a || !W.allowed(actionId, defect, user)) throw new Error('This action is not available for this defect.');
    const note = String(input.note || '').trim();
    if (a.note === 'required' && !note) throw new Error('Please add a note.');
    const now = ctx.now || Date.now();
    const next = Object.assign({}, defect, { updatedAt: now });
    const event = { id: U.uid(), defectId: defect.id, at: now, action: actionId, fromStage: defect.stage, toStage: a.to || defect.stage, note, by: { id: user.id, name: user.name, role: user.role, contractorId: user.contractorId || null } };
    const media = new Map();

    switch (actionId) {
      case 'assign': {
        if (!input.contractorId || !ctx.contractors.has(input.contractorId)) throw new Error('Choose a contractor.');
        if (!input.dueDate) throw new Error('Choose a target date.');
        const sameContractor = input.contractorId === defect.contractorId;
        next.rework = defect.stage === 'returned' || (sameContractor && !!defect.rework);
        next.contractorId = input.contractorId;
        next.dueDate = input.dueDate;
        next.assignedAt = now;
        if (!sameContractor) {
          /* the previous contractor's fix belongs to them; the new contractor starts clean */
          next.fixNote = '';
          next.submittedAt = null;
        }
        event.contractorId = input.contractorId;
        event.previousContractorId = sameContractor ? null : defect.contractorId || null;
        event.dueDate = input.dueDate;
        break;
      }
      case 'submitFix': {
        const photos = input.photos || [];
        if (!photos.length) throw new Error('Add at least one photo of the completed fix.');
        photos.forEach((p) => media.set(p.hash, p.media));
        next.photos = defect.photos.concat(photos.map((p) => ({ hash: p.hash, kind: 'fix', at: now, contractorId: defect.contractorId })));
        next.submittedAt = now;
        next.fixNote = note;
        event.photos = photos.map((p) => p.hash);
        break;
      }
      case 'rejectFix':
        next.rework = true;
        break;
      case 'accept':
        next.closedAt = now;
        next.rework = false;
        break;
      default:
        break;
    }
    if (a.to) next.stage = a.to;
    const outbox = DT.notify.forEvent(event, next, ctx);
    return { defect: next, event, outbox, media };
  };

  /* Describe a history event in plain words, e.g. "LTA assigned it to Contractor A, due 5 Nov 2026". */
  W.describe = (e, contractors) => {
    const name = (id) => (contractors.get(id) || { name: 'a removed contractor' }).name;
    switch (e.action) {
      case 'import':
        return 'Raised from the register' + (e.fileName ? ' (' + e.fileName + ')' : '');
      case 'assign':
        return (e.previousContractorId ? 'Reassigned from ' + name(e.previousContractorId) + ' to ' : 'Assigned to ') + name(e.contractorId) + ', target ' + U.fmtDate(e.dueDate);
      default:
        return W.ACTIONS[e.action] ? W.ACTIONS[e.action].past : e.action;
    }
  };
})();


