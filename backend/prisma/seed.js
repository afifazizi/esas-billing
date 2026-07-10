import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking ESAS database...');

  const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
  const existingAdmin = await prisma.user.findUnique({ where: { username: 'admin' } });

  if (!existingAdmin) {
    // Only create admin if none exists — never overwrite existing passwords
    const adminPassword = await bcrypt.hash('admin123', rounds);
    await prisma.user.create({
      data: {
        username: 'admin',
        password: adminPassword,
        userRole: 'admin',
        email: 'admin@esas.local',
        fullname: 'System Administrator',
      },
    });
    console.log('  Created admin user (admin / admin123)');
  } else {
    console.log('  Admin user exists — skipping');
  }

  console.log('Seed complete (non-destructive).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
