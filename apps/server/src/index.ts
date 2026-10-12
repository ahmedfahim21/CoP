import { createAppServer } from './app.js';

const port = Number(process.env.PORT ?? 2567);
await createAppServer().listen(port);
