// connection-view — presentación PURA de la pantalla de conexión del bastón (delta multivendor,
// RMV3.4/3.7/3.8/4.6). Sin React, sin RN, sin I/O → testeable en node:test (mismo patrón que el
// `statusView` de `baston-test.tsx`, pero EXTRAÍDO como módulo puro para trazabilidad).
//
// Mapea:
//   - `ConnectionStatus` (del core) → { label, icon, hint, cta } es-AR de cada estado de conexión (RMV3.4).
//   - un `ReaderBinding` / driver resuelto → el estado de fila de un device descubierto (RMV3.7/3.8).
//   - una lectura del simulador → la marca visual "DEMO" (integridad SENASA, RMV4.6).
//
// Todos los estados son NO bloqueantes (RMV3.6): la carga manual sigue disponible siempre. Ningún
// mapeo acá gatea nada; es solo copy + tono + qué hace el CTA. Imports SOLO de tipos (erasados) y por
// ruta relativa (el `@/` alias no lo resuelve el loader de node:test — patrón de las suites ble).

import type { ConnectionStatus } from '../../services/ble/stick-adapter';
import type { ReaderBinding } from '../../services/ble/selection-priority';
import type { ReaderDriver } from '../../services/ble/driver-types';

/** Qué acción dispara el CTA primario de un estado. 'none' = en progreso / auto-reintento (sin CTA). */
export type ConnectionCta = 'connect' | 'retry' | 'disconnect' | 'none';

/** Tono visual de un estado/fila (el componente lo mapea a token de color). */
export type ViewTone = 'idle' | 'progress' | 'success' | 'warning';

/**
 * CLAVE del ícono del estado; el componente la mapea al ícono lucide (ver `STATUS_ICONS` en
 * `StickConnectionScreen`). Viaja como clave —y no como componente— por la misma razón que el resto de
 * este módulo: importar `lucide-react-native` en runtime rompe el loader de node:test.
 *
 * Bugfix 2026-07-29 (nit del reviewer): antes el ícono lo derivaba el componente con un `statusIcon(status)`
 * propio — el ÚNICO elemento de la card que NO pasaba por la vista pura, así que podía contradecir al
 * label ("Bastón no disponible" con el ícono de conectado). Era inalcanzable hoy (sin transporte el
 * provider ni siquiera suscribe `onStatus`, así que el único estado posible es 'off'), pero es exactamente
 * la clase de trampa que este bugfix vino a cerrar: una decisión de presentación viviendo fuera del
 * archivo donde se decide y se testea. Ahora la card entera sale de una sola función.
 *
 * (La unión se declara acá y NO se importa del chip de spec 09 a propósito: son dos view-models
 * independientes; acoplarlos haría que un cambio de vocabulario en uno mueva al otro sin motivo.)
 */
export type StatusIconKey = 'bluetooth' | 'bluetooth-connected' | 'bluetooth-searching' | 'alert';

export interface ConnectionStatusView {
  /** Copy corto del estado (es-AR, voseo). */
  label: string;
  /** Clave del ícono del estado (el componente resuelve el componente lucide). */
  icon: StatusIconKey;
  /** Sub-copy accionable (es-AR). Nunca un stack trace ni jerga técnica. */
  hint: string;
  /** Qué hace el CTA primario. 'none' → sin CTA (conectando / reintentando solo). */
  cta: ConnectionCta;
  /** Texto del CTA (null si `cta === 'none'`). */
  ctaLabel: string | null;
  /** ¿El estado representa una conexión activa? (para el connect/disconnect del CTA). */
  connected: boolean;
  tone: ViewTone;
}

/** Entorno del transporte: lo que la vista necesita para saber si conectar es siquiera posible. */
export interface ConnectionEnv {
  /**
   * ¿Hay un transporte INSTANCIADO? (`provider.transport != null`). false en native manual-first: el
   * adapter SPP es Fase 4 y todavía no se construye → `instantiateTransport` devuelve null. Parámetro
   * OBLIGATORIO a propósito: un call site nuevo tiene que decidirlo explícitamente, no heredar un
   * default optimista que vuelva a ofrecer un CTA muerto.
   */
  hasTransport: boolean;
  /**
   * ¿La reconexión automática del arranque (R6.4) se agotó sin encontrar el bastón recordado?
   *
   * El estado que queda es `'off'` —no conectado y **sin** estar intentando— y eso es lo correcto para el
   * chrome: el `StickStatusIndicator` se auto-oculta en `'off'`, así que a alguien que no pidió nada no
   * se le toma la pantalla para avisarle que algo falló. Pero el que FUE a buscarlo a la pantalla de
   * conexión merece la verdad: "probamos y no lo encontramos", no "conectá el bastón" (que suena a que
   * nunca se intentó). Este flag es la diferencia entre esos dos copys, y por eso es OPCIONAL: los call
   * sites que no lo saben (el indicador global) siguen viendo el copy genérico, que para ellos es cierto.
   */
  autoConnectExhausted?: boolean;
}

/**
 * Presentación de cada `ConnectionStatus` del core (RMV3.4). es-AR, voseo, sin jerga. Ningún estado
 * bloquea la carga manual (RMV3.6): el CTA solo ofrece conectar/reintentar/desconectar. Exhaustivo
 * sobre la unión de `ConnectionStatus` (el `default` cubre 'off' y cualquier extensión futura).
 *
 * SIN TRANSPORTE (bugfix 2026-07-29, reporte de Raf en device Android): ANTES del switch se corta con
 * un estado propio, `cta: 'none'` — nunca se ofrece conectar algo que no existe. El `connect()` de un
 * transporte ausente es un no-op silencioso: el CTA prometía una acción que no podía cumplir. La
 * condición es "no hay transporte", NO "es Android": cuando la Fase 4 construya el adapter SPP el CTA
 * vuelve solo, sin tocar este archivo. El corte va ANTES del switch (no como una rama más) porque sin
 * transporte NINGÚN estado puede ofrecer conectar, ni siquiera el 'connected'/'disconnected'
 * transitorio que quedaría si el transporte se desmontara en caliente (cambio de `mode` del provider).
 */
export function connectionStatusView(status: ConnectionStatus, env: ConnectionEnv): ConnectionStatusView {
  if (!env.hasTransport) {
    return {
      label: 'Bastón no disponible',
      icon: 'bluetooth',
      hint: 'Todavía no se conecta en este dispositivo. Cargá las caravanas a mano.',
      cta: 'none',
      ctaLabel: null,
      connected: false,
      tone: 'idle',
    };
  }

  switch (status) {
    case 'connected':
      return {
        label: 'Bastón conectado',
        icon: 'bluetooth-connected',
        hint: 'Bastoneá un animal: la lectura entra sola, sin tocar la pantalla.',
        cta: 'disconnect',
        ctaLabel: 'Desconectar',
        connected: true,
        tone: 'success',
      };
    case 'connecting':
      return {
        label: 'Conectando…',
        icon: 'bluetooth-searching',
        hint: 'Estamos abriendo la conexión con el bastón.',
        cta: 'none',
        ctaLabel: null,
        connected: false,
        tone: 'progress',
      };
    case 'scanning':
      return {
        label: 'Reintentando…',
        icon: 'bluetooth-searching',
        hint: 'Se perdió la conexión; reintentando. La carga manual sigue disponible.',
        cta: 'none',
        ctaLabel: null,
        connected: false,
        tone: 'warning',
      };
    case 'disconnected':
      return {
        label: 'Bastón desconectado',
        icon: 'bluetooth',
        hint: 'Se apagó, quedó fuera de rango o cancelaste. Volvé a conectar cuando quieras.',
        cta: 'connect',
        ctaLabel: 'Volver a conectar',
        connected: false,
        tone: 'warning',
      };
    case 'permission_denied':
      return {
        label: 'Sin permiso',
        icon: 'alert',
        hint: 'Falta el permiso de Bluetooth (o este equipo no soporta el bastón). Revisalo y reintentá.',
        cta: 'retry',
        ctaLabel: 'Reintentar',
        connected: false,
        tone: 'warning',
      };
    case 'off':
    default:
      // El arranque intentó y se le agotó el tope (R6.4): el estado es el mismo ('off': no conectado y
      // sin estar intentando), pero el copy no puede ser el de "nunca se intentó". Con CTA, para que el
      // operario pueda arrancar una cadena SIN tope con un tap, y sin dramatizar (tone 'idle'): el
      // bastón apagado es el caso más probable, no una falla.
      if (env.autoConnectExhausted) {
        return {
          label: 'No encontramos el bastón',
          icon: 'bluetooth',
          hint: 'Buscamos el bastón guardado y no apareció: puede estar apagado o fuera de rango. Probá de nuevo cuando lo prendas. Mientras tanto podés cargar a mano.',
          cta: 'connect',
          ctaLabel: 'Volver a conectar',
          connected: false,
          tone: 'idle',
        };
      }
      return {
        label: 'Bastón sin conectar',
        icon: 'bluetooth',
        hint: 'Conectá el bastón para leer caravanas sin tocar la pantalla. También podés cargar a mano.',
        cta: 'connect',
        ctaLabel: 'Conectar bastón',
        connected: false,
        tone: 'idle',
      };
  }
}

// ─── Nombre ACCESIBLE de la fila de acceso al bastón ─────────────────────────────────────────────────
//
// Vive acá y no inline en `mas.tsx` por la misma regla que el resto del módulo: es una decisión de
// presentación del bastón, se decide una vez y se testea. La forma es estado PRIMERO, acción después, y
// el nombre contiene el texto VISIBLE **verbatim** (WCAG 2.5.3 «Label in Name»: quien maneja la app por
// voz dice lo que ve). Por eso el separador depende de cómo termina el estado: sin eso, `Conectando…`
// producía `Conectando….`, dos frases cortadas para un lector de pantalla.
//
// ⚠️ El pill del chrome (`StickStatusIndicator`) NO tiene entrada acá **a propósito**: no es un botón,
// es un elemento informativo con `pointerEvents="none"` (ver el bloque ⛔ de ese archivo — se intentó
// hacerlo tocable el 2026-08-06 y se revirtió con evidencia medida). Su nombre accesible es el label del
// estado, sin acción, vía `labelA11y`. Si algún día vuelve a ser un botón, su nombre se decide ACÁ y
// junto a este: los dos se montan a la vez y dos nombres parecidos rompen strict-mode en la E2E y suenan
// como el mismo control repetido en un lector de pantalla.

/** Acción de la FILA del tab "Más" (el destino es una pantalla a la que se navega). */
export const STICK_ROW_ACTION = 'Abrí la pantalla de conexión del bastón';

/** Une `<estado>` + `<acción>` sin duplicar puntuación y sin alterar el estado (WCAG 2.5.3). */
function joinStateAndAction(state: string, action: string): string {
  return /[.…!?]$/.test(state) ? `${state} ${action}` : `${state}. ${action}`;
}

/**
 * Nombre accesible de la **fila "Bastón" del tab "Más"**. El estado va DENTRO del nombre: la fila
 * informa sin entrar, y un lector de pantalla tiene que poder decir lo mismo que el trailing.
 */
export function connectionRowA11yLabel(status: ConnectionStatus, env: ConnectionEnv): string {
  return joinStateAndAction(`Bastón: ${connectionRowStatus(status, env).text}`, STICK_ROW_ACTION);
}

/**
 * Traducción `ViewTone` → token de color del DS (ADR-023 §4). Vive acá —y no en cada componente— por
 * la misma razón que el resto del módulo: es una decisión de presentación, se decide una vez y se
 * testea. Es puro (devuelve el NOMBRE del token, un string; no importa Tamagui) → node:test lo carga.
 *
 * ⚠ ESTA ES LA CANÓNICA, PERO NO ES LA ÚNICA — Y LAS OTRAS NO SON TODAS IGUALES. Hoy conviven tres
 * copias privadas: `screens/StickConnectionScreen` y `components/StickStatusIndicator` coinciden con
 * esta, y **`components/StickDeviceRow` DIVERGE**: manda `'progress'` a la rama del `default` junto con
 * `'idle'`, o sea `$textMuted` donde las otras tres dan `$primary`. Hoy no hay bug vivo porque
 * `deviceRowView` **nunca** devuelve `tone: 'progress'` (sus cinco estados son success/idle/warning), así
 * que esa rama es inalcanzable; pero el día que emita uno, el color de esa fila va a diferir del resto.
 *
 * Consecuencia para el que venga a unificar: **el barrido NO es un no-op.** Reemplazar la copia de
 * `StickDeviceRow` por esta función CAMBIA un color (en un camino hoy muerto, y hacia el valor que usan
 * las otras tres — probablemente el correcto, pero es una decisión, no un refactor mecánico). No se
 * unificó en la unidad del acceso desde "Más" porque es un barrido cross-file que la excede y porque una
 * de las copias vive en el chip global, congelado por otra unidad en curso.
 */
export function toneColorToken(tone: ViewTone): '$primary' | '$terracota' | '$textMuted' {
  switch (tone) {
    case 'success':
    case 'progress':
      return '$primary';
    case 'warning':
      return '$terracota';
    case 'idle':
    default:
      return '$textMuted';
  }
}

/** Estado de conexión CONDENSADO para el trailing de una fila de lista (`{ text, tone }`). */
export interface ConnectionRowStatus {
  /**
   * Copy CORTÍSIMO del estado (es-AR), pensado para el trailing de una fila junto a un chevron. NO
   * repite la palabra "Bastón": la fila ya la tiene como label, y repetirla la haría desbordar.
   */
  text: string;
  tone: ViewTone;
}

/**
 * Estado de conexión para la **fila de acceso al bastón del tab "Más"** (RMV3.1). Es la versión corta
 * de `connectionStatusView`: la fila necesita responder "¿está conectado?" de un vistazo, sin entrar.
 *
 * POR QUÉ VIVE ACÁ y no inline en `mas.tsx`: es exactamente la clase de bug que este archivo cerró el
 * 2026-07-29 (ver el doc de `StatusIconKey`) — una decisión de presentación del bastón viviendo fuera
 * del archivo donde se decide y se testea puede terminar contradiciendo a la pantalla (la fila diciendo
 * "Conectado" mientras la card dice "Bastón no disponible"). El test fija que el `tone` de la fila
 * COINCIDE con el de `connectionStatusView` para toda combinación de entrada.
 *
 * Mismo corte que `connectionStatusView`: **sin transporte** se responde ANTES del switch. La fila NO se
 * oculta en ese caso (a diferencia del chip global, que se auto-oculta): es el único acceso in-app a la
 * pantalla, y esa pantalla explica la salida manual. Lo que cambia es que no miente sobre el estado.
 */
export function connectionRowStatus(status: ConnectionStatus, env: ConnectionEnv): ConnectionRowStatus {
  if (!env.hasTransport) {
    return { text: 'No disponible', tone: 'idle' };
  }

  switch (status) {
    case 'connected':
      return { text: 'Conectado', tone: 'success' };
    case 'connecting':
      return { text: 'Conectando…', tone: 'progress' };
    case 'scanning':
      return { text: 'Reintentando…', tone: 'warning' };
    case 'disconnected':
      return { text: 'Desconectado', tone: 'warning' };
    case 'permission_denied':
      return { text: 'Sin permiso', tone: 'warning' };
    case 'off':
    default:
      // Mismo criterio de honestidad que el copy largo (R6.4): si el arranque ya buscó el bastón
      // recordado y se le agotó el tope, "Sin conectar" sonaría a que nunca se intentó.
      return env.autoConnectExhausted
        ? { text: 'No encontrado', tone: 'idle' }
        : { text: 'Sin conectar', tone: 'idle' };
  }
}

/** Estado de la fila de un device descubierto en la pantalla (RMV3.7/3.8). */
export type DeviceRowState =
  | 'recognized-available' // driver reconocido + adapter construido en este build → conectable
  | 'recognized-unavailable' // driver reconocido pero el adapter NO está construido todavía (RMV3.7)
  | 'recognized-unreachable' // driver reconocido pero sin transporte alcanzable en esta plataforma (RMV2.5)
  | 'unrecognized-connectable' // ningún driver matchea, pero es un device REAL emparejado y se puede probar
  | 'unrecognized'; // ningún driver matchea el device (RMV3.8)

export interface DeviceRowView {
  state: DeviceRowState;
  /** Nombre a mostrar (marca del driver reconocido, o el nombre crudo del device desconocido). */
  title: string;
  /** Sub-copy es-AR del estado de la fila. Siempre ofrece la salida manual cuando no es conectable. */
  subtitle: string;
  /** ¿La fila es accionable (tocar → intentar conectar)? SOLO cuando es 'recognized-available'. */
  actionable: boolean;
  tone: ViewTone;
}

/**
 * Estado de fila de un device descubierto (RMV3.7/3.8). Precedencia:
 *   1. hay `binding` → reconocido + hay transporte con adapter mapeado en la plataforma:
 *        · `binding.available` true **y hay transporte instanciado** → conectable (RMV3.7).
 *        · `binding.available` false → reconocido pero el adapter no está construido en este build
 *          → NO se intenta conectar (RMV3.7); carga manual como salida.
 *   2. sin binding pero con `driver` → reconocido pero sin transporte alcanzable en esta plataforma
 *      (ej. RS420 en iOS: declara solo spp+serial, ninguno mapeado → manual, RMV2.5).
 *   3. sin driver → NO reconocido (RMV3.8): ningún driver matchea → carga manual como piso.
 * NUNCA bloquea (RMV3.6): salvo el caso conectable, la fila apunta a la carga manual.
 *
 * `hasTransport` (bugfix 2026-07-29) — el `binding` responde "¿este build sabe hablarle a este lector en
 * esta plataforma?" (capacidad de BUILD, la calcula `selectReaderBinding` contra `BUILT_ADAPTERS`); el
 * transporte responde "¿hay un adapter INSTANCIADO ahora?" (lo decide `selectTransportAdapter` +
 * `instantiateTransport`). Son dos fuentes distintas y pueden discrepar: tocar la fila llama
 * `transport?.connect()`, así que sin transporte la fila sería una afordancia muerta. Hoy en Android
 * coinciden por casualidad (spp-android no está ni en `BUILT_ADAPTERS` ni instanciado); el día que la
 * Fase 4 agregue 'spp-android' a `BUILT_ADAPTERS` sin tocar `selectTransportAdapter`, la fila diría
 * "Tocá para conectar" y no pasaría nada. Este parámetro cierra esa trampa: sin transporte, la fila
 * cae a `recognized-unavailable` — que es literalmente cierto (el build no lo construyó).
 */
export function deviceRowView(input: {
  driver: ReaderDriver | null;
  binding: ReaderBinding | null;
  deviceName?: string;
  /** ¿Hay un transporte INSTANCIADO? (`provider.transport != null`). Obligatorio: ver el doc de arriba. */
  hasTransport: boolean;
  /**
   * OPT-IN (default false): permitir PROBAR la conexión con un device que NINGÚN driver reconoce
   * (`unrecognized-connectable`). Solo lo pide la lista de EMPAREJADOS REALES del teléfono, y por un
   * motivo concreto: `deviceMatch.namePattern` del RS420 (`/RS\s?420|allflex/i`) es una HIPÓTESIS —
   * el nombre Bluetooth real del lector no está verificado en `field-findings.md`. Si el bastón se
   * anuncia con otro nombre, una lista que solo deja tocar lo "reconocido" vuelve la feature
   * inservible en el campo y encima sin síntoma. Con el opt-in, el operario puede intentar y el
   * error de conexión sale del transporte real, no de una regex nuestra. Todo el resto de los call
   * sites (capacidad de build, web, iOS) NO lo pasa y conserva RMV3.8 tal cual.
   */
  allowUnrecognized?: boolean;
}): DeviceRowView {
  const { driver, binding, deviceName, hasTransport, allowUnrecognized = false } = input;

  if (binding !== null) {
    if (binding.available && hasTransport) {
      return {
        state: 'recognized-available',
        title: binding.driver.displayName,
        subtitle: 'Reconocido. Tocá para conectar.',
        actionable: true,
        tone: 'success',
      };
    }
    return {
      state: 'recognized-unavailable',
      title: binding.driver.displayName,
      subtitle: 'Reconocido, todavía no disponible en esta versión. Cargá la caravana a mano.',
      actionable: false,
      tone: 'idle',
    };
  }

  if (driver !== null) {
    return {
      state: 'recognized-unreachable',
      title: driver.displayName,
      subtitle: 'Reconocido, pero no se conecta en este dispositivo. Cargá la caravana a mano.',
      actionable: false,
      tone: 'idle',
    };
  }

  const trimmed = deviceName?.trim();
  const title = trimmed && trimmed.length > 0 ? trimmed : 'Dispositivo desconocido';

  if (allowUnrecognized && hasTransport) {
    return {
      state: 'unrecognized-connectable',
      title,
      subtitle: 'No lo reconocemos como bastón. Podés probar a conectarlo igual.',
      actionable: true,
      tone: 'idle',
    };
  }

  return {
    state: 'unrecognized',
    title,
    subtitle: 'No reconocido. Podés cargar la caravana a mano.',
    actionable: false,
    tone: 'warning',
  };
}

/**
 * Copy del estado VACÍO de la lista de lecturas de la pantalla de conexión. Vive acá —y no inline en el
 * JSX— por la misma razón que el resto de este módulo (bugfix 2026-07-29): también le decía al operario
 * "Conectá el bastón y bastoneá un animal" en un dispositivo donde el bastón no se puede conectar. Toda
 * respuesta a "¿esto promete conectar?" se decide en este archivo, y se testea.
 */
export function readsEmptyHint(hasTransport: boolean): string {
  return hasTransport
    ? 'Todavía no leíste ninguna caravana. Conectá el bastón y bastoneá un animal.'
    : 'Todavía no leíste ninguna caravana. En este dispositivo se cargan a mano.';
}

/**
 * Estado de la LISTA DE EMPAREJADOS del teléfono (camino SPP-Android). Es el resultado de
 * `listPairedSppDevices()` más los dos estados de UI (todavía no se buscó / buscando).
 */
export type PairedListState =
  | 'idle' // todavía no se buscó (el operario tiene que tocar el botón: dispara el permiso del SO)
  | 'loading'
  | 'ok' // hay ≥1 device emparejado
  | 'empty' // el teléfono no tiene NINGÚN device Bluetooth emparejado
  | 'permission_denied'
  | 'bluetooth_off'
  | 'unavailable' // este build no puede hablar Bluetooth Classic (web / iOS / dev build viejo)
  | 'error';

export interface PairedListView {
  /** Copy del estado (es-AR, voseo). Vacío = no se muestra texto (la lista habla sola). */
  hint: string;
  /** Texto del botón de (re)búsqueda. `null` = sin botón (mientras carga, o si no aplica). */
  ctaLabel: string | null;
  tone: ViewTone;
}

/**
 * Copy de cada estado de la lista de emparejados (es-AR, voseo, sin jerga). NINGUNO bloquea la
 * carga manual (RMV3.6). Vive acá —y no inline en el JSX— por la misma razón que el resto del
 * módulo: es una decisión de presentación y se testea.
 *
 * "Emparejados", no "encontrados": este camino NO hace discovery (no pide permiso de ubicación ni
 * de escaneo). El RS420 se empareja UNA vez desde los ajustes de Android (es slave, PIN 1234) y
 * después aparece acá — el copy tiene que decir eso, o el operario busca un botón de "escanear"
 * que no existe.
 */
export function pairedDevicesView(state: PairedListState): PairedListView {
  switch (state) {
    case 'loading':
      return { hint: 'Buscando dispositivos emparejados…', ctaLabel: null, tone: 'progress' };
    case 'ok':
      return {
        hint: 'Elegí el bastón de la lista. Si no está, emparejalo primero desde los ajustes de Bluetooth del teléfono (PIN 1234).',
        ctaLabel: 'Actualizar lista',
        tone: 'idle',
      };
    case 'empty':
      return {
        hint: 'Este teléfono no tiene ningún dispositivo Bluetooth emparejado. Emparejá el bastón desde los ajustes de Bluetooth (PIN 1234) y volvé.',
        ctaLabel: 'Actualizar lista',
        tone: 'warning',
      };
    case 'permission_denied':
      return {
        hint: 'Falta el permiso de Bluetooth para ver los dispositivos emparejados. Dáselo y reintentá; mientras tanto podés cargar a mano.',
        ctaLabel: 'Reintentar',
        tone: 'warning',
      };
    case 'bluetooth_off':
      return {
        hint: 'El Bluetooth del teléfono está apagado. Prendelo y reintentá.',
        ctaLabel: 'Reintentar',
        tone: 'warning',
      };
    case 'unavailable':
      return {
        hint: 'En este dispositivo no se puede conectar el bastón. Cargá las caravanas a mano.',
        ctaLabel: null,
        tone: 'idle',
      };
    case 'error':
      return {
        hint: 'No pudimos leer los dispositivos emparejados. Reintentá; la carga manual sigue disponible.',
        ctaLabel: 'Reintentar',
        tone: 'warning',
      };
    case 'idle':
    default:
      return {
        hint: 'Emparejá el bastón desde los ajustes de Bluetooth del teléfono (PIN 1234) y después buscalo acá.',
        ctaLabel: 'Buscar bastón emparejado',
        tone: 'idle',
      };
  }
}

/**
 * Marca visual de una lectura del SIMULADOR (RMV4.6, integridad SENASA): las lecturas del bastón
 * simulado se muestran con el badge "DEMO" en la confirmación y en la lista; una lectura real → sin
 * badge. Puro: el componente decide `isFromSimulator = transport.kind === 'simulator'` y renderiza.
 */
export function readingBadge(isFromSimulator: boolean): 'DEMO' | null {
  return isFromSimulator ? 'DEMO' : null;
}
