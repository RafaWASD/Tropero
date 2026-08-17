// La LISTA DE PROTOCOLOS MFi del build y el gate del binding `mfi-ios` (RBM4.2/4.4/4.5, RBM5.5;
// delta ios-ble-mfi T4.2). PURO respecto de RN/expo: la única I/O es un `require` PEREZOSO de
// `expo-constants` dentro de un try/catch (patrón `demo-gate.ts`), así que este módulo se importa
// desde node:test sin arrastrar expo.
//
// ── QUÉ GATEA Y POR QUÉ NO ES CÓDIGO MUERTO ──────────────────────────────────────────────────────
// El camino iOS "de fábrica" de los lectores que el cliente ya tiene (RS420, SRS2i, XRS2i) es MFi /
// ExternalAccessory, y para abrir una sesión con un accesorio iAP el build tiene que DECLARAR su cadena
// de protocolo en `UISupportedExternalAccessoryProtocols`. Esa cadena la entrega el fabricante (trámite
// MFi, canal Facundo) y **no la tenemos**: hoy la clave está declarada VACÍA. Inventarla sería mentirle
// al SO y no habilitaría ningún accesorio (RBM4.6).
//
// Entonces el delta deja el camino PREARMADO y GATEADO POR DATOS: el día que llegue la cadena, el diff
// es una línea en `app.config.ts` + una `TransportCapability` `{kind:'mfi'}` en el driver del
// fabricante. **Cero código** (RBM4.7) — y eso está probado con una cadena SINTÉTICA inyectada, que es
// la única forma de demostrarlo sin tener el dato real.
//
// ── POR QUÉ LA LISTA ENTRA INYECTADA Y NO SE LEE ADENTRO DEL MOTOR (RBM5.5) ──────────────────────
// `selectReaderBinding` es lógica pura y determinística (RMV2.6/RMV2.8): con las mismas entradas, el
// mismo binding. Si leyera `Constants` adentro, su resultado dependería del entorno y dejaría de ser
// testeable sin device — que es justo la propiedad que el motor de selección compró. Por eso la lista
// viaja como una entrada más de `BindingEnv`, igual que `platformOS` y `builtAdapters`.

import type { ReaderDriver } from './driver-types';

/** Clave del `Info.plist` donde iOS espera la lista de protocolos de accesorio declarados. */
export const EA_PROTOCOLS_INFO_PLIST_KEY = 'UISupportedExternalAccessoryProtocols';

/**
 * Las cadenas de protocolo iAP que ESTE build declara. `[]` cuando no hay ninguna (el estado de hoy),
 * cuando no estamos en un runtime con expo, o cuando lo leído no es una lista de strings.
 *
 * FAIL-CLOSED por partida doble: cualquier falla devuelve `[]` → `mfiAvailability` responde
 * `build-sin-protocolos` → el binding queda `available:false` y **nadie intenta abrir una sesión que
 * fallaría** (RMV3.7). Un fallback optimista acá sería un CTA que promete y no cumple.
 *
 * ⚠️ Lee `Constants.expoConfig` y **no** `NativeModules`: leer ese global INSTANCIA el módulo nativo en
 * bridgeless, y el `init()` de `react-native-bluetooth-classic` hace un force-cast `as! [String]` sobre
 * esta misma clave (RBM4.2). `expoConfig` es el manifiesto ya resuelto — no toca ningún módulo nativo.
 */
export function declaredEaProtocols(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-constants') as { default?: { expoConfig?: unknown } };
    return eaProtocolsFromExpoConfig(mod?.default?.expoConfig);
  } catch {
    return [];
  }
}

/**
 * La RUTA dentro del manifiesto, separada y exportada. Es la mitad que un test PUEDE ejercitar contra la
 * config REAL de la app (`app.config.ts` es una función pura de `process.env`, importable en node:test), y
 * por eso está afuera del `require`: en node no hay runtime de expo, así que un test sobre
 * `declaredEaProtocols()` solo puede ver el camino fail-closed y **no probaría la ruta**.
 *
 * Y la ruta es justo lo que se puede romper en silencio: si la clave se mueve en `app.config.ts` (a las
 * props de un plugin, a `ios.entitlements`, a `extra`) o si acá se lee otra rama, esta función devuelve
 * `[]` PARA SIEMPRE — incluso el día que la cadena del fabricante esté declarada — y RBM4.7 ("cero código
 * ese día") deja de ser cierto sin que nada se ponga rojo. El test le pasa la config real con una cadena
 * sintética agregada: eso es EXACTAMENTE el diff de ese día, ejecutado.
 */
export function eaProtocolsFromExpoConfig(expoConfig: unknown): string[] {
  const plist = (expoConfig as { ios?: { infoPlist?: Record<string, unknown> } } | null | undefined)?.ios
    ?.infoPlist;
  return eaProtocolsFrom(plist?.[EA_PROTOCOLS_INFO_PLIST_KEY]);
}

/**
 * La mitad PURA de `declaredEaProtocols`: valida la forma de lo leído. Está separada y exportada porque
 * es la parte que se puede falsificar sin un runtime de expo — en node:test `require('expo-constants')`
 * no devuelve un manifiesto, así que un test sobre la función completa solo ejercita el camino
 * fail-closed y no probaría NADA del filtrado (una lista con un número adentro, un valor que no es
 * array, la clave ausente).
 */
export function eaProtocolsFrom(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/**
 * Por qué un binding MFi NO está disponible. Son TRES motivos y no un `null`, porque tienen tres
 * lecturas y tres acciones distintas —y desde la UI se ven exactamente igual (nada)—:
 *   · `driver-sin-mfi`        → este lector no habla MFi. Normal: no hay nada que arreglar.
 *   · `build-sin-protocolos`  → el build no declara NINGUNA cadena (el estado de hoy). Falta el dato
 *                               del fabricante (trámite MFi).
 *   · `protocolo-no-declarado`→ el driver declara una cadena que este build NO tiene en el plist. Es un
 *                               error de CONFIGURACIÓN nuestro, no del fabricante: falta la línea en
 *                               `app.config.ts`. Es el motivo que hace diagnosticable el día que la
 *                               cadena llegue y alguien la ponga en un solo lado de los dos.
 */
export type MfiUnavailableReason = 'driver-sin-mfi' | 'build-sin-protocolos' | 'protocolo-no-declarado';

export type MfiAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: MfiUnavailableReason };

/**
 * ¿Este driver puede hablar MFi en ESTE build? (RBM4.4/RBM4.5.) PURA: el driver y la lista declarada
 * entran por parámetro.
 *
 * La comparación de la cadena es EXACTA (case-sensitive, sin trim de lo declarado): el `protocolString`
 * es un identificador de bundle inverso que el SO matchea literalmente contra el del accesorio, así que
 * "casi igual" no abre ninguna sesión — y una comparación laxa acá diría `available:true` sobre un
 * plist que iOS va a rechazar, que es peor que decir la verdad.
 */
export function mfiAvailability(driver: ReaderDriver, declared: readonly string[]): MfiAvailability {
  const cap = driver.transports.find((t) => t.kind === 'mfi');
  if (!cap || cap.kind !== 'mfi') return { available: false, reason: 'driver-sin-mfi' };
  if (declared.length === 0) return { available: false, reason: 'build-sin-protocolos' };
  if (!declared.includes(cap.params.protocolString)) {
    return { available: false, reason: 'protocolo-no-declarado' };
  }
  return { available: true };
}
