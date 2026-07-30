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
import { Bluetooth, BluetoothConnected, BluetoothSearching, ChevronLeft, Keyboard, Radio, TriangleAlert } from 'lucide-react-native';

import { Button, Card, InfoNote } from '@/components';
import { useBleProviderApi } from '@/services/ble/BleStickListenerProvider';
import { useScopedScannerControls } from '@/services/ble/stick';
import { useBleConnectionStatus } from '@/services/ble/connection-status';
import { selectReaderBinding, type ReaderBinding } from '@/services/ble/selection-priority';
import type { AdapterKind } from '@/services/ble/adapter-selection';
import { RS420_DRIVER } from '@/services/ble/driver-rs420';
import { findDriverForDevice } from '@/services/ble/driver-registry';
import { listPairedSppDevices } from '@/services/ble/adapter-spp-android';
import type { PairedDevice } from '@/services/ble/spp-protocol';
import {
  forgetRememberedDevice,
  readRememberedDevice,
  writeRememberedDevice,
} from '@/services/ble/remembered-device';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import {
  connectionStatusView,
  deviceRowView,
  pairedDevicesView,
  readingBadge,
  readsEmptyHint,
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
const BUILT_ADAPTERS: AdapterKind[] = ['web-serial', 'mock', 'manual', 'simulator', 'spp-android'];

// El driver primario mostrado en la pantalla (el registry hoy tiene uno: el RS420, RMV1.3). Con más
// fabricantes, esta pantalla listaría un binding por driver reconocido; el patrón es idéntico.
const PRIMARY_DRIVER = RS420_DRIVER;

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

  // Binding del driver primario en ESTA plataforma (RMV2.3/2.4): elige adapter+transporte por la tabla
  // de prioridad + marca `available` según los adaptadores construidos. Puro, sin device real: refleja
  // qué se puede conectar en este build/plataforma (web → web-serial available; android → spp-android
  // NO construido → available:false; ios → RS420 no alcanzable → binding null).
  const binding: ReaderBinding | null = useMemo(
    () => selectReaderBinding({ platformOS: Platform.OS, driver: PRIMARY_DRIVER, builtAdapters: BUILT_ADAPTERS }),
    [],
  );
  // `hasTransport` va ADEMÁS del binding (bugfix 2026-07-29): el binding es capacidad de BUILD, el
  // transporte es "hay un adapter instanciado ahora". Tocar la fila llama `transport?.connect()` → sin
  // transporte sería una afordancia muerta (el mismo defecto que el chip del header).
  const rowView = useMemo(
    () => deviceRowView({ driver: PRIMARY_DRIVER, binding, hasTransport }),
    [binding, hasTransport],
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
  const view = connectionStatusView(status, {
    hasTransport,
    autoConnectExhausted: transport?.autoConnectExhausted ?? false,
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

  // Elegir el device reconocido-conectable (RMV3.3): lo persistimos como el bastón recordado + conectamos.
  // `available:false` / no reconocido NO llega acá (la fila no es accionable) → nunca intentamos conectar
  // algo que fallaría (RMV3.7/3.8). El id recordado es el vendorId del driver (marcador de reconexión;
  // cuando el adapter SPP real aterrice, recordará la MAC del device elegido de la lista).
  const onChooseDevice = useCallback(() => {
    if (!binding || !binding.available) return;
    void writeRememberedDevice(binding.driver.vendorId);
    void transport?.connect().catch(() => undefined);
  }, [binding, transport]);

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
    void readRememberedDevice().then((id) => {
      if (active) setHasRemembered(id != null && id.length > 0);
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
          <View
            hitSlop={8}
            onPress={() => router.back()}
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
              En web/iOS: la fila única de capacidad de build, como hasta ahora. ── */}
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
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
              {/* R6.6 — OLVIDAR el bastón guardado. Cableado el 2026-07-30 (MEDIUM-2 del Gate 2): el
                  requisito existía y `forgetRememberedDevice` no tenía un solo call site. Desde R6.4 la
                  app se conecta sola contra esa MAC en cada apertura, así que "no quiero más ese bastón"
                  —lo vendí, era de otro, toqué los auriculares por error— tiene que ser accionable, y no
                  solo por prolijidad: mientras la MAC esté guardada, cada arranque abre un RFCOMM contra
                  ella sin que nadie lo pida. */}
              {hasRemembered ? (
                <Button testID="stick-forget-cta" variant="secondary" fullWidth onPress={onForgetRemembered}>
                  Olvidar el bastón guardado
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <StickDeviceRow view={rowView} onPress={rowView.actionable ? onChooseDevice : undefined} />
              <TransportInstructions binding={binding} hasTransport={hasTransport} />
            </>
          )}
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

        {/* ── Manual-first: SIEMPRE disponible, no bloqueante (RMV3.6) ── */}
        <InfoNote>
          ¿Sin bastón? Podés cargar las caravanas a mano desde Animales o «Asignar caravanas en masa».
        </InfoNote>
      </ScrollView>
    </YStack>
  );
}

// ─── Instrucciones específicas por adaptador del binding (RMV3.2/3.7) ────────────────────────────────
// web-serial (serial) → elegir el puerto COM en el diálogo del navegador; spp → emparejar por Bluetooth;
// ble-hid → emparejar como teclado del SO + campo de scan (GATED); available:false (o SIN transporte
// instanciado) → no disponible + manual; sin binding → no alcanzable en este dispositivo + manual.
// Todas NO bloqueantes.
function TransportInstructions({
  binding,
  hasTransport,
}: {
  binding: ReaderBinding | null;
  hasTransport: boolean;
}) {
  // Sin binding: reconocido pero sin transporte alcanzable en esta plataforma (o piso manual). La fila
  // ya lo dice; agregamos la salida manual explícita.
  if (!binding) {
    return (
      <InfoNote>
        En este dispositivo el bastón no se conecta directo. Cargá las caravanas a mano.
      </InfoNote>
    );
  }

  // Reconocido pero el adapter no está construido en este build (RMV3.7) o no hay transporte instanciado
  // (bugfix 2026-07-29): NO se intenta conectar, y NO se dan instrucciones de un pairing imposible.
  if (!binding.available || !hasTransport) {
    return (
      <InfoNote>
        Este bastón todavía no se conecta en esta versión de la app. Mientras tanto, cargá las
        caravanas a mano.
      </InfoNote>
    );
  }

  // Emparejamiento como TECLADO del SO + campo de scan (GATED, RMV3.2). Solo aplica a drivers HID (el
  // RS420 no declara HID → esta rama no se renderiza para él; queda lista para un lector HID futuro).
  if (binding.transportKind === 'ble-hid') {
    return (
      <Card gap="$3" borderWidth={1} borderColor="$divider">
        <XStack alignItems="center" gap="$2">
          <Keyboard size={getTokenValue('$navIcon', 'size')} color={getTokenValue('$textMuted', 'color')} strokeWidth={2.25} />
          <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary">
            Emparejalo como teclado Bluetooth
          </Text>
        </XStack>
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="400" color="$textMuted">
          Andá a los ajustes de Bluetooth del sistema, emparejá el lector como un teclado y volvé. La
          lectura por teclado llega en una próxima versión.
        </Text>
      </Card>
    );
  }

  if (binding.transportKind === 'serial') {
    return (
      <InfoNote>
        Tocá «Conectar bastón» y elegí el puerto COM del RS420 en el diálogo del navegador.
      </InfoNote>
    );
  }

  // spp (u otro stream): emparejar por Bluetooth y elegir de la lista.
  return (
    <InfoNote>
      Emparejá el bastón por Bluetooth y elegilo de la lista para conectarlo.
    </InfoNote>
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
