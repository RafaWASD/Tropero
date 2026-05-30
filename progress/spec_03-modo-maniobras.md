# Spec 03 — MODO MANIOBRAS · redacción de spec (terminal paralela)

**Fecha**: 2026-05-30
**Autor**: leader (orquestó spec_author + Gate 1) — terminal dedicada a la spec de 03
**Estado**: `spec_ready` — **Gate 1 PASS (re-audit)** — **pendiente aprobación humana (Puerta 1)**
**Footprint**: `specs/active/03-modo-maniobras/` + este archivo + `feature_list.json`[feature 3 → spec_ready] + `progress/security_spec_03-modo-maniobras.md`. NO se tocó app/, supabase/, docs/, ni `progress/current.md` ni `plan.md` (los maneja la terminal de frontend, que tiene cambios concurrentes en curso — mis-campos, EstablishmentCard, y también edita `feature_list.json`).

## Resultado

Spec 03 (modelo Kiro) escrita desde el `context.md` aprobado (Gate 0, s15+s18), construida sobre spec 02 (backend as-built 0013–0049), endurecida tras un Gate 1 FAIL hasta PASS.

- **requirements.md** (340 líneas) — EARS estricto, 12 user stories US-1..US-12 (R1..R12), + R7.5/R7.6 nuevos (gating dientes + fail-closed). Tabla de cobertura context→R al final.
- **design.md** (585 líneas) — arquitectura cliente (wizard 3 pasos + carga rápida + resumen), schema SQL FIRME de lo nuevo, gating doble capa, BLE manual-first (`StickReader`), offline PowerSync, seguridad (RLS/append-only/SECURITY DEFINER + revoke), ≥1 alternativa descartada, **Decisiones abiertas D1..D9**.
- **tasks.md** (241 líneas) — tasks faseadas (schema 0050+ / tests / cliente) con trazabilidad a R<n>, incl. tests de no-bypass del gating.

## Modelo de datos nuevo (migrations 0050+)

- **`sessions`** (NUEVA): jornada de manga, 1 rodeo/sesión. `id` (cliente/offline UUID), `establishment_id`, `rodeo_id`, `config jsonb` (snapshot maniobras+pre-config, CHECK tamaño <16KB), `status` (active|closed), `work_lot_label`, `animal_count`, `event_count`, `created_by` (forzado server-side `tg_force_created_by_auth_uid`), `started_at`, `ended_at`, soft-delete. RLS tenant `has_role_in` + GRANT acotado.
- **`maneuver_presets`** (NUEVA): combinación maniobras+pre-config guardada con nombre. Scope establishment. CHECK tamaño de config.
- **FK `session_id → sessions(id) ON DELETE SET NULL`** en las 5 tablas de evento de spec 02 (la columna `session_id uuid` YA existía sin FK — verificado as-built 0025-0029) + trigger `tg_event_session_tenant_check` (SECURITY DEFINER, EXECUTE revocado) que valida cross-tenant + intra-tenant (`status='active'` + rodeo del perfil == `sessions.rodeo_id`).
- **Gating capa DB**: `assert_data_keys_enabled(profile_id, data_keys[])` (SECURITY DEFINER, search_path fijo, EXECUTE revocado) — resuelve el rodeo **inline** vía `animal_profiles.rodeo_id` (NO depende de funciones inexistentes), **fail-closed** (rodeo NULL o data_key disabled → raise '23514'). Triggers `BEFORE INSERT` por tabla de evento gateada + trigger `tg_animal_profiles_teeth_gating` `BEFORE UPDATE` para el path dientes/CUT (que no es INSERT).
- **Enum repro**: `+ 'tacto_vaquillona'` + enum `heifer_fitness_result` (apta|no_apta|diferida) + `reproductive_events.heifer_fitness`.

## Conflictos resueltos durante la redacción

- **C1 — NO hay tabla `batches` ni reversión de lote en MVP.** Mi brief inicial elaboró mal "ADR-020 = batches + reversión". ADR-020 es explícito (§5: la tanda de manga se modela como sesión, feature 03, NO reusa `management_groups`; §3: ninguna sesión auto-asigna lote). → jornada = `sessions` (nueva); lote = `management_groups` (spec 02, per-animal manual). El spec_author siguió el Gate 0 + ADR (jerarquía de verdad), correctamente. Profundidad de reversión = decisión abierta D2 (default: sin reversión de jornada en MVP).
- **C2 — `session_id` ya existe (sin FK) en las 5 tablas de evento.** spec 03 cierra la FK + tenant-check (coordinación liviana backend, D1).
- **C3 — `corrects_event_id`/`correction_reason` (ADR-017) NO se agregan.** spec 02 ya modela corrección vía edit-window + soft-delete + recálculo R6.14; sin reversión de lote (C1) no hacen falta. Decisión abierta D4.

## Gates de seguridad

### Gate 1 — FAIL → endurecido → **PASS** (re-audit)
Reporte: `progress/security_spec_03-modo-maniobras.md` (259 líneas, re-audit con trazabilidad finding→CERRADO/ABIERTO).

- **1ª corrida = FAIL** (3 HIGH + 2 MED + 1 LOW). El I/O se estabilizó y el analyzer verificó contra los `.sql` as-built reales:
  - **SEC-SPEC-03-02 (HIGH)**: la spec daba por existentes `current_animal_rodeo`/`get_rodeo_data_keys` (grep 0 hits en 0001-0049). **Error originado en mi brief de leader** — las afirmé como existentes. → resuelto: rodeo resuelto inline.
  - **SEC-SPEC-03-01 (HIGH)**: dientes/CUT es `UPDATE animal_profiles`, no INSERT → los triggers BEFORE INSERT no lo cubrían. → resuelto: trigger BEFORE UPDATE.
  - **SEC-SPEC-03-03 (HIGH)**: gating sin fail-closed explícito → posible bypass. → resuelto: raise explícito.
  - **SEC-SPEC-03-04/05/06 (MED/MED/LOW)**: tenant-check intra-tenant / find-or-create de spec 09 / config jsonb sin límite.
  - El analyzer confirmó que el diseño **NO repite** la clase SEC-HIGH-01 de spec 02 (revoke EXECUTE, created_by forzado, search_path fijo, RLS canónico — todos presentes).
- **2ª corrida = PASS.** 3 HIGH cerrados con evidencia dura. Sin recursión en el trigger nuevo. 2 NEEDS_CLARIFICATION restantes = decisiones de PRODUCTO para la puerta humana, NO de seguridad:
  - **D8** — gating capa-2 del path dientes/CUT: default = enforce (ya especificado); Raf puede excluirlo conscientemente (riesgo: bloquea cambios de teeth_state en rodeos que no trackean dientes).
  - **D9 / SEC-SPEC-03-05** — contrato de seguridad del find-or-create inline se re-verifica en Gate 2 (code) cuando spec 09 esté implementada.

## Decisiones abiertas para Raf (design.md §9, D1..D9)

D1 FK session_id sobre tablas de spec 02 (coordinación backend) · D2 profundidad de reversión (default: sin reversión de jornada MVP) · D3 `work_lot_label` · D4 columnas de corrección ADR-017 · D5 contadores animal_count/event_count app vs trigger · D6 bastón con balanza integrada (extensible, no asumido) · D7 scope del preset (default: por establishment) · **D8 gating dientes/CUT (default enforce)** · **D9 find-or-create se cierra en Gate 2**.

## Resolución de decisiones abiertas + hardening (puerta humana, 2026-05-30)

Raf resolvió en la puerta las 4 decisiones que quedaban abiertas, y pidió una pasada de **cuestionamiento crítico** antes de cerrar (ver [[feedback_cuestionar_antes_de_gates]] — aplica a todo a futuro). Resoluciones foldeadas a la spec:

- **D1 = spec 03 cierra la FK** `session_id` (migración 0052, coordinación liviana de migraciones).
- **D2 = sin reversión de jornada en MVP** (corrección per-evento de spec 02; reevaluar si aparece el caso real).
- **D8 = ENFORCE AFINADO** del gating dientes/CUT: el trigger gatea solo cambios **aditivos** (escriben dato: `teeth_state`→no-NULL, `is_cut` false→true) y **permite** los **sustractivos** (limpieza: `teeth_state`→NULL, `is_cut` true→false). Mismo blindaje que el enforce bruto, sin trabar la limpieza de datos heredados. (Nota factual corregida: `is_cut`/CUT = descarte por dentición, NO castración — verificado as-built 0015/0018/0020.)
- **D9 = dependencia de orden**: contrato del find-or-create inline se re-verifica en Gate 2 cuando spec 09 esté integrada (T2.12).

**Hardening del leader** (cuestionamiento pre-Gate 1, aprobado por Raf), foldeado por spec_author:
- **R4.7 (nuevo)** — detección de "rodeo de jornada mal elegido": si los primeros ~3 animales son todos de otro rodeo, sugerir cambiar el rodeo de la sesión en vez de mover en masa (previene corrupción masiva de `rodeo_id`, que NO es reversible por "deshacer jornada" porque los movimientos de rodeo no son eventos). + **R4.4 mejorado** (confirmación muestra rodeo de origen).
- **R10.8 (nuevo)** — surfacing de eventos rechazados al sincronizar (gating capa 2 / tenant-check): visibles al operario con motivo, no dead-letter silencioso (principio offline-first). + nota de **orden de cierre offline** (interacción con el check intra-tenant "sesión active", SEC-SPEC-03-04) + test en T2.6.
- **R6.9** — captura explícita de peso por balanza (no pasiva del stream, evita adjudicar lectura con lag).
- Notas: R de cliente (Fase 3/4) marcadas **PROVISIONALES** (dependen de 04/05/09 — rot anticipado por Gate 0); coordinación de numeración de migraciones con la terminal paralela; dientes-sin-historial **lockeado por Gate 0**; umbral CUT 3/4 + multi-operario a validar con Facundo/beta.

Líneas reales tras el fold: requirements 340, design 593, tasks 241 (verificadas en disco). Reporte Gate 1: 264 líneas.

## Estado del flujo SDD

`context_ready` → ✅ spec_author → ✅ Gate 1 FAIL → ✅ endurecido → ✅ Gate 1 re-audit PASS → ✅ **puerta: Raf resuelve D1/D2/D8/D9 + hardening #1–#5** → ✅ **Gate 1 re-audit del delta PASS** → **⏸ PUERTA 1 (Raf aprueba la spec)** → [pendiente] implementer (otra etapa; coordinar con la terminal de frontend que toca app/) → reviewer → Gate 2 → ⏸ Puerta 2.

**NO se invocó implementer.** La spec espera aprobación humana. `check.mjs` verde (typecheck + RLS 15 + Edge 26 + animal spec 02 28; anti-hardcode 0 violaciones; RC=0).

## Nota de proceso (entorno inestable)

Sesión con I/O del harness muy inestable: tool results entregados con demoras largas y fuera de orden; el 1er intento de spec_author y el 1er lanzamiento de Gate 1 reportaron éxito falso / no persistieron en disco. Mitigación: protocolo write→read-back→retry en cada subagente + verificación independiente del leader por métricas computadas (line counts, grep counts, verdict greps) en vez de confiar en el render del output. 2 temporales de 0 bytes limpiados. `feature_list.json` lo edita en paralelo la terminal de frontend — solo se tocó el `status` de feature 3 (no re-tocar para no pisar sus cambios).
