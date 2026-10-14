import { PGlite } from '@electric-sql/pglite';
import { DbError, migrations, type Rpc } from '../src/db.js';

/**
 * Test double for Supabase: an in-memory Postgres (no server, nothing on disk) with the real
 * migration applied, so the cop_* functions under test are exactly what Supabase runs.
 */
export async function testRpc(): Promise<Rpc> {
  const pg = new PGlite();
  for (const sql of migrations()) await pg.exec(sql);
  return {
    async call<T>(fn: string, args: Record<string, unknown>) {
      const names = Object.keys(args);
      const params = names.map((n) => {
        const v = args[n];
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      const list = names.map((n, i) => `${n} => $${i + 1}`).join(', ');
      try {
        const { rows } = await pg.query<{ result: T }>(`select ${fn}(${list}) as result`, params);
        return rows[0]!.result;
      } catch (err) {
        throw new DbError(`${fn}: ${(err as Error).message}`, (err as { code?: string }).code);
      }
    },
    close: () => pg.close(),
  };
}
