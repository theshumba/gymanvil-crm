// Import the lead engine's call sheet into the Gym Anvil CRM (Firestore `leads`).
//
//   node scripts/import-leads.mjs --dry-run          # show what would happen
//   node scripts/import-leads.mjs                    # write to Firestore
//   node scripts/import-leads.mjs --seed             # also write leads-seed.json
//   node scripts/import-leads.mjs --csv <path>
//
// Idempotent: doc id is a content hash of name+website, so re-running updates in
// place instead of duplicating. NON-DESTRUCTIVE on re-import — anything Melusi has
// typed (crm.notes, stage, disposition, activity, contacts) is preserved; only the
// scraped intel is refreshed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { csvRowToLead, qualifies } from './lib/gym-transform.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_CSV = path.join(process.env.HOME, 'Desktop/Projects/GymAnvil/leads/output/final_callsheet.csv');

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const SEED = args.includes('--seed');
const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : DEFAULT_CSV;

// --- tiny CSV parser (quoted fields, embedded commas/newlines) ---
function parseCSV(text) {
  const rows = []; let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length > 1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const raw = parseCSV(fs.readFileSync(csvPath, 'utf8'));
console.log(`Read ${raw.length} rows from ${csvPath}`);

const leads = [];
const seen = new Set();
let skipped = 0;
for (const r of raw) {
  if (!(r.name || '').trim()) { skipped++; continue; }
  if (r.tier === 'REJECT') { skipped++; continue; }   // nothing to act on
  const lead = csvRowToLead(r);
  if (seen.has(lead.id)) { skipped++; continue; }
  seen.add(lead.id);
  const q = qualifies(lead);
  lead.status = q.ok ? 'qualified' : 'unqualified';
  lead.qualReason = q.reason;
  leads.push(lead);
}

const bySeg = {}, byTier = {};
for (const l of leads) {
  bySeg[l.segment] = (bySeg[l.segment] || 0) + 1;
  byTier[l.gym.tier] = (byTier[l.gym.tier] || 0) + 1;
}
console.log(`\nPrepared ${leads.length} leads (${skipped} skipped: rejects/dupes/no-name)`);
console.log('  qualified :', leads.filter(l => l.status === 'qualified').length);
console.log('  lead bank :', leads.filter(l => l.status === 'unqualified').length);
console.log('  by tier   :', byTier);
console.log('  by segment:', bySeg);
console.log('  w/ owner  :', leads.filter(l => l.ownerName).length,
            '| w/ phone:', leads.filter(l => l.phones.length).length,
            '| w/ email:', leads.filter(l => l.emails.length).length);

if (SEED) {
  const seedPath = path.join(ROOT, 'leads-seed.json');
  fs.writeFileSync(seedPath, JSON.stringify(leads));
  console.log(`\nWrote local seed -> ${seedPath} (${(fs.statSync(seedPath).size / 1024 / 1024).toFixed(2)} MB)`);
}

if (DRY) {
  console.log('\n--dry-run: nothing written to Firestore.');
  console.log('Sample lead:', JSON.stringify(leads[0], null, 2).slice(0, 900));
  process.exit(0);
}

// --- write to Firestore ---
const { default: admin } = await import('firebase-admin');
const keyPath = path.join(ROOT, 'serviceAccountKey.json');
if (!fs.existsSync(keyPath)) { console.error('Missing serviceAccountKey.json at repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) });
const db = admin.firestore();

// Preserve anything the owner has typed; refresh only scraped intel.
const OWNER_OWNED = ['crm', 'activity', 'contacts', 'status', 'qualification', 'whatsapp', 'researchChecklist'];
let created = 0, updated = 0, n = 0;
for (let i = 0; i < leads.length; i += 300) {
  const chunk = leads.slice(i, i + 300);
  const batch = db.batch();
  for (const lead of chunk) {
    const ref = db.collection('leads').doc(lead.id);
    const snap = await ref.get();
    const doc = { ...lead, _modAt: Date.now(), _modBy: 'import' };
    if (snap.exists) {
      const prev = snap.data();
      for (const k of OWNER_OWNED) if (prev[k] !== undefined) doc[k] = prev[k];
      updated++;
    } else created++;
    batch.set(ref, doc, { merge: true });
    n++;
  }
  await batch.commit();
  console.log(`  committed ${Math.min(n, leads.length)}/${leads.length}`);
}
console.log(`\nDone. ${created} created, ${updated} updated (owner-entered data preserved).`);
process.exit(0);
