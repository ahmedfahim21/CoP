// Renders the favicon/app icons and the Open Graph card from the sources in this folder with
// headless Chrome (cropped with macOS sips), into apps/client/public.
// Run: pnpm brand  (CHROME=/path/to/chrome to override)
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../../apps/client/public');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!existsSync(chrome)) throw new Error(`Chrome not found at ${chrome}; set CHROME to its binary`);

function shoot(page, file, width, height, query = '') {
  const target = join(out, file);
  const shot = join(here, '.shot.png');
  // Render in a roomy window, then centre-crop: Chrome's window has a minimum width.
  execFileSync(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--default-background-color=00000000', '--virtual-time-budget=8000',
    `--window-size=${Math.max(width, 600)},${Math.max(height, 600)}`, `--screenshot=${shot}`,
    `${pathToFileURL(join(here, page)).href}${query}`,
  ], { stdio: 'pipe' });
  execFileSync('sips', ['--cropToHeightWidth', String(height), String(width), shot, '--out', target], { stdio: 'pipe' });
  rmSync(shot);
  const size = statSync(target).size;
  if (size < 200) throw new Error(`${file} came out empty (${size} bytes)`);
  console.log(`${file.padEnd(22)} ${width}x${height}  ${(size / 1024).toFixed(1)} KB`);
}

copyFileSync(join(here, 'icon.svg'), join(out, 'favicon.svg'));
console.log('favicon.svg            vector');
shoot('icons.html', 'favicon-32.png', 32, 32, '?size=32&bare&pad=0.02');
shoot('icons.html', 'apple-touch-icon.png', 180, 180, '?size=180&pad=0.14');
shoot('icons.html', 'icon-192.png', 192, 192, '?size=192&pad=0.14');
// Maskable: launchers crop to a circle or squircle, so keep the mark inside the 80% safe zone.
shoot('icons.html', 'icon-512.png', 512, 512, '?size=512&pad=0.2');
shoot('og.html', 'og.png', 1200, 630);
