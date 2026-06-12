// playwright.capture.config.ts — config para GENERAR screenshots del design-review (spec 10 UI-A).
//
// Extiende la config normal (playwright.config.ts: webServer en :8099 sirviendo app/dist, viewport
// mobile 412×915) pero amplía el testMatch para recoger los `*.capture.ts` de e2e/captures/ — que la
// config de regresión IGNORA (solo matchea `*.spec.ts`). Así las capturas NO corren en `pnpm e2e` y
// se disparan a mano:
//
//   pnpm exec playwright test e2e/captures/spec10-screenshots.capture.ts --config playwright.capture.config.ts
//
// El viewport (412 de ancho, dispositivo mobile) lo hereda de la base → las capturas salen al ancho
// real del teléfono, no al window-size del chrome.

import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  testMatch: /captures[\\/].*\.capture\.ts$/,
});
