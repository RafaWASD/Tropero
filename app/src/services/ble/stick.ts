// stick.ts — implementación REAL de la interfaz de spec 09 sobre el contrato de ADR-024
// (R10.4, R10.5, R10.6, R10.7). Reemplaza el stub que spec 09 declaró (T1.5, hoy inexistente
// porque el frontend de spec 09 está deferred). Firma EXACTA de spec 09 — NO se redefine.
//
// useBleStickListener({ enabled, onTagRead }) → { isConnected, isListening }
//   - enabled=false desactiva la escucha del listener global (MODO MANIOBRAS, R10.5) sin
//     desconectar el transporte físico; reactiva con enabled=true.
//   - onTagRead(tag) recibe el EID YA validado + des-duplicado del contrato (R1/R3); la
//     confirmación visual pre-commit (R2) y el find-or-create los hace spec 09 con ese tag.
//
// useBusyMode() → setter del modo ocupado (R10.6): el form CREATE/EDIT de spec 09 lo activa
// para que un bastoneo no dispare un flujo encima del form en curso.
//
// { enableListener, disableListener } se exponen vía useStickListenerControls() (R10.7),
// consumido por MODO MANIOBRAS (spec 03) en un useEffect con cleanup.

import { useEffect, useRef } from 'react';

import { useBleProviderApi } from './BleStickListenerProvider';

export interface UseBleStickListenerResult {
  isConnected: boolean;
  isListening: boolean;
}

/**
 * Hook consumidor del listener global (firma EXACTA de spec 09, R10.4). El `enabled` controla
 * la escucha; `onTagRead` recibe cada EID validado+des-duplicado. Sin provider montado retorna
 * { isConnected:false, isListening:false } (no rompe; manual-first sigue por la UI de spec 09).
 */
export function useBleStickListener(opts: {
  enabled: boolean;
  onTagRead: (tag: string) => void;
}): UseBleStickListenerResult {
  const api = useBleProviderApi();

  // onTagRead en ref: cambiarlo (closure nueva cada render) NO debe re-suscribir/disparar.
  const onTagReadRef = useRef(opts.onTagRead);
  onTagReadRef.current = opts.onTagRead;

  // Refleja `enabled` del consumidor en el enable/disable del listener global (R10.5).
  useEffect(() => {
    if (!api) return;
    if (opts.enabled) api.enableListener();
    else api.disableListener();
  }, [api, opts.enabled]);

  // Suscribe el callback de tag_read mientras el hook está montado.
  useEffect(() => {
    if (!api) return;
    const unsub = api.subscribeTagRead((tag) => onTagReadRef.current(tag));
    return unsub;
  }, [api]);

  return {
    isConnected: api?.isConnected ?? false,
    isListening: api?.isListening ?? false,
  };
}

/**
 * Modo "ocupado" (R10.6): mientras un form CREATE/EDIT está activo, el listener no dispara un
 * nuevo flujo encima. El componente del form llama setBusy(true) al montar y setBusy(false) al
 * desmontar (o usar el efecto de abajo). Sin provider, no-op.
 */
export function useBusyMode(): (busy: boolean) => void {
  const api = useBleProviderApi();
  return api?.setBusy ?? (() => undefined);
}

/**
 * Activa el modo ocupado mientras el componente está montado (azúcar para useBusyMode). El
 * form CREATE/EDIT de spec 09 puede usar `useBusyWhileMounted()` directo en vez de manejar el
 * setter a mano (R10.6).
 */
export function useBusyWhileMounted(): void {
  const setBusy = useBusyMode();
  useEffect(() => {
    setBusy(true);
    return () => setBusy(false);
  }, [setBusy]);
}

/**
 * Controles de suspensión/reanudación del listener global (R10.7), para MODO MANIOBRAS
 * (spec 03). Uso típico: en un useEffect, disableListener() al montar la stack de manga y
 * enableListener() en el cleanup. Sin provider, no-ops.
 */
export function useStickListenerControls(): {
  enableListener: () => void;
  disableListener: () => void;
} {
  const api = useBleProviderApi();
  return {
    enableListener: api?.enableListener ?? (() => undefined),
    disableListener: api?.disableListener ?? (() => undefined),
  };
}
