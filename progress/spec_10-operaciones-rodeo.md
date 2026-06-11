# Bitácora spec_author — 10-operaciones-rodeo

## 2026-06-11 — Reconciliación COMPLETA (Gate 0 v2 + staleness vs Tier 2 as-built)

**Disparador**: (a) `context-v2-seleccion.md` aprobado por Raf (2026-06-11) — D1–D11 lockeadas (selección explícita castrar/destetar, `future_bull`, castrado = estado editable sin evento, vacunación sin cambios); (b) la spec del 2026-06-01 quedó stale contra el backend Tier 2 (0059–0067) y el as-built de spec 15 (0068–0083).

**Qué se hizo**: reescritura orgánica de `requirements.md`, `design.md` y `tasks.md` (patrón refundición spec 02 s14); historial preservado en el Changelog/Historial de cada archivo; IDs R1–R10 preservados, grupos nuevos R11 (selección), R12 (`future_bull`), R13 (castrado/denorm/simétrico).

**Cambios por Gate 0 v2**:
- Castración masiva = N UPDATEs `is_castrated` (sin evento, sin marcador, sin data_key `castracion`, sin rama de gating — delta viejo ELIMINADO; H1/M1/L1 del Gate 1 s21 quedan sin objeto).
- Pantalla de selección explícita (secciones por categoría, defaults D3/D4, ⭐ sin modal, CTA con número, bottom-sheet con copy REVERSIBLE) — R11.x.
- `future_bull` en `animal_profiles` (solo machos por trigger, ficha-only, badge solo-positivo, auto-clear al castrar) — R12.x.
- Denorm `is_castrated` a `animal_profiles` (estilo 0079: backfill + force-INSERT + propagación) **+ write-through** perfil→animals (único write-path offline; `animals` fuera del sync set) — R13.3/R13.4; cierra el finding F1 de C6 (espejo con input real, R13.6/R10.6).
- Recompute simétrico: fix exacto sobre `tg_animals_apply_castration` (0064) — guard `IS NOT DISTINCT FROM` en vez de solo false→true — R13.5. Supersede RT2.2.6 de spec 02 Tier 2 (nota de reconciliación en esa spec → coordina el leader, design §9 D10).

**Cambios por staleness** (traza por migración):
- R5.5: el `weaning` SÍ transiciona solo (0062/0063) — antes decía "no transiciona, pendiente de Facundo".
- R5.7: efecto de castración DEFINIDO as-built (0059/0062/0064: torito→novillito, toro→novillo, corte 730d).
- R7.3: verdad del gating DB — 0054 no gatea `weaning` (solo capa 1); documentado como límite, no se reabre.
- R1.2: `AnimalListItem` → `AnimalRow` (componente real); rutas Expo Router as-built; C1–C4 de spec 02 DONE (antes "en vuelo").
- R10.x: reconciliado a spec 15 (CRUD plano `runLocalWrite`, sync streams JOIN-free, canal de error de `uploadData`).
- Header: Puerta 1 (aprobada s22) RESETEADA a "pendiente re-aprobación"; Gate 1 PASS s21 marcado OBSOLETO.
- Numeración de migraciones: TBD ≥0084 (as-built en disco = 0083).

**Criterio propio del autor (validar en Puerta 1)**: exclusión-de-lista como skip-equivalente en destete cross-rodeo (R7.2); lista de destete = solo `ternero`/`ternera` sin weaning previo (R11.4); aviso de override movido al bottom-sheet (R5.6); normalización SILENCIOSA de `future_bull` (trigger, no raise; no CHECK — rompería la propagación de 0079) (design §9 D8/D9).

**Para Gate 1 (re-corrida obligatoria)**: design §6 — no-loop write-through/propagación/recompute; análisis de poder del write-through vs `animals_update` (0071); orden alfabético de triggers BEFORE en `animal_profiles` (normalize después del force 0079); revokes de las 4 funciones nuevas; eliminación completa del delta viejo (no se tocó `tg_sanitary_events_gating`); columnas nuevas en el wire de sync (`est_animal_profiles SELECT *`, ADR-025); reemplazo de 0064 sin abrir cross-tenant.

**NO se tocó**: código, tests, `feature_list.json`, `progress/current.md`, docs de spec 02/C6 (la nota RT2.2.6 la coordina el leader).

## 2026-06-11 — Fix-loop Gate 1 v2 (PASS 0H/2M/3L): folds M1 (interacción real con checks 0021 + caso rodeo-muerto en T-DB.4e, design §6.1/§4.2 corregidos), M2 (R13.2/R3.3 a la verdad — castrar `ternero` sin rastro atribuible hasta el destete; nueva sección "Limitaciones explícitas" LIM-1/LIM-2 en requirements para Puerta 1; D10 NO reabierta) y L1 (aserción de orden de triggers contra `pg_trigger` en T-DB.4f). Solo prosa + 2 sub-casos de test; cero cambio de diseño; IDs preservados; headers de los 3 archivos → Gate 1 PASS, ⏸ Puerta 1.

## 2026-06-11 — Fix-loop #2: Puerta 1 APROBADA por Raf — folds LIM-1/LIM-2. **LIM-1 → MITIGADA con observación automática**: nuevo R13.7 + design §3.5 — al castrar/revertir (masiva y ficha), el cliente crea junto al UPDATE una observación `animal_events 'observacion'` (reuso `addObservation` as-built de `events.ts`, offline-safe, autor = `auth.uid()` del que sube; copy "Castrado" / revert "Corrección: marcado como no castrado", simetría); masiva = 2 CrudEntries/animal; R3.3/R13.2/criterios reescritos (el rastro en `ternero` ahora existe); D10 NO reabierta (sin evento tipado). **LIM-2 → RESUELTA con tolerar-y-saltear**: la propagación `animals→profiles` (design §4.2(4)) gana un pre-filtro que espeja el predicado exacto de `rodeo_check` (0021) — elegido sobre manejo de excepción (set-based, determinístico, no enmascara otros 23514); perfil propio aplicado, huérfano salteado con `RAISE LOG` (sin skip-report UI — cross-tenant), inconsistencia stale aceptada con convergencia en el próximo flip; T-DB.4(e) reescrita de "aborto esperado" a "skip esperado". Los 4 criterios propios (R7.2/R11.4/R5.6/D8) validados tal cual. Nuevas T-CL.13 (tests de la observación) y T-G1.2 (⚠ re-chequeo puntual de Gate 1 sobre el delta de LIM-2 — lo lanza el leader). Headers de los 3 archivos → Puerta 1 APROBADA. NO se tocó: código, tests, `feature_list.json`, `progress/current.md`, archivos C6 de spec 02.
