/* js/view-emails.js */
/* Rectify — Emails: the notifications each workflow step produces.
 * With automatic emails on (Settings), each step's emails go out through the Rectify mailer as soon as it is
 * saved, and "Send" here sends one that is still waiting. Otherwise "Send" opens it in the user's email app.
 * Admin sees every message; everyone else sees the ones addressed to them. */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    UI = DT.ui,
    S = DT.state,
    N = DT.notify,
    esc = U.esc;
  const V = (DT.views.emails = {});
  let showSent = false;
  let auto = false;

  V.render = async (root) => {
    auto = await DT.store.mailerOn();
    const mine = S.outbox.filter((m) => N.visibleTo(m, S.user));
    const list = showSent ? mine : mine.filter((m) => !m.sentAt);
    const admin = S.user.role === 'admin';
    root.innerHTML =
      '<div class="page-head"><div><h1>Emails</h1><p class="lede">' +
      (admin ? 'Every email Rectify has prepared.' : 'Emails Rectify has prepared for ' + esc(S.user.name) + '.') +
      (auto ? ' They are sent automatically at each step. Any still waiting can be sent with <b>Send</b>.' : ' Press <b>Send</b> to open one in your email app, ready to go.') + '</p></div><div class="head-actions">' +
      (auto && admin && mine.some((m) => !m.sentAt) ? '<button class="btn sm primary" id="sendAll">Send all waiting</button>' : '') + '<div id="segSent"></div></div></div>' +
      (auto ? '' : '<div class="note-box">Automatic emails are off' + (admin ? ' (turn them on in Settings → Automatic emails)' : '') + '. Open a message to send it from your own email app.</div>') +
      (list.length ? '<div class="mail-list">' + list.map(row).join('') + '</div>' : UI.empty('check', showSent || !mine.length ? 'No emails yet' : 'All caught up', showSent || !mine.length ? 'Emails appear here as defects move through the flow.' : 'Every email here has been opened for sending. Switch to “All” to see them.'));
    UI.segmented(U.$('#segSent', root), {
      value: showSent ? 'all' : 'unsent',
      options: [
        { id: 'unsent', label: 'To send', count: mine.filter((m) => !m.sentAt).length },
        { id: 'all', label: 'All', count: mine.length },
      ],
      onChange: (v) => {
        showSent = v === 'all';
        V.render(root);
      },
    });
    const box = U.$('.mail-list', root);
    if (box) box.addEventListener('click', (e) => onClick(e, root));
    const all = U.$('#sendAll', root);
    if (all) all.addEventListener('click', () => sendIds(mine.filter((m) => !m.sentAt).map((m) => m.id), root));
  };

  function row(m) {
    const name = N.nameOf(m, S.contractors);
    const address = N.addressOf(m, S.contractors);
    return (
      '<details class="mail' + (m.sentAt ? ' sent' : '') + '"><summary><span class="mail-to">' + UI.avatar(name) + '<span><b>' + esc(m.subject.replace(/^\[Rectify\] /, '')) + '</b><em>To ' + esc(name + (address ? ' <' + address + '>' : '')) + ' · ' + esc(U.fmtDateTime(m.at)) + '</em></span></span>' +
      (m.sentAt ? '<span class="tag" style="--c:#34c759">Sent ' + esc(U.fmtDateTime(m.sentAt)) + '</span>' : '') + UI.icon('down', 14) + '</summary>' +
      '<div class="mail-body"><pre>' + esc(m.body) + '</pre><div class="btn-row">' +
      (address && auto && !m.sentAt
        ? '<button class="btn primary sm" data-autosend="' + m.id + '">' + UI.icon('right', 14) + 'Send</button>'
        : address
        ? '<a class="btn ' + (m.sentAt ? '' : 'primary ') + 'sm" data-send="' + m.id + '" href="' + esc(N.mailto(m, address)) + '">' + UI.icon('right', 14) + (m.sentAt ? 'Send again from my email app' : 'Send') + '</a>'
        : '<span class="muted small">No email address for ' + esc(name) + ' yet. ' + (S.user.role === 'admin' ? 'Add one in Settings.' : 'Admin can add one in Settings.') + '</span>') +
      (m.defectIds.length === 1 ? '<button class="btn sm" data-open="' + m.defectIds[0] + '">Open defect</button>' : '') +
      '</div></div></details>'
    );
  }

  async function sendIds(ids, root) {
    try {
      const r = [].concat.apply([], await Promise.all(Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => DT.store.sendEmails(ids.slice(i * 50, i * 50 + 50)))));
      const sent = r.filter((x) => x.status === 'sent').length;
      const noAddr = r.filter((x) => x.status === 'no-address').length;
      const quota = r.some((x) => x.status === 'quota');
      UI.toast(sent ? U.plural(sent, 'email') + ' sent' : 'Nothing was sent', sent ? 'success' : 'error');
      if (noAddr) UI.toast(U.plural(noAddr, 'email') + ' have no address yet (Settings)', 'error');
      if (quota) UI.toast('Gmail’s daily sending limit is reached. Try again tomorrow.', 'error');
    } catch (ex) {
      UI.toast(ex.message, 'error');
    }
    await DT.app.reload();
    DT.app.paintBadges();
    V.render(root);
  }

  async function onClick(e, root) {
    const as = e.target.closest('[data-autosend]');
    if (as) {
      as.disabled = true;
      return sendIds([as.dataset.autosend], root);
    }
    const send = e.target.closest('[data-send]');
    if (send) {
      /* the link itself opens the email app; record that it was opened */
      await DT.store.markSent(send.dataset.send, Date.now());
      await DT.app.reload();
      DT.app.paintBadges();
      setTimeout(() => V.render(root), 400);
      return;
    }
    const open = e.target.closest('[data-open]');
    if (open) {
      if (DT.app.findDefect(open.dataset.open)) DT.views.defects.openDefect(open.dataset.open);
      else UI.toast('That defect is not available to you.', 'error');
    }
  }
})();


