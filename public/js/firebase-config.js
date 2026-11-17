/* js/firebase-config.js */
/* Your Firebase project's web settings. Firebase console → Project settings → General → Your apps → Web app →
 * "SDK setup and configuration" → Config. Paste the values below (see SETUP.md, step 3).
 * These values are not secret: they only say which project to talk to. Access is controlled by firestore.rules. */
window.RECTIFY_FIREBASE = {
  apiKey: 'AIzaSyDJ4OGJTTk4vR4LbDdF8tl405TwwFYA_i8',
  authDomain: 'rectify-b5f55.firebaseapp.com',
  projectId: 'rectify-b5f55',
  storageBucket: 'rectify-b5f55.firebasestorage.app',
  messagingSenderId: '302142287317',
  appId: '1:302142287317:web:ab647b7dec64aa4017e15c',
  /* true only when testing with the Firebase emulators on this computer */
  useEmulator: false,
};
/* Local testing: open the app at http://localhost:5050/?emulator to use the emulators instead. */
if (/[?&]emulator\b/.test(location.search) && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
  window.RECTIFY_FIREBASE = Object.assign({}, window.RECTIFY_FIREBASE, { apiKey: 'demo-key', projectId: 'demo-rectify', authDomain: 'localhost', useEmulator: true });
}
