// Headless smoke test: builds must already exist in dist/ (npm run build).
// Starts `vite preview`, loads the game in Chromium and plays through the loop:
// garage upgrade → deploy → drive, wreck cars, break props → extract (Parts banked)
// → garage → deploy → get wrecked (Parts lost). Also checks tuning, pause and touch.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PORT = 4179;
const URL = `http://localhost:${PORT}/`;
const OUT = process.env.SHOT_DIR || 'test-results';
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', String(PORT), '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('preview server did not start')), 20000);
  server.stdout.on('data', (d) => {
    if (String(d).includes(String(PORT))) {
      clearTimeout(t);
      resolve();
    }
  });
});

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const errors = [];

async function openPage(contextOpts) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  return { context, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pos = (page) => page.evaluate(() => ({ ...window.__game.player.interp.pos }));
const g = (page, fn, arg) => page.evaluate(fn, arg);

/** Deploy from the garage and wait for the countdown to finish. */
async function deploy(page, extractUnlock) {
  await g(page, (u) => (window.__game.rules.extractUnlock = u), extractUnlock);
  await page.click('.g-go');
  await page.waitForFunction(() => window.__game.round.state === 'active', null, { timeout: 30000 });
}

try {
  // ---------------- Desktop ----------------
  const { page } = await openPage({ viewport: { width: 1280, height: 720 } });
  const start = await g(page, () => ({
    mode: window.__game.mode,
    garage: !document.querySelector('#garage').hidden,
    touch: getComputedStyle(document.querySelector('#touch')).display,
  }));
  check('starts in the garage', start.mode === 'garage' && start.garage, JSON.stringify(start));
  await page.screenshot({ path: `${OUT}/01-garage.png` });

  // Buy an upgrade.
  await g(page, () => {
    const gm = window.__game;
    gm.progress.reset();
    gm.progress.data.parts = 300;
    gm.progress.save();
    gm.garage.render();
  });
  const power0 = await g(page, () => window.__game.player.config.enginePower);
  await page.click('.g-buy[data-id=engine]');
  const bought = await g(page, () => ({
    parts: window.__game.progress.data.parts,
    level: window.__game.progress.level('engine'),
    power: window.__game.player.config.enginePower,
  }));
  check('buying an upgrade spends Parts and improves the car', bought.parts === 240 && bought.level === 1 && bought.power > power0, JSON.stringify(bought));

  // Deploy.
  await deploy(page, 10);
  check('deploy starts a run', (await g(page, () => window.__game.mode)) === 'run');
  await page.screenshot({ path: `${OUT}/02-run.png` });

  // Drive forward.
  // Software rendering can run slower than real time, so wait on distance, not seconds.
  const p0 = await pos(page);
  await page.keyboard.down('KeyW');
  let moved = 0;
  for (let i = 0; i < 40 && moved <= 10; i++) {
    await sleep(250);
    const p = await pos(page);
    moved = Math.hypot(p.x - p0.x, p.z - p0.z);
  }
  const speed = await g(page, () => window.__game.player.controller.speed);
  await page.keyboard.up('KeyW');
  check('car drives forward with W', moved > 8, `moved ${moved.toFixed(1)} m, speed ${speed.toFixed(1)} m/s`);

  // Boost drains the meter.
  const b0 = await g(page, () => window.__game.player.controller.boost);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await sleep(1000);
  const b1 = await g(page, () => window.__game.player.controller.boost);
  await page.keyboard.up('ShiftLeft');
  check('boost drains meter', b1 < b0 - 0.2, `${b0.toFixed(2)} -> ${b1.toFixed(2)}`);

  // Handbrake + steer makes the car slide.
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyD');
  let maxSlip = 0;
  for (let i = 0; i < 12; i++) {
    await sleep(100);
    maxSlip = Math.max(maxSlip, await g(page, () => window.__game.player.controller.slip));
  }
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  check('handbrake turn produces slip', maxSlip > 0.3, `max slip ${maxSlip.toFixed(2)}`);
  check('dust particles emitted', (await g(page, () => window.__game.fx.dust.activeCount)) > 0);

  // Ram a light car until it is wrecked. The player car is made invulnerable while the
  // test stages crashes, so the run is still alive for the extraction check.
  const ram = await g(page, async () => {
    const gm = window.__game;
    gm.player.config.damageMultiplier = 0;
    const target = gm.dummies.find((d) => d.def.id !== 'hauler' && d.drivers === undefined && !gm.drivers.some((dr) => dr.vehicle === d)) ?? gm.dummies[0];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let hits = 0;
    for (let i = 0; i < 24 && !target.wrecked; i++) {
      gm.player.damage.repair();
      const t = target.interp.pos;
      const ang = (i % 4) * (Math.PI / 2) + 0.3;
      const s = { x: t.x + Math.sin(ang) * 26, y: 0, z: t.z + Math.cos(ang) * 26 };
      s.y = gm.gw.terrain.heightAt(s.x, s.z) + 1.5;
      const yaw = Math.atan2(t.x - s.x, t.z - s.z);
      gm.player.teleport(s, yaw);
      gm.player.body.setLinvel({ x: Math.sin(yaw) * 24, y: 0, z: Math.cos(yaw) * 24 }, true);
      const before = gm.stats.vehicleHits;
      for (let k = 0; k < 120 && gm.stats.vehicleHits === before; k++) await wait(50);
      if (gm.stats.vehicleHits > before) hits++;
      await wait(400);
    }
    const dents = (v) => Math.max(...v.visual.parts.filter((p) => p.deform).map((p) => p.deform.maxDisplacement()));
    return { hits, wrecked: target.wrecked, partsLost: gm.stats.partsLost, dent: dents(target), runParts: gm.round.parts, kills: gm.round.kills };
  });
  check('ramming dents the target', ram.dent > 0.02, `${ram.hits} hits, dent ${ram.dent.toFixed(3)} m`);
  check('repeated hits knock off parts', ram.partsLost > 0, `${ram.partsLost} parts lost`);
  check('repeated hits wreck the car', ram.wrecked);
  check('wrecking a car awards Parts for the run', ram.runParts > 0 && ram.kills > 0, `${ram.runParts} Parts at risk`);
  await page.screenshot({ path: `${OUT}/03-wreck.png` });

  // Props.
  const props = await g(page, async () => {
    const gm = window.__game;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    // Try a few of each type in case something sits in the approach path.
    const tries = ['fence', 'explosiveBarrel', 'barrel', 'sign'].flatMap((type) => [type, type, type, type]);
    let attempt = 0;
    for (const type of tries) {
      attempt++;
      if (out[type]) continue;
      // Pick an intact one now: earlier explosions may have broken the first few.
      const d = gm.gw.destructibles.items.find((x) => x.type === type && !x.broken);
      if (!d) continue;
      gm.player.damage.repair();
      const t = d.interp.pos;
      const r = d.interp.rot;
      // Face-on first; later attempts come in from other sides in case a wall is in the way.
      const a0 = Math.atan2(2 * (r.x * r.z + r.w * r.y), 1 - 2 * (r.x * r.x + r.y * r.y)) + (attempt % 4) * (Math.PI / 2);
      const s = { x: t.x - Math.sin(a0) * 18, y: 0, z: t.z - Math.cos(a0) * 18 };
      s.y = gm.gw.terrain.heightAt(s.x, s.z) + 1.5;
      const yaw = Math.atan2(t.x - s.x, t.z - s.z);
      gm.player.teleport(s, yaw);
      gm.player.body.setLinvel({ x: Math.sin(yaw) * 20, y: 0, z: Math.cos(yaw) * 20 }, true);
      for (let k = 0; k < 120 && !d.broken; k++) await wait(50);
      out[type] = d.broken;
      await wait(300);
    }
    out.explosions = gm.stats.explosions;
    out.debris = gm.debris.activeCount;
    return out;
  });
  check('fence breaks', !!props.fence);
  check('barrel breaks', !!props.barrel);
  check('explosive barrel explodes', !!props.explosiveBarrel && props.explosions > 0, `${props.explosions} explosions`);
  check('sign breaks', !!props.sign);
  check('debris spawned', props.debris > 0, `${props.debris} active pieces`);

  // Tuning panel slider edits the base config; upgrades stack on top.
  await page.keyboard.press('Backquote');
  await sleep(300);
  const tune = await g(page, () => {
    const gm = window.__game;
    const row = [...document.querySelectorAll('#tuning .tn-row')].find((r) => r.querySelector('.tn-label')?.textContent === 'maxSpeed');
    const input = row.querySelector('input');
    input.value = '55';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { open: document.querySelector('#tuning').classList.contains('open'), maxSpeed: gm.player.config.maxSpeed, base: gm.baseConfig.maxSpeed };
  });
  check('tuning panel opens with backtick', tune.open);
  check('slider changes handling live (upgrades stack on top)', tune.base === 55 && tune.maxSpeed === 57.5, `base ${tune.base}, effective ${tune.maxSpeed}`);
  await g(page, () => window.__game.tuning.resetDefaults());
  await g(page, () => (window.__game.player.config.damageMultiplier = 0));
  await page.keyboard.press('Backquote');
  await page.waitForFunction(() => !document.querySelector('#tuning').classList.contains('open') && !window.__game.loop.paused);

  // Pause menu.
  await page.keyboard.press('Escape');
  const paused = await page
    .waitForFunction(() => window.__game.loop.paused && document.querySelector('#pause').classList.contains('open'), null, { timeout: 8000 })
    .then(() => true, () => false);
  check('Esc pauses', paused);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.__game.loop.paused, null, { timeout: 8000 });

  // Extraction.
  await page.waitForFunction(() => window.__game.round.extractOpen, null, { timeout: 60000 });
  await sleep(500);
  await page.screenshot({ path: `${OUT}/04-extract-open.png` });
  const before = await g(page, () => ({ bank: window.__game.progress.data.parts, haul: window.__game.round.parts }));
  await g(page, () => {
    const gm = window.__game;
    const e = gm.round.extractPos;
    gm.player.damage.repair();
    gm.player.teleport({ x: e.x, y: gm.gw.terrain.heightAt(e.x, e.z) + 1.5, z: e.z }, 0);
  });
  await page.waitForFunction(() => window.__game.mode === 'results', null, { timeout: 60000 });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/05-results.png` });
  const after = await g(page, () => ({
    bank: window.__game.progress.data.parts,
    title: document.querySelector('#results h1')?.textContent,
    extractions: window.__game.progress.data.extractions,
  }));
  check('extraction banks the run’s Parts', after.title === 'Extracted' && after.bank === before.bank + before.haul && before.haul > 0, `${before.bank} + ${before.haul} = ${after.bank}`);

  // Back to the garage resets the map.
  await page.click('.rs-go');
  await sleep(500);
  const garage2 = await g(page, () => ({
    mode: window.__game.mode,
    broken: window.__game.gw.destructibles.brokenCount,
    wrecked: window.__game.dummies.filter((d) => d.wrecked).length,
    health: window.__game.player.damage.fraction,
  }));
  check('returning to the garage resets map and car', garage2.mode === 'garage' && garage2.broken === 0 && garage2.wrecked === 0 && garage2.health === 1, JSON.stringify(garage2));

  // A run that ends in a wreck loses its Parts.
  await deploy(page, 999);
  const bankBefore = await g(page, () => window.__game.progress.data.parts);
  const lost = await g(page, async () => {
    const gm = window.__game;
    gm.dummies.find((d) => d.def.id !== 'hauler').applyDamage('front', 9999);
    await new Promise((r) => setTimeout(r, 300));
    const atRisk = gm.round.parts;
    gm.player.applyDamage('front', 9999);
    return atRisk;
  });
  await page.waitForFunction(() => window.__game.mode === 'results', null, { timeout: 60000 });
  await sleep(300);
  await page.screenshot({ path: `${OUT}/06-wrecked.png` });
  const lostAfter = await g(page, () => ({ bank: window.__game.progress.data.parts, title: document.querySelector('#results h1')?.textContent }));
  check('getting wrecked loses the run’s Parts', lostAfter.title === 'Wrecked' && lostAfter.bank === bankBefore && lost > 0, `${lost} at risk, bank ${bankBefore} -> ${lostAfter.bank}`);
  await page.click('.rs-go');

  // ---------------- Mobile (iPhone 12 landscape) ----------------
  const { context: mctx, page: m } = await openPage({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const touchInGarage = await g(m, () => getComputedStyle(document.querySelector('#touch')).display);
  check('touch controls hidden in the garage', touchInGarage === 'none');
  await m.screenshot({ path: `${OUT}/07-garage-phone.png` });
  await m.tap('.g-go');
  await m.waitForFunction(() => window.__game.round.state === 'active', null, { timeout: 30000 });
  check('touch controls shown during a run', await g(m, () => getComputedStyle(document.querySelector('#touch')).display !== 'none'));
  const cdp = await mctx.newCDPSession(m);
  const tp = (x, y, id = 0) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 1 });
  const mp0 = await pos(m);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(200, 260)] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(200 + i * 3, 260 - i * 10)] });
    await sleep(30);
  }
  for (let i = 0; i < 30; i++) {
    await sleep(200);
    const p = await pos(m);
    if (Math.hypot(p.x - mp0.x, p.z - mp0.z) > 6) break;
  }
  const mInput = await g(m, () => ({ ...window.__game.input.state }));
  const hand = await g(m, () => {
    const r = document.querySelector('.t-hand').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(218, 200), tp(hand.x, hand.y, 1)] });
  let mHand = false;
  for (let i = 0; i < 10 && !mHand; i++) {
    await sleep(150);
    mHand = await g(m, () => window.__game.input.state.handbrake);
  }
  await m.screenshot({ path: `${OUT}/08-run-phone.png` });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const mp1 = await pos(m);
  const mMoved = Math.hypot(mp1.x - mp0.x, mp1.z - mp0.z);
  check('touch stick drives the car', mInput.throttle > 0.5 && mMoved > 3, `throttle ${mInput.throttle.toFixed(2)}, moved ${mMoved.toFixed(1)} m`);
  check('multi-touch: drift button while steering', mHand === true);
  check('page does not scroll', (await g(m, () => window.scrollY)) === 0);
} catch (e) {
  check('test run completed', false, String(e?.stack || e));
} finally {
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
