# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## Feature 12 — Importación masiva de rodeo: SPEC REDACTADA + GATE 1 EN CURSO (2026-06-06)

Raf eligió esto como "lo próximo" tras cerrar feature 04 (enabler del beta de Chascomús: cargar el rodeo existente desde Excel/planilla + TXT SIGSA, sin esperar a colocar los TAGs). Estaba `context_ready` (Gate 0 aprobado s22).

**Spec REDACTADA** (`spec_author`) → `feature_list` 12 = `spec_ready`. requirements.md (R1-R12, ~50 EARS) + design.md + tasks.md (26 tasks/7 fases). El leader vetó el contexto y reforzó el brief con 7 puntos de seguridad que la spec horneó: (1) **límites de input/anti-DoW** (R3: 5MB/5000 filas, cap durante parseo, largos que espejan los CHECK de `0070`), (2) **seguridad del parser** (design §4: CSV+TXT en MVP, `.xlsx` FUERA por CVEs de SheetJS), (3) **campos forzados server-side** (R9: establishment_id/imported_by/created_by/rodeo∈est), (4) **dedup pre-check** contra `animals_tag_unique`/`animal_profiles_idv_unique` (R7), (5) categorías post-Tier-2 + override (R10), (6) artefactos reales (`parser-rs420.ts`, razas 08), (7) entry point sobre flujos cerrados (R1). Única tabla nueva: `import_log` (audit, RLS owner/vet + trigger imported_by forzado + CHECK octet_length). Migrations TBD **0073+**.

**Revisión crítica del leader** (no pasamanos): sin blockers. 3 notas de refinamiento para el implementer: (a) truncar `error_details` si 5000 filas erran para no pasar el CHECK octet_length y abortar el log; (b) verificar el comportamiento de `compute_category` en INSERT con override=false (que no repinte el placeholder antes de tiempo); (c) la restricción de field_operator (R2.4) es UI-level — el write a nivel DB es el mismo que el alta individual.

**Gate 1 (security_analyzer modo spec) = PASS 0 HIGH** (`progress/security_spec_12-import-rodeo.md`). El analyzer verificó TODAS las afirmaciones del design contra las migraciones reales (correctas) + halló un refuerzo: `tg_animal_profiles_rodeo_check` (`0021`) enforça `rodeo∈establishment` a nivel DB en ambos escenarios → R9.2 no depende del RPC. 4 MEDIUM + 1 LOW (ninguno bloquea), foldeados por el leader en la spec: MEDIUM-1 (tag CHECK NOT VALID igual enforça inserts)→R9.5; MEDIUM-2 (truncar error_details + cap file_name)→R11.4/R11.5; MEDIUM-3 (field_operator a nivel DB)→design §6-A; MEDIUM-4 (rate-limit de frecuencia)→R3.7+backlog; LOW-1 (dedup TAG falso-negativo cross-tenant es correcto, no "arreglar" con service-role)→design §3.2. Recomendación de seguridad: **Escenario A** (inserts directos).

**Puerta 1 RESUELTA (Raf)**: D1 = `.xlsx` SÍ en MVP (parser vetado SheetJS CDN ≥0.20.2, R3.8); D2 = **Escenario B** (RPC bulk `SECURITY DEFINER` `import_rodeo_bulk`, R9.4 firme); D3 = placeholder por sexo override=false (interino hasta cerrar con Facundo). Foldeado en requirements/design.

### FASE 2 BACKEND + FASE 1 UTILS — DONE + GATEADAS + commit-ready (2026-06-06)

**BACKEND (Fase 2, T2.1-T2.5)**: migraciones `0073_import_log.sql` (audit + RLS owner/vet + trigger imported_by forzado + CHECKs) + `0074_import_rodeo_bulk_rpc.sql` (RPC `import_rodeo_bulk` SECURITY DEFINER, los 6 controles de R9.4 incl. cap de batch + import parcial por-fila + smoke-check fail-closed). Aplicadas al remoto vía Management API. **reviewer APPROVED**. **Gate 2 (code) FAIL → fix-loop → PASS**: cazó `SEC-12B-HIGH-01` (el cap de 5000 filas vivía solo en el cliente → DoW; el RPC no lo replicaba). Fix: guarda `jsonb_array_length(p_rows) > 5000 → raise` DESPUÉS del authz, ANTES del loop, rechaza el batch entero. **Verificado por el leader** (lección H1-1, no pasamanos): orden authz→cap correcto en el SQL + tests adversariales (field_operator+>5000 rechazado por AUTHZ no por el cap = authz primero, sin leak de tamaño; >5000 → 0 filas; exactamente 5000 → procesa). Hardening de la suite contra transitorios (setupWithRetry + fixtures únicos + fail-loud + cleanup de huérfanos). Suite `supabase/tests/import/run.cjs` **25/25 verde dentro de check.mjs**.

**UTILS (Fase 1, T1.1-T1.12)**: 6 módulos puros en `app/src/utils/import/` (parse-csv, parse-sigsa-txt, breed-senasa, column-mapping, normalize-row, validate-rows) + 6 suites `node:test` = **72/72 verde**. Cap DURANTE el scan (anti-DoW), reuso real de `parser-rs420.ts`, topes espejo de 0070, dedup intra-archivo. **reviewer APPROVED + Gate 2 (code) PASS** (0 HIGH: sin ReDoS, sin prototype-pollution en el mapeo de headers, fail-safe; verificado empíricamente). `.xlsx` DIFERIDO (necesita SheetJS vetado, R3.8 — otro run).

**check.mjs verde end-to-end** (typecheck + anti-hardcode + 72 utils + RLS/Edge/Animal/Maneuvers/user_private/import 25 + sin regresión). Suites enganchadas en `run-tests.mjs` por el leader. **2 notas del Gate 2 de utils para el run de SERVICE** (`security_code_12-utils.md`): R3.1 rechazo por tamaño de archivo ANTES de parsear; category/lote por match de catálogo no insert crudo.

### FASE 3 SERVICE (T3.1-T3.5) — DONE (implementer, 2026-06-06, pendiente reviewer+Gate 2)

Capa I/O del import: `app/src/services/import-rodeo.ts` (única capa de red/DB) + lógica PURA en `app/src/utils/import/import-write.ts` (split puro/I/O patrón `establishment-store.ts`, porque el service importa `./supabase`→`expo-secure-store` que no carga bajo `node:test`). **T3.1** dedup contra existentes en lote (idv en `animal_profiles` activos + tag en `animals` no-soft-deleted), IN-list en sub-lotes URL-safe (`DEDUP_IN_CHUNK=500`), `mergeDedupAgainstExisting` puro (skip+report, NUNCA update, TAG prioridad R7.4). **T3.2** `resolveCategory` manda `category_code` TEXTO (el RPC resuelve el id+placeholder server-side, header 0074) + `resolveLotes` por nombre→`management_group_id` (no crea, R10.4). **T3.3** `buildRpcRow` (shape EXACTO header 0074, sin establishment_id/category_id/autoría) + `writeInChunks` (chunks de 150, ≤ tope 5000 del RPC) + import parcial (`accumulateChunk`). **T3.4** `insertImportLog` con `error_details` ACOTADO (`summarizeErrorDetails`, presupuesto 200KB < CHECK 262144 de 0073 — test del peor caso 5000 sqlerrm largos únicos) + imported_by OMITIDO (trigger 0073). **T3.5** `checkFileSize` (R3.1, rechazo por TAMAÑO antes de parsear — barrera real del char-flood) + `escapeIlike` (R3.5) + `confirmImport` con guard de conexión (R12.2, probe inyectable). **`import-write.test.ts` 32/32 verde** (104 con los 72 de Fase 1) + typecheck verde + check.mjs verde. Specs (tasks/design) reconciliadas. Bitácora: `progress/impl_12-service.md`. **Para enganchar (leader)**: agregar `app/src/utils/import/import-write.test.ts` a `client unit tests` de `run-tests.mjs`.

**PENDIENTE feature 12**: reviewer+Gate 2 de Fase 3 → `.xlsx` (R3.8) + Fase 4 hook+UI + Fase 5 entry point → cada uno con reviewer+Gate 2 → Puerta de código humana al cierre.

### RUN AISLADO — parser `.xlsx` (R3.8) — DONE (implementer, 2026-06-06, pendiente reviewer+Gate 2)

Implementer corrió SOLO el parser `.xlsx` de feature 12 (util puro adicional, espeja `parse-csv.ts`). NO tocó backend/service/UI ni `run-tests.mjs`. Bitácora `progress/impl_12-xlsx.md` (baseline `67d8619`).
- **Dependencia VETADA**: `xlsx@0.20.3` desde `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (dominio exacto `cdn.sheetjs.com`, ≥0.20.2 post-fix CVE-2023-30533 + CVE-2024-22363). Registrada en `app/package.json` + `app/pnpm-lock.yaml`. **Sin postinstall** (el paquete no declara lifecycle hooks; pnpm `onlyBuiltDependencies` no pidió build/allowlist). NO la npm `xlsx` vulnerable.
- **`parse-xlsx.ts`**: `XLSX.read(data,{type:'array', sheetRows: MAX_ROWS+1, cellFormula:false,…})` (cap AL PARSEAR, anti-DoW real verificado: 50k filas NO materializa 50k); `!fullref`+conteo materializado → `rowsExceeded` (rechaza-y-reporta, no trunca); primera hoja; `sheet_to_json({raw:false})` → valores CACHEADOS a string (no evalúa fórmulas, no reexporta, R3.5); try/catch → `parseError` (R3.6). Mismo contrato `{headers,rows,rowsExceeded,cellsExceeded}` que `parse-csv.ts` (+`parseError?` opcional) → intercambiables.
- **`parse-xlsx.test.ts`**: 14 tests `node:test` verdes (workbooks en memoria con la lib real). typecheck verde + check.mjs verde end-to-end (sin regresión; el test aún NO está en `run-tests.mjs`).
- **Residual zip-bomb** (anotado, aceptable): `XLSX.read` descomprime todo el ZIP/sharedStrings para hallar límites de fila aunque `sheetRows` solo retenga MAX_ROWS+1. Acotado por R3.1 (5 MB comprimido, en el service ANTES del parse) + `sheetRows`. Cuantificado: un `.xlsx` repetitivo de ~5 MB ≈ ≤9.3k filas, read+cap ~90ms. Op de owner/vet autenticado (threat model bajo, R3.7).
- **Para enganchar (leader)**: agregar `app/src/utils/import/parse-xlsx.test.ts` a `client unit tests` de `run-tests.mjs`.

---

## Feature 04 bastón — capa buildable-hoy ✅ DONE + GATEADA + COMMITEADA (2026-06-06)

Implementada toda en `app/src/services/ble/`: contrato de ingesta (R1-R3, reusa `parser-rs420.ts`) + confirmación pre-commit + feedback (R4) + adapter-manual/web-serial/mock + interfaz `StickAdapter` (R11) + provider/hooks con la firma EXACTA de spec 09 (`useBleStickListener`/`useBleConnectionStatus`/`useBusyMode`/`BleStickListenerProvider`) + offline/logging/no-read/permisos. **75/75 tests BLE verdes** + check.mjs verde. **reviewer APPROVED + Gate 2 PASS**. No se cambió ningún contrato de spec 09 (su frontend está deferred; `app/src/features/animals/` no existe → todo en `services/ble/`, spec 09 Fase 4 delega ahí). Feature 04 → `deferred` (chunk done; el RESTO pendiente de HARDWARE). DEFERIDO: spp-android (R6, dev build + Android), hid-wedge (R8, GATED por gate físico iPhone), pantalla de conexión R9 (tentativa/design system), prueba real con RS420 (T2.5), MFi-Allflex (canal Facundo). Detalle en `progress/impl_04-bluetooth-baston.md`. Commit selectivo (sin tocar feature 2 de la otra terminal).

## Feature 04 bastón — pantalla de TEST WEB (harness dev) ✅ DONE + REVISADA (2026-06-06)

Para desbloquear la prueba real con el RS420 en `pnpm web` (T2.5, lo que Raf tiene HOY): ruta nueva `app/app/baston-test.tsx` (navegable en `http://localhost:8081/baston-test`), self-contained, monta su propio `BleStickListenerProvider` + su propia `WebSerialAdapter(baud)` + `EidIngestEngine`, ejercitando end-to-end el código committeado (`adapter-web-serial` → `contract` → `dedup` → `parser-rs420`). Botón "Conectar (Web Serial)" con gesto de usuario (R5.2), indicador de estado, lista en vivo de EIDs con timestamp + contador, baud editable, "Limpiar", banner unsupported para Firefox/Safari (R5.6). **Revisión crítica del leader** (no pasamanos): verifiqué que el adapter interno del provider queda idle (sin conflicto de puerto), la secuencia `processRawLine`(registra dedup)+`commit`(puro) correcta, todos los tokens resuelven contra `tamagui.config.ts`, `Card`/`Button` forwardean. **Gate 2 N/A** (frontend puro, cero red/DB/EF/migración). check.mjs verde + `expo export -p web` = 0. **Toque a `_layout.tsx`**: bypass de gating dev-web (`DEV_WEB_ROUTES`, solo `Platform.OS==='web'`) para que el harness sea alcanzable sin sesión/campo/rodeo activos (si no, el RootGate rebota a sign-in/onboarding/crear-rodeo). Reversible. Bitácora: `progress/impl_04-frontend-baston-test-web.md`. CONTEXT/07 actualizado: hardware del bastón (qué tiene hoy = RS420+notebook→web-serial; comprar Android de prueba [SPP nativo] + lector HID barato AR [wedge]; acciones firmware RS420 + MFi-Allflex por Facundo) y corrección de la entrada vieja "Protocolo BLE RS420" (ADR-024 ya cerró que no es BLE GATT).

---

_(Sin sesión activa. La última cerrada está resumida en `progress/history.md`.)_

## Última sesión cerrada — 2026-06-05: hardening de seguridad

Ver `progress/history.md` (entrada 2026-06-04/05). En síntesis:
- **Feature 14** (B3-1, PII de coworkers → tabla `user_private` self-only) — **done + desplegada + committeada** (`0ef6736`). ADR-025 fija el patrón.
- **Feature 13** (5 fixes: INPUT-1/B1-1/A1-1/F1-1/H1-1) — **done + desplegada + committeada** (`1da96a4`). Migraciones 0070/0071/0072 + 8 EFs en prod.
- Terminal paralela cerró **alta guiada A+B** de feature 2 (`06d2273`) + Tier 2 categorías (`0496387`) + orden timeline (`57ffe09`).
- Password remoto → 8. Stop hook arreglado (feature 1 → deferred).

**Estado por feature**: la fuente única es `feature_list.json`. **Pendientes** (en `docs/backlog.md` + el cierre de history): web-check de feature 14 por Raf; captcha Turnstile + decisión email-confirmation (E3-1); limpiar data de e2e de prod antes del beta; `deno check` de EFs al pipeline.

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- **Node ≥20.19.4 REQUERIDO** para el dev server de Expo (`expo start` corta con Node viejo; `check.mjs` igual corre). Raf en 24.16.0 vía nvm-windows.
- **Device real bloqueado**: Expo Go SDK 56 no está en tiendas → iterar diseño por **web** (`pnpm.cmd web`); veredicto final en device = dev-build propio más adelante.
- **Preview fiel del leader = CDP `Emulation.setDeviceMetricsOverride`** (NO `--window-size`, da falso recorte). Tubería en `scripts/cdp-capture.py` + skill `design-review`. Matar el dev server + Chrome headless al terminar (`TaskStop`).
- **Cero hardcode en pantallas** (ADR-023 §4): todo via tokens; lo que cruza a API no-Tamagui se lee con `getTokenValue`. Lint `scripts/check-hardcode.mjs` (cableado en `check.mjs`) falla ante hex/px literal en `app/app/**` + `app/src/components/**`.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS/Edge/animal en Node nativo, no pgTAP/deno (Docker bloqueado). Corre todo `scripts/run-tests.mjs`.
- RLS-on-RETURNING gotcha: el cliente NO debe usar `.insert().select()` en un solo roundtrip; split insert + select.
- **MCP Supabase read-only** → para aplicar migraciones/config al remoto se usó la **Management API** (`/v1/projects/<ref>/database/query` y `/config/auth`) con `SUPABASE_ACCESS_TOKEN` de `.env.local` (corre como `postgres`); envolver DDL en `BEGIN/COMMIT` (atómico, probado). EFs se deployan con `npx supabase functions deploy <fn> --project-ref <ref>` (bundlea nativo, sin Docker). `supabase db push` es PELIGROSO (el disco numera 00NN y el remoto registra algunas con timestamp → re-aplicaría).
- **Numeración de migrations**: as-built en disco llega a **0072** (0068 user_private/feat-14; 0070-0072 hardening/feat-13; 0069 timeline/feat-2). Aplicar solo la migración nueva vía Management API, NO `db push`.
- **Nav (ADR-018)**: el FAB central elevado usa un `tabBarButton` custom en Expo Router.
- **BLE / bastón (s20)**: el Allflex RS420 NO es BLE (Bluetooth Classic SPP + iAP/MFi). El diseño BLE de spec 04 / ADR-002 no aplica al transporte real — pendiente ADR-024 (terminal de feature 04). El TAG es ISO 11784/11785 FDX-B (15 díg, prefijo 982); `normalize.ts`/`isValidTag` (R8) es insumo firme independiente del transporte.
