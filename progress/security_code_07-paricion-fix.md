# Security (Gate 2 · modo code) — Delta %PARICIÓN fix (#8) sobre spec 07

**Veredicto: PASS**

baseline_commit: `ce51ab3` (rama `main`). Diff = working tree (no hay commits desde el baseline; todos los cambios sin commitear + untracked).
Skill: `sentry-skills:security-review` corrida sobre el diff → **sin findings HIGH-confidence**. Validación manual de la semántica de privilegios/tenant de Postgres (que la skill no cubre nativamente) → conforme.

---

## Findings HIGH (Sentry)
Ninguno.

## Findings RAFAQ-SPECIFIC
Ninguno. Los 5 focos de seguridad del gate se verificaron uno por uno contra el SQL as-built y el cuerpo vigente de 0106:

### 1. Fail-closed de privilegios tras el DROP — OK (el riesgo clásico, correctamente mitigado)
`drop function` resetea grants (default Postgres = `EXECUTE TO PUBLIC`). La migración lo re-cierra:
- `0117:164` — `revoke execute on function public.rodeo_calving_kpi (uuid, int) from public, anon;`
- `0117:165` — `grant execute on function public.rodeo_calving_kpi (uuid, int) to authenticated;`
- `0117:169-185` — smoke-check `do$$` que itera `anon`/`public` con `has_function_privilege(..., 'EXECUTE')` y hace `raise exception` si alguno quedó EXECUTE-able → **rollback de toda la migración** (está dentro del `begin;`@26 / `commit;`@189). Fail-closed a nivel migración.

Patrón idéntico al de 0106 (`revoke/grant` @0106:710-728, smoke-check @0106:730-750), que ya corre verde en la suite Reports. anon no hereda de authenticated en Supabase → tras el revoke, `has_function_privilege('anon'|'public', …)` = false. El leader confirmó post-apply `anon_can=false`. No es finding.

### 2. Anti-IDOR / tenant-scoping preservado — OK
Guard `0117:44-49` **idéntico** a `0106:291-296`: el tenant se deriva del RODEO (`select establishment_id from public.rodeos where id = p_rodeo_id and deleted_at is null`), nunca de un param del cliente; `v_est is null → P0002`; `not has_role_in(v_est) → 42501`. Los DOS caminos nuevos (`pending_pregnant` @101-127 y `status` @129-150) se computan **sobre el conjunto ya tenant-guarded** `rodeo_serviced_females(p_rodeo_id, p_year)` (join por `animal_profile_id` de ese conjunto) o sobre `v_months`/`v_est` ya resueltos — misma superficie que `pregnant`/`calved` vigentes. No hay query nueva que lea filas de otro tenant. SECURITY DEFINER bypassa RLS por diseño (documentado 0106:708), y el `has_role_in` interno ES la frontera de tenant → preservada verbatim.

### 3. Cotas `p_year` / `p_rodeo_id` — OK, sin SQL dinámico
- `0117:50-52` — `p_year < 1900 or > extract(year from current_date)::int + 1 → 22023`, idéntico a `0106:297-299`.
- `p_rodeo_id` validado por pertenencia (null → P0002 antes de tocar datos).
- `0117:142` — `make_date(p_year, m::int, 1) + interval '9 months'`: `p_year` ya acotado (int), `m` sale de `unnest(v_months)` (smallint[] con CHECK [1,12] en DB 0102). **Cero interpolación de texto**, cero `EXECUTE`/`format()` dinámico. Todas las queries son estáticas parametrizadas.

### 4. Frontend — dato de la RPC a render — OK, sin sink peligroso
El `status` (texto de la RPC) pasa por `asCalvingStatus` (`reports-format.ts`), un normalizador con **allowlist** (`CALVING_STATUSES.includes(raw)`); valor ausente/desconocido → `'ok'` (default defensivo CD-6, **no un crash**). `pending_pregnant` pasa por `toNum` (finito, default 0). `calvingCardView` es pura y produce strings fijos + números (`\`${kpi.calved} paridas / ${kpi.serviced} servidas\``). Se renderiza en `<KpiCard>`/`<InfoNote>` (Tamagui/RN Text) — no hay `dangerouslySetInnerHTML`/`innerHTML`/`eval`/HTML. RN Text no tiene vector XSS. No es finding.

### 5. No romper las otras 8 RPC de 0106 — OK
`grep rodeo_calving_kpi supabase/migrations` → solo `0106` y `0117`. El `drop function public.rodeo_calving_kpi (uuid, int)` es de firma exacta y **scopeado a esa sola función**; sin `CASCADE` (si hubiera un dependiente, el DROP fallaría → fail-closed, no borrado silencioso). Las otras 8 RPC + sus grants de 0106 quedan intactas. Regla `reference_function_recreate_base` cumplida: base = cuerpo vigente 0106 (ninguna migración intermedia lo redefinió).

---

## False positives descartados (trazabilidad)
- **`CalvingRow.status?: string` acepta string arbitrario de la RPC** — mitigado aguas abajo por el allowlist de `asCalvingStatus` (unknown → 'ok'). El `status` no es attacker-controlled de todos modos (lo emite la RPC trusted server-side, no el cliente). No aplica.
- **`DROP FUNCTION` resetea privilegios (HIGH clásico)** — correctamente mitigado por re-`grant` + smoke-check fail-closed (foco 1). No aplica.
- **`.rpc('rodeo_calving_kpi', {...})` en `run.cjs`** — archivo de test; y el cliente Supabase parametriza los args. No aplica (test-only, sin concatenación).

---

## Tabla de inputs (campos que el usuario tipea)
| campo | límite | validación | OK? |
|---|---|---|---|
| — | — | — | — |

Este delta **no agrega ningún campo de texto libre / form / buscador / prompt**. Los inputs de la RPC son `p_rodeo_id` (uuid elegido de los rodeos del propio usuario, no tipeado libre) y `p_year` (año, acotado 1900..current+1 server-side). Nada attacker-controlled llega a texto libre.

## Tabla de rate limits (acciones abusables tocadas)
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| `rodeo_calving_kpi` RPC | n.a. | n.a. (guard has_role_in) | sí (42501) | Read-only/STABLE, `authenticated`-only, tenant-guarded. No manda email/SMS, no pega a API externa, no es bulk. Devuelve **una sola fila** (`return next` único) sobre el conjunto acotado del tenant → sin vector de amplificación ni self-DoS por paginación. No requiere rate limit propio. |

---

## Archivos analizados
- `supabase/migrations/0117_calving_kpi_status.sql` (comparado línea a línea contra `0106_reports_rpcs.sql:285-343` cuerpo y `:706-750` grants/smoke-check)
- `app/src/services/reports.ts` (mapeo `fetchCalvingKpi` + `toNum`)
- `app/src/utils/reports-format.ts` (`asCalvingStatus` allowlist + `calvingCardView` puro)
- `app/app/(tabs)/reportes.tsx` (`ReproSection` → `KpiCard`/`InfoNote`)
- `app/app/reportes-spike.tsx` (sin sinks de riesgo)
- `supabase/tests/reports/run.cjs` (test-only, `.rpc()` parametrizado)
- `app/e2e/captures/paricion-fix.capture.ts` (capture; sin superficie de seguridad)

## Cobertura indirecta de Deno / RLS / PowerSync
- **PL/pgSQL SECURITY DEFINER + modelo de grants de Postgres**: **NO cubierto** por la skill de Sentry → validado manualmente (focos 1, 2, 3, 5). La RLS está bypasseada por SECURITY DEFINER **por diseño**; la frontera de tenant real es el guard interno `has_role_in(v_est)`, preservado idéntico a 0106.
- **PowerSync / Deno Edge Functions**: no aplican a este delta (RPC Postgres + frontend RN puro; sin Edge Functions ni sync rules nuevas).
- **RLS de tablas**: sin policies nuevas ni modificadas en el diff.

---

## Conclusión
Sin findings HIGH. El único riesgo estructural del delta —el reset de privilegios que produce `DROP FUNCTION`— está cerrado con re-`grant` + smoke-check fail-closed idéntico al patrón probado de 0106, y confirmado post-apply por el leader (`anon_can=false`). El tenant-scoping, las cotas y la ausencia de SQL dinámico se preservan verbatim del cuerpo vigente. El frontend consume solo números + un enum allowlisted, sin sink peligroso. **PASS.**
