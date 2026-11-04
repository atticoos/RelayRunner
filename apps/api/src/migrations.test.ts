import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

// Migrations are named YYYYMMDDHHMMSS_name.sql (drizzle-kit's `timestamp` prefix), never 0001_name.sql.
const dir = new URL('../migrations/', import.meta.url);
const files = readdirSync(dir).filter(name => name.endsWith('.sql'));
const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', dir), 'utf8')) as { entries: { tag: string }[] };

describe('D1 migrations', () => {
  test('use timestamp prefixes', () => {
    for (const file of files) expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  test('match the drizzle journal, in order', () => {
    expect(files.sort()).toEqual(journal.entries.map(entry => `${entry.tag}.sql`));
  });
});
