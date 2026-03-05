const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

async function main() {
  // Create user
  const hash = await bcrypt.hash("password123", 10);
  const user = await prisma.user.upsert({
    where: { email: "temima@ocrhebrew.com" },
    update: {},
    create: {
      email: "temima@ocrhebrew.com",
      name: "Temima Sokol",
      passwordHash: hash,
    },
  });
  console.log("Created user:", user.name, user.id);

  // Create handwriting profile
  const profile = await prisma.handwritingProfile.create({
    data: {
      name: "Yaakov Shlomo Sokol",
      description: "Talmud/Gemara study notes handwriting",
      userId: user.id,
    },
  });
  console.log("Created profile:", profile.name, profile.id);

  // Upload test files
  const uploadsDir = path.join(__dirname, "uploads", user.id);
  fs.mkdirSync(uploadsDir, { recursive: true });

  const archiveDir = path.join(require("os").homedir(), "Downloads", "archive");
  const files = fs.readdirSync(archiveDir).filter(f => f.endsWith(".JPG"));

  for (const filename of files) {
    const src = path.join(archiveDir, filename);
    const dest = path.join(uploadsDir, `${Date.now()}-${filename}`);
    fs.copyFileSync(src, dest);

    const file = await prisma.file.create({
      data: {
        filename,
        storagePath: dest,
        userId: user.id,
        profileId: profile.id,
      },
    });
    console.log("Uploaded:", filename, file.id);

    // Small delay so timestamps differ
    await new Promise(r => setTimeout(r, 50));
  }

  // Add the known first-line hint as a correction to seed the profile
  const knownCorrections = [
    { original: "מהכות", corrected: "בהלכות" },
    { original: "מכירה", corrected: "דעות" },
  ];
  for (const c of knownCorrections) {
    await prisma.correction.create({
      data: {
        profileId: profile.id,
        originalText: c.original,
        correctedText: c.corrected,
      },
    });
  }
  console.log("Added seed corrections");

  console.log("\n--- Login credentials ---");
  console.log("Email: temima@ocrhebrew.com");
  console.log("Password: password123");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); });
