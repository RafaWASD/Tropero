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
import { selectTransportAdapter, type ProviderMode } from './adapter-selection';
import { ManualAdapter } from './adapter-manual';
import { MockAdapter } from './adapter-mock';
import { WebSerialAdapter } from './adapter-web-serial';
import { playFeedback } from './feedback';
import { readBeepEnabled } from './feedback-pref';
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
  /** Registra el callback de tag_read del consumidor (spec 09). Devuelve unsubscribe. */
  subscribeTagRead: (cb: (tag: string) => void) => () => void;
  /** El adaptador de transporte activo (para la pantalla de conexión, R9). */
  transport: StickAdapter | null;
  /** El adaptador manual (piso, siempre disponible, R7). */
  manual: ManualAdapter;
}

const ProviderContext = createContext<ProviderApi | null>(null);

function instantiateTransport(kind: ReturnType<typeof selectTransportAdapter>): StickAdapter | null {
  switch (kind) {
    case 'web-serial':
      return new WebSerialAdapter();
    case 'mock':
      return new MockAdapter();
    case 'manual':
      // En native sin transporte buildable (spp-android es Fase 4), no hay transporte extra:
      // el manual (piso) es el único. Devolvemos null → solo corre el manual.
      return null;
    case 'spp-android':
    case 'hid-wedge':
      // Fuera de este run (Fase 4 / GATED). No se montan.
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
  // Callbacks de tag_read del consumidor (spec 09). Set para soportar múltiples suscriptores.
  const tagSubscribersRef = useRef(new Set<(tag: string) => void>());

  // El transporte activo (web-serial/mock/null) se elige una vez por (plataforma, modo).
  const transport = useMemo(
    () => instantiateTransport(selectTransportAdapter({ platformOS: Platform.OS, mode })),
    [mode],
  );

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
  const handleReading = useCallback((rawOrEid: string, isRawStream: boolean) => {
    // Gate de escucha (R10.5/R10.6): si el listener está suspendido (MANIOBRAS o form activo),
    // no procesamos (el wizard/form lo maneja por su cuenta).
    if (!listeningRef.current) return;

    const now = Date.now();
    const engine = engineRef.current;
    const candidate = isRawStream ? engine.processRawLine(rawOrEid, now) : engine.processEid(rawOrEid, now);

    if (candidate === null) {
      // Re-escaneo dentro de la ventana de dedup (R3.1) → ignorar en silencio.
      return;
    }
    if ('rejected' in candidate) {
      // Malformado (R1.4): descartar + loguear NO bloqueante (R15.1). No interrumpe el flujo.
      logTransportEvent({ kind: 'eid_rejected', reason: candidate.rejected });
      return;
    }

    // Candidato válido + des-duplicado. Feedback sensorial (R4) — best-effort, no bloquea.
    void readBeepEnabled().then((beepEnabled) => playFeedback(beepEnabled)).catch(() => {
      // Feedback es enhancement; su falla nunca rompe la ingesta (R15.2).
    });

    // Entrega el EID al consumidor de spec 09 (R1.6). La CONFIRMACIÓN VISUAL pre-commit (R2)
    // la hace el overlay de spec 09 mostrando este EID antes del find-or-create. El "commit"
    // del contrato (engine.commit → tag_read) lo materializa el consumidor al confirmar; acá
    // entregamos el tag (string) como declara la firma de spec 09: onTagRead(tag).
    for (const cb of tagSubscribersRef.current) cb(candidate.eid);
  }, []);

  // ─── Wiring de los adaptadores (transporte + manual) al contrato ────────────────────────
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Manual (piso, R7): siempre activo, alimenta el MISMO contrato (R7.1).
    const manual = manualRef.current;
    unsubs.push(manual.onTagRead((value) => handleReading(value, false)));
    void manual.connect();

    // Transporte (web-serial/mock): si hay, suscribimos sus lecturas + status.
    if (transport) {
      const isRawStream = transport.kind === 'web-serial' || transport.kind === 'spp-android';
      unsubs.push(transport.onTagRead((value) => handleReading(value, isRawStream)));
      unsubs.push(
        transport.onStatus((s) => {
          setStatus(s);
          logTransportEvent({ kind: 'connection_changed', connected: isConnectedStatus(s) });
        }),
      );
      transport.enable();
      // NO auto-conectamos el transporte: la conexión la dispara la pantalla de conexión (R9)
      // con gesto de usuario (web-serial: requestPort). El mock se conecta por su API en tests.
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

  const subscribeTagRead = useCallback((cb: (tag: string) => void) => {
    tagSubscribersRef.current.add(cb);
    return () => {
      tagSubscribersRef.current.delete(cb);
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
