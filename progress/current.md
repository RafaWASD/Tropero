# Sesión actual

> Este archivo se vacía al cerrar cada sesión y su resumen se mueve a `history.md`.
> Mientras trabajás, **mantenelo actualizado en tiempo real**, no al final.

**SESIÓN 2026-06-29/30 — CORRECCIONES DEL TESTEO EN VIVO CON FACUNDO (16) + CONVENCIÓN SDD PARA FIXES (ADR-028).**

## 🆕 2026-06-30 — DELTA CRÍA-AL-PIE-ALTA (#15) — backend + frontend GATEADOS
Al dar de alta una vaca con cría al pie (`nursing=true`) → **prompt saltable** "¿Vincular su cría al pie?" → caravana del ternero (find-or-create) → **vincular** existente (RPC nueva `link_calf_to_mother`) o **crear+vincular** nuevo (`register_birth` 6-arg con rodeo del ternero editable + leyenda "Mismo rodeo que la madre"). Delta Nivel B CON BACKEND (Gate 1 obligatorio; deploy autorizado por Raf en Gate 0).
- **BACKEND commiteado `70c2efd`**: 0114 (RPC nuevo, 8 guards anti-IDOR/idempotencia) + 0115/0116 (`register_birth` extendido; **0116 fix Gate 2 HIGH** = restaura herencia `breed_id` madre→ternero que 0115 había borrado al moldearse sobre 0075 en vez del as-built 0109 — SIGSA R1.7). Aplicadas al remoto. 200/200 backend (animal + SIGSA). Plumbing outbox/upload/events. Memoria `reference_function_recreate_base`.
- **FRONTEND (este commit)**: `LinkCalfPrompt.tsx` (bottom-sheet 3 fases ask→found→create, molde `BreedPickerSheet`) + `link-calf-query.ts` (clasificador puro EID/IDV) + wiring `crear-animal.tsx`. **Veto de diseño del leader**: re-iteré para agregar la affordance "← Cambiar caravana" (control&freedom Nielsen #3 — un mistype en la manga no debe forzar abandonar ni crear un ternero bogus). Gate 2 PASS 0 HIGH + reviewer APPROVED (tras fix de 1 aserción E2E mal escrita = bug de test, no de producto). typecheck + 12 unit + E2E (#15 6/6 + back round-trip + RCAP.4.2) verdes. Specs reconciliadas (T1-T21 [x]).
- **⏸ Puerta 2 post-hoc de Raf**: probar en la app el prompt (vincular existente / crear+vincular con rodeo editable / "Cambiar caravana" / "ya tiene madre" / "Ahora no").

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
- Spec 02 → `in_progress` (delta #15 cría-al-pie-alta gateado 2026-06-30, ⏸ Puerta 2; vuelve a `deferred` al cerrarla). 4 deltas previos cerrados.
