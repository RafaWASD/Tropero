// Selección del adaptador activo según plataforma/entorno (R10.3, R11.2). PURO (sin RN) →
// testeable. El provider monta el adaptador que esta función elige; cada adaptador vive
// detrás de la MISMA interfaz StickAdapter (R11.2), así sumar/quitar uno no toca el contrato.
//
// Reglas (design §"Decisión de orden de build" + R10.3):
//   - mock: si se fuerza por toggle de dev/CI (mode='mock').
//   - web-serial: en web (Platform.OS === 'web').
//   - spp-android: en Android (Bluetooth Classic SPP nativo — Fase 4, CONSTRUIDA 2026-07-29).
//   - hid-wedge: GATED (R8.7) → nunca se elige hasta pasar el gate.
//   - manual: PISO siempre disponible (R7) — no es "el activo" exclusivo, corre en paralelo.
//
// Esta función elige el KIND; que ese kind se pueda INSTANCIAR en este build es otra decisión y
// vive en `instantiateTransport` (que para 'spp-android' chequea que el módulo nativo esté
// realmente presente). Separadas a propósito: un dev build viejo, sin el binario de
// `react-native-bluetooth-classic`, sigue eligiendo 'spp-android' pero NO monta transporte → la
// app queda manual-first y el chip/CTA se ocultan solos (guard de `hasTransport`).

// Delta multivendor (RMV2.7, RMV4.1): `'simulator'` se agrega de forma ADITIVA al union del core.
// Es el adapter del camino de demo (dev/demo-gated, triple-guard) — no cambia ninguno de los otros.
export type AdapterKind = 'manual' | 'mock' | 'web-serial' | 'spp-android' | 'hid-wedge' | 'simulator';

// 'auto' = elige por plataforma (web-serial en web). 'mock' = adapter-mock (CI/dev toggle, R10.2).
// 'manual' = SIN transporte buildable, solo el piso manual (native manual-first / captura del sub-estado
// "manual promovido" del hero adaptativo de la manga, spec 03 M2.1) → instantiateTransport devuelve null.
// 'demo' = camino de demo por simulador (delta multivendor, RMV2.7/RMV4.3): SOLO bajo el gate demo
// (dev/demo-build); en producción `mode='auto'` NUNCA elige el simulador (triple-guard 1).
export type ProviderMode = 'auto' | 'mock' | 'manual' | 'demo';

export interface SelectionEnv {
  /** Platform.OS del runtime ('web' | 'ios' | 'android' | ...). */
  platformOS: string;
  /** Modo del provider: 'mock' fuerza el adapter-mock (CI/dev toggle, R10.2). */
  mode: ProviderMode;
}

/**
 * Elige el adaptador de TRANSPORTE activo (además del manual, que es piso permanente).
 * Devuelve el `kind` del transporte a montar: 'mock' si se fuerza, 'web-serial' en web,
 * 'spp-android' en Android (RS420 por Classic SPP). En iOS sigue sin haber transporte alcanzable
 * (el RS420 declara spp+serial y su vía iOS real es MFi, gated por el protocol string del
 * fabricante) → 'manual' como único piso. NUNCA elige 'hid-wedge' (GATED, R8.7).
 */
export function selectTransportAdapter(env: SelectionEnv): AdapterKind {
  if (env.mode === 'mock') return 'mock';
  // Delta multivendor (RMV2.7/RMV4.3, triple-guard 1): la rama demo va ANTES de la lógica de
  // plataforma y NUNCA la alcanza `mode='auto'` (el default de producción). Solo `mode='demo'`
  // (que el host pone bajo el gate demo) devuelve el simulador. Los modos auto/mock/manual
  // devuelven EXACTAMENTE lo mismo que antes del delta (regresión cubierta por wiring/selection tests).
  if (env.mode === 'demo') return 'simulator';
  // 'manual' fuerza el piso manual SIN transporte buildable (instantiateTransport('manual') → null). Lo usa
  // el provider bajo el flag de E2E para reproducir el sub-estado "manual promovido" del hero (transport==null).
  if (env.mode === 'manual') return 'manual';
  if (env.platformOS === 'web') return 'web-serial';
  // Android → SPP nativo (Bluetooth Classic). Es el único transporte con el que el RS420 habla en
  // Android, y desde 2026-07-29 el adapter + la dep nativa están en el build.
  if (env.platformOS === 'android') return 'spp-android';
  // iOS y cualquier otra plataforma: sin transporte alcanzable todavía → piso manual (la app
  // funciona igual, manual-first). iOS va aparte (External Accessory + protocol string MFi).
  return 'manual';
}

// ─── Modo de INGESTA por adaptador (🟡-1 del review, 2026-07-30) ─────────────────────────────────
//
// Cómo entra al contrato lo que emite un adapter. Son dos puertas distintas del MISMO motor
// (`EidIngestEngine`) y elegir la equivocada deja el bastón MUDO con la suite entera en verde:
//   · 'raw-line' → línea CRUDA del lector → `processRawLine` → `parseRs420Line` (descarta STX,
//                  cabecera fija y timestamp) → `isValidTag`.
//   · 'eid'      → el adapter ya entrega el EID limpio (manual, mock, simulador, y el wedge HID
//                  cuando destrabe R8.7) → `processEid`, sin desframear nada.
//
// ── POR QUÉ ES UNA TABLA Y NO UN `kind === 'x' || kind === 'y'` INLINE ──────────────────────────
// Hasta hoy la decisión vivía como una comparación de DOS LITERALES dentro de
// `BleStickListenerProvider.tsx`, sin un solo test. Si a esa lista le faltara `spp-android`, cada
// trama del RS420 iría por `processEid` → `normalizeTag` le saca el STX → quedan 34 dígitos →
// `isValidTag` false → `invalid_eid`, CERO lecturas, y ni la suite unit ni la E2E (que corre en web
// con mock/manual/simulator) lo verían. Es la TERCERA repetición de la misma clase de bug de este
// camino (framing invertido, `isRawStream`, `BLE_OWNED_ROUTES`).
//
// El guard se escribe sobre LA AUSENCIA: `satisfies Record<AdapterKind, IngestMode>` hace que un
// `AdapterKind` nuevo **no compile** hasta declarar su modo — un adapter nuevo nace en rojo. El
// complemento en runtime (una lista independiente de kinds + el chequeo de que el provider llame a
// `ingestModeFor`) vive en `adapter-ingest-mode.test.ts`.
export type IngestMode = 'raw-line' | 'eid';

export const ADAPTER_INGEST_MODE = {
  manual: 'eid',
  mock: 'eid',
  simulator: 'eid',
  'web-serial': 'raw-line',
  'spp-android': 'raw-line',
  // GATED (R8.7). Un keyboard-wedge tipea los dígitos del EID (y un Enter), no la trama del lector:
  // no hay STX ni cabecera que desframear. Si algún wedge tipeara la trama completa (el `hidraw on`
  // del emulador), ese lector necesita su propio adapter, no cambiar esta fila.
  'hid-wedge': 'eid',
} as const satisfies Record<AdapterKind, IngestMode>;

/** Modo de ingesta de un adaptador. Total sobre `AdapterKind` por construcción (ver arriba). */
export function ingestModeFor(kind: AdapterKind): IngestMode {
  return ADAPTER_INGEST_MODE[kind];
}

/**
 * Todos los kinds, ENUMERADOS A MANO, para que algo pueda recorrerlos en runtime.
 *
 * Vive acá y no en el test por un motivo concreto: `app/tsconfig.json` EXCLUYE `**​/*.test.ts`, así que
 * una aserción de tipos escrita en un test **no la chequea nadie** (node:test solo borra los tipos). El
 * ancla de exhaustividad tiene que estar en un archivo que el typecheck sí mire.
 */
export const ADAPTER_KINDS = [
  'manual',
  'mock',
  'web-serial',
  'spp-android',
  'hid-wedge',
  'simulator',
] as const satisfies readonly AdapterKind[];

// EXHAUSTIVIDAD en tiempo de compilación: si `AdapterKind` gana un miembro que no está en
// `ADAPTER_KINDS`, `Exclude<…>` deja de ser `never` y esta asignación NO COMPILA.
type KindMissingFromList = Exclude<AdapterKind, (typeof ADAPTER_KINDS)[number]>;
const _adapterKindsAreExhaustive: KindMissingFromList extends never ? true : never = true;
void _adapterKindsAreExhaustive;
