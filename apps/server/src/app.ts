import { defineRoom, defineServer } from 'colyseus';
import { ROOM_NAME } from '@cop/shared';
import { BattleRoom } from './BattleRoom.js';
import { trainerSpriteHandler, type FetchFn } from './sprites.js';

export function createAppServer(opts: { fetchFn?: FetchFn } = {}) {
  return defineServer({
    rooms: { [ROOM_NAME]: defineRoom(BattleRoom) },
    express: (app) => {
      app.get('/health', (_req, res) => {
        res.json({ ok: true });
      });
      app.get('/sprites/trainer/:name', trainerSpriteHandler(opts.fetchFn ?? fetch));
    },
  });
}
