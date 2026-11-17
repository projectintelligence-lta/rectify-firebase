# Rectify

Rectify is a web app for managing handover defects on rail projects. The operator (STEL), LTA (Civil and E&M) and contractors record, assign, fix, check and close defects in one shared place, instead of emailing Excel sheets around.

- **Front end:** a static site in `public/` (plain JavaScript, no build step).
- **Data and sign-in:** Firebase Firestore and Firebase Authentication. Access is enforced by `firestore.rules`.
- **Emails:** a Google Apps Script mailer in `mailer/`.
- **Hosting:** Firebase Hosting. Every push to `main` deploys automatically through GitHub Actions.

See [SETUP.md](SETUP.md) for full setup steps.

The Firebase web config in `public/js/firebase-config.js` is not secret: it only identifies the project, and all access is controlled by the security rules.
