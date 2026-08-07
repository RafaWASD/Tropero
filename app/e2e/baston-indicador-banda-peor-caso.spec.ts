// e2e/baston-indicador-banda-peor-caso.spec.ts — LA BANDA DEL INDICADOR, CONTRA EL PEOR CASO.
//
// ── EL DEFECTO DE MÉTODO QUE ESTE ARCHIVO CIERRA ────────────────────────────────────────────────────
// El sondeo de `baston-indicador-unico.spec.ts` midió la banda del indicador en la home y la dio LIBRE.
// Estaba bien medido y era **una conclusión falsa**: el usuario del fixture se llama "E2E", y el saludo
// `¡Hola E2E! 👋` termina en x≈215. Con un nombre real —"Maximiliano", "Guadalupe", un compuesto— ese
// mismo texto, que va en `$9` (30 px, bold) y **sin `numberOfLines`**, cruza tranquilamente la banda y
// queda por debajo del indicador. Se midió la INSTANCIA, no el RANGO.
//
// Acá se mide el rango: el saludo se renderiza con (a) un nombre corriente y (b) el TOPE REAL del
// producto (`NAME_MAX_LENGTH = 80`, y `firstNameOf` toma el primer token → un token de 80 es un "primer
// nombre" de 80). El oráculo es geométrico y no depende de que el bastón esté conectado: se comparan los
// RENGLONES REALES del saludo (`Range.getClientRects`) contra la banda que el indicador ocupa, derivada
// de los mismos tokens que usa el componente.
//
// Por qué un archivo aparte y no un caso más del sondeo: este no necesita bastón, ni demo, ni la danza de
// conexión — necesita DOS usuarios con nombres distintos. Y porque el criterio que fija ("¿esto puede
// crecer?") vale para cualquier texto que comparta la banda, no solo para el saludo.

import { test, applyEnvShim, expect } from './helpers/fixtures';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestUser, seedEstablishmentWithRodeo, setUserPhone, cleanupAll } from './helpers/admin';
import { signIn, waitForHome } from './helpers/ui';
import { sizeTokenFromConfig } from '../src/utils/nav-target-bands';
import { NAME_MAX_LENGTH } from '../src/utils/validation';

test.afterAll(async () => {
  await cleanupAll();
});

const APP_ROOT = join(__dirname, '..');
const CONFIG_SRC = readFileSync(join(APP_ROOT, 'tamagui.config.ts'), 'utf8');
/** Tokens de space (los mismos que copia `fab-target-geometry.spec.ts`, cruzados contra los reales por el guard). */
const SPACE = { '2': 7, '3': 13, '4': 18 };

/** La caja que el indicador ocupa @412, derivada igual que en el componente (círculo, la forma permanente). */
const CIRCLE = sizeTokenFromConfig(CONFIG_SRC, 'navIcon') + SPACE['2'] * 2 + 2;
const BAND = {
  left: 412 - SPACE['4'] - CIRCLE,
  right: 412 - SPACE['4'],
  top: SPACE['3'] * 2 + sizeTokenFromConfig(CONFIG_SRC, 'avatar'), // inset superior 0 en web
  bottom: SPACE['3'] * 2 + sizeTokenFromConfig(CONFIG_SRC, 'avatar') + CIRCLE,
};

// El tope sale de `validation.ts` (la MISMA constante que valida el form del perfil), no de un 80 escrito
// acá: si el producto acepta nombres más largos, este test mide el rango nuevo sin que nadie lo toque.

/** Los renglones del saludo de la home que INVADEN la banda del indicador. */
async function greetingLinesInBand(page: Page, band: typeof BAND) {
  return page.evaluate((b) => {
    // Cualquier elemento (no solo `div`: Tamagui envuelve el texto en un `span` adentro del div) cuyo hijo
    // TEXTO directo sea el saludo. Buscar por tag concreto ya falló una vez.
    const nodes = Array.from(document.querySelectorAll('body *'));
    const greeting = nodes.find((n) =>
      Array.from(n.childNodes).some(
        (c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? '').trim().startsWith('¡Hola'),
      ),
    );
    if (!greeting) {
      const diag = nodes
        .filter((n) => (n.textContent ?? '').trim().startsWith('¡Hola'))
        .slice(-3)
        .map((n) => `${n.tagName}#${n.className}`.slice(0, 60));
      return { found: false, diag, lines: [] as Array<{ text: string; right: number; top: number }>, invade: [] as string[] };
    }
    const out: Array<{ text: string; right: number; top: number }> = [];
    const invade: string[] = [];
    for (const child of Array.from(greeting.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      const range = document.createRange();
      range.selectNodeContents(child);
      for (const r of Array.from(range.getClientRects())) {
        out.push({ text: (child.textContent ?? '').slice(0, 24), right: Math.round(r.right), top: Math.round(r.top) });
        const cruza = r.right > b.left && r.left < b.right && r.bottom > b.top && r.top < b.bottom;
        if (cruza) invade.push(`renglón hasta x=${Math.round(r.right)} y=[${Math.round(r.top)},${Math.round(r.bottom)}]`);
      }
      range.detach();
    }
    return { found: true, diag: [] as string[], lines: out, invade };
  }, band);
}

/** Nombre de UN SOLO token del largo pedido (así `firstNameOf` se lo lleva entero al saludo). */
const singleToken = (n: number) => 'M' + 'a'.repeat(n - 1);

for (const [caso, firstName] of [
  ['corriente (14)', 'Maximiliano J'.replace(' ', '')],
  [`tope del producto (${NAME_MAX_LENGTH})`, singleToken(NAME_MAX_LENGTH)],
] as const) {
  test(`el saludo de la home NO invade la banda del indicador — nombre ${caso}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 412, height: 915 } });
    const page = await ctx.newPage();
    await applyEnvShim(page);
    try {
      const user = await createTestUser('bandapeor', `${firstName} Apellido`);
      await setUserPhone(user.id, '1123456789');
      await seedEstablishmentWithRodeo(user.id, 'Campo Peor Caso');
      await page.goto('/');
      await signIn(page, user);
      await waitForHome(page);
      await expect(page.getByText(new RegExp(`¡Hola ${firstName.slice(0, 10)}`))).toBeVisible({ timeout: 30_000 });

      const g = await greetingLinesInBand(page, BAND);
      expect(g.found, `no encontré el saludo de la home (candidatos: ${JSON.stringify(g.diag)})`).toBe(true);
      console.log(`[peor-caso] ${caso}: renglones ${JSON.stringify(g.lines)} · banda ${JSON.stringify(BAND)}`);
      expect(
        g.invade,
        `con un nombre ${caso} el saludo se mete DEBAJO del indicador (banda x=[${BAND.left},${BAND.right}] ` +
          `y=[${BAND.top},${BAND.bottom}]):\n  ${g.invade.join('\n  ')}\n` +
          'El saludo va en `$9` (30 px) y sin `numberOfLines`: crece con el nombre del usuario, que el ' +
          'producto acepta hasta 80 caracteres. La home tiene que RESERVAR la banda (no truncar el nombre: ' +
          'es el saludo de bienvenida) o reclamarla como hacen la vista de grupo, la manga y Reportes.',
      ).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}
