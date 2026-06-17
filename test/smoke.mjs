import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;

const URL = 'http://localhost:8123/index.html';
const errors = [];
const logs = [];

const browser = await chromium.launch({
  args: ['--enable-unsafe-swrast', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--ignore-certificate-errors'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });

page.on('console', (m) => {
  const t = `${m.type()}: ${m.text()}`;
  logs.push(t);
  if (m.type() === 'error') errors.push(t);
});
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)));

await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
await page.waitForTimeout(1500);

// enter the world
await page.click('#playBtn').catch(() => {});
await page.waitForTimeout(4000);

const probe1 = await page.evaluate(() => {
  const dc = window.DigitalCasinos || {};
  return {
    hasGame: !!window.DigitalCasinos,
    coins: dc.Economy ? dc.Economy.coins : null,
    floorCount: dc.casino ? dc.casino.floorCount : null,
    started: document.getElementById('startScreen')?.classList.contains('hidden'),
    canvas: !!document.querySelector('canvas'),
  };
});
await page.screenshot({ path: '/tmp/shot_floor0.png' });
console.log('PROBE1', JSON.stringify(probe1));
console.log('EARLY_ERRORS', errors.length);
for (const e of errors.slice(0, 25)) console.log(e);
if (!probe1.hasGame) { console.log('GAME FAILED TO LOAD — stopping'); await browser.close(); process.exit(0); }

// walk forward a bit
await page.mouse.click(640, 400).catch(() => {});
for (const k of ['KeyW', 'KeyW', 'KeyW']) {
  await page.keyboard.down(k); await page.waitForTimeout(350); await page.keyboard.up(k);
}
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/shot_walk.png' });

// open the world map (M) then close
await page.keyboard.press('KeyM'); await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/shot_map.png' });
await page.keyboard.press('Escape'); await page.waitForTimeout(300);

// teleport onto a buildable tile on floor 0, buy it, open build, place a slot machine
const probe2 = await page.evaluate(async () => {
  const dc = window.DigitalCasinos;
  if (!dc) return { ok: false, why: 'no game' };
  // find a buildable tile center on floor 0 via config-ish: use casino + economy
  // move player body there by setting bodyPos through player internals
  const p = dc.player;
  // pick tile (3,3)-ish area in left hall
  const cfgMod = await import('./js/config.js');
  let found = null;
  for (let ti = 0; ti < cfgMod.FLOOR.TX && !found; ti++)
    for (let tj = 0; tj < cfgMod.FLOOR.TZ && !found; tj++)
      if (cfgMod.isBuildableTile(0, ti, tj)) found = cfgMod.tileCenter(ti, tj);
  if (found) { p.bodyPos.set(found.x, 1.65, found.z); }
  const key = (() => { const t = cfgMod.tileFromWorld(found.x, found.z); return cfgMod.parcelKey(0, t.ti, t.tj); })();
  const before = dc.Economy.coins;
  const buy = dc.Economy.buyParcel(key, dc.Economy.parcelPrice(0));
  return { ok: true, found, key, before, after: dc.Economy.coins, buy };
});
await page.waitForTimeout(200);

// now press B (owned -> opens build palette), pick first item by clicking, F to place
await page.keyboard.press('KeyB'); await page.waitForTimeout(500);
const paletteItems = await page.$$eval('#palette .palette-item', els => els.length).catch(() => 0);
await page.screenshot({ path: '/tmp/shot_build.png' });
// click first palette item
await page.click('#palette .palette-item').catch(() => {});
await page.waitForTimeout(300);
await page.keyboard.press('KeyF'); await page.waitForTimeout(500);
const probe3 = await page.evaluate(() => {
  const dc = window.DigitalCasinos;
  const ks = Object.keys(dc.Economy.state.parcels);
  const games = ks.reduce((a, k) => a + (dc.Economy.getGames(k).length), 0);
  return { parcels: ks.length, games, coins: dc.Economy.coins };
});
await page.screenshot({ path: '/tmp/shot_placed.png' });

// switch to floor 1 (pool)
await page.evaluate(() => window.DigitalCasinos.switchFloor(1));
await page.waitForTimeout(1500);
await page.screenshot({ path: '/tmp/shot_floor1.png' });

console.log('PROBE1', JSON.stringify(probe1));
console.log('PROBE2', JSON.stringify(probe2));
console.log('PROBE3', JSON.stringify(probe3));
console.log('PALETTE_ITEMS', paletteItems);
console.log('ERRORS_COUNT', errors.length);
console.log('--- ERRORS ---');
for (const e of errors.slice(0, 25)) console.log(e);
console.log('--- WARN/LOG sample ---');
for (const l of logs.filter(l => /warn|error/i.test(l)).slice(0, 15)) console.log(l);

await browser.close();
process.exit(0);
