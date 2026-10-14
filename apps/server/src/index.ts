import { logger } from 'colyseus';
import { createAppServer } from './app.js';
import { supabaseRpc } from './db.js';
import { ProfileStore } from './store.js';

const port = Number(process.env.PORT ?? 2567);
// Profiles live in Supabase. The server uses the secret key; it never reaches the client.
// The project URL is the same one the web app uses, so either name works.
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const missing = [!url && 'SUPABASE_URL', !secretKey && 'SUPABASE_SECRET_KEY'].filter(Boolean);
if (!url || !secretKey) {
  throw new Error(`${missing.join(' and ')} not set in the root .env: the secret key is under Supabase → Project Settings → API Keys (see README → Database).`);
}
const store = new ProfileStore(supabaseRpc(url, secretKey));
logger.info(`[store] profiles in Supabase at ${new URL(url).host}`);
await createAppServer({ store }).listen(port);
