import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Please provide an email address: node apps/api/scripts/verify-user.js user@example.com');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User with email "${email}" not found.`);
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { email },
    data: {
      emailVerifiedAt: new Date(),
      status: 'ACTIVE',
    },
  });

  console.log(`\n Account successfully verified!`);
  console.log(` Email: ${updated.email}`);
  console.log(` Verified At: ${updated.emailVerifiedAt}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

