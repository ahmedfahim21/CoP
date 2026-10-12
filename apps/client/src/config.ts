/** Game server origin. Defaults to the page's host on :2567 so phones on the LAN work too. */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ?? `${location.protocol}//${location.hostname}:2567`;
