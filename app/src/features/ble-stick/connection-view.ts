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
import type { ReaderDriver, TransportKind } from '../../services/ble/driver-types';

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
  /**
   * El TRANSPORTE del binding activo (delta ios-ble-mfi, RBM5.14). OPCIONAL: los call sites que no lo
   * saben (el indicador global del chrome, la fila de "Más") ven el copy genérico, que para ellos sigue
   * siendo cierto.
   *
   * Existe porque en BLE GATT "conectar" **es buscar**: no hay emparejamiento previo ni lista del SO, el
   * transporte escanea filtrando por el servicio del driver y se conecta al que reconoce. Con el copy
   * genérico, un escaneo agotado decía "Se apagó, quedó fuera de rango o cancelaste" + "Volver a
   * conectar" — la mitad de una verdad que no le dice al operario lo único que puede hacer (acercarse y
   * volver a buscar). NO cambia ningún `tone` (el invariante de que la fila y la card no se contradigan
   * se sigue cumpliendo con el mismo test).
   */
  transportKind?: TransportKind;
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
 *
 * Desde el delta ios-ble-mfi la función son DOS: el mapeo base (`baseConnectionStatusView`, idéntico al
 * as-built) y un override de COPY por transporte encima (`withBleGattSearchCopy`, RBM5.14). Sin
 * `env.transportKind`, o con cualquier transporte que no sea `ble-gatt`, el resultado es byte por byte el
 * de antes del delta — y hay un test que lo recorre para todos los estados.
 */
export function connectionStatusView(status: ConnectionStatus, env: ConnectionEnv): ConnectionStatusView {
  const base = baseConnectionStatusView(status, env);
  // El copy específico del transporte se aplica ENCIMA del base y solo cuando hay transporte: sin
  // transporte el estado ya es "no disponible / sin CTA" y ninguna instrucción de búsqueda aplica.
  if (env.hasTransport && env.transportKind === 'ble-gatt') return withBleGattSearchCopy(status, base);
  return base;
}

/**
 * En BLE GATT, "conectar" ES buscar (RBM5.14): el transporte escanea filtrando por el servicio del
 * driver, se conecta al primer device que su `deviceMatch` reconoce y, si el presupuesto del escaneo se
 * agota, emite `disconnected` (el reintento es un GESTO — un escaneo que se reintenta solo es la radio
 * escaneando para siempre). Este override es lo que hace que el copy diga eso:
 *   · `scanning`     → "Buscando el bastón…" en vez de "Reintentando…" (la primera vez no se está
 *                      reintentando nada, se está buscando).
 *   · `disconnected` → CTA **"Buscar de nuevo"** y un hint que nombra lo único accionable (acercarse).
 * Deliberadamente NO toca `tone`, `cta` (la acción sigue siendo `connect`/`none`), `icon` ni
 * `connected`: el invariante de que el tono de la fila no contradiga a la card se mantiene con el mismo
 * test, y la fila (`connectionRowStatus`) no necesita conocer el transporte.
 */
function withBleGattSearchCopy(status: ConnectionStatus, base: ConnectionStatusView): ConnectionStatusView {
  switch (status) {
    case 'scanning':
      return {
        ...base,
        label: 'Buscando el bastón…',
        hint: 'Estamos buscando el bastón cerca. La carga manual sigue disponible.',
      };
    case 'disconnected':
      return {
        ...base,
        hint: 'Se apagó, quedó fuera de rango o no lo encontramos. Acercate y buscalo de nuevo.',
        ctaLabel: 'Buscar de nuevo',
      };
    default:
      return base;
  }
}

function baseConnectionStatusView(status: ConnectionStatus, env: ConnectionEnv): ConnectionStatusView {
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
 * Nombre accesible de **cualquier superficie que solo INFORME el estado del bastón**: el estado corto,
 * precedido por el sujeto ("Bastón: Conectado"). Sin acción — quien además navega le agrega la suya.
 *
 * Existe porque el indicador global del chrome (`StickStatusIndicator`) muestra el estado corto y, cuando
 * está colapsado en círculo, **el texto no se ve**: el nombre accesible es lo único que lo dice. Sale de
 * la MISMA fuente que el trailing de la fila de "Más" (`connectionRowStatus`) para que las dos superficies
 * no puedan divergir — que es el defecto que este archivo viene cerrando desde el 2026-07-29.
 */
export function stickStateA11yName(status: ConnectionStatus, env: ConnectionEnv): string {
  return `Bastón: ${connectionRowStatus(status, env).text}`;
}

/**
 * Nombre accesible de la **fila "Bastón" del tab "Más"**. El estado va DENTRO del nombre: la fila
 * informa sin entrar, y un lector de pantalla tiene que poder decir lo mismo que el trailing.
 */
export function connectionRowA11yLabel(status: ConnectionStatus, env: ConnectionEnv): string {
  return joinStateAndAction(stickStateA11yName(status, env), STICK_ROW_ACTION);
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

// ─── INSTRUCCIONES POR TRANSPORTE (RMV3.2/3.7 → RBM5.14, RBM4.5) ─────────────────────────────────────
//
// Este copy vivía INLINE en el JSX de `StickConnectionScreen` (el componente `TransportInstructions`).
// Se muda acá por la misma razón por la que se mudaron el ícono del estado, el trailing de la fila de
// "Más" y el hint de la lista vacía (bugfix 2026-07-29 en adelante): una decisión de presentación que
// vive fuera del archivo donde se decide **no se testea**, y en este archivo el historial es que termina
// contradiciendo a la card. Con las dos ramas nuevas del delta (BLE y MFi) eso deja de ser teórico: el
// copy de MFi depende del `unavailableReason` del binding, y un `if` en el JSX sería la única cosa del
// delta sin oráculo. Todas las cadenas EXISTENTES se conservan byte por byte (regresión).

/**
 * Qué instrucción corresponde. La clave la elige esta función y el componente solo la renderiza (nota
 * simple vs. card con ícono y título), igual que `StatusIconKey`.
 */
export type TransportInstructionKey =
  | 'sin-binding' // el lector no es alcanzable en esta plataforma (RMV2.5)
  | 'no-disponible' // reconocido, pero el adapter no está en este build o no hay transporte instanciado
  | 'mfi-sin-protocolo' // NUEVO: MFi reconocido y el build no declara la cadena del fabricante (RBM4.5)
  | 'ble-hid' // emparejar como teclado del SO (GATED, R8.7)
  | 'ble-gatt' // NUEVO: prender el bastón y buscar (no hay emparejamiento previo)
  | 'mfi' // NUEVO: emparejar por el Accessory Picker de iOS (con la cadena del fabricante declarada)
  | 'serial' // elegir el puerto COM en el diálogo del navegador
  | 'spp'; // emparejar por Bluetooth y elegir de la lista

/**
 * Todas las claves, ENUMERADAS A MANO, para que un test pueda recorrerlas en runtime.
 *
 * Vive acá y no en el test por el mismo motivo que `ADAPTER_KINDS` y `TRANSPORT_KINDS`:
 * `app/tsconfig.json` EXCLUYE `**​/*.test.ts`, así que una aserción de tipos escrita en un test **no la
 * chequea nadie**. Con la lista acá, una clave nueva no compila hasta declararla (abajo) y recién
 * entonces el test que exige un caso por clave se pone en rojo — o sea que una rama de copy nueva NACE
 * SIN ORÁCULO EN ROJO, en vez de nacer sin oráculo y en verde.
 */
export const TRANSPORT_INSTRUCTION_KEYS = [
  'sin-binding',
  'no-disponible',
  'mfi-sin-protocolo',
  'ble-hid',
  'ble-gatt',
  'mfi',
  'serial',
  'spp',
] as const satisfies readonly TransportInstructionKey[];

// EXHAUSTIVIDAD en tiempo de compilación: si `TransportInstructionKey` gana un miembro que no está en
// `TRANSPORT_INSTRUCTION_KEYS`, `Exclude<…>` deja de ser `never` y esta asignación NO COMPILA.
type InstructionKeyMissingFromList = Exclude<
  TransportInstructionKey,
  (typeof TRANSPORT_INSTRUCTION_KEYS)[number]
>;
const _instructionKeysAreExhaustive: InstructionKeyMissingFromList extends never ? true : never = true;
void _instructionKeysAreExhaustive;

/** Ícono de la instrucción (clave; el componente resuelve el lucide). `null` = nota simple sin ícono. */
export type InstructionIconKey = 'keyboard' | 'bluetooth' | 'bluetooth-searching';

export interface TransportInstructionView {
  key: TransportInstructionKey;
  /** Título de la card. `null` → se renderiza como nota simple (InfoNote), sin título ni ícono. */
  title: string | null;
  icon: InstructionIconKey | null;
  /** Cuerpo es-AR, voseo. SIEMPRE ofrece la salida manual cuando no se puede conectar (RMV3.6). */
  body: string;
}

/**
 * Instrucciones del transporte del binding activo. NO bloquea nada: cuando no se puede conectar, el
 * cuerpo apunta a la carga manual (RMV3.6/RBM5.10) y **no se ofrece intentar** una conexión que
 * fallaría (RMV3.7).
 *
 * Precedencia (la misma que tenía el componente, más las dos ramas nuevas):
 *   1. sin binding → no alcanzable en esta plataforma;
 *   2. `available:false` o sin transporte instanciado → no disponible… salvo que el motivo sea de MFi,
 *      que tiene su copy propio (RBM4.5: "falta el protocolo del fabricante" no es lo mismo que
 *      "todavía no lo soportamos", y el operario que ve el segundo va a esperar una actualización que
 *      no depende de nosotros);
 *   3. por transporte: `ble-hid` / `ble-gatt` / `mfi` / `serial` / resto (`spp`).
 */
export function transportInstructionsView(input: {
  binding: ReaderBinding | null;
  /** ¿Hay un transporte INSTANCIADO? (`provider.transport != null`). Obligatorio: ver `deviceRowView`. */
  hasTransport: boolean;
}): TransportInstructionView {
  const { binding, hasTransport } = input;

  if (!binding) {
    return {
      key: 'sin-binding',
      title: null,
      icon: null,
      body: 'En este dispositivo el bastón no se conecta directo. Cargá las caravanas a mano.',
    };
  }

  if (!binding.available || !hasTransport) {
    // Los tres motivos de MFi comparten el mismo desenlace (no se intenta conectar) pero NO el mismo
    // copy: el que importa es `protocolo-no-declarado` / `build-sin-protocolos`, donde lo que falta es la
    // autorización del fabricante para iPhone y no una versión nuestra. `driver-sin-mfi` no llega acá
    // (si el driver no declara MFi, el binding no es de MFi).
    if (
      binding.transportKind === 'mfi' &&
      (binding.unavailableReason === 'build-sin-protocolos' ||
        binding.unavailableReason === 'protocolo-no-declarado')
    ) {
      return {
        key: 'mfi-sin-protocolo',
        title: 'Todavía no podemos conectarlo por iPhone',
        icon: 'bluetooth',
        body: 'Reconocemos este bastón, pero esta versión de la app todavía no tiene la autorización del fabricante para iPhone. Cargá las caravanas a mano; el bastón sigue andando en Android.',
      };
    }
    return {
      key: 'no-disponible',
      title: null,
      icon: null,
      body: 'Este bastón todavía no se conecta en esta versión de la app. Mientras tanto, cargá las caravanas a mano.',
    };
  }

  if (binding.transportKind === 'ble-hid') {
    return {
      key: 'ble-hid',
      title: 'Emparejalo como teclado Bluetooth',
      icon: 'keyboard',
      body: 'Andá a los ajustes de Bluetooth del sistema, emparejá el lector como un teclado y volvé. La lectura por teclado llega en una próxima versión.',
    };
  }

  if (binding.transportKind === 'ble-gatt') {
    // Lo que la app HACE de verdad (as-built del adapter, F3): al tocar el CTA escanea filtrando por el
    // servicio del driver, reconoce por nombre y se conecta sola al que reconoce. NO hay emparejamiento
    // previo en los ajustes del sistema (a diferencia del SPP) y NO hay lista de resultados que elegir
    // —el `StickAdapter` no expone el escaneo y este delta no cambia su interfaz (RBM9.6)—, así que el
    // copy no puede prometer un paso de selección que no existe.
    return {
      key: 'ble-gatt',
      title: 'Prendé el bastón y tocá conectar',
      icon: 'bluetooth-searching',
      body: 'Lo buscamos por Bluetooth y nos conectamos al bastón que reconocemos: no hace falta emparejarlo desde los ajustes. Si no aparece, acercate y tocá «Buscar de nuevo».',
    };
  }

  if (binding.transportKind === 'mfi') {
    // Disponible de verdad (la cadena del fabricante está declarada en el build): el emparejamiento lo
    // hace el SO con su Accessory Picker, que es como emparejan los Tru-Test "i" según el relevamiento.
    // Esta rama es INALCANZABLE en producción mientras ningún driver declare `mfi` (RBM4.6: no se
    // inventa ninguna `protocolString`) — existe para que el día que llegue la cadena el diff sea el dato
    // y no el copy, y se ejercita con una cadena sintética en `connection-view.test.ts`.
    return {
      key: 'mfi',
      title: 'Emparejalo desde el aviso de iPhone',
      icon: 'bluetooth',
      body: 'Prendé el bastón y aceptá el aviso de iPhone para usar el accesorio. Después volvé acá y tocá «Conectar bastón».',
    };
  }

  if (binding.transportKind === 'serial') {
    return {
      key: 'serial',
      title: null,
      icon: null,
      body: 'Tocá «Conectar bastón» y elegí el puerto COM del RS420 en el diálogo del navegador.',
    };
  }

  // spp (u otro stream): emparejar por Bluetooth y elegir de la lista.
  return {
    key: 'spp',
    title: null,
    icon: null,
    body: 'Emparejá el bastón por Bluetooth y elegilo de la lista para conectarlo.',
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

// ─── Aviso de lectura: la preferencia de sonido (R4.3) ───────────────────────────────────────────────

export interface FeedbackPrefView {
  /** Título de la tarjeta. */
  title: string;
  /** Label de la fila del switch. */
  label: string;
  /**
   * Sub-copy que dice qué pasa AHORA y qué gana/pierde el operario si lo cambia. Nunca "activado /
   * desactivado": eso describe el switch, que ya se ve.
   */
  hint: string;
  /**
   * Enseña el VOCABULARIO sensorial (🟡-12): que el aviso de "no sirvió" es distinto del de "entró". Sin
   * decirlo en algún lado, el peón se encuentra un sonido raro en la manga y no sabe qué significa — y el
   * único momento en que va a leer esto es acá, que es donde vino a tocar el bastón.
   */
  note: string;
}

/**
 * Presentación de la preferencia de sonido del bastón (R4.3). PURA.
 *
 * El sonido es apagable y la HÁPTICA NO (R4.1), así que el copy tiene que dejar clarísimo qué queda
 * cuando se apaga: si el operario cree que apagó "el aviso", va a pensar que el bastón dejó de andar.
 */
export function feedbackPrefView(beepEnabled: boolean): FeedbackPrefView {
  return {
    title: 'Aviso de lectura',
    label: 'Sonido al leer',
    hint: beepEnabled
      ? 'Suena y vibra en cada bastonazo. Apagalo si el ruido molesta: la vibración sigue.'
      : 'Solo vibra en cada bastonazo. Prendelo si con guante o en el bolsillo no la sentís.',
    note: 'Cuando el bastón lee algo que no sirve, el aviso es distinto: más grave y doble.',
  };
}
