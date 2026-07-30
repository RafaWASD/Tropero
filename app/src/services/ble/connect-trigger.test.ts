// GUARD: TODO CAMINO QUE ARRANQUE UNA CADENA DE REINTENTOS DECLARA SI ES CON GESTO O SIN GESTO.
//
// ── EL DEFECTO QUE CIERRA ────────────────────────────────────────────────────────────────────────
// La cadena de reintentos del bastón no tenía tope: con el bastón apagado, reintento cada 8 s **para
// siempre**, y el estado `scanning` no tiene CTA, así que el operario no tenía botón para frenarla.
// Mientras eso exigía un gesto deliberado era una molestia discutible; **R6.4** (reconectar solo al abrir
// la app) lo volvió otra cosa: un bastón vendido, roto o que quedó en otro campo deja la app
// permanentemente con cara de rota, martillando la radio en cada apertura, sin que nadie haya tocado nada.
//
// El arreglo distingue por el ORIGEN de la cadena, y eso es exactamente lo que se puede olvidar en
// silencio: agregar mañana un camino que arranque reintentos y heredar el "para siempre". De ahí este
// guard, que es el mismo patrón (y el mismo motivo) que `ADAPTER_INGEST_MODE` y que el campo obligatorio
// `checkPermissions` del `SppEnv`.
//
// ── LAS TRES CAPAS ──────────────────────────────────────────────────────────────────────────────
//  1. TIPO — `CONNECT_TRIGGER_POLICY` es `satisfies Record<ConnectTrigger, TriggerPolicy>`: un trigger
//     nuevo **no compila** hasta declarar sus dos políticas (¿puede mostrar diálogos del SO? ¿qué le
//     hace a la cadena?). Y `CONNECT_TRIGGERS` está anclado al union con un `Exclude<…> extends never`
//     **en el módulo** — no acá: `app/tsconfig.json` excluye `**​/*.test.ts`, así que una aserción de
//     tipos escrita en un test de este repo no la chequea nadie.
//  2. RUNTIME (este archivo) — se recorren los triggers y se exige que las políticas sean coherentes:
//     exactamente UNO puede mostrar diálogos, exactamente UNO arranca una cadena con tope.
//  3. CALL SITES (este archivo) — se escanea `adapter-spp-android.ts` y se exige que **todos** los
//     `runConnect(` pasen un trigger LITERAL conocido. Un camino nuevo que arranque una cadena sin
//     declarar su origen cae acá.
//
// ── LO QUE NO PUEDE VER ─────────────────────────────────────────────────────────────────────────
// Que el trigger elegido sea el CORRECTO (si alguien pone 'operator' en un timer, el guard lo deja
// pasar: es lectura del reviewer). Sí caza el olvido, que es el modo de falla real.
// ⚠️ Debe estar registrado en la lista EXPLÍCITA de `scripts/run-tests.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  CONNECT_TRIGGERS,
  CONNECT_TRIGGER_POLICY,
  UNPROMPTED_RETRY_BUDGET_MS,
  policyFor,
  type ChainEffect,
} from './connect-trigger.ts';
import { backoffDelayMs } from './line-framer.ts';
import { stripSourceComments } from '../../utils/strip-comments.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const VALID_CHAIN: ChainEffect[] = ['start-unbounded', 'start-capped', 'inherit'];

test('todo ConnectTrigger declara sus DOS políticas (un trigger nuevo nace en rojo)', () => {
  for (const trigger of CONNECT_TRIGGERS) {
    const policy = (CONNECT_TRIGGER_POLICY as Record<string, { allowsSystemDialogs?: unknown; chain?: unknown }>)[trigger];
    assert.ok(policy != null, `el trigger '${trigger}' no declara política`);
    assert.equal(typeof policy.allowsSystemDialogs, 'boolean', `'${trigger}' sin allowsSystemDialogs`);
    assert.ok(
      VALID_CHAIN.includes(policy.chain as ChainEffect),
      `'${trigger}' declara un efecto de cadena inválido: ${String(policy.chain)}`,
    );
    assert.deepEqual(policyFor(trigger), policy);
  }
});

test('la tabla no acumula triggers que ya no existen', () => {
  for (const key of Object.keys(CONNECT_TRIGGER_POLICY)) {
    assert.ok((CONNECT_TRIGGERS as readonly string[]).includes(key), `'${key}' no es un ConnectTrigger`);
  }
});

test('SOLO el gesto del operario puede mostrar diálogos del sistema', () => {
  // Ni un timer ni el primer frame de la app pueden pedir el permiso de runtime o pedir prender el
  // Bluetooth: es el gesto que el operario no pidió (R6.9 / §9.3 del review).
  const conDialogos = CONNECT_TRIGGERS.filter((t) => policyFor(t).allowsSystemDialogs);
  assert.deepEqual(conDialogos, ['operator']);
});

test('SOLO la cadena que nadie pidió tiene tope; la del operario es indefinida', () => {
  // La distinción es el ORIGEN, no el estado: con un tap el operario está activamente tratando de
  // conectar y abandonarlo es peor que insistir.
  const capadas = CONNECT_TRIGGERS.filter((t) => policyFor(t).chain === 'start-capped');
  const sinTope = CONNECT_TRIGGERS.filter((t) => policyFor(t).chain === 'start-unbounded');
  assert.deepEqual(capadas, ['autoconnect']);
  assert.deepEqual(sinTope, ['operator']);
  // Y el reintento NO puede arrancar cadena: si arrancara, re-armaría el tope en cada vuelta y no se
  // alcanzaría nunca — o sea, la cadena infinita de vuelta, disfrazada.
  assert.equal(policyFor('retry').chain, 'inherit');
});

test('GUARD de call sites: todo runConnect() del adapter pasa un trigger literal conocido', () => {
  const src = stripSourceComments(readFileSync(resolve(HERE, 'adapter-spp-android.ts'), 'utf8'));
  const calls = [...src.matchAll(/runConnect\(([^)]*)\)/g)];
  // Se descuenta la DECLARACIÓN del método (`private async runConnect(deviceId: …, trigger: …)`).
  const callSites = calls.filter((m) => !m[1].includes('deviceId: string | undefined'));
  assert.ok(callSites.length >= 3, `se esperaban ≥3 call sites de runConnect, hay ${callSites.length}`);
  for (const m of callSites) {
    const args = m[1];
    const trigger = /'([a-z-]+)'\s*\)?$/.exec(args.trim())?.[1];
    assert.ok(
      trigger != null && (CONNECT_TRIGGERS as readonly string[]).includes(trigger),
      `runConnect(${args}) no declara un trigger conocido: un camino que arranca reintentos SIN declarar su origen hereda el "para siempre"`,
    );
  }
});

test('el presupuesto de la cadena sin gesto cubre "lo prendí un minuto después" y no "ya no existe"', () => {
  // El número se eligió contra la escalera de backoff, y esto lo fija: 500·1000·2000·4000·8000 y de ahí
  // 8 s fijos → los primeros 5 intentos consumen 15,5 s y el resto es un poll de 8 s.
  const rampa = [0, 1, 2, 3, 4].reduce((acc, a) => acc + backoffDelayMs(a), 0);
  assert.equal(rampa, 15_500);

  // Tiene que cubrir el escenario de campo (~60 s) con margen…
  assert.ok(UNPROMPTED_RETRY_BUDGET_MS >= 2 * 60_000 / 2, 'no cubre "lo prendí un minuto después"');
  assert.ok(UNPROMPTED_RETRY_BUDGET_MS > 60_000, 'un presupuesto igual al escenario no tiene margen');
  // … y NO puede ser "casi infinito": el techo del martilleo por apertura tiene que ser chico.
  assert.ok(UNPROMPTED_RETRY_BUDGET_MS <= 5 * 60_000, 'demasiado: el punto era dejar de martillar');
  // Y tiene que dar para bastante más que la rampa (si no, se agota antes de llegar al poll de 8 s).
  assert.ok(UNPROMPTED_RETRY_BUDGET_MS > 4 * rampa);
});
