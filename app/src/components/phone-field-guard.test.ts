// GUARD de paridad del input de teléfono (spec 01, delta TELÉFONO / RTEL.3.9).
//
// El problema que resuelve: "ninguna pantalla debe armar un input de teléfono a mano" es prosa que no
// hace cumplir nadie. En seis meses una tercera pantalla con `keyboardType="phone-pad"` reintroduce el
// bug EXACTO que este delta cierra —dos inputs del mismo dato que divergen— con la diferencia de que
// para entonces ya nadie recuerda por qué existe `PhoneField`. La firma es greppable, así que el guard
// es barato y determinista.
//
// Vive como test (y no como script nuevo) porque `scripts/check.mjs` ya corre la suite unitaria: cero
// plumbing, y queda al lado de lo que protege. ⚠️ Debe estar registrado en la lista EXPLÍCITA de
// `scripts/run-tests.mjs` — un guard que no corre es peor que ninguno (da falsa confianza).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const APP_ROOT = resolve(HERE, '..', '..'); // app/
const ROOTS = [join(APP_ROOT, 'app'), join(APP_ROOT, 'src', 'components')];

/** El único archivo autorizado a declarar la firma de un input de teléfono. */
const OWNER = 'PhoneField.tsx';

/** Firma de un input de teléfono construido a mano (cualquiera de las tres alcanza). */
const SIGNATURES: { name: string; re: RegExp }[] = [
  { name: 'keyboardType="phone-pad"', re: /keyboardType\s*[:=]\s*\{?\s*['"`]phone-pad['"`]/ },
  { name: 'autoComplete="tel"', re: /autoComplete\s*[:=]\s*\{?\s*['"`]tel['"`]/ },
  { name: 'textContentType="telephoneNumber"', re: /textContentType\s*[:=]\s*\{?\s*['"`]telephoneNumber['"`]/ },
];

/** Válvula de escape por línea, con justificación (mismo patrón que check-hardcode.mjs, RTEL.3.10). */
const DISABLE_NEXT_LINE = /phone-field-disable-next-line\s*--\s*\S/;
const DISABLE_LINE = /phone-field-disable-line\s*--\s*\S/;

function listFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const name of entries) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      found.push(...listFiles(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      // Los .test.* quedan fuera: no son pantallas, y este mismo archivo contiene la firma en sus
      // regexes (se auto-reportaría).
      found.push(p);
    }
  }
  return found;
}

/**
 * Blanquea comentarios de línea y de bloque preservando los saltos de línea (los números de línea no
 * se corren) para que una MENCIÓN en un comentario no dispare un falso positivo. Versión simple: no
 * intenta respetar strings, porque las firmas que buscamos son literales de prop, no contenido de
 * strings arbitrarios.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}

test('RTEL.3.9: ninguna pantalla ni componente arma un input de teléfono a mano', () => {
  const violations: string[] = [];

  for (const root of ROOTS) {
    for (const file of listFiles(root)) {
      if (file.endsWith(sep + OWNER)) continue;
      const raw = readFileSync(file, 'utf8');
      const rawLines = raw.split(/\r?\n/);
      const lines = stripComments(raw).split(/\r?\n/);
      const rel = relative(APP_ROOT, file).split(sep).join('/');

      lines.forEach((line, i) => {
        for (const signature of SIGNATURES) {
          if (!signature.re.test(line)) continue;
          const here = rawLines[i] ?? '';
          const previous = rawLines[i - 1] ?? '';
          if (DISABLE_LINE.test(here) || DISABLE_NEXT_LINE.test(previous)) continue;
          violations.push(`${rel}:${i + 1}  ${signature.name}`);
        }
      });
    }
  }

  assert.deepEqual(
    violations,
    [],
    'Se encontró un input de teléfono construido a mano. Usá <PhoneField> (app/src/components/' +
      'PhoneField.tsx): es el único lugar donde viven el teclado, la máscara, el tope de dígitos y la ' +
      'normalización. Dos copias del mismo input divergen apenas se toca una — ese ES el bug que el ' +
      'delta TELÉFONO cerró. Si el caso es legítimo, justificalo con ' +
      '`// phone-field-disable-next-line -- <razón>`.\n' +
      violations.join('\n'),
  );
});

test('RTEL.14.7: el guard DETECTA la firma (no pasa verde por no estar mirando nada)', () => {
  // Un guard que no puede fallar es un guard muerto. Verificamos las tres firmas + la válvula de
  // escape sobre contenido sintético, sin tocar el árbol real.
  const sample = [
    '<FormField keyboardType="phone-pad" />',
    "<FormField autoComplete='tel' />",
    '<TextInput textContentType={"telephoneNumber"} />',
  ];
  sample.forEach((line, i) => {
    assert.ok(SIGNATURES[i].re.test(line), `la firma ${SIGNATURES[i].name} debería detectarse`);
  });

  // Una mención en un comentario NO dispara (se blanquea antes de escanear).
  assert.ok(!SIGNATURES[0].re.test(stripComments('// usar keyboardType="phone-pad" acá')));
  assert.ok(!SIGNATURES[0].re.test(stripComments('/* keyboardType="phone-pad" */')));

  // La válvula de escape exige una razón escrita (RTEL.3.10): sin `-- razón` no habilita nada.
  assert.ok(DISABLE_NEXT_LINE.test('// phone-field-disable-next-line -- input legacy de un tercero'));
  assert.ok(!DISABLE_NEXT_LINE.test('// phone-field-disable-next-line'));
  assert.ok(!DISABLE_NEXT_LINE.test('// phone-field-disable-next-line --'));
});

test('el guard efectivamente recorre archivos (si el árbol se moviera, no pasaría en vacío)', () => {
  const scanned = ROOTS.flatMap(listFiles);
  assert.ok(scanned.length > 50, `el guard debería escanear el árbol real (vio ${scanned.length})`);
  assert.ok(
    scanned.some((f) => f.endsWith(sep + OWNER)),
    'PhoneField.tsx debería estar dentro del árbol escaneado (y exento por nombre)',
  );
});
