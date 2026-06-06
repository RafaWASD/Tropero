# Security review (Gate 2, modo `code`) — feature 04 `04-bluetooth-baston`

**Veredicto: PASS**

**Baseline**: `6d5c96f` (de `progress/impl_04-bluetooth-baston.md` línea 1).
**Diff auditado**: feature 04 únicamente. Todo el código BLE está untracked (`?? app/src/services/ble/*`) + `scripts/ts-ext-resolver.mjs` (untracked) + `scripts/run-tests.mjs` (M). NO se auditó la feature 2 de la otra terminal (`feature_list.json`, `progress/current.md`, specs/04 docs no son código de runtime — fuera de foco de security).
**Skill Sentry**: NO ejecutada (capa frontend pura, sin remoto; instrucción explícita del leader). Cobertura por revisión manual del data-flow.

## Naturaleza de la capa (superficie acotada)

Frontend puro: TypeScript de cliente (`app/src/services/ble/`) + un hook de resolución de imports para tests Node. **Sin migraciones, RLS, Edge Functions, schema, ni red.** La suite entera corre sin keys de Supabase (lo demuestra `offline-noread.test.ts` por construcción). El único input externo es el EID que llega del bastón / web-serial / tipeo manual; el único storage es `expo-secure-store`/`localStorage` para el deviceId recordado.

## FOCO 1 — Validación de input (dominio INPUT / F1) — OK

El EID es input externo no confiable que fluye a spec 09 (find-or-create → DB). Tracé los dos paths y **ambos validan antes de entregar el tag al consumidor**:

- **Path stream** (web-serial → `WebSerialAdapter.emitTag` → provider `handleReading(raw, isRawStream=true)` → `engine.processRawLine` → `ingestRawLine`):
  - `parseRs420Line` (`parser-rs420.ts:48`) usa regex anclada a inicio+fin `^1000000(\d{15})\d{12}$`. Por anclaje, cualquier línea parcial/basura, EID de largo distinto a 15, o contenido no numérico, da `null` → `{ok:false, reason:'parse_failed'}`. Nunca tira.
  - `isValidTag` (`parser-rs420.ts:72`) re-valida `^\d{15}$`. Doble guard.
- **Path limpio** (manual/mock → provider `handleReading(eid, isRawStream=false)` → `engine.processEid` → `ingestEid`):
  - `ingestEid` (`contract.ts:56`) hace `typeof raw !== 'string'` guard + `normalizeTag` + `isValidTag` (15 dígitos). Un tipeo que no es EID válido se rechaza acá (`contract.ts:60`).

- **Gate de confirmación pre-commit (R2)**: real. El contrato NO commitea por su cuenta; `EidIngestEngine.processX` devuelve el candidato y es el overlay de spec 09 quien confirma antes del find-or-create (`contract.ts:78-93`, `BleStickListenerProvider.tsx:136-140`). El provider entrega el string ya validado+des-duplicado.

- **No hay path de bypass**: la ÚNICA salida del provider hacia el consumidor es `for (const cb of tagSubscribersRef.current) cb(candidate.eid)` en `BleStickListenerProvider.tsx:140`, y está aguas abajo del chequeo `if ('rejected' in candidate)` (línea 125) y `if (candidate === null)` (línea 121). No existe otro `cb(...)` que entregue el tag crudo sin pasar por `engine.processRawLine`/`processEid`. Verificado con lectura de `stick.ts` (el hook `useBleStickListener` solo reexpone `subscribeTagRead`, no inyecta tags).

- **Parseo de bytes crudos (web-serial) seguro**: `WebSerialAdapter.readLoop` usa `TextDecoder.decode(value, {stream:true})` (`adapter-web-serial.ts:142`) — manejo correcto de bytes UTF-8 partidos entre chunks. `LineFramer.push` (`line-framer.ts:18`) es concatenación de strings + `indexOf('\n')` + `slice` — sin aritmética de índices de bytes, sin buffers de tamaño fijo, sin posibilidad de overflow/inyección. Líneas vacías se descartan (`line-framer.ts:25`). El framing entrega líneas crudas al parser, que las ancla con regex → un atacante que controle el stream serial NO puede inyectar nada más allá de un EID de 15 dígitos numéricos válido, que es exactamente el dato esperado.

## FOCO 2 — `scripts/ts-ext-resolver.mjs` (supply-chain / secrets) — OK, inofensivo

Hace **solo resolución de specifiers**: intercepta `module.registerHooks().resolve`, y para specifiers relativos sin extensión reintenta agregando `.ts` vía `nextResolve` (`ts-ext-resolver.mjs:20-47`). No ejecuta código externo, no abre red, no lee secrets/env, no hace `eval`/`Function`, no llama `child_process`. Sus únicos imports son `node:module`, `node:fs` (`existsSync`), `node:url` (`fileURLToPath`) — todos de stdlib, usados para chequear existencia del archivo candidato. Solo afecta el harness de `node --test`; no toca Metro ni el bundle de la app. Confirmado inofensivo.

## FOCO 3 — Logging (dominio B) — OK, sin datos sensibles

`logging.ts` loguea SOLO metadata de transporte: `connection_changed{connected}`, `reconnect_attempt{attempt}`, `eid_rejected{reason}`, `read_loop_error{message}`, `connect_error{message}` (`logging.ts:9-14`). **El EID nunca se loguea** — `eid_rejected` registra solo el motivo (`parse_failed`/`invalid_eid`/`empty`), no el valor. No hay tokens, credenciales ni PII. El canal es `console.info` envuelto en try/catch (`logging.ts:20-28`). Nota: aun cuando el EID NO es PII en RAFAQ (lo aclara el prompt), el diseño ya evita loguearlo, lo cual es correcto.

## FOCO 4 — `permissions.ts` — OK, no over-permission

Módulo declarativo puro: mapea cada `kind` de adaptador a su `PermissionModel` (`permissions.ts:19-31`). En esta capa buildable-hoy **no se solicita ningún permiso**: manual/mock → `{kind:'none'}`, web-serial → `{kind:'browser'}` (gesto `requestPort`, lo gobierna el navegador). Los permisos `android-bluetooth` (`BLUETOOTH_SCAN/CONNECT`) son del adaptador spp-android, que es Fase 4 y **no se monta** en este run (`adapter-selection.ts:38` devuelve `'manual'` en native; `BleStickListenerProvider.tsx:74-77` retorna `null` para spp-android/hid-wedge). No hay sobre-pedido de permisos. `permissionDenialBlocksApp()` siempre `false` (manual-first nunca bloquea) — correcto.

## Hallazgo menor de higiene (no-finding, informativo)

- **`remembered-device.ts`** usa el patrón de storage canónico correcto (native → `expo-secure-store`, web → `localStorage`) y **sanitiza** el deviceId con whitelist `[^A-Za-z0-9._:-]` antes de persistir (`remembered-device.ts:13-15`). El valor guardado es un id de puerto/device, no un secreto. Sin objeción. (C3 data-at-rest: el único dato local que toca esta capa es el deviceId; SecureStore es el lugar correcto.)
- **`adapter-spp-android.ts`** es placeholder que tira `Error` claro si se instancia (`adapter-spp-android.ts:17`), y no se monta. `adapter-hid-wedge.ts` (GATED R8.7) nunca lo elige `selectTransportAdapter`. Correcto — fail-loud, no fail-silent.

## Findings HIGH de Sentry

Ninguno (skill no corrida; revisión manual no encontró equivalentes HIGH).

## Findings RAFAQ-SPECIFIC

Ninguno.

## False positives descartados

- `feedback.ts:33,43` usa `require('react-native')` dinámico. **No es finding**: el specifier es el literal `'react-native'`, no input no confiable; es lazy-import deliberado para que el módulo siga siendo importable bajo `node:test` sin arrastrar RN. No hay require de path controlado por atacante.
- Coincidencias de `establishment`/`supabase`/`fetch` en el grep son todas comentarios o el test que **verifica la ausencia** de red (`offline-noread.test.ts:2-18`). Ningún módulo de la capa importa supabase/fetch ni lee `establishment_id`.

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| EID vía stream (web-serial / spp-android futuro) | 15 dígitos numéricos, header fijo `1000000` + 12 díg timestamp, regex anclada start+end | server-equivalente client-side autoritativo: `parseRs420Line` + `isValidTag` antes de entregar a spec 09; spec 09 + DB son la frontera autoritativa final | OK |
| EID/identificador vía manual (tipeo) | 15 dígitos numéricos (si se canaliza como EID) | `ingestEid` → `normalizeTag` + `isValidTag`; los no-EID (IDV/visual) los resuelve spec 09 por otra puerta, no este contrato | OK |
| EID vía mock (inyección dev/CI) | mismo que limpio | mismo path `processEid` → `ingestEid` | OK |
| deviceId recordado (storage) | whitelist `[A-Za-z0-9._:-]`, resto → `_` | `safe()` sanitiza antes de persistir | OK |

Esta capa NO expone formularios/buscadores HTTP propios; el find-or-create y su UI son de spec 09. El único input es el EID, acotado y validado en cada path. Cumple el requisito de "límite claro + validación por campo".

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| ingesta de lecturas del bastón | n.a. (dedup por-TAG ~3s) | per-EID | n.a. | `TagDedup` (`dedup.ts`) no es seguridad, es UX anti-doble-escaneo; no hay endpoint que rate-limitear acá. El abuso a escala del find-or-create lo gobierna spec 09 / DB. |
| reconexión web-serial | backoff exponencial 500ms→8s | per-adapter instance | n.a. | `backoffDelayMs` (`line-framer.ts:59`) + guard `reconnectScheduled` evita loops paralelos. Local, sin red. |

No hay acciones de red/email/SMS/API-externa/bulk en esta capa → rate limiting server-side N/A. Se documenta como descartado conscientemente.

## Dominios del Catálogo NO aplicables (justificación)

- **A (authz / RLS / service-role / mass assignment / IDOR)**: N/A — la capa no toca backend, no usa `createAdminClient`, no hace `.insert/.update`, no lee `establishment_id`. La autorización del find-or-create es de spec 09.
- **B2/B3 (PII en logs / over-fetch)**: N/A — sin PII, sin queries. B1 (info disclosure): N/A — sin respuestas de servidor; `err.message` solo va a `console.*` local (`logging.ts`), nunca a un cliente remoto.
- **C (offline-sync / PowerSync / Realtime)**: N/A — PowerSync no wired; la capa no sincroniza. C3 cubierto parcialmente (deviceId en SecureStore, correcto).
- **D (secrets / supply-chain / CI)**: parcial — D1/D3 verificados (sin service_role, sin secrets, sin hardcode). D2 (Deno imports): N/A (no es Deno). El hook `ts-ext-resolver.mjs` revisado y limpio.
- **E (abuso a escala)**: N/A en esta capa (sin endpoints); el dedup local mitiga doble-escaneo accidental.
- **F2/F3/F4 (CSV/SSRF/email)**: N/A — sin import de archivos, sin `fetch`, sin templates de email. F1 (filter injection) N/A: el EID no se concatena en `.or()/.filter()` acá (eso es spec 09, y el EID llega ya validado a 15 dígitos numéricos).
- **G (BLE trust boundary)**: parcialmente activo y CUBIERTO. G1 (input no confiable validado): OK — el EID del bastón pasa por `parseRs420Line`+`isValidTag` (formato FDX-B 15 díg). G3 (no-autopersistencia): OK — una lectura BLE no se vuelve verdad sin el gate de confirmación pre-commit (R2). G2 (canal Nordic UART abierto / peripheral rogue): el modelo de confianza del transporte físico (SPP/UART sin autenticación) es de Fase 4 (spp-android, no construido en este run) y queda documentado en ADR-024 — la mitigación de integridad presente es que **toda lectura, venga de donde venga, se valida (G1) y requiere confirmación humana (G3)** antes de tocar datos, así un peripheral rogue solo puede inyectar EIDs de 15 dígitos que el operario debe confirmar visualmente. No es finding en esta capa.
- **H (auth/sesión)**: N/A — la capa no maneja auth/JWT/sesiones.
- **I (compliance / mobile hardening)**: N/A en esta capa (sin pantallas sensibles propias; I3 FLAG_SECURE es de las pantallas de spec 09).

## Archivos analizados

`app/src/services/ble/`: `contract.ts`, `parser-rs420.ts`, `dedup.ts`, `line-framer.ts`, `adapter-web-serial.ts`, `adapter-manual.ts`, `adapter-mock.ts`, `adapter-spp-android.ts` (placeholder), `adapter-selection.ts`, `BleStickListenerProvider.tsx`, `stick.ts`, `connection-status.ts` (vía referencias), `permissions.ts`, `logging.ts`, `feedback.ts`, `feedback-pref.ts` (vía referencias), `remembered-device.ts`, `config.ts`, `stick-adapter.ts` (vía tipos). Más `scripts/ts-ext-resolver.mjs`. Tests revisados por nombre/cobertura (no son superficie de ataque de producción).

## Cobertura indirecta de Deno / RLS / PowerSync / BLE

- **Deno / Edge Functions**: no aplica (capa frontend; sin EFs en el diff).
- **RLS**: no aplica (sin migraciones).
- **PowerSync / Realtime**: no wired; la capa no sincroniza. Cuando spec 09 conecte el find-or-create a la DB, ese gate de security correrá sobre spec 09, no sobre 04.
- **BLE**: cubierto por revisión manual del data-flow (G1/G3 OK; G2 diferido a Fase 4 spp-android, documentado en ADR-024). El transporte físico real (SPP-Android) NO está en este run — su modelo de confianza de canal se auditará cuando se construya.

## Conclusión

PASS. La capa buildable-hoy de feature 04 valida todo input externo (EID) antes de entregarlo al consumidor, requiere confirmación humana pre-commit, no loguea datos sensibles, no pide permisos de más, y el hook de tests es inofensivo. No hay findings HIGH ni MEDIUM. Queda registrado que el modelo de confianza del canal BLE físico (G2) se audita en Fase 4 (spp-android), fuera de este run.
