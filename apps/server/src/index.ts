import { logger } from 'colyseus';
import { createAppServer } from './app.js';
import { supabaseRpc } from './db.js';
import { ProfileStore } from './store.js';

const port = Number(process.env.PORT ?? 2567);
// Profiles live in Supabase. The server uses the secret key; it never reaches the client.
const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
if (!url || !secretKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set (root .env, see README → Database).');
}
const store = new ProfileStore(supabaseRpc(url, secretKey));
logger.info(`[store] profiles in Supabase at ${new URL(url).host}`);
await createAppServer({ store }).listen(port);
