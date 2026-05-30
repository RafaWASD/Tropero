# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## (sin sesión activa)

Sesión 20 cerrada el 2026-05-30 — ver `history.md`. Arrancá la próxima sesión leyendo el protocolo de `CLAUDE.md` + `plan.md` + este estado.

**Lo más urgente para la próxima sesión (en orden):**
1. 🔴 **ADR de transporte del bastón** (spec 04). El día de campo confirmó que el **Allflex RS420 NO usa BLE** (Bluetooth Classic SPP + iAP/MFi) → `react-native-ble-plx` (ADR-002) no aplica. Evidencia en `specs/active/04-bluetooth-baston/field-findings.md`. Decidir transporte: **SPP nativo Android** (viable) / **MFi iOS** (barrera cert) / **bridge VESTA_BRIDGE** (ESP32). Revisa el supuesto BLE de ADR-002 + `CONTEXT/05`. **BLOQUEANTE de spec 04.**
2. **Spec 03 (MODO MANIOBRAS) → Gate 1** (security_analyzer modo spec, schema-sensitive) + resolver con Raf las **7 decisiones abiertas + 3 conflictos** (design §9) antes de aprobar/implementar.
3. **Frontend** (track design, ADR-023, no toca el pipeline SDD): ficha de animal (pantalla EDIT R5, destino del tap de `AnimalRow`) · refinamiento hero-identificador de `AnimalRow` (IDV vs visual, duda de dominio para Facundo) · routing landing-por-cantidad de "Mis campos" (Inc 4, R6.7 + `active_lost` R6.10) · wiring de stats reales (backlog).
4. **Spec 02 Tier 2/3** → bloqueado en Facundo (targets aborto/destete, razas SENASA, efecto castración).

## Estado del proyecto (al 2026-05-30)

- **Backend `02-modelo-animal`**: base DONE (s15, migrations 0013-0042) + **delta Tier 1 DONE** (s20, migrations **0043-0049**, suite animal **28/28**, Gate 2 PASS, Raf aprobó). **Tier 2/3 diferidos a Facundo**. No hay feature `in_progress`.
- **`deferred`:** `01-identity-multitenancy` (backend done; **frontend en curso**: home + "Mis campos" + switch dropdown construidos y vetados) · `02-modelo-animal` (backend Tier 1 done; Tier 2/3 + frontend Fase 3+ pendientes) · `09-buscar-animal` (spec aprobada; **frontend puerta manual = tab Animales construido y vetado**; backend find-or-create + BLE pendientes).
- **`spec_ready`:** **`03-modo-maniobras`** (redactada s20 → requiere **Gate 1** + 7 decisiones abiertas).
- **`context_ready`:** `08-export-sigsa` · `04-bluetooth-baston` (🔴 **hallazgo bloqueante s20**: RS420 no es BLE → ADR de transporte) · **`10-operaciones-rodeo`** · **`11-transferencia-animal`** (Gate 1 al spec-ear).
- **`pending`:** `05-bluetooth-balanza` (día de campo) · `06-import-laboratorios` (archivos CEDIVE reales) · `07-reportes-basicos` (uso real).
- **ADRs:** último cerrado ADR-023 (workflow diseño). **Próximo libre: ADR-024** — candidato fuerte: transporte del bastón (hallazgo spec 04).
- **Bloque A del plan (P0 design):** **A.1 (design system) `done` + canonizado (s20)**; A.2 (nav → ADR-018) `done` + firmado; A.3–A.7 `done`. **Frontend destrabado** — se construye por componentes (ADR-023).

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- **Node ≥20.19.4 REQUERIDO** para el dev server de Expo (`expo start` corta con Node viejo; `check.mjs` igual corre). Raf en 24.16.0 vía nvm-windows.
- **Device real bloqueado**: Expo Go SDK 56 no está en tiendas → iterar diseño por **web** (`pnpm.cmd web`); veredicto final en device = dev-build propio más adelante.
- **Preview fiel del leader = CDP `Emulation.setDeviceMetricsOverride`** (NO `--window-size`, da falso recorte). Tubería en `scripts/cdp-capture.py` + skill `design-review`. Matar el dev server + Chrome headless al terminar (`TaskStop`).
- **Cero hardcode en pantallas** (ADR-023 §4): todo via tokens; lo que cruza a API no-Tamagui se lee con `getTokenValue`. Lint `scripts/check-hardcode.mjs` (cableado en `check.mjs`) falla ante hex/px literal en `app/app/**` + `app/src/components/**`.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS/Edge/animal en Node nativo, no pgTAP/deno (Docker bloqueado). Corre todo `scripts/run-tests.mjs`.
- RLS-on-RETURNING gotcha: el cliente NO debe usar `.insert().select()` en un solo roundtrip; split insert + select.
- Migrations backend: as-built llega a **0049**; spec 03 arranca en **0050+**.
- **Nav (ADR-018)**: el FAB central elevado usa un `tabBarButton` custom en Expo Router. Stub navegable hasta implementar spec 03.
- **BLE / bastón (s20)**: el Allflex RS420 NO es BLE (Bluetooth Classic SPP + iAP/MFi). El diseño BLE de spec 04 / ADR-002 no aplica al transporte real — pendiente ADR. El TAG es ISO 11784/11785 FDX-B (15 díg, prefijo 982); `normalize.ts`/`isValidTag` (R8) es insumo firme independiente del transporte.
