// Selección del adaptador activo según plataforma/entorno (R10.3, R11.2). PURO (sin RN) →
// testeable. El provider monta el adaptador que esta función elige; cada adaptador vive
// detrás de la MISMA interfaz StickAdapter (R11.2), así sumar/quitar uno no toca el contrato.
//
// Reglas (design §"Decisión de orden de build" + R10.3):
//   - mock: si se fuerza por toggle de dev/CI (mode='mock').
//   - web-serial: en web (Platform.OS === 'web').
//   - spp-android: en Android device (Fase 4, fuera de este run → no se elige acá todavía).
//   - hid-wedge: GATED (R8.7) → nunca se elige hasta pasar el gate.
//   - manual: PISO siempre disponible (R7) — no es "el activo" exclusivo, corre en paralelo.
//
// Este run monta SOLO los buildables hoy (web-serial / mock / manual). spp-android e
// hid-wedge se enchufan en Fases 4/5 sin cambiar esta lógica más que agregar su rama.

export type AdapterKind = 'manual' | 'mock' | 'web-serial' | 'spp-android' | 'hid-wedge';

export type ProviderMode = 'auto' | 'mock';

export interface SelectionEnv {
  /** Platform.OS del runtime ('web' | 'ios' | 'android' | ...). */
  platformOS: string;
  /** Modo del provider: 'mock' fuerza el adapter-mock (CI/dev toggle, R10.2). */
  mode: ProviderMode;
}

/**
 * Elige el adaptador de TRANSPORTE activo (además del manual, que es piso permanente).
 * Devuelve el `kind` del transporte a montar. En este run: 'mock' si se fuerza, 'web-serial'
 * en web; en native sin mock, todavía no hay transporte buildable (spp-android es Fase 4) →
 * 'manual' como único piso. NUNCA elige 'hid-wedge' (GATED, R8.7).
 */
export function selectTransportAdapter(env: SelectionEnv): AdapterKind {
  if (env.mode === 'mock') return 'mock';
  if (env.platformOS === 'web') return 'web-serial';
  // Android device → 'spp-android' cuando la Fase 4 esté construida; hasta entonces el piso
  // manual es el único transporte disponible en native (la app funciona, manual-first).
  // (No se elige spp-android en este run para no montar el placeholder que tira.)
  return 'manual';
}
