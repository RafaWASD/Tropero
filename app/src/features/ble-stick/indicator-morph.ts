// indicator-morph — CUÁNDO el indicador del bastón se estira de círculo a pill (y cuándo se queda callado).
//
// ── LA FORMA (decisión de Raf, 2026-08-06) ──────────────────────────────────────────────────────────
// El indicador global vive **permanente arriba a la derecha como un CÍRCULO** (solo el ícono: presencia
// sin ocupar lugar) y, **cuando el estado CAMBIA**, se estira unos segundos a una pill con el texto y
// vuelve. Presencia permanente + mensaje completo justo cuando importa.
//
// ── EL PARPADEO QUE ESTE MÓDULO IMPIDE ──────────────────────────────────────────────────────────────
// "Anunciá el cambio, no cada intento". El backoff de reconexión del adapter cicla entre `'connecting'` y
// `'scanning'` durante minutos: con un "anunciar en cada cambio de `ConnectionStatus`" literal, la pill se
// abriría y cerraría sin parar en un rincón de la pantalla — el defecto que esta unidad vino a arreglar,
// reintroducido con otra cara. Por eso el disparador NO es el `ConnectionStatus` crudo sino su **clase de
// aviso**: `connecting` y `scanning` son la MISMA noticia ("está trabajando en conectarse"), así que el
// ciclo entero del backoff anuncia UNA vez.
//
// Y un segundo amortiguador para el link que TITILA (el `flap` del banco de pruebas: conecta, se cae,
// conecta…): una clase que ya se anunció hace poco no se vuelve a anunciar. La primera vuelta del titileo
// se ve; a partir de ahí el indicador se queda en círculo y el color/ícono siguen diciendo la verdad.
//
// PURO (sin React, sin RN, sin timers): la decisión se testea en `node:test` con un reloj de mentira. El
// componente solo aporta el `now` y guarda la memoria de lo anunciado.

import type { ConnectionStatus } from '../../services/ble/stick-adapter';

/**
 * CLASE DE AVISO: qué noticia da un estado. Dos estados distintos con la misma clase **no** son una
 * noticia nueva. Es la unidad en la que se decide anunciar, y el motivo por el que el backoff no parpadea.
 */
export type StickAnnounceKey =
  /** Conectado y listo. */
  | 'connected'
  /** Trabajando en conectarse: `connecting` + `scanning` (el ciclo del backoff cae ENTERO acá). */
  | 'working'
  /** Se perdió/no hay conexión (`disconnected`). */
  | 'lost'
  /** No se puede intentar: falta permiso. */
  | 'blocked'
  /** Sin actividad (`off`). El indicador se auto-oculta acá; la clase existe para ser exhaustivos. */
  | 'idle';

/** Cuánto queda estirada la pill después de un aviso. */
export const MORPH_EXPANDED_MS = 4_000;

/**
 * Piso entre dos avisos **de la misma clase**. Amortigua el link que titila sin tocar la secuencia normal
 * (`working` → `connected` anuncia las dos, porque son clases distintas).
 */
export const MORPH_MIN_GAP_MS = 8_000;

/** Clase de aviso de un `ConnectionStatus`. Exhaustiva sobre la unión del core. */
export function announceKeyFor(status: ConnectionStatus): StickAnnounceKey {
  switch (status) {
    case 'connected':
      return 'connected';
    case 'connecting':
    case 'scanning':
      return 'working';
    case 'disconnected':
      return 'lost';
    case 'permission_denied':
      return 'blocked';
    case 'off':
    default:
      return 'idle';
  }
}

/** Por qué se decidió estirar (o no). Viaja para que el test —y un log— digan cuál regla actuó. */
export type MorphReason =
  /** Primera vez que hay algo que decir: el indicador aparece ya con el mensaje. */
  | 'primera-vez'
  /** Noticia nueva. */
  | 'cambio'
  /** El estado cambió pero la NOTICIA es la misma (el ciclo del backoff). */
  | 'misma-clase'
  /** La misma noticia se dio hace muy poco: link titilando. */
  | 'anti-parpadeo';

export interface MorphPlan {
  expand: boolean;
  reason: MorphReason;
}

export interface MorphInput {
  /** Clase anunciada en el render anterior. `null` = todavía no se mostró nada. */
  prevKey: StickAnnounceKey | null;
  /** Clase de AHORA. */
  nextKey: StickAnnounceKey;
  /** Reloj (ms). Lo pasa el llamador: acá no hay `Date.now()` para que el test sea determinista. */
  now: number;
  /** Cuándo se anunció por última vez CADA clase. Ausente = nunca. */
  lastAnnouncedAt: Partial<Record<StickAnnounceKey, number>>;
}

/**
 * ¿Se estira la pill? Reglas, en orden:
 *   1. misma clase que la anterior → NO (el backoff no parpadea);
 *   2. esa misma clase se anunció hace menos de `MORPH_MIN_GAP_MS` → NO (link titilando);
 *   3. si no, SÍ.
 *
 * La primera aparición cuenta como cambio (`prevKey === null`): el indicador nace informando, que es
 * justo el caso que originó todo esto (la app arranca reconectando y hay que poder enterarse).
 */
export function planMorph(input: MorphInput): MorphPlan {
  const { prevKey, nextKey, now, lastAnnouncedAt } = input;
  if (prevKey === nextKey) return { expand: false, reason: 'misma-clase' };
  const previousOfSameKey = lastAnnouncedAt[nextKey];
  if (typeof previousOfSameKey === 'number' && now - previousOfSameKey < MORPH_MIN_GAP_MS) {
    return { expand: false, reason: 'anti-parpadeo' };
  }
  return { expand: true, reason: prevKey === null ? 'primera-vez' : 'cambio' };
}
