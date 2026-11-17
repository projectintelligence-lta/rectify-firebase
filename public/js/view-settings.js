/* js/view-settings.js */
/* Rectify — Settings (Admin only) */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    D = DT.domain,
    UI = DT.ui,
    S = DT.state,
    esc = U.esc;
  const V = (DT.views.settings = {});

  const sec = (title, sub, body) => '<section class="card set-card"><header class="card-h"><h2>' + esc(title) + '</h2>' + (sub ? '<p>' + esc(sub) + '</p>' : '') + '</header>' + body + '</section>';

  V.render = async (root) => {
    const set = D.settings;
    const allUsers = await DT.store.getUsers();
    /* people waiting for approval first, so they are easy to spot */
    const users = allUsers.slice().sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1));
    const pendingCount = allUsers.filter((u) => u.status === 'pending').length;
    const roleSelect = (role, attr) => '<select ' + attr + ' aria-label="Role">' + Object.keys(DT.auth.ROLES).map((k) => '<option value="' + k + '"' + (k === role ? ' selected' : '') + '>' + esc(DT.auth.ROLES[k].label) + '</option>').join('') + '</select>';
    /* one select for the team: a discipline for LTA, a company for contractors, nothing for the others */
    const teamSelect = (u, attr) => {
      if (u.role === 'lta') return '<select ' + attr + ' aria-label="Discipline">' + D.DISCIPLINES.map((d) => '<option value="' + d.id + '"' + (d.id === u.discipline ? ' selected' : '') + '>' + esc(d.label) + '</option>').join('') + '</select>';
      if (u.role === 'contractor') return '<select ' + attr + ' aria-label="Company">' + (contractors.length ? '' : '<option value="">Add a contractor first</option>') + contractors.map((c) => '<option value="' + c.id + '"' + (c.id === u.contractorId ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</select>';
      return '<select ' + attr + ' aria-label="Discipline or company" disabled><option>—</option></select>';
    };
    const teamPatch = (role, team) => (role === 'lta' ? { discipline: team } : role === 'contractor' ? { contractorId: team } : {});
    const contractors = Array.from(S.contractors.values());
    const classTargets = D.CLASSES.map((c) => c.id).filter((x) => x !== 'Unclassified');
    const nSample = DT.app.sampleDefects().length;
    const mailer = await DT.store.getMailer();

    root.innerHTML =
      '<div class="page-head"><div><h1>Settings</h1><p class="lede">Master control for contractors, email addresses and how the register is read.</p></div></div>' +
      '<div class="settings">' +
      sec(
        'Contractors',
        'LTA assigns defects to these companies. Each company has its own login and sees only its own defects.',
        '<div class="hscroll"><table class="mini-table con-table"><thead><tr><th>Company</th><th>Email for notifications</th><th class="r">Open defects</th><th></th></tr></thead><tbody>' +
          contractors.map((c) => '<tr data-cid="' + c.id + '"><td><input data-f="name" value="' + esc(c.name) + '" maxlength="60" aria-label="Company name"></td><td><input data-f="email" type="email" value="' + esc(c.email) + '" placeholder="name@company.com" aria-label="Email"></td><td class="r">' + DT.app.contractorWorkload(c.id) + '</td><td class="r"><button class="icon-btn sm" data-remove="' + c.id + '" aria-label="Remove ' + esc(c.name) + '">' + UI.icon('trash', 15) + '</button></td></tr>').join('') +
          '</tbody></table></div>' +
          (contractors.length ? '' : '<p class="muted small">No contractors yet. Add the first one below.</p>') +
          '<div class="add-row"><input id="newName" placeholder="Company name" maxlength="60" aria-label="New company name"><input id="newEmail" type="email" placeholder="Email (optional)" aria-label="New company email"><button class="btn sm" id="addCon">' + UI.icon('plus', 14) + 'Add contractor</button></div>' +
          '<p class="muted small">Add the company’s staff as contractor users under Users below.</p>'
      ) +
      sec(
        'Users' + (pendingCount ? ' · ' + pendingCount + ' waiting for approval' : ''),
        'Everyone signs in with their own email and password. Their role decides what they can do; LTA users belong to a discipline and contractor users to a company.',
        '<div class="hscroll"><table class="mini-table user-table"><thead><tr><th>Name</th><th>Email (login)</th><th>Role</th><th>Discipline / company</th><th>Status</th><th>Password</th><th></th></tr></thead><tbody>' +
          users.map((u) => '<tr data-uid="' + esc(u.id) + '"' + (u.status === 'pending' ? ' class="pending-row"' : '') + '><td><input data-uf="name" value="' + esc(u.name) + '" maxlength="80" aria-label="Name"></td><td class="nowrap">' + esc(u.email) + '</td><td>' + roleSelect(u.role, 'data-uf="role"') + '</td><td>' + teamSelect(u, 'data-uf="team"') + '</td><td class="nowrap">' + (u.status === 'pending' ? '<button class="btn sm primary" data-approve="' + esc(u.id) + '">Approve</button>' : '<span class="tag" style="--c:#34c759">Active</span>') + '</td><td><button class="btn sm" data-reset="' + esc(u.email) + '" aria-label="Email ' + esc(u.name) + ' a link to set a new password">Send reset link</button></td><td class="r nowrap">' + (u.id === S.user.id ? '' : '<button class="icon-btn sm" data-rmuser="' + esc(u.id) + '" aria-label="Remove ' + esc(u.name) + '">' + UI.icon('trash', 15) + '</button>') + '</td></tr>').join('') +
          '</tbody></table></div>' +
          '<form class="add-row add-user" id="addUser" novalidate><input name="name" placeholder="Name" maxlength="80" aria-label="New user name"><input name="email" type="email" placeholder="Email" aria-label="New user email">' + roleSelect('stel', 'name="role"') + teamSelect({ role: 'stel' }, 'name="team"') + '<input name="password" type="password" autocomplete="new-password" placeholder="Password (10+ characters)" aria-label="New user password"><button class="btn sm" type="submit">' + UI.icon('plus', 14) + 'Add user</button></form>' +
          '<p class="muted small">Give each new person their first password privately. They can change it from the account menu (top right), or use “Forgot password?” on the sign-in screen. People can also request an account themselves; it waits here until you approve it.</p>'
      ) +
      sec(
        'Automatic emails',
        'Rectify emails the right people at every step, from your Gmail, through the free Rectify mailer (see SETUP.md → “Automatic emails”). Recipients are the team addresses below and each contractor’s email above.',
        '<label class="field"><span>Mailer web app address</span><input id="mailerUrl" type="url" value="' + esc(mailer.url || '') + '" placeholder="https://script.google.com/macros/s/…/exec"></label>' +
          '<div class="btn-row"><button class="btn sm primary" id="mailerSave">Save</button>' +
          (mailer.url ? '<button class="btn sm" id="mailerTest">Send me a test email</button><button class="btn sm" id="mailerToggle">' + (mailer.on ? 'Pause automatic emails' : 'Turn automatic emails on') + '</button>' : '') +
          '</div><p class="muted small">' + (mailer.url ? (mailer.on ? 'On: each step’s emails are sent as soon as it is saved.' : 'Paused: emails wait on the Emails page until someone sends them.') : 'Off: emails wait on the Emails page and open in your own email app.') + '</p>'
      ) +
      sec(
        'Team email addresses',
        'Where Rectify sends emails meant for the Operator and each LTA team.',
        '<div class="two">' + Object.keys(set.mailboxes).map((id) => '<label class="field"><span>' + esc(DT.auth.userById(id).name) + ' email</span><input data-mailbox="' + id + '" type="email" value="' + esc(set.mailboxes[id]) + '" placeholder="' + id + '-team@company.com"></label>').join('') + '</div>'
      ) +
      sec(
        'Classification wording',
        'Standardises the Classification column of the register. Anything else shows as Unclassified and is flagged.',
        '<div class="map2">' +
          Object.keys(set.classMap).map((k) => '<div class="map-row2"><input data-ck="' + esc(k) + '" class="k" value="' + esc(k) + '" aria-label="Wording"><span>' + UI.icon('right', 14) + '</span><select data-cv="' + esc(k) + '" aria-label="Counts as">' + classTargets.map((t) => '<option' + (set.classMap[k] === t ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select><button class="icon-btn sm" data-rmclass="' + esc(k) + '" aria-label="Remove">' + UI.icon('close', 14) + '</button></div>').join('') +
          '</div><button class="btn sm" id="addClass">' + UI.icon('plus', 14) + 'Add wording</button>'
      ) +
      sec('Ageing', 'Day limits for the “how long open defects have waited” chart (comma separated).', '<label class="field"><span>Bucket limits (days)</span><input id="sAge" value="' + esc(set.ageBuckets.join(', ')) + '"></label>') +
      sec(
        'Roles',
        'Who does what in the flow.',
        '<table class="mini-table"><thead><tr><th>Role</th><th>Does</th></tr></thead><tbody>' + Object.keys(DT.auth.ROLES).map((k) => '<tr><td><b>' + esc(DT.auth.ROLES[k].label) + '</b></td><td>' + esc(DT.auth.ROLES[k].blurb) + '</td></tr>').join('') + '</tbody></table>'
      ) +
      sec(
        'Data and privacy',
        'Where your data lives.',
        '<p class="muted">Defects, photos and history are stored in your Firebase project (Google Cloud Firestore) and shared by everyone who signs in. Each browser keeps a copy of what it last saw, cleared on sign-out.</p>' +
          '<p class="muted small">' + (nSample ? 'The ' + U.plural(nSample, 'sample defect') + ' marked “Sample” are made up, to show how the app works. Removing them leaves every other defect as it is.' : 'Sample defects are 8 made-up defects, one in every stage of the flow, for showing how the app works.') + '</p>' +
          '<div class="btn-row">' + (nSample ? '<button class="btn" id="rmSample">Remove sample defects</button>' : '<button class="btn" id="addSample">Add sample defects</button>') + '<button class="btn danger" id="wipe">Delete all defects</button></div>'
      ) +
      sec('Keyboard shortcuts', '', '<div class="keys"><span><kbd>/</kbd> Search defects</span><span><kbd>U</kbd> Upload</span><span><kbd>Arrow keys</kbd> Previous / next defect</span><span><kbd>Esc</kbd> Close</span><span><kbd>Shift</kbd>+click Add a sort column</span></div>') +
      '</div>';

    const box = U.$('.settings', root);
    const rerender = () => V.render(root);
    const saveSettings = async (again) => {
      await DT.app.saveSettings();
      await DT.app.reload();
      if (again) rerender();
      UI.toast('Saved', 'success');
    };
    const guard = async (fn) => {
      try {
        await fn();
      } catch (e) {
        UI.toast(e.message, 'error');
        rerender();
      }
    };

    box.addEventListener('change', (e) =>
      guard(async () => {
        const t = e.target;
        const urow = t.closest('tr[data-uid]');
        if (urow && t.dataset.uf) {
          const id = urow.dataset.uid;
          const role = U.$('[data-uf="role"]', urow).value;
          let patch;
          if (t.dataset.uf === 'role') {
            /* a new role needs a matching team: take the first discipline or company */
            patch = Object.assign({ role }, teamPatch(role, role === 'lta' ? D.DISCIPLINES[0].id : role === 'contractor' && contractors[0] ? contractors[0].id : null));
          } else if (t.dataset.uf === 'team') patch = teamPatch(role, t.value);
          else patch = { [t.dataset.uf]: t.value };
          await DT.store.updateUser(id, patch);
          if (id === S.user.id) return location.reload();
          UI.toast('User saved', 'success');
          return rerender();
        }
        if (t.closest('#addUser') && t.name === 'role') {
          const holder = U.$('#addUser [name="team"]', box);
          holder.outerHTML = teamSelect({ role: t.value }, 'name="team"');
          return;
        }
        const row = t.closest('tr[data-cid]');
        if (row) {
          const c = S.contractors.get(row.dataset.cid);
          const patch = t.dataset.f === 'name' ? { name: t.value, login: null } : { email: t.value };
          await DT.app.saveContractor(Object.assign({}, c, patch));
          UI.toast('Contractor saved', 'success');
          return rerender();
        }
        if (t.dataset.mailbox) {
          set.mailboxes[t.dataset.mailbox] = t.value.trim();
          return saveSettings();
        }
        if (t.id === 'sAge') {
          const n = t.value.split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0).sort((a, b) => a - b);
          if (n.length) set.ageBuckets = Array.from(new Set(n));
          return saveSettings(true);
        }
        if (t.dataset.cv) {
          set.classMap[t.dataset.cv] = t.value;
          return saveSettings();
        }
        if (t.dataset.ck) {
          const old = t.dataset.ck;
          const nk = D.norm(t.value);
          if (nk && nk !== old) {
            set.classMap[nk] = set.classMap[old];
            delete set.classMap[old];
          }
          return saveSettings(true);
        }
      })
    );

    U.$('#addUser', box).addEventListener('submit', (e) =>
      guard(async () => {
        e.preventDefault();
        const f = e.target.elements;
        await DT.store.createUser(Object.assign({ name: f.namedItem('name').value, email: f.namedItem('email').value, role: f.namedItem('role').value, password: f.namedItem('password').value }, teamPatch(f.namedItem('role').value, f.namedItem('team').value)));
        UI.toast('User added', 'success');
        rerender();
      })
    );

    box.addEventListener('click', (e) =>
      guard(async () => {
        const ap = e.target.closest('[data-approve]');
        if (ap) {
          await DT.store.updateUser(ap.dataset.approve, { status: 'active' });
          UI.toast('Account approved', 'success');
          return rerender();
        }
        const rs = e.target.closest('[data-reset]');
        if (rs) {
          await DT.store.sendPasswordReset(rs.dataset.reset);
          UI.toast('Reset link sent to ' + rs.dataset.reset, 'success');
          return;
        }
        const ru = e.target.closest('[data-rmuser]');
        if (ru) {
          const u = users.find((x) => x.id === ru.dataset.rmuser);
          if (await UI.confirm({ title: 'Remove ' + u.name + '?', message: 'They can no longer use Rectify. What they already did stays in the defect history. To free their email for a new account, also delete them in the Firebase console under Authentication.', confirmLabel: 'Remove', danger: true })) {
            await DT.store.deleteUser(u.id);
            rerender();
          }
          return;
        }
        const rm = e.target.closest('[data-remove]');
        if (rm) {
          const c = S.contractors.get(rm.dataset.remove);
          if (await UI.confirm({ title: 'Remove ' + c.name + '?', message: 'Their login stops working. Defects already closed keep their history.', confirmLabel: 'Remove', danger: true })) {
            await DT.app.removeContractor(c.id);
            rerender();
          }
          return;
        }
        if (e.target.closest('#mailerSave')) {
          await DT.store.setMailer({ url: U.$('#mailerUrl', box).value, on: true });
          UI.toast('Automatic emails saved', 'success');
          return rerender();
        }
        if (e.target.closest('#mailerToggle')) {
          await DT.store.setMailer({ url: mailer.url, on: !mailer.on });
          return rerender();
        }
        if (e.target.closest('#mailerTest')) {
          const r = await DT.store.sendEmails(null, true);
          UI.toast('Test email sent to ' + r[0].to + '. Check your inbox.', 'success');
          return;
        }
        if (e.target.closest('#addCon')) {
          await DT.app.saveContractor({ name: U.$('#newName', box).value, email: U.$('#newEmail', box).value });
          UI.toast('Contractor added', 'success');
          return rerender();
        }
        const rc = e.target.closest('[data-rmclass]');
        if (rc) {
          delete set.classMap[rc.dataset.rmclass];
          return saveSettings(true);
        }
        if (e.target.closest('#addClass')) {
          set.classMap['new wording ' + Object.keys(set.classMap).length] = 'Minor';
          return saveSettings(true);
        }
        if (e.target.closest('#rmSample') && (await UI.confirm({ title: 'Remove the sample defects?', message: 'The ' + U.plural(nSample, 'sample defect') + ', their photos, history and emails are removed. Every other defect stays as it is.', confirmLabel: 'Remove', danger: true }))) {
          await DT.app.removeSample();
          rerender();
          UI.toast('Sample defects removed');
          return;
        }
        if (e.target.closest('#addSample')) {
          await DT.app.addSample();
          rerender();
          UI.toast(U.plural(DT.app.sampleDefects().length, 'sample defect') + ' added', 'success');
          return;
        }
        if (e.target.closest('#wipe') && (await UI.confirm({ title: 'Delete all defects?', message: 'Every defect, photo, upload record and email is permanently removed for everyone. Contractors and settings are kept. This cannot be undone.', confirmLabel: 'Delete everything', danger: true }))) {
          await DT.store.wipeDefects();
          await DT.app.reload();
          DT.app.render();
          UI.toast('All defects deleted');
        }
      })
    );
  };
})();


