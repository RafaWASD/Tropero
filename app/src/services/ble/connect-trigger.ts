// connect-trigger — QUIÉN disparó un intento de conexión, y qué política le corresponde. Módulo PURO
// (solo tipos + una tabla) → testeable bajo node:test.
//
// ── POR QUÉ EXISTE (defecto que introdujo R6.4, cerrado el 2026-07-30) ───────────────────────────
// La cadena de reintentos del bastón no tiene tope: con el bastón apagado, la app reintenta cada 8 s
// **para siempre**. Mientras eso solo pasaba después de un gesto deliberado del operario era una
// molestia discutible (él estaba tratando de conectar; abandonarlo es peor). R6.4 —reconectar solo al
// abrir la app— lo volvió otra cosa: un bastón **vendido, roto o que quedó en otro campo** deja la app
// permanentemente con cara de rota, martillando la radio en cada apertura, sin un botón para frenarla.
//
// La distinción que arregla eso NO es un estado: es el ORIGEN de la cadena. Y como es una decisión que
// se puede olvidar en silencio —agregar un camino nuevo que arranque reintentos y heredar el "para
// siempre"—, no vive como un booleano `auto` suelto sino como una tabla EXHAUSTIVA:
// `satisfies Record<ConnectTrigger, TriggerPolicy>` hace que un trigger nuevo **no compile** hasta
// declarar sus dos políticas. Mismo patrón (y mismo motivo) que `ADAPTER_INGEST_MODE` y que el campo
// obligatorio `checkPermissions` del `SppEnv`.

/**
 * Quién disparó ESTE intento de conexión.
 *   - `operator`     → un tap (el chip del header, la pantalla de conexión, el sheet de scan).
 *   - `autoconnect`  → el arranque de la app (R6.4). Nadie pidió nada.
 *   - `retry`        → el timer de backoff, continuando la cadena vigente.
 */
export type ConnectTrigger = 'operator' | 'autoconnect' | 'retry';

/** Qué le hace un trigger a la cadena de reintentos. */
export type ChainEffect =
  /** Arranca una cadena SIN tope: el operario está activamente tratando de conectar. */
  | 'start-unbounded'
  /** Arranca una cadena CON tope de tiempo: nadie la pidió, así que no puede ser infinita. */
  | 'start-capped'
  /** No arranca nada: continúa la cadena vigente y hereda su tope (o su ausencia). */
  | 'inherit';

export interface TriggerPolicy {
  /**
   * ¿Puede mostrar diálogos del SO (pedir el permiso de runtime, pedir prender el Bluetooth)? SOLO el
   * gesto del operario: un diálogo disparado por un timer o por el primer frame de la app es
   * exactamente el gesto que el operario no pidió (R6.9 / §9.3 del review de `dad711f`).
   */
  readonly allowsSystemDialogs: boolean;
  readonly chain: ChainEffect;
}

export const CONNECT_TRIGGER_POLICY = {
  operator: { allowsSystemDialogs: true, chain: 'start-unbounded' },
  autoconnect: { allowsSystemDialogs: false, chain: 'start-capped' },
  retry: { allowsSystemDialogs: false, chain: 'inherit' },
} as const satisfies Record<ConnectTrigger, TriggerPolicy>;

export function policyFor(trigger: ConnectTrigger): TriggerPolicy {
  return CONNECT_TRIGGER_POLICY[trigger];
}

/**
 * Los triggers, ENUMERADOS A MANO para poder recorrerlos en runtime. Vive acá y no en el test por el
 * mismo motivo que `ADAPTER_KINDS`: `app/tsconfig.json` EXCLUYE `**​/*.test.ts`, así que una aserción de
 * tipos escrita en un test **no la chequea nadie**.
 */
export const CONNECT_TRIGGERS = ['operator', 'autoconnect', 'retry'] as const satisfies readonly ConnectTrigger[];

// EXHAUSTIVIDAD en tiempo de compilación: un `ConnectTrigger` nuevo que no esté en la lista NO COMPILA.
type TriggerMissingFromList = Exclude<ConnectTrigger, (typeof CONNECT_TRIGGERS)[number]>;
const _triggersAreExhaustive: TriggerMissingFromList extends never ? true : never = true;
void _triggersAreExhaustive;

/**
 * Cuánto tiempo puede reintentar una cadena que NADIE pidió (R6.4), medido desde que arrancó.
 *
 * ── POR QUÉ 2 MINUTOS, contra la escalera de backoff que ya existe ───────────────────────────────
 * `backoffDelayMs` da 500 · 1000 · 2000 · 4000 · 8000 ms y de ahí en adelante 8 s fijos (topea en el
 * intento 4). Sumando los delays, los primeros 5 intentos consumen **15,5 s**; el resto es un poll de
 * 8 s.
 *
 * El caso que TIENE que cubrir: *"abrí la app al llegar, caminé hasta la manga y prendí el bastón un
 * minuto después"*. El caso que NO tiene que cubrir: *"ese bastón lo vendí"*. 120 s deja el **doble** de
 * margen del escenario que hay que cubrir, y no elegí 60 s justamente porque un presupuesto igual al
 * escenario no tiene margen (el bastón tarda unos segundos en bootear y el primer connect después de
 * prenderlo puede fallar una vez).
 *
 * Cuántos intentos son 120 s depende de cuánto bloquee cada connect, y por eso el tope se mide en
 * TIEMPO y no en intentos: si el nativo resolviera al instante son ~18 intentos (15,5 s de rampa + 13
 * vueltas del piso de 8 s); con el bastón ausente cada `connectToDevice` bloquea ~10 s antes de
 * rendirse (medido en el banco), así que son ~6-7. Las dos cosas son "el operario tuvo dos minutos".
 *
 * Y el techo del martilleo por apertura de la app queda en 2 minutos, en vez de infinito.
 */
export const UNPROMPTED_RETRY_BUDGET_MS = 120_000;

/**
 * Cuánto tiene que DURAR un link para que cuente como sano y resetee el backoff (🟡-3 del review del
 * SPP, confirmado en el banco §4.3: `flap 4 3000` daba `attempt:0` las cuatro veces).
 *
 * Antes el contador se reseteaba apenas resolvía el connect, así que un link que se cae a los 200 ms
 * producía connect → drop → 500 ms → connect indefinido: el chip parpadeando y la radio martillando sin
 * que el backoff creciera nunca. Ahora el reset exige que la conexión haya vivido este tiempo. 30 s: más
 * que cualquier ciclo de flap patológico, mucho menos que una jornada normal (un corte único a mitad de
 * la mañana sigue reconectando desde el piso de 500 ms).
 *
 * ── POR QUÉ VIVE ACÁ Y NO EN UN ADAPTER (delta ios-ble-mfi, F3) ──────────────────────────────────
 * Nació en `adapter-spp-android.ts` porque era el único transporte con radio. Con el segundo
 * (`adapter-ble-gatt`) la elección era duplicar el número o importarlo de un adapter hermano, y las dos
 * son peores: el dwell es una política DE LA CADENA DE REINTENTOS, igual que
 * `UNPROMPTED_RETRY_BUDGET_MS`, y este módulo es donde vive esa política. `adapter-spp-android.ts` lo
 * re-exporta para no tocar sus call sites (RMV5.5 sigue verificándose contra el mismo símbolo).
 */
export const LINK_DWELL_MS = 30_000;
