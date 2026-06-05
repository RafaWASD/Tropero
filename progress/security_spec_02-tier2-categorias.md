# Security Spec Review — Spec 02 Tier 2/3 backend "modelo de categorías de cría"

**Modo**: `spec` (Gate 1, ADR-019) · schema-sensitive
**Fecha**: 2026-06-04 (sesión 22)
**Auditor**: security_analyzer
**Input**: `specs/active/02-modelo-animal/{requirements,design,tasks}-tier2-categorias.md`
**Skill**: `sentry-skills:security-review` (metodología: trace data flow + verify exploitability antes de reportar). Refs cargadas: `authorization.md` (IDOR, mass assignment, BFLA).

---

## Veredicto: **PASS**

0 findings HIGH. La spec **no** debilita ningún control de seguridad del as-built, **no** reintroduce el grant de `apply_auto_transition` (SEC-HIGH-01), y deriva el tenant de la fila real en cada función `SECURITY DEFINER`. El modelo de amenaza central (7 puntos del mandato) se sostiene contra las migraciones verificadas. Se anotan 1 MEDIUM ("needs verification" — handoff de implementación, no bloqueante de spec) y 2 LOW (anexo).

La recomendación operativa: este PASS aprueba el **diseño**; las verificaciones MEDIUM/LOW se deben confirmar en el código del implementer y están ya cubiertas por los tests T8.l (no-spoof) y T8.i/T8.j (nursing/consistencia). El leader puede avanzar a Puerta 1.

---

## Modelo de amenaza central — verificación punto por punto

| # | Amenaza | Veredicto | Evidencia (spec ↔ as-built) |
|---|---|---|---|
| 1 | `apply_auto_transition` sigue revocada | ✅ OK | RT2.12.2 (req:189) + design §4 fila 1 (design:391) + T7 (tasks:42) **prohíben** re-grant. As-built `0042:22` revoca de public/authenticated/anon. Todos los caminos nuevos la invocan **solo** desde triggers `SECURITY DEFINER` (design §3.2 `tg_..._apply_transition` design:270; §3.3 `tg_animals_apply_castration` design:327), que corren como owner y conservan EXECUTE pese al revoke (igual que `0046:24`). El delta NO incluye ningún `grant execute … apply_auto_transition`. |
| 2 | `compute_category` reescrita no abre cross-tenant | ✅ OK | RT2.12.3 (req:191). Design §3.1 conserva `SECURITY DEFINER STABLE` + `set search_path = public`, deriva TODO del `profile_id` (joins `animal_profiles→animals→rodeos`, design:161-166), **no** recibe ni usa `establishment_id` del cliente, sigue siendo lectura pura (no escribe). Idéntico patrón al as-built `0031:7-23`/`0045:45-61`. Solo suma `a.is_castrated` (mismo join `p→a` ya existente, DD-2) y un `exists` sobre `reproductive_events` del **mismo** `profile_id` (design:171-213). No agrega ninguna lectura de otro perfil/tenant. EXECUTE a authenticated igual que as-built (design:236). |
| 3 | `compute_nursing` nueva no abre cross-tenant | ✅ OK | RT2.12.1 (req:187) + design §4 fila 5 (design:395). `SECURITY DEFINER STABLE`, deriva del `profile_id` (design:353-373); el `exists` resuelve los terneros de la **propia** madre vía `birth_calves.birth_event_id` → `reproductive_events.animal_profile_id = profile_id` (mismo tenant por construcción). El UPDATE de `nursing` lo hace el **trigger** sobre el perfil de la madre resuelto vía `birth_calves` (design:376-381), no la función. EXECUTE a authenticated (lectura pura, design:374), paralela a `compute_category`. |
| 4 | Trigger de castración no escribe categoría de otro tenant | ✅ OK | RT2.12.4/2.12.5 (req:193-195) + design §4 fila 4 (design:394). `tg_animals_apply_castration` (`AFTER UPDATE OF is_castrated` sobre `animals`) resuelve el perfil activo del **propio** animal (`where animal_id = new.id and status='active'`, design:315-318), **no** recibe `profile_id` del cliente. La RLS de `animals` UPDATE (`0022:34-40`, `has_role_in(ap.establishment_id)`) ya filtró el UPDATE de `is_castrated` **antes** de que el trigger AFTER corra → un usuario no puede togglear `is_castrated` de un animal de otro tenant, por lo tanto el trigger nunca corre sobre un animal ajeno. Delega a `compute_category` + `apply_auto_transition` (design:325-327). |
| 5 | `is_castrated` (columna nueva) no abre cross-tenant | ✅ OK | RT2.12.1/2.12.5 (req:187,195) + DD-2 (design:43-54). Va en `animals` (`ALTER TABLE … ADD COLUMN is_castrated boolean NOT NULL DEFAULT false`, design:93). Hereda la RLS de `animals` (`0022:21-40`, SELECT/UPDATE derivados de presencia de perfil con `has_role_in`) **sin policy nueva** y sin grant nuevo (`grant update on animals` ya existe en `0019:46`/`0038:19`). La inmutabilidad de identificadores (`0036`) **no** aplica: ese trigger escucha `BEFORE UPDATE OF tag_electronic`/`OF idv` (`0036:24,41`), **no** `is_castrated` → la columna es corregible (RT2.2.6, design:52). Verificado contra as-built. |
| 6 | Ninguna función `SECURITY DEFINER` nueva queda como RPC pública invocable | ✅ OK | RT2.12.4 (req:193) + T7/T8.l (tasks:42,82). Las funciones-trigger nuevas (`tg_reproductive_events_apply_transition` reescrita, `tg_animals_apply_castration`, `tg_reproductive_events_recompute_nursing`) son **triggers**, no RPCs — se invocan por el event system, no por PostgREST. El único `EXECUTE to authenticated` nuevo es `compute_nursing` (lectura pura, paralela a `compute_category` ya expuesta as-built). El delta replica el patrón fail-closed de `0055` en `0065` (design:98, tasks:42): re-emisión idempotente de revokes + smoke check. **No** se crea ninguna superficie `SECURITY DEFINER` invocable que fuerce transiciones (la lección SEC-HIGH-01 se respeta). Ver MEDIUM-01 para la verificación de los `tg_*` en código. |
| 7 | Consistencia/integridad — desempate aborto/tacto por `(event_date, created_at)` | ✅ OK (bajo riesgo) | RT2.7.5 (req:129) + design §3.1 (design:198-213). El `NOT EXISTS` de un aborto posterior `(ab.event_date, ab.created_at) > (t.event_date, t.created_at)` es un desempate determinístico de tuplas; `created_at` rompe empates de `event_date`. No vi un orden de eventos que deje un estado explotable cross-tenant (todo opera sobre el mismo `profile_id`, scoped por RLS de `reproductive_events` `0026:63-70`). Es lógica de negocio, no superficie de seguridad. Ver LOW-02 por una observación menor de cobertura de eventos. |

---

## Verificación de inputs de usuario

No hay **ningún** input de texto libre, buscador ni prompt nuevo en este delta. Trazabilidad por superficie:

| Superficie de entrada | Origen | Control | Estado |
|---|---|---|---|
| `is_castrated` (boolean en `animals`) | UPDATE del cliente vía PostgREST | Tipo `boolean NOT NULL` (la DB rechaza no-boolean) + RLS de `animals` (`0022`) acota a animales del tenant | OK — booleano, sin rango/charset que validar; autoritativo server-side |
| `nursing` (boolean en `animal_profiles`) | **No** escribible por el cliente directamente | Lo setea solo el trigger `SECURITY DEFINER`; el cliente no tiene path de escritura semántica (aunque tenga `grant update`, el trigger lo recomputa) | OK |
| Disparadores de transición (`service`/`weaning`/`birth`/`abortion`/`tacto`) | INSERT en `reproductive_events` | RLS de INSERT `has_role_in(establishment_of_profile(...))` (`0026:65-66`) + enum `repro_event_type` (`0026:5-7`) acota `event_type` | OK — ya validado por la spec base; el delta solo les **da efecto de categoría**, no agrega input |
| `profile_id` recibido por `compute_category`/`compute_nursing` | Param de función | No es un IDOR: la función deriva el tenant del perfil; el caller `authenticated` no ve el resultado si no tiene rol (T8.l verifica no-fuga) | OK |

**Conclusión inputs**: el delta no introduce campos de texto libre. El requisito de Raf ("límite + validación por cada campo de entrada") está satisfecho: los dos campos nuevos son booleanos con tipo autoritativo en DB; no hay buscadores ni concatenación de input en `.or()/.filter()`/`ilike`/prompt LLM.

---

## Rate limiting

| Acción abusable | Rate limit | Keyeo | Fail-closed | Nota |
|---|---|---|---|---|
| (ninguna nueva) | n.a. | n.a. | n.a. | El delta es backend puro de transiciones de categoría (triggers + funciones SQL). No agrega Edge Functions, no manda email/SMS, no pega a APIs externas, no es bulk/import. Las superficies de INSERT (`reproductive_events`) y UPDATE (`animals`/`animal_profiles`) son las mismas tablas ya existentes, gobernadas por la RLS as-built. El costo por transición es O(log n) (un par de `count`/`exists` indexados por `reproductive_events_by_profile_date` `0026:54-56`, ver design §5 A1:405). No hay vector de amplificación nuevo (un evento = un recompute del propio perfil). |

**Nota de coordinación (no de este delta)**: spec 10 (castración masiva / operaciones por rodeo) sería quien escriba `is_castrated` en bulk (tensión C1, req:239). El control de fan-out + rate de ese flujo bulk es responsabilidad del Gate de **spec 10**, no de este chunk. Anotado para que no se pierda.

---

## Findings MEDIUM (Needs verification — handoff a Gate 2 / código)

### [SEC-SPEC-M01] Los triggers `SECURITY DEFINER` nuevos deben revocarse explícitamente de public/authenticated/anon (defensa en profundidad)

- **Severidad**: MEDIUM · **Confidence**: needs verification (no es un hueco de diseño; es un control que el diseño **promete** pero que se materializa en código).
- **Dónde**: design §4 fila 1 (design:391) + T7 `0065_check_grants.sql` (tasks:42).
- **Qué**: el diseño dice que `0065` re-emite revokes y "verifica que ninguna función nueva quedó con EXECUTE a public por default". Las funciones-trigger nuevas son `tg_reproductive_events_apply_transition` (reescrita), `tg_animals_apply_castration` y `tg_reproductive_events_recompute_nursing`. El as-built `0055:13-21` revoca **explícitamente cada `tg_*`** y corre un smoke check fail-closed (`0055:25-52`) que **falla la migración** si alguna quedó EXECUTE-able. El diseño de `0065` menciona el patrón pero **no lista nominalmente** las 3 funciones-trigger nuevas en su array de revokes/smoke-check.
- **Por qué importa (pero no es FAIL de spec)**: en Postgres, las funciones-trigger (que devuelven `trigger`) **no** son invocables vía PostgREST aunque tuvieran EXECUTE a authenticated — PostgREST no expone funciones que retornan `trigger`. Por eso esto es defensa en profundidad, no un hueco explotable (a diferencia de SEC-HIGH-01, donde `apply_auto_transition` retornaba `void` y **sí** quedó como RPC). El riesgo real es bajísimo; el valor es consistencia con el patrón `0055`/`0042`.
- **Fix recomendado (incorporar a tasks/design antes de implementar)**: en `0065` (o al pie de cada migración que crea la función), agregar nominalmente `revoke execute on function public.tg_reproductive_events_apply_transition() / tg_animals_apply_castration() / tg_reproductive_events_recompute_nursing() from public, authenticated, anon;` y sumar esas 3 al array del smoke-check fail-closed (clon de `0055:28-38`). `compute_category` y `compute_nursing` **conservan** EXECUTE a authenticated (son lectura pura) — el smoke-check NO debe incluirlas. T8.l ya verifica el caso explotable real (`apply_auto_transition` revocada); este fix cierra el flanco de paridad con `0055`.

---

## Anexo LOW (no bloqueante, no destaca)

### [SEC-SPEC-L01] `nursing` tiene `grant update … to authenticated` heredado de `animal_profiles` — el cliente podría setearlo a mano

- **Severidad**: LOW (no explotable cross-tenant; integridad de dato dentro del propio tenant).
- **Dónde**: `0061` agrega `nursing` a `animal_profiles`, que ya tiene `grant update … to authenticated` (`0020:77`). No hay column-level GRANT en Postgres aplicado acá, así que un `authenticated` con rol en el establishment **podría** hacer `update animal_profiles set nursing = true/false` directo, fuera del trigger. Esto **no** es cross-tenant (la RLS de `animal_profiles` `0022:13-15` lo acota a su tenant) ni toca `category_id` (ortogonalidad RT2.9.2 preservada). El único efecto es un `nursing` "mentido" que el próximo evento de parto/destete recomputa (DD-3, trigger). Es paridad con el resto de columnas materializadas de `animal_profiles` (`category_id` mismo: el cliente puede escribirlo, pero el override-trigger `0021:66-79` lo marca como override). Mismo modelo de confianza intra-tenant que ya rige la tabla. **Sin acción requerida**; si se quisiera blindar, un column-level `revoke update (nursing)` + `grant` selectivo sería over-engineering para MVP.

### [SEC-SPEC-L02] `tacto_vaquillona` (enum `0053`) no está en la lista de event_types que disparan recompute incremental

- **Severidad**: LOW (consistencia funcional, no seguridad).
- **Dónde**: design §3.2 (design:260) lista `('tacto','service','weaning','birth','abortion')` como los `event_type` que delegan a `compute_category`. El enum tiene también `tacto_vaquillona` (`0053:8`, spec 03), `drying`, `rejection`. `tacto_vaquillona` es el tacto de aptitud de vaquillona (apta/no_apta), distinto del `tacto` de preñez. **No** debe disparar transición de categoría (no es un tacto+ de preñez), así que su exclusión es **correcta** por diseño. Lo anoto solo para trazabilidad: el implementer debe confirmar que `tacto_vaquillona` queda **deliberadamente fuera** (no es un olvido) y que `compute_category` cuenta `event_type = 'tacto'` (no `like 'tacto%'`) para no confundir los dos — el SQL del design ya usa `= 'tacto'` (design:203), correcto. Sin acción; verificación de no-regresión en T8.

---

## Dominios de seguridad revisados (catálogo RAFAQ)

- **A1 (service-role bypass)**: n.a. — el delta no usa `createAdminClient()`; las funciones `SECURITY DEFINER` derivan tenant de la fila real, no del cliente. Revisado.
- **A2 (mass assignment)**: revisado — el delta no agrega `.insert(body)`/`.update(body)` con spread; los campos nuevos son booleanos individuales gobernados por RLS. Sin hueco.
- **A3 (IDOR por FK)**: revisado — `compute_nursing` resuelve terneros vía `birth_calves` del propio perfil; el trigger de castración resuelve el perfil del propio animal. Sin FK cross-tenant.
- **A4 (BFLA/function-level authz)**: revisado — `apply_auto_transition` revocada; transiciones solo vía triggers; `compute_*` son lectura. Punto fuerte del diseño.
- **H1 (invalidación de sesión)**: n.a. — el delta no toca auth/sesión.
- **C (offline/sync)**: revisado — design §4 cierre (design:398): `is_castrated`/`nursing` viajan con sus tablas ya sincronizadas (PowerSync), sin sync rule nueva. Sin superficie offline nueva.
- **Inputs / rate limiting**: revisado — ver tablas arriba. Sin texto libre, sin acción abusable nueva.

## Dominios excluidos (con justificación)

- **B (information disclosure)**: n.a. — backend SQL puro, sin respuestas de Edge Function que filtren `err.message`.
- **D (secrets/supply chain)**: n.a. — sin secrets, sin imports Deno, sin CI nuevo.
- **E (abuso a escala)**: cubierto en tabla de rate limits — sin endpoint nuevo con costo; queries O(log n) indexadas.
- **F (inyección/SSRF)**: n.a. — sin `.or()/.filter()` con input de usuario, sin `fetch()` a URL del cliente, sin import de archivos.
- **G (BLE)**: n.a. — este delta no toca BLE (es spec 04).
- **I (compliance/mobile)**: parcial — el cambio de categoría queda auditado en `animal_category_history` como `auto_transition` (RT2.10.4, req:171; trigger `0030:33-43`), append-only, lo cual satisface I2 (tamper-evidence) para este delta.

---

## Cobertura indirecta / no cubierto por la skill (declaración explícita)

La skill `sentry-skills:security-review` está orientada a código (Python/JS/Go/etc.) y **no** cubre nativamente: PL/pgSQL `SECURITY DEFINER`, RLS de Postgres, semántica de triggers `AFTER UPDATE OF`, ni PowerSync. Esos dominios — que son el **núcleo** de este delta — se auditaron **manualmente** contra el as-built verificado (10 migraciones leídas: `0005, 0019, 0020, 0021, 0022, 0023, 0026, 0030, 0031, 0036, 0040, 0042, 0045, 0046, 0053, 0054, 0055`). El veredicto PASS descansa en esa revisión manual + el cruce con `authorization.md` (IDOR/mass assignment/BFLA), no en pattern-matching de la skill.

**Recordatorio para Gate 2 (código)**: cuando el implementer escriba los `.sql`, re-correr este análisis en modo `code` para confirmar que (a) las 3 funciones-trigger se revocaron nominalmente (M01), (b) `compute_category` usa `= 'tacto'` y no captura `tacto_vaquillona` (L02), y (c) el trigger de nursing no introduce una escritura sobre un perfil resuelto desde un FK ajeno. Los tests T8.l (no-spoof) y T8.i/T8.j ya están declarados para cubrirlo.

---

## Re-corrida 2026-06-04 — agregado del cron (DD-1 camino 2: `refresh_age_categories()` + `pg_cron`)

**Modo**: `spec` (Gate 1, ADR-019) · **focalizado** solo en el agregado del cron (el resto del delta NO se re-audita — ya PASS arriba).
**Auditor**: security_analyzer.
**Trigger**: refinamiento 2026-06-04 cambió DD-1 de "on-event + queda viejo" a "on-event (primario) + `pg_cron` nocturno targeted (red de seguridad)". Punto caliente declarado: **SEC-SPEC-M02** (`refresh_age_categories()` es `SECURITY DEFINER`, `returns void`, cross-tenant by-design → sin revoke se expone como RPC PostgREST = IDOR catastrófico clase SEC-HIGH-01).
**Superficie auditada**: design §0 DD-1 (reescrita), §3.5 (`refresh_age_categories()` + `pg_cron`), §4 (fila SEC-SPEC-M02), §5 (A5/A6); req RT2.8.2/RT2.8.4/RT2.8.5/RT2.12.6; tasks T7bis (`0066`) + T8.n.
**As-built verificado**: `0042` (precedente del revoke de `apply_auto_transition`) + `0055` (patrón smoke-check fail-closed `has_function_privilege`).

### Veredicto: **PASS**

0 findings HIGH. El revoke + smoke-check + las 5 confirmaciones del mandato se sostienen contra el as-built. La spec trata el revoke de `refresh_age_categories()` como **control de seguridad principal** (no defensa en profundidad) y lo materializa correctamente en tres lugares concordantes (RT2.12.6, design §4/SEC-SPEC-M02, T7bis) más un test runtime (T8.n). No introduce ninguna superficie cliente nueva ni reintroduce el vector SEC-HIGH-01. El leader puede avanzar a Puerta 1.

### El punto caliente SEC-SPEC-M02 — confirmación de las 5 exigencias

| # | Exigencia del mandato | Veredicto | Evidencia (spec ↔ as-built) |
|---|---|---|---|
| 1 | `revoke execute … from public, authenticated, anon` como **control PRINCIPAL** | OK | design §3.5 SQL `0066:447` (`revoke execute on function public.refresh_age_categories () from public, authenticated, anon`) + RT2.12.6(a) (req:205) + T7bis (tasks:49). La spec lo nombra **literalmente** "el control de seguridad **principal** de esta función, no defensa en profundidad" (design SEC-SPEC-M02, design:489-490) — distinción correcta y crítica: a diferencia de las funciones-trigger (`returns trigger`, **no** expuestas por PostgREST), esta retorna `void` y **SÍ** se expondría como `POST /rest/v1/rpc/refresh_age_categories` sin el revoke. Patrón **idéntico** al que `0042:22` aplicó a `apply_auto_transition` (mismo vector documentado en `0042:7-12`). Suficiente. |
| 2 | **Smoke-check fail-closed** (la migración FALLA si quedó EXECUTE-able por rol cliente) | OK | T7bis (tasks:49) exige sumarla al smoke-check con el patrón `do $$ … has_function_privilege … raise exception …$$` de `0055`; RT2.12.6(a) (req:205) y design SEC-SPEC-M02 (design:490-491) lo reiteran ("la migración FALLA si quedó EXECUTE-able"). El as-built `0055:25-52` es el patrón exacto a clonar (itera `pg_proc × {authenticated,anon,public}`, `has_function_privilege(...,'EXECUTE')` → `raise exception`). **Doble control**: build-time (smoke-check) + runtime (T8.n: `clientA.rpc('refresh_age_categories')` → error, tasks:107). Paridad con `0055`/M01 correcta. |
| 3 | Solo cambia categoría vía `apply_auto_transition`; **no devuelve datos**; **sin params del cliente** | OK | design §3.5 SQL (design:411-443): firma `refresh_age_categories ()` **sin parámetros** (sin superficie de inyección/IDOR por param) · `returns void` (no devuelve filas a ningún caller — RT2.12.6(d)) · el **único** escritor es `perform public.apply_auto_transition(r.profile_id, v_target)` (design:440), **no** hay `UPDATE category_id` directo (RT2.12.6(c)). `apply_auto_transition` ya está revocada de clientes (`0042`) pero el cron, como `SECURITY DEFINER`, corre como owner y puede invocarla (design:457). Reusar el camino confiable registra `animal_category_history` como `auto_transition` (gratis). Sin superficie de inyección/leak. |
| 4 | El **filtro targeted** no introduce ningún caso donde toque algo que no debe | OK (correctness/perf, sin flanco de seguridad) | design §3.5 SQL (design:422-434): `category_override = false` (respeta overrides, RT2.8.3) · `deleted_at is null` (respeta soft-deletes) · `birth_date is not null` (no evalúa edad sin fecha) · solo `(ternero/ternera @≥365) OR (torito/novillito @≥730)`. Hembras **no** entran al corte de 2 años (`vaquillona→vaca` es por parto); `toro/novillo` ya terminales. **Ángulo de seguridad**: el filtro recorre todos los tenants (cross-tenant **by-design**, correcto para job de sistema), pero (a) solo lo invoca `pg_cron`, no un cliente; (b) cada cambio pasa por `apply_auto_transition` (audita); (c) `override=false` no pisa decisiones manuales. No vi caso donde el job toque un perfil que no deba (override/soft-deleted/sin-birth_date quedan fuera del `for…loop`). Sin finding. |
| 5 | `pg_cron` corre como rol del job (no cliente); `create extension`/`cron.schedule` no abren superficie cliente | OK | design §3.5 (design:409 `create extension if not exists pg_cron`; design:451-452 `cron.schedule('refresh_age_categories_nightly','0 3 * * *', …)`). El schedule lo ejecuta el scheduler de `pg_cron` (rol postgres/cron), **no** un cliente `authenticated`/`anon`. Ni `create extension pg_cron` ni `cron.schedule` exponen una superficie invocable vía PostgREST — `cron.*` vive en su propio schema (no en `public`) y no se grantea a roles cliente. El schedule idempotente (upsert por `jobname` + `cron.unschedule` defensivo, design:459) es correctness, no seguridad. Sin superficie nueva. |

### Concordancia de la spec (los 3+1 lugares dicen lo mismo)

Verifiqué que el control no quede a medias por inconsistencia entre documentos:
- **requirements** RT2.12.6 (req:205): revoke (a) + sin params (b) + solo vía `apply_auto_transition` (c) + no devuelve datos (d) — los 4 sub-puntos presentes.
- **design** §4 fila SEC-SPEC-M02 (design:475) + bloque SEC-SPEC-M02 (design:484-492): los 4 sub-puntos + la distinción `void` vs `trigger` (por qué este SÍ se expone y los triggers no).
- **tasks** T7bis (tasks:49): revoke + smoke-check fail-closed nominal; T8.n (tasks:107): test runtime `clientA.rpc(...)` → error.
- **design §3.5 SQL** materializa los 4 sub-puntos en el bloque ejecutable (revoke design:447; sin params + returns void + solo apply_auto_transition design:411-443).

Sin contradicción entre niveles. El revoke aparece en el SQL de diseño Y en req Y en tasks Y como test → no es una promesa suelta de un solo documento.

### Inputs / rate limiting (delta del cron)

- **Inputs**: el cron **no agrega ningún campo de entrada de usuario**. `refresh_age_categories()` no recibe params del cliente (sin params), no concatena input en `.or()/.filter()/ilike`, no toca prompts. Sin superficie de input nueva.
- **Rate limiting**: n.a. — el cron **no** es invocable por clientes (revocado), corre 1×/noche por el scheduler interno. No es endpoint con costo per-request abusable desde afuera. Único "caller": `pg_cron` a las 03:00. Costo en estado estable O(candidatos age-stale)≈0-pocos/noche (filtro indexado), no vector de amplificación. Sin acción.

### Dominios revisados (delta del cron)
- **A1 (service-role / RLS bypass)**: revisado — `refresh_age_categories()` es `SECURITY DEFINER` y bypassa RLS **by-design** (job de sistema cross-tenant); el control compensatorio correcto NO es scoping por tenant (sería contradictorio con su propósito) sino **revoke total de clientes** + solo `pg_cron` la invoca. Patrón correcto para un job de mantenimiento de sistema. Punto fuerte.
- **A4 (BFLA / function-level authz)**: revisado — la función queda **sin** ningún rol cliente con EXECUTE (revoke + smoke-check). No hay rol menor que pueda llamar un job owner-only. Cubierto.
- **A3 (IDOR por param)**: revisado — sin params → no hay `profile_id`/`establishment_id` attacker-controlled. El IDOR clásico (pasar un id ajeno) **no existe**; el único IDOR posible sería invocar la función entera, y lo cierra el revoke (#1).
- **C (offline/sync)**: revisado — el efecto del cron (un `category_id` actualizado server-side) sincroniza al cliente por la **misma** sync rule de `animal_profiles` existente (design:494). Sin sync rule nueva, sin superficie offline nueva. Coherente con offline-first.
- **I2 (audit tamper-evidence)**: revisado — cada transición del cron registra `animal_category_history` como `auto_transition` vía `apply_auto_transition` (design:440, RT2.8.4b), append-only. El job no deja cambios sin auditar.

### Dominios excluidos (delta del cron)
- **B (information disclosure)**: n.a. — `returns void`, no devuelve datos; sin Edge Function que filtre `err.message`.
- **D (secrets/supply chain)**: n.a. — `pg_cron` es extensión de Postgres (no infra externa, no secrets, no imports Deno). `create extension if not exists` no introduce supply chain nuevo.
- **E (abuso a escala / DoW)**: n.a. — no invocable por clientes (no hay denial-of-wallet ni self-DoS por request de usuario); el job recalcula 0-pocos/noche por el filtro targeted.
- **F (inyección/SSRF)**: n.a. — sin input de cliente, sin `fetch()`, sin concatenación dinámica (el `for…loop` opera sobre columnas tipadas).
- **G (BLE)**, **H (auth/sesión)**: n.a. — el cron no toca BLE ni auth.

### Cobertura indirecta / no cubierto por la skill (delta del cron)

La skill `sentry-skills:security-review` está orientada a código aplicativo (JS/Python/Go) y **no** cubre `pg_cron`, PL/pgSQL `SECURITY DEFINER`, la semántica de exposición RPC de PostgREST (`returns void` ⇒ expuesto / `returns trigger` ⇒ no expuesto), ni el modelo de privilegios de roles Postgres — que son **exactamente** el núcleo de este agregado. Por eso esta re-corrida es **revisión manual** contra el as-built verificado (`0042` revoke-precedent + `0055` smoke-check pattern), no pattern-matching de la skill. El PASS descansa en esa revisión manual.

**Recordatorio para Gate 2 (código)**: cuando el implementer escriba `0066`, confirmar en modo `code` que (a) el `revoke execute … refresh_age_categories () from public, authenticated, anon` está presente y **nominal**; (b) la función está en el **array del smoke-check** `has_function_privilege` (clon de `0055:28-38`) de modo que la migración falle si quedó EXECUTE-able; (c) la firma es **sin params** + `returns void`; (d) el único escritor de `category_id` es `apply_auto_transition` (no hay `UPDATE` directo); (e) `cron.schedule` es idempotente (upsert por `jobname` o `unschedule` defensivo). El test T8.n (`clientA.rpc('refresh_age_categories')` → error) ya está declarado para cubrir el caso explotable real en runtime.
