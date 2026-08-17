// StickConnectionScreen — pantalla de CONEXIÓN / SELECCIÓN del bastón (delta multivendor,
// RMV3.1–3.4, 3.6–3.8). Vive en "Más" (ADR-018). Es la CARA DE LA DEMO para fabricantes:
// descubrir → listar → elegir → conectar, específico por adaptador del binding, + estados con CTA,
// + (bajo modo demo) controles de simulación.
//
// CONSUME EL PROVIDER GLOBAL (`useBleProviderApi` + `useBleConnectionStatus`) — NO monta un provider
// propio (a diferencia del harness `baston-test.tsx`, que es self-contained para dev). El estado, la
// ingesta y la confirmación pre-commit los maneja el provider del core; esta pantalla solo dispara la
// conexión (gesto de usuario, web-serial exige requestPort) y presenta.
//
// NO BLOQUEANTE (RMV3.6): ningún estado gatea la carga manual. `available:false` (adapter reconocido
// pero no construido en este build) → "no disponible en esta versión" + manual, SIN intentar conectar
// (RMV3.7). Device sin driver → "no reconocido" + manual (RMV3.8).
//
// Cero hardcode (ADR-023 §4): tokens + getTokenValue para íconos lucide. es-AR voseo. lineHeight
// matcheado en todo heading con descendentes. Tap nativo (onPress + a11y en la pieza Tamagui).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Bluetooth, BluetoothConnected, BluetoothSearching, ChevronLeft, Keyboard, Radio, TriangleAlert, Volume2, VolumeX } from 'lucide-react-native';

import { Button, Card, InfoNote } from '@/components';
import { useBleProviderApi } from '@/services/ble/BleStickListenerProvider';
import { useScopedScannerControls } from '@/services/ble/stick';
import { useBleConnectionStatus } from '@/services/ble/connection-status';
import { selectReaderBinding, type ReaderBinding } from '@/services/ble/selection-priority';
import { transportChoices, type AdapterKind, type TransportChoice } from '@/services/ble/adapter-selection';
import { declaredEaProtocols } from '@/services/ble/ea-protocols';
import { RS420_DRIVER } from '@/services/ble/driver-rs420';
import { DRIVER_REGISTRY, findDriverForDevice } from '@/services/ble/driver-registry';
import { listPairedSppDevices, isSppNativeAvailable } from '@/services/ble/adapter-spp-android';
import { isBleGattTransportAvailable } from '@/services/ble/adapter-ble-gatt';
import { isMfiTransportAvailable } from '@/services/ble/adapter-mfi-ios';
import type { PairedDevice } from '@/services/ble/spp-protocol';
import { forgetRememberedDevice, readRememberedDevice } from '@/services/ble/remembered-device';
import { readBeepEnabled, writeBeepEnabled, cachedBeepEnabled } from '@/services/ble/feedback-pref';
import { useStickStatusSurface } from '@/hooks/useStickStatusSurface';
import { buttonA11y, labelA11y, switchA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';
import {
  connectionStatusView,
  deviceRowView,
  feedbackPrefView,
  pairedDevicesView,
  readingBadge,
  readsEmptyHint,
  transportInstructionsView,
  type InstructionIconKey,
  type PairedListState,
  type StatusIconKey,
} from '../connection-view';
import { StickDeviceRow } from '../components/StickDeviceRow';
import { DemoControls } from '../components/DemoControls';

// Adaptadores EFECTIVAMENTE construidos en este build: web-serial (web), mock (E2E), manual (piso),
// simulator (demo-gated) y —desde 2026-07-29— spp-android (Bluetooth Classic nativo, dep
// `react-native-bluetooth-classic` instalada y autolinkeada). hid-wedge sigue GATED → un binding a
// ese kind sale `available:false` (RMV2.4/3.7). Entrada inyectable del motor de selección puro
// (RMV2.6): centralizamos la verdad del build acá.
//
// ⚠️ `available` (capacidad de BUILD) NO alcanza para habilitar el tap: la fila cruza además
// `hasTransport` (¿hay un adapter INSTANCIADO ahora?), que en Android es false si el APK no trae el
// módulo nativo (dev build viejo). Son dos fuentes distintas — ver `deviceRowView`.
//
// Delta ios-ble-mfi: entra `'ble-gatt'` (F2/F3: el adapter existe y la dep nativa está en el build) y
// —desde **F5**— entra `'mfi-ios'`: `adapter-mfi-ios.ts` YA EXISTE. En F4 estaba deliberadamente afuera
// porque el adapter no existía todavía; dejarlo afuera ahora sería peor que ruido, sería MENTIR en el
// diagnóstico: con `mfi-ios` fuera de esta lista, el binding de un lector MFi diría
// `adapter-no-construido` ("todavía no lo soportamos") cuando la verdad es `build-sin-protocolos` ("falta
// la autorización del fabricante") — el motivo equivocado manda a buscar el dato equivocado, y es justo
// la distinción que RBM4.5 compró para el copy de la pantalla.
//
// ⚠️ Esto NO significa que el transporte se pueda montar hoy: `available` es capacidad de BUILD, y para
// MFi RBM5.5 lo cruza con la lista de protocolos declarada (`declaredEaProtocols()`, hoy VACÍA) → el
// binding sigue saliendo `available:false`, con el motivo honesto. La otra mitad —"¿este dispositivo puede
// montarlo?"— la responde `TRANSPORT_INSTALLABLE` (abajo).
const BUILT_ADAPTERS: AdapterKind[] = [
  'web-serial',
  'mock',
  'manual',
  'simulator',
  'spp-android',
  'ble-gatt',
  'mfi-ios',
];

// ¿Ese transporte se puede INSTANCIAR acá y ahora? Es la otra mitad de `BUILT_ADAPTERS`: aquella dice
// "este build trae el adapter", esto dice "este dispositivo puede montarlo". Son distintas y la diferencia
// es la que decide si una fila es una promesa (un APK sin el módulo nativo de BLE tiene el adapter
// compilado y no puede montarlo).
//
// ⚠️ Es un ESPEJO de los guards de `instantiateTransport` (en el provider), y espejo que puede driftar no
// prueba nada: `wiring.test.ts` cruza los dos archivos y exige que cada kind use LA MISMA función de
// prueba acá y allá. Un kind sin probe declarada cae en `false` (fail-closed: la fila dice "todavía no
// disponible" en vez de ofrecer un tap que deja al operario sin transporte).
const TRANSPORT_INSTALLABLE: Partial<Record<AdapterKind, () => boolean>> = {
  'spp-android': isSppNativeAvailable,
  'ble-gatt': isBleGattTransportAvailable,
  // MFi (F5): el probe incluye el GATE DE DATOS (la lista de protocolos del build), así que hoy devuelve
  // `false` en cualquier iPhone — y por eso la fila de un lector MFi no es accionable. La diferencia con
  // `available` es la de siempre: `BUILT_ADAPTERS` dice "este build trae el adapter", esto dice "acá y
  // ahora se puede montar".
  'mfi-ios': isMfiTransportAvailable,
  // Sin módulo nativo que chequear: `new WebSerialAdapter()` nunca falla (el diálogo del navegador vive en
  // el `connect()`, no en el instanciado).
  'web-serial': () => true,
};

function canInstantiateTransport(kind: AdapterKind): boolean {
  return TRANSPORT_INSTALLABLE[kind]?.() ?? false;
}

// El driver por defecto de la pantalla: el RS420 (RMV1.3), que es el bastón del cliente beta.
//
// ⚠️ NO es necesariamente el driver del transporte MONTADO. Desde el delta ios-ble-mfi el transporte
// puede ser `ble-gatt` (piso de iOS, o preferencia del bastón recordado en Android — RBM5.6), y ese
// adapter habla con OTRO driver: el que declare `ble-gatt` en el registro. Mostrar el binding del RS420
// mientras el transporte montado es el BLE hacía que la pantalla se contradijera sola —la card diciendo
// "Conectar bastón" y la fila diciendo "no se conecta en este dispositivo"—, que es el defecto de clase
// de esta pantalla. Ver `activeDriver` en el componente.
const DEFAULT_DRIVER = RS420_DRIVER;

interface ReadRow {
  eid: string;
  timestamp: number;
  seq: number;
  /** ¿Vino del simulador? → se marca "DEMO" (RMV4.6, integridad SENASA). */
  isDemo: boolean;
}

// Mapa CLAVE→ícono lucide. La CLAVE la elige la vista pura (`connectionStatusView().icon`), no esta
// pantalla: antes había acá un `statusIcon(status)` que derivaba el ícono del status CRUDO, el único
// elemento de la card que no pasaba por la vista pura — o sea el único que podía contradecir al label
// (bugfix 2026-07-29, nit del reviewer). Acá solo queda la traducción clave→componente, que es lo que
// NO puede vivir en el módulo puro (importar lucide en runtime rompe el loader de node:test).
const STATUS_ICONS: Record<StatusIconKey, typeof Bluetooth> = {
  bluetooth: Bluetooth,
  'bluetooth-connected': BluetoothConnected,
  'bluetooth-searching': BluetoothSearching,
  alert: TriangleAlert,
};

function toneColorToken(tone: 'idle' | 'progress' | 'success' | 'warning'): '$primary' | '$terracota' | '$textMuted' {
  if (tone === 'success' || tone === 'progress') return '$primary';
  if (tone === 'warning') return '$terracota';
  return '$textMuted';
}

/** Formatea la hora local de una lectura (es-AR, con segundos para ver la latencia en demo). */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export default function StickConnectionScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const api = useBleProviderApi();
  const status = useBleConnectionStatus();

  const transport = api?.transport ?? null;
  const hasTransport = transport != null;
  const isSimulator = transport?.kind === 'simulator';
  // ¿El transporte activo es el SPP nativo? Entonces la pantalla lista los devices REALES
  // emparejados del teléfono en vez de la fila única de "capacidad de build" (que es lo correcto en
  // web/iOS, donde no hay nada que enumerar). Se decide por el `kind` del transporte instanciado, NO
  // por `Platform.OS`: es la misma fuente que decide si el CTA existe.
  const isSpp = transport?.kind === 'spp-android';

  // El driver del que habla esta pantalla: el del TRANSPORTE MONTADO si lo expone, y el RS420 como
  // default (delta ios-ble-mfi). Sin esto, en iOS —donde el piso pasa a ser `ble-gatt`— la pantalla
  // mostraba el binding del RS420 (que en iOS es `null` → "no se conecta en este dispositivo") mientras
  // la card ofrecía "Conectar bastón" porque SÍ había transporte: la pantalla contradiciéndose sola.
  // `transport.driver` es el dato honesto — es el adapter el que sabe con qué aparato puede hablar
  // (RBM1.3) — y en web/mock es `undefined` o el RS420, así que ese camino no cambia.
  const activeDriver = transport?.driver ?? DEFAULT_DRIVER;

  // Binding del driver activo en ESTA plataforma (RMV2.3/2.4): elige adapter+transporte por la tabla
  // de prioridad + marca `available` según los adaptadores construidos Y, para MFi, según la lista de
  // protocolos que el build declara (RBM5.5 — entra inyectada para que el motor siga siendo puro). Sin
  // device real: refleja qué se puede conectar en este build/plataforma (web → web-serial available;
  // ios con el driver del BLE → ble-gatt available; ios con el RS420 → binding null).
  const binding: ReaderBinding | null = useMemo(
    () =>
      selectReaderBinding({
        platformOS: Platform.OS,
        driver: activeDriver,
        builtAdapters: BUILT_ADAPTERS,
        declaredEaProtocols: declaredEaProtocols(),
      }),
    [activeDriver],
  );
  // `hasTransport` va ADEMÁS del binding (bugfix 2026-07-29): el binding es capacidad de BUILD, el
  // transporte es "hay un adapter instanciado ahora". Tocar la fila llama `transport?.connect()` → sin
  // transporte sería una afordancia muerta (el mismo defecto que el chip del header).
  const rowView = useMemo(
    () => deviceRowView({ driver: activeDriver, binding, hasTransport }),
    [activeDriver, binding, hasTransport],
  );

  // Sin transporte instanciado, la vista pura ya devuelve `cta: 'none'` + copy honesto ("Bastón no
  // disponible / Todavía no se conecta en este dispositivo"). Antes el gate vivía acá (`&& hasTransport`
  // en `showStatusCta`): el CTA se ocultaba pero el copy seguía diciendo "Conectá el bastón para leer
  // caravanas…" — una promesa que en native no se podía cumplir. La decisión es una sola y es pura.
  // `autoConnectExhausted` (R6.4): el arranque intentó reconectar al bastón guardado y se le agotó el
  // tope. El estado quedó en 'off' —que es lo correcto para el chrome global, que se auto-oculta ahí—
  // pero acá, donde el operario vino A PROPÓSITO a ver qué pasa con el bastón, el copy tiene que decir
  // la verdad ("no lo encontramos") en vez de "conectá el bastón", que suena a que nunca se intentó. Se
  // lee en el render y no por suscripción porque el adapter lo setea ANTES de emitir el cambio de estado
  // que dispara este re-render.
  // `transportKind` (delta ios-ble-mfi, RBM5.14): en BLE GATT "conectar" es BUSCAR, y el copy genérico
  // ("Se apagó, quedó fuera de rango o cancelaste" + "Volver a conectar") no le dice al operario lo único
  // accionable. Sale del binding del driver activo, que es la misma fuente que decide la fila y las
  // instrucciones — así los tres no pueden contradecirse.
  const view = connectionStatusView(status, {
    hasTransport,
    autoConnectExhausted: transport?.autoConnectExhausted ?? false,
    transportKind: binding?.transportKind,
  });
  const StatusIcon = STATUS_ICONS[view.icon];
  const statusColorToken = toneColorToken(view.tone);
  const statusIconColor = getTokenValue(statusColorToken, 'color');

  const [reads, setReads] = useState<ReadRow[]>([]);
  const seqRef = useRef(0);
  const isSimulatorRef = useRef(isSimulator);
  isSimulatorRef.current = isSimulator;

  // ── PROPIEDAD EXCLUSIVA del bastón mientras esta pantalla está ENFOCADA (BENCH-3, banco §4.5) ──
  // Medido en device: cada bastonazo en /baston se consumía DOS VECES — entraba en la lista de
  // Lecturas de acá Y abría el `FindOrCreateOverlay` global ("¿Es uno de tus animales sin
  // caravana?") tapando la pantalla. Rompe la invariante de "un solo consumidor efectivo", y pega
  // justo en la pantalla que `context-multivendor.md` §3 define como la cara de la demo a los
  // fabricantes: tocás conectar, bastoneás, y un modal te tapa lo que estabas mostrando.
  //
  // Se cierra con el SCANNER ACOTADO (RCF.6) y no agregando 'baston' a `BLE_OWNED_ROUTES`. Los dos
  // mecanismos suprimen el overlay igual (y los dos cierran uno que estuviera abierto al entrar); la
  // diferencia que decide son dos cosas: (1) la propiedad la declara el DUEÑO y no una lista de
  // literales de rutas que vive en otro archivo —mover o renombrar la ruta rompería esa lista EN
  // SILENCIO, que es exactamente la clase de bug que este mismo pase vino a cerrar en `isRawStream`—;
  // y (2) el scanner acotado además FUERZA la escucha aunque algún ancestro haya prendido `busyMode`,
  // que es lo que necesita una pantalla cuyo único trabajo es mostrar lecturas en vivo.
  // `BLE_OWNED_ROUTES` sigue siendo lo correcto para rutas con su propio flujo completo (maniobra,
  // asignar-caravanas): ahí lo que se suprime es el overlay, no el listener de la pantalla dueña.
  //
  // `useFocusEffect` y NO `useEffect` (mismo motivo que `useHardwareBack`): las pantallas del stack
  // quedan MONTADAS al navegar encima. Con `useEffect`, entrar acá y que algo empuje otra pantalla
  // dejaría el overlay global suprimido en TODA la app hasta volver — un bastonazo en la pantalla de
  // arriba no abriría nada, en silencio. Acotado al foco, la propiedad dura exactamente lo que dura
  // la pantalla en primer plano.
  const acquireScopedScanner = useScopedScannerControls();
  useFocusEffect(useCallback(() => acquireScopedScanner(), [acquireScopedScanner]));

  // ── Y PROPIEDAD DEL LUGAR DEL INDICADOR GLOBAL, por el mismo criterio ──────────────────────────────
  // Esta pantalla muestra el estado en su card, con su CTA: el indicador global (RMV3.5) sería el MISMO
  // dato repetido. Hasta el 2026-08-06 eso lo resolvía un literal adentro del indicador
  // (`pathname === '/baston' → null`) — la lista de rutas que el párrafo de arriba explica por qué no
  // usamos, escrita en el otro archivo y a espaldas del dueño. Ahora la propiedad la declara la pantalla,
  // igual que el scanner: si la ruta se mueve o se renombra, esto sigue funcionando.
  useStickStatusSurface('screen-card');

  // Lista EN VIVO de lecturas confirmadas (confirmación pre-commit del contrato, RMV4.8): el provider
  // entrega el EID YA validado + des-duplicado por `subscribeTagRead`. Marcamos "DEMO" las que vienen
  // del simulador (RMV4.6). Es la confirmación visible durante la demo (el FindOrCreateOverlay global
  // de spec 09 es la confirmación de producción; acá no lo tocamos).
  useEffect(() => {
    if (!api) return;
    const unsub = api.subscribeTagRead((eid) => {
      seqRef.current += 1;
      setReads((prev) => [
        { eid, timestamp: Date.now(), seq: seqRef.current, isDemo: isSimulatorRef.current },
        ...prev,
      ]);
    });
    return unsub;
  }, [api]);

  // Elegir el device reconocido-conectable (RMV3.3): conectamos. `available:false` / no reconocido NO
  // llega acá (la fila no es accionable) → nunca intentamos conectar algo que fallaría (RMV3.7/3.8).
  //
  // ── YA NO PERSISTE NADA (delta ios-ble-mfi, misma lección que MEDIUM-2 del Gate 2) ────────────────
  // Antes hacía `writeRememberedDevice(binding.driver.vendorId)`: un **vendorId guardado como si fuera un
  // id de device**, "marcador de reconexión" de cuando ningún adapter real leía ese valor. Con el
  // transporte BLE eso pasa a ser un bug vivo: `connect()` usa el id recordado **en vez de escanear**
  // (`adapter-ble-gatt.ts`: `target = deviceId ?? readRemembered()`), así que un `'esp32-gatt-emu'`
  // guardado ahí manda a `connectToDevice()` contra un id que no existe → nunca vuelve a encontrar el
  // bastón, y el CTA de "Olvidar" solo se renderiza en el camino SPP. El único que puede persistir es el
  // adapter, en el punto donde el bastón contestó (y ahí también escribe el `adapterKind`, RBM5.6).
  const onChooseDevice = useCallback(() => {
    if (!binding || !binding.available) return;
    void transport?.connect().catch(() => undefined);
  }, [binding, transport]);

  // ── LOS OTROS TRANSPORTES QUE ESTA PLATAFORMA PUEDE MONTAR (🟠-2 del review de F4, RBM5.14) ────────
  // Sin esto, en **Android** el transporte BLE era inalcanzable en producción: se monta solo si la
  // preferencia del bastón recordado lo dice, y esa preferencia solo la escribe el adapter BLE al conectar
  // — o sea que había que haber conectado por BLE para poder conectar por BLE. Es el problema que RBM5.6
  // declara resuelto y el que dejaba al banco de F6 sin camino real en la plataforma del productor.
  //
  // La lista es la de los transportes alcanzables que NO son el montado, y sale de la capa pura: qué
  // lector le corresponde a cada uno (el binding, igual que el resto de las filas) y si elegirlo haría
  // algo (derivado de `selectTransportAdapter` **con el modo real**, no de una segunda tabla). En web con
  // `mode:'auto'` da vacío (el único transporte de web es el montado) y en `mock`/`demo`/`manual` da vacío
  // SIEMPRE (esos modos ignoran la preferencia, RBM5.9) → cero filas nuevas para las ~70 specs E2E.
  const choices = useMemo(
    () =>
      transportChoices({
        platformOS: Platform.OS,
        // El MODO del provider, no un `'auto'` literal (bug medido por la E2E del capture): en `mock` —donde
        // corren las ~70 specs— el kind montado NO es el piso de la plataforma, así que con `'auto'` el piso
        // aparecía como "alternativa" y la pantalla mostraba DOS filas idénticas. Sin provider,
        // `'manual'`: nadie a quien pedirle montar → la derivación no ofrece nada (fail-closed).
        mode: api?.providerMode ?? 'manual',
        mountedKind: transport?.kind,
        builtAdapters: BUILT_ADAPTERS,
        declaredEaProtocols: declaredEaProtocols(),
        canInstantiate: canInstantiateTransport,
        // El registro entra desde acá y no por un default del módulo puro: `adapter-selection.ts` es una
        // superficie CIEGA AL FABRICANTE (RBM1.7) y nombrar ahí el registro abre la puerta al
        // `DRIVER_REGISTRY[0].frameParser` que el review de F1 falsificó. Esta pantalla sí conoce lectores
        // (muestra sus nombres), así que es su lugar.
        registry: DRIVER_REGISTRY,
      }),
    [transport, api?.providerMode],
  );

  // Elegir OTRO transporte: lo monta el provider y lo conecta (gesto → trigger `operator`). No se persiste
  // nada acá — el adapter recuerda el device que contestó, con su `adapterKind` (RBM5.6). Es la misma
  // lección que MEDIUM-2: se recuerda lo que funcionó, no lo que se intentó.
  const onChooseTransport = useCallback(
    (kind: AdapterKind) => {
      api?.chooseTransport(kind);
    },
    [api],
  );

  // ── Lista de devices EMPAREJADOS del teléfono (camino SPP-Android, RMV3.2) ──────────────────
  // No se carga sola al entrar: la primera llamada dispara el diálogo de permiso del SO, y un
  // permiso pedido sin que el operario haya pedido nada es exactamente cómo se gana un "denegar
  // para siempre". Se carga con gesto explícito.
  const [pairedState, setPairedState] = useState<PairedListState>('idle');
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const pairedView = pairedDevicesView(pairedState);

  // ¿Hay un bastón guardado? Se lee para decidir si el CTA "Olvidar" existe (R6.6). Sin esto el botón
  // sería una afordancia MUERTA en la primera instalación —tocar y que no pase nada— que es exactamente
  // la clase de defecto que esta feature viene arreglando desde el chip. Se re-lee cuando cambia el
  // estado de conexión porque el adapter persiste la MAC al llegar a `'connected'`: sin esa dependencia,
  // el operario conectaría por primera vez y el botón no aparecería hasta volver a entrar.
  const [hasRemembered, setHasRemembered] = useState(false);
  useEffect(() => {
    let active = true;
    void readRememberedDevice().then((remembered) => {
      // El registro ya viene validado (`parseRememberedValue` devuelve `null` si no hay un `deviceId`
      // usable), así que "hay bastón guardado" es exactamente "hay registro".
      if (active) setHasRemembered(remembered != null);
    });
    return () => {
      active = false;
    };
  }, [status]);

  // GUARD DE RE-ENTRADA (🟠-4 del review). Sin él, `loadPaired` se podía disparar dos veces (el CTA
  // de la lista y el CTA de estado, que también la carga) y dejar dos cargas pisándose. Va ADEMÁS
  // del coalesce de `listPairedSppDevices` —que es el que impide de verdad que dos pedidos solapados
  // dejen huérfana la promesa del diálogo de Bluetooth (🔴-1)—: acá lo que se protege es la máquina
  // de estados de la pantalla. El otro medio del 🟠-4 (que la promesa SIEMPRE se asiente) vive en el
  // service: todos sus awaits del puente tienen presupuesto y caen a `{ ok:false }`, así que
  // `pairedState` no puede quedar clavado en 'loading' sin CTA de salida.
  const loadingPairedRef = useRef(false);

  const loadPaired = useCallback(async () => {
    if (loadingPairedRef.current) return;
    loadingPairedRef.current = true;
    setPairedState('loading');
    try {
      const result = await listPairedSppDevices();
      if (!result.ok) {
        setPairedDevices([]);
        setPairedState(result.reason);
        return;
      }
      setPairedDevices(result.devices);
      setPairedState(result.devices.length > 0 ? 'ok' : 'empty');
    } catch {
      // El service no tira (todo await acotado + try/catch), pero si algún día lo hiciera, la
      // pantalla NO puede quedarse en 'loading' sin CTA: 'error' sí ofrece "Reintentar".
      setPairedDevices([]);
      setPairedState('error');
    } finally {
      loadingPairedRef.current = false;
    }
  }, []);

  const onLoadPaired = useCallback(() => {
    void loadPaired();
  }, [loadPaired]);

  // Elegir un device REAL de la lista: se conecta a ESA MAC (no al vendorId, que era un marcador
  // mientras no había adapter real).
  //
  // ── NO se persiste acá (MEDIUM-2 del Gate 2, 2026-07-30) ─────────────────────────────────────
  // Antes esta función hacía `writeRememberedDevice(device.id)` ANTES de saber si conectaba, y el
  // adapter lo persiste otra vez al conectar (`:852`): la escritura de acá era redundante **y** peor,
  // porque recordaba lo que nunca funcionó. La fila deja tocar CUALQUIER emparejado a propósito
  // (`allowUnrecognized: true`, porque el nombre real del RS420 es una hipótesis), así que tocar unos
  // auriculares por error los dejaba guardados como "el bastón" — y desde R6.4 eso significa que la app
  // abre un RFCOMM contra ellos, **sin gesto**, en cada apertura. Ahora solo se recuerda lo que llegó a
  // `'connected'`: el que decide es el adapter, en el punto donde el bastón contestó.
  const onChoosePaired = useCallback(
    (device: PairedDevice) => {
      void transport?.connect(device.id).catch(() => undefined);
    },
    [transport],
  );

  // R6.6 — OLVIDAR el bastón guardado. El requisito existía desde el core ("una acción para cambiar y
  // otra para olvidar el bastón guardado, limpiando el identificador persistido") y no estaba cableado:
  // `forgetRememberedDevice` no tenía UN SOLO call site. Mientras la MAC era un dato inerte era una
  // ausencia dormida; desde R6.4 la app se conecta sola contra ella en cada apertura, así que "no quiero
  // más ese bastón" tiene que ser accionable. Desconecta primero (si no, el link vivo lo volvería a
  // persistir al reconectar) y después limpia.
  const onForgetRemembered = useCallback(() => {
    void (async () => {
      await transport?.disconnect().catch(() => undefined);
      await forgetRememberedDevice();
      setHasRemembered(false);
      setPairedState('idle');
      setPairedDevices([]);
    })();
  }, [transport]);

  const onClearReads = useCallback(() => setReads([]), []);

  // ── Preferencia de SONIDO de lectura (R4.3) ────────────────────────────────────────────────
  // Hasta el 2026-08-06 `writeBeepEnabled` no tenía UN SOLO call site: la preferencia existía en el
  // código, se persistía, se leía en cada lectura… y no había forma de tocarla. R4.3 quedaba incumplido
  // por ausencia de UI (🟡-11 del barrido de edge cases).
  //
  // Vive ACÁ, en `/baston`, y no en "Más": es la casa del bastón (se llega por la fila "Dispositivos"),
  // es donde el operario ya está mirando cuando le molesta o no le alcanza el aviso, y es la única
  // pantalla donde puede PROBARLO en el acto — bastonea, escucha, y la lista de Lecturas de abajo le
  // confirma que la lectura entró aunque el sonido esté apagado. En "Más" sería un ajuste huérfano al
  // lado de "Eliminar cuenta".
  //
  // El valor inicial sale del CACHÉ (síncrono, ya calentado por el provider al montar) y se re-lee del
  // storage por si esta pantalla fue lo primero que se abrió. El write es OPTIMISTA en el lugar
  // (docs/conventions §UI): el switch se mueve YA y la persistencia va detrás best-effort.
  const [beepEnabled, setBeepEnabled] = useState(cachedBeepEnabled);
  useEffect(() => {
    let active = true;
    void readBeepEnabled().then((value) => {
      if (active) setBeepEnabled(value);
    });
    return () => {
      active = false;
    };
  }, []);
  const onToggleBeep = useCallback(() => {
    setBeepEnabled((prev) => {
      const next = !prev;
      void writeBeepEnabled(next);
      return next;
    });
  }, []);
  const beepView = feedbackPrefView(beepEnabled);

  // CTA de estado: conectar / reintentar / desconectar (gesto de usuario; web-serial exige requestPort).
  // En el camino SPP, "conectar" primero **carga la lista de emparejados** y recién después intenta el
  // device recordado, en ese orden y SECUENCIAL. Dos motivos: (a) sin bastón recordado —la primera
  // vez— un `connect()` pelado no tiene a qué conectarse y el CTA quedaría muerto, así que además de
  // intentarlo le deja al operario la lista para elegir; (b) secuencial y no en paralelo porque
  // `PermissionsAndroid` rechaza dos pedidos simultáneos (la segunda llamada ya encuentra el permiso
  // concedido y no vuelve a preguntar).
  const onStatusCta = useCallback(() => {
    if (!transport) return;
    if (view.cta === 'disconnect') {
      void transport.disconnect().catch(() => undefined);
      return;
    }
    if (isSpp) {
      void loadPaired().then(() => transport.connect().catch(() => undefined));
      return;
    }
    void transport.connect().catch(() => undefined);
  }, [transport, view.cta, isSpp, loadPaired]);

  // `cta: 'none'` ya cubre el caso sin transporte (lo garantiza `connectionStatusView`) además de los
  // estados en progreso (connecting/scanning). No se re-chequea `hasTransport` acá: una sola fuente.
  const showStatusCta = view.cta !== 'none';
  const muted = getTokenValue('$textMuted', 'color');

  return (
    <YStack flex={1} width="100%" backgroundColor="$bg">
      {/* Header con back (patrón export-sigsa). Título $8 con lineHeight matcheado (descendentes). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          {/* `backOr` y no `router.back()` pelado: con el stack vacío (deep-link a /baston, cold-start,
              web-refresh, hot-reload) el back es un no-op silencioso y el usuario queda trabado. El
              fallback es "Más", que desde esta unidad es el origen REAL de la pantalla (ADR-018). Era
              el último back() pelado de la app. */}
          <View
            hitSlop={8}
            onPress={() => backOr(router, '/(tabs)/mas')}
            pressStyle={{ opacity: 0.6 }}
            {...buttonA11y(Platform.OS, { label: 'Volver' })}
          >
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </View>
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            Bastón
          </Text>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$8', 'space'),
          gap: getTokenValue('$4', 'space'),
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Estado de conexión + CTA (RMV3.4) ── */}
        <Card gap="$3">
          <XStack alignItems="center" gap="$3">
            <StatusIcon size={28} color={statusIconColor} strokeWidth={2.25} />
            <YStack flex={1} minWidth={0} gap="$1">
              <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color={statusColorToken}>
                {view.label}
              </Text>
              <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
                {view.hint}
              </Text>
            </YStack>
          </XStack>
          {showStatusCta && view.ctaLabel ? (
            <Button
              testID="stick-status-cta"
              variant={view.cta === 'disconnect' ? 'secondary' : 'primary'}
              fullWidth
              onPress={onStatusCta}
            >
              {view.ctaLabel}
            </Button>
          ) : null}
        </Card>

        {/* ── Controles de simulación (RMV4.5/4.6): SOLO bajo isDemoMode() (el componente se auto-guarda) ── */}
        <DemoControls />

        {/* ── Dispositivos (RMV3.2). En SPP-Android: la lista REAL de emparejados del teléfono.
              En web/iOS: la fila única de capacidad de build, como hasta ahora.
              + (delta ios-ble-mfi, 🟠-2) las filas de los OTROS transportes que esta plataforma puede montar,
              afuera de las dos ramas: en Android es lo único que hace alcanzable el BLE (y la vuelta al SPP). ── */}
        <YStack gap="$2">
          {/* `testID` y no el texto como ancla en la E2E: desde el 2026-08-06 el tab "Más" también tiene
              una sección "Dispositivos", y ese tab queda MONTADO detrás de esta pantalla (Stack) → un
              `getByText('Dispositivos')` matchea DOS y rompe en strict-mode. */}
          <Text testID="stick-devices-section" fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
            Dispositivos
          </Text>

          {isSpp ? (
            <>
              {pairedDevices.map((d) => {
                // El binding es del DRIVER, no del device: solo se pasa si ESTE device matcheó un
                // driver. Pasarlo siempre haría que toda fila —auriculares incluidos— se titulara
                // "Allflex RS420" (la primera rama de `deviceRowView` usa `binding.driver`).
                const deviceDriver = findDriverForDevice({ id: d.id, name: d.name, channel: 'classic-paired' });
                return (
                  <StickDeviceRow
                    key={d.id}
                    view={deviceRowView({
                      driver: deviceDriver,
                      binding: deviceDriver ? binding : null,
                      deviceName: d.name,
                      hasTransport,
                      // El nombre Bluetooth real del RS420 no está verificado: dejamos PROBAR
                      // cualquier emparejado en vez de esconder el bastón detrás de una regex nuestra.
                      allowUnrecognized: true,
                    })}
                    onPress={() => onChoosePaired(d)}
                  />
                );
              })}
              <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
                {pairedView.hint}
              </Text>
              {pairedView.ctaLabel ? (
                <Button testID="stick-paired-cta" variant="secondary" fullWidth onPress={onLoadPaired}>
                  {pairedView.ctaLabel}
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <StickDeviceRow view={rowView} onPress={rowView.actionable ? onChooseDevice : undefined} />
              <TransportInstructions binding={binding} hasTransport={hasTransport} />
            </>
          )}

          {/* ── OTROS TRANSPORTES ALCANZABLES (🟠-2 del review de F4, RBM5.14/RBM5.6) ──────────────────
              Va AFUERA de las dos ramas del ternario, igual que el CTA de olvidar y por un motivo emparentado:
              lo que decide qué transporte se monta es el bastón recordado, así que la forma de ELEGIR otro no
              puede vivir adentro de la rama del que ya está montado (ahí es donde nunca se alcanza).

              En Android son las filas que destraban el BLE: la de arriba lista los emparejados del SPP y esta
              ofrece el lector BLE (hoy, el único que el registro declara: el emulador del banco — RBM5.11 no
              deja inventar el driver del HR5 v3, y el día que Gallagher entregue su doc esta MISMA fila pasa a
              decir su nombre, sin código nuevo). Tocarla monta ese transporte y conecta; al conectar, el
              adapter persiste el device que contestó con su `adapterKind` y el próximo arranque lo monta solo.
              En web la lista es vacía (el único transporte de web es el montado) y en iOS también (el SPP no
              existe ahí, RBM5.3, y MFi está gateado hasta F5). */}
          {choices.map((choice) => (
            <TransportChoiceRows key={choice.adapterKind} choice={choice} onChoose={onChooseTransport} />
          ))}

          {/* ── R6.6 — OLVIDAR el bastón guardado. VA AFUERA DE LAS DOS RAMAS (delta ios-ble-mfi) ──────
              Cableado el 2026-07-30 (MEDIUM-2 del Gate 2): el requisito existía y `forgetRememberedDevice`
              no tenía un solo call site. Desde R6.4 la app se conecta sola contra esa MAC en cada
              apertura, así que "no quiero más ese bastón" —lo vendí, era de otro, toqué los auriculares
              por error— tiene que ser accionable.

              Estaba ADENTRO de la rama `isSpp`, y con el delta eso se volvió una TRAMPA que se cierra
              sola: el registro del bastón recordado ahora decide QUÉ TRANSPORTE se monta (RBM5.6), así que
              un teléfono que alguna vez conectó por BLE monta `ble-gatt` para siempre → `isSpp` es false →
              el único botón que puede borrar esa preferencia queda ESCONDIDO por la preferencia misma, y
              el RS420 por SPP se vuelve inalcanzable. (El design §6.2 ofrecía como salida "elegir otro
              bastón en la pantalla, que reescribe la preferencia", y en BLE **no hay lista de devices** que
              elegir: el as-built del adapter escanea y se conecta solo — RBM9.6 no deja tocar la interfaz
              del `StickAdapter` para exponer el escaneo. Desde el fix-loop del review hay una salida MÁS
              —elegir otro TRANSPORTE en las filas de arriba, que en Android devuelve al RS420—, pero este
              CTA sigue siendo el único que BORRA el registro, así que su ubicación sigue importando lo
              mismo.) `onForgetRemembered` ya era agnóstico del transporte (disconnect → forget → reset),
              así que la corrección es de UBICACIÓN. */}
          {hasRemembered ? (
            <Button testID="stick-forget-cta" variant="secondary" fullWidth onPress={onForgetRemembered}>
              Olvidar el bastón guardado
            </Button>
          ) : null}
        </YStack>

        {/* ── Lecturas en vivo (confirmación pre-commit, RMV4.8; marca DEMO, RMV4.6) ── */}
        <Card gap="$3">
          <XStack alignItems="center" justifyContent="space-between">
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary">
              Lecturas {reads.length > 0 ? `(${reads.length})` : ''}
            </Text>
            {reads.length > 0 ? (
              <Button variant="secondary" onPress={onClearReads}>
                Limpiar
              </Button>
            ) : null}
          </XStack>
          {reads.length === 0 ? (
            <XStack alignItems="center" gap="$2" paddingVertical="$2">
              <Radio size={18} color={muted} strokeWidth={2} />
              <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
                {readsEmptyHint(hasTransport)}
              </Text>
            </XStack>
          ) : (
            <YStack gap="$2">
              {reads.map((r, i) => (
                <ReadRowView key={r.seq} eid={r.eid} time={formatTime(r.timestamp)} latest={i === 0} isDemo={r.isDemo} />
              ))}
            </YStack>
          )}
        </Card>

        {/* ── Aviso de lectura: la preferencia de SONIDO (R4.3). Va después de "Lecturas" a propósito:
              es un ajuste, no un paso del flujo de conexión, y el operario lo toca DESPUÉS de escuchar
              cómo suena (la lista de arriba es la prueba de que la lectura entra igual con el sonido
              apagado). ── */}
        <Card gap="$3">
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$textPrimary">
            {beepView.title}
          </Text>
          {/* Fila entera tappable (target ≥ $touchMin, Fitts): con guante nadie acierta la pista de 48 dp.
              Toggle tokenizado con la MISMA anatomía que FieldTemplateToggleList (pista $toggleTrack /
              knob $toggleKnob) — el repo no tiene un primitivo Switch en la base de Tamagui. */}
          <XStack
            testID="stick-beep-toggle"
            width="100%"
            alignItems="center"
            gap="$3"
            minHeight="$touchMin"
            paddingVertical="$2"
            pressStyle={{ opacity: 0.6 }}
            onPress={onToggleBeep}
            {...switchA11y(Platform.OS, { label: beepView.label, checked: beepEnabled, disabled: false })}
          >
            {/* El ícono va PEGADO al título y no al costado de todo el bloque: por proximidad (Gestalt)
                es lo que hace que se lea como "esto es el sonido" y no como una viñeta del sub-copy.
                Centrado sobre el bloque entero quedaba a la altura del renglón 2 del hint, colgado de la
                frase equivocada. Además el par Volume2/VolumeX es el estado LEGIBLE SIN LEER — el switch
                dice on/off, el ícono dice de QUÉ. */}
            <YStack flex={1} minWidth={0} gap="$1">
              <XStack alignItems="center" gap="$2">
                {beepEnabled ? (
                  <Volume2 size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$primary', 'color')} strokeWidth={2.25} />
                ) : (
                  <VolumeX size={getTokenValue('$navIcon', 'size')} color={muted} strokeWidth={2.25} />
                )}
                <Text
                  flexShrink={1}
                  minWidth={0}
                  fontFamily="$body"
                  fontSize="$4"
                  lineHeight="$4"
                  fontWeight="600"
                  color="$textPrimary"
                >
                  {beepView.label}
                </Text>
              </XStack>
              <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="400" color="$textMuted">
                {beepView.hint}
              </Text>
            </YStack>
            <View
              width="$toggleTrack"
              height="$toggleThumb"
              borderRadius="$pill"
              backgroundColor={beepEnabled ? '$primary' : '$divider'}
              justifyContent="center"
              paddingHorizontal="$1"
              flexShrink={0}
            >
              <View
                width="$toggleKnob"
                height="$toggleKnob"
                borderRadius="$pill"
                backgroundColor="$white"
                alignSelf={beepEnabled ? 'flex-end' : 'flex-start'}
              />
            </View>
          </XStack>
          {/* `$textMuted` y NO `$textFaint` (veto de diseño, 2026-08-06). `$textFaint` está declarado en
              el config como **AA-large 4,03**: válido solo para ≥18 px regular o ≥14 px bold, y esto es
              $3 = 13 px regular, donde WCAG AA pide 4,5:1. La entrada del backlog del 29/07 lo anticipó
              ("varios de esos usos son texto secundario prescindible, pero otros llevan información"):
              ESTE lleva información — es el ÚNICO lugar donde el peón aprende qué significa el aviso
              distinto, en un producto que se usa a pleno sol. Mismo criterio que `asignar-caravanas`.
              La jerarquía contra el sub-copy la da la SEPARACIÓN (hairline + zona propia, Gestalt) y no
              el contraste: bajarle el contraste a la única explicación del vocabulario sería susurrar
              justo lo que hay que enseñar. */}
          <View height={1} backgroundColor="$divider" />
          <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="400" color="$textMuted">
            {beepView.note}
          </Text>
        </Card>

        {/* ── Manual-first: SIEMPRE disponible, no bloqueante (RMV3.6) ── */}
        <InfoNote>
          ¿Sin bastón? Podés cargar las caravanas a mano desde Animales o «Asignar caravanas en masa».
        </InfoNote>
      </ScrollView>
    </YStack>
  );
}

// ─── Fila + instrucción de un transporte ELEGIBLE (🟠-2 del review de F4, RBM5.14) ───────────────────
// Misma anatomía que la rama no-SPP de la sección (fila + instrucción del transporte) y con las MISMAS
// vistas puras: la fila sale de `deviceRowView` y el copy de `transportInstructionsView`, así que un
// transporte elegible no puede describirse distinto que el montado.
//
// `hasTransport` recibe `choice.installable` a propósito: la pregunta que esas vistas hacen es "¿tocar esto
// va a hacer algo de verdad?", y para un transporte que todavía no está montado la respuesta es "¿este
// dispositivo puede montarlo?". Sin eso, un APK sin el módulo nativo de BLE ofrecería "Tocá para conectar"
// y el tap dejaría al operario sin transporte (la afordancia muerta del bugfix del 2026-07-29).
function TransportChoiceRows({
  choice,
  onChoose,
}: {
  choice: TransportChoice;
  onChoose: (kind: AdapterKind) => void;
}) {
  const view = deviceRowView({
    driver: choice.driver,
    binding: choice.binding,
    hasTransport: choice.installable,
  });
  return (
    <>
      <StickDeviceRow
        view={view}
        onPress={view.actionable ? () => onChoose(choice.adapterKind) : undefined}
      />
      <TransportInstructions binding={choice.binding} hasTransport={choice.installable} />
    </>
  );
}

// ─── Instrucciones específicas por transporte del binding (RMV3.2/3.7 → RBM5.14) ─────────────────────
// El COPY y la decisión de QUÉ instrucción corresponde viven en la vista pura
// (`transportInstructionsView`, testeada en node:test); acá solo queda la traducción clave→ícono lucide y
// el layout — que es lo que NO puede vivir en el módulo puro (importar lucide rompe su loader). Es el
// mismo movimiento que el del ícono del estado (bugfix 2026-07-29): mientras el copy vivía en este JSX,
// el `if` que lo elegía era la única decisión de presentación del bastón sin un solo test, y este delta le
// agregaba dos ramas más (BLE y MFi, la de MFi dependiendo del `unavailableReason`).
const INSTRUCTION_ICONS: Record<InstructionIconKey, typeof Bluetooth> = {
  keyboard: Keyboard,
  bluetooth: Bluetooth,
  'bluetooth-searching': BluetoothSearching,
};

function TransportInstructions({
  binding,
  hasTransport,
}: {
  binding: ReaderBinding | null;
  hasTransport: boolean;
}) {
  const view = transportInstructionsView({ binding, hasTransport });

  // Sin título → nota simple (el caso de las cuatro ramas que ya eran `InfoNote`).
  if (view.title === null) return <InfoNote>{view.body}</InfoNote>;

  const Icon = view.icon ? INSTRUCTION_ICONS[view.icon] : null;
  return (
    <Card gap="$3" borderWidth={1} borderColor="$divider">
      <XStack alignItems="center" gap="$2">
        {Icon ? (
          <Icon size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2.25} />
        ) : null}
        {/* `lineHeight` matcheado al `fontSize` (bug de clase del repo: los descendentes g/q/p/j/y se
            recortan si no coincide — y este título tiene una 'j' en "Emparejalo"). */}
        <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary">
          {view.title}
        </Text>
      </XStack>
      <Text fontFamily="$body" fontSize="$3" lineHeight="$4" fontWeight="400" color="$textMuted">
        {view.body}
      </Text>
    </Card>
  );
}

// ─── Fila de una lectura confirmada (con badge "DEMO" si vino del simulador, RMV4.6) ─────────────────
function ReadRowView({
  eid,
  time,
  latest,
  isDemo,
}: {
  eid: string;
  time: string;
  latest: boolean;
  isDemo: boolean;
}) {
  const badge = readingBadge(isDemo);
  return (
    <XStack
      alignItems="center"
      justifyContent="space-between"
      gap="$3"
      backgroundColor={latest ? '$greenLight' : '$bg'}
      borderWidth={1}
      borderColor={latest ? '$primary' : '$divider'}
      borderRadius="$card"
      paddingHorizontal="$3"
      paddingVertical="$3"
      {...labelA11y(Platform.OS, `Caravana ${eid}${badge ? ' DEMO' : ''}`)}
    >
      <XStack flex={1} minWidth={0} alignItems="center" gap="$2">
        <Text
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight={latest ? '700' : '500'}
          color="$textPrimary"
          letterSpacing={1}
          numberOfLines={1}
        >
          {eid}
        </Text>
        {badge ? (
          <XStack alignItems="center" backgroundColor="$primary" borderRadius="$pill" paddingHorizontal="$2" paddingVertical="$1" flexShrink={0}>
            <Text fontFamily="$body" fontSize="$1" lineHeight="$1" fontWeight="700" color="$white" letterSpacing={1}>
              {badge}
            </Text>
          </XStack>
        ) : null}
      </XStack>
      <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="400" color="$textMuted" flexShrink={0}>
        {time}
      </Text>
    </XStack>
  );
}
