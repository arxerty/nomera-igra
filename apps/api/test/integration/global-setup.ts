import { execSync } from 'node:child_process';

/** Применяет миграции к тестовой БД перед интеграционными тестами. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !process.env.TEST_REDIS_URL) {
    console.warn('[api tests] TEST_DATABASE_URL / TEST_REDIS_URL не заданы — интеграционные тесты пропущены');
    return;
  }
  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url } });
}
