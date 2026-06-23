# Review (modo code, en el merito) — Stream A: modelo de puesta en servicio (delta backend de spec 02)

**Veredicto: APPROVED**

Fecha: 2026-06-23. Revisor: reviewer.
Chunk: Stream A — delta backend de spec 02 (02-modelo-animal, in_progress).
Naturaleza: migraciones 0102-0105 NO aplicadas al remoto (deploy gateado). Revision EN EL MERITO (correctitud del SQL vs design + as-built), patron M5/M6-backend. La suite puesta-en-servicio esta roja-hasta-apply y su hook esta comentado, por eso check.mjs queda verde por construccion (no es verde-falso: ver Foco 4).

Input revisado:
- Migraciones: supabase/migrations/0102_rodeo_service_months.sql, 0103_create_rodeo_service_months.sql, 0104_compute_category_drop_service.sql, 0105_repro_denominator.sql.
- Suite: supabase/tests/puesta-en-servicio/run.cjs (751 lineas) + hook comentado en scripts/run-tests.mjs:70.
- Specs: specs/active/02-modelo-animal/requirements|design|tasks-puesta-en-servicio.md (RPS.x / DD-PS-x / TPS.x, design seccion 8.1).
- Ledger: progress/impl_02-puesta-en-servicio.md. Gate 1 (PASS): progress/security_spec_02-puesta-en-servicio.md.
- As-built verificado contra disco: 0005 (helpers), 0015 (categories: vaca_cabana), 0017 (rodeos/RLS), 0020/0032 (animal_profiles: status/exit_reason/exit_date), 0026 (reproductive_events: service_type_enum), 0053 (enum heifer_fitness), 0054 (gating IA service+ai), 0062 (compute_category original), 0063 (triggers), 0066 (cron), 0081/0082 (RPC rodeo).

---

## Trazabilidad RPS a test (lista completa)

Suite unica: supabase/tests/puesta-en-servicio/run.cjs. Cada RPS con uno o mas asserts concretos contra el oraculo server.

| RPS | Test (archivo:bloque/linea) | Estado |
|---|---|---|
| RPS.1.1/.1.2 NULL vs vacio distinguibles | run.cjs TPS.2 L298-312 | OK |
| RPS.1.3 rango 1-12 | run.cjs TPS.2 L266-277, L314-319 (mes 0/13 rechazo; 1/12 OK) | OK |
| RPS.1.4 sin duplicados | run.cjs TPS.2 L278-283 | OK |
| RPS.1.5 max 12 elementos | run.cjs TPS.2 L284-290, L320-324 | OK |
| RPS.1.6 default primavera en alta | run.cjs TPS.6 L332-341 | OK |
| RPS.1.7 editable | run.cjs TPS.6 L378-391 | OK |
| RPS.1.8 ortogonal a categoria | por construccion: 0104 no lee service_months; sin trigger que la toque (design sec 0) | OK |
| RPS.2.1 backfill NULL | run.cjs TPS.2 L261-265 | OK |
| RPS.2.2 rodeo NULL no aporta natural | run.cjs TPS.15 L645-666 | OK |
| RPS.2.3 is_configured consultable | run.cjs TPS.15 L663-665 | OK |
| RPS.3.1 param en create_rodeo | run.cjs TPS.6 L342-373 | OK |
| RPS.3.2/.3.6 edicion offline idempotente | run.cjs TPS.6 L385-391 (re-aplicar = no-op) | OK |
| RPS.3.3 owner-only | run.cjs TPS.6 L392-400 (field_operator da 42501, no toca nada) | OK |
| RPS.3.4 anti-IDOR por derivacion | run.cjs TPS.6 L401-409 (owner A con rodeo de B da 42501; B intacto) | OK |
| RPS.3.5 re-validacion en RPC | run.cjs TPS.6 L353-362, L417-422 (da 23514) | OK |
| RPS.4.1 quita backstop service a vaquillona | run.cjs TPS.8(a) L438-445 (hembra <365 con solo service SIGUE ternera) | OK |
| RPS.4.2 destete a vaquillona | run.cjs TPS.8(b) L446-452 | OK |
| RPS.4.3 transiciones intactas | run.cjs TPS.8(d) L464-489 (tacto+/aborto-revierte/1parto/2partos/castracion) | OK |
| RPS.4.4 corte de edad + cron | run.cjs TPS.8(c) L453-463 + TPS.10 L550-561 (history auto_transition) | OK |
| RPS.4.5 recompute con service historico = sin el | run.cjs TPS.8(e) L490-512 (discriminante <365: borrar destete da TERNERA) | OK |
| RPS.4.6 props de seguridad de compute_category | diff quirurgico verificado (Foco 1) + comportamiento TPS.8 | OK |
| RPS.4.7 consistencia incremental vs recompute | por construccion (0063 sin tocar; ambos delegan) + TPS.8(e) | OK |
| RPS.4.8 IA: ternera+IA sigue ternera, cuenta como servida | run.cjs TPS.9 L518-545 (aparece en serviced_females rama ai) | OK |
| RPS.5.1 servidas = natural union IA | run.cjs TPS.15 L608-619 | OK |
| RPS.5.2 probadamente servidas SIN gate; FIX VETO vaquillona_prenada cuenta | run.cjs TPS.15 L612-613 (vqPren CUENTA) | OK |
| RPS.5.3 APTA cuenta / NO_APTA-DIFERIDA no | run.cjs TPS.15 L614-616 | OK |
| RPS.5.4 fallback por edad | run.cjs TPS.15 L617 | OK |
| RPS.5.5 entoradas = servidas - retiradas | run.cjs TPS.15 L632-643 | OK |
| RPS.5.6 tenant-scoped sin IDOR | run.cjs TPS.15 L668-682 (owner B da 42501 en las 3; field_operator de A SI lee) | OK |
| RPS.5.7 union distinct | run.cjs TPS.15 L622-630 (gana natural) | OK |
| RPS.5.8 campana = service_months + ano | run.cjs TPS.15 L663-665 + TPS.9 | OK |
| RPS.5.9 read-only | run.cjs TPS.15 L696-705 | OK |
| RPS.5.10 cota p_year en SQL de las 3 | run.cjs TPS.15 L684-694 (futuro/1800 da 22023 en las 3) | OK |
| RPS.6.1/.6.4 enum 3 + rechazo 4to | run.cjs TPS.16 L722-744 | OK |
| RPS.6.2 DIFERIDA no descarta | run.cjs TPS.16 L731-736 (is_cut=false, status=active) + TPS.15 L616 | OK |
| RPS.6.3 heifer_fitness no categoriza | run.cjs TPS.16 L727-730 | OK |
| RPS.7.1 multi-tenant transversal | suma de RPS.3.3/.3.4/.5.6 | OK |
| RPS.7.2 numeracion >=0102, no aplicar | 0102-0105 escritas; suite roja-hasta-apply (hook comentado) | OK |
| RPS.7.3 design reconciliado | design seccion 8.1 | OK |
| RPS.7.4 espejo client-side | DEPENDENCIA anotada (frontend Stream B/C6, NO este chunk) | OK (anotada) |
| RPS.7.5 Gate 1 findings reflejados | RPS.5.10 foldeado; security_spec_02 PASS | OK |

Sin huecos: los 5 focos del prompt cubiertos — RPS.1.3 CHECK, RPS.3 owner-only+anti-IDOR, RPS.4 compute_category sin service, RPS.5 derivacion (incl. vaquillona_prenada cuenta L613 + p_year fuera de rango rechazado L684-694), RPS.6 enum.

---

## Foco 1 — compute_category (0104): diff vs 0062 es SOLO la remocion de v_has_service

Compare 0104 contra 0062 linea a linea. Unicas diferencias ejecutables (3, todas = remocion de v_has_service):
1. Declaracion: 0062:25 v_has_service boolean eliminada (0104:50 deja comentario v_has_service ELIMINADA).
2. SELECT EXISTS: 0062:42-44 (select exists ... event_type service ... into v_has_service) eliminado.
3. Termino de rama vaquillona: 0062:93-94 (elsif v_has_weaning or v_has_service or edad>=365) pasa a 0104:115 (elsif v_has_weaning or edad>=365).

Identicos (verificado): firma compute_category(profile_id uuid) returns uuid; language plpgsql security definer stable; set search_path = public; el select con los 3 joins (deriva todo del profile_id, sin cross-tenant); v_age_days; el select exists weaning; la rama macho completa (cortes 730/365/<365/default, is_castrated da toro/novillo/torito/novillito/ternero); el conteo de PARTOS (event_type birth); el tacto+ vigente con aborto-posterior (RT2.7.5); la precedencia LOAD-BEARING (partos>=2 mayor partos=1 mayor tacto+ mayor vaquillona mayor ternera mayor default); el return select de categories_by_system; el grant execute to authenticated. No se colo ningun otro cambio. RPS.4.6/RPS.4.3 sin riesgo.

0063 (guard del trigger incremental): NO tocado — 0063:29 conserva service en la lista (recomendacion firme DD-PS-4: recompute idempotente porque compute_category ya no lee service). RT2.10.1 garantizada por construccion (ambos caminos delegan).

---

## Foco 2 — El fix del veto esta en rodeo_serviced_females (0105)

0105:125-145, rama eligible_natural:
- Probadamente servidas SIN gate (0105:127): c.code in (vaquillona_prenada, vaca_segundo_servicio, multipara, vaca_cabana) — vaquillona_prenada INCLUIDA (el fix del veto: una vaquillona de 1er servicio que concibe NO sale del denominador al diagnosticarse prenada). Verificado que vaca_cabana existe en categories_by_system (0015).
- Gate solo para vaquillona pelada (0105:128-144): c.code igual a vaquillona AND (ultimo heifer_fitness apta OR fallback por edad sin veredicto). NO_APTA/DIFERIDA vigente no cuenta (no es apta y hay veredicto, no cae al fallback).
- cut FUERA: no aparece en el set incondicional (TENTATIVO documentado, design seccion 5.2 + header 0105:92-94).

Test: TPS.15 L613 (vqPren CUENTA), L612 (multipara cuenta), L614-617 (apta cuenta / no_apta-diferida no / fallback de edad cuenta).

---

## Foco 3 — Anti-IDOR por derivacion + grants/revokes + smoke-check fail-closed

- set_rodeo_service_months (0103:182-187): deriva v_est del rodeo (select establishment_id where id = p_rodeo_id and deleted_at is null), NO es parametro, por eso is_owner_of(v_est) (0103:192) es hermetico por construccion (espeja 0082:53-70). Inexistente/soft-deleted da P0002.
- 3 funciones de derivacion (0105): cada una deriva v_est del rodeo + has_role_in(v_est) ANTES de leer (campaign 0105:35-43, serviced 0105:101-106, denominator 0105:196-200) + p.establishment_id=v_est / p.rodeo_id=p_rodeo_id en los CTEs. Caller de otro tenant da 42501 sin lectura (espeja 0066/0082).
- Grants/revokes: assert_service_months_valid revocado de public/anon/authenticated (interno; 0103:46); create_rodeo y set_rodeo_service_months revoke public/anon + grant authenticated (0103:160-161,214-215); las 3 de derivacion revoke public/anon + grant authenticated (0105:227-232).
- Smoke-check fail-closed (patron 0066/0055/0097): 0103:224-254 (helper internal-only + RPC sin anon/public da raise si falla); 0105:237-252 (las 3 sin anon/public da raise si falla).
- search_path=public: presente en helper (0103:24), ambas RPC (0103:75,176), las 3 de derivacion (0105:32,98,193), y compute_category (0104:41).

---

## Foco 4 — Suite roja-hasta-apply correctamente gateada (NO verde-falso)

- Hook comentado en scripts/run-tests.mjs:70 con nota DESCOMENTAR cuando el LEADER aplique 0102-0105. Las demas suites (animal, maneuvers, custom, scrotal, etc.) corren.
- NO es verde-falso: la suite tiene asserts reales contra el oraculo server (no stubs) — p.ej. assert.deepEqual service_months 10,11,12 (L340), assert.match pgcode 42501 (L405), assert.ok ids.has(vqPren) FIX VETO (L613), assert.equal code ternera (L444/L538). Corre contra la base remota (service_role para fixtures, JWTs reales para authz). Al aplicar, su verde confirma no-bypass / authz / fix del veto.
- node scripts/check.mjs da VERDE (Entorno listo). El verde proviene de typecheck + client unit tests + anti-hardcode + las suites backend aplicadas; la suite nueva no corre por estar comentada (esperado).

Nota operativa (no bloqueante): en la 1ra corrida de check.mjs la suite animal (spec 02 base, NO Stream A) aborto con TypeError Cannot read properties of undefined reading id en seedNoTagAnimal — flake de rate-limit de auth de Supabase (setup fallo, rodeoA undefined), patron documentado. Re-corrida aislada: animal 109 pass / 0 fail, y check.mjs completo VERDE. No es regresion ni tiene relacion con Stream A (suite comentada, migraciones no aplicadas).

---

## Foco 5 — Las 3 desviaciones del implementer (design seccion 8.1) son correctas y no cambian ningun RPS

1. cardinality() vs array_length() (0102:38,40 CHECK + 0103:35,40 helper): array_length(vacio,1) da NULL, hacia depender el vacio de NULL-no-es-FALSE-pasa-el-CHECK; cardinality(vacio) da 0, logica booleana definida. Mismo contrato (rechaza rango/dup/mas de 12, acepta NULL/vacio). RPS.1.2-1.5 sin cambio. Mejora de robustez.
2. Rama IA filtra a.sex female (0105:153,158): el design seccion 5.2 no filtraba sexo en ai_females; la funcion es serviced_FEMALES y RPS.5.1 dice hembras con un evento de IA, defensa contra un service+ai sobre un macho. Sin cambio para datos validos. RPS.5.1 sin cambio.
3. Validacion incondicional en set_rodeo_service_months (0103:199): el helper short-circuitea NULL (0103:26-28), perform assert incondicional equivale al if-not-null del design, mas simple. RPS.3.5 sin cambio.

Las 3 estan reconciliadas en design seccion 8.1 (no queda design mintiendo).

---

## Exactitud de specs (codigo a spec)

- design seccion 8.1 describe numeracion final (0102-0105) + las 3 desviaciones as-built + 0063-no-tocado + heifer_fitness-sin-migracion + suite-comentada: coincide con el codigo leido.
- requirements no contradice el as-built: el QUE (comportamiento/contrato) quedo como los EARS; las 3 desviaciones son de COMO (foldeadas en design seccion 8.1, no tocan ningun RPS).
- El fix del veto (RPS.5.2) esta reflejado en requirements (Historial 2026-06-23) Y en el SQL (0105:127) Y en el test (L613).
- Detalle menor no bloqueante: el header de 0105:187-189 agrega una NOTA (por que retired re-evalua status sobre el conjunto natural union ai completo) que no esta literal en design seccion 5.3 — aclaracion consistente con el SQL (la rama AI no filtra status, una inseminada vendida cuenta como servida+retirada), no una desviacion de comportamiento. No exige reconciliacion.

---

## Tasks completas: si

tasks-puesta-en-servicio.md: TPS.0-TPS.17 + TPS.19 en [x]. TPS.18 en [ ] con justificacion documentada: es Gate 1 (security_analyzer modo spec), ya ejecutado y PASS por el leader pre-Puerta 2 (progress/security_spec_02-puesta-en-servicio.md, 0 HIGH, RPS.5.10 foldeado). No es una task de codigo pendiente, es un gate ya superado. No bloquea.

---

## CHECKPOINTS

- C1 — [x] check.mjs exit 0 (verde, re-corrida limpia).
- C2 — [x] una sola feature in_progress (02-modelo-animal); este chunk no marca done.
- C3 — [x] solo SQL/migraciones (capa backend prevista); sin deps nuevas; sin logs de debug; no se hardcodea establishment_id (se deriva del rodeo en toda RPC/funcion, verificado).
- C4 — [x] tests con fixtures reales (service_role + JWTs reales), no mocks; mas de 0 tests; test de aislamiento cross-tenant presente (RPS.3.4/RPS.5.6).
- C6 — [x] requirements en EARS; cada RPS con uno o mas tests; tasks [x] (TPS.18 justificada).
- C7 — [x] rodeos ya tiene RLS (0017, heredada por la columna nueva); helpers has_role_in/is_owner_of usados (no SQL inline duplicado); test cross-tenant (owner B da 42501).
- C8 — [x] escritura de service_months offline-first via RPC drenable (overlay optimista + outbox, mismo patron set_rodeo_config); idempotencia = last-write-wins explicito (UPDATE idempotente, RPS.3.6).
- C5 — [ ] N/A en este chunk (cierre de sesion / history.md lo hace el leader; no aplica al review del delta).

---

## Checklist RAFAQ-especifico

### A. Tablas con establishment_id (multi-tenancy / RLS) — APLICA
- [x] RLS: rodeos ya tiene RLS habilitado (0017); la columna service_months la hereda (no es tabla nueva, no requiere enable rls extra). Las 3 funciones de derivacion son SECURITY DEFINER con guard explicito (no dependen de RLS, la reemplazan con has_role_in al entrar).
- [x] Policies select/insert/update/delete: la escritura va por RPC owner-only (espeja rodeos_insert/rodeos_update = is_owner_of, ADR-004 model); la lectura del denominador por guard has_role_in.
- [x] Helpers has_role_in() / is_owner_of() usados (no SQL duplicado inline), verificado en 0103/0105.
- [x] Test de aislamiento cross-tenant: owner A con rodeo de B da 42501 (RPS.3.4, L401-409); owner B no lee las 3 funciones de A da 42501 (RPS.5.6, L668-677).
- [x] deleted_at IS NULL: filtrado en la derivacion del rodeo (0103:184, 0105:36,102,196) y en los CTEs de animal_profiles (0105:122,157). has_role_in/is_owner_of ya filtran establishments.deleted_at is null (0005).

### B. Carga/edicion de datos en campo (offline-first) — APLICA (escritura de service_months)
- [x] Funciona offline: RPC drenable desde la outbox de PowerSync (overlay optimista), mismo patron set_rodeo_config/create_rodeo (design seccion 3, ledger). El test ejercita la RPC via PostgREST (camino del cliente).
- [x] Sync bucket: rodeos ya esta en bucket sincronizado (spec 15); service_months es columna escalar de rodeos (scoped por establishment activo). Dependencia anotada (AppSchema TEXT) para Stream B.
- [x] Resolucion de conflictos: last-write-wins explicito (UPDATE idempotente, RPS.3.6), re-aplicar = no-op.
- [x] No hace requests sincronos a Supabase desde pantalla: este chunk es backend puro (el selector de UI es Stream B); el contrato es RPC offline.

### C. BLE — N/A (el delta no toca BLE).

### D. UI de campo — N/A (el selector de meses es Stream B; este chunk es solo sustrato backend + RPC).

### E. Edge Functions (Supabase) — N/A (no hay Edge Functions; son RPC SQL SECURITY DEFINER). Para las RPC, los equivalentes estan cubiertos en Foco 3: validacion de identidad/permisos al inicio (is_owner_of/has_role_in), errores con errcode apropiado (42501/23514/22023/P0002), y test backend (suite puesta-en-servicio, roja-hasta-apply).

---

## Cambios requeridos

Ninguno. El delta es correcto en el merito: diff de compute_category quirurgico y verificado (solo v_has_service), fix del veto presente y testeado (vaquillona_prenada cuenta), anti-IDOR por derivacion + grants/revokes + smoke-checks fail-closed en todas las superficies nuevas, cota de p_year en las 3 funciones (RPS.5.10), suite gateada sin verde-falso, specs reconciliadas (design seccion 8.1, sin design mintiendo). Las 3 desviaciones del implementer son mejoras de robustez que no cambian ningun RPS.

Pendiente de gates posteriores (no es cambio de codigo): reviewer (este doc), luego Gate 2 (security_analyzer modo code sobre el as-built), luego Puerta 2 humana, luego apply gateado por el leader (orden 0102, 0103, 0104, 0105; consulta de regresion de datos 0104 por hembra menor a 365d con service/IA sin destete; descomentar el hook; encadenar el slice frontend del espejo RPS.7.4). Todo eso esta documentado en el ledger.
