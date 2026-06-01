// playwright.config.ts — suite E2E del build WEB de RAFAQ contra el Supabase REMOTO.
//
// Estrategia (ver e2e/README.md):
//   - Servimos el build ESTÁTICO de Expo (app/dist, generado con `expo export -p web`) en el
//     puerto 8099 con `serve -s` (SPA fallback: cualquier ruta → index.html, porque la app
//     usa routing client-side de Expo Router). NO usamos el dev server de Metro (pesado +
//     colisiona con el 8081 de Raf).
//   - El build se hace ANTES de correr Playwright (script `pnpm e2e` → `e2e:build` + test). El
//     webServer de acá SOLO sirve el dist ya generado; si no existe, falla con un mensaje claro.
//   - Un solo project: chromium headless. Soporta múltiples browser contexts (para el loop de
//     2 cuentas de invitations.spec.ts a futuro) vía browser.newContext() dentro del test.
//
// baseURL = http://localhost:8099. Los specs navegan a '/' y el AuthGate re-rutea.

import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

// Playwright transpila este config a CJS, así que `__dirname` está disponible nativamente
// (NO usar import.meta.url: rompe con "exports is not defined in ES module scope").
const CONFIG_DIR = __dirname;
const DIST_DIR = path.join(CONFIG_DIR, 'dist');
const PORT = 8099;
const BASE_URL = `http://localhost:${PORT}`;

if (!existsSync(path.join(DIST_DIR, 'index.html'))) {
  // No tiramos acá (defineConfig se evalúa también al listar): avisamos. El webServer
  // fallará al no encontrar el dist, con timeout. El script `pnpm e2e` corre el build antes.
  console.warn(
    `[playwright.config] No se encontró ${path.join(DIST_DIR, 'index.html')}. ` +
      `Corré el build primero: \`pnpm e2e:build\` (o usá \`pnpm e2e\`, que lo hace por vos).`,
  );
}

export default defineConfig({
  testDir: './e2e',
  // Cada spec maneja sus propios fixtures (usuarios) y limpia; corremos en serie para no
  // multiplicar la presión sobre la DB remota compartida con el testing manual de Raf.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  // Barrido final de fixtures (usuarios/campos namespaced) por si algún test no limpió.
  globalTeardown: './e2e/global-teardown.ts',

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Viewport tipo teléfono: la app es mobile-first; así el layout web se parece al device.
    viewport: { width: 412, height: 915 },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 412, height: 915 } },
    },
  ],

  webServer: {
    // `serve -s` = single-page: sirve index.html para rutas desconocidas (Expo Router web).
    command: `serve dist -s -l ${PORT} --no-port-switching`,
    url: BASE_URL,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    cwd: CONFIG_DIR,
  },
});
