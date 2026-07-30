// GUARD: TODO ADAPTADOR DECLARA CÓMO ENTRA SU LECTURA AL CONTRATO (🟡-1 del review de `dad711f`).
//
// ── EL BUG DE CLASE QUE CIERRA ────────────────────────────────────────────────────────────────────
// El provider decidía si una lectura entra como LÍNEA CRUDA (`processRawLine` → `parseRs420Line`) o
// como EID limpio (`processEid`) con una comparación de DOS LITERALES escrita inline:
//
//     const isRawStream = transport.kind === 'web-serial' || transport.kind === 'spp-android';
//
// Si a esa lista le faltara `spp-android`, cada trama del RS420 iría por `processEid` →
// `normalizeTag` le saca el STX → quedan 34 dígitos → `isValidTag` false → **`invalid_eid`, cero
// lecturas**, y NADA lo vería: no había un solo test de `isRawStream` (grep, ejecutado), el provider
// es `.tsx` y no lo cubre ninguna suite node:test, y el E2E corre en web con mock/manual/simulator.
// El bastón quedaría mudo con la suite entera en verde. Es la TERCERA repetición de la misma clase en
// este camino (framing invertido → cero lecturas; `pairDevice()` colgado; y esto).
//
// ── EL GUARD SE ESCRIBE SOBRE LA AUSENCIA, EN DOS CAPAS ──────────────────────────────────────────
//  1. TIPO — `ADAPTER_INGEST_MODE` está declarado `satisfies Record<AdapterKind, IngestMode>`: un
//     `AdapterKind` nuevo **no compila** hasta declarar su modo. Un adapter nuevo nace en rojo.
//     (Verificado sacando `simulator` del mapa: `tsc --noEmit` → TS1360 + TS7053.)
//  2. TIPO — `ADAPTER_KINDS` (la lista enumerada a mano que recorre este test) está anclada al union
//     con un `Exclude<…> extends never` en el MISMO archivo: tampoco puede quedar vieja en silencio.
//     Ojo: esa ancla vive en `adapter-selection.ts` y NO acá, porque `app/tsconfig.json` EXCLUYE
//     `**​/*.test.ts` — una aserción de tipos escrita en un test no la chequea nadie (node:test solo
//     borra los tipos). Un "guard de tipos" en un archivo de test de este repo es decorativo.
//  3. RUNTIME (este archivo) — se recorre esa lista y se exige que cada kind tenga un modo válido, y
//     que el mapa no acumule filas de kinds que ya no existen.
//  4. CALL SITE — el provider tiene que DELEGAR en `ingestModeFor`, no volver a comparar literales.
//     (Verificado re-metiendo la comparación inline: este test falla.)
//
// ── LO QUE ESTE GUARD NO PUEDE VER ──────────────────────────────────────────────────────────────
// Que el modo declarado sea el CORRECTO para un adapter futuro (eso es lectura del reviewer + el
// banco). Sí fija los dos que hoy están verificados en device: web-serial y spp-android entregan la
// línea cruda del lector.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  ADAPTER_INGEST_MODE,
  ADAPTER_KINDS,
  ingestModeFor,
  type IngestMode,
} from './adapter-selection.ts';
import { stripSourceComments } from '../../utils/strip-comments.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** La lista enumerada a mano + su ancla de exhaustividad viven en el módulo (ver el header, punto 2). */
const ALL_KINDS = ADAPTER_KINDS;

const VALID_MODES: IngestMode[] = ['raw-line', 'eid'];

test('🟡-1: TODOS los AdapterKind declaran su modo de ingesta (un adapter nuevo nace en rojo)', () => {
  for (const kind of ALL_KINDS) {
    const mode = (ADAPTER_INGEST_MODE as Record<string, IngestMode | undefined>)[kind];
    assert.ok(
      mode != null,
      `el adapter '${kind}' no declara su modo de ingesta: sus lecturas entrarían por la puerta equivocada del contrato y el bastón quedaría mudo con la suite en verde`,
    );
    assert.ok(
      mode != null && VALID_MODES.includes(mode),
      `modo inválido para '${kind}': ${String(mode)}`,
    );
    assert.equal(ingestModeFor(kind), mode);
  }
});

test('🟡-1: el mapa no declara kinds que no existen (no acumula filas muertas)', () => {
  for (const kind of Object.keys(ADAPTER_INGEST_MODE)) {
    assert.ok(
      (ALL_KINDS as readonly string[]).includes(kind),
      `'${kind}' está en el mapa pero no es un AdapterKind`,
    );
  }
});

test('🟡-1: los dos adaptadores de STREAM entregan LÍNEA CRUDA (verificado en device)', () => {
  // spp-android: la trama del RS420 llega con STX + cabecera fija + timestamp → tiene que pasar por
  // `parseRs420Line`. Verificado leyendo una trama real del emulador en el A07 (banco §2).
  assert.equal(ingestModeFor('spp-android'), 'raw-line');
  assert.equal(ingestModeFor('web-serial'), 'raw-line');
});

test('🟡-1: los adaptadores que ya entregan el EID limpio NO pasan por el parser del lector', () => {
  assert.equal(ingestModeFor('manual'), 'eid');
  assert.equal(ingestModeFor('mock'), 'eid');
  assert.equal(ingestModeFor('simulator'), 'eid');
  assert.equal(ingestModeFor('hid-wedge'), 'eid');
});

test('🟡-1: el provider DELEGA en ingestModeFor y no vuelve a comparar kinds a mano', () => {
  const file = resolve(HERE, 'BleStickListenerProvider.tsx');
  const src = stripSourceComments(readFileSync(file, 'utf8'));

  assert.ok(
    src.includes('ingestModeFor('),
    'BleStickListenerProvider tiene que decidir el modo de ingesta con ingestModeFor(), no inline',
  );
  // La firma exacta del bug: comparar el kind del transporte contra un literal para decidir la
  // ingesta. Si vuelve, el guard cae.
  const inlineKindCompare = /kind\s*===\s*'(web-serial|spp-android)'/.exec(src);
  assert.equal(
    inlineKindCompare,
    null,
    `volvió la comparación inline de kinds en el provider (${inlineKindCompare?.[0]}): esa lista es la que se olvida`,
  );
});
