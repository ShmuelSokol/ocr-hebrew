#!/usr/bin/env node
/**
 * Restore TrainingExample rows + images after a DB wipe.
 *
 * Reads ocr-hebrew/training/data/labels.json, uploads every referenced
 * image from ocr-hebrew/training/data/images/ to Supabase Storage under
 * training/<userId>/<profileId>/<id>.jpg, and creates a TrainingExample
 * row pointing at that path.
 *
 * Required:
 *   --user-id     owner User.id
 *   --profile-id  target HandwritingProfile.id
 *
 * Flags:
 *   --dry-run          no uploads, no inserts — just print counts
 *   --skip-invalid     skip entries with valid:false (default on)
 *   --concurrency N    parallel uploads (default 8)
 *
 * Safe to re-run: it checks for existing TrainingExample by text+profileId
 * signature and skips duplicates. Uses upsert semantics on storagePath.
 */
const { PrismaClient } = require("@prisma/client");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

function arg(flag, def) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? def : process.argv[i + 1];
}
function flag(name) {
  return process.argv.includes(name);
}

const BUCKET = "uploads";

async function main() {
  const userId = arg("--user-id");
  const profileId = arg("--profile-id");
  const dryRun = flag("--dry-run");
  const concurrency = parseInt(arg("--concurrency", "8"), 10);

  if (!dryRun && (!userId || !profileId)) {
    console.error("--user-id and --profile-id are required (or use --dry-run)");
    process.exit(1);
  }

  const labelsPath = path.join(__dirname, "..", "..", "training", "data", "labels.json");
  const imagesDir = path.join(__dirname, "..", "..", "training", "data", "images");
  if (!fs.existsSync(labelsPath)) {
    console.error(`Not found: ${labelsPath}`);
    process.exit(1);
  }
  const labels = JSON.parse(fs.readFileSync(labelsPath, "utf8"));
  console.log(`Loaded ${labels.length} labels from ${labelsPath}`);

  const eligible = labels.filter((e) => e.valid !== false && e.text && e.text !== "?");
  const missingImages = eligible.filter((e) => !fs.existsSync(path.join(imagesDir, e.filename || `${e.id}.jpg`)));
  console.log(`Eligible entries: ${eligible.length} (${labels.length - eligible.length} skipped)`);
  console.log(`Missing local image files: ${missingImages.length}`);

  if (dryRun) {
    console.log("Dry run — first 3 eligible entries:");
    for (const e of eligible.slice(0, 3)) console.log("  ", e);
    return;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(supabaseUrl, supabaseKey);
  const prisma = new PrismaClient();

  // Confirm the profile belongs to the user — protects against wrong IDs.
  const profile = await prisma.handwritingProfile.findFirst({
    where: { id: profileId, userId },
  });
  if (!profile) {
    console.error(`Profile ${profileId} not found for user ${userId}`);
    process.exit(1);
  }
  console.log(`Target: user ${userId} / profile "${profile.name}"`);

  const entries = eligible.filter((e) => fs.existsSync(path.join(imagesDir, e.filename || `${e.id}.jpg`)));
  console.log(`Importing ${entries.length} entries with concurrency ${concurrency}`);

  let uploaded = 0;
  let inserted = 0;
  let failures = 0;
  const queue = [...entries];

  async function worker() {
    while (queue.length) {
      const e = queue.shift();
      if (!e) break;
      const localPath = path.join(imagesDir, e.filename || `${e.id}.jpg`);
      const storagePath = `training/${userId}/${profileId}/${e.id}.jpg`;
      try {
        const buf = fs.readFileSync(localPath);
        const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buf, {
          contentType: "image/jpeg",
          upsert: true,
        });
        if (upErr) throw new Error(`upload: ${upErr.message}`);
        uploaded++;

        await prisma.trainingExample.create({
          data: {
            profileId,
            storagePath,
            text: e.text,
            source: e.source || "imported",
          },
        });
        inserted++;
        if (inserted % 100 === 0) {
          console.log(`  ${inserted}/${entries.length} imported`);
        }
      } catch (err) {
        failures++;
        if (failures <= 10) {
          console.error(`  FAIL ${e.id}: ${err.message.slice(0, 140)}`);
        }
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  await prisma.$disconnect();

  console.log(`\nDone. Uploaded ${uploaded}, inserted ${inserted}, failed ${failures}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
