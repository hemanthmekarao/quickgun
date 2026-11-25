import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './app.factory';
import { loadConfig } from './config';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = await createApp();
  await app.listen(cfg.port, '0.0.0.0');
  const log = new Logger('HomeOS');
  log.log(`API listening on port ${cfg.port} (${cfg.env})`);
  log.log(`API docs: ${cfg.publicApiUrl}/docs · OpenAPI: ${cfg.publicApiUrl}/openapi.json`);
  if (!cfg.isProd && !process.env.JWT_SECRET) log.warn('JWT_SECRET is not set: using a random development secret, sessions end when the server restarts.');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
