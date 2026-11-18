# Rectify

Rectify is a web app for managing handover defects on rail projects. The operator (STEL), LTA (Civil and E&M) and contractors record, assign, fix, check and close defects in one shared place, instead of emailing Excel sheets around.

- **Front end:** a static site in `public/` (plain JavaScript, no build step).
- **Data and sign-in:** Firebase Firestore and Firebase Authentication. Access is enforced by `firestore.rules`.
- **Emails:** a Google Apps Script mailer in `mailer/`.
- **Hosting:** Firebase Hosting. Every push to `main` deploys automatically through GitHub Actions.

See [SETUP.md](SETUP.md) for full setup steps.

## Keys are not stored in GitHub
- **Web config:** `public/js/firebase-config.js` is kept out of the repo. Copy `public/js/firebase-config.example.js` to that name and fill it in for local work. GitHub Actions writes it from the `FIREBASE_WEB_CONFIG` repository secret when deploying.
- **Mailer key:** `mailer/Config.gs` is also kept out of the repo. Copy `mailer/Config.gs.example` to make it.
- **Key restrictions:** the Firebase web API key is restricted in Google Cloud Console to Rectify's own websites and to the Firebase APIs. The key still appears in the live site's code, as it does for every Firebase web app; these restrictions are what protect it.
