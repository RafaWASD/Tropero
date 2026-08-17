// supabase/tests/health/env-oracle.cjs
// Oráculo PURO del campo `env` del body de la Edge Function `health` (spec 16 Run C, R7.2/R7.5).
//
// ── POR QUÉ EXISTE ESTE ARCHIVO ─────────────────────────────────────────────────────────────────────
// La suite `health` validaba el JUEGO DE CLAVES del body (C4(c) / R7.5: body ⊆ {ok, schema_version, env})
// pero nunca el VALOR de `env`. Consecuencia MEDIDA: el secret de ambiente no estuvo seteado en DEV
// durante semanas, el endpoint de salud reportó `env: "unknown"` todo ese tiempo, y la suite estuvo en
// verde. Un endpoint de salud que miente sobre en qué ambiente corre pasa el gate que debería frenarlo.
//
// ── POR QUÉ ES UN MÓDULO SEPARADO Y PURO ────────────────────────────────────────────────────────────
// Un guard que nunca vio un positivo no es un guard. El positivo de éste es el secret DESSETEADO, y
// dessetearlo es una acción externa sobre DEV que no se puede hacer desde un test. Sacando la decisión a
// una función pura, el mismo code-path que juzga la respuesta REAL se puede ejercer contra respuestas
// FABRICADAS ('unknown', vacío, ausente, typo, vocabulario equivocado) sin tocar nada externo. El test
// mutante vive al lado del real en `run.cjs`.
//
// ── EL DOMINIO: CONJUNTO CERRADO, NO "distinto de unknown" ──────────────────────────────────────────
// Derivado, no inventado. La EF hace `Deno.env.get('MITROPERO_ENV') ?? Deno.env.get('RAFAQ_ENV') ??
// 'unknown'`: el valor lo pone un secret POR PROYECTO de Supabase, y proyectos hay exactamente dos
// —dev y prod— (spec 16 design: "Free tier = exactamente 2 proyectos"; el dominio de destino de
// `scripts/lib/env-target.mjs` es {dev, prod}). El vocabulario del secret está documentado como
// `MITROPERO_ENV=development|production` (spec 16 design §C3 y `docs/backlog.md`).
//
// ⚠️ NO es el dominio de `app/src/utils/app-env.ts` (`APP_ENVS` = development|preview|production|e2e).
// Ese es `EXPO_PUBLIC_ENV`, el CANAL DE BUILD DEL CLIENTE, otro vocabulario: el canal `preview` apunta al
// proyecto Supabase de PROD, así que un proyecto que se declarara `env: "preview"` ya sería una
// configuración mal puesta, no un ambiente nuevo. Confundir los dos vocabularios es un modo de falla
// plausible (copiar el valor del perfil de EAS al secret) y el conjunto cerrado lo agarra.
//
// Se eligió el conjunto cerrado por sobre el `!== 'unknown'` (más laxo, cubre exactamente el modo de
// falla observado) porque los vecinos del modo observado son de la MISMA CLASE y son igual de silenciosos:
// un typo (`developement`, `Development`, `"development "` con espacio pegado por el shell), el
// vocabulario del cliente (`preview`), o el vocabulario de los scripts (`dev` / `prod`, que es lo que Raf
// tipea en `--env dev`). Todos esos pasan un `!== 'unknown'` y dejan al monitor con un label que no puede
// mapear a un proyecto — que vale lo mismo que `unknown`. El costo del conjunto cerrado es que un
// ambiente nuevo legítimo nace en rojo: eso es la feature (el mensaje de error dice exactamente qué
// tocar), no un bug. Mismo patrón que `APP_ENVS` (exportada para que los guards deriven el dominio en vez
// de re-tipearlo) y que `ACCEPTED_KNOWN_PROD_REFS_ENVS` (bloquear ruidoso > degradarse en silencio).

'use strict';

/**
 * Valores LEGÍTIMOS de `env` en el body de `health`: un valor por proyecto Supabase.
 * Fuente única del dominio — si algún día hay un tercer proyecto, se agrega ACÁ (y sólo acá).
 */
const KNOWN_HEALTH_ENVS = Object.freeze(['development', 'production']);

/** Valor centinela que devuelve la EF cuando NINGÚN secret de ambiente está seteado. Nunca aceptable. */
const UNSET_ENV_SENTINEL = 'unknown';

/** Error del oráculo de `env`. Clase propia para que el test mutante pueda exigir que falle POR ESTO. */
class HealthEnvError extends Error {
  constructor(message, observed) {
    super(message);
    this.name = 'HealthEnvError';
    this.observed = observed;
  }
}

const REMEDIACION_UNSET =
  'seteá el secret del proyecto (`supabase secrets set MITROPERO_ENV=development --project-ref <dev>`, ' +
  '`=production` en PROD) y redeployá `health` para que lo tome.';

const REMEDIACION_DOMINIO =
  `si agregaste un ambiente nuevo LEGÍTIMO, sumalo a KNOWN_HEALTH_ENVS en ` +
  `supabase/tests/health/env-oracle.cjs (es la fuente única del dominio); si no, el secret está mal ` +
  `escrito o tiene el vocabulario equivocado (ojo: {development,preview,production,e2e} es el dominio de ` +
  `EXPO_PUBLIC_ENV en el CLIENTE, y {dev,prod} el de --env en los scripts — ninguno de los dos es éste).`;

/**
 * ¿Tiene algún problema el `env` de este body de `health`? PURA.
 * @param {unknown} body body ya parseado de la respuesta de la EF (o uno fabricado, para el mutante).
 * @returns {string|null} descripción accionable del problema, o `null` si `env` es un ambiente conocido.
 */
function healthEnvProblem(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return `el body de health no es un objeto JSON: ${JSON.stringify(body)}`;
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'env')) {
    return (
      'el body de health NO trae la clave `env`. La EF la devuelve siempre → o cambió el contrato de ' +
      `la respuesta, o no estás pegándole a health. Body: ${JSON.stringify(body)}`
    );
  }
  const env = body.env;
  if (env === UNSET_ENV_SENTINEL) {
    return (
      `\`env\` es "${UNSET_ENV_SENTINEL}": el endpoint de salud NO sabe en qué ambiente corre porque ` +
      `NINGÚN secret de ambiente está seteado en el proyecto (la EF hace ` +
      `\`MITROPERO_ENV ?? RAFAQ_ENV ?? '${UNSET_ENV_SENTINEL}'\`). El monitor externo queda sin poder ` +
      `distinguir DEV de PROD → ${REMEDIACION_UNSET}`
    );
  }
  if (typeof env !== 'string') {
    return `\`env\` no es un string: ${JSON.stringify(env)}. Válidos: ${KNOWN_HEALTH_ENVS.join(' | ')}.`;
  }
  if (!KNOWN_HEALTH_ENVS.includes(env)) {
    return (
      `\`env\` = ${JSON.stringify(env)} no es un ambiente conocido. Válidos: ` +
      `${KNOWN_HEALTH_ENVS.join(' | ')}. ${REMEDIACION_DOMINIO}`
    );
  }
  return null;
}

/**
 * Igual que `healthEnvProblem` pero tira `HealthEnvError` si hay problema. Es el que usa la suite contra
 * la respuesta REAL y el que el test mutante ejerce contra respuestas fabricadas.
 * @param {unknown} body
 */
function assertHealthEnv(body) {
  const problem = healthEnvProblem(body);
  if (problem !== null) {
    throw new HealthEnvError(
      `health devolvió un ambiente inválido → ${problem}`,
      body !== null && typeof body === 'object' ? body.env : undefined,
    );
  }
}

module.exports = {
  KNOWN_HEALTH_ENVS,
  UNSET_ENV_SENTINEL,
  HealthEnvError,
  healthEnvProblem,
  assertHealthEnv,
};
