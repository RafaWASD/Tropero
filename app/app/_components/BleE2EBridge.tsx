// BleE2EBridge — puente de test entre Playwright y el MockAdapter montado en el provider de la RAÍZ
// (spec 09 chunk BLE global, §7.2 / T8.1). El provider instancia su transporte internamente; sin este
// puente, Playwright no tiene forma de inyectarle un bastonazo. El puente lee `api.transport` (que en
// mode='mock' ES un MockAdapter) y publica un handle acotado en `window.__rafaqBle`:
//   - tagRead(eid)        → inyecta una lectura (mockTagRead) → el provider valida/dedupea/confirma y
//                           entrega el EID al overlay.
//   - connectMock()       → marca el transporte conectado (para el chip + el connect web-serial mockeado).
//   - disconnectMock()    → marca desconectado.
//
// FUERA DE PRODUCCIÓN (RB E2E / Gate 2): se monta SOLO si `isBleE2E()` (la marca DELIBERADA que solo
// Playwright pone antes del bundle). En un build normal NO se monta → `window.__rafaqBle` NO existe y no
// hay ninguna superficie de inyección. El handle expone únicamente lo necesario para los 4 escenarios;
// no toca datos, red ni DB.

import { useEffect } from 'react';

import { useBleProviderApi } from '@/services/ble/BleStickListenerProvider';
import type { MockAdapter } from '@/services/ble/adapter-mock';
import { isBleE2E, BLE_E2E_HANDLE_KEY } from './ble-e2e-flag';

type BleE2EHandle = {
  tagRead: (eid: string) => void;
  connectMock: () => void;
  disconnectMock: () => void;
};

/** ¿El transporte expuesto por el provider es un MockAdapter? (solo en mode='mock'). */
function asMockAdapter(transport: unknown): MockAdapter | null {
  if (transport && typeof transport === 'object' && (transport as { kind?: string }).kind === 'mock') {
    return transport as MockAdapter;
  }
  return null;
}

export function BleE2EBridge() {
  const api = useBleProviderApi();

  useEffect(() => {
    if (!isBleE2E()) return; // doble guard: el bridge solo se monta bajo el flag, pero re-chequeamos.
    const mock = asMockAdapter(api?.transport);
    if (!mock) return;

    const handle: BleE2EHandle = {
      // El MockAdapter solo propaga si el listener está enabled (this.listening) — replica que un
      // bastonazo con form abierto (busyMode → enabled=false) no dispara (escenario c). Lo conectamos
      // primero para que isListening sea true.
      tagRead: (eid: string) => mock.mockTagRead(eid),
      connectMock: () => mock.mockConnectionChange(true),
      disconnectMock: () => mock.mockConnectionChange(false),
    };
    (globalThis as Record<string, unknown>)[BLE_E2E_HANDLE_KEY] = handle;

    return () => {
      if ((globalThis as Record<string, unknown>)[BLE_E2E_HANDLE_KEY] === handle) {
        delete (globalThis as Record<string, unknown>)[BLE_E2E_HANDLE_KEY];
      }
    };
  }, [api]);

  return null;
}
