#!/usr/bin/env node
/**
 * Export all OCR Hebrew tables to a timestamped JSON file.
 *
 * Usage:
 *   node scripts/db-backup.js                # writes backups/YYYY-MM-DD.json
 *   node scripts/db-backup.js --dir /path    # custom output dir
 *
 * Designed to be run from cron. Non-destructive. Pure read.
 */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const TABLES = [
  "user",
  "project",
  "handwritingProfile",
  "file",
  "oCRResult",
  "oCRLine",
  "oCRWord",
  "trainingExample",
  "correction",
  "approvedText",
  "tokenUsage",
];

async function main() {
  const dirFlag = process.argv.indexOf("--dir");
  const outDir = dirFlag !== -1 ? process.argv[dirFlag + 1] : path.join(__dirname, "..", "backups");
  fs.mkdirSync(outDir, { recursive: true });

  const prisma = new PrismaClient();
  const snapshot = { takenAt: new Date().toISOString(), tables: {} };

  for (const t of TABLES) {
    try {
      const rows = await prisma[t].findMany();
      snapshot.tables[t] = { count: rows.length, rows };
      console.log(`  ${t}: ${rows.length} rows`);
    } catch (e) {
      snapshot.tables[t] = { error: e.message.slice(0, 200) };
      console.log(`  ${t}: ERROR (${e.message.slice(0, 80)})`);
    }
  }
  await prisma.$disconnect();

  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `db-${today}.json`);
  fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`\nWrote ${outPath}`);

  const files = fs.readdirSync(outDir).filter((n) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  const KEEP = 30;
  if (files.length > KEEP) {
    for (const f of files.slice(0, files.length - KEEP)) {
      fs.unlinkSync(path.join(outDir, f));
      console.log(`Pruned old backup: ${f}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
