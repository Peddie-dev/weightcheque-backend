import 'dotenv/config';
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const email = "henryedwin92@gmail.com";

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error("account not found");
  }

  await prisma.subscription.upsert({
    where: {
      userId: user.id,
    },
    update: {
      status: "ACTIVE",
      interval: "YEARLY",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date("2099-12-31"),
      cancelAtPeriodEnd: false,
      canceledAt: null,
    },
    create: {
      userId: user.id,
      status: "ACTIVE",
      interval: "YEARLY",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date("2099-12-31"),
    },
  });

  console.log("✅ Google Play review account granted premium.");
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  });