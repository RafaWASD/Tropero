# Review - Spec 04 DELTA multivendor + seleccion + demo

Reviewer: reviewer (Opus 4.8). Fecha: 2026-07-20.
Baseline: working tree SIN commitear sobre HEAD 672149b (el brief citaba b3996ed; el HEAD real es 672149b). El arbol contiene ademas cambios de OTRA terminal (feature 20 reactividad-sync + establishments/contexts/admin/local-reads/specs 01/15/20), FUERA de scope, no revisados.
Runs: impl_04-multivendor-services.md (MV.0-MV.3 + codigo MV.5) + impl_04-multivendor-ui.md (MV.4).

## Veredicto: CHANGES_REQUESTED

El codigo es correcto, prod-safe y verde (typecheck exit 0; 132/132 tests). El UNICO bloqueo es de RECONCILIACION DE SPECS (regla dura correcciones-se-reflejan-en-specs / paso 6): el refinamiento del demo-gate que agrego la 3ra via de habilitacion (isE2eDemoAllowed bajo la marca E2E) -- hecho por el run UI (impl-2) en autorrevision/Gate 1 -- NO se folio en los 3 documentos de spec que describen la formula del gate. Las specs quedaron describiendo dos disyuntos (dev O explicitDemoBuild) mientras el as-built tiene tres. Es un caso textual de el design quedo mintiendo sobre un gate critico de integridad SENASA. El implementer reconcilia; no toco codigo.

## Verificacion (read-only, network-free)

- cd app && pnpm typecheck -> VERDE (exit 0).
- node --import ts-ext-resolver.mjs --test app/src/services/ble/*.test.ts app/src/features/ble-stick/*.test.ts -> 132/132 pass, 0 fail (exit 0).
- NO se corrio check.mjs (DB compartida + otra terminal activa; instruccion explicita del brief; su verde end-to-end lo corre el leader en Puerta 2). NO se corrio E2E (Gate 2.5).

## Trazabilidad RMV vs test (buildable-hoy)

- RMV1.1/1.2 tipos -> driver-registry.test.ts + selection-priority.test.ts mfi-only (protocolString declarable). OK
- RMV1.3 RS420 primer driver reusa parseRs420Line -> driver-registry.test.ts RMV1.3 (frameParser.parse === parseRs420Line). OK
- RMV1.4 registro + driverByVendorId -> driver-registry.test.ts RMV1.4. OK
- RMV1.5 findDriverForDevice por nombre/UUID -> driver-registry.test.ts RMV1.5 x2. OK
- RMV1.6 aditividad -> driver-registry.test.ts RMV1.6 (registry sintetico inyectado). OK
- RMV1.7 device desconocido -> null -> driver-registry.test.ts RMV1.7 x3. OK
- RMV2.1 tabla prioridad -> selection-priority.test.ts RMV2.1. OK
- RMV2.2 adapterForTransport -> selection-priority.test.ts RMV2.2. OK
- RMV2.3/2.4 selectReaderBinding + available -> RMV2.3/2.4 android/web. OK
- RMV2.5 RS420 iOS -> null (NO hid-wedge) -> RMV2.5 + SPP-only web/iOS -> null. OK CRITICO
- RMV2.6 puro/determinista -> RMV2.6. OK
- RMV2.7 regresion selectTransportAdapter -> RMV2.7 regresion (auto/mock/manual identicos al as-built). OK CRITICO
- RMV2.8 ambiguedad determinista -> RMV2.8 SPP+HID -> spp; iOS -> HID. OK
- RMV3.4 estados con CTA -> connection-view.test.ts RMV3.4 x3. OK
- RMV3.6 no bloqueante -> connection-view.test.ts (subtitulos -> mano) + box-none. OK
- RMV3.7 available false, no conecta -> connection-view.test.ts RMV3.7 x2. OK
- RMV3.8 no reconocido -> connection-view.test.ts RMV3.8 x2. OK
- RMV2.5-UI recognized-unreachable -> connection-view.test.ts RMV2.5. OK
- RMV3.1/3.2/3.3/3.5 screen/flujo/remembered/indicador -> wiring por codigo + typecheck verde; render real -> Gate 2.5. Logica de vista en connection-view.test.ts. OK codigo / pendiente Gate 2.5
- RMV4.1 SimulatorAdapter kind+connect -> adapter-simulator.test.ts RMV4.1. OK
- RMV4.2 emit -> mismo contrato -> adapter-simulator.test.ts RMV4.2 x3 (EidIngestEngine, N distintos, isValidTag). OK
- RMV4.3 triple-guard 1 -> selection-priority.test.ts RMV4.3 nunca simulator salvo demo (x4 OS x3 modos). OK CRITICO
- RMV4.4 triple-guard 2 gate -> demo-gate.test.ts (sin marca/prod/dev+marca/E2E/override/estricto true). OK prod-safe
- RMV4.5 triple-guard 3 -> demo-gate.test.ts + re-chequeo en instantiateTransport + DemoControls. OK
- RMV4.6 marca DEMO -> connection-view.test.ts RMV4.6 readingBadge. OK
- RMV4.7 integridad SENASA -> demo-gate.test.ts RMV4.7 prod sin flags -> false + selection RMV4.3. OK CRITICO
- RMV4.8 confirmacion pre-commit -> adapter-simulator.test.ts wireSimToEngine (validate+dedup+commit). OK
- RMV5.1/5.2/5.3/5.7 SPP escrito/driver-param/framing/baud-indep -> adapter-spp-android.test.ts RMV5.2 x3 + RMV5.3 framing -> EID. OK codigo
- RMV5.4 pairing/remembered -> codigo (require perezoso); connect sin lib no tira. OK codigo / device-gated
- RMV5.5 reconexion backoff -> adapter-spp-android.test.ts RMV5.5 backoffDelayMs. OK
- RMV5.6 import perezoso NO tira -> adapter-spp-android.test.ts RMV5.6 import no tira + connect sin lib no tira. OK CRITICO
- RMV5.8 veto config plugin -> doc impl_04-multivendor-services.md (RIESGO ALTO new-arch reportado). documentado / gate = dev build
- RMV5.9 device-gated real -> doc. GATED hardware
- RMV6.1/6.2 MFi declarable, adapter null -> selection-priority.test.ts RMV6.1/6.2 mfi-only -> binding null. OK
- RMV6.3 GATT punto de extension -> selection-priority.test.ts RMV6.2/6.3 ble-gatt -> null. OK

Todo RMV buildable-hoy tiene 1 o mas tests concretos. Los gated (RMV5.9, RMV6.2/6.3) y los de render real (RMV3.1/3.2/3.3/3.5) estan documentados como gated / Gate 2.5, consistente con la clasificacion de madurez de la spec.

## Foco del brief

1. Cada RMV cableado end-to-end: OK (tabla). No solo tipos.
2. Regresion selectTransportAdapter: OK VERIFICADO. auto/mock/manual identicos (RMV2.7). La rama demo va antes de la logica de plataforma pero mode=auto nunca la alcanza (adapter-selection.ts lineas 40-53).
3. Triple-guard / integridad SENASA: OK VERIFICADO prod-safe. Guard1: selectTransportAdapter(auto) nunca simulator. Guard2: isDemoMode = marca demo Y isDemoBuildAllowed; en prod (sin __DEV__, sin extra.demoBuild, sin marca E2E) -> false (demo-gate.test.ts RMV4.7). Guard3: instantiateTransport(simulator) y DemoControls re-chequean isDemoMode -> null en prod. El refinamiento E2E-allow SIGUE dando false en produccion (la marca E2E nunca esta en el bundle prod, mismo invariante que ble-e2e-flag.ts).
4. RS420 iOS -> null (no hid-wedge): OK VERIFICADO. driver-rs420.ts declara solo spp+serial; RMV2.5 aseveral null. El caso hid-wedge en iOS se prueba con un driver HID sintetico.
5. Import perezoso: OK VERIFICADO. rn-bluetooth-classic, remembered-device y react-native son require dentro de la I/O; top-level solo tipos + modulos puros. RMV5.6 verifica que importar no tira sin la lib (que NO se instalo).
6. Frontera: OK VERIFICADO. app/src/features contiene SOLO ble-stick (no animals, no find-or-create). No se redefinen tipos de spec 09 (solo extension aditiva del union StickAdapter kind). El toque en _layout.tsx es minimo (mode precedence + Stack.Screen baston + StickStatusIndicator + 2 imports). La supresion del indicador en E2E-no-demo (isNonDemoE2E) protege la regresion de maniobra-identify.spec.ts (que asertaba el texto de estado exact) sin afectar prod ni la captura demo. Ningun archivo de la otra terminal (feature 19/20) tocado por el 04.
7. Offline-first: OK VERIFICADO. Ningun modulo nuevo importa supabase/fetch/establishment_id (grep limpio).
8. UI manga-friendly (codigo): OK taps nativos (onPress+a11y+pressStyle en la MISMA pieza Tamagui, sin Pressable envolvente); anti-recorte (lineHeight matcheado); es-AR voseo; filas con token touchMin. Veto visual real (target 60dp, font, posicion indicador) = Gate 2.5.

## Tasks completas: si (con pendientes justificados)

Buildable-hoy del run (MV.0/1/2/3 + codigo MV.5.2-5.4 + MV.6.1 + MV.4.1-4.6) marcadas [x]. Pendientes con justificacion documentada:
- T-MV.5.1 veto config plugin: veto liviano hecho (RIESGO ALTO new-arch reportado); veto REAL = dev build -> gated.
- T-MV.5.5, T-MV.7.3: GATED por hardware.
- T-MV.6.2: GATED por negocio (MFi, canal Facundo).
- T-MV.6.3: futuro (GATT).
- T-MV.7.1: suites enganchadas en run-tests.mjs (verificado en diff); check.mjs end-to-end lo corre el leader en Puerta 2.
- T-MV.7.2: E2E/component -> Gate 2.5.
- T-MV.7.4: cierre/fold lo hace el leader. NOTA: la reconciliacion de specs de este run quedo INCOMPLETA (ver Cambios requeridos), parte de T-MV.7.4.

## CHECKPOINTS

- C1 harness completo: [x] (check.mjs lo corre el leader en Puerta 2 por DB compartida; no bloqueo).
- C2 estado coherente: [x] (04 in_progress; no se marco done).
- C3 codigo respeta arquitectura: [x] (capas services/features/components; sin deps externas nuevas instaladas -- rn-bluetooth-classic NO instalada, import perezoso; sin establishment_id hardcodeado; sin logs de debug sueltos).
- C4 verificacion real: [x] (1 o mas tests por modulo con logica; fixtures reales; 132/132 verdes).
- C5 sesion cerrada: [ ] (cierre lo maneja el leader; specs NO 100% reconciliadas, ver Cambios requeridos).
- C6 SDD: [ ] (3 archivos presentes; EARS OK; cada RMV con test; PERO design/requirements/tasks contradicen el as-built en la formula del gate -> bloqueo).
- C7 multi-tenant: N/A (no toca DB/tablas/RLS; design seccion 9).
- C8 offline-first: [x] (sin red; 04 solo emite tag_read; consumidor spec 09 sincroniza).
- C9 E2E + visual: [ ] pendiente Gate 2.5 (E2E StickConnectionScreen contra simulador + capturas + veto visual del indicador), lo corre el leader.

## Checklist RAFAQ-especifico

### A. Multi-tenancy / RLS: N/A (el delta no toca tablas ni RLS; solo entrega el tag_read; design seccion 9).

### B. Offline-first: aplica parcial
- [x] Funciona offline (modulos puros/locales; sin supabase/fetch).
- N/A sync bucket (04 no configura buckets; el EID lo consume find-or-create de spec 09).
- N/A conflict resolution (04 no escribe; solo emite).
- [x] No hace requests sincronos a Supabase desde la pantalla (consume el provider global; writeRememberedDevice = storage local).

### C. BLE (Vesta/Allflex): aplica
- [x] Desconexion repentina manejada (adapter-spp-android emite disconnected + backoff foreground-only; connection-view mapea disconnected a un CTA; UI clara).
- [x] Fallback manual en 1 tap (manual-first = piso permanente; filas no-conectables + InfoNote apuntan a carga a mano; blocksManualEntry = false).
- N/A correlacion TAG-peso (ADR-010): este delta no correlaciona con peso; el simulador emite EID solo.
- [x] Logs BLE no bloquean (best-effort logTransportEvent, cubierto por listener-gate.test.ts; simulador/adapter async).

### D. UI de campo: aplica (codigo; veto visual = Gate 2.5)
- [x] Taps nativos (sin Pressable envolviendo Tamagui con pressStyle).
- [x] Anti-recorte de descendentes (lineHeight matcheado).
- [ ] Target 60dp / font 18pt / posicion indicador: DEFER a Gate 2.5 (veto visual real). Codigo: contenido operario-critico (label y EID en token grande) es legible; hints en token menor; token touchMin en filas. No bloqueo de codigo.
- [x] Estado de loading visible (connecting/scanning con icono + label).
- [x] Una decision por pantalla (pantalla de config/estado, no wizard de carga).

### E. Edge Functions: N/A (100% cliente; design seccion 10).

## Cambios requeridos (bloqueantes)

CR-1: Reconciliar la 3ra via del gate demo (isE2eDemoAllowed) en los 3 documentos de spec.

El run UI (impl-2) amplio app/src/services/ble/demo-gate.ts (lineas 76-78) a: isDemoBuildAllowed = isDevEnv O isExplicitDemoBuild O isE2eDemoAllowed, donde isE2eDemoAllowed (lineas 58-68) lee la marca __RAFAQ_BLE_E2E__ estricta true (override __RAFAQ_BLE_DEMO_ALLOW_E2E__). Es un 3er disyunto real, testeado en demo-gate.test.ts. Pero las specs describen la formula con SOLO 2 disyuntos:

- design-multivendor.md seccion 5 Guard 2, LINEA 218: isDemoBuildAllowed = (__DEV__ estricto true) O isExplicitDemoBuild -> STALE, falta O isE2eDemoAllowed. Ademas la linea 234 y la Alternativa B (linea 309) afirman que el gate es independiente del de E2E / separarlos mantiene cada superficie en su gate -- en tension con el as-built (la mitad build-allowed ahora se apoya en la marca E2E). Agregar nota de reconciliacion: la MARCA demo sigue separada (__RAFAQ_BLE_DEMO__) pero el build-allowed toma la senal no-prod de E2E para las capturas.
- requirements-multivendor.md RMV4.4, LINEA 90: disponible solo en entorno de dev (__DEV__) o en un build de demo explicito -> incompleto. Sumar la via E2E/captura (contexto no-prod) manteniendo la garantia dura de nunca en produccion/preview.
- tasks-multivendor.md T-MV.3.1, LINEA 47: isDemoBuildAllowed = (__DEV__ estricto true) O isExplicitDemoBuild -> STALE (misma formula de 2 disyuntos). Su propia nota de reconciliacion quedo vieja tras el refinamiento posterior de impl-2.

Es la direccion codigo -> spec del paso 6 / regla dura correcciones-se-reflejan-en-specs. El codigo es correcto y prod-safe (verificado); solo falto foldear el fix al source-of-truth. El implementer reconcilia (parte de T-MV.7.4). NO es un cambio de codigo.

## Nota (no bloqueante)

El brief cito baseline b3996ed; el HEAD real es 672149b. El working tree mezcla cambios de otra terminal (feature 20) fuera de scope; el leader los maneja en su commit. El indicador global se suprime en E2E-no-demo por diseno (protege la regresion existente); su cobertura E2E real es en modo demo en Gate 2.5.
