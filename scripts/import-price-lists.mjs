/**
 * Import the normalized price_lists CSV (built from the government price
 * manuals, see D:\doc\ราคากรมบัญชีกลาง ปี 2569\parse_price_docx.py) into
 * Firestore `price_lists`.
 *
 * Idempotent: each row's document ID is a hash of (source, code, category,
 * itemName), so re-running this script after the CSV is regenerated (e.g.
 * next year's price update, or a fixed parsing bug) updates the same
 * documents instead of creating duplicates.
 *
 * Usage:
 *   node scripts/import-price-lists.mjs --dry-run   # print what would be written, no Firestore calls
 *   node scripts/import-price-lists.mjs             # actually write
 */
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSV_PATH = 'D:\\doc\\ราคากรมบัญชีกลาง ปี 2569\\normalized_price_list.csv';
const DRY_RUN = process.argv.includes('--dry-run');

// Minimal RFC4180-ish CSV parser (handles quoted fields with embedded
// commas/newlines/escaped "" quotes) -- avoids pulling in a new npm
// dependency for a one-off import script.
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\r') {
      // skip, \n handles the line break
    } else if (c === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  return rows.filter((r) => r.length > 1 || r[0] !== '').map((r) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    return obj;
  });
}

function docIdFor(row) {
  const key = [row.source, row.code, row.category, row.itemName].join('|');
  return 'price_' + crypto.createHash('sha1').update(key, 'utf8').digest('hex').slice(0, 16);
}

function toNumber(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function buildDoc(row, updatedAt) {
  const doc = {
    itemId: docIdFor(row),
    code: row.code || null,
    itemName: row.itemName,
    unit: row.unit,
    category: row.category,
    subCategory: row.subCategory,
    subCategoryGroup: row.subCategoryGroup || null,
    subCategoryGroupCode: row.subCategoryGroupCode || null,
    source: row.source,
    sourceYear: row.sourceYear,
    sourcePriority: toNumber(row.sourcePriority),
    note: row.note || null,
    sourceFile: row.sourceFile || null,
    updatedAt,
  };

  const unitCost = toNumber(row.unitCost);
  const unitCostMin = toNumber(row.unitCostMin);
  const unitCostMax = toNumber(row.unitCostMax);
  if (unitCost !== null) doc.unitCost = unitCost;
  if (unitCostMin !== null) doc.unitCostMin = unitCostMin;
  if (unitCostMax !== null) doc.unitCostMax = unitCostMax;

  if (row.qtyTiers) {
    try {
      const tiers = JSON.parse(row.qtyTiers);
      if (Array.isArray(tiers) && tiers.length) doc.qtyTiers = tiers;
    } catch { /* leave qtyTiers out if malformed */ }
  }

  return doc;
}

async function main() {
  const csvText = readFileSync(CSV_PATH, 'utf8');
  const rows = parseCsv(csvText);
  console.log(`read ${rows.length} rows from CSV`);

  // Some source rows share identical (source, code, category, itemName) but
  // are genuinely distinct priced items (e.g. several pipe diameters that
  // happen to use the exact same descriptive text, distinguished only by
  // table position/unitCost) -- never drop a row over a name collision.
  // Disambiguate with a counter suffix instead so every row is preserved.
  const seenCounts = new Map();
  const docs = [];
  for (const row of rows) {
    const doc = buildDoc(row, null);
    const baseId = doc.itemId;
    const n = (seenCounts.get(baseId) ?? 0) + 1;
    seenCounts.set(baseId, n);
    if (n > 1) {
      console.warn(`name collision (kept, suffixed _${n}):`, baseId, doc.itemName);
      doc.itemId = `${baseId}_${n}`;
    }
    docs.push(doc);
  }
  console.log(`${docs.length} documents to write (from ${rows.length} rows, 0 dropped)`);

  if (DRY_RUN) {
    console.log('--dry-run: sample of first 3 docs:');
    console.log(JSON.stringify(docs.slice(0, 3), null, 2));
    console.log('--dry-run: no Firestore writes performed');
    return;
  }

  const keyPath = path.join(__dirname, '..', 'service-account-key.json');
  const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();
  const updatedAt = admin.firestore.Timestamp.now();

  const CHUNK = 450; // stay under Firestore's 500-write batch limit
  let written = 0;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const chunk = docs.slice(i, i + CHUNK);
    const batch = db.batch();
    for (const doc of chunk) {
      const { itemId, ...data } = doc;
      batch.set(db.collection('price_lists').doc(itemId), { ...data, itemId, updatedAt });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`committed batch: ${written}/${docs.length}`);
  }

  console.log('done. total written:', written);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
