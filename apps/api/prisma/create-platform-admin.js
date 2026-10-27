/*
 * Platform yöneticisi oluşturur veya parolasını sıfırlar. Düz JavaScript: üretim imajında da çalışır.
 * Kullanım: PLATFORM_PASSWORD='...' node prisma/create-platform-admin.js eposta@ornek.com "Ad Soyad"
 */
require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

async function main() {
  const [email, name] = process.argv.slice(2);
  const password = process.env.PLATFORM_PASSWORD;
  if (!email || !name) throw new Error('Kullanım: node prisma/create-platform-admin.js <e-posta> "<ad soyad>"');
  if (!password || password.length < 12) throw new Error('PLATFORM_PASSWORD ortam değişkeni en az 12 karakter olmalı');
  const prisma = new PrismaClient();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.platformUser.upsert({
      where: { email: email.toLowerCase() },
      create: { email: email.toLowerCase(), name, passwordHash },
      update: { name, passwordHash, isActive: true },
    });
    await prisma.auditLog.create({ data: { action: 'platform.admin.upsert', entityType: 'PlatformUser', entityId: user.id, userEmail: 'cli' } });
    console.log(`Platform yöneticisi hazır: ${user.email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
