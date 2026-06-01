// playwright.report.config.ts — variante de la suite E2E para INSPECCIONAR qué/cómo testeó.
//
// Extiende la config normal (playwright.config.ts) pero activa:
//   - reporter HTML (playwright-report/) → abrir con `pnpm exec playwright show-report`
//   - trace 'on' (test-results/.../trace.zip) → recorrer cada test click por click en el
//     trace viewer (capturas de cada paso + red + consola)
//   - video 'on' + screenshot 'on' → un replay de cada test
//
// La config NORMAL (playwright.config.ts, usada por `pnpm e2e`/`e2e:test`) queda liviana
// (reporter 'list', trace/screenshot solo en fallo) para no inflar las corridas de CI/regresión.
//
// Correr: `pnpm e2e:report` (build web + corre con esta config). Los artefactos van a
// playwright-report/ y test-results/ (ambos gitignored — son de corrida, no se commitean).

import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  reporter: [['html', { open: 'never' }], ['list']],
  use: {
    ...base.use,
    trace: 'on',
    video: 'on',
    screenshot: 'on',
  },
});
