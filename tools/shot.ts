/* Screenshots of views, for checking changes by eye.

     node tools/shot.ts OUT_DIR 'name=#x=…&z=…&yaw=…' [more…] [--size=1280x720]

   Starts a Vite dev server, opens the page in headless Firefox with
   ?probe (no overlay, no pointer lock), and for each view sets the
   hash through window.hw.go(), waits a few frames and saves
   OUT_DIR/<name>.png. Console errors are printed. */
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const out = args.shift();
if (!out) { console.error('usage: shot.ts OUT_DIR name=#hash …'); process.exit(2); }
const size = (args.find((a) => a.startsWith('--size=')) ?? '--size=1280x720').slice(7).split('x').map(Number);
const views = args.filter((a) => !a.startsWith('--')).map((a) => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)] as const; });
fs.mkdirSync(out, { recursive: true });

const server = await createServer({ logLevel: 'error', server: { port: 0 } });
await server.listen();
const url = server.resolvedUrls!.local[0]!;
const browser = await puppeteer.launch({
  browser: 'firefox', executablePath: process.env.PROBE_EXE ?? '/usr/bin/firefox', headless: true,
  defaultViewport: { width: size[0]!, height: size[1]! },
  extraPrefsFirefox: { 'webgl.force-enabled': true, 'webgl.disabled': false },
});
const t0 = Date.now();
const log = (m: string) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's ' + m);
try {
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warn') log('console ' + m.type() + ': ' + m.text().slice(0, 400)); });
  page.on('pageerror', (e) => log('pageerror: ' + (e as Error).message));
  await page.goto(url + '?probe' + (views[0]?.[1] ?? ''));
  await page.waitForFunction(() => !!window.hw, { timeout: 180000 });
  log('ready');
  for (const [name, hash] of views) {
    await page.evaluate((h) => window.hw!.go(h), hash);
    await page.evaluate(() => window.hw!.frames(4));
    await page.screenshot({ path: path.join(out, name + '.png') as `${string}.png` });
    log('shot ' + name);
  }
} finally {
  await browser.close();
  await server.close();
}
