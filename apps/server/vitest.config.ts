import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Each room test file boots a game server on @colyseus/testing's fixed port.
    fileParallelism: false,
  },
});
