// One-time bootstrap: no UI/callable exposes this on purpose -- granting
// yourself 'team'/'admin' must never be reachable from a signed-in client,
// only from someone holding the service-account key (see README "สิทธิ์
// staff" section for how to get the key and enable Email/Password sign-in
// first).
//
// Usage:
//   node scripts/grant-staff-role.js someone@example.com [role]
//   role defaults to "team"; valid values: team | admin | super_admin
//   (must match MIN_ROLE_FOR_TARGET_STATUS in functions/src/index.ts and
//   role()/isTeamOrAdmin()/isAdmin() in firestore.rules)
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(__dirname, '..', 'service-account-key.json');

const email = process.argv[2];
const role = process.argv[3] || 'team';
const VALID_ROLES = ['team', 'admin', 'super_admin'];

if (!email) {
  console.error('Usage: node scripts/grant-staff-role.js <email> [team|admin|super_admin]');
  process.exit(1);
}
if (!VALID_ROLES.includes(role)) {
  console.error(`Invalid role "${role}". Must be one of: ${VALID_ROLES.join(', ')}`);
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch {
  console.error(
    `ไม่พบ ${keyPath}\n` +
    'ดาวน์โหลดจาก Firebase Console: Project settings > Service accounts > Generate new private key\n' +
    'แล้ววางไฟล์ไว้ที่ rakbaan_ops/service-account-key.json (อยู่ใน .gitignore แล้ว ห้าม commit)'
  );
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });

const user = await admin.auth().getUserByEmail(email);
await admin.auth().setCustomUserClaims(user.uid, { role });

console.log(`ตั้ง role="${role}" ให้ ${email} (uid=${user.uid}) แล้ว`);
console.log('ให้ผู้ใช้คนนี้ sign out แล้ว sign in ใหม่ในเว็บ ops-portal เพื่อรับ ID token ใหม่');
