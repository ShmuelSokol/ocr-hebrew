#!/usr/bin/env node
/**
 * Guarded `prisma db push` — blocks accidental schema pushes against a
 * database that already holds data, unless CONFIRM_SCHEMA_CHANGE=yes.
 *
 * Usage:
 *   node scripts/db-push-guarded.js                 # safe, blocks on non-empty DB
 *   CONFIRM_SCHEMA_CHANGE=yes node scripts/...      # proceed with known risk
 *
 * Counts are checked for every user-facing table. If ANY table has rows,
 * the script refuses unless CONFIRM_SCHEMA_CHANGE=yes is set.
 */
const { PrismaClient } = require("@prisma/client");
const { spawn } = require("child_process");
const path = require("path");

const CRITICAL_TABLES = [
  "user",
  "project",
  "handwritingProfile",
  "file",
  "oCRResult",
  "trainingExample",
  "correction",
];

async function main() {
  const confirm = process.env.CONFIRM_SCHEMA_CHANGE === "yes";

  const prisma = new PrismaClient();
  let totalRows = 0;
  const countsByTable = {};
  for (const t of CRITICAL_TABLES) {
    try {
      const c = await prisma[t].count();
      countsByTable[t] = c;
      totalRows += c;
    } catch {
      countsByTable[t] = "missing";
    }
  }
  await prisma.$disconnect();

  console.log("Database state:");
  for (const [t, c] of Object.entries(countsByTable)) {
    console.log(`  ${t}: ${c}`);
  }

  if (totalRows === 0) {
    console.log("\nDB is empty — proceeding with db push (no data at risk).");
  } else if (confirm) {
    console.log(`\nDB has ${totalRows} total rows across user tables.`);
    console.log("CONFIRM_SCHEMA_CHANGE=yes set — proceeding.");
  } else {
    console.error(
      `\nRefusing: database has ${totalRows} rows. A schema push could drop or corrupt data.`
    );
    console.error(
      "If you really mean to push, re-run with CONFIRM_SCHEMA_CHANGE=yes."
    );
    process.exit(1);
  }

  const prismaBin = path.join(
    __dirname,
    "..",
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prisma.cmd" : "prisma"
  );
  const proc = spawn(prismaBin, ["db", "push", "--skip-generate", ...process.argv.slice(2)], {
    stdio: "inherit",
  });
  proc.on("close", (code) => process.exit(code || 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
