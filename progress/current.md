# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

## Sesión en curso — 2026-06-07: C4 lotes (frontend `management_groups`, spec 02)

**Tarea**: frontend C4 de spec 02 — gestión de lotes (`management_groups`, ADR-020). Backend `0037` ya aplicado → **frontend puro** (Gate 1 N/A, como C3.3).

**Por qué C4** (decisión de Raf, esta sesión): tras descartar arrancar feature 10 (resultó stale vs el backend Tier 2 de Facundo — castración masiva specceada como `sanitary_events` marker pero el efecto de categoría as-built 0064 va por `animals.is_castrated`; spec 10 necesita reconciliación antes de implementar → queda on-deck). C4 es limpio, más chico, y prerequisito de la mitad "lote" de spec 10.

**Gate 0 cerrado** (`specs/active/02-modelo-animal/context-c4-lotes.md`, aprobado por Raf):
- D1 borrar lote con animales → reasigna animales a NULL (vuelven a categoría) + soft-delete; orden null-primero; 2 UPDATES no atómicos (recuperable, atomicidad real = C5); sin RPC → Gate 1 N/A.
- D2 gestión de lotes vive junto a Rodeos (`/lotes`); asignar día-a-día desde la ficha.
- D3 incluye ver-miembros de un lote; vista de grupo rodeo-céntrica + agrupamiento en Inicio = spec 10 (no se toca).

**Alcance C4**: `management-groups.ts` (CRUD: create/rename/soft-delete + assign/clear) + `LotesScreen` (lista + CRUD owner-only) + asignar/quitar desde la ficha + ver miembros. Online-first (C5=PowerSync). E2E Playwright nuevo.

**ESTADO: C4 DONE + COMMITEADO** (puerta de código de Raf). Pipeline completo: implementer → **leader cazó un falso "bloqueante de backend"** (el implementer usaba `UPDATE deleted_at` directo → 42501; el RPC `soft_delete_management_group` de `0041` ya existía para ese gotcha de PostgREST) → fix-loop a RPC → reviewer APPROVED → Gate 2 PASS 0 HIGH → veto de diseño leader (8 capturas CDP) → puerta de código de Raf. 3 iteraciones del "Crear lote nuevo" en el combo de la ficha (CTA centrada con divisor + "+" a la izq; centrado imperfecto, aceptado). check.mjs verde (628 unit + e2e lotes 2/2). spec 02 `in_progress→deferred` (C5 PowerSync sigue pendiente). Deuda menor anotada en backlog (error-copy de create/rename; member-count en card colapsada).

**Flag abierto (no bloqueante)**: conflicto de Puerta 1 de spec 10 — `feature_list.json` dice PENDIENTE, `requirements.md` dice APROBADA (1/6). Raf no lo confirmó. Se reconcilia en la pasada de reconciliación de spec 10 cuando se retome.

---

## Última sesión cerrada — 2026-06-06/07: feature 12 import masivo (CERRADA) + bastón buildable + C3.3 baja de animal

Ver `progress/history.md` (entrada 2026-06-06/07). En síntesis:
- **Feature 12** (importación masiva de rodeo) — **DONE + cerrada** (puerta de código de Raf, "cerra 12"). Implementación completa 2026-06-06 (5 commits; Gate 1 / Puerta 1 / Gate 2 — cazó 1 HIGH del cap de batch solo-cliente) + cierre 2026-06-07 con 3 fixes de UX probados en vivo (mapeo SOURCE-DRIVEN + componente `Select`; auto-detección de delimitador `,`/`;`/tab para Excel es-AR; aviso de categorías no reconocidas en el preview) + e2e `rodeos.spec.ts` verde. Commits `3ae4478` / `cd2b6c8` / `f10ed27` / `8576369` / cierre `5c8acc0`.
- **Feature 04** (bastón) — capa buildable-hoy DONE + pantalla harness web (`app/app/baston-test.tsx`) para probar el RS420 en `pnpm web`; el RESTO `deferred` por hardware. **ADR-024** cerró que el RS420 no es BLE GATT (BT Classic SPP / iAP-MFi).
- **Spec 02 C3.3** (baja/egreso de animal desde la ficha) — DONE + committeada (`5a4f34a`, terminal paralela). Spec 02 sigue `deferred` (C4 lotes + C5 PowerSync pendientes).

**Estado por feature**: la fuente única es `feature_list.json`. **Pendientes principales**:
- [Facundo] D3 del import — qué hace una "Vaca" genérica declarada (no existe en el catálogo de cría); CE en toritos (3 momentos/unidad); pricing; campos temporales del vet. Ver `CONTEXT/07-pendientes.md`.
- [Raf] live test del bastón con el RS420 en web (T2.5); web-check de feature 14 (perfil/cambiar-email).
- [Backlog] limpiar data de e2e de prod antes del beta de Chascomús; MED-01 `CHECK>0` en `exit_weight`/`exit_price`; rate-limit de frecuencia de import; `deno check` de EFs al pipeline.

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- **Node ≥20.19.4 REQUERIDO** para el dev server de Expo (`expo start` corta con Node viejo; `check.mjs` igual corre). Raf en 24.16.0 vía nvm-windows.
- **Device real bloqueado**: Expo Go SDK 56 no está en tiendas → iterar diseño por **web** (`pnpm.cmd web`); veredicto final en device = dev-build propio más adelante.
- **Preview fiel del leader = CDP `Emulation.setDeviceMetricsOverride`** (NO `--window-size`, da falso recorte). Tubería en `scripts/cdp-capture.py` + skill `design-review`. Matar el dev server + Chrome headless al terminar (`TaskStop`).
- **Cero hardcode en pantallas** (ADR-023 §4): todo via tokens; lo que cruza a API no-Tamagui se lee con `getTokenValue`. Lint `scripts/check-hardcode.mjs` (cableado en `check.mjs`) falla ante hex/px literal en `app/app/**` + `app/src/components/**`.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS/Edge/animal/import en Node nativo, no pgTAP/deno (Docker bloqueado). Corre todo `scripts/run-tests.mjs`. Los e2e Playwright NO corren en `check.mjs` (build de producción + Supabase remoto, aparte).
- RLS-on-RETURNING gotcha: el cliente NO debe usar `.insert().select()` en un solo roundtrip; split insert + select.
- **MCP Supabase read-only** → para aplicar migraciones/config al remoto se usó la **Management API** (`/v1/projects/<ref>/database/query` y `/config/auth`) con `SUPABASE_ACCESS_TOKEN` de `.env.local` (corre como `postgres`); envolver DDL en `BEGIN/COMMIT` (atómico, probado). EFs se deployan con `npx supabase functions deploy <fn> --project-ref <ref>` (bundlea nativo, sin Docker). `supabase db push` es PELIGROSO (el disco numera 00NN y el remoto registra algunas con timestamp → re-aplicaría).
- **Numeración de migrations**: as-built en disco llega a **0074** (0068 user_private/feat-14; 0069 timeline/feat-2; 0070-0072 hardening/feat-13; 0073 import_log + 0074 import_rodeo_bulk/feat-12). Aplicar solo la migración nueva vía Management API, NO `db push`.
- **Nav (ADR-018)**: el FAB central elevado usa un `tabBarButton` custom en Expo Router.
- **BLE / bastón**: el Allflex RS420 NO es BLE — es Bluetooth Classic SPP + iAP/MFi (cerrado en **ADR-024**). El diseño BLE de spec 04 / ADR-002 no aplica al transporte real. El TAG es ISO 11784/11785 FDX-B (15 díg, prefijo 982); `parser-rs420.ts` (`normalizeTag`/`isValidTag`, R8) es insumo firme independiente del transporte.
