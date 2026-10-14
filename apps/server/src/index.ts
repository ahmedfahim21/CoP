import { logger } from 'colyseus';
import { createAppServer } from './app.js';
import { ProfileStore } from './store.js';

const port = Number(process.env.PORT ?? 2567);
const dbPath = process.env.COP_DB ?? 'data/cop.sqlite';
const store = new ProfileStore(dbPath);
logger.info(`[store] profiles in ${dbPath}`);
await createAppServer({ store }).listen(port);
