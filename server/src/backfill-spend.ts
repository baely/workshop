// CLI: node src/backfill-spend.ts [--from <copy of an old workshop.db>]
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { initDb, run } from './db.ts';
import { backfillSpend } from './spend.ts';

const i = process.argv.indexOf('--from');
const from = i >= 0 ? process.argv[i + 1] : undefined;
if (i >= 0 && !from) {
  console.error('Usage: node src/backfill-spend.ts [--from <path to a copy of an old workshop.db>]');
  process.exit(1);
}
if (from && !fs.existsSync(from)) {
  console.error(`There is no database file at ${from}.`);
  process.exit(1);
}

const db = initDb(path.join(config.dataDir, 'workshop.db'));
let filled = 0;
let added = 0;
if (from) {
  run('ATTACH DATABASE ? AS src', path.resolve(from));
  try {
    const r = backfillSpend('src');
    filled += r.filled;
    added += r.added;
  } finally {
    run('DETACH DATABASE src');
  }
}
const r = backfillSpend('main');
filled += r.filled;
added += r.added;
console.log(`Filled the project for ${filled} ledger rows; added ${added} rows from runs missing from the ledger.`);
db.close();
