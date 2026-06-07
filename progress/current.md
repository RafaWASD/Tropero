# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

_(Sin sesión activa. La última cerrada está resumida en `progress/history.md`.)_

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
