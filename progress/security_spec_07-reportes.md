# Gate 1 — Security spec audit: Feature 07 (Reportes / Analytics, Stream C)

**Modo:** `spec` (ADR-019). **Fecha:** 2026-06-24. **Auditor:** security_analyzer.
**Input:** `specs/active/07-reportes-basicos/{requirements,design,tasks}.md` (`spec_ready`).
**Cubre:** R7.12 (multi-tenancy/aislamiento), T0.1.

## Veredicto: PASS

Con **4 MEDIUM** + **2 LOW** que son lagunas de redacción del design (no decisiones
arquitectónicas faltantes). El patrón seguro YA está elegido — las 8 RPCs replican `0105`
(Stream A), que pasó Gate 1. Las MEDIUM se deben incorporar al design §5 y a T4.3/T8.1 antes
de la aprobación humana (reconciliación spec↔seguridad). Ninguna requiere decisión de Raf/Facundo.

---

## Por qué PASS (verificación del patrón base)

La spec **no inventa auth nuevo**. Verifiqué el patrón `0105` de punta a punta y es seguro:

- `has_role_in` (`supabase/migrations/0005_rls_helpers.sql:9`) → `auth.uid()` + `user_roles.active`
  + establishment no soft-deleted. Fail-closed por construcción.
- design §5 (líneas 306-327) lista el checklist correcto **explícitamente**: guard al entrar antes
  de devolver nada, `SECURITY DEFINER STABLE set search_path=public`, cota `p_year`,
  `revoke from public,anon` + `grant authenticated`, smoke-check fail-closed, defensa en profundidad
  de tenant en joins, delegar el denominador a las RPCs de Stream A.
- R7.12 (requirements 265-278) codifica el aislamiento como requisito de 1ª clase, incl. IDOR
  (R7.12.3: rechazar, no vacío silencioso).
- ADR-025 (PII `_private`) existe; design §5.7 confirma que ninguna alerta cruza `_private`.
- `reproductive_events` (`0026`) tiene `event_type ∈ {tacto,birth,abortion,...}` + `pregnancy_status`
  enum `(empty,small,medium,large)` → los KPIs preñez/parición/CCL son construibles sobre el as-built.
- architecture.md confirma el boundary Edge-vs-RPC (Edge = lo que NO se expresa limpio en RLS) →
  la decisión §3 (RPC, no Edge) es correcta y reduce superficie de auth.
- El harness `supabase/tests/puesta-en-servicio/run.cjs` (no-bypass, JWTs reales para RLS/authz,
  service_role solo para fixtures) es el modelo que el design compromete para `reports/run.cjs`.

Los hallazgos son **lagunas de especificación**: el design da por obvio algo que, implementado
naïve, abre hueco. Ninguna es HIGH porque el checklist del propio design apunta al patrón correcto.

---

## Findings MEDIUM

### M1 — RPCs de alerta toman `p_establishment_id` del cliente (superficie IDOR más directa)

**Evidencia:** design §1:37 y §2.7:199-223 → `establishment_overdue_doses(p_establishment_id uuid)`
y `establishment_unweighed(p_establishment_id, ...)`. A diferencia de las RPCs `p_rodeo_id`/
`p_session_id` (derivan tenant de la fila → no engañables), estas **reciben el `establishment_id`
del cliente**. design §5.1:310 dice lo correcto ("`has_role_in(p_establishment_id)` directo") pero
el caso es crítico (patrón "no confiar en `establishment_id` del cliente").

**Fix:** cada RPC de alerta abre con `if not public.has_role_in(p_establishment_id) then raise
exception ... using errcode='42501'; end if;` como **1ª sentencia ejecutable**. T4.3 (tasks:83)
promete "tenant-scope/grants" pero NO nombra el IDOR de `p_establishment_id` como sí lo hacen
T1.3/T2.5 → agregar assert "JWT tenant B pide `establishment_overdue_doses(est_A)` → 42501".

### M2 — Varias tablas de evento NO tienen `establishment_id`; el §5.5 es inaplicable tal cual

**Evidencia:** design §5.5:316-318 dice "filtrar `establishment_id = v_est` en las tablas". Pero:
- `weight_events`(`0025`), `sanitary_events`(`0027`), `lab_samples`(`0029`),
  `reproductive_events`(`0026`), `condition_score_events`(`0028`) **NO tienen `establishment_id`** —
  scopean vía `establishment_of_profile(animal_profile_id)` (`0023:9` → `animal_profiles.establishment_id`).
- Solo `custom_measurements`(`0094:22`) y `scrotal_measurements`(`0098`) denormalizan (ADR-026).

Las RPCs son `SECURITY DEFINER` → la RLS de esas tablas NO las protege; el filtro de tenant en los
joins lo pone la RPC a mano. `weight_events.establishment_id = v_est` no compila; saltearse la
defensa en profundidad deja solo el guard de entrada (pierde la red que `0105` sí tiene).

**Fix:** corregir design §5.5 → "filtrar `animal_profiles.establishment_id = v_est` (las tablas de
evento 0025-0029 NO tienen `establishment_id`; scopear vía el join a `animal_profiles`, como
`rodeo_serviced_females` en `0105:122`); para `custom_measurements`/`scrotal_measurements` usar su
`establishment_id` denorm". Afecta a `session_event_summary` (cuenta sobre 7 tablas),
`rodeo_weight_by_category`, `establishment_overdue_doses`, `establishment_unweighed`.

### M3 — El path de scoping no filtra `deleted_at IS NULL` del perfil (viola R7.13)

**Evidencia:** `establishment_of_profile` (`0023:9`) hace `select establishment_id from
animal_profiles where id=profile_id` **sin** `deleted_at IS NULL`. R7.13.1/.3 (req 283-292) exigen
excluir `status≠'active'` y `deleted_at IS NOT NULL`. No es fuga cross-tenant (el guard de entrada
corre igual), pero viola R7.13 y puede inflar agregados / arrastrar un perfil archivado.

**Fix:** cada RPC que toque `animal_profiles` filtra `p.deleted_at IS NULL` (siempre) y
`p.status='active'` (KPIs de rodeo/alertas, salvo histórico de sesión R7.13.2). T8.1 (tasks:137):
anclar a "en el join a `animal_profiles`, no en el helper".

### M4 — `establishment_overdue_doses` sin cota de escaneo (DoS / INPUT-1)

**Evidencia:** design §2.7:207-208 → predicado `next_dose_date < current_date` + NOT EXISTS dosis
posterior. **Sin ventana ni piso de fecha ni LIMIT.** En un tenant con años de `sanitary_events` el
set puede ser grande y el NOT EXISTS correlacionado por `(product_name, animal)` es caro sobre todo
el historial. Es la única RPC sin ninguna cota de input (las de rodeo tienen `p_year` acotado
`0105:46`; `establishment_unweighed` tiene `p_threshold_days`). INPUT-1 obliga a cota en todo escaneo.

**Fix:** agregar parámetro de ventana acotado (`p_lookback_days int default 365` o `p_since date`)
y/o `LIMIT` server-side (alertas = listas accionables, no exports; tope ej. 500 evita self-DoS).
Documentar en R7.10 + test T4.3. Para `establishment_unweighed`: validar `p_threshold_days >= 0` +
tope superior, y acotar cardinalidad de `p_category_codes`.

---

## Tabla de inputs (parámetros RPC — INPUT-1)

| Parámetro | RPC(s) | Límite | Validación server-side | OK? |
|---|---|---|---|---|
| `p_session_id uuid` | session_event_summary | uuid; tenant derivado de `sessions` + `deleted_at IS NULL` | Guard `has_role_in` fail-closed | OK |
| `p_rodeo_id uuid` | pregnancy/calving/ccl/by_stage/weight/sessions_list | uuid; tenant derivado de `rodeos` + `deleted_at IS NULL` | Guard fail-closed | OK |
| `p_year int` | pregnancy/calving/ccl/by_stage | cota 1900..current+1 (§5.3, espejo `0105:46`) | Sí, tras guard | OK |
| `p_establishment_id uuid` | overdue_doses, unweighed | uuid; **del cliente** | `has_role_in(p_establishment_id)` — exigir 1ª sentencia + test IDOR | M1 |
| `p_threshold_days int` | unweighed | default 180; sin cota (≥0, tope sup.) | Tipado; falta rango | M4 (menor) |
| `p_category_codes text[]` | unweighed | filtra por code; sin tope cardinalidad | Param tipado, no SQL string → no inyectable | OK (LOW: acotar) |
| ventana `next_dose_date` (implícito) | overdue_doses | **sin piso ni LIMIT** | — | M4 |

Sin input de texto libre concatenado en SQL: todo param tipado PostgREST (uuid/int/text[]). **Sin
vector de inyección** (§5.8). No hay buscadores/`ilike '%term%'`/`.or()/.filter()` con input de usuario.

## Tabla de rate limits

| Acción | Rate limit | Keyeo | Fail-closed | Nota |
|---|---|---|---|---|
| RPCs de reporte (PostgREST, online-only) | No (Supabase no rate-limitea RPC) | n.a. | Guard tenant | No email/SMS/API externa/escritura → no denial-of-wallet. Riesgo = self-DoS por escaneo sin cota → mitigado por cotas de input (M4 + `p_year`/`p_threshold_days`). |
| establishment_overdue_doses | No | n.a. | Guard | M4: necesita cota de escaneo (ventana/LIMIT), no rate limit. |

Rate limiting **no aplica como control nuevo** (sin auth/email/SMS/API/bulk-write). La defensa
correcta es la cota de input/escaneo (INPUT-1), cubierta por M4.

---

## Anexo LOW

- **L1** — Acotar cardinalidad de `p_category_codes` (no inyectable, pero array gigante = escaneo
  grande). Tope ≤ nº de categorías del sistema. Best-practice.
- **L2** — `rodeo_calving_kpi` deriva el año de parto como `p_year+1` (§2.3:132). No es seguridad
  (la cota de `p_year` cubre el input), pero verificar que el `+1` no construya fecha fuera de rango.

---

## Dominios revisados (trazabilidad)

- **A1** SECURITY DEFINER bypass RLS — las 8 RPCs son SECDEF; guard interno es la defensa (§5, espejo
  `0105`). M1/M2/M3 afinan el scoping manual.
- **A3** IDOR / `p_establishment_id` del cliente — M1; R7.12.3 cubre el rechazo.
- **A4** function-level authz (BFLA) — "cualquier rol LEE reportes" (R7.1.2); read-only, sin acción
  owner-only. OK.
- **B1** info disclosure — RPCs raise con códigos (42501/22023/P0002), no filtran detalle cross-tenant.
  Gate 2 verifica que `reports.ts` no devuelva `error.message` crudo.
- **B2/B3** PII / over-fetching — alertas devuelven idv/visual_id_alt/product_name/fechas; nada
  `_private` (§5.7, ADR-025); `returns table` explícito. OK.
- **C** offline/sync — n.a. por diseño (online-only, sin buckets PowerSync; §4:294). Correcto.
- **E1** queries sin tope — M4.
- **F1** PostgREST filter injection — params tipados, sin SQL string, sin texto libre. Sin vector.
- **INPUT-1** — tabla arriba; todo acotado salvo M1/M4.

## Dominios excluidos (justificación)

- **A2, C1-C4, D1-D4, F2-F4, G (BLE), H (sesión), I (compliance/mobile)** — la spec NO escribe (todo
  `STABLE`/read-only), no toca auth/sesión, no ingiere archivos, no hace `fetch()` externo, no toca
  BLE/email/mobile. Stream C solo agrega funciones de lectura sobre schema ya gateado (§5:328-329).
- **Benchmarking cross-tenant** — FUERA del MVP (req:13, §7). No hay agregación cross-tenant a auditar.

---

## Nota para el leader (no bloquea Gate 1)

PASS: la spec puede ir a la Puerta de spec humana. Las 4 MEDIUM son lagunas de redacción del design,
no decisiones faltantes — el patrón seguro ya está elegido (`0105`), falta spellearlo para tablas
sin `establishment_id` (M2/M3), para el `p_establishment_id` del cliente (M1), y agregar cota de
escaneo a overdue_doses (M4). Sugerencia: que el spec_author incorpore M1-M4 al design §5 + T4.3/T8.1
ANTES de la aprobación humana, así Gate 2 valida contra el contrato afinado. Ninguna requiere decisión
de Raf/Facundo (correcciones técnicas dentro del patrón aprobado).
