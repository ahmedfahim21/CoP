// The game server on an in-memory Postgres (PGlite) with the real migrations: no Supabase
// project or keys needed. Everything is forgotten when it stops.
//   pnpm --filter @cop/server local   (then `pnpm --filter @cop/client dev` alongside)
import { logger } from 'colyseus';
import { createAppServer } from '../src/app.js';
import { ProfileStore } from '../src/store.js';
import { testRpc } from '../test/pglite.js';

const port = Number(process.env.PORT ?? 2567);
const store = new ProfileStore(await testRpc());
await store.seasonRollover();
logger.info('[store] in-memory database (nothing is kept after exit)');
await createAppServer({ store }).listen(port);
