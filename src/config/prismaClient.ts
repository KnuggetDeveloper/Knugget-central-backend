import { PrismaClient } from "@prisma/client";

// Create Prisma client with more resilient error handling
const prismaClientSingleton = () => {
  return new PrismaClient({
    log: ['warn', 'error'],
    errorFormat: 'pretty',
  });
};

// Use global to prevent multiple instances during development
type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClientSingleton | undefined;
};

const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Test database connection on startup but don't crash the server if it fails
async function testConnection() {
  try {
    // Attempt to query the database
    await prisma.$queryRaw`SELECT 1`;
    console.log("✅ Database connection successful");
  } catch (error) {
    console.error("❌ Database connection failed:", error);
    // Log error but don't exit process to allow for retry logic
    console.log("Will retry database connections as needed");
  }
}

// Run the test connection (don't wait for it)
testConnection();

export default prisma;