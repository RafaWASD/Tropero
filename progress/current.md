# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

**SESIÓN 2026-06-29 — CORRECCIONES DEL TESTEO EN VIVO CON FACUNDO (16) + CONVENCIÓN SDD PARA FIXES (ADR-028).**

## Resumen
Raf + Facundo testearon la app en vivo (PRE-campo, sin datos reales, bastón no probado) → 16 correcciones. El leader hizo el triage (`docs/correcciones-prueba-en-vivo-2026-06-27.md`), formalizó la convención de delta-specs (ADR-028), y cerró 6 correcciones en 4 deltas. Las últimas 2 en **modo autónomo** ("hacé todo lo que puedas, no necesites nada de mí").

## ✅ Cerrado + commiteado (6/16)
| Corrección | Delta | Commit | Puerta 2 |
|---|---|---|---|
| #9 KPIs→Datos · #11 circunferencia escrotal · #12 dientes | Fase 1 (Nivel A) | `2009104`+`d67ea3e` | ✅ Raf (presente) |
| #5 badge repro · #6 prompt aptitud alta · #1b inseminación | `aptitud-reproductiva` | `0d447cd`+`b7c2554` | ✅ Raf (presente) |
| #3 fecha dd/mm · #13 condición stepper · #14 destildar | `alta-form-refinamiento` | `8926e16` | ⏸ **post-hoc (Raf)** |
| #6 caravana manual (electrónica+visual desde ficha) | `caravana-ficha` | `19f89bd` | ⏸ **post-hoc (Raf)** |

Todos frontend puro → Gate 1 N/A. Gates automáticos (veto leader + Gate 2 + reviewer) verdes en los 4.
**Commits locales en `main`, NO pusheados** (Raf pushea cuando quiera).

## E2E en vivo (2026-06-29, red recuperada) — corrida + arreglos
Suite completa: **176 passed / 10 failed** (1ra corrida en vivo de los e2e de los 4 deltas, antes solo estáticos). Arreglos (`impl_e2e-fixes-2026-06-29.md`):
- **5 e2e nuevos de los deltas** → TEST (sufijos de etiqueta truncados por `VISUAL_MAX_LENGTH=30`; `.filter({visible:true})`). Producto OK (screenshots). Verdes.
- **2 inseminación** (`maniobra-sanitaria`) → TEST setup (`categoryOverride` para que el animal sea apta) → **confirma que #1b es CORRECTO**. Verdes.
- **1 BUG DE PRODUCTO REAL** (no de los deltas; el alta lo destapó) → `setCustomAttribute` decidía UPDATE/INSERT por `rowsAffected` (no confiable sobre VIEW de PowerSync) → colisión de PK. **Fix frontend** (SELECT de existencia determinista) + test de regresión. **Cierra el backlog 2026-06-20.** Verde.
- **2 flakes pre-existentes** (NO tocados por los deltas, confirmados aislado): `events:282` mellizos · `maniobra-single-active:68` sesiones.
**GATEADO + COMMITEADO** (`4504cbe`, enmendado para sacar 41 `design/*.png` espurios que el e2e re-renderizó — memoria `reference_e2e_design_png_rerender`): veto leader PASS + Gate 2 PASS 0 HIGH + reviewer APPROVED. Los 8 fixes verdes (animals 28/28, maniobra-sanitaria 6/6, custom-render 3/3); 2 flakes pre-existentes documentados. **`check.mjs` completo VERDE end-to-end (exit 0)** — entorno validado (backend + unit + typecheck), red recuperada. **Los 4 deltas quedaron validados E2E en vivo, no solo unit.**

## ⏸ ESPERAN A RAF (su vuelta)
1. **Puertas 2 post-hoc** de `alta-form-refinamiento` + `caravana-ficha` (revisar los 2 commits autónomos; defaults del leader documentados en cada `design-*.md` §decisiones de criterio propio).
2. **Mirar en la app**: badge reproductivo (tradeoff de truncado del rodeo) · stepper/DD-MM del alta · afordancia de caravana en la ficha.
3. **Re-correr `check.mjs` completo** cuando la red a Supabase se estabilice (ver ⚠ abajo).

## ⏳ PENDIENTE — necesitan Raf / Facundo / deploy / hardware (NO autónomo)
- **#8 %parición** + **#10 %destete** → tocan RPC `0106` (Gate 1 + **deploy a la DB compartida, gateado a Raf**). #10 además gatea **peso de destete** (a charlar con Facundo, en `docs/backlog.md`).
- **A cluster ternero** (#7/#4/#15/#1a) → `register_birth` RPC + migración weaning_weight (deploy) + peso destete (Facundo).
- **#2 nombre/apodo** → toca `rodeo_data_config` (probablemente DB/deploy).
- **#6-bastoneo** → hardware (dev build Android + bastón spp-android, no probado; feature 04).
- **#16 tapear wheels** → Raf dijo "hacer después".

## ⚠ Incidencias de la sesión (no bloquean el frontend)
- **Red a Supabase inestable** (connect timeouts `UND_ERR_CONNECT_TIMEOUT`) → `check.mjs` completo falló en una suite backend (spec 10, NO tocada) = flake de red, no regresión. Re-correr cuando se estabilice.
- **3 subagentes murieron mid-run** (2× proceso/CLI exit, 1× error de API) — el trabajo aterrizó intacto las 3 veces (recuperado + re-verificado). **Lección**: typecheck+unit verde NO basta para confirmar wiring de un agente muerto (caso #6: imports muertos pasaban typecheck) → memoria `reference_crashed_agent_recovery`; el reviewer es el oráculo de completitud.

## Otro estado (no de esta sesión)
- **Spec 08 (SIGSA)** → `blocked` (status corregido in_progress→blocked esta sesión): espera (a) deploy YAML PowerSync [Raf] + (b) upload formato SIGSA [Facundo].
- Spec 02 → `deferred` (4 deltas de esta sesión cerrados; sin trabajo activo).
