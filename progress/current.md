# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

_(Sin sesión activa. La última cerrada está resumida en `progress/history.md`.)_

## Última sesión cerrada — 2026-06-07: spec 02 C4 lotes (`management_groups`)

Ver `progress/history.md` (entrada 2026-06-07). En síntesis:
- **Spec 02 C4 lotes** — DONE + committeada (`36c5437`, puerta de código de Raf). Frontend de `management_groups` (ADR-020): CRUD de lotes (owner) + asignar/quitar/quick-create desde la ficha + ver-miembros; entry junto a Rodeos. Frontend puro (backend `0037` ya aplicado) → Gate 1 N/A. Borrado vía RPC `soft_delete_management_group` (0041 pre-existente — el leader cazó un falso "bloqueante de backend" del implementer que usaba `UPDATE deleted_at` directo → 42501 esperado por el gotcha de PostgREST). Gates: reviewer APPROVED + Gate 2 PASS 0 HIGH + veto de diseño + puerta de código. check.mjs verde (628 unit + e2e lotes 2/2). **spec 02 sigue `deferred`** (queda C5 PowerSync, bloqueado por infra).
- **Feature 10 (masivas)** — descartada para implementar ahora: STALE vs el backend Tier 2 (castración masiva specceada como `sanitary_events` marker, pero el efecto de categoría as-built `0064` va por `animals.is_castrated`). **On-deck, a reconciliar** antes de implementar. + conflicto de Puerta 1 sin confirmar (`feature_list` PENDIENTE vs `requirements.md` APROBADA, 1/6).

**Pendientes principales** (fuente única: `feature_list.json`):
- [Raf] **PowerSync (C5)** — provisionar la instancia (Cloud; el leader dejó la prep lista para cuando diga) → destraba offline-first. Live test del bastón con el RS420 en web (T2.5); web-check de feature 14.
- [Leader, on-deck] reconciliación de spec 10 vs el backend Tier 2 + confirmar el conflicto de Puerta 1.
- [Facundo] D3 del import ("Vaca" genérica); CE en toritos; pricing; campos del vet. Ver `CONTEXT/07-pendientes.md`.
- [Backlog] limpiar data de e2e de prod antes del beta; polish de C4 (error-copy de create/rename, member-count en card colapsada); MED-01 `CHECK>0` en `exit_weight`/`exit_price`; rate-limit de import; `deno check` de EFs al pipeline.

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
