# Security (code) — Delta %DESTETE (#10) `rodeo_weaning_kpi` — spec 07

**Modo**: `code` (Gate 2). **Veredicto**: **PASS**
**Baseline**: `6adb820a57934271dd683ae0fe81ac2125fb1dd3`..HEAD (+ uncommitted). Trabajado sobre `main`.
**Skill**: `sentry-skills:security-review` corrida sobre el diff; findings validados manualmente + checklist RAFAQ + Catálogo (A/B/C/E/F).

## Resumen
- **Findings HIGH**: 0.
- **Findings RAFAQ-SPECIFIC**: 0.
- La `0118` es un CREATE nuevo moldeado 1:1 sobre `0117` en TODO lo security-crítico (guard de tenant, cota, revoke/grant, smoke-check fail-closed). El JOIN nuevo (destete) cuelga de conjuntos ya tenant-guarded y de una tabla (`birth_calves`) server-populated no forjable. El frontend no expone `err.message` crudo ni tiene sinks. No hay regresión sobre las otras 10 RPC (CREATE puro, sin DROP).

## Foco 1 — Fail-closed de la RPC nueva (lo crítico): OK
`supabase/migrations/0118_weaning_kpi.sql`:
- L15/L138: todo el CREATE + grants + smoke-check dentro de `begin;`/`commit;` → un `raise` en el smoke-check hace ROLLBACK de la migración entera (fail-closed a nivel migración).
- L113: `revoke execute on function public.rodeo_weaning_kpi (uuid, int) from public, anon;` — RE-APLICA el revoke (Postgres da `EXECUTE TO PUBLIC` por default a toda función nueva). Correcto: la RPC es nueva, no heredó un revoke previo.
- L114: `grant execute ... to authenticated;`.
- L118-134: smoke-check `do$$` que itera `pg_proc × {anon,public}` con `has_function_privilege(..., 'EXECUTE')` y `raise exception` si alguno quedó EXECUTE-able → rollback.
- **Comparación con `0117`**: `0118:113-134` es idéntico a `0117:164-185` salvo el nombre de la función y el código de requisito (RWK.6.5 vs RPF.5.5). El SQL GARANTIZA el fail-closed que el leader confirmó post-apply (`anon_can=false`). Sin observaciones.

## Foco 2 — Anti-IDOR / tenant-scoping: OK
`0118:30-39` (guard) es idéntico a `0117:43-52` y a `0105:35-48`:
- `select establishment_id ... into v_est from public.rodeos where id = p_rodeo_id and deleted_at is null;` — tenant derivado del RODEO, NUNCA del cliente.
- `if v_est is null then raise ... P0002;` (rodeo inexistente/borrado).
- `if not public.has_role_in(v_est) then raise ... 42501;` (authz de tenant ANTES de cualquier lectura).

Cadena del JOIN nuevo (`weaned` L51-65 / `pending_weaning` L69-83) — verificada eslabón por eslabón:
1. `rodeo_serviced_females(p_rodeo_id, p_year) s` (`0105:95-170`) RE-GUARDA `has_role_in(v_est)` y filtra `p.rodeo_id = p_rodeo_id AND p.establishment_id = v_est` en ambas ramas (natural + IA). El conjunto `s` es tenant-scoped por construcción.
2. `join reproductive_events b on b.animal_profile_id = s.animal_profile_id and b.event_type='birth' and b.deleted_at is null` — el parto cuelga de una madre del conjunto tenant-guarded.
3. `join birth_calves bc on bc.birth_event_id = b.id` — `birth_calves` (`0045:12-39`) es **select-only server-populated**: SIN policy de INSERT para `authenticated`, poblada solo por trigger/`register_birth` SECURITY DEFINER que heredan `v_est` de la fila real de la madre (`0045:263-281`, herencia de tenant del server, no del payload). **El vínculo cría↔parto NO es forjable desde el cliente** → `bc.calf_profile_id` es siempre una cría del tenant.
4. `exists (select 1 from reproductive_events w where w.animal_profile_id = bc.calf_profile_id and w.event_type='weaning' and w.deleted_at is null)` — `w` se ata por `animal_profile_id = bc.calf_profile_id` (UUID único del tenant). Ningún `weaning` de otro tenant puede referenciar ese profile-id → no hay fuga cross-tenant de `weaned`/`pending_weaning`.

`serviced` (L45) viene de `rodeo_repro_denominator` (`0105:190-213`) → `rodeo_serviced_females`, ambos tenant-guarded. `is_configured` (L44) de `rodeo_service_campaign` (`0105:29-61`), idem. **Ningún dato de otro tenant se cuela.**

## Foco 3 — Cotas `p_year`/`p_rodeo_id`: OK
- `0118:37-39`: `if p_year < 1900 or p_year > extract(year from current_date)::int + 1 then raise ... 22023;` — cota preservada 1:1 de `0117:50-52`.
- P0002 para rodeo inexistente (L33). **Sin SQL dinámico, sin concatenación de strings, sin texto libre.** Toda expresión es constante/parametrizada (`interval '9 months'`, `extract`, `= any(v_months)`). No hay superficie de injection en la RPC.

## Foco 4 — Frontend (mapeo + no-leak): OK
- `app/src/services/reports.ts:161-176` `mapRpcError`: mapea `42501/P0002 → forbidden`, `22023 → validation`, y el resto a mensajes **hardcodeados en español**. Lee `rawMsg` SOLO para un `RegExp.test` de detección de red (L172) — **NUNCA lo renderiza**. No hay information disclosure de `err.message` crudo (Catálogo B1). ✓
- `app/src/services/reports.ts:309-322` `fetchWeaningKpi`: coerción tolerante `toNum` (L237-245) sobre `serviced/weaned/pending_weaning`; `asWeaningStatus(r.status)` normaliza a whitelist. Path `callRpcSingle → assertOnline` (online-only, mismo que las otras 9 RPC).
- `app/src/utils/reports-format.ts:153-157` `asWeaningStatus`: whitelist estricta contra `WEANING_STATUSES`, default `'ok'` defensivo. `weaningCardView` (L184-214) devuelve solo strings formateados + copy fijo; el `detail` interpola `${kpi.weaned}/${kpi.serviced}` que son números coercidos, no texto libre.
- `app/app/(tabs)/reportes.tsx:374,403-413`: `<KpiCard label="Destete" value={wv.value} detail={wv.detail ?? wv.note} muted={wv.muted}/>` — render por Tamagui `<Text>` en RN (sin sink HTML). `<ReportError message={pregnancy.error?.message}/>` (L345) usa el `ReportError.message` **curado** por `mapRpcError`, no el mensaje crudo de PostgREST. Error de weaning con pregnancy OK → `weaning.data===null` → `weaningCardView(null)` → "sin datos" (degrada limpio, sin leak).
- `app/src/hooks/use-reports.ts:149-150`: `weaningFetcher` pasa `rodeoId`/`year` del selector de rodeo (contexto), sin hardcodear `establishment_id`. La RPC re-guarda.
- `app/app/reportes-spike.tsx`: pantalla de spike con datos MOCK hardcodeados (`DesteteVariant status/weaned/serviced` L124-137); sin fetch real, sin sink. No expone datos de tenant.

## Foco 5 — No romper las otras 10 RPC: OK
`0118` es CREATE directo (L17), **sin DROP** (a diferencia de `0117` que hizo DROP+CREATE de su propia función). El smoke-check consulta SOLO `proname = 'rodeo_weaning_kpi'` (L127). Ninguna otra RPC es referenciada de forma destructiva. `notify pgrst` recarga el schema. Sin regresión.

## False positives descartados (skill)
- Ninguna alerta HIGH sobreviviente de la skill. Los patrones que la skill podría marcar por keyword (`.rpc(...)`, template strings en `weaningCardView`, `error.message` en reportes.tsx) fueron trazados: (a) `.rpc` con args parametrizados server-guarded; (b) template strings sobre números coercidos, no texto libre, render RN sin HTML; (c) `error.message` es el mensaje curado de `mapRpcError`, no el crudo de PostgREST. Descartados como no explotables.

## Tabla de inputs (campos que el usuario tipea que llegan a este diff)
| campo | límite | validación | OK? |
|---|---|---|---|
| `p_rodeo_id` (uuid, del selector de rodeo) | tipo `uuid` en la firma (`0118:17`) | server: `rodeos where id=? deleted_at is null` + `has_role_in` (42501/P0002) | ✓ |
| `p_year` (int, del selector de año) | tipo `int` + cota `1900..current+1` | server: `raise 22023` fuera de rango (`0118:37-39`) | ✓ |
| `variant` (query param del spike) | union de literales en TS; runtime string | n.a. — solo selecciona un mock estático, sin sink ni fetch | ✓ |

No hay formularios/buscadores/texto-libre/prompts nuevos en este delta (es una card de solo-lectura sobre 2 selectores ya acotados).

## Tabla de rate limits (acciones abusables tocadas por el diff)
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `rodeo_weaning_kpi` (RPC read-only, online-only) | no (pre-existente) | tenant-scoped por `has_role_in` (per-establishment) | sí (guard 42501 antes de leer) | Supabase no rate-limitea RPCs de PostgREST por default. Mismo perfil que las otras 9 RPC de reportes YA deployadas; **este delta NO introduce ni empeora la superficie**. Query agrega a UN row (counts), acotada al rodeo del tenant → sin amplificación cross-tenant ni denial-of-wallet (no manda email/SMS ni pega a API externa). Consideración pre-existente para TODO el módulo de reportes, no regresión. No es FAIL. |

## Archivos analizados
- `supabase/migrations/0118_weaning_kpi.sql` (vs `0117`/`0105`/`0045`)
- `app/src/utils/reports-format.ts`, `app/src/services/reports.ts`, `app/src/hooks/use-reports.ts`
- `app/app/(tabs)/reportes.tsx`, `app/app/reportes-spike.tsx`
- `supabase/tests/reports/run.cjs` (TR.11/TR.10 — test file, no se flaggea; cubre IDOR/grants/cota)
- `app/e2e/captures/destete-kpi.capture.ts` (capture MOCK, sin superficie)

## Cobertura indirecta (la skill NO cubre nativamente)
- **PL/pgSQL SECURITY DEFINER + RLS bypass**: revisado a mano. La RPC bypassa RLS por ser SECURITY DEFINER; el tenant-scoping descansa en el guard interno `has_role_in(v_est)` + en que los conjuntos base (`rodeo_serviced_females`, `birth_calves`) ya son tenant-scoped/no-forjables. Verificado.
- **`birth_calves` como trust boundary**: revisado a mano (`0045` — sin INSERT grant, server-populated). El vínculo del JOIN no es forjable desde el cliente.
- **RN/Tamagui render (no HTML sink)**: revisado a mano — sin `dangerouslySetInnerHTML`/`v-html`; todo `<Text>`.
- **PowerSync**: no aplica — los reportes son online-only (`assertOnline`), no pasan por sync rules ni SQLite local. Sin superficie offline en este delta.
