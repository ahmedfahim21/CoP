import { defineRoom, defineServer } from 'colyseus';
import { QUEUE_ROOM_NAME, ROOM_NAME } from '@cop/shared';
import { apiRouter } from './api.js';
import { BattleRoom } from './BattleRoom.js';
import { QueueRoom } from './QueueRoom.js';
import { trainerSpriteHandler, type FetchFn } from './sprites.js';
import type { ProfileStore } from './store.js';

export function createAppServer(opts: { store: ProfileStore; fetchFn?: FetchFn }) {
  const { store } = opts;
  // Rooms are constructed by Colyseus, so the store is handed to them through a subclass.
  class Battle extends BattleRoom {
    protected override store = store;
  }
  class Queue extends QueueRoom {
    protected override store = store;
  }
  return defineServer({
    rooms: {
      [ROOM_NAME]: defineRoom(Battle),
      [QUEUE_ROOM_NAME]: defineRoom(Queue),
    },
    express: (app) => {
      app.get('/health', (_req, res) => {
        res.json({ ok: true });
      });
      app.get('/sprites/trainer/:name', trainerSpriteHandler(opts.fetchFn ?? fetch));
      app.use('/api', apiRouter(store));
    },
  });
}
