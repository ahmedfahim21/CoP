// README screenshots, taken from the running game (`pnpm dev`) with headless Chrome over the
// DevTools protocol: title, home, deck builder, a card's details and a live gym battle,
// as a phone sees them, plus a few arenas from the Battle tab's slider. Writes
// docs/screenshots/*.webp.
//
//   pnpm screenshots                     (APP_URL=http://localhost:5173 by default)
//   STORAGE=path/to/storage.json pnpm screenshots
//
// STORAGE seeds localStorage (e.g. an existing test profile's `cop:credential`) so the run
// doesn't create a new profile on the server. Without it the game makes a fresh guest profile.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../docs/screenshots');
const app = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const chromePath = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const storage = process.env.STORAGE ? JSON.parse(readFileSync(process.env.STORAGE, 'utf8')) : {};
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(out, { recursive: true });
const profileDir = mkdtempSync(join(tmpdir(), 'cop-shots-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  '--hide-scrollbars', '--mute-audio', '--no-first-run', '--window-size=390,844', 'about:blank',
], { stdio: 'ignore' });

try {
  // Wait for DevTools, then attach to the page.
  let pageWs;
  for (let i = 0; i < 50 && !pageWs; i++) {
    await sleep(200);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      pageWs = targets.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
    } catch { /* not listening yet */ }
  }
  if (!pageWs) throw new Error('Chrome DevTools did not come up');

  const ws = new WebSocket(pageWs);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let nextId = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`));
      else ok(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((ok, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve: ok, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  /** Evaluate in the page; throws with the page's own error message. */
  const js = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value;
  };
  const waitFor = async (expression, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await js(`!!(${expression})`)) return;
      await sleep(150);
    }
    throw new Error(`timed out waiting for ${expression}`);
  };
  const tap = async (x, y) => {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    }
  };
  /** Centre of an element, in CSS pixels. */
  const centre = (selector) => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  const shot = async (name, clip) => {
    const { data } = await send('Page.captureScreenshot', { format: 'webp', quality: 90, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    writeFileSync(join(out, `${name}.webp`), Buffer.from(data, 'base64'));
    console.log(`docs/screenshots/${name}.webp`);
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', PHONE);
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `for (const [k, v] of Object.entries(${JSON.stringify(storage)})) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);`,
  });

  // Title screen, once every model is in.
  await send('Page.navigate', { url: `${app}/` });
  await waitFor(`document.querySelector('.boot.ready')`, 60000);
  await sleep(1500);
  await shot('title');

  // Home: the battle tab over the arena diorama. A new trainer is asked for a name first.
  await js(`document.querySelector('.boot-play').click()`);
  await waitFor(`!document.querySelector('.boot')`);
  if (await js(`!!document.querySelector('.intro')`)) {
    await js(`document.querySelector('.intro-chip').click(); document.querySelector('.intro-go').click()`);
    await waitFor(`!document.querySelector('.intro')`);
  }
  await sleep(2500);
  await shot('home');

  // Arenas: slide to a few, cropped to the arena, without the slider's controls. The screenshot
  // trainer is new, so everything past Pallet Town says "locked"; that's left off the label.
  await js(`document.head.append(Object.assign(document.createElement('style'), { id: 'shots', textContent: '.arena-lock, .arena-nav, .arena-dots { display: none !important; }' }))`);
  for (const [index, id] of [[2, 'viridian'], [4, 'cerulean'], [8, 'saffron'], [9, 'cinnabar'], [10, 'indigo']]) {
    await js(`(() => {
      const at = () => [...document.querySelectorAll('.arena-dots .dot')].findIndex((d) => d.classList.contains('on')) + 1;
      while (at() < ${index}) document.querySelector('.arena-nav.next').click();
      while (at() > ${index}) document.querySelector('.arena-nav.prev').click();
    })()`);
    await sleep(2200);
    await js(`(() => { const s = document.querySelector('.arena-label small'); s.textContent = s.textContent.replace(' · locked', ''); })()`);
    const box = await js(`(() => { const r = document.querySelector('.arena-showcase').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    await shot(`arena-${id}`, box);
  }
  await js(`document.getElementById('shots').remove()`);

  // The deck builder, then a card's details.
  await js(`[...document.querySelectorAll('.nav-tab')].find((b) => b.textContent.includes('Cards')).click()`);
  await sleep(1500);
  await shot('deck');
  await js(`document.querySelector('.card[data-card="charizard"]').click()`);
  await sleep(1200);
  await shot('card');
  await js(`document.querySelector('.modal-backdrop').click()`);

  // A gym battle (Brock, in Pewter Gym's arena): play a few cards with real taps, then let
  // the fight develop.
  await js(`[...document.querySelectorAll('.nav-tab')].find((b) => b.textContent.includes('Battle')).click()`);
  await waitFor(`document.querySelector('.panel.league .btn.gold') && !document.querySelector('.panel.league .btn.gold').disabled`);
  await js(`document.querySelector('.panel.league .btn.gold').click()`);
  await waitFor(`document.querySelector('#battle .hand .card')`, 30000);
  await sleep(4500); // countdown
  const stage = await js(`(() => { const r = document.querySelector('#battle .stage-host').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })()`);
  const at = (fx, fy) => [stage[0] + stage[2] * fx, stage[1] + stage[3] * fy];
  // Play whatever is affordable every few seconds, alternating lanes, so both sides are fighting.
  const spots = [[0.3, 0.64], [0.7, 0.64], [0.36, 0.7], [0.64, 0.7]];
  for (let i = 0; i < 12; i++) {
    const slot = await js(`[...document.querySelectorAll('#battle .hand .card')].findIndex((c) => !c.classList.contains('unaffordable'))`);
    if (slot >= 0) {
      const [cx, cy] = await centre(`#battle .hand .card:nth-child(${slot + 1})`);
      await tap(cx, cy);
      await tap(...at(...spots[i % spots.length]));
    }
    await sleep(2800);
  }
  await shot('battle');

  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profileDir, { recursive: true, force: true });
}
