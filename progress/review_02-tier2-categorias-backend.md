# Review — Spec 02 Tier 2/3 backend: modelo de categorias de cria

**Reviewer**: reviewer (RAFAQ) · **Fecha**: 2026-06-04 (sesion 22)
**Alcance**: delta backend Tier 2/3 spec 02 — migraciones 0059-0067 + tests T2.20-T2.33 en supabase/tests/animal/run.cjs + bitacora progress/impl_02-tier2-categorias-backend.md. IGNORADO (otras terminales): 0068, spec 04 baston/ADR-024, features 13/14, Edge functions, .claude/agents, app/src/services/{establishments,profile}.ts, app/e2e/helpers/admin.ts.

## Veredicto: APPROVED

---

## 1. Verificacion (node scripts/check.mjs)

Corrido completo. Bloque load-bearing — TODO VERDE:

- typecheck client: OK
- Anti-hardcode (ADR-023 §4): 0 violaciones
- client unit: 313/313
- RLS suite: 17/17
- Edge Functions suite: 36/36
- Animal suite (spec 02): 42/42 (28 regresion T2.1-T2.19 incl. los 8 sub-casos de T2.19 + 14 nuevos T2.20-T2.33)
- Maneuvers suite (spec 03): 13/13
- "All tests passed." -> "[OK] Tests verdes"

El exit code 1 de check.mjs proviene EXCLUSIVAMENTE de "[FAIL] 2 features en in_progress (maximo 1)" (validacion de feature_list.json — features 01 + user_private de OTRAS terminales). Estado de coordinacion, NO de este chunk, y feature_list.json esta fuera de su alcance. Tal como indica el brief, se ignora: el bloque de tests/typecheck/anti-hardcode esta integramente verde.

---

## 2. Trazabilidad RT2.x <-> test (lista completa)

| RT2.x | Test |
|---|---|
| RT2.1.1/1.2/1.3 seed novillito/novillo idempotente + base intacta | T2.20 |
| RT2.2.1 is_castrated columna + default | 0060 + T2.32 |
| RT2.2.2 ternero castrado sigue ternero hasta destete | T2.24, T2.27 |
| RT2.2.3 torito + castrar -> novillito | T2.27 |
| RT2.2.4 toro>=2a + castrar -> novillo (NO novillito) | T2.27 |
| RT2.2.5 override bloquea castracion | T2.27 |
| RT2.2.6 true->false NO revierte | T2.27 |
| RT2.3.1-3.5 rama macho (ternero/torito/toro/novillito/novillo/null->torito) | T2.21 |
| RT2.4.1 >=2 partos -> multipara | T2.25 |
| RT2.4.2 1 parto -> vaca desde cualquier cat (incl. ternera) | T2.25 |
| RT2.4.3 tacto+ -> prenada | T2.26 |
| RT2.4.4 destete/servicio/>=1a -> vaquillona | T2.22, T2.23, T2.24 |
| RT2.4.5 <1a -> ternera | T2.22 |
| RT2.4.6 null sin eventos -> vaquillona | T2.22 |
| RT2.5.1/5.2/5.3 servicio (ternera->vaquillona; no retrocede prenada/vaquillona; override) | T2.23 |
| RT2.6.1/6.2/6.3/6.4 destete machos/hembras; no retroceso; override | T2.24 |
| RT2.7.1/7.2 parto desde cualquier cat; mellizos = un parto | T2.25 |
| RT2.7.3/7.4/7.6 aborto revierte prenada; multipara queda; override | T2.26 |
| RT2.7.5 aborto-revierte-tacto sobrevive recompute; por fecha | T2.29 |
| RT2.8.2/8.3/8.4/8.5 cron (recalcula age-stale; respeta override/soft-delete; no toca no-cruzados; history) | T2.33 |
| RT2.9.1/9.2/9.3 nursing true/false; ortogonalidad; consistencia bajo borrado; mellizos | T2.28 |
| RT2.10.1/10.2/10.3 consistencia trigger<->recompute en todos los caminos | T2.29 |
| RT2.10.4 castracion -> history auto_transition | T2.27 |
| RT2.11.1/11.2 override manda en todas; revert recalcula | T2.30 |
| RT2.12.1/12.5 is_castrated cross-tenant bloqueado; field_operator del tenant si | T2.31 |
| RT2.12.2 apply_auto_transition no invocable por authenticated | T2.31 + T2.18 base |
| RT2.12.3 compute_category/compute_nursing derivan del profile_id | diseno + T2.21/22 + smoke 0065 |
| RT2.12.4 trigger castracion deriva el perfil de la fila real | 0064 + T2.31 |
| RT2.12.6 / M02 refresh_age_categories no invocable + smoke-check fail-closed | T2.33 + smoke 0066 |
| RT2.13.1/13.2 no toca historico; defaults false; base no migra por seed | T2.32 |

Ningun RT2.<n> queda sin test. RT2.20 es dependencia de frontend explicitamente anotada (no requirement de este chunk); T9 dejo el recordatorio.

---

## 3. Tasks completas

Si. tasks-tier2-categorias.md T1-T8 (+ T7bis) en [x]. Los sub-bullets T8.b-T8.n figuran con [ ] en el cuerpo de la tarea madre T8, PERO T8 esta [x] y cada sub-caso esta implementado y verde como T2.20-T2.33 — granularidad de plan, no tasks pendientes; la bitacora los marca [x] y la suite los corre verdes. T9 (recordatorio frontend RT2.20) [x]. T10-T12 (gates) son del leader. No queda task de implementacion sin justificar.

0067 (trigger nursing sobre birth_calves) NO estaba en el plan original: agregado en autorrevision para cerrar el bug de mellizos. Justificado, backend, dentro de RT2.9.1, no reabre spec. Correcto.

---

## 4. CHECKPOINTS.md

- C1 harness completo — [x] (archivos/docs/agentes presentes; exit!=0 SOLO por feature_list de otras terminales)
- C2 estado coherente — [ ] (2 features in_progress: coordinacion de OTRAS terminales, fuera de alcance; los tests de las features done pasan)
- C3 codigo respeta arquitectura — [x] (backend SQL; sin hardcode de establishment_id; sin TODOs sueltos; anti-hardcode 0)
- C4 verificacion real — [x] (>=1 test por regla; fixtures reales contra remoto dev; runner 42/42; cross-tenant T2.31)
- C5 sesion cerrada — N/A para el reviewer del chunk (lo cierra el leader)
- C6 SDD — [x] (3 archivos spec presentes; EARS RT2.x; tasks [x]; cada RT2.x con test)
- C7 multi-tenant — [x] (sin tabla nueva; columnas heredan RLS de animals/animal_profiles; has_role_in usado; T2.31 cross-tenant)
- C8 offline-first — [x] (columnas viajan con tablas ya sincronizadas; efecto del cron sincroniza por la sync rule de animal_profiles; last-write-wins doc en design §4)

---

## 5. Checklist RAFAQ-especifico

- Seccion A (multi-tenancy / RLS): APLICA (toca animals/animal_profiles, ambas con establishment_id directo/transitivo).
  - [x] enable RLS — no se agregan tablas; las existentes ya lo tienen (0022). is_castrated/nursing heredan la RLS de su tabla; 0060/0061 NO agregan policy nueva (correcto, no abre camino cross-tenant).
  - [x] Policies segun ADR-004/as-built — sin policy nueva; hereda animals (0022) y animal_profiles (0022).
  - [x] Helpers has_role_in — la RLS de animals/reproductive_events que gatea las escrituras que disparan los triggers usa has_role_in (0022 l.27/38, 0026 l.66/69). Triggers SECURITY DEFINER derivan tenant de la fila real.
  - [x] Test aislamiento cross-tenant — T2.31 (userC sin rol NO togglea is_castrated de estA; field_operator de estA si; apply_auto_transition no invocable).
  - [x] deleted_at IS NULL en SELECT — heredado de las policies existentes; compute_category/compute_nursing/refresh filtran deleted_at is null explicitamente.
- Seccion B (offline-first): N/A — backend puro de transiciones; los eventos disparadores ya sincronizan (R13.1). Sin pantalla nueva.
- Seccion C (BLE): N/A.
- Seccion D (UI de campo): N/A — sin frontend en este chunk.
- Seccion E (Edge Functions): N/A — sin Edge Functions; toda la logica es triggers/RPC en Postgres (ADR-012).

---

## 6. Checklist de revision especifico del chunk (brief)

- compute_category (0062): OK. Rama macho coincide con ADR-008 enmendado (corte 2a->toro/novillo; destete o >=1a->torito/novillito leyendo is_castrated; <1a->ternero; null->default por sexo, sin corte 2a). Rama hembra orden LOAD-BEARING correcto (partos>=2 > partos=1 > tacto+ > vaquillona > ternera > default). Conteo de PARTOS (eventos birth distintos, no terneros/birth_calves) conservado (l.62-65). Aborto-revierte-tacto por (event_date, created_at) con NOT EXISTS de aborto posterior (l.70-83). Cortes de edad on-recompute (sin logica de reloj). SECURITY DEFINER STABLE + grant a authenticated conservados (l.15, 108).
- Consistencia trigger<->recompute (0063, RT2.10): OK. El incremental DELEGA a compute_category (l.37), no hardcodea targets. Recalculo 0046 (funcion reusada, no editada) recreado con OF ampliado a event_date (l.48-50); el deleted_at ya cubria soft-delete de service/weaning/abortion. T2.29 verifica que borrar evento revierte correcto (ternera/ternero/vaca) sin quedar pegado ni revertir por edad.
- Castracion (0064): OK. Delega a compute_category (toro recien castrado @800 -> novillo, no novillito, T2.27). Solo false->true (l.29). Respeta override (l.39). Registra history via apply_auto_transition (l.45). Resuelve perfil activo con el partial-unique 0020 (l.36, limit 1 deterministico — el indice 0020 garantiza a lo sumo un perfil activo por animal).
- Cria al pie (0061 + 0067): OK. Columna nursing materializada por trigger via compute_nursing. Fix de mellizos 0067: trigger AFTER INSERT ON birth_calves cierra el hueco (register_birth inserta birth ANTES de poblar birth_calves en el loop -> el AFTER INSERT de nursing de 0061 corria con birth_calves vacio). Verificado: para el caso mono el orden alfabetico de triggers AFTER INSERT (link_birth_calf < recompute_nursing_ins, 0048) ya garantizaba nursing=true; 0067 lo refuerza y cubre mellizos. No abre superficie: birth_calves sin GRANT INSERT cliente (0045 l.39; 0049 solo SELECT a service_role); el trigger es SECURITY DEFINER con EXECUTE revocado de clientes (0067 l.36). Ortogonalidad confirmada: UPDATE solo de nursing, no toca category_id/rodeo_id/management_group_id (T2.28).
- Seed novillito/novillo (0059): OK. Idempotente (on conflict (system_id, code) do nothing), join por .code, no toca code/active de las 10 base (T2.20 verifica las 10 siguen activas).
- Cron (0066): OK. Filtro targeted (ternero/ternera@365 OR torito/novillito@730; override=false; deleted_at null; birth_date not null; hembras SIN corte 2a excluidas; toro/novillo terminales excluidos). refresh_age_categories REVOCADA de public/authenticated/anon (control PRINCIPAL, returns void -> se expondria como RPC sin el revoke) + smoke-check fail-closed. Cambia categoria SOLO via apply_auto_transition (no UPDATE directo). cron.schedule idempotente con unschedule defensivo previo. T2.33 verifica targeted + override + soft-delete + no-invocable-por-authenticated.
  - Decision D2 (grant execute ... to service_role): CORRECTA, no debilita M02. El revoke cascadeo el EXECUTE TO PUBLIC que cubria service_role; el grant lo restituye solo para service_role. service_role NO es rol cliente (key admin server-side, nunca al browser, ya bypassea RLS — cualquier cosa que pudiera hacer via esta funcion ya la puede hacer con UPDATEs directos). El control de M02 es el revoke de las 3 roles cliente expuestas por PostgREST + el smoke-check (0066 l.67-77 verifica SOLO public/authenticated/anon), intacto y verificado por T2.33. El grant habilita la invocacion operativa + el test (admin.rpc usa service key). Consistente con la convencion dura RAFAQ (grant ... to service_role en cada objeto nuevo, ver 0049). El scheduler pg_cron corre como owner y no necesita este grant.
- Grants/revokes (0065): OK. apply_auto_transition re-revocada (l.12); las 3 trigger-fns revocadas nominalmente (M01, l.19-21) + smoke-check fail-closed (l.25-47, paridad 0055); compute_category/compute_nursing con grant a authenticated reafirmado.
- Tests (T2.20-T2.33): OK. Cubren cada RT2.x; corren con el client del usuario (clientA) donde se ejercita RLS (is_castrated toggle, no-spoof T2.31, compute_category RPC con grant authenticated); admin/service_role solo para verificacion cross-tenant y la invocacion del cron (correcto, revocado de clientes by-design). Regresion T2.1-T2.19 verde.
- Multi-tenant: OK. Ninguna funcion nueva lee/escribe otro tenant indebidamente; los triggers derivan el perfil de la fila real (0064 where animal_id = new.id; 0061/0067 via birth_calves del propio evento; compute_* derivan del profile_id recibido).

---

## 7. Cambios requeridos

Ninguno. Implementacion firme contra spec + as-built. Reglas duras respetadas: no se edito ninguna migracion existente (0046/0045/0048 reusadas via CREATE OR REPLACE de funcion + drop/create de trigger en migracion nueva). Sin tests rojos. check.mjs verde salvo el flag de coordinacion ajeno.

## 8. Observaciones no bloqueantes (para el leader / Gate 2)

1. D1 (metodo de aplicacion): migraciones aplicadas al remoto via Management API (sin DB password para la CLI); supabase_migrations.schema_migrations quedo con versiones timestamp en vez de 0059..0067. El schema real es correcto y los .sql del repo son la fuente de verdad. Re-sync de la tabla de migraciones es opcional y cosmetico, decision del leader.
2. C1 (tension spec 10): este chunk entrega is_castrated + su efecto de categoria; la castracion masiva de spec 10 debe ESCRIBIR is_castrated = true (ademas del sanitary_events) para que la transicion ocurra. Anotado para el implementer de spec 10, no bloquea este chunk.
3. feature_list.json con 2 features in_progress: estado de coordinacion de otras terminales; resolver antes de cerrar la sesion global (no afecta este deliverable).
