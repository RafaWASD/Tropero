# Gate 2 (Security) — feature 04, delta «multivendor + selección + demo»

**Modo**: `code` · **Analista**: security_analyzer · **Fecha**: 2026-07-20
**Baseline**: `672149bb0ab0c9dedc35a32ce81cef7b43d69b37` (= HEAD; delta 100% en working tree sin commitear)
**Skill**: `sentry-skills:security-review` (metodología aplicada: trace data flow + verify exploitability antes de reportar)

## Veredicto: **PASS**

No hay findings HIGH. La integridad SENASA del modo demo está estructuralmente protegida por el triple-guard, verificada contra el código real (no solo contra la intención declarada). Cero superficie de red/DB/RLS/Edge Functions (delta 100% cliente). Sin secretos ni fugas de EID/device en logs. Sin nuevos inputs de usuario de texto libre; todo EID que puede entrar al pipeline lo valida el contrato autoritativo (`isValidTag`), que la UI nueva no puentea.

---

## 1. Integridad SENASA del modo demo (foco #1 — LO MÁS IMPORTANTE)

**Conclusión: el triple-guard es airtight en producción. No existe camino para instanciar el `SimulatorAdapter` en un build de prod → ningún EID sintético puede declararse como real.**

Trazado del data-flow del simulador y verificación de cada guard contra el código:

| Guard | Dónde | Qué exige | Verificación |
|---|---|---|---|
| 1 · selección | `adapter-selection.ts:45` `selectTransportAdapter` | devuelve `'simulator'` SOLO si `env.mode === 'demo'` | El host (`_layout.tsx:634`) pasa `mode` = `isDemoMode() ? 'demo' : …`. `mode='auto'` (default prod) nunca alcanza la rama demo. |
| 2 · gate | `demo-gate.ts:87` `isDemoMode()` | `__RAFAQ_BLE_DEMO__===true` **Y** `isDemoBuildAllowed()` | `isDemoBuildAllowed` = `__DEV__ \|\| extra.demoBuild===true \|\| isE2eDemoAllowed()`. Los tres son **false en prod** (ver evidencia abajo). |
| 3 · instanciación | `BleStickListenerProvider.tsx:93` `instantiateTransport('simulator')` | re-chequea `isDemoMode()`; si false → `null` | Aunque un caller forzara `'simulator'`, sin `isDemoMode()` no se construye el adapter. |

**Evidencia de que las marcas NO se filtran a producción (verificación de agujeros pedida en el brief):**

- **`__RAFAQ_BLE_DEMO__`**: `grep -rn "__RAFAQ_BLE_DEMO__\s*="` sobre todo el repo → **cero asignaciones** (ni en `app/src`, ni en `app/app`, ni siquiera en `app/e2e` todavía). Solo se LEE en `demo-gate.ts`. No hay ningún código que lo setee, y menos desde UI/input/deep-link/query-param.
- **`__RAFAQ_BLE_E2E__`**: todas las asignaciones (`= true`) viven exclusivamente en `app/e2e/**` (specs + captures de Playwright, vía `addInitScript` antes del bundle). **Ninguna** en `app/src/**` ni `app/app/**`. El bundle de producción no incluye `app/e2e/`. No hay lectura de query-param/URL hacia este global (el único lector de producción, `ble-e2e-flag.ts`, solo hace `globalThis[KEY] === true`).
- **`extra.demoBuild`**: `app.config.ts:95` `extra` contiene solo `{ router, eas.projectId }`. No existe `demoBuild`. `isExplicitDemoBuild()` → false en todo build actual. `eas.json` tampoco lo define.
- **`__DEV__`**: false en release/preview de Expo por construcción.

**Doble marca AND (defensa en profundidad real):** aun si UNA marca se filtrara, `isDemoMode()` exige `__RAFAQ_BLE_DEMO__===true` **Y** un build permitido. Son dos globals independientes, ambos puestos solo por Playwright antes del bundle. Un atacante no puede setear globals pre-bundle desde la UI, un deep-link, o un query-param (no hay código que copie input→global).

**Widening de `isDemoBuildAllowed()` con `isE2eDemoAllowed()` (cambio nuevo de la fase UI):** no debilita prod. En una corrida E2E de OTRAS features (`__RAFAQ_BLE_E2E__=true`, sin `__RAFAQ_BLE_DEMO__`), `isDemoBuildAllowed()` pasa a true pero `isDemoMode()` sigue false (falta la marca demo) → cae a `mock`/`manual` como hoy (regresión intacta). En prod, `__RAFAQ_BLE_E2E__` no existe → sin efecto.

**Marca "DEMO" (RMV4.6):** el badge visual (`connection-view.readingBadge`, `StickConnectionScreen` ReadRowView) es honestidad de UX durante la demo, NO el control de integridad. El control real es estructural (el simulador no existe en prod). Correcto: no se depende de un badge para la integridad regulatoria.

---

## 2. Validación de input (foco #2)

**Este delta NO agrega ningún campo de texto libre, buscador, ni entrada manual de EID.** Los únicos "inputs" de la UI nueva son gestos sobre botones/filas:

- `StickConnectionScreen`: back, CTA connect/disconnect (sin texto), elegir device → `writeRememberedDevice(binding.driver.vendorId)` donde `vendorId` es la **constante** `'allflex-rs420'` del driver (no input de usuario).
- `DemoControls`: `onSimulate` → `simulator.emit()` **sin argumento** → EID sintético generado internamente; `onToggleAutoPlay`. No hay input de usuario que llegue a `emit()`.

**Frontera con el contrato autoritativo:** todo EID —simulador, web-serial (stream crudo), spp-android (stream crudo), manual/mock— entra por `handleReading()` → `EidIngestEngine.processEid`/`processRawLine` → `ingestEid`/`ingestRawLine` → **`isValidTag`** (`parser-rs420.ts:72`: exactamente 15 dígitos + prefijo válido; regex anclada `^\d{15}$`). La UI nueva no expone ningún camino que salte el contrato. El "server" acá (el contrato de ingesta + el motor find-or-create de spec 09, que scopea por establishment activo) sigue siendo el validador autoritativo. **PASS.**

`SimulatorAdapter.emit(eid?)` acepta un EID explícito opcional, pero (a) ningún caller le pasa input de usuario, y (b) aun si lo hiciera, pasa por el contrato (`processEid` → `isValidTag`). No es un bypass.

---

## 3. Import perezoso / carga de módulo nativo (foco #3)

Todos los `require()` dinámicos usan **string literal fijo**, sin interpolación ni input:
- `adapter-spp-android.ts:49` `require('react-native-bluetooth-classic')`
- `adapter-spp-android.ts:179` `require('react-native')` (AppState)
- `adapter-spp-android.ts:191/201` `require('./remembered-device')`
- `demo-gate.ts:42` `require('expo-constants')`

Sin path traversal, sin require de string controlado por input, todos envueltos en try/catch (fail-soft). **Sin riesgo.**

---

## 4. Secrets / logs (foco #4)

- **Logs**: `logging.ts:25` `console.info('[ble]', event.kind, JSON.stringify(event))`. Los `TransportLogEvent` NUNCA contienen el valor del EID ni el address del device: `eid_rejected` loguea solo el **motivo** (enum `parse_failed|invalid_eid|empty`), `connection_changed` un booleano, `reconnect_attempt` un número. No hay `console.log` de EIDs ni device IDs en ningún archivo nuevo. **Sin fuga.**
- **Secrets**: ninguno hardcodeado. `driver-rs420.ts:26` `pin: '1234'` es el PIN de pairing Bluetooth de fábrica del Allflex RS420 (hardware público, ADR-024 §3) — no es credencial de ningún sistema RAFAQ. No es finding.
- **Data-at-rest (C3)**: `remembered-device` usa `expo-secure-store` (Keychain/Keystore), no AsyncStorage plano — correcto para el device address/marcador recordado.

---

## Findings HIGH de Sentry
Ninguno.

## Findings RAFAQ-SPECIFIC (HIGH)
Ninguno.

## False positives / considerados y descartados (trazabilidad)

| Patrón | Por qué NO es finding |
|---|---|
| `pin: '1234'` (`driver-rs420.ts:26`) | PIN de fábrica del RS420, hardware público (ADR-024). No es credencial de sistema. |
| `isDemoBuildAllowed()` incluye ahora `__RAFAQ_BLE_E2E__` | No debilita prod: `isDemoMode()` exige ADEMÁS `__RAFAQ_BLE_DEMO__`; ambos globals solo los pone Playwright. Ver §1. |
| `require()` dinámico de módulo nativo | String literal fijo, sin input. §3. |
| `SimulatorAdapter.emit(eid?)` acepta EID explícito | Ningún caller pasa input; y pasa por `isValidTag` igual. §2. |
| Lectura de globals `g[E2E_GLOBAL_KEY]` | Es lectura (no escritura de key controlada por input) → sin prototype pollution. |
| Device name crudo en `deviceRowView`/`StickDeviceRow` | Renderiza como `<Text>` de RN (auto-escapado, no HTML) → sin XSS. |

## Tabla de inputs (campos nuevos/modificados que el usuario "tipea")

| campo | límite | validación | OK? |
|---|---|---|---|
| (ninguno de texto libre) | — | — | — |
| Botón "Simular lectura" (DemoControls) | genera EID sintético 15 díg. interno | `isValidTag` (contrato) + demo-gated | ✅ |
| Elegir device (StickDeviceRow) | persiste `vendorId` constante (no input) | n.a. (constante) | ✅ |
| Lecturas de stream (web-serial/spp) | `parseRs420Line` (regex anclada 15+12 díg.) | `isValidTag` server-side-authoritative (contrato) | ✅ |

Este delta no introduce formularios, buscadores ni prompts. No hay entrada de texto libre que puentee el contrato.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| Simular lectura / auto-play | n.a. | n.a. | n.a. | 100% local, sin red/DB/costo. Auto-play = `setInterval` en memoria; `disconnect()` limpia el timer. Solo alcanzable bajo `isDemoMode()` (no-prod). |
| Conectar/desconectar bastón | n.a. | n.a. | n.a. | Transporte local (BLE/serial), sin backend. |

Ninguna acción de este delta pega a email/SMS/API externa/DB ni es bulk → rate limiting no aplica (justificado).

## Catálogo RAFAQ — dominios revisados
- **A (authz service-role / mass assignment / IDOR)**: N/A — sin DB/Edge Functions/service-role. El EID emitido lo consume el find-or-create de spec 09 (fuera de este delta), que scopea por establishment.
- **B (exposición de datos)**: B2 revisado — sin PII en logs (solo enums/booleanos). Sin `err.message` crudo al cliente (no hay backend).
- **C (offline/sync)**: C3 revisado — `remembered-device` en SecureStore. Sin PowerSync/Realtime tocado.
- **F (inyección/SSRF)**: revisado — sin `.or()/.filter()/ilike`, sin `fetch`, sin prompt LLM, sin import de archivos.
- **G (BLE trust boundary)**: G1 lecturas del stick validadas por `parseRs420Line`+`isValidTag`; G3 no-autopersistencia garantizada por el confirm-gate del contrato (spec 09 confirma antes del commit). G2 (canal SPP no autenticado a nivel app): modelo aceptado por ADR-024/ADR-003; el adapter SPP ni siquiera está montado en el provider todavía (`instantiateTransport('spp-android')→null`, device-gated Fase 4) → sin exposición runtime en este build. No es finding nuevo del delta.
- **H (auth/sesión)**, **I (compliance)**: N/A — sin auth/sesión/borrado tocado.

## Archivos analizados
`demo-gate.ts`, `adapter-simulator.ts`, `selection-priority.ts`, `adapter-selection.ts`, `adapter-spp-android.ts`, `driver-types.ts`, `driver-rs420.ts`, `driver-registry.ts`, `stick-adapter.ts`, `permissions.ts`, `BleStickListenerProvider.tsx`, `contract.ts`, `parser-rs420.ts`, `logging.ts` (todos en `app/src/services/ble/`); `StickConnectionScreen.tsx`, `StickStatusIndicator.tsx`, `StickDeviceRow.tsx`, `DemoControls.tsx`, `connection-view.ts` (en `app/src/features/ble-stick/`); `app/app/_layout.tsx`, `app/app/baston.tsx`, `app/app/_components/ble-e2e-flag.ts`. Cross-check de asignaciones de globals sobre todo `app/` y de `demoBuild` sobre `app.config.ts`/`eas.json`.

## Cobertura indirecta / no cubierto por la skill (advertencia)
- La skill Sentry no cubre nativamente **RN/Expo, el triple-guard de flags de build, ni el trust boundary BLE** → esos dominios los cubrí con revisión manual (arriba). El foco SENASA (guard de flags) fue revisión manual + verificación por grep, no pattern-matching de la skill.
- **No cubierto (por diseño del delta, gated Fase 4)**: la conexión SPP/RFCOMM real contra el RS420 físico (`adapter-spp-android.ts`) es device-gated y no está montada en el provider; su seguridad de runtime (canal SPP, rogue peripheral G2) debe re-auditarse cuando se instale `react-native-bluetooth-classic` y se monte en un dev build Android (recomendación ya registrada por el implementer, T-MV.5.1/5.5).

## Anexo LOW (defense-in-depth, NO bloqueante)
- **LOW-1**: alinear con el hardening ya propuesto en `docs/backlog.md` (LOW-2): gatear las marcas E2E/demo TAMBIÉN por `__DEV__`/`NODE_ENV !== 'production'` a nivel de la marca, como cinturón-y-tiradores por si un release accidental llevara un global seteado. Hoy NO explotable (doble-marca AND + ningún setter en prod). 1 línea. Opcional.
