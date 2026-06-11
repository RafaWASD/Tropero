# Review — Spec 10 Fase 1 (backend delta: 0084/0085/0086 + suite operaciones_rodeo)

Veredicto: APPROVED

Re-run limpio (la corrida previa se cayo por socket antes de emitir). Baseline del diff: 78c18083289f4cebe9a5aae3662352108d2a51a4. Gate 2 de seguridad ya PASS (0 HIGH / 0 MED) — esta revision enfoca CORRECTITUD funcional, no re-audita seguridad.

## Verificacion que corri
- node scripts/check.mjs -> exit 0 (confirmado con el exit code). Todas las suites verdes.
- Suite operaciones_rodeo: 22 sub-tests, 22 pass, 0 fail (20 T-DB.* funcionales + setup + teardown). T-DB.4(e) y T-DB.4(f) presentes y verdes explicitamente.
- Suite animal (con el assert T2.27 reconciliado): 82/82 pass. T2.27 verde.
- Remoto verificado read-only (Management API database/query): 2 columnas nuevas con tipo/default correcto; 0086 desplegado con guard simetrico (sin guard viejo), respeta override, perfil-activo-unico, delega compute_category + apply_auto_transition; trigger animals_apply_castration sigue siendo el de 0064 (AFTER UPDATE OF is_castrated) — 0086 NO re-creo el trigger; orden de triggers BEFORE correcto.
- Sin rojos. Sin deuda ajena nueva atribuible a este diff.

## Foco 1 — Orden invertido 0084 (is_castrated) ANTES de 0085 (future_bull)
(a) Dependencia REAL confirmada: tg_normalize_future_bull (0085:38) lee new.is_castrated; el trigger se crea en 0085 -> la columna debe existir antes -> 42703 si se aplica al reves. No inventada.
(b) Specs reconciliadas: design.md seccion 4 (linea 152) trae nota AS-BUILT con numeros finales y el orden invertido justificado; tasks.md T-DB.1/T-DB.2 marcan los numeros finales (0085/0084) y la razon. Coherente.
(c) No rompe otra suposicion de orden: 0085 tambien lee new.animal_sex (forzado por 0079 force_animal_identity); el orden alfabetico de disparo garantiza force_animal_identity (f) < normalize_future_bull (n). Verificado contra pg_trigger en el remoto y en T-DB.4(f).

## Foco 2 — Pre-filtro de la propagacion espeja LITERAL rodeo_check (0021)
0084:93-99 vs 0021:28-34. Las 4 condiciones identicas: r.id = ap/new.rodeo_id, r.establishment_id = ap/new.establishment_id, r.active = true, r.deleted_at is null. Unica sustitucion new. -> ap. (correcta: la propagacion no modifica rodeo_id/establishment_id). Sin desviacion. T-DB.4 pre-filtro lo asierta contra el catalogo del remoto en cada corrida (regresion permanente).

## Foco 3 — No-loop
Guards IS DISTINCT FROM en write-through (0084:65,69) y propagacion (0084:92). Cadena: UPDATE perfil -> write-through (guard) -> animals -> recompute 0086 (guard IS NOT DISTINCT FROM) + propagacion (guard + pre-filtro, excluye al originante) -> perfiles restantes -> write-through encuentra animals igual -> 0 filas -> FIN. T-DB.4(d) prueba exactamente UNA fila de history nueva tras castrar, con margen de 800ms. No tautologico.

## Foco 4 — T-DB.4(e) y T-DB.4(f): prueban lo que dicen
- T-DB.4(e): perfil propio aplicado (true) Y animals actualizado (write-through) Y huerfano STALE (false, salteado por el pre-filtro de rodeo muerto). Luego reactiva rodeo + nuevo flip -> el perfil antes salteado converge a true. Ejercita los 3 paths reales (aplicado / salteado / convergencia), no solo no-aborta. Verde.
- T-DB.4(f): consulta pg_trigger directamente (no convencion de nombres) y asierta force_animal_identity < force_is_castrated < identity_check < normalize_future_bull. Blinda contra rename futuro. Verde y verificado en el remoto.

## Foco 5 — Recompute simetrico (0086)
Respeta override (v_override is null or v_override = true -> return, 0086:40) -> T-DB.5 override: torito se mantiene, sin fila de history nueva. Perfil-activo-unico (status active + deleted_at is null limit 1, 0086:37). NO re-crea el trigger (verificado: animals_apply_castration intacto en remoto). T-DB.5 cubre torito<->novillito, toro<->novillo, ternero no transiciona en ninguna direccion, cada transicion = auto_transition en history. Verde.

## Foco 6 — Cambio de 1 asercion en tests/animal/run.cjs T2.27 (-> torito)
El animal to (run.cjs:1602) nace torito (400 dias, macho), castrado -> novillito (sigue verificado), luego des-castrado (linea 1628). Con recompute simetrico, compute_category recalcula macho no-castrado a 400 dias -> torito. El nuevo assert torito (1629) es CORRECTO. NO enmascara regresion: las otras aserciones de T2.27 (torito->novillito, toro->novillo RT2.2.4, ternero RT2.2.2, override RT2.2.5) siguen presentes y verdes; solo la asimetria del revert cambio por diseno (0086 supersede RT2.2.6, R13.5/D10). Suite animal 82/82.

## Foco 7 — Idempotencia / estado del remoto
Todas: add column if not exists / create or replace function / drop trigger if exists + create / revoke re-emitible, dentro de begin;/commit;. Idempotentes y re-aplicables. Remoto coincide con disco (columnas, guard 0086, orden de triggers, trigger 0064 intacto).

## Trazabilidad R<n> <-> test (completa)
- R13.3 (denorm fiel) <-> T-DB.4(a)(b)(c)
- R13.4 (write-through up, no force en UPDATE) <-> T-DB.4(a), T-DB.7
- R13.5 (recompute simetrico) <-> T-DB.5 + animal T2.27 (revert->torito)
- R5.6 (override no transiciona) <-> T-DB.5 override
- R5.7 (efecto castracion) <-> T-DB.5
- R12.1 (future_bull solo machos) <-> T-DB.6(a)(b)(d)
- R12.4 (auto-clear al castrar) <-> T-DB.6(c)
- R9.1/R9.2 (roles/tenant) <-> T-DB.7
- R5.5 (destete sustrato) <-> T-DB.8
- R7.3/R9.4 (no-regresion gating) <-> T-DB.9
- R9.4 (superficie: revokes+secdef+search_path+no RPC) <-> T-DB.10 + T-DB.4(f) + T-DB.4 pre-filtro
Cada R<n> de la Fase 1 tiene >=1 test concreto verde.

## Tasks completas
Si. T-DB.1..T-DB.10 todas en [x] en tasks.md con notas as-built. Sin [ ] pendiente en Fase 1.

## Exactitud de specs (codigo -> spec)
- design.md seccion 4 y requirements.md R13.3/R13.4/R13.5/R12.1/R12.4 describen el as-built sin contradiccion. R13.5 nota explicita de supersesion + reconciliacion leader-owned.
- tasks.md reconciliado (numeros finales, orden invertido, modelado transferred, supersesion RT2.2.6).
- Las specs de la feature 10 NO quedaron viejas tras los fixes.

## CHECKPOINTS
- C1 check.mjs exit 0 -> [x]
- C2 coherencia de estado (feature 10 spec_ready, unica activa) -> [x]
- C3 arquitectura (sin hardcode establishment_id; SQL en migrations; sin logs debug sueltos) -> [x]
- C4 verificacion real (fixtures reales contra remoto, runner >0 verdes, RLS aislamiento T-DB.7) -> [x]
- C6 SDD (3 archivos de spec, tasks [x], cada R<n> con test) -> [x]
- C7 multi-tenant (RLS preexistente; T-DB.7 cross-tenant; helpers no duplicados) -> [x]
- C5/C8 -> N/A para este delta backend (C5 lo cierra el leader; C8 offline-first es Fases 2-4 cliente)

## Checklist RAFAQ-especifico
- A (multi-tenancy/RLS): columnas sobre animal_profiles (RLS preexistente, no tabla nueva). Sin policies nuevas (R9.4). Cross-tenant T-DB.7 (userC sin rol no muta; userB field_operator si). deleted_at IS NULL respetado en pre-filtro. -> [x]
- B (offline-first): N/A en este delta — backend server-side; el write-path offline cliente es Fase 2-4. La denorm is_castrated en animal_profiles (que SI sincroniza) es el enabler offline; animals fuera del sync (ADR-026). Documentado design 4.2/4.4.
- C (BLE): N/A — no toca BLE.
- D (UI de campo): N/A — Fase 1 backend; UI es Fases 2-4.
- E (Edge Functions): N/A — sin EF; triggers SECURITY DEFINER validan via RLS de la tabla (T-DB.10 revoke efectivo + no invocables como RPC).

## Cambios requeridos
Ninguno bloqueante.

## Notas / pendientes leader-owned (no bloquean la feature 10)
1. Reconciliacion DOC de spec 02 (RT2.2.6, design-tier2-categorias, tasks-tier2 T8.h, comentario de 0064): stale vs el as-built simetrico. El implementer NO los toco por restriccion explicita (D10, leader-owned). El comportamiento real y los tests ya reflejan el as-built. El leader debe reconciliar la nota DOC de spec 02 antes de cerrar/commitear. No es contradiccion interna de la feature 10.
2. L4 (0086:48): comentario dice revoke ya emitido en 0064; fue en 0065_check_grants.sql:20. Cosmetico; el re-emit idempotente es correcto. Backlog.
3. Ledger apply_migration: 0068-0086 via Management API database/query, no via apply_migration (consistente con el estado pre-existente). Cleanup transversal opcional, no de esta feature.
