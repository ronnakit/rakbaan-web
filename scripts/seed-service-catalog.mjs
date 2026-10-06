import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(__dirname, '..', 'service-account-key.json');
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// Import initial services from services-data.js
const { INITIAL_SERVICES } = await import('../src/services-data.js');

async function main() {
  console.log(`Seeding ${INITIAL_SERVICES.length} service items to Firestore 'service_catalog'...`);
  const batch = db.batch();
  const now = admin.firestore.Timestamp.now();

  for (const item of INITIAL_SERVICES) {
    const docRef = db.collection('service_catalog').doc(item.id);
    batch.set(docRef, {
      ...item,
      updatedAt: now,
    }, { merge: true });
  }

  await batch.commit();
  console.log('✅ Successfully seeded service_catalog to Firestore!');
}

main().catch((err) => {
  console.error('Error seeding services:', err);
  process.exit(1);
});
