// BleStickListenerProvider — el provider global del bastón (R10.3). Spec 09 declaró esta
// interfaz (design §"useBleStickListener" + tasks.md Fase 4); 04 la IMPLEMENTA sobre el
// contrato de ADR-024. Monta el adaptador según plataforma/entorno, corre cada lectura por
// el contrato de ingesta (validate + dedup, R1/R3), dispara el feedback (R4) y entrega el
// EID confirmado-validado al consumidor de spec 09 (que muestra la confirmación visual de R2
// en su overlay antes del commit find-or-create).
//
// FRONTERA con spec 09 (design §"Regla de frontera", Preguntas abiertas #2/#3): el frontend
// de spec 09 todavía NO existe (deferred), así que este provider vive en services/ble/ con
// la firma EXACTA de spec 09. Cuando spec 09 Fase 4 monte SU BleStickListenerProvider, debe
// REEXPORTAR/DELEGAR en este (o montar este) — sin redefinir los tipos. NO se cambió ningún
// contrato de spec 09 para R2 (la confirmación visual es responsabilidad de su overlay).
//
// Estados de conexión expuestos por ConnectionStatusContext (R9.3, consumido por
// useBleConnectionStatus). enable/disable suspenden la ESCUCHA sin desconectar el transporte
// físico (R10.5/R10.7, MODO MANIOBRAS). useBusyMode suspende el listener mientras un form
// CREATE/EDIT está activo (R10.6). Offline: nada de esto toca la red (R14). Logging no
// bloqueante de eventos/descartes (R15).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import type { StickAdapter, ConnectionStatus } from './stick-adapter';
import { ConnectionStatusContext, isConnectedStatus } from './connection-status';
import { EidIngestEngine } from './contract';
import { resolveListening } from './listener-gate';
import { acceptingTargets, resolveReadHandling, type ReadSubscriber } from './read-dispatch';
import {
  selectTransportAdapter,
  readSourceFor,
  mountActionFor,
  type AdapterKind,
  type ProviderMode,
  type ReadSource,
} from './adapter-selection';
import { ManualAdapter } from './adapter-manual';
import { MockAdapter } from './adapter-mock';
import { WebSerialAdapter } from './adapter-web-serial';
import { SimulatorAdapter } from './adapter-simulator';
import { SppAndroidAdapter, isSppNativeAvailable } from './adapter-spp-android';
import { BleGattAdapter, isBleGattTransportAvailable } from './adapter-ble-gatt';
import { MfiIosAdapter, isMfiTransportAvailable } from './adapter-mfi-ios';
import { isDemoMode } from './demo-gate';
import { readRememberedDevice } from './remembered-device';
import { classifyReadOutcome, playFeedback, primeFeedback } from './feedback';
import { cachedBeepEnabled, readBeepEnabled } from './feedback-pref';
import { logTransportEvent } from './logging';

interface ProviderApi {
  /** Suspende la escucha del listener global (MODO MANIOBRAS, R10.7). No desconecta físicamente. */
  disableListener: () => void;
  /** Reanuda la escucha del listener global (R10.7). */
  enableListener: () => void;
  /** Marca/desmarca el modo "ocupado" (form CREATE/EDIT activo, R10.6). */
  setBusy: (busy: boolean) => void;
  /**
   * Adquiere la PROPIEDAD EXCLUSIVA del listener por un "scanner acotado" (delta caravana-ficha bastoneo,
   * RCF.6): un sheet de scan que quiere las lecturas para SÍ (ej. bastonear la caravana desde la ficha),
   * SIN que el FindOrCreateOverlay global las procese. Mientras hay ≥1 scanner acotado activo:
   *   (1) el listener queda ACTIVO aunque busyMode esté prendido (la ficha suspende el global con
   *       useBusyWhileMounted; el scanner acotado des-suspende SOLO para él), y
   *   (2) el FindOrCreateOverlay se auto-suprime (chequea `scopedScannerActive` y retorna temprano, igual
   *       que con `BLE_OWNED_ROUTES`) → un solo consumidor efectivo del bastón.
   * Devuelve la función de RELEASE (idempotente por el contador): llamarla al cerrar/desmontar el sheet.
   * Es un CONTADOR (no un booleano): tolera re-montajes/StrictMode sin dejar el estado colgado.
   */
  acquireScopedScanner: () => () => void;
  /** ¿Hay ≥1 scanner acotado activo? (lo consulta el FindOrCreateOverlay para ignorar las lecturas). */
  scopedScannerActive: boolean;
  /** ¿La escucha está activa ahora? (scopedScannerActive || (enabled && !busy)). */
  isListening: boolean;
  /** ¿El transporte está conectado? */
  isConnected: boolean;
  /**
   * Registra el callback de tag_read del consumidor (spec 09). Devuelve unsubscribe.
   *
   * `accepts` (🔴-2) declara si ESTE consumidor va a ACTUAR sobre una lectura AHORA. Se evalúa en cada
   * lectura, antes de decidir el feedback: un suscriptor que se auto-censura (el overlay global en las
   * rutas dueñas del bastón, el `TagScanSheet` mientras se tipea el EID a mano) NO cuenta como
   * consumidor, y si no queda ninguno la lectura se descarta en silencio en vez de vibrar sobre un dato
   * perdido. Omitirlo = "acepto siempre" (el caso de la pantalla `/baston`, que solo lista lecturas).
   */
  subscribeTagRead: (cb: (tag: string) => void, accepts?: () => boolean) => () => void;
  /** El adaptador de transporte activo (para la pantalla de conexión, R9). */
  transport: StickAdapter | null;
  /** El adaptador manual (piso, siempre disponible, R7). */
  manual: ManualAdapter;
  /**
   * MONTA (y conecta) otro transporte porque el operario lo ELIGIÓ en la pantalla de conexión
   * (🟠-2 del review de F4, RBM5.6/RBM5.14). Es la ÚNICA entrada por gesto a la preferencia de
   * transporte, y lo que destraba el bucle que dejaba a `ble-gatt` inalcanzable en Android: hasta acá la
   * preferencia solo se auto-escribía (el adapter, al conectar), así que un transporte que no fuera el
   * piso de su plataforma no tenía forma de montarse nunca.
   *
   * NO persiste nada: el `AdapterKind` vive en el estado del provider hasta que el adapter conecte de
   * verdad y persista el device que contestó (con su `adapterKind`). Si la conexión falla, el próximo
   * arranque vuelve al piso por plataforma — se recuerda lo que funcionó, no lo que se intentó.
   *
   * Un kind que la selección no honraría (gateado, o imposible en esta plataforma) no cambia nada:
   * `selectTransportAdapter` lo ignora y sigue el piso. La pantalla ya no lo ofrece (`transportChoices`).
   */
  chooseTransport: (kind: AdapterKind) => void;
  /**
   * El MODO con el que este provider está montado. Lo consume la pantalla de conexión para saber si
   * ofrecer otros transportes tiene sentido: en `mock`, `demo` y `manual`, `selectTransportAdapter` corta
   * **antes** de la preferencia (RBM5.9), así que `chooseTransport` no puede montar nada y una fila que lo
   * ofreciera sería una afordancia muerta — y, medido en la E2E, además DUPLICABA la fila del transporte
   * montado. Viaja el modo crudo (y no un booleano derivado) para que la decisión la siga tomando
   * `selectTransportAdapter`, que es la única fuente de esa verdad.
   */
  providerMode: ProviderMode;
}

const ProviderContext = createContext<ProviderApi | null>(null);

/**
 * Un suscriptor de tag_read + su declaración de si va a ACTUAR sobre la lectura ahora (🔴-2). El par se
 * guarda junto porque el provider necesita saber, ANTES de vibrar, cuántos consumidores hay DE VERDAD —
 * no cuántos están suscriptos (el overlay global siempre lo está). El filtrado lo hace `acceptingTargets`
 * (puro, en `read-dispatch.ts`, testeado por comportamiento).
 */
type TagSubscriber = ReadSubscriber<(tag: string) => void>;

/** Default de `accepts`: el consumidor toma todas las lecturas mientras esté suscripto. */
const ALWAYS_ACCEPTS = (): boolean => true;

/**
 * El sink del aviso de fail-closed AL CABLEAR un adaptador (RBM1.4): se montó un transporte de modo
 * `'raw-line'` que no expone un `ReaderDriver` con `frameParser`, así que no va a poder desframear ni
 * un bastonazo. `at:'mount'` aparece UNA vez y dice "error de cableado"; su hermano `at:'read'`
 * (abajo, en el camino de lectura) aparece por bastonazo y es el que hace diagnosticable el
 * "bastoneo y no pasa nada".
 *
 * Vive acá y no en `adapter-selection.ts` porque aquella capa es PURA (no importa `logging.ts`): el
 * sink entra inyectado, igual que `acceptingTargets(subscribers, onError)` en `read-dispatch.ts`.
 */
const logParserUnresolvedAtMount = (adapterKind: AdapterKind): void => {
  logTransportEvent({ kind: 'parser_unresolved', adapter: adapterKind, at: 'mount' });
};

function instantiateTransport(kind: ReturnType<typeof selectTransportAdapter>): StickAdapter | null {
  switch (kind) {
    case 'web-serial':
      return new WebSerialAdapter();
    case 'mock':
      return new MockAdapter();
    case 'simulator':
      // Delta multivendor (RMV4.5, triple-guard 3): re-chequeo del gate demo AL INSTANCIAR. Aun
      // si `selectTransportAdapter` devolviera 'simulator' (solo bajo mode='demo'), si el build no
      // está en modo demo (`isDemoMode()` false) devolvemos null → sin camino a instanciar el
      // simulador en producción. El simulador entra con `mode: 'eid'` (su fila de
      // `ADAPTER_INGEST_MODE`), igual que el mock: EID limpio, no línea cruda — así que tampoco
      // necesita driver ni parser (`resolveFrameParser` devuelve `null` en silencio).
      return isDemoMode() ? new SimulatorAdapter() : null;
    case 'spp-android':
      // Android (Fase 4, construida 2026-07-29). El guard NO es cosmético: sin el módulo nativo
      // en el APK (dev build anterior a la dep / Expo Go) devolvemos null → la app queda
      // manual-first y el chip + el CTA de la pantalla se ocultan solos por `hasTransport`. Montar
      // el adapter igual sería volver a prometer una conexión imposible.
      return isSppNativeAvailable() ? new SppAndroidAdapter() : null;
    case 'ble-gatt':
      // BLE GATT cross-platform (delta ios-ble-mfi, RBM2.3). MISMO guard que el SPP y por el mismo
      // motivo: `require('react-native-ble-plx')` resuelve desde `node_modules` aunque el binario no
      // esté en el build, y ahí `new BleManager()` tira recién al construirse. `isBleGattTransportAvailable()`
      // chequea además que ALGÚN driver del registro declare el transporte `ble-gatt`: sin `serviceUuid`
      // no hay filtro de escaneo posible, así que montarlo sería un transporte que no puede ni buscar.
      // Los dos motivos se loguean por separado (un try/catch mudo acá convierte "el build no trae BLE"
      // en "el operario no está bastoneando").
      //
      // ⚠️ El guard CONSULTA el módulo nativo y **no construye** el manager (🟠-1 del review de F4): este
      // camino corre en el PRIMER RENDER, y en iOS construir el `CBCentralManager` es lo que dispara el
      // diálogo de permiso de Bluetooth del SO — o sea que hacerlo acá se lo mostraría a un operario que
      // no tocó nada (RBM3.8). La construcción vive detrás de los gates de `autoConnect`/`doConnect`.
      return isBleGattTransportAvailable() ? new BleGattAdapter() : null;
    case 'mfi-ios':
      // MFi / ExternalAccessory en iOS (delta ios-ble-mfi F5, RBM4.1/RBM4.2). El guard es el GATE DE
      // DATOS y su orden es el requisito: `isMfiTransportAvailable()` chequea iOS → un driver del
      // registro que declare `mfi` → que ESTE build declare su `protocolString` en
      // `UISupportedExternalAccessoryProtocols` → y solo entonces el módulo nativo. Hoy corta en el
      // tercero (la lista está VACÍA: falta la cadena del fabricante, RBM4.6) → no se monta nada y la app
      // queda manual-first, que es la verdad: sin protocolo declarado no hay sesión que abrir.
      //
      // ⚠️ Con la lista vacía este camino **no lee `NativeModules`** (RBM4.2), y eso no es paranoia: leer
      // ese global INSTANCIA el módulo nativo en bridgeless y el `init()` de la lib hace un force-cast
      // sobre esa misma clave del plist. Es la misma clase que el 🟠-1 del review de F4 en el BLE
      // (construir el cliente en el arranque toca la radio) — acá el arranque en frío del provider ni
      // siquiera pregunta.
      return isMfiTransportAvailable() ? new MfiIosAdapter() : null;
    case 'manual':
      // Piso manual sin transporte extra (iOS, y el flag de E2E que reproduce ese sub-estado).
      return null;
    case 'hid-wedge':
      // GATED (R8.7): no se monta.
      return null;
  }
}

export function BleStickListenerProvider({
  children,
  mode = 'auto',
}: {
  children: ReactNode;
  /** 'mock' fuerza el adapter-mock (CI/dev toggle, R10.2). 'auto' elige por plataforma. */
  mode?: ProviderMode;
}) {
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  // Contador de "scanners acotados" activos (delta caravana-ficha bastoneo, RCF.6): un sheet de scan que
  // toma la propiedad exclusiva del listener. >0 → el listener escucha aunque busyMode esté prendido, y el
  // FindOrCreateOverlay se auto-suprime. Contador (no booleano) → re-montajes/StrictMode no lo dejan colgado.
  const [scopedCount, setScopedCount] = useState(0);
  const [status, setStatus] = useState<ConnectionStatus>('off');

  // El motor de ingesta (validate + dedup) es por-provider (una ventana de dedup global del
  // listener). En ref: sobrevive renders sin recrearse.
  const engineRef = useRef<EidIngestEngine>(new EidIngestEngine());
  // El adaptador manual (piso) es estable durante toda la vida del provider (R7).
  const manualRef = useRef<ManualAdapter>(new ManualAdapter());
  // Callbacks de tag_read del consumidor (spec 09) + su predicado `accepts` (🔴-2). Set para soportar
  // múltiples suscriptores.
  const tagSubscribersRef = useRef(new Set<TagSubscriber>());
  // ¿El transporte montado lo pidió un GESTO del operario (eligió otro en la pantalla de conexión)? Guarda
  // el `AdapterKind` elegido, no un booleano: lo leen DOS decisiones distintas —si la hidratación puede
  // pisarlo (abajo) y si el transporte recién montado se conecta de una (`mountActionFor`)— y las dos
  // necesitan saber CUÁL kind se pidió. Declarado acá arriba porque la hidratación lo consulta.
  const chosenByGestureRef = useRef<AdapterKind | null>(null);

  // ── PREFERENCIA DE TRANSPORTE DEL BASTÓN RECORDADO (RBM5.6, delta ios-ble-mfi) ─────────────────────
  // El transporte tiene que seguir al bastón que el operario YA eligió, no a la plataforma sola: sin
  // esto, en Android se monta siempre `spp-android` y un lector BLE queda inalcanzable en producción
  // justo donde está el productor argentino.
  //
  // La hidratación es ASINCRÓNICA (SecureStore, con el techo de `storage` que ya vive en el borde de
  // `remembered-device.ts`): el provider arranca con el PISO por plataforma y re-monta si la preferencia
  // resuelve a otro `AdapterKind`. `undefined` mientras no se sepa —y también cuando el registro está en
  // el formato viejo (RBM5.7)— significa "sin preferencia".
  //
  // Solo se lee en `mode === 'auto'`: los otros tres modos cortan antes en `selectTransportAdapter`
  // (RBM5.9), así que leer el storage ahí sería I/O que no puede cambiar nada. Las ~70 specs E2E corren
  // en `mock` → cero lecturas nuevas, cero riesgo.
  const [preferredAdapter, setPreferredAdapter] = useState<AdapterKind | undefined>(undefined);
  useEffect(() => {
    if (mode !== 'auto') return;
    let active = true;
    void readRememberedDevice().then((remembered) => {
      // ⚠️ El GESTO LE GANA A LA HIDRATACIÓN, y no es teórico: la lectura es asincrónica (SecureStore, con
      // el techo de `storage` = 2 s) y el operario puede elegir otro transporte ANTES de que resuelva
      // (deep-link a `/baston`, o un arranque lento). Sin este guard, la hidratación pisaría la elección
      // del operario ~2 s después de que la hizo: el transporte que acababa de elegir se desmontaría solo.
      if (active && remembered?.adapterKind && chosenByGestureRef.current == null) {
        setPreferredAdapter(remembered.adapterKind);
      }
    });
    return () => {
      active = false;
    };
  }, [mode]);

  // ── EL OPERARIO ELIGE EL TRANSPORTE (🟠-2 del review de F4, RBM5.14) ───────────────────────────────
  // La otra entrada de la preferencia, y la que faltaba: hasta acá el `adapterKind` solo lo escribía el
  // adapter AL CONECTAR, así que un transporte que no fuera el piso de su plataforma no tenía forma de
  // montarse nunca (en Android, `ble-gatt` era inalcanzable en producción — el problema que RBM5.6 dice
  // resolver). La pantalla ofrece los transportes alcanzables (`transportChoices`) y esto los monta.
  //
  // El REF (y no un estado más) es lo correcto: no cambia lo que se renderiza, solo el ORIGEN del montaje
  // —gesto vs. arranque—, que es lo que decide si el transporte recién montado se conecta de una
  // (`mountActionFor`) y si la hidratación puede pisarlo. Y no se limpia al consumirse: mientras el kind
  // elegido siga siendo el montado, un re-montaje sigue siendo "el que el operario pidió" (con StrictMode,
  // que invoca los efectos dos veces, limpiarlo convertiría el gesto en un no-op).
  const chooseTransport = useCallback((kind: AdapterKind) => {
    chosenByGestureRef.current = kind;
    setPreferredAdapter(kind);
  }, []);

  // El transporte activo se elige por (plataforma, modo, preferencia). El `useMemo` depende del KIND ya
  // resuelto —un string— y no de la preferencia cruda: así la hidratación re-monta **solo si el
  // `AdapterKind` cambió** (guard del riesgo declarado en el design §13: montar → hidratar → re-montar
  // en ciclo). Si la preferencia coincide con el piso, no pasa nada.
  const resolvedKind = selectTransportAdapter({ platformOS: Platform.OS, mode, preferredAdapter });
  const transport = useMemo(() => instantiateTransport(resolvedKind), [resolvedKind]);

  // Un scanner acotado (RCF.6) FUERZA la escucha: quiere las lecturas para SÍ, aunque la ficha haya
  // prendido busyMode (useBusyWhileMounted) para suspender el listener global. Sin scanner acotado, la
  // escucha vale lo de siempre (enabled && !busy). El overlay global ignora las lecturas mientras el
  // scanner acotado esté activo (chequea `scopedScannerActive`), así hay un SOLO consumidor efectivo.
  const scopedScannerActive = scopedCount > 0;
  const listening = resolveListening({ scopedScannerActive, enabled, busy });
  const listeningRef = useRef(listening);
  listeningRef.current = listening;

  // Adquiere/libera la propiedad exclusiva del listener por un scanner acotado (RCF.6). El acquire
  // incrementa el contador y devuelve un release que lo decrementa (idempotente por el clamp a 0). El
  // sheet de scan lo llama en un efecto: acquire al montar, release en el cleanup (incl. back-gesture).
  const acquireScopedScanner = useCallback(() => {
    setScopedCount((c) => c + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setScopedCount((c) => Math.max(0, c - 1));
    };
  }, []);

  // ─── Ingesta de una lectura (cruda de stream o EID limpio) → confirmación → tag_read ────
  const handleReading = useCallback((rawOrEid: string, source: ReadSource) => {
    // ── GATE ÚNICO: ¿esta lectura se procesa, y si no, por qué? (`read-dispatch.ts`, decisión pura) ──
    // Cubre los DOS motivos por los que una lectura no va a ningún lado, y los dos cortan ANTES del
    // feedback sensorial (R4) y ANTES del motor de dedup (R3):
    //   (1) la escucha está suspendida (MANIOBRAS o form activo, R10.5/R10.6) — lo de siempre;
    //   (2) 🔴-2: se escucha, pero NINGÚN suscriptor va a actuar sobre la lectura. Contar suscriptores
    //       NO alcanza (el overlay global está SIEMPRE suscripto y se censura por ruta adentro de su
    //       callback): cada suscriptor declara su `accepts()` y contamos los que aceptan AHORA.
    const listening = listeningRef.current;
    const subscribers = tagSubscribersRef.current;
    // Los predicados solo se evalúan si hay escucha (si no, la lectura se descarta igual y evaluarlos
    // sería trabajo por bastonazo para nada).
    const targets = listening
      ? acceptingTargets(subscribers, () =>
          logTransportEvent({ kind: 'read_loop_error', message: 'accepts_predicate_threw' }),
        )
      : [];
    const handling = resolveReadHandling({ listening, acceptingConsumers: targets.length });
    if (handling !== 'process') {
      if (handling === 'drop_no_consumer') {
        // Silencio HONESTO en vez de una vibración que confirma un dato perdido. Se loguea porque el
        // síntoma correcto (no pasa nada) es indistinguible de "el bastón no leyó" desde afuera.
        logTransportEvent({ kind: 'read_dropped_no_consumer', subscribers: subscribers.size });
      }
      return;
    }

    const now = Date.now();
    const engine = engineRef.current;
    // ── EL PARSER SALE DEL DRIVER DEL ADAPTER, NO DE UN IMPORT DEL CONTRATO (RBM1.1) ───────────────
    // `source.frameParser` lo resolvió `resolveFrameParser` al cablear este adaptador. Si es `null`
    // con modo 'raw-line', el transporte NO PUEDE desframear: la línea se DESCARTA con log
    // (FAIL-CLOSED, RBM1.4) en vez de caer al parser del RS420 — ese fallback daría lecturas para un
    // lector y silencio total para todos los demás, y el silencio es indistinguible de "el operario
    // no está bastoneando". Sale antes del feedback: no hay nada que confirmarle a nadie.
    let candidate: ReturnType<EidIngestEngine['processEid']>;
    if (source.mode === 'raw-line') {
      const frameParser = source.frameParser;
      if (frameParser === null) {
        logTransportEvent({ kind: 'parser_unresolved', adapter: source.kind, at: 'read' });
        return;
      }
      candidate = engine.processRawLine(rawOrEid, frameParser, now);
    } else {
      candidate = engine.processEid(rawOrEid, now);
    }

    // ── FEEDBACK SENSORIAL (R4), UNA SOLA LLAMADA, PARA LOS TRES DESENLACES ────────────────────────
    // Se invoca SIEMPRE, con el desenlace clasificado, y es el punto único (R4.7). Lo que suena —o no—
    // lo decide `decideFeedback` (puro, testeado por comportamiento), NO un `if` escrito acá:
    //   · aceptada  → háptica 'success' + pip agudo. "Entró."
    //   · rechazada → háptica 'error' + doble pip grave descendente (🟡-12): es el ÚNICO caso en que
    //                 sabemos que llegó algo y no servía; sin esta señal, "trama corrupta" era el mismo
    //                 silencio que "bastón mudo" y el peón no podía aprender del producto.
    //   · duplicada → silencio (R3.1; el fundamento está en feedback-logic.ts).
    // La preferencia de sonido se lee del CACHÉ EN MEMORIA (🟡-11): antes era un `await` a SecureStore
    // POR BASTONAZO, y encima colgaba el pip de una promesa. Ahora es síncrono, en orden, y sin I/O.
    // Envuelto: el feedback es un enhancement y su falla NUNCA puede romper la ingesta (R15.2 / R4.5).
    try {
      playFeedback(classifyReadOutcome(candidate), cachedBeepEnabled());
    } catch {
      logTransportEvent({ kind: 'read_loop_error', message: 'feedback_threw' });
    }

    if (candidate === null) {
      // Re-escaneo dentro de la ventana de dedup (R3.1) → ignorar en silencio.
      return;
    }
    if ('rejected' in candidate) {
      // Malformado (R1.4): descartar + loguear NO bloqueante (R15.1). No interrumpe el flujo.
      logTransportEvent({ kind: 'eid_rejected', reason: candidate.rejected });
      return;
    }

    // Entrega el EID al consumidor de spec 09 (R1.6). La CONFIRMACIÓN VISUAL pre-commit (R2)
    // la hace el overlay de spec 09 mostrando este EID antes del find-or-create. El "commit"
    // del contrato (engine.commit → tag_read) lo materializa el consumidor al confirmar; acá
    // entregamos el tag (string) como declara la firma de spec 09: onTagRead(tag).
    //
    // Se despacha a los `targets` (los que ACEPTARON), no al Set entero: la lista se fijó en el mismo
    // instante en que se decidió que había consumidor, así que "a quién se le confirmó" y "quién la
    // recibió" no pueden divergir.
    //
    // Cada entrega va en su PROPIO try/catch (🟠-D del review): un consumidor que tira no puede llevarse
    // ni a los otros consumidores ni al read-loop del transporte (`SppAndroidAdapter.emitTag` tampoco
    // atrapa, así que sin esto una excepción acá mataba la ingesta del bastón hasta reconectar). Es
    // también lo que hace defendible el fail-open de `acceptingTargets`: el intento extra está acotado.
    for (const cb of targets) {
      try {
        cb(candidate.eid);
      } catch {
        logTransportEvent({ kind: 'read_loop_error', message: 'tag_subscriber_threw' });
      }
    }
  }, []);

  // ─── Warm-up de los canales de feedback (R4), FUERA del camino caliente ─────────────────
  // Dos cosas que no pueden pasar por bastonazo: (a) leer la preferencia de sonido del storage — era un
  // cruce a SecureStore POR LECTURA (🟡-11) y ahora se trae una vez al caché en memoria; (b) cargar el
  // asset del sonido — sin esto, la primera lectura de la jornada pagaría la carga, justo el bastonazo
  // que le forma al peón la expectativa de cuánto tarda. Best-effort: si algo falla, no rompe nada y el
  // camino de lectura sigue con el default.
  useEffect(() => {
    void readBeepEnabled();
    primeFeedback();
  }, []);

  // ─── Wiring de los adaptadores (transporte + manual) al contrato ────────────────────────
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Manual (piso, R7): siempre activo, alimenta el MISMO contrato (R7.1). Su `ReadSource` sale de
    // la MISMA función que el del transporte (modo 'eid' → sin parser, `null` silencioso): que la
    // puerta manual y la del bastón se resuelvan por el mismo camino es lo que evita que una de las
    // dos quede con una regla escrita a mano que nadie mira.
    const manual = manualRef.current;
    const manualSource = readSourceFor(manual, logParserUnresolvedAtMount);
    unsubs.push(manual.onTagRead((value) => handleReading(value, manualSource)));
    void manual.connect();

    // Transporte (web-serial/mock): si hay, suscribimos sus lecturas + status.
    if (transport) {
      // Modo de ingesta DECLARADO por adaptador (`readSourceFor` → `ingestModeFor`, en
      // `adapter-selection.ts`), no una comparación de literales acá (🟡-1 del review, 2026-07-30).
      // Era una lista de dos kinds sin un solo test:
      // si le faltara 'spp-android', cada trama del RS420 iría por `processEid` → `normalizeTag` le
      // saca el STX → 34 dígitos → `isValidTag` false → CERO lecturas, con la suite entera en verde
      // (ni el unit ni el E2E —que corre web con mock/manual/simulator— tocan este camino). La
      // tabla es exhaustiva por tipo: un adapter nuevo no compila hasta declarar su modo.
      //
      // Delta ios-ble-mfi (RBM1.1): junto con el MODO viaja ahora el `frameParser` del `ReaderDriver`
      // de ESTE adapter (las dos mitades las resuelve `readSourceFor`, fail-closed). Antes el
      // contrato llamaba `parseRs420Line` hardcodeado, así que un transporte nuevo solo podía hablar
      // con algo que emitiera tramas del RS420 — o sea, con nuestro emulador y con nada más.
      //
      // Las DOS mitades viven en la capa pura y se ejercen por COMPORTAMIENTO desde node:test
      // (`frame-parser-resolve.test.ts`): este archivo importa `react-native`, así que todo lo que
      // se decida ACÁ ADENTRO solo puede vigilarse con un regex — y un regex vigila las grafías de
      // hoy, no el invariante (el reviewer lo falsificó con un fallback que no nombraba a nadie).
      const transportSource = readSourceFor(transport, logParserUnresolvedAtMount);
      unsubs.push(transport.onTagRead((value) => handleReading(value, transportSource)));
      unsubs.push(
        transport.onStatus((s) => {
          setStatus(s);
          logTransportEvent({ kind: 'connection_changed', connected: isConnectedStatus(s) });
        }),
      );
      transport.enable();
      // R6.4 — RECONEXIÓN AUTOMÁTICA AL ABRIR LA APP. Hasta el 2026-07-30 acá había un comentario que
      // decía "NO auto-conectamos", y era una discrepancia con el requisito: R6.4 pide reconectar al
      // bastón guardado "sin requerir que el operario vuelva a la pantalla de conexión", y as-built
      // CADA arranque exigía Más → Bastón → tocar (los únicos llamadores de connect() eran gestos, así
      // que `readRememberedDevice()` solo se alcanzaba tocando algo). Decisión de Raf, 2026-07-30.
      //
      // El adapter decide si arranca, y su regla es "el arranque no pide nada": sin device recordado no
      // toca la radio; el permiso se CONSULTA y no se pide; con el Bluetooth apagado no muestra el
      // diálogo de activar. Cualquier gate que no pase deja el estado en 'off' (nunca se intentó) y
      // loguea el motivo — ver `SppAndroidAdapter.autoConnect()`.
      //
      // `autoConnect` es OPCIONAL en `StickAdapter`: la implementan los TRES transportes de bastón físico
      // — `spp-android`, y desde el delta ios-ble-mfi `ble-gatt` (RBM2.16, F3) y `mfi-ios` (F5). No es
      // olvido que los otros tres no la tengan: web-serial NO PUEDE (la Web Serial API exige un gesto para
      // `requestPort()`), manual no tiene transporte, y mock/simulator los conecta su propio disparador
      // (bridge de E2E / botón de demo). O sea: cero riesgo para las ~70 specs E2E, que corren en mock.
      // (`hid-wedge` sigue GATED y no se monta.)
      //
      // ⚠️ Consecuencia NUEVA de este delta, dicha en voz alta: con `ble-gatt` como piso de iOS (RBM5.6)
      // y como preferencia posible en Android, este `autoConnect` hace que la app arranque ESCANEANDO por
      // BLE sin gesto. Es lo que R6.4 pide y el adapter tiene la misma política de `ConnectTrigger` que el
      // SPP (presupuesto de la cadena sin gesto, permiso CONSULTADO y no pedido, foreground-only), pero
      // ahora corre en un transporte más.
      //
      // ── Y CUÁL DE LAS DOS PUERTAS SE USA LO DECIDE UNA FUNCIÓN PURA (`mountActionFor`) ───────────────
      // Si este montaje lo pidió el operario eligiendo el transporte en la pantalla, `autoConnect` sería
      // el camino equivocado: su primer gate es "¿hay bastón recordado?" y en el escenario que 🟠-2 vino a
      // destrabar justamente NO hay (es la primera conexión por ese transporte) → el tap del operario no
      // haría nada. Con `'connect'` sale con trigger `operator`: puede pedir permisos y su cadena no tiene
      // tope, que es lo que corresponde a un gesto.
      const action = mountActionFor({
        chosenByGesture: chosenByGestureRef.current === transport.kind,
        canAutoConnect: typeof transport.autoConnect === 'function',
      });
      if (action === 'connect') void transport.connect().catch(() => undefined);
      else if (action === 'autoconnect') void transport.autoConnect?.().catch(() => undefined);
    }

    return () => {
      for (const u of unsubs) u();
      void transport?.disconnect().catch(() => undefined);
    };
  }, [transport, handleReading]);

  // Refleja enabled/busy en el enable/disable lógico del transporte (R10.5). No desconecta.
  useEffect(() => {
    if (!transport) return;
    if (listening) transport.enable();
    else transport.disable();
  }, [transport, listening]);

  const disableListener = useCallback(() => setEnabled(false), []);
  const enableListener = useCallback(() => setEnabled(true), []);

  const subscribeTagRead = useCallback((cb: (tag: string) => void, accepts: () => boolean = ALWAYS_ACCEPTS) => {
    // La ENTRADA (no el cb pelado) es la identidad en el Set: dos consumidores podrían compartir la
    // misma referencia de callback y su unsubscribe no debe llevarse al otro.
    const entry: TagSubscriber = { cb, accepts };
    tagSubscribersRef.current.add(entry);
    return () => {
      tagSubscribersRef.current.delete(entry);
    };
  }, []);

  const api = useMemo<ProviderApi>(
    () => ({
      disableListener,
      enableListener,
      setBusy,
      acquireScopedScanner,
      scopedScannerActive,
      isListening: listening,
      isConnected: isConnectedStatus(status),
      subscribeTagRead,
      transport,
      manual: manualRef.current,
      chooseTransport,
      providerMode: mode,
    }),
    [
      disableListener,
      enableListener,
      acquireScopedScanner,
      scopedScannerActive,
      listening,
      status,
      subscribeTagRead,
      transport,
      chooseTransport,
      mode,
    ],
  );

  return (
    <ProviderContext.Provider value={api}>
      <ConnectionStatusContext.Provider value={status}>{children}</ConnectionStatusContext.Provider>
    </ProviderContext.Provider>
  );
}

/** Acceso interno al API del provider (lo usan los hooks de stick.ts). */
export function useBleProviderApi(): ProviderApi | null {
  return useContext(ProviderContext);
}
