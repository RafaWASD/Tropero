# Review — 15-powersync · Run T9.9 (editar plantilla del rodeo OFFLINE)

> Reviewer · 2026-06-09. Foco: CALIDAD + alineacion con spec + checklist RAFAQ (offline/RLS/UI campo).
> Seguridad ya gateada (Gate 1 code: PASS, cero HIGH/MED) — NO se re-audita.

## Veredicto: APPROVED

Con UNA condicion operativa documentada (no bloqueante para el implementer): la migracion 0082 la aplica el
leader por Management API. Hasta entonces el check.mjs server-side esta rojo SOLO por PGRST202 (funcion
inexistente en el remoto) — estado esperado/sancionado (mismo patron 0075-0081), NO un defecto del delta.

---

## Trazabilidad R<n> ↔ test (T9.9)

- R5.1 / R6.4 (editar plantilla offline via RPC + outbox): upload.test.ts "mapIntentToRpc: set_rodeo_config -> rpc SIN p_client_op_id" + run.cjs set_rodeo_config caso 1 (owner edita, filas reflejan enabled).
- R6.10 idempotencia (dedup natural por UPSERT): run.cjs caso 2 (replay = no-op total, sin duplicar filas).
- R6.10 authz owner-only (espeja rodeo_data_config_update/insert 0018): run.cjs caso 3 (field_operator -> 42501, plantilla intacta).
- R6.10 anti-IDOR por derivacion del est: run.cjs caso 4 (rodeo ajeno -> 42501, plantilla victima intacta).
- R6.10 rodeo soft-deleteado: run.cjs caso 5 (P0002) + upload.test.ts "set_rodeo_config P0002 -> permanent_reject".
- R6.12 no doble-upload: arquitectonico — overlay en pending_rodeo_data_config (localOnly, schema.test) + 1 op_intent; enqueueSetRodeoConfig en 1 writeTransaction.
- R6.11 overlay-override (no duplica field en edicion): local-reads.test.ts 4 tests de COMPORTAMIENTO (SQLite real) — sin overlay->synced; edicion pisa; 2 overlays->ultimo (MAX rowid); alta->solo overlay.
- R6.9 clasificacion de errores del drenado: upload.test.ts "set_rodeo_config: 42501/23503 -> permanent_reject; red -> transient".

Cobertura completa. Sin R<n> huerfano para el delta T9.9.

## Tasks completas: SI
T9.9 marcada [x] en tasks.md con todos sus sub-bullets implementados y verificados. El unico [ ] pendiente
es la APLICACION de 0082 (accion del leader, no del implementer) — justificada en la task ("la APLICA el
leader... FALLA hasta que el leader aplique 0082, esperado, patron 0075-0081").

## CHECKPOINTS
- C3 [x] capas respetadas (services/ + screen + migracion + tests); cero hardcode de establishment_id (se deriva del rodeo server-side; en cliente llega por param).
- C4 [x] tests por modulo (unit puros + comportamiento SQLite real + 5 server-side); fixtures reales (usuarios/campos dedicados); cross-tenant presente (caso 4).
- C6 [x] los 3 docs reconciliados al as-built; R<n> con test.
- C7 [x] owner-only via is_owner_of (sin SQL inline duplicado), test cross-tenant.
- C8 [x] funciona offline (encolado 100% local), overlay correcto, LWW implicito por UPSERT idempotente.
- C1/C2/C5 N/A al delta (no se cierra la feature; 15-powersync sigue in_progress).

## Checklist RAFAQ-especifico
- A (multi-tenancy/RLS): aplica parcial — NO crea tablas nuevas (1 RPC). Aislamiento cross-tenant cubierto (caso 4). deleted_at IS NULL filtrado en la derivacion del est (0082:58). is_owner_of usado (no inline). [x]
- B (offline-first): [x] funciona offline (enqueue local 1 writeTransaction, siempre OK sin red); overlay scoped por rodeo; LWW via UPSERT idempotente documentado; CERO supabase. directo en el write path de editar-plantilla.tsx (grep: 0 matches de supabase./toggleRodeoField/enableNonDefaultField/OFFLINE_COPY).
- C (BLE): N/A.
- D (UI campo): [x] tokens + componentes de libreria (cero hardcode, ADR-023); loading visible ("Guardando...", flag saving); feedback "Plantilla guardada." con role=status/accessibilityLiveRegion; no-op de diff vacio reporta OK sin encolar (no rompe UX); una decision por pantalla.
- E (Edge Functions): N/A (RPC SQL, no EF Deno). Equivalente cubierto: authz al inicio (is_owner_of), codigos de error apropiados (42501/P0002/23503/22023), tests verdes server-side.

---

## Hallazgos

### Bloqueantes: ninguno.

### LOW / informativos (no bloquean APPROVED)

1. [LOW · backlog ya abierto] Cap de p_toggles ausente — set_rodeo_config no limita el tamano del array
   (asimetria con 0081, que tampoco lo limita). Clasificado LOW por Gate 1 code y ya backlogueado
   (2026-06-09). No bloquea: el array real = el diff de la UI (acotado por field_definitions), RPC owner-only.
   Evidence: 0082:80-92.

2. [INFO] reloadBaseOnly best-effort: si la re-lectura local falla, el proximo diff podria re-emitir ops;
   mitigado por la idempotencia del UPSERT (re-encolar = no-op). Documentado en editar-plantilla.tsx:162-170.

3. [INFO] Asimetria intencional P0002: set_rodeo_config -> permanent_reject (rollback) vs soft_delete_* ->
   idempotent_discard (sin rollback). CORRECTO y deliberado (en soft_delete la baja real ya ocurrio; en
   set_rodeo_config el rodeo desaparecio -> edicion void -> revertir overlay). Comentado upload.ts:144-152, con test.

## Exactitud de specs (codigo -> spec): OK
- tasks.md T9.9 describe el as-built fielmente.
- design.md §1.2 (linea rodeo-config.ts) reconciliada: editar-plantilla encola enqueueSetRodeoConfig; buildRodeoConfigQuery overlay-override.
- design.md §1.1 / tasks linea 113 marcan el UNION-ALL puro como superseded por T9.9, reflejado en local-reads.ts:69-94. Sin contradiccion spec<->codigo.

## Consistencia con T9.8 (create_rodeo): OK
- create_rodeo server-side PASA (caso 1, caso 3 verdes) -> 0081 aplicada, sin regresion por overlay-override
  (el caso "alta synced vacio -> solo overlay" lo cubre el behavior test).
- Reusa buildPendingRodeoConfigInsert / PENDING_OVERLAY_TABLES de T9.8 (sin tabla nueva). Gemelo limpio.

## Regresiones: ninguna
- mapIntentToRpc / classifyIntentUploadError extendidos por adicion -> 82/82 unit verdes.
- buildRodeoConfigQuery (UNION-ALL -> overlay-override) degrada identico con overlay vacio (behavior test) ->
  el caller fetchRodeoConfig no cambia de firma/shape.

## Estado de check.mjs
ROJO exclusivamente por los 5 server-side de set_rodeo_config con PGRST202 (funcion inexistente en el
remoto). Causa unica: 0082 NO aplicada (la aplica el leader). NO hay fallo de logica/assertion ni regresion:
el resto de la suite (incluido create_rodeo T9.8) verde; unit 752/752. Estado esperado/sancionado por el
flujo. Verde garantizado al aplicar 0082.

## Migracion 0082
LISTA para que el leader la aplique por Management API. Aditiva (1 RPC nueva; no toca policies/RLS/triggers
as-built), SECURITY DEFINER + search_path=public, grants revoke public/anon + grant authenticated,
BEGIN/COMMIT, notify pgrst. Anti-IDOR hermetico por derivacion del est. Tras aplicarla, los 5 server-side
pasan a verde y check.mjs queda 100% verde.
