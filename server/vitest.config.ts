import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    // Testy integracyjne dzielą jeden plik SQLite, więc lecą po kolei.
    fileParallelism: false,
    env: { DATABASE_URL: 'file:./test.db' },
  },
});
