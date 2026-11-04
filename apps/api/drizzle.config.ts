import { defineConfig } from 'drizzle-kit';

// Only generates SQL into ./migrations. Wrangler applies it: `pnpm db:migrate:local`.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './migrations',
});
