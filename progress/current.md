# Sesión actual

> Este archivo se vacía al cerrar cada sesión y se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

- **Feature en curso:** `02-modelo-animal` (spec_author en marcha — escribiendo el spec)
- **Feature pausada intencionalmente:** `01-identity-multitenancy` (backend done, frontend deferred)
- **Inicio sesión:** 2026-05-25
- **Agente activo:** `spec_author` (lanzado por `leader`)

## Estado de `01-identity-multitenancy`

- ✅ **Fase 0** (setup) — scaffold Expo + Supabase CLI + Expo Notifications.
- ✅ **Fase 1** (schema + RLS) — 11 migrations aplicadas a remoto + 15 tests RLS verdes.
- ✅ **Fase 2** (Edge Functions) — 7 funciones desplegadas + 24 tests verdes. Email via Resend, push via Expo.
- ⏸ **Fases 3-8** (frontend + PowerSync + QA) — pausadas intencionalmente. Raf decidió no avanzar frontend hasta refinar stack (`ADR-013`) y agregar tooling de UX (Figma MCP + Tamagui + etc).

Status en `feature_list.json` queda `in_progress` con `notes` documentando la pausa. Cuando Raf esté listo para frontend, retomamos.

`node scripts/check.mjs` verde con typecheck + 39 tests reales contra DB remota.

## Estado de `02-modelo-animal` (en curso)

- `spec_author` lanzado para escribir los 3 archivos del spec (requirements + design + tasks).
- Scope: feature completa con identificación flexible (TAG/IDV/visual_id_alt), categorías auto-calculadas, ternero al pie como entidad independiente, ficha cronológica.
- Cuando el spec esté listo (estado `spec_ready`), Raf lo aprueba y decidimos si implementar solo backend (Fase 1-2 equivalente) y diferir frontend, siguiendo el mismo patrón que con 01.

## Bitácora — sesión 1 (refinamiento del spec 01 + Fase 0)

- `2026-05-25` — Refinamiento del spec 01 + aprobación humana. Cerradas 7 preguntas abiertas; sin `user_type`, wizard con CTA dual, teléfono solo al crear campo, notificaciones email + push, sin transferencia de ownership, hard-delete diferido.
- `2026-05-25` — Setup Supabase + intento inicial de `npm install` falla con `Z_DATA_ERROR` (Cylance MITM npm). Raf flaguea preocupación por ataques de cadena de suministro npm. Leader propone migrar a pnpm; Raf aprueba.
- `2026-05-25` — Migración a pnpm: `app/.npmrc` con `node-linker=hoisted`, whitelist `pnpm.onlyBuiltDependencies`. `ADR-011` creado. `pnpm.cmd install` exitoso (466 paquetes en 28s).

## Bitácora — sesión 2 (Fase 0 + Fase 1)

- `2026-05-25` — T0.2 cerrada: scaffold + 10 deps de spec + estructura `app/src/{...}/` + App.tsx splash + helper env.ts.
- `2026-05-25` — T0.3: Supabase CLI 2.101.0 como devDep. `supabase init` + `link` + `db push` end-to-end.
- `2026-05-25` — T0.4 parcial: plugin expo-notifications configurado, helper tipado. Validación con device físico para T3.6.
- `2026-05-25` — Fase 1 completa: 9 migrations base + 2 extras (`0010_grants_fix`, `0011_establishment_auto_owner` trigger). 15 tests RLS verdes en Node nativo.
- `2026-05-25` — Hallazgo crítico: RLS-on-RETURNING gotcha en `insert().select()`. Documentado, patrón split adoptado.

## Bitácora — sesión 3 (Fase 2)

- `2026-05-25` — Implementer relanzado para Fase 2. Decisión de leader: email a owner (R5.10) via Resend.
- `2026-05-25` — Raf crea cuenta Resend, genera `RESEND_API_KEY`. Leader pushea a Supabase secrets.
- `2026-05-25` — 6 shared helpers (`_shared/{cors,errors,supabase,auth,email,push}.ts`) + 7 Edge Functions desplegadas a remoto. 24 tests verdes en `supabase/tests/edge/`.

## Bitácora — sesión 4 (pausa + ADRs + setup spec 02)

- `2026-05-25` — Raf intenta arrancar Fase 3 (frontend) pero corta antes de codear. Plantea ser ambicioso: agregar tooling de UX profesional, MCPs de diseño, stack opinionated.
- `2026-05-25` — Leader crea `ADR-013` (stack frontend: Tamagui + Expo Router + Reanimated + Moti + Lottie + EAS + Sentry + PostHog + Maestro + MCPs Figma/Supabase).
- `2026-05-25` — Leader crea `docs/setup-frontend.md` con instrucciones paso a paso para instalar Figma MCP, Supabase MCP, y librerías del stack cuando llegue el momento.
- `2026-05-25` — Feature 01 marcada como pausada intencionalmente en `feature_list.json` (campo `notes`).
- `2026-05-25` — Leader lanza `spec_author` para `02-modelo-animal` → cierra con status `spec_ready` (3 archivos escritos).

## Bitácora — sesión 5 (MCPs operativos + decisión de empezar designs)

- `2026-05-25` — Raf instala Figma MCP y Supabase MCP. Aprendizaje del entorno: `npx` está roto (Cylance MITM rompe el fetch); reemplazado por `pnpm dlx`. Setup `--scope user` desde **bash**, no PowerShell (resuelve el shim correcto y permite cargar `.env.local`). Raf actualiza `docs/setup-frontend.md` con los comandos reales.
- `2026-05-25` — Leader verifica en sesión: ambas MCPs disponibles (`mcp__figma__*` + `mcp__supabase__*`). Spec 02 sigue en `spec_ready` esperando lectura/aprobación humana.
- `2026-05-25` — Decisión de Raf: **antes de aprobar spec 02 o destrabar Fase 3 del spec 01**, avanzar primero designs en Figma. Primer mockup: flujo de **wizard signup + crear establishment** del spec 01 (backend ya done, contratos estables). Pantallas a diseñar: splash, signup, verificá email, login, onboarding empty state con CTA dual (R6.5), completar teléfono (R3.8), nombre del establecimiento, home post-creación, y bonus aceptar invitación (R5.3).
- `2026-05-25` — Leader cierra higiene: commit de `setup-frontend.md` con los cambios del aprendizaje real de las MCPs.

## Próximo paso

1. **Raf (offline / fuera de Claude Code)**: abre Figma, crea project `RAFAQ — Mobile`, diseña las 8 pantallas del flujo de wizard signup + crear establishment. Manga-UX: botones ≥56×56dp, font operativa ≥18sp, una decisión primaria por pantalla.
2. **Cuando Raf tenga algo navegable**: pasa el link del archivo Figma a leader → leader usa Figma MCP para leerlo, validar contra `R1`/`R3`/`R5`/`R6.5` del spec 01, y proponer ajustes antes de codear.
3. **Decisiones que quedan pendientes (no urgentes)**:
   - Aprobar o pedir cambios en `specs/active/02-modelo-animal/` (3 archivos, ~115KB). Una vez aprobado, leader lanza implementer para backend de 02 (mismo patrón que 01).
   - Destrabar Fase 3 del spec 01: agregar libs Tamagui + Expo Router + Reanimated + manga-friendly + observabilidad al `app/package.json` y reorganizar `app/` con expo-router. Requiere aprobación explícita de Raf.

## ADRs creados en este ciclo

- `ADR-011` — Package manager pnpm con `onlyBuiltDependencies`.
- `ADR-012` — Patrones de implementación: triggers postgres, tests Node nativo, Supabase CLI como devDep.
- `ADR-013` — Stack frontend ambicioso (Tamagui + Reanimated + Moti + Maestro + Sentry + PostHog + MCPs).

## Notas técnicas vigentes para el implementer

- En PowerShell usar `pnpm.cmd` (no `pnpm`) — Cylance Script Control bloquea `.ps1`.
- En migrations: `GRANT` explícito a `authenticated` siempre — Auto-expose new tables está OFF.
- Tests RLS en Node nativo, no pgTAP (Docker bloqueado).
- Edge Functions: secrets en Supabase con `supabase secrets set` además de `.env.local`.
