# Rectify on Firebase: setup

This version of Rectify runs on Google Firebase's free **Spark** plan, with no credit card and no server to look after.

- **Firebase Authentication** handles everyone's email and password.
- **Cloud Firestore** stores the defects, history, photos, uploads, emails, contractors, users and settings.
- **Firebase Hosting** serves the app at `https://<your-project-id>.web.app`.

Who can do what is enforced by `firestore.rules`. The app hides buttons, and the rules turn down the request itself.

## How accounts work

1. **First Admin.** The first time anyone opens a new deployment, Rectify shows **Set up Rectify**. Whoever fills it in becomes the Admin, and this happens only once. Do it straight after you deploy.
2. **Admin adds people.** Go to Settings → Users → **Add user** and enter a name, email, role (Operator/STEL, LTA, Contractor or Admin), the discipline or company, and a first password. Pass the password on privately. The account can be used straight away.
3. **People can also ask for access.** On the sign-in screen, **Request an account** creates a *pending* account. It can't see anything until an Admin presses **Approve** in Settings → Users.
4. **Passwords.** People change their own from the account menu, or use **Forgot password?** on the sign-in screen. An Admin can press **Send reset link** for anyone. Firebase sends these emails from `noreply@<project-id>.firebaseapp.com`.
5. **Removing someone** takes away their access at once. To use the same email for a new account later, also delete it in the Firebase console under **Authentication → Users**.

## One-time setup (about 15 minutes)

### 1. Create the Firebase project
1. Go to <https://console.firebase.google.com> and sign in with the Google account that should own Rectify.
2. **Create a project**, name it (for example `rectify`), and switch off Google Analytics, which isn't needed. It starts on the free Spark plan.

### 2. Switch on sign-in and the database
1. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable → Save.** Leave "Email link" off.
2. **Build → Firestore Database → Create database.**
   - Location: pick the one closest to your users, for example `asia-southeast1 (Singapore)`. **This can't be changed later.**
   - Start in **production mode**. The rules in this folder replace the defaults when you deploy.

### 3. Connect the app to your project
1. **Project settings** (gear icon) → **General** → *Your apps* → click the **`</>` (Web)** icon. Give it a nickname, tick **"Also set up Firebase Hosting"**, and press **Register app**.
2. Copy the values from the `firebaseConfig` it shows into **`public/js/firebase-config.js`**. Make it by copying `public/js/firebase-config.example.js`; it is not stored in GitHub. (`apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId` and `appId`).
   These values aren't secret. They only tell the app which project to talk to.

### 4. Install the Firebase command-line tool (once per computer)
You need Node.js. In Terminal, run:

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

### 5. Deploy
In Terminal, from this `rectify-firebase` folder:

```bash
firebase use --add
```
Pick your project and give it the alias `default`.

```bash
firebase deploy --only firestore,hosting
```

This uploads the security rules, the two database indexes and the app. It prints your address, for example `https://rectify-1234.web.app`.

> The indexes take a few minutes to build after the first deploy. Until they're ready, LTA users may see "A Firestore index is missing". Wait and reload.

### 6. Create the Admin and invite people
Open the address, fill in **Set up Rectify**, and you're the Admin. Then:
- **Settings → Contractors**: add or rename the contractor companies.
- **Settings → Users**: add people, or approve the ones who requested an account.

To publish an update to the app later, run `firebase deploy --only hosting` again. Use `--only firestore` after you change `firestore.rules`.

## Free-plan limits (Spark)

| What | Free allowance | What it means for Rectify |
|---|---|---|
| Firestore storage | 1 GiB | Photos use most of it. Each photo is kept at under 0.9 MB, often far less, so expect a few thousand photos. |
| Firestore reads | 50,000 per day | Each browser keeps a copy and only fetches what changed since its last visit, so normal use stays well under this. Signing out clears the copy, so the next sign-in reads everything once. |
| Firestore writes | 20,000 per day | Uploading a register of N defects takes about 2 × N writes, plus 2 per new photo. |
| Hosting | 10 GB stored, 360 MB per day transferred | Plenty for the app itself. |
| Authentication | Free for email and password | — |

If a daily limit runs out, Rectify shows "The free Firebase quota for today is used up". It resets at midnight Pacific time (3–4 pm Singapore time). For more headroom, switch the project to the pay-as-you-go **Blaze** plan. The same free allowance still applies, and you pay only for use above it.

Check usage in the Firebase console under **Firestore Database → Usage**.

## Automatic emails (free, through your Gmail)
Rectify writes an email at every workflow step: upload, assign, submit fix, approve and so on. The **Rectify mailer** (`mailer/`) sends them from the Gmail account that owns the Firebase project. It runs free on Google Apps Script, with about **100 recipients a day** on a normal Gmail account, or 1,500 on Google Workspace.

How it stays safe:
- Rectify sends the mailer only the signed-in person's Firebase token and the ids of the emails to send.
- The mailer checks the token and that the account is active, then reads each email from Firestore.
- It sends each email only to the address the Admin set in Settings, and marks it sent, so nothing is sent twice.
- Nobody can use the mailer to send their own text, or to send to addresses of their choosing.

### Set it up once (about 5 minutes)
Sign in to Google with the **same account that owns the Firebase project**.
1. Go to <https://script.google.com>, click **New project**, and rename it **Rectify mailer**.
2. Replace everything in `Code.gs` with the contents of **`mailer/Code.gs`**. Then add a file named `Config.gs` with the contents of `mailer/Config.gs.example`, and paste in your API key.
3. Click **Project Settings** (gear icon) and tick **Show "appsscript.json" manifest file in editor**. Back in the editor, replace `appsscript.json` with the contents of **`mailer/appsscript.json`**. Save with ⌘S.
4. Choose the function **`authorize`** in the toolbar and click **Run**. Google asks you to allow the mailer to send email as you, connect to external services, and read and write your Firestore data. Allow all three.
5. Click **Deploy → New deployment**, and pick **Web app** as the type.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, then copy the **Web app URL**. It ends in `/exec`.
6. In Rectify, go to **Settings → Automatic emails**, paste the URL, click **Save**, then click **Send me a test email**.
7. Fill in **Settings → Team email addresses** (STEL, LTA Civil, LTA E&M), and each contractor's email under **Settings → Contractors**.

From then on, each step's emails go out as soon as it's saved. Anything that couldn't be sent waits on the **Emails** page:
- **No address yet:** add the address in Settings, then press **Send** or **Send all waiting**.
- **Daily limit reached:** press **Send** or **Send all waiting** the next day.

Emails for the made-up sample defects are never sent.

If you change `mailer/Code.gs` later, use **Deploy → Manage deployments → Edit → Version: New version**. That keeps the same URL.

### This project's mailer
- Apps Script project **Rectify mailer** (owner: the Firebase project's Google account), managed with `clasp` from the `mailer/` folder.
- Web app address to paste into **Settings → Automatic emails**:
  `https://script.google.com/macros/s/AKfycbyqeqgVRerJZ3hzdKgjnGR87iCFI38eX7khZLYSCblgbCNqU4yjYiPmHTtZwjEBq5EZ2Q/exec`
- To update it after changing `mailer/Code.gs`, run these from `mailer/`. The address stays the same.

```bash
clasp push --force
```

```bash
clasp update-deployment AKfycbyqeqgVRerJZ3hzdKgjnGR87iCFI38eX7khZLYSCblgbCNqU4yjYiPmHTtZwjEBq5EZ2Q
```

## Hosting on Airbase
The same app also runs on Airbase at **https://rectifyfire.app.tc1.airbase.sg**, in a small nginx container (`Dockerfile`, `nginx.conf`). Sign-in, data and emails work exactly as on Firebase Hosting.

To publish an update, run this from this folder (Docker Desktop must be running):

```bash
./deploy-airbase.sh
```

The script builds a fresh `linux/amd64` image, which Airbase requires, and deploys it to the Airbase project in `airbase.json` (`project-intelligence/rectifyfire`).

Airbase only allows scripts from the site itself, so the Firebase libraries are bundled in `public/vendor/firebase/` instead of being loaded from Google.

## Differences from the server version (`rectify/`)
- **Admins can't type a new password for someone else**, because a browser can't change another person's Firebase password. Use **Send reset link** instead.
- **Login emails can't be edited.** Add the person again with the new email, then remove the old account.

## Testing on your own computer (optional)
The Firebase emulators run everything locally with throwaway data. They need **Java 11 or newer**.
On this Mac, Java 21 (Eclipse Temurin) is installed in `~/.local/share/jdk-dl/`, so first run:

```bash
export JAVA_HOME="$(ls -d ~/.local/share/jdk-dl/jdk-21*/Contents/Home)"; export PATH="$JAVA_HOME/bin:$PATH"
```

Test accounts for the emulators are listed in `emulator-test-accounts.json`. On a fresh emulator, the app first asks you to set up the Admin.

```bash
firebase emulators:start --project demo-rectify
```

Then open <http://localhost:5050/?emulator>. The emulator dashboard is at <http://localhost:4000>.

## Files
| File | What it is |
|---|---|
| `public/` | The app (the same Rectify, with Firebase sign-in and storage) |
| `public/js/firebase-config.js` | **You fill this in** (step 3). Copy it from `firebase-config.example.js`; not stored in GitHub |
| `public/js/store.js` | Reads and writes Firestore and handles sign-in |
| `firestore.rules` | Who may read and change what |
| `firestore.indexes.json` | Two database indexes the LTA views need |
| `firebase.json` | Hosting and emulator settings |
