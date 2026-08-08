// GUARD: TODA RPC de reportes pasa por el chequeo de conexión ANTES de disparar el fetch.
//
// ── QUÉ CIERRA ───────────────────────────────────────────────────────────────────────────────────────
// R7.2.2 (los reportes son online-only y se detecta la ausencia de red ANTES de llamar) y **RCC.5.11 /
// DL9** (el cierre de campaña es online-only: la app no ofrece ni intenta cerrar sin conexión). El delta
// `campanas-congeladas` agregó las dos PRIMERAS ESCRITURAS de este módulo (`close_campaign`,
// `reopen_campaign`), y para ellas la propiedad no es cosmética: sin el chequeo previo, un toque en
// "Cerrar campaña" sin señal deja la promesa colgada contra un fetch que no resuelve, en la pantalla que
// el productor usa parado en el campo.
//
// ── POR QUÉ UN GUARD DE CABLEADO Y NO UN TEST DE COMPORTAMIENTO ──────────────────────────────────────
// Porque NO HAY forma de observarlo en runtime desde la suite: `services/reports.ts` importa
// `./supabase` y `./powersync/online-guard`, que arrastran React Native — ningún test de `node:test` puede
// importarlo, y de hecho **ninguno lo importa** (medido por el reviewer). O sea que hoy se podía borrar el
// `assertOnline` de los wrappers y NADA se ponía rojo. `online-guard.test.ts` prueba el predicado puro
// (`assertOnline` en sí), no que los wrappers lo usen: son dos propiedades distintas y esta no tenía dueño.
//
// ── EL MODELO (se escribe sobre la AUSENCIA, no sobre los wrappers de hoy) ───────────────────────────
//  · SEMILLA   — todo `export function` de `app/src/services/reports.ts`. No una lista: el wrapper número
//                14 que alguien agregue mañana entra solo.
//  · CUBIERTO  — el wrapper delega en uno de los helpers de invocación (`callRpcRows` / `callRpcSingle` /
//                `callRpcScalar`), y CADA helper llama a `assertOnline` ANTES de `supabase.rpc` (posición
//                verificada, no presencia: un `assertOnline` después del fetch no sirve de nada).
//  · VIOLACIÓN — un wrapper que llame a `supabase.rpc` por su cuenta, o un helper que pierda el chequeo o
//                lo corra tarde.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`: un guard que no corre da
// falsa confianza.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripSourceComments } from '../utils/strip-comments';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPORTS_TS = join(HERE, 'reports.ts');

/** Los 3 helpers de invocación que hoy existen. Se verifica que la detección los siga viendo. */
const KNOWN_HELPERS = ['callRpcRows', 'callRpcSingle', 'callRpcScalar'] as const;

function source(): string {
  return stripSourceComments(readFileSync(REPORTS_TS, 'utf8'));
}

/** El cuerpo de una función declarada con `async function NOMBRE(` … hasta el cierre de su bloque. */
function bodyOf(src: string, name: string): string | null {
  const start = src.search(new RegExp(`(async\\s+)?function\\s+${name}\\b`));
  if (start < 0) return null;
  const open = src.indexOf('{', start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

test('los 3 helpers de invocación existen (si se renombran, este guard avisa en vez de quedar ciego)', () => {
  const src = source();
  for (const h of KNOWN_HELPERS) {
    assert.ok(bodyOf(src, h) !== null, `no encuentro el helper ${h}: la detección de este guard quedó vieja`);
  }
});

test('cada helper que llama a `supabase.rpc` chequea la conexión ANTES (R7.2.2 / RCC.5.11)', () => {
  const src = source();
  for (const h of KNOWN_HELPERS) {
    const body = bodyOf(src, h) as string;
    const rpcAt = body.indexOf('supabase.rpc');
    if (rpcAt < 0) {
      // `callRpcSingle` delega en `callRpcRows`: no llama a la RPC, así que hereda el chequeo.
      assert.match(
        body,
        /callRpc(Rows|Scalar)\s*</,
        `${h}: no llama a supabase.rpc ni delega en otro helper — ¿de dónde saca el chequeo de conexión?`,
      );
      continue;
    }
    const onlineAt = body.indexOf('assertOnline');
    assert.ok(onlineAt >= 0, `${h}: llama a supabase.rpc SIN chequear conexión (R7.2.2)`);
    assert.ok(
      onlineAt < rpcAt,
      `${h}: el chequeo de conexión está DESPUÉS del fetch — chequear tarde es no chequear`,
    );
    // y el resultado del chequeo tiene que cortar el flujo, no solo loguearse.
    assert.match(
      body.slice(onlineAt, rpcAt),
      /return\s*\{\s*ok:\s*false/,
      `${h}: chequea la conexión pero no corta: offline tiene que devolver {ok:false} sin llamar la RPC`,
    );
  }
});

test('ningún wrapper exportado llama a `supabase.rpc` por su cuenta (todos pasan por los helpers)', () => {
  const src = source();
  const exported = [...src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  assert.ok(exported.length >= 10, `esperaba ≥10 wrappers exportados, encontré ${exported.length}`);

  const offenders: string[] = [];
  for (const name of exported) {
    const body = bodyOf(src, name);
    if (!body) continue;
    if (body.includes('supabase.rpc')) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    'Estos wrappers llaman a supabase.rpc directamente, salteándose el chequeo de conexión de los ' +
      'helpers. Los reportes son ONLINE-ONLY (R7.2.2) y el cierre de campaña además es online-only por ' +
      'decisión de dominio (DL9/RCC.5.11): la RPC no se dispara sin red.\n' + offenders.join('\n'),
  );
});

test('los dos wrappers de ESCRITURA del delta existen y delegan en el helper de escalar', () => {
  // Control de no-vacuidad del test de arriba: si `closeCampaign`/`reopenCampaign` desaparecieran o
  // dejaran de pasar por `callRpcScalar`, el barrido de arriba se quedaría sin sujeto y pasaría igual.
  const src = source();
  for (const name of ['closeCampaign', 'reopenCampaign']) {
    const body = bodyOf(src, name);
    assert.ok(body, `falta el wrapper ${name}`);
    assert.match(body as string, /callRpcScalar/, `${name}: tiene que pasar por callRpcScalar (RCC.5.11)`);
  }
});
