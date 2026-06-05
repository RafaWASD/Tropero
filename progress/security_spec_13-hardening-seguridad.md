# Gate 1 — security_analyzer (modo `spec`) — Spec 13 Hardening de seguridad

**Veredicto: PASS**

**Fecha**: 2026-06-04 (re-revisión tras fix-loop de SPEC-HIGH-1). **Modo**: `spec` (ADR-019, Gate 1 obligatorio — schema/RLS-sensitive).
**Input**: `specs/active/13-hardening-seguridad/{context,requirements,design,tasks}.md`.
**Fuente cruzada (este pase)**: barrido propio de TODAS las migrations con `grant ... insert/update ... to authenticated` (0001/0002/0003/0004/0009/0017/0018/0019/0020/0025/0026/0027/0028/0029/0034/0037/0050/0051) + auditoría de `ADD COLUMN` (0037/0043/0053/0060/0061) + tablas server-only (0030/0045) + verificación de valores reales de tokens (`invite_user/index.ts`, `push-notifications.ts`) + `0044` (enum `exit_reason`).
**Reporte previo**: este archivo, veredicto NEEDS_CLARIFICATION por SPEC-HIGH-1 (INPUT-1 incompleto, ~14 columnas de texto-libre sin tope). Sobrescrito.

## Resumen ejecutivo

**SPEC-HIGH-1 está CERRADO.** El fix-loop eligió Path A (ampliar INPUT-1 a TODA la superficie de texto-libre/jsonb attacker-controlled) y R1 pasó de 14 a **45 columnas en 15 tablas** (R1.1–R1.45). Hice mi propio barrido independiente — table-grant por table-grant, columna por columna, más auditoría de `ADD COLUMN` post-creación y de las tablas sin grant de escritura al cliente — y **no queda ninguna columna `text`/`jsonb` user-writable fuera de R1**. La redacción categórica ("**Cada** columna…", R1 línea 27 y 31) ahora es **verdadera y verificada**.

La ampliación **no introdujo problemas**: ningún techo rompe un valor legítimo (los tokens server-generated tienen headroom holgado; los jsonb usan tope de bytes consistente con el patrón ya shippeado), las exclusiones R1.48 están bien justificadas, y T1 (pre-check de datos legados que aborta visible) es la red de seguridad contra un techo demasiado bajo. Los otros 4 fixes (B1-1/A1-1/F1-1/H1-1) quedaron **intactos** — IDs R3–R10 sin cambios en requirements/design/tasks/trazabilidad. El test de INPUT-1 (R2/T3) muestrea ≥3 tablas nuevas incluyendo un jsonb con `techo+1` bytes esperando `23514`.

Los dos residuales SPEC-MED-1 (A1-1-resto: column-level write authz para animales compartidos) y SPEC-MED-2 (H1-1: API GoTrue por-user-id no verificada) siguen siendo **MEDIUM no-bloqueantes**, ya están en `docs/backlog.md`, y son para la Puerta 1 humana. No se re-litigan.

→ **PASS**. La spec pasa Gate 1.

---

## 1. ¿SPEC-HIGH-1 cerrado? — barrido propio de completitud (CERRADO)

Reconstruí la superficie de INPUT-1 desde cero: todas las tablas con `grant ... insert/update ... to authenticated` (única clase escribible por un miembro vía PostgREST directo), y por cada una listé sus columnas `text`/`jsonb` de texto-libre de usuario (excluyendo enums/numéricos/date/bool y los `text`-con-CHECK-enum como `animals.sex`, `reproductive_events.calf_sex`, `animal_events.event_type`).

| Tabla (migration) | Cols `text`/`jsonb` user-writable | En R1? |
|---|---|---|
| `users` (0001) | name, email, phone | R1.1–R1.3 ✅ |
| `establishments` (0002) | name, province, city, plan_type, **plan_limits (jsonb)** | R1.4–R1.8 ✅ |
| `user_roles` (0003) | — (todo uuid/enum/bool/ts) | n.a. ✅ |
| `invitations` (0004) | email, token | R1.9–R1.10 ✅ |
| `push_tokens` (0009) | token, device_id (`platform` ya CHECK-enum) | R1.11–R1.12 ✅ |
| `rodeos` (0017) | name | R1.13 ✅ |
| `rodeo_data_config` (0018) | **custom_config (jsonb)** | R1.14 ✅ |
| `animals` (0019) | tag_electronic (`sex` ya CHECK-enum) | R1.15 ✅ |
| `animal_profiles` (0020) | idv, visual_id_alt, breed, coat_color, entry_origin, notes (`exit_reason` → enum 0044) | R1.16–R1.21 ✅ |
| `weight_events` (0025) | notes | R1.22 ✅ |
| `semen_registry` (0026) | pajuela_name, bull_name, breed, supplier, notes | R1.23–R1.27 ✅ |
| `reproductive_events` (0026) | notes, calf_tag_electronic (`calf_sex` ya CHECK-enum) | R1.28–R1.29 ✅ |
| `sanitary_events` (0027) | product_name, active_ingredient, result, notes | R1.30–R1.33 ✅ |
| `condition_score_events` (0028) | notes (`score` numeric-CHECK) | R1.34 ✅ |
| `lab_samples` (0029) | tube_number, lab_destination, result, result_interpretation, notes | R1.35–R1.39 ✅ |
| `animal_events` (0034) | text, **structured_payload (jsonb)** (`event_type` ya CHECK-enum) | R1.40–R1.41 ✅ |
| `management_groups` (0037) | name | R1.42 ✅ |
| `sessions` (0050) | work_lot_label, notes (`config` jsonb **ya** topado <16384, 0050) | R1.43–R1.44 ✅ |
| `maneuver_presets` (0051) | name (`config` jsonb **ya** topado <16384, 0051) | R1.45 ✅ |

**Las 7 columnas que faltaban en mi reporte previo (`reproductive_events.notes`, `semen_registry.{pajuela_name,bull_name,breed,supplier,notes}`, `sanitary_events.{product_name,active_ingredient,result,notes}`, `lab_samples.{tube_number,lab_destination,result,result_interpretation,notes}`, `rodeos.name`, `management_groups.name`, `animal_events.structured_payload`) están AHORA todas en R1.** Y el grep propio del `spec_author` sumó las que mi finding no listaba (`establishments.{plan_type,plan_limits}`, `invitations.{email,token}`, `push_tokens.{token,device_id}`, `rodeo_data_config.custom_config`, `weight_events.notes`, `condition_score_events.notes`, `reproductive_events.calf_tag_electronic`, `sessions.{work_lot_label,notes}`, `maneuver_presets.name`) — todas verificadas presentes.

**Auditoría de `ADD COLUMN` post-creación** (para que no se escape una columna agregada por ALTER a una tabla ya granteada): las únicas son `0037 management_group_id` (uuid), `0043 created_by` (uuid), `0053 heifer_fitness` (enum), `0060 is_castrated` (bool), `0061 nursing` (bool). **Ninguna es `text`/`jsonb` de usuario** → nada que sumar. ✅

**Tablas con grant de escritura NO al cliente** (correctamente fuera de la superficie): `animal_category_history` (0030, "insert solo vía trigger, no grant insert al cliente"), `birth_calves` (0045, solo `grant select to authenticated`; insert solo `SECURITY DEFINER`). Verificado: ninguna tiene `grant insert/update to authenticated`. ✅ Excluidas con razón.

**Conclusión**: el barrido es **completo y verdadero**. No hay ninguna columna `text`/`jsonb` user-writable fuera de R1.1–R1.45. SPEC-HIGH-1 **cerrado**.

---

## 2. ¿La ampliación introdujo algún problema? — techos verificados (sin problema)

Revisé las columnas NUEVAS del fix-loop con foco en techos que pudieran romper un valor legítimo:

- **`invitations.token` (R1.10, techo 512)**: server-generated. `invite_user/index.ts:116` → `crypto.randomUUID()` = **36 chars**. Cap 512 = headroom enorme. **Inofensivo, no rompe nada.** ✅
- **`push_tokens.token` (R1.11, techo 512)**: Expo push token (`getExpoPushTokenAsync`, `push-notifications.ts:52`). Formato `ExpoPushToken[...]` ~40 chars, o tokens FCM/APNs crudos hasta ~200. Cap 512 holga el largo real. ✅
- **`structured_payload` / `plan_limits` / `custom_config` (jsonb, R1.41/R1.8/R1.14)**: tope de **bytes** vía `octet_length(col::text) <= N` — `plan_limits` 16384, `custom_config` 16384, `structured_payload` 32768. Consistente con el patrón ya shippeado `sessions.config`/`maneuver_presets.config < 16384` (0050/0051). 16–32 KiB es generoso para config de owner y payload de evento. **No rompe ningún uso real.** ✅
- **Techos en columnas server-generated/no-user-input innecesarios pero inofensivos**: los tokens (R1.10/R1.11) son el ejemplo — el tope no es estrictamente necesario (el valor es server-controlled) pero es **inofensivo** (512 >> valor real) y aporta defensa-en-profundidad barata. No es un problema; es una decisión conservadora correcta.
- **Ningún techo demasiado bajo que rompa un flujo**: revisado caso por caso, no hay ninguno. El techo más ajustado a un valor real es `users.phone` 32 (teléfono AR con prefijo país entra holgado) y los identificadores 32/64 (TAG FDX-B 15 díg, IDV/visual cortos). Todos con margen.

**Exclusiones (R1.48) bien justificadas**: enums/numéricos/`date`/`bool` no necesitan tope de largo; `sessions.config`/`maneuver_presets.config` ya topados (no se duplica el CHECK); `push_tokens.platform` ya CHECK-enum; catálogos globales read-only (`species`, `systems_by_species`, `categories_by_system`, `field_definitions`, `system_default_fields`) sin grant de escritura a `authenticated` → fuera de la superficie de INPUT-1. `exit_reason` confirmado convertido a enum en `0044`. ✅

**Red de seguridad contra techo-demasiado-bajo**: T1 hace un pre-check (`count(*) where char_length(col) > N` / `octet_length(col::text) > N`) que **aborta y reporta** si hay datos legados fuera de rango, y el patrón `not valid` + `validate constraint` (R1.46) falla **visible**, no corrompe silencioso. Si algún techo fuera demasiado bajo para un dato real, la migration lo grita en vez de pasar. ✅

**Conclusión**: la ampliación es limpia. Ningún techo rompe un valor legítimo; los topes sobre columnas server-generated son inofensivos; las exclusiones están justificadas.

---

## 3. ¿Los otros 4 fixes (B1-1/A1-1/F1-1/H1-1) siguen intactos? (SÍ)

Verificado contra requirements/design/tasks/trazabilidad:

- **B1-1 (R3, R4)**: IDs R3.1–R3.6 / R4.1 sin cambios. Design §B1-1 (helper `serverError`, `_shared/auth.ts:44` genérico, ~32 ocurrencias) idéntico. Tasks T4–T7 intactos. ✅
- **A1-1 (R5, R6)**: IDs R5.1–R5.5 / R6.1–R6.3 sin cambios. Design §A1-1 (`with check == using`, trigger 0036 para EID, "Punto fino" escalado) idéntico. Tasks T8–T10 intactos. ✅
- **F1-1 (R7, R8)**: IDs R7.1–R7.5 / R8.1–R8.3 sin cambios. Design §F1-1 (`.ilike` parametrizado, `SEARCH_TERM_MAX_LENGTH=64` server-side, `maxLength` UX) idéntico. Tasks T11–T15 intactos. ✅
- **H1-1 (R9, R10)**: IDs R9.1–R9.5 / R10.1–R10.3 sin cambios. Design §H1-1 (`signOut(targetUserId)`, incógnita API por-user-id, fail-soft) idéntico. Tasks T16–T19 intactos. ✅

El historial de refinamiento (requirements línea 190) lo confirma: *"Fixes B1-1/A1-1/F1-1/H1-1 intactos … IDs de requirements R3–R10 sin cambios (solo se renumeraron las sub-líneas internas de R1)."* Verificado que es literal. ✅

(Estos 4 fixes ya los audité a fondo en el pase previo y di cada uno por correcto contra el source. El fix-loop no los tocó → no se re-audita la corrección, solo se confirma intactos, como pidió el leader.)

---

## 4. Test de INPUT-1 — muestreo ≥3 tablas nuevas incl. jsonb techo+1 (CUMPLE)

- **R2.1**: muestreo por **clase** de techo y por **tipo** (`text` y `jsonb`), vía PostgREST/SQL directo con JWT de miembro, `techo+1` → espera `23514`; y borde `techo` → persiste.
- **R2.2 / T3**: **obligatorio** muestrear ≥2–3 tablas del refinamiento: `sanitary_events.notes` (clase notas, `text`), `animal_events.structured_payload` (jsonb, **`techo+1` bytes** → `23514`), más una de eventos/sesiones (`sessions.notes` o `weight_events.notes`). ✅ Cubre las tres condiciones del foco: ≥3 tablas nuevas, incluido un jsonb con `octet_length(::text)` por encima del tope.
- **R2.3**: borde superior aceptado persiste (anti-falso-positivo). ✅
- **R2.4 / T3**: espeja `supabase/tests/rls/run.cjs` (fixtures service-role + assertion JWT real de miembro), **no UI**. ✅

**Conclusión**: el test evidencia que la cobertura ampliada es real (golpea tablas nuevas, no solo las originales) y que el jsonb-cap-por-bytes funciona (`techo+1` bytes esperando `23514`). Cumple el foco 4.

---

## Findings

### SPEC-HIGH-1 — CERRADO

Era: *"INPUT-1 deja ~14 columnas de texto-libre attacker-controlled sin tope"*. **Resuelto vía Path A**: R1 ampliado a 45 columnas / 15 tablas; barrido propio confirma que no queda ninguna columna `text`/`jsonb` user-writable afuera. La redacción "Cada columna…" es ahora verdadera. **Sin acción pendiente.**

### SPEC-MED-1 — A1-1 no cierra mutación de campos no-EID de un animal compartido (MEDIUM, no-bloqueante, en backlog)

Sin cambios respecto al pase previo. El `with check == using` cierra `with check (true)` y alinea el patrón; el trigger 0036 blinda `tag_electronic` (EID). El residual (co-tenant de A reescribe `sex`/`birth_date`/`breed`/`coat_color` de un animal **compartido** A+B) es acceso legítimo por diseño de `animals` global (ADR-004) y no lo cierra ninguna policy. Requiere column-level write authz = scope nuevo. La spec lo escala correctamente (design "Notas para Gate 1 #1"). **Confirmado MEDIUM no-bloqueante**, ya en `docs/backlog.md` (A1-1-resto), para la Puerta 1 humana. No se re-litiga.

### SPEC-MED-2 — H1-1 depende de API GoTrue por-user-id no verificada (MEDIUM, no-bloqueante, en backlog)

Sin cambios. `auth.admin.signOut(userId, scope)` por user id puede no existir en la versión de `@supabase/supabase-js@2`/GoTrue. T16 lo marca como incógnita y exige escalar al leader antes de aceptar el fallback `active:false`-solo. Riesgo de **implementación**, no hueco de spec. **Confirmado MEDIUM no-bloqueante**, en `docs/backlog.md`, para la Puerta 1 humana. No se re-litiga.

---

## Tabla de inputs (campos de usuario tocados por la spec — re-revisión)

| Campo | Límite (server) | Validación | OK? |
|---|---|---|---|
| `users.name/phone/email` | CHECK 120/32/320 (R1.1-3) | server (DB CHECK) | ✅ |
| `establishments.name/province/city/plan_type` | CHECK 160/96/96/64 (R1.4-7) | server | ✅ |
| `establishments.plan_limits` (jsonb) | CHECK octet 16384 (R1.8) | server | ✅ |
| `invitations.email/token` | CHECK 320/512 (R1.9-10) | server | ✅ |
| `push_tokens.token/device_id` | CHECK 512/160 (R1.11-12) | server | ✅ |
| `rodeos.name` | CHECK 120 (R1.13) | server | ✅ |
| `rodeo_data_config.custom_config` (jsonb) | CHECK octet 16384 (R1.14) | server | ✅ |
| `animals.tag_electronic` | CHECK 32 (R1.15) + trigger inmutab. 0036 | server | ✅ |
| `animal_profiles.idv/visual_id_alt/breed/coat_color/entry_origin/notes` | CHECK 64/64/64/64/120/4000 (R1.16-21) | server | ✅ |
| `weight_events.notes` | CHECK 4000 (R1.22) | server | ✅ |
| `semen_registry.pajuela_name/bull_name/breed/supplier/notes` | CHECK 120/120/64/160/4000 (R1.23-27) | server | ✅ |
| `reproductive_events.notes/calf_tag_electronic` | CHECK 4000/32 (R1.28-29) | server | ✅ |
| `sanitary_events.product_name/active_ingredient/result/notes` | CHECK 160/160/4000/4000 (R1.30-33) | server | ✅ |
| `condition_score_events.notes` | CHECK 4000 (R1.34) | server | ✅ |
| `lab_samples.tube_number/lab_destination/result/result_interpretation/notes` | CHECK 64/160/4000/4000/4000 (R1.35-39) | server | ✅ |
| `animal_events.text` | CHECK 4000 (R1.40) | server | ✅ |
| `animal_events.structured_payload` (jsonb) | CHECK octet 32768 (R1.41) | server | ✅ |
| `management_groups.name` | CHECK 120 (R1.42) | server | ✅ |
| `sessions.work_lot_label/notes` | CHECK 120/4000 (R1.43-44) | server | ✅ |
| `maneuver_presets.name` | CHECK 120 (R1.45) | server | ✅ |
| **buscador (término)** | recorte 64 server-side (R7.3) + `.ilike` parametrizado (R7.1) | server (autoritativo) + maxLength UX | ✅ |

**Todos los campos de entrada de usuario tienen ahora límite claro + validación autoritativa server-side (DB CHECK o recorte server-side en el service).** No queda ningún campo en estado "ausente" o "solo-cliente". Cumple el requisito de Raf ("límite + validación en CADA campo").

## Tabla de rate limits (acciones abusables tocadas por la spec)

| Acción | Rate limit | Keyeo | Fail-closed? | Nota |
|---|---|---|---|---|
| Buscador (`searchAnimals`) | n.a. para rate; tope de término 64 + `.limit(20)` por query | per-establishment (RLS) | sí | F1-1 acota término y filas; no agrega rate, aceptable (read autenticado scopeado) |
| `remove_member`/`change_member_role` (signOut target) | n.a. (no nuevo vector; owner-only ya autorizado) | per-establishment | sí (fail-soft documentado) | H1-1 no introduce acción abusable nueva |
| EFs (B1-1 copy genérico) | sin cambio | — | — | B1-1 no toca rate; E2-1 (cuota propia de EFs) FUERA por Gate 0 (backlog condicionado a Resend) |

Ninguna acción de esta spec introduce un vector abusable nuevo. El gap conocido (E2-1) fue conscientemente excluido en Gate 0. No es finding de esta spec.

---

## Dominios del catálogo A–I revisados

- **A (authz/object-function)**: A1-1 (R5) — intacto, correcto, residual MEDIUM nominado (SPEC-MED-1). Service-role de EFs verde por baseline.
- **B (exposición de datos)**: B1-1 (R3) — intacto, completo (32 ocurrencias + `auth.ts:44`).
- **F (inyección)**: F1-1 (R7) — intacto, parametrización cierra el injection de raíz.
- **H (auth/sesión)**: H1-1 (R9) — intacto, diseño correcto, incógnita de API (SPEC-MED-2).
- **INPUT (validación de inputs)**: **re-auditado a fondo este pase** → cobertura **completa** (45/45), SPEC-HIGH-1 cerrado.
- **E (abuso/escala)**: rate limits — sin vector nuevo; E2-1 fuera por Gate 0.

## Dominios excluidos (con justificación)

- **C (offline/sync — PowerSync/Realtime/SQLite-at-rest)**: no wired (ADR-002 pendiente). H1-1 documenta el modelo de invalidación pensando en C4 futuro; no se audita C acá.
- **G (BLE)**: spec 04 sin shippear; no tocado por esta spec.
- **D (secretos/supply chain)**: la spec no agrega secrets ni imports nuevos (reusa `jsr:@supabase/supabase-js@2` ya pineado).
- **I (compliance/mobile)**: no toca retención/borrado/mobile-hardening. `delete_account` solo se referencia como patrón.

---

## Anexo LOW

- **LOW-1**: el `serverError` helper loguea con `console.error` además del `console.error` existente en cada catch → log redundante. La spec lo marca como decisión menor del implementer. Cosmético.
- **LOW-2**: `_shared/push.ts:34,116` loguea `error.message` server-side (log, no respuesta) — correcto, fuera de alcance de B1-1.

---

## Veredicto

**PASS.** SPEC-HIGH-1 está **cerrado** (Path A): R1 cubre las 45 columnas `text`/`jsonb` user-writable en 15 tablas, verificadas una por una contra mi propio barrido de grants + auditoría de `ADD COLUMN` + tablas server-only — no queda ninguna afuera. La ampliación **no introdujo problemas** (techos verificados contra valores reales, exclusiones justificadas, pre-check anti-techo-bajo). Los otros 4 fixes (B1-1/A1-1/F1-1/H1-1) están **intactos** (IDs R3–R10 sin cambios). El test de INPUT-1 muestrea ≥3 tablas nuevas incluyendo un jsonb con `techo+1` bytes esperando `23514`.

SPEC-MED-1 y SPEC-MED-2 siguen siendo **MEDIUM no-bloqueantes**, ya en `docs/backlog.md`, para que la Puerta 1 humana los confirme conscientemente. La spec pasa Gate 1.
