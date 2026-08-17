// e2e/helpers/fixtures.ts — `test` extendido de miTropero con el shim de env del bundle web.
//
// ⚠️ POR QUÉ ESTE SHIM (hallazgo de la corrida):
//   El cliente Supabase lee la URL/anon key con `src/utils/env.ts → readPublicEnv(name)`, que
//   accede a `process.env[name]` de forma DINÁMICA (key computada). `babel-preset-expo` solo
//   inlinea accesos ESTÁTICOS `process.env.EXPO_PUBLIC_FOO`; el acceso dinámico NO se inlinea,
//   así que en el BUILD WEB de producción (`expo export -p web`) queda `process.env[name] →
//   undefined` y getEnv() tira "Faltan variables EXPO_PUBLIC_*" → pantalla en blanco. (En el
//   dev server `pnpm web` funciona porque ahí `process.env` está poblado en runtime.)
//
//   Para el harness E2E inyectamos los valores en `globalThis.process.env` ANTES de que corra
//   el bundle (addInitScript), leyéndolos de los .env.local vía getE2EEnv() (Node side). Esto
//   NO toca código de la app y es un shim legítimo de test. Si la app arregla el patrón (ej.
//   leer `extra.EXPO_PUBLIC_*` o accesos estáticos), este shim se vuelve inocuo.
//
// El `test` exportado acá aplica el shim a CADA page automáticamente. Usalo en lugar del
// `test` de @playwright/test en los specs.

import { test as base, expect } from '@playwright/test';
import { getE2EEnv } from './env';

const { supabaseUrl, anonKey, powersyncUrl } = getE2EEnv();

export const test = base.extend({
  // Sobrescribe la fixture `page` para inyectar el shim antes de cualquier navegación.
  page: async ({ page }, use) => {
    await page.addInitScript(
      ([url, key, psUrl]) => {
        const g = globalThis as unknown as {
          process?: { env?: Record<string, string> };
          __MITROPERO_E2E__?: boolean;
        };
        g.process = g.process || {};
        g.process.env = g.process.env || {};
        g.process.env.EXPO_PUBLIC_SUPABASE_URL = url;
        g.process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;
        g.process.env.EXPO_PUBLIC_POWERSYNC_URL = psUrl;
        // spec 16 (R3.5/R3.6): marcar el ambiente E2E para el bundle (getAppEnv/isE2E), mismo patrón
        // que window.__MITROPERO_BLE_E2E__. Se inyecta acá → los ~70 specs no se tocan (heredan el shim
        // vía el `test` exportado).
        g.process.env.EXPO_PUBLIC_ENV = 'e2e';
        g.__MITROPERO_E2E__ = true;
      },
      [supabaseUrl, anonKey, powersyncUrl],
    );
    await use(page);
  },
});

export { expect };

/**
 * Para tests que crean sus propios browser contexts (ej. el loop de 2 cuentas de
 * invitations.spec.ts): aplica el mismo shim a una page recién creada. Llamar antes del goto.
 */
export async function applyEnvShim(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(
    ([url, key, psUrl]) => {
      const g = globalThis as unknown as {
        process?: { env?: Record<string, string> };
        __MITROPERO_E2E__?: boolean;
      };
      g.process = g.process || {};
      g.process.env = g.process.env || {};
      g.process.env.EXPO_PUBLIC_SUPABASE_URL = url;
      g.process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;
      g.process.env.EXPO_PUBLIC_POWERSYNC_URL = psUrl;
      // spec 16 (R3.5/R3.6): mismo shim de ambiente E2E que la fixture `page`.
      g.process.env.EXPO_PUBLIC_ENV = 'e2e';
      g.__MITROPERO_E2E__ = true;
    },
    [supabaseUrl, anonKey, powersyncUrl],
  );
}
