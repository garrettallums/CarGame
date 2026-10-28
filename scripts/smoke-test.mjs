// Headless smoke test: builds must already exist in dist/ (npm run build).
// Starts `vite preview`, loads the game in Chromium, drives, crashes, breaks
// props, checks the tuning panel and touch controls, and fails on console errors.
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
  // Let a few frames run.
  await page.waitForTimeout(1500);
  return { context, page };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pos = (page) => page.evaluate(() => ({ ...window.__game.player.interp.pos }));

try {
  // ---------------- Desktop ----------------
  const { page } = await openPage({ viewport: { width: 1280, height: 720 } });
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => (++n < 30 ? requestAnimationFrame(f) : res((n * 1000) / (performance.now() - t0)));
        requestAnimationFrame(f);
      }),
  );
  console.log(`headless FPS ≈ ${fps.toFixed(1)} (software rendering)`);
  await page.screenshot({ path: `${OUT}/01-spawn.png` });

  // Drive forward.
  const p0 = await pos(page);
  await page.keyboard.down('KeyW');
  await sleep(3000);
  const speed = await page.evaluate(() => window.__game.player.controller.speed);
  await page.keyboard.up('KeyW');
  const p1 = await pos(page);
  const moved = Math.hypot(p1.x - p0.x, p1.z - p0.z);
  check('car drives forward with W', moved > 8, `moved ${moved.toFixed(1)} m, speed ${speed.toFixed(1)} m/s`);
  await page.screenshot({ path: `${OUT}/02-driving.png` });

  // Boost drains the meter.
  const b0 = await page.evaluate(() => window.__game.player.controller.boost);
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  await sleep(1000);
  const b1 = await page.evaluate(() => window.__game.player.controller.boost);
  await page.keyboard.up('ShiftLeft');
  check('boost drains meter', b1 < b0 - 0.2, `${b0.toFixed(2)} -> ${b1.toFixed(2)}`);

  // Handbrake + steer makes the car slide.
  await page.keyboard.down('Space');
  await page.keyboard.down('KeyD');
  let maxSlip = 0;
  for (let i = 0; i < 12; i++) {
    await sleep(100);
    maxSlip = Math.max(maxSlip, await page.evaluate(() => window.__game.player.controller.slip));
  }
  await page.screenshot({ path: `${OUT}/03-drift.png` });
  await page.keyboard.up('Space');
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  check('handbrake turn produces slip', maxSlip > 0.3, `max slip ${maxSlip.toFixed(2)}`);
  const tracks = await page.evaluate(() => {
    const g = window.__game;
    return g.fx.dust.activeCount;
  });
  check('dust particles emitted', tracks > 0, `${tracks} active`);

  // Ram the parked sedan repeatedly.
  const ram = await page.evaluate(async () => {
    const g = window.__game;
    const target = g.dummies[0];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const rams = [];
    for (let i = 0; i < 24 && !target.wrecked; i++) {
      g.player.repair();
      const t = target.interp.pos;
      // Approach from alternating sides.
      const ang = (i % 4) * (Math.PI / 2) + 0.3;
      const start = { x: t.x + Math.sin(ang) * 26, y: 0, z: t.z + Math.cos(ang) * 26 };
      start.y = g.gw.terrain.heightAt(start.x, start.z) + 1.5;
      const yaw = Math.atan2(t.x - start.x, t.z - start.z);
      g.player.teleport(start, yaw);
      const dir = { x: Math.sin(yaw), z: Math.cos(yaw) };
      g.player.body.setLinvel({ x: dir.x * 24, y: 0, z: dir.z * 24 }, true);
      const before = g.stats.vehicleHits;
      for (let k = 0; k < 40; k++) {
        g.player.input.throttle = 1;
        g.player.input.steer = 0;
        await wait(50);
        if (g.stats.vehicleHits > before) break;
      }
      rams.push(g.stats.vehicleHits > before);
      await wait(400);
    }
    const dents = (v) => Math.max(...v.visual.parts.filter((p) => p.deform).map((p) => p.deform.maxDisplacement()));
    return {
      rams,
      hits: g.stats.vehicleHits,
      partsLost: g.stats.partsLost,
      wrecked: target.wrecked,
      targetHealth: target.damage.fraction,
      targetDent: dents(target),
      playerDent: dents(g.player),
    };
  });
  check('ramming registers vehicle hits', ram.hits > 0, `${ram.hits} hits over ${ram.rams.length} runs`);
  check('both cars dent', ram.targetDent > 0.02 && ram.playerDent > 0.02, `target ${ram.targetDent.toFixed(3)} m, player ${ram.playerDent.toFixed(3)} m`);
  check('repeated hits knock off parts', ram.partsLost > 0, `${ram.partsLost} parts lost`);
  check('repeated hits wreck the dummy', ram.wrecked, `target health ${(ram.targetHealth * 100).toFixed(0)}%`);
  await page.evaluate(() => {
    const g = window.__game;
    const t = g.dummies[0].interp.pos;
    g.player.repair();
    g.player.teleport({ x: t.x - 10, y: g.gw.terrain.heightAt(t.x - 10, t.z) + 1.5, z: t.z - 6 }, 0.8);
  });
  await sleep(800);
  await page.screenshot({ path: `${OUT}/04-wreck.png` });

  // Drive through a fence and into explosive barrels.
  const props = await page.evaluate(async () => {
    const g = window.__game;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const out = {};
    for (const type of ['fence', 'explosiveBarrel', 'barrel', 'sign']) {
      const d = g.gw.destructibles.items.find((x) => x.type === type && !x.broken);
      if (!d) continue;
      const before = g.stats.propsBroken;
      const t = d.interp.pos;
      g.player.repair();
      // Approach face-on, along the prop's local Z axis.
      const r = d.interp.rot;
      const nx = 2 * (r.x * r.z + r.w * r.y);
      const nz = 1 - 2 * (r.x * r.x + r.y * r.y);
      const start = { x: t.x - nx * 18, y: 0, z: t.z - nz * 18 };
      start.y = g.gw.terrain.heightAt(start.x, start.z) + 1.5;
      const yaw = Math.atan2(t.x - start.x, t.z - start.z);
      g.player.teleport(start, yaw);
      g.player.body.setLinvel({ x: Math.sin(yaw) * 20, y: 0, z: Math.cos(yaw) * 20 }, true);
      for (let k = 0; k < 40 && !d.broken; k++) {
        g.player.input.throttle = 1;
        await wait(50);
      }
      out[type] = { broken: d.broken, newlyBroken: g.stats.propsBroken - before };
      await wait(300);
    }
    out.explosions = g.stats.explosions;
    out.debris = g.debris.activeCount;
    return out;
  });
  check('fence breaks', !!props.fence?.broken);
  check('barrel breaks', !!props.barrel?.broken);
  check('explosive barrel explodes', !!props.explosiveBarrel?.broken && props.explosions > 0, `${props.explosions} explosions`);
  check('sign breaks', !!props.sign?.broken);
  check('debris spawned', props.debris > 0, `${props.debris} active pieces`);
  await page.screenshot({ path: `${OUT}/05-props.png` });

  // Respawn everything.
  const respawn = await page.evaluate(async () => {
    const g = window.__game;
    g.respawnWorld();
    g.resetPlayer();
    await new Promise((r) => setTimeout(r, 300));
    return { broken: g.gw.destructibles.brokenCount, wrecked: g.dummies.filter((d) => d.wrecked).length, playerHealth: g.player.damage.fraction };
  });
  check('respawn restores props, dummies and player', respawn.broken === 0 && respawn.wrecked === 0 && respawn.playerHealth === 1, JSON.stringify(respawn));

  // Tuning panel slider changes the live config.
  await page.keyboard.press('Backquote');
  await sleep(200);
  const tune = await page.evaluate(() => {
    const g = window.__game;
    const row = [...document.querySelectorAll('#tuning .tn-row')].find((r) => r.querySelector('.tn-label')?.textContent === 'maxSpeed');
    const input = row.querySelector('input');
    input.value = '55';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return { open: document.querySelector('#tuning').classList.contains('open'), maxSpeed: g.player.config.maxSpeed, stored: localStorage.getItem('sas.tuning.v1')?.includes('"maxSpeed":55') };
  });
  await page.screenshot({ path: `${OUT}/06-tuning.png` });
  check('tuning panel opens with backtick', tune.open);
  check('slider changes handling value live', tune.maxSpeed === 55, `maxSpeed=${tune.maxSpeed}`);
  check('tuning saved to localStorage', !!tune.stored);
  await page.evaluate(() => window.__game.tuning.resetDefaults());
  await page.keyboard.press('Backquote');
  await sleep(400);

  // Pause menu.
  await page.keyboard.press('Escape');
  await sleep(200);
  const paused = await page.evaluate(() => window.__game.loop.paused && document.querySelector('#pause').classList.contains('open'));
  check('Esc pauses', paused);
  await page.screenshot({ path: `${OUT}/07-pause.png` });
  await page.keyboard.press('Escape');

  // ---------------- Mobile (iPhone 12 landscape) ----------------
  const { context: mctx, page: m } = await openPage({
    viewport: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const touchVisible = await m.evaluate(() => getComputedStyle(document.querySelector('#touch')).display !== 'none');
  check('touch controls shown on phone', touchVisible);
  const cdp = await mctx.newCDPSession(m);
  const tp = (x, y, id = 0) => ({ x, y, id, radiusX: 5, radiusY: 5, force: 1 });
  const mp0 = await pos(m);
  // Finger 0: stick pushed up-right. Finger 1: hold DRIFT after a moment.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(200, 260)] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tp(200 + i * 3, 260 - i * 10)] });
    await sleep(30);
  }
  await sleep(1800);
  const mInput = await m.evaluate(() => ({ ...window.__game.input.state }));
  const hand = await m.evaluate(() => {
    const r = document.querySelector('.t-hand').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tp(218, 200), tp(hand.x, hand.y, 1)] });
  let mHand = false;
  for (let i = 0; i < 10 && !mHand; i++) {
    await sleep(150);
    mHand = await m.evaluate(() => window.__game.input.state.handbrake);
  }
  await m.screenshot({ path: `${OUT}/08-mobile.png` });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const mp1 = await pos(m);
  const mMoved = Math.hypot(mp1.x - mp0.x, mp1.z - mp0.z);
  check('touch stick drives the car', mInput.throttle > 0.5 && mMoved > 3, `throttle ${mInput.throttle.toFixed(2)}, moved ${mMoved.toFixed(1)} m`);
  check('multi-touch: drift button while steering', mHand === true);
  const scrollY = await m.evaluate(() => window.scrollY);
  check('page does not scroll', scrollY === 0);
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
