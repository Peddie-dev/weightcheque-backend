import http from 'http';
import { createApp } from './app';
import { config } from './config';
import { logger } from './config/logger';
import prisma from './config/prisma';
import { startCronJobs } from './jobs/cron';
import { setupSocketIO, setIO } from './config/socket';

async function bootstrap() {
  // Test DB connection
  try {
    await prisma.$connect();
    logger.info('✅ Database connected');
  } catch (err) {
    logger.error('❌ Database connection failed', { err });
    process.exit(1);
  }

  const app        = createApp();
  const httpServer = http.createServer(app);

  // Socket.io for real-time messaging
  const io = setupSocketIO(httpServer);
  setIO(io);
  logger.info('✅ Socket.io initialised');

  httpServer.listen(config.PORT, () => {
    logger.info(`🚀 WeightCheque API running`);
    logger.info(`   ENV  : ${config.NODE_ENV}`);
    logger.info(`   PORT : ${config.PORT}`);
    logger.info(`   BASE : http://localhost:${config.PORT}${config.API_PREFIX}`);
  });

  if (config.NODE_ENV !== 'test') startCronJobs();

  const shutdown = async (signal: string) => {
    logger.info(`${signal} — graceful shutdown...`);
    httpServer.close(async () => {
      io.close();
      await prisma.$disconnect();
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection', { reason }));
  process.on('uncaughtException',  (err)    => { logger.error('Uncaught exception', { err }); process.exit(1); });
}

bootstrap();
