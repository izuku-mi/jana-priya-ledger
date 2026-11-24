/**
 * Turn a backup from the old daily-report app into a backup file this app can restore
 * (Settings → Restore from file).
 *
 *   npm run legacy-to-backup -- <old-backup.json> <from YYYY-MM-DD> <to YYYY-MM-DD> <out.json>
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { cashDay } from '../src/app/core/ledger';
import { convertLegacy, isLegacyBackup } from '../src/app/core/legacy';
import { DEFAULT_SETTINGS } from '../src/app/core/model';
import type { BackupFile } from '../src/app/core/store';

const [src, from, to, out] = process.argv.slice(2);
if (!src || !from || !to || !out) {
  console.error('usage: legacy-to-backup <old-backup.json> <from> <to> <out.json>');
  process.exit(1);
}

const old = JSON.parse(readFileSync(src, 'utf8'));
if (!isLegacyBackup(old)) throw new Error(`${src} is not a backup from the old app`);

const { skus, sheets, merged } = convertLegacy(old, from, to);
const data: BackupFile['data'] = { settings: { ...DEFAULT_SETTINGS }, skus, sheets, inwards: [], notes: [] };
const file: BackupFile = {
  app: 'jana-priya-ledger',
  schema: 1,
  exportedAt: new Date().toISOString(),
  checksum: createHash('sha256').update(JSON.stringify(data)).digest('hex'),
  data,
};
writeFileSync(out, JSON.stringify(file));

for (const s of sheets) {
  const d = cashDay(s);
  console.log(`${s.date}  sales ${d.gross}  bottles ${d.units}  expected cash ${d.expected}  counted ${d.counted ?? 'not counted'}`);
}
console.log(`${sheets.length} days, ${skus.length} brands, merged duplicates: ${merged.map(([a, b]) => `${a}→${b}`).join(', ') || 'none'}`);
console.log(`written ${out}`);
