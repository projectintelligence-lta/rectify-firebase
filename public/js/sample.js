/* js/sample.js */
/* Rectify — sample defects (fictional).
 * Eight made-up defects, four Civil and four E&M, covering every stage of the flow, so a first-time viewer can
 * explore the app. They arrive as two uploads by STEL (one per discipline) and are then taken through the real workflow rules
 * (DT.workflow.perform) on past dates, so its history, emails and charts match real use.
 * Photos are drawn in the browser and labelled SAMPLE PHOTO. */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain;
  const SAMPLE = (DT.sample = {});

  const fileName = (discipline) => 'Sample ' + D.disciplineById[discipline].label + ' defects (fictional)';
  const DAY = 864e5;

  /* Contractor `A` / `B` = the first two contractor companies (the same one if there is only one); 'lta' = the LTA
   * account of the defect's discipline. steps: [days ago, action, who, input]. `input.due` is days from today. */
  const DEFECTS = [
    {
      discipline: 'civil',
      description: 'Handrail loose at stair landing',
      proposed: 'Re-fix handrail brackets and re-torque all fixings',
      classification: 'Safety Related',
      where: ['Depot', 'Block A', 'L2 / Staircase 2'],
      officer: 'STEL Safety',
      scene: 'handrail',
      steps: [],
    },
    {
      discipline: 'em',
      description: 'Water leak from AHU condensate pipe above ceiling',
      proposed: 'Repair the condensate pipe, then replace the stained ceiling tile',
      classification: 'Major',
      where: ['North Station', 'Admin Block', 'L3 / Corridor'],
      officer: 'STEL E&M',
      scene: 'stain',
      steps: [],
    },
    {
      discipline: 'em',
      description: 'Exposed cable ends in junction box',
      proposed: 'Terminate and insulate cable ends, fit the junction box cover',
      classification: 'Safety Related',
      where: ['Maintenance Bay', 'Workshop 1', 'L1 / Electrical Room'],
      officer: 'STEL E&M',
      scene: 'cable',
      steps: [
        [18, 'assign', 'lta', { contractor: 'A', due: 5, note: 'Isolate the circuit before work starts.' }],
        [10, 'submitFix', 'A', { note: 'Cable ends taped and box closed.', photo: true }],
        [8, 'rejectFix', 'lta', { note: 'Taping is not acceptable. Use proper terminations and fit the cover plate.' }],
      ],
    },
    {
      discipline: 'civil',
      description: 'Water ponding at roof drain',
      proposed: 'Rework the screed falls towards the drain outlet',
      classification: 'Major',
      where: ['Depot', 'Block B', 'Roof / Plant Deck'],
      officer: 'STEL Civil',
      scene: 'ponding',
      steps: [[16, 'assign', 'lta', { contractor: 'B', due: -3, note: 'Please check after the next heavy rain as well.' }]],
    },
    {
      discipline: 'em',
      description: 'Card reader not releasing the fire exit door',
      proposed: 'Replace the card reader and test the door release',
      classification: 'Major',
      where: ['Control Centre', 'Admin Block', 'L1 / Fire Exit 1'],
      officer: 'STEL E&M',
      scene: 'door',
      steps: [
        [15, 'assign', 'lta', { contractor: 'A', due: 7, note: '' }],
        [6, 'requestInfo', 'A', { note: 'Which card reader model should be used? The existing one is no longer made.' }],
      ],
    },
    {
      discipline: 'civil',
      description: 'Cracked floor tile outside lift lobby',
      proposed: 'Replace the cracked tile and re-grout',
      classification: 'Minor',
      where: ['North Station', 'Block A', 'L1 / Lift Lobby'],
      officer: 'STEL Civil',
      scene: 'tile',
      steps: [
        [14, 'assign', 'lta', { contractor: 'B', due: 2, note: '' }],
        [2, 'submitFix', 'B', { note: 'Tile replaced and re-grouted. Area cleaned.', photo: true }],
      ],
    },
    {
      discipline: 'civil',
      description: 'Paint peeling on staircase soffit',
      proposed: 'Scrape loose paint, prime and repaint',
      classification: 'Minor',
      where: ['Viaduct Section 2', 'Substation 3', 'L2 / Staircase 1'],
      officer: 'STEL Civil',
      scene: 'paint',
      steps: [
        [17, 'assign', 'lta', { contractor: 'A', due: -5, note: '' }],
        [9, 'submitFix', 'A', { note: 'Soffit scraped, primed and given two coats.', photo: true }],
        [7, 'approveFix', 'lta', { note: 'Checked on site. Finish is acceptable.' }],
      ],
    },
    {
      discipline: 'em',
      description: 'Additional access ladder suggested for the AHU platform',
      proposed: 'Install a fixed ladder with a safety cage',
      classification: 'Improvement',
      where: ['Maintenance Bay', 'Workshop 1', 'L2 / Mezzanine'],
      officer: 'STEL E&M',
      scene: 'ladder',
      steps: [
        [19, 'assign', 'lta', { contractor: 'B', due: -8, note: '' }],
        [12, 'submitFix', 'B', { note: 'Ladder and cage installed and load tested.', photo: true }],
        [11, 'approveFix', 'lta', { note: '' }],
        [10, 'accept', 'stel', { note: 'Accepted on site.' }],
      ],
    },
  ];

  const UPLOADED_DAYS_AGO = 21;
  const INSPECTED_DAYS_AGO = 23;

  /* ---------- photos ---------- */
  const W = 800,
    H = 600,
    THUMB_W = 320,
    THUMB_H = 240;
  const DEFECT_RED = '#c0392b';

  /* Draws a simple scene. `fixed` = the scene after the contractor's fix. */
  function paint(ctx, scene, fixed, stamp) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#eef1f5');
    g.addColorStop(1, '#cdd5de');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.07)';
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = (color, width, points) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      points.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      ctx.stroke();
    };
    const box = (color, x, y, w, h) => {
      ctx.fillStyle = color;
      ctx.fillRect(x * W, y * H, w * W, h * H);
    };

    switch (scene) {
      case 'handrail':
        for (let i = 0; i < 6; i++) {
          const x = 0.12 + i * 0.15;
          line('#6f7a86', 7, [[x, 0.7], [x + (!fixed && i === 3 ? 0.05 : 0), 0.3]]);
        }
        line('#6f7a86', 7, [[0.1, 0.3], [0.9, 0.3]]);
        break;
      case 'stain':
        for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
          ctx.strokeStyle = '#c3cad2';
          ctx.lineWidth = 3;
          ctx.strokeRect(W * (0.08 + i * 0.14), H * (0.08 + j * 0.15), W * 0.14, H * 0.15);
        }
        if (!fixed) {
          ctx.fillStyle = 'rgba(138, 109, 59, 0.35)';
          ctx.beginPath();
          ctx.ellipse(W * 0.5, H * 0.3, 70, 42, 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'cable':
        box('#9aa4b0', 0.3, 0.2, 0.4, 0.45);
        box('#b8c0ca', 0.34, 0.25, 0.32, 0.35);
        if (fixed) box('#7d8793', 0.32, 0.22, 0.36, 0.41);
        else [0.4, 0.5, 0.6].forEach((x) => line(DEFECT_RED, 5, [[x, 0.5], [x + 0.03, 0.7]]));
        break;
      case 'ponding':
        box('#9aa4b0', 0.05, 0.55, 0.9, 0.2);
        box('#6f7a86', 0.46, 0.6, 0.08, 0.06);
        if (!fixed) {
          ctx.fillStyle = 'rgba(70, 130, 180, 0.45)';
          ctx.beginPath();
          ctx.ellipse(W * 0.32, H * 0.64, 150, 26, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'door':
        box('#b3bcc6', 0.3, 0.1, 0.4, 0.62);
        ctx.fillStyle = '#6f7a86';
        ctx.beginPath();
        ctx.arc(W * 0.64, H * 0.42, 9, 0, Math.PI * 2);
        ctx.fill();
        line('#6f7a86', 6, [[0.32, 0.14], [0.45, 0.14]]);
        if (!fixed) box('rgba(192, 57, 43, 0.35)', 0.3, 0.1, 0.015, 0.62);
        break;
      case 'tile':
        for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
          ctx.strokeStyle = '#c3cad2';
          ctx.lineWidth = 3;
          ctx.strokeRect(W * (0.1 + i * 0.13), H * (0.5 + j * 0.14), W * 0.13, H * 0.14);
        }
        if (!fixed) line(DEFECT_RED, 4, [[0.36, 0.52], [0.42, 0.6], [0.5, 0.74]]);
        break;
      case 'paint':
        box('#d6dbe1', 0.05, 0.1, 0.9, 0.35);
        if (!fixed) {
          ctx.fillStyle = '#b8c0ca';
          [[0.2, 0.2], [0.45, 0.28], [0.7, 0.18], [0.58, 0.36]].forEach(([x, y]) => {
            ctx.beginPath();
            ctx.ellipse(W * x, H * y, 40, 18, 0.4, 0, Math.PI * 2);
            ctx.fill();
          });
        }
        break;
      default: /* ladder */
        box('#9aa4b0', 0.1, 0.25, 0.5, 0.06);
        if (fixed) {
          line('#44525f', 6, [[0.66, 0.25], [0.66, 0.72]]);
          line('#44525f', 6, [[0.76, 0.25], [0.76, 0.72]]);
          for (let y = 0.3; y < 0.72; y += 0.07) line('#44525f', 4, [[0.66, y], [0.76, y]]);
        }
        break;
    }

    ctx.font = '600 ' + Math.round(H * 0.045) + 'px -apple-system, Helvetica, Arial, sans-serif';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.textAlign = 'left';
    ctx.fillText('SAMPLE PHOTO', 16, H * 0.07);
    ctx.fillStyle = '#c27400';
    ctx.textAlign = 'right';
    ctx.fillText(stamp, W - 16, H - 16);
    if (fixed) {
      ctx.fillStyle = '#34c759';
      ctx.beginPath();
      ctx.arc(W - 44, 44, 24, 0, Math.PI * 2);
      ctx.fill();
      line('#fff', 5, [[(W - 54) / W, 44 / H], [(W - 46) / W, 52 / H], [(W - 33) / W, 36 / H]]);
    }
  }

  const toBlob = (canvas) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));

  async function drawPhoto(scene, fixed, at) {
    const full = document.createElement('canvas');
    full.width = W;
    full.height = H;
    paint(full.getContext('2d'), scene, fixed, U.fmtDateTime(at));
    const thumb = document.createElement('canvas');
    thumb.width = THUMB_W;
    thumb.height = THUMB_H;
    thumb.getContext('2d').drawImage(full, 0, 0, THUMB_W, THUMB_H);
    return { full: await toBlob(full), thumb: await toBlob(thumb), w: W, h: H };
  }
  const photoHash = (scene, fixed, at) => U.hashBytes(new Uint8Array(0), 'rectify-sample|' + scene + '|' + (fixed ? 'fix' : 'register') + '|' + at);

  /* ---------- build ---------- */
  const isoDaysAgo = (n) => U.addDays(U.isoToday(), -n);
  const dmy = (iso) => iso.split('-').reverse().map(Number).join('/');
  /* 10:00 local time, `n` days ago, plus a few minutes so same-day steps keep their order */
  const timeDaysAgo = (n, minutes) => {
    const d = new Date();
    d.setHours(10, minutes || 0, 0, 0);
    return d.getTime() - n * DAY;
  };

  /* Returns everything the sample needs: { imports (one per discipline), defects, events, outbox, media }.
   * contractors: the contractor companies in order; existing: the defects already stored, so the sample's
   * references continue each discipline's numbering. */
  SAMPLE.build = async (contractors, existing) => {
    if (!contractors.length) throw new Error('Add at least one contractor in Settings first.');
    const nextRef = Object.fromEntries(D.DISCIPLINES.map((dc) => [dc.id, D.nextRef(existing, dc.id, true)]));
    const contractorFor = { A: contractors[0], B: contractors[1] || contractors[0] };
    const ctx = { contractors: new Map(contractors.map((c) => [c.id, c])) };
    const actor = (who, discipline) => {
      if (who === 'lta') return DT.auth.ltaFor(discipline);
      if (who === 'stel') return DT.auth.userById('stel');
      return DT.auth.userById('contractor:' + contractorFor[who].id);
    };

    const uploadedAt = timeDaysAgo(UPLOADED_DAYS_AGO);
    const inspected = isoDaysAgo(INSPECTED_DAYS_AGO);
    const stel = DT.auth.userById('stel');
    const by = { id: stel.id, name: stel.name, role: stel.role, contractorId: null };
    const imports = D.DISCIPLINES.map((dc) => {
      const count = DEFECTS.filter((spec) => spec.discipline === dc.id).length;
      return { id: U.uid(), at: uploadedAt, discipline: dc.id, fileName: fileName(dc.id), sheetName: '', note: '', by, added: count, skipped: 0, photos: count, sample: true };
    });
    const importFor = (discipline) => imports.find((i) => i.discipline === discipline);

    const media = new Map();
    const events = [];
    const outbox = [];
    const defects = [];

    for (const [i, spec] of DEFECTS.entries()) {
      const registerHash = photoHash(spec.scene, false, uploadedAt);
      media.set(registerHash, await drawPhoto(spec.scene, false, uploadedAt));
      const row = {
        rowNum: i + 2,
        sn: 'SAMPLE-' + (i + 1),
        snRaw: 'SAMPLE-' + (i + 1),
        statusRaw: 'Opened',
        officer: spec.officer,
        inspDates: [inspected],
        inspRaw: dmy(inspected),
        rectDates: [],
        rectRaw: '',
        closedDate: null,
        closedRaw: '',
        location: spec.where[0],
        building: spec.where[1],
        level: spec.where[2],
        description: spec.description,
        proposed: spec.proposed,
        classificationRaw: spec.classification,
        action: 'Contractor to rectify',
        followUp: '',
        contact: spec.officer,
        actionParty: '',
        rectification: '',
        signoff: '',
        remark: 'SAMPLE',
        photos: [{ hash: registerHash, kind: 'before' }],
        photoNotes: [],
      };
      row.fp = D.fingerprint(row);
      let defect = Object.assign(row, {
        id: U.uid(),
        ref: nextRef[spec.discipline]++,
        importId: importFor(spec.discipline).id,
        discipline: spec.discipline,
        stage: 'new',
        contractorId: null,
        dueDate: null,
        rework: false,
        sample: true,
        createdAt: uploadedAt,
        updatedAt: uploadedAt,
      });
      events.push({ id: U.uid(), defectId: defect.id, at: uploadedAt, action: 'import', fromStage: null, toStage: 'new', note: '', by, fileName: fileName(spec.discipline) });

      let lastMessages = [];
      for (const [stepIndex, [daysAgo, action, who, opt]] of spec.steps.entries()) {
        const at = timeDaysAgo(daysAgo, stepIndex);
        const input = { note: opt.note || '' };
        if (opt.contractor) {
          input.contractorId = contractorFor[opt.contractor].id;
          input.dueDate = U.addDays(U.isoToday(), opt.due);
        }
        if (opt.photo) {
          const hash = photoHash(spec.scene, true, at);
          input.photos = [{ hash, media: await drawPhoto(spec.scene, true, at) }];
        }
        const res = DT.workflow.perform(action, defect, input, actor(who, spec.discipline), Object.assign({ now: at }, ctx));
        defect = res.defect;
        events.push(res.event);
        res.media.forEach((m, hash) => media.set(hash, m));
        /* emails from earlier steps count as already sent; only the latest step's are waiting */
        lastMessages.forEach((m) => (m.sentAt = m.at));
        lastMessages = res.outbox;
        outbox.push(...res.outbox);
      }
      defects.push(defect);
    }

    imports.forEach((imp) => {
      const announce = DT.notify.forImport(defects.filter((d) => d.importId === imp.id), { fileName: imp.fileName, note: '', uploader: by.name, at: uploadedAt, discipline: imp.discipline });
      announce.forEach((m) => (m.sentAt = m.at));
      outbox.push(...announce);
    });
    return { imports, defects, events, outbox, media };
  };
})();


