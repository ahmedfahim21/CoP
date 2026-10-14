import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

/**
 * How the profile store reaches the database: calls to the cop_* SQL functions defined in
 * supabase/migrations. Production calls them on Supabase with supabase-js; tests run the
 * same migration in an in-memory Postgres (test/pglite.ts).
 */
export interface Rpc {
  /** Calls a function with named arguments and returns its result. Rejects with the
   *  Postgres error code (e.g. '23505', 'P0001') on `code` when the database refuses. */
  call<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  close(): Promise<void>;
}

export class DbError extends Error {
  constructor(message: string, readonly code: string | undefined) {
    super(message);
  }
}

/** The game server's Supabase connection. The secret key bypasses row level security, so it
 *  lives in the server's environment only, never in the client bundle or the repo. */
export function supabaseRpc(url: string, secretKey: string): Rpc {
  const supabase = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async call<T>(fn: string, args: Record<string, unknown>) {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw new DbError(`${fn}: ${error.message}`, error.code);
      return data as T;
    },
    async close() {
      await supabase.removeAllChannels();
    },
  };
}

/** Migration files in apply order (the Supabase CLI reads the same folder). */
export function migrations(): string[] {
  const dir = fileURLToPath(new URL('../../../supabase/migrations/', import.meta.url));
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(`${dir}${f}`, 'utf8'));
}
