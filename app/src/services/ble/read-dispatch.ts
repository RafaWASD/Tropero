// read-dispatch.ts — decisión PURA de qué hacer con una lectura que acaba de entrar por el transporte:
// procesarla, o descartarla y por qué. Extraída del provider (que es React y no lo cubre ninguna suite
// node:test) para poder testear el invariante determinísticamente, sin device y sin renderizar nada.
//
// ── EL BUG QUE CIERRA (🔴-2 del barrido de edge cases del Bluetooth, 2026-08-06) ──────────────────────
// El provider disparaba `playFeedback` (la VIBRACIÓN) apenas el candidato era válido, ANTES del bucle de
// despacho y sin mirar si había alguien que fuera a recibir la lectura. En `maniobra/carga` no hay
// ningún `useBleStickListener` propio y el overlay global se auto-suprime en TODO el árbol `maniobra/*`
// (`BLE_OWNED_ROUTES`), así que el peón —cargando el peso en el cepo, con el siguiente animal ya
// entrando— bastonea, EL TELÉFONO LE VIBRA, y el dato no llega a ningún lado. La vibración es *la* señal
// que este producto le enseñó a leer como "entró": es una confirmación FALSA sobre un dato perdido, el
// peor modo de falla posible en la manga. Y encima la ventana de dedup ya había registrado ese EID, así
// que re-bastonear el mismo animal enseguida tampoco entraba.
//
// ── EL INVARIANTE ────────────────────────────────────────────────────────────────────────────────────
//   «No se emite feedback sensorial —ni se consume la ventana de dedup— por una lectura que no va a
//    recibir NADIE.»
// Se escribe sobre el invariante y no sobre la instancia a propósito: un test de `carga.tsx` no sirve,
// porque mañana hay otra pantalla sin consumidor y nace rota. Acá la pregunta es "¿cuántos consumidores
// van a ACTUAR sobre esta lectura?", que es independiente de qué pantalla esté arriba.
//
// ── POR QUÉ NO ALCANZA CON `subscribers.size === 0` ──────────────────────────────────────────────────
// Porque sería un NO-OP. El `FindOrCreateOverlay` es GLOBAL: vive montado sobre cualquier pantalla y
// llama a `useBleStickListener` incondicionalmente, así que SIEMPRE hay ≥1 suscriptor. Su supresión por
// ruta ocurre DENTRO de su callback (`if (onBleOwnedRouteRef.current) return;`), donde el provider no la
// ve. La pregunta honesta no es "¿hay alguien suscripto?" sino "¿hay alguien que vaya a ACTUAR?" — por
// eso cada suscriptor declara su `accepts()` al suscribirse y el provider cuenta los que aceptan AHORA.
//
// ── POR QUÉ EL DESCARTE TAMPOCO CONSUME LA VENTANA DE DEDUP ──────────────────────────────────────────
// `TagDedup.shouldEmit` documenta (y el banco del ESP32 verificó) que la ventana se mide «desde la última
// emisión CONFIRMADA, no desde el último intento». Una lectura que nadie recibió NO es una emisión: si el
// motor la registrara, el EID quedaría quemado 3 s por algo que nunca salió — y el peón que vuelve a
// `identificar` y re-bastonea ese animal enseguida se comería un segundo silencio, esta vez sin ninguna
// causa visible. Descartar ANTES del motor no debilita la semántica: la restaura. El precedente ya estaba
// en el propio provider: el corte por listener suspendido (MODO MANIOBRAS / form abierto) también sale
// antes del motor y antes del feedback; este corte es su hermano.
//
// ── ⚠️ ADVERTENCIA PARA CUANDO SE CABLEE LA PUERTA MANUAL (🟡-I del review) ───────────────────────────
// `accepts` gatea `handleReading`, y `handleReading` es la entrada de LOS DOS caminos del contrato: el
// transporte y el `ManualAdapter`. Hoy no hay conflicto porque `ManualAdapter.submit()` no tiene un solo
// call site (verificado por grep) — la carga manual de la UI todavía no pasa por acá. El día que se
// cablee (spec 04 R7.1: "la carga manual alimenta el MISMO contrato"), este gate se va a TRAGAR el EID
// tipeado a mano en el `TagScanSheet`: su predicado es `!assigning && !manualMode`, o sea FALSO
// exactamente cuando el operario está tipeando. El predicado se llama "¿voy a actuar sobre esta lectura?"
// pero, tal como está enchufado, responde por las dos puertas. Quien cablee la manual tiene que separar
// las puertas (que `accepts` reciba el origen de la lectura, o que la manual entre por otro camino) —
// no alcanza con ajustar el predicado del sheet.

/**
 * Qué hacer con la lectura recién llegada.
 *
 * - `process`: correr el motor de ingesta (parse + validate + DEDUP), disparar el feedback (R4) y
 *   despachar a los consumidores que aceptan.
 * - `drop_listener_suspended`: la escucha está suspendida (MODO MANIOBRAS con el listener apagado, o un
 *   form CREATE/EDIT con busyMode). Es el estado NORMAL de esas pantallas → se descarta en silencio, sin
 *   loguear (sería ruido por bastonazo).
 * - `drop_no_consumer`: se está escuchando, pero NINGÚN suscriptor va a actuar sobre la lectura (🔴-2).
 *   Se descarta SIN feedback y SIN consumir la ventana de dedup, y SÍ se loguea: es un agujero de
 *   producto (una pantalla que recibe bastonazos y no los usa), no un estado esperado.
 */
export type ReadHandling = 'process' | 'drop_listener_suspended' | 'drop_no_consumer';

export interface ReadHandlingInput {
  /** ¿La escucha está activa ahora? (`resolveListening` del listener-gate). */
  listening: boolean;
  /**
   * Cuántos suscriptores declararon que VAN A ACTUAR sobre esta lectura (su `accepts()` dio true).
   * NO es la cantidad de suscriptores registrados: el overlay global está siempre suscripto y se
   * auto-censura por ruta / scanner acotado / falta de campo activo.
   */
  acceptingConsumers: number;
}

/**
 * Decide el destino de una lectura. Orden de los cortes: primero la escucha (el gate que ya existía),
 * después el consumidor. Los dos descartan ANTES del feedback y ANTES del motor de dedup.
 *
 * `acceptingConsumers` se compara con `> 0` (y no con `!== 0`) para que un NaN o un negativo —una cuenta
 * rota— caiga del lado del descarte en vez de habilitar el feedback.
 */
export function resolveReadHandling({ listening, acceptingConsumers }: ReadHandlingInput): ReadHandling {
  if (!listening) return 'drop_listener_suspended';
  if (!(acceptingConsumers > 0)) return 'drop_no_consumer';
  return 'process';
}

/**
 * Compone el predicado que el hook consumidor le entrega al provider: lee el `accepts` VIGENTE de una ref
 * (el consumidor puede pasar una arrow nueva en cada render) y, si no declaró ninguno, acepta.
 *
 * ── POR QUÉ ESTO VIVE ACÁ Y NO INLINE EN `stick.ts` (🔴-A del review, 2026-08-06) ──────────────────────
 * Inline era una línea de React que ninguna suite podía ejecutar, así que el único guard posible era un
 * regex ("¿aparece el token `acceptsRef` después de `subscribeTagRead(`?"). El reviewer lo burló cambiando
 * DOS caracteres:
 *     () => acceptsRef.current?.() ?? true      →      () => acceptsRef.current?.() || true
 * Con eso TODO consumidor acepta siempre —el fix entero se vuelve un no-op— y quedaba `tsc` en RC=0 con la
 * suite en verde. Un `||` y un `??` son indistinguibles para un guard de forma y opuestos en comportamiento:
 * `??` solo cubre el caso "no declaró predicado", `||` además pisa el `false` de un predicado que declaró
 * que NO acepta. La única defensa real es ejecutarlo, y para ejecutarlo tiene que ser puro.
 */
export function resolveAccepts(ref: { current: (() => boolean) | undefined }): () => boolean {
  return () => {
    const declared = ref.current;
    // Sin predicado declarado, el consumidor acepta todas las lecturas mientras esté suscripto.
    if (declared === undefined) return true;
    // Con predicado declarado, manda SU respuesta — incluido el `false`. Acá es donde un `||` reintroduce
    // el 🔴-2 completo.
    return declared();
  };
}

/** Un suscriptor de lecturas + su declaración de si va a ACTUAR sobre la lectura ahora. */
export interface ReadSubscriber<T> {
  /** Lo que se le entrega la lectura (en el provider, el callback de tag_read). */
  cb: T;
  /** ¿Este suscriptor va a actuar sobre la lectura AHORA? Se evalúa en CADA lectura. */
  accepts: () => boolean;
}

/**
 * Los destinatarios REALES de una lectura: los suscriptores cuyo `accepts()` dio true.
 *
 * Vive acá y no en el provider (que es `.tsx` y no lo cubre ninguna suite node:test) a propósito: esta
 * función ES la diferencia entre "cuántos están suscriptos" y "cuántos van a actuar", que es el corazón
 * del 🔴-2. Como pura, se verifica por COMPORTAMIENTO en vez de por un regex sobre el provider.
 *
 * Un predicado que TIRA falla ABIERTO (cuenta como destinatario) y avisa por `onPredicateError`. Es
 * deliberado y va en contra del default del repo: acá "fail-closed" significaría que el peón bastonea y
 * NO PASA NADA, sin causa visible, en la manga. Una confirmación de más es recuperable; un bastón mudo
 * por un bug de predicado, no.
 *
 * ⚠️ El fail-open SOLO se sostiene si el despacho está ACOTADO (🟠-D del review). El fundamento original
 * decía "el callback igual tiene sus propias guardas adentro", y era falso: la guarda de adentro del
 * callback es —o era— LA MISMA función que acaba de tirar, así que la lectura se perdía igual y encima la
 * excepción subía hasta el read-loop del transporte, que tampoco la atrapa. Por eso el provider entrega
 * cada `cb` dentro de su propio try/catch: acá se decide "se lo entrego igual", y allá se garantiza que
 * ese intento no pueda tumbar la ingesta.
 */
export function acceptingTargets<T>(
  subscribers: Iterable<ReadSubscriber<T>>,
  onPredicateError: (error: unknown) => void,
): T[] {
  const targets: T[] = [];
  for (const sub of subscribers) {
    let accepts: boolean;
    try {
      accepts = sub.accepts();
    } catch (error) {
      onPredicateError(error);
      accepts = true;
    }
    if (accepts) targets.push(sub.cb);
  }
  return targets;
}
