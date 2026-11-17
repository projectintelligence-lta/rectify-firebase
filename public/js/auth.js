/* js/auth.js */
/* Rectify — sign-in and roles.
 * Passwords are checked by Firebase Authentication; firestore.rules enforce who may read and change what.
 * The rest of the app only uses the functions below. */
(function () {
  'use strict';
  const DT = window.DT,
    U = DT.U,
    UI = DT.ui;
  const esc = U.esc;
  const A = (DT.auth = {});
  let sessionUser = null;
  A.setSession = (u) => (sessionUser = u || null);

  /* What each role may do outside the workflow. Workflow actions (assign, submit fix …) are in workflow.js.
   * `insights` = the Overview dashboard, defect age and summary figures in exports (not given to STEL). */
  A.ROLES = {
    admin: { label: 'Admin', blurb: 'Master control: contractors, settings and every action', can: ['upload', 'viewAll', 'imports', 'export', 'comment', 'settings', 'insights'] },
    stel: { label: 'Operator (STEL)', blurb: 'Uploads the Civil and E&M defect registers and accepts finished fixes', can: ['upload', 'viewAll', 'imports', 'export', 'comment'] },
    lta: { label: 'LTA', blurb: 'Reviews the defects of its discipline (Civil or E&M), assigns contractors and approves fixes', can: ['viewAll', 'imports', 'export', 'comment', 'insights'] },
    contractor: { label: 'Contractor', blurb: 'Fixes the defects assigned to their company', can: ['export', 'comment', 'insights'] },
  };

  /* Teams: who emails and workflow steps are addressed to (STEL, the LTA of each discipline, each contractor company).
   * They are not logins; people sign in with their own accounts (Settings → Users) and act for their team. */
  const FIXED_USERS = [
    { id: 'admin', name: 'Admin', role: 'admin', email: 'admin@rectify.local' },
    { id: 'stel', name: 'Operator (STEL)', role: 'stel', email: 'stel@rectify.local' },
  ].concat(DT.domain.DISCIPLINES.map((d) => ({ id: 'lta-' + d.id, name: 'LTA ' + d.label, role: 'lta', discipline: d.id, email: 'lta-' + d.id + '@rectify.local' })));
  A.ltaFor = (discipline) => A.userById('lta-' + discipline);
  let contractorUsers = [];

  /* One team per contractor company. Called whenever the contractor list changes. */
  A.setContractors = (contractors) => {
    contractorUsers = contractors.map((c) => ({ id: 'contractor:' + c.id, name: c.name, role: 'contractor', contractorId: c.id, email: c.login }));
  };
  A.users = () => FIXED_USERS.concat(contractorUsers);
  A.userById = (id) => A.users().find((u) => u.id === id) || null;

  A.current = () => sessionUser;
  A.signIn = async (email, password) => {
    if (!String(email || '').trim() || !password) throw new Error('Enter your email and password.');
    const u = await DT.store.signIn(String(email).trim(), password);
    A.setSession(u);
    return u;
  };
  A.signOut = () => {
    A.setSession(null);
    return DT.store.signOut();
  };
  A.can = (action) => {
    const u = DT.state.user;
    return !!(u && A.ROLES[u.role].can.includes(action));
  };
  A.roleLabel = (u) => {
    if (u.role === 'contractor') {
      const c = DT.state.contractors && DT.state.contractors.get(u.contractorId);
      return u.name + ' · ' + (c ? c.name : 'Contractor');
    }
    if (u.role === 'lta') return u.name + ' · LTA ' + DT.domain.disciplineById[u.discipline].label;
    return u.name + ' · ' + A.ROLES[u.role].label;
  };


  /* ---------- sign-in / sign-up screen ---------- */
  A.renderLogin = (root, onDone) => {
    root.hidden = false;
    const enter = (u) => {
      root.classList.add('leaving');
      setTimeout(() => {
        root.hidden = true;
        root.classList.remove('leaving');
        onDone(u);
      }, 380);
    };
    const shake = (form) => {
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    };

    const signInView = () => {
      root.innerHTML =
        '<div class="login-card">' +
        '<div class="login-logo" style="--i:0">' + UI.logo(56, true) + '</div>' +
        '<h1 style="--i:1">Rectify</h1>' +
        '<form class="login-form" style="--i:3" novalidate>' +
        '<label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" placeholder="name@company.com" required></label>' +
        '<label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="Password" required></label>' +
        '<div class="login-err" role="alert"></div>' +
        '<button class="btn primary lg" type="submit">Sign in</button></form>' +
        '<p class="login-foot" style="--i:4"><button type="button" class="link" id="forgot">Forgot password?</button></p>' +
        '<p class="login-foot" style="--i:5">New here? <button type="button" class="link" id="toSignup">Request an account</button></p></div>';
      const form = U.$('form', root),
        err = U.$('.login-err', root);
      U.$('#toSignup', root).addEventListener('click', signUpView);
      U.$('#forgot', root).addEventListener('click', () => resetView(form.email.value));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        try {
          enter(await A.signIn(form.email.value, form.password.value));
        } catch (ex) {
          err.textContent = ex.message;
          shake(form);
        }
      });
    };

    /* Forgot password: a link to choose a new password is emailed to the address, if it has an account. */
    const resetView = (prefill) => {
      root.innerHTML =
        '<div class="login-card">' +
        '<div class="login-logo" style="--i:0">' + UI.logo(56, true) + '</div>' +
        '<h1 style="--i:1">Reset password</h1>' +
        '<p class="login-foot" style="--i:2">Enter the email you sign in with. We’ll email you a link to choose a new password.</p>' +
        '<form class="login-form" style="--i:3" novalidate>' +
        '<label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" placeholder="name@company.com" required value="' + esc(prefill || '') + '"></label>' +
        '<div class="login-err" role="alert"></div>' +
        '<button class="btn primary lg" type="submit">Send reset link</button></form>' +
        '<p class="login-foot" style="--i:5"><button type="button" class="link" id="toSignin">Back to sign in</button></p></div>';
      const form = U.$('form', root),
        err = U.$('.login-err', root);
      U.$('#toSignin', root).addEventListener('click', signInView);
      if (!prefill) form.email.focus();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        const btn = U.$('button[type=submit]', form);
        btn.disabled = true;
        try {
          await DT.store.sendPasswordReset(form.email.value);
          const email = form.email.value.trim();
          root.innerHTML =
            '<div class="login-card"><div class="login-logo" style="--i:0">' + UI.logo(56, true) + '</div><h1 style="--i:1">Check your email</h1>' +
            '<p class="login-foot" style="--i:3">If <b>' + esc(email) + '</b> has a Rectify account, a link to choose a new password is on its way. It works for one hour.</p>' +
            '<p class="login-foot" style="--i:4">Nothing after a few minutes? Check your junk or spam folder, or ask your Rectify Admin.</p>' +
            '<button class="btn primary lg" style="--i:5" id="backBtn">Back to sign in</button></div>';
          U.$('#backBtn', root).addEventListener('click', signInView);
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false;
          shake(form);
        }
      });
    };

    /* The roles a person can ask for. Admin accounts are made only by an existing Admin. */
    const SIGNUP_ROLES = [
      { id: 'stel', label: 'Operator (STEL)' },
      { id: 'lta', label: 'LTA' },
      { id: 'contractor', label: 'Contractor' },
    ];
    const signUpView = async () => {
      let teams = [];
      try {
        teams = (await DT.store.publicTeams()).contractors || [];
      } catch (e) {
        /* the company list is only needed for contractor sign-ups */
      }
      const teamField = (role) => {
        if (role === 'lta') return '<label class="field"><span>Discipline</span><select name="discipline">' + DT.domain.DISCIPLINES.map((d) => '<option value="' + d.id + '">' + esc(d.label) + '</option>').join('') + '</select></label>';
        if (role === 'contractor') return '<label class="field"><span>Company</span><select name="contractorId">' + (teams.length ? teams.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>').join('') : '<option value="">No companies yet — ask your Admin</option>') + '</select></label>';
        return '';
      };
      root.innerHTML =
        '<div class="login-card">' +
        '<div class="login-logo" style="--i:0">' + UI.logo(56, true) + '</div>' +
        '<h1 style="--i:1">Request an account</h1>' +
        '<form class="login-form signup-form" style="--i:3" novalidate>' +
        '<label class="field"><span>Your name</span><input name="name" autocomplete="name" placeholder="Full name" required></label>' +
        '<label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" placeholder="name@company.com" required></label>' +
        '<label class="field"><span>Role</span><select name="role">' + SIGNUP_ROLES.map((r) => '<option value="' + r.id + '">' + esc(r.label) + '</option>').join('') + '</select></label>' +
        '<div id="teamField">' + teamField('stel') + '</div>' +
        '<label class="field"><span>Password (at least 10 characters)</span><input name="password" type="password" autocomplete="new-password" required></label>' +
        '<div class="login-err" role="alert"></div>' +
        '<button class="btn primary lg" type="submit">Request account</button></form>' +
        '<p class="login-foot" style="--i:5">An Admin approves new accounts before first sign-in. <button type="button" class="link" id="toSignin">Back to sign in</button></p></div>';
      const form = U.$('form', root),
        err = U.$('.login-err', root);
      U.$('#toSignin', root).addEventListener('click', signInView);
      form.role.addEventListener('change', () => (U.$('#teamField', root).innerHTML = teamField(form.role.value)));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        const u = { name: form.name.value, email: form.email.value, role: form.role.value, password: form.password.value };
        if (form.role.value === 'lta') u.discipline = form.discipline.value;
        if (form.role.value === 'contractor') u.contractorId = form.contractorId ? form.contractorId.value : '';
        try {
          await DT.store.signUp(u);
          root.innerHTML = '<div class="login-card"><div class="login-logo" style="--i:0">' + UI.logo(56, true) + '</div><h1 style="--i:1">Request sent</h1><p class="login-foot" style="--i:3">Thanks, ' + esc(form.name.value) + '. An Admin will approve your account, then you can sign in.</p><button class="btn primary lg" style="--i:4" id="backBtn">Back to sign in</button></div>';
          U.$('#backBtn', root).addEventListener('click', signInView);
        } catch (ex) {
          err.textContent = ex.message;
          shake(form);
        }
      });
    };

    /* First visit to a new Firebase project: nobody can sign in yet, so the first person creates the Admin account. */
    const setupView = () => {
      root.innerHTML =
        '<div class="login-card">' +
        '<div class="login-logo" style="--i:0">' + UI.logo(56, true) + '</div>' +
        '<h1 style="--i:1">Set up Rectify</h1>' +
        '<p class="login-foot" style="--i:2">Rectify has no accounts yet. Create the Admin account: it approves everyone else.</p>' +
        '<form class="login-form" style="--i:3" novalidate>' +
        '<label class="field"><span>Your name</span><input name="name" autocomplete="name" placeholder="Full name" required></label>' +
        '<label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" placeholder="name@company.com" required></label>' +
        '<label class="field"><span>Password (at least 10 characters)</span><input name="password" type="password" autocomplete="new-password" required></label>' +
        '<div class="login-err" role="alert"></div>' +
        '<button class="btn primary lg" type="submit">Create Admin account</button></form></div>';
      const form = U.$('form', root),
        err = U.$('.login-err', root);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        err.textContent = '';
        try {
          const u = await DT.store.createFirstAdmin({ name: form.name.value, email: form.email.value, password: form.password.value });
          A.setSession(u);
          enter(u);
        } catch (ex) {
          err.textContent = ex.message;
          shake(form);
        }
      });
    };

    signInView();
    DT.store.needsSetup().then((yes) => yes && setupView());
  };
})();


