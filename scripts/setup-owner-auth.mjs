// Create the owner login and lock Firestore to that single account.
//
// RUN THIS AFTER enabling Authentication in the Firebase console (one click:
// console.firebase.google.com/project/gymanvil-crm/authentication -> Get started
// -> Email/Password -> Enable). Auth cannot be switched on from the CLI, which is
// why this is a separate step.
//
//   node scripts/setup-owner-auth.mjs                      # default email, prompts nothing
//   node scripts/setup-owner-auth.mjs you@example.com 'password'
//
// Idempotent: if the account already exists it just resets the password.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const email = process.argv[2] || 'joshuakhalili20@gmail.com';
const password = process.argv[3] || 'GymAnvil2026!';

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(fs.readFileSync(path.join(ROOT, 'serviceAccountKey.json'), 'utf8'))),
});

let uid;
try {
  const u = await admin.auth().createUser({ email, password, emailVerified: true });
  uid = u.uid;
  console.log('Created owner account:', email);
} catch (e) {
  if (e.code === 'auth/email-already-exists') {
    const u = await admin.auth().getUserByEmail(email);
    await admin.auth().updateUser(u.uid, { password });
    uid = u.uid;
    console.log('Owner account already existed — password reset:', email);
  } else if (e.code === 'auth/configuration-not-found') {
    console.error('\nAuthentication is not enabled on this Firebase project yet.');
    console.error('Enable it here (one click), then re-run this script:');
    console.error('  https://console.firebase.google.com/project/gymanvil-crm/authentication');
    console.error('  Get started -> Email/Password -> Enable -> Save\n');
    process.exit(1);
  } else throw e;
}

console.log('OWNER UID:', uid);

// Tighten the rules from "any signed-in user" to this UID only.
const rulesPath = path.join(ROOT, 'firestore.rules');
const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Gym Anvil CRM — single-owner lockdown. The page is publicly hosted; these
    // rules are the lock, not the URL. The importer and CLI use the service
    // account (admin SDK), which bypasses rules by design.
    function isOwner() {
      return request.auth != null && request.auth.uid == '${uid}';
    }
    match /{document=**} {
      allow read, write: if isOwner();
    }
  }
}
`;
fs.writeFileSync(rulesPath, rules);
console.log('Wrote single-owner firestore.rules. Deploy them with:');
console.log('  firebase deploy --only firestore:rules --project gymanvil-crm');
process.exit(0);
