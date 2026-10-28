// Renders the PWA icons with a canvas in headless Chromium: node scripts/gen-icons.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const draw = ({ size, maskable }) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const s = size / 512;
  const grad = g.createLinearGradient(0, 0, 0, size);
  grad.addColorStop(0, '#e7a362');
  grad.addColorStop(1, '#a8532c');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  // Dune bands.
  g.fillStyle = 'rgba(80,35,15,0.18)';
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.ellipse(size * (0.2 + i * 0.25), size * (0.75 + (i % 2) * 0.1), size * 0.35, size * 0.08, -0.3, 0, Math.PI * 2);
    g.fill();
  }
  const pad = maskable ? 0.18 : 0.08;
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate(-0.5);
  const k = s * (1 - pad * 2) * 1.05;
  // Tire tracks.
  g.fillStyle = 'rgba(60,25,10,0.35)';
  g.fillRect(-70 * k, 70 * k, 30 * k, 260 * k);
  g.fillRect(40 * k, 70 * k, 30 * k, 260 * k);
  // Car from above.
  g.fillStyle = '#1f1b18';
  for (const [x, y] of [[-78, -95], [48, -95], [-78, 45], [48, 45]]) g.fillRect(x * k, y * k, 30 * k, 60 * k);
  g.fillStyle = '#a8402a';
  g.beginPath();
  g.roundRect(-62 * k, -130 * k, 124 * k, 250 * k, 18 * k);
  g.fill();
  g.fillStyle = '#7d2e1e';
  g.fillRect(-48 * k, -20 * k, 96 * k, 90 * k);
  g.strokeStyle = '#2b2420';
  g.lineWidth = 9 * k;
  g.strokeRect(-48 * k, -20 * k, 96 * k, 90 * k);
  g.beginPath();
  g.moveTo(-48 * k, 25 * k);
  g.lineTo(48 * k, 25 * k);
  g.stroke();
  g.fillStyle = '#8c8378';
  g.fillRect(-70 * k, -150 * k, 140 * k, 16 * k);
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.moveTo(i * 28 * k - 8 * k, -150 * k);
    g.lineTo(i * 28 * k, -180 * k);
    g.lineTo(i * 28 * k + 8 * k, -150 * k);
    g.fill();
  }
  g.restore();
  return c.toDataURL('image/png');
};

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, maskable] of [
  ['public/icon-192.png', 192, false],
  ['public/icon-512.png', 512, false],
  ['public/icon-512-maskable.png', 512, true],
  ['public/apple-touch-icon.png', 180, false],
]) {
  const url = await page.evaluate(draw, { size, maskable });
  writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote', file);
}
await browser.close();
