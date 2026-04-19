#!/usr/bin/env node
/**
 * Recover TrainingExample rows from the local training/data/labels.json
 * backup after a DB wipe. For each entry in labels.json, creates a
 * TrainingExample row pointing at the locally-saved image file.
 *
 * Assumes:
 * - ocr-hebrew/training/data/labels.json exists
 * - ocr-hebrew/training/data/images/{id}.jpg exists for each entry
 * - The recipient HandwritingProfile exists (pass via --profile-id) OR
 *   --create-profile <name> to create a fresh one owned by --user-id
 *
 * Usage:
 *   node scripts/import-training-data.js --user-id <uid> --create-profile "Recovered"
 *   node scripts/import-training-data.js --user-id <uid> --profile-id <pid>
 *   node scripts/import-training-data.js --dry-run
 *
 * Image-file upload to Supabase Storage is NOT performed — the
 * Supabase `uploads/training/` folder already contains ~2,431 images
 * (they were preserved during the DB wipe). This script only
 * reconstructs the metadata rows.
 */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? def : process.argv[i + 1];
}
function flag(name) {
  return process.argv.includes(name);
}

async function main() {
  const userId = arg("--user-id");
  const profileIdArg = arg("--profile-id");
  const createProfile = arg("--create-profile");
  const dryRun = flag("--dry-run");

  if (!dryRun && !userId) {
    console.error("--user-id is required (or use --dry-run)");
    process.exit(1);
  }
  if (!dryRun && !profileIdArg && !createProfile) {
    console.error("Either --profile-id or --create-profile <name> is required");
    process.exit(1);
  }

  const labelsPath = path.join(__dirname, "..", "..", "training", "data", "labels.json");
  if (!fs.existsSync(labelsPath)) {
    console.error(`Not found: ${labelsPath}`);
    process.exit(1);
  }
  const labels = JSON.parse(fs.readFileSync(labelsPath, "utf8"));
  console.log(`Loaded ${labels.length} labels from ${labelsPath}`);

  if (dryRun) {
    console.log("Dry run — showing first 5 entries:");
    for (const e of labels.slice(0, 5)) console.log("  ", e);
    console.log(`\nWould create ${labels.length} TrainingExample rows.`);
    return;
  }

  const prisma = new PrismaClient();

  let profileId = profileIdArg;
  if (createProfile) {
    const p = await prisma.handwritingProfile.create({
      data: { name: createProfile, userId, description: "Recovered from local backup" },
    });
    profileId = p.id;
    console.log(`Created profile ${p.id} (${p.name})`);
  }

  let inserted = 0;
  let skipped = 0;
  for (const entry of labels) {
    try {
      const text = entry.text;
      if (!text || text === "?") { skipped++; continue; }
      await prisma.trainingExample.create({
        data: {
          profileId,
          imagePath: `training/${userId}/${entry.id}.jpg`,
          text,
          source: entry.source || "imported",
        },
      });
      inserted++;
      if (inserted % 200 === 0) console.log(`  ...${inserted}`);
    } catch (e) {
      console.error(`Entry ${entry.id} failed: ${e.message.slice(0, 120)}`);
      skipped++;
    }
  }
  await prisma.$disconnect();
  console.log(`\nInserted: ${inserted}, Skipped: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
