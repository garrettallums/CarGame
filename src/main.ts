import './style.css';
import { initPhysics } from './core/Physics';
import { Game } from './core/Game';

declare global {
  interface Window {
    __game?: Game;
  }
}

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const loading = document.getElementById('loading');
  try {
    const R = await initPhysics();
    const game = new Game(R, app);
    window.__game = game;
    game.start();
    loading?.remove();
  } catch (err) {
    console.error(err);
    if (loading) loading.textContent = `Failed to start: ${(err as Error).message}`;
  }
}

// Block page scroll, pinch-zoom and double-tap zoom on iOS.
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(ev, (e) => e.preventDefault());
}
document.addEventListener(
  'touchmove',
  (e) => {
    if (!(e.target as HTMLElement).closest?.('#tuning')) e.preventDefault();
  },
  { passive: false },
);
document.addEventListener('dblclick', (e) => e.preventDefault());

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

void boot();
