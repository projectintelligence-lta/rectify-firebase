/* js/view-imports.js */
/* Rectify — Uploads: a log of every register upload */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    UI = DT.ui,
    S = DT.state,
    esc = U.esc;
  const V = (DT.views.imports = {});

  V.render = (root) => {
    const list = S.imports;
    root.innerHTML =
      '<div class="page-head"><div><h1>Uploads</h1><p class="lede">Each upload adds only the defects that are not in Rectify yet. Their progress is then followed up in the app.</p></div>' +
      (DT.auth.can('upload') ? '<div class="head-actions"><button class="btn primary" data-act="upload">' + UI.icon('upload', 16) + '<span>Upload Excel</span></button></div>' : '') +
      '</div>' +
      (list.length
        ? '<ol class="timeline">' +
          list.map((i, n) =>
            '<li class="tl-item" style="--n:' + Math.min(n, 8) + '"><i class="tl-dot"></i><div class="tl-card"><div class="tl-top"><div><h3>' + esc(i.fileName) + UI.disciplineTag(i.discipline) + (n === 0 ? '<span class="tag" style="--c:#0071e3">Latest</span>' : '') + (i.sample ? '<span class="tag" style="--c:#8e8e93">Sample</span>' : '') + '</h3>' +
            '<p>' + esc(U.fmtDateTime(i.at)) + ' · ' + esc(i.by.name) + (i.sheetName ? ' · <span class="muted">sheet ' + esc(i.sheetName) + '</span>' : '') + '</p>' + (i.note ? '<p class="tl-note">“' + esc(i.note) + '”</p>' : '') + '</div>' +
            (i.added ? '<div class="tl-act"><button class="btn sm" data-import="' + i.id + '">View its defects</button></div>' : '') + '</div>' +
            '<div class="tl-stats"><div><b>' + i.added + '</b><span>New defects</span></div><div><b>' + i.skipped + '</b><span>Already in Rectify</span></div><div><b>' + i.photos + '</b><span>Photos</span></div></div></div></li>'
          ).join('') +
          '</ol>'
        : UI.empty('history', 'No uploads yet', 'Uploads of the defect register will appear here.'));
    const timeline = U.$('.timeline', root);
    if (timeline)
      timeline.addEventListener('click', (e) => {
        const b = e.target.closest('[data-import]');
        if (b) DT.views.goDefects({ upload: b.dataset.import });
      });
  };
})();


