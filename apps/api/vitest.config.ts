import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./test/integration/global-setup.ts'],
    // Интеграционные тесты делят одну тестовую БД — файлы идут по очереди.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
