baseline_commit: 559864423de4ee53fb02d33c40dbe090481210d6

# impl 08 — capa DB de export SIGSA (migraciones 0107-0112 + suite RLS)

> Chunk: **capa DB** de la spec 08 (export SIGSA). Solo las 6 migraciones backend (T1-T6) + su
> suite de tests RLS. NADA de PowerSync (T7), servicio (T11/T12/T19/T20) ni UI (T13-T18). La capa
> pura (T8/T9/T10) ya estaba done.
>
> ⛔ **NO se aplicó NINGUNA migración al remoto.** No se corrió `scripts/apply-migration-mgmt.mjs` ni
> ningún apply. El deploy lo gatea el leader (DB compartida, beta). El hook de la suite en
> `scripts/run-tests.mjs` queda **COMENTADO** hasta que el leader aplique 0107-0112 (la suite corre
> contra el remoto → fallaría antes del apply).

## Estado: LISTO PARA REVIEWER + GATE 2 (no marco done; lo cierra el leader)

> Pre-condición de Gate 2 (security_code): `baseline_commit` arriba = SHA previo a la primera task de
> este chunk (559864423de4ee...). El diff de Gate 2 se calcula desde ahí (sobre `main`, NO `main...HEAD`).

`node scripts/check.mjs` → **VERDE (exit 0)** antes y después (typecheck + todas las suites
existentes). No toqué TS (no hubo typecheck nuevo que correr más allá del global, que pasa).

## Entregables

- `supabase/migrations/0107_breed_catalog.sql` (T1)
- `supabase/migrations/0108_animal_profiles_breed_id.sql` (T2)
- `supabase/migrations/0109_reproductive_events_breed_id.sql` (T3)
- `supabase/migrations/0110_establishments_renspa.sql` (T4)
- `supabase/migrations/0111_sigsa_declarations.sql` (T5)
- `supabase/migrations/0112_export_log.sql` (T6)
- `supabase/tests/sigsa/run.cjs` — suite RLS (6 `test()` blocks, uno por migración)
- `scripts/run-tests.mjs` — hook de la suite **comentado** (post-apply lo descomenta el leader)

## Plan ejecutado (T1..T6, capa DB)

- [x] T1 — 0107: breed_catalog + seed (28 bovinas + S/E generic + 3 bubalinas active=false) + RLS read-only.
- [x] T2 — 0108: animal_profiles.breed_id FK + índice parcial + best-effort + herencia ternero al pie (mono).
- [x] T3 — 0109: reproductive_events.breed_id FK + herencia ternero al pie (mellizos) + best-effort no-op documentado.
- [x] T4 — 0110: establishments.renspa (sin unique) + CHECK largo + RPC update_renspa owner-gate.
- [x] T5 — 0111: sigsa_declarations + UNIQUE + RLS (IDOR-check) + trigger force declared_by.
- [x] T6 — 0112: export_log + CHECKs (5MB/255) + RLS + trigger force generated_by + FK export_log_id.
- [x] Suite RLS `supabase/tests/sigsa/run.cjs` + hook (comentado) en run-tests.mjs.

(No marco `[x]` en `tasks.md` — lo reconcilia el leader al cerrar el gate, por instrucción.)

---

## RECONCILIACIÓN CRÍTICA — herencia de breed_id del ternero al pie (el punto más riesgoso)

**Hallazgo 1 — el trigger del design viejo NO existe.** El design citaba `tg_create_calf_on_birth`.
Ese nombre NO está en el árbol de migraciones. El ternero al pie se modeló en spec 02 con DOS
caminos reales:

1. **MONO-ternero**: trigger BEFORE INSERT `tg_reproductive_events_create_calf` (último as-built =
   **0048**; lo redefinieron 0032→0045→0048). Se dispara al insertar un evento `birth` con
   `calf_sex` no-NULL. Crea `animals` + `animal_profiles` del ternero leyendo la fila de la madre.
2. **MELLIZOS**: RPC `register_birth` (último as-built = **0075**, firma `(uuid,date,jsonb,uuid)`).
   Inserta el `birth` SIN `calf_sex` (el trigger mono no actúa) y loopea creando los terneros.

→ Inyecté la herencia de R1.7 en **ambos** caminos:
- **0108** redefine el trigger mono: agrega `p.breed_id` al SELECT de la madre y lo escribe en el
  INSERT del `animal_profiles` del ternero. Verificado con `diff` contra 0048: **byte-idéntico salvo
  las 4 adiciones de breed_id** (declaración var, campo del SELECT, columna y valor del INSERT). Se
  preserva SECURITY DEFINER + search_path + el `exception when others then raise` (rollback atómico
  del parto, R9.4).
- **0109** redefine `register_birth`: agrega `p.breed_id` al SELECT de autorización de la madre y lo
  escribe en el INSERT de cada ternero del loop. Verificado con `diff` contra 0075: **byte-idéntico
  salvo `create function`→`create or replace`, la declaración `v_mother_breed_id`, el campo del
  SELECT y la columna+valor del INSERT**. Se preserva ENTERO el guard de idempotencia scopeado al
  caller (fix HIGH-D1), la autorización derivada de la fila real de la madre, la herencia de tenant
  del server (no del payload), la validación del payload jsonb, y los GRANT/REVOKE de la firma de 4
  args. NO se dropea/recrea la firma (CREATE OR REPLACE la preserva).

**Hallazgo 2 — `reproductive_events.breed` (texto libre) NO existe → best-effort de R1.6 es un NO-OP.**
El design 0109 pedía un `UPDATE ... SET breed_id ... WHERE re.breed IS NOT NULL ...` análogo a 0108.
Pero `reproductive_events` (0026) **no tiene** columna `breed` (verificado: 0026 la crea sin breed;
ninguna migración posterior la agrega; el único `breed` cercano es `semen_registry.breed`, otra
tabla; `animal_profiles.breed` SÍ existe y es la fuente de 0108). Ese UPDATE habría **abortado** la
migración con `column re.breed does not exist`.

→ **Decisión (reconciliación, NO blocker):** agrego la columna `reproductive_events.breed_id`
(nullable FK) porque R1.6 literal lo pide ("agregar breed_id FK nullable") y la necesita el sync de
PowerSync (T7). **OMITO el UPDATE best-effort** (documentado en el .sql): no hay columna fuente que
matchear. La columna queda forward-compat SIN path de población automática en MVP — porque la
herencia que IMPORTA (R1.7) va al `animal_profiles.breed_id` DEL TERNERO (texto del propio R1.7:
"heredar el breed_id de la madre en el animal_profile del ternero"), NO a `reproductive_events.breed_id`.
El código RAZA del TXT sale de `animal_profiles.breed_id` del ternero (R5.2), nunca de
`reproductive_events`. No populo esa columna desde los triggers para no agregar superficie/escritura
a una columna que nada lee en MVP (evita una 2da redefinición de `register_birth`).

Esto NO es un blocker: agregar una columna nullable + heredar al perfil del ternero está dentro de la
intención del spec. Reconciliado en `design.md` (0109) + nota bajo R1.6 en `requirements.md`.

---

## Cross-check del seed (breed_catalog 0107 ↔ breed-senasa.ts ↔ razas-senasa-codigos.md)

**Resultado: PASA 1:1, sin discrepancia.** Comparé los 3:
- `app/src/utils/import/breed-senasa.ts` (capa pura T9/T10): 32 entradas código→nombre.
- Seed de `breed_catalog` (0107): 28 bovinas + `S/E` (generic) + 3 bubalinas (ME/JA/MU, active=false) = 32.
- `razas-senasa-codigos.md` Tabla 1: 32 filas.

Los 32 pares código↔nombre coinciden EXACTO en los 3 (grafías literales del manual, incl. `Bosmara`
por Bonsmara, `S/E` con barra, `Simmental`=FS, `San Ignacio`=SI). La capa pura tiene exactamente las
mismas 28 bovinas + 3 bubalinas + S/E. No hay código en uno que falte en otro. Como NO hubo
discrepancia, no había que parar (el instructivo decía parar SOLO si discrepaban).

---

## Trazabilidad R<n> → migración → test

| R | Migración | Test (`supabase/tests/sigsa/run.cjs`) |
|---|---|---|
| R1.1 (schema breed_catalog) | 0107 | T1(a) SELECT funciona (tabla existe con columnas) |
| R1.2 (seed 28+S/E+3 bubalinas) | 0107 | T1(c) 28 bovinas activas · T1(d) S/E generic · T1(e) ME/JA/MU active=false · T1 grafías literales |
| R1.3 (read-only cliente) | 0107 | T1(a) SELECT ok · T1(b) INSERT/UPDATE/DELETE rechazados (no persisten) |
| R1.4 (animal_profiles.breed_id FK) | 0108 | T2(a) acepta NULL · T2(b) acepta breed_id válido · T2(c) rechaza FK inexistente |
| R1.5 (best-effort match) | 0108 | T2(d/e) 'aberdeen angus'→AA · 'texto_raro'→NULL (réplica del predicado de 0108) |
| R1.6 (reproductive_events.breed_id FK + best-effort) | 0109 | T3(a) acepta NULL · T3(b) FK válido/inexistente · T3(c) [reconciliado] NO existe columna breed → best-effort no-op |
| R1.7 (herencia breed_id madre→ternero) | 0108 + 0109 | T2(f) mono hereda AA · T2(f-bis) madre sin breed→ternero NULL · T3 mellizos heredan H · T3 mellizos madre sin breed→NULL |
| R2.1 (renspa text, sin unique) | 0110 | T4(f) dos est con el MISMO renspa sin error (guard anti-regresión) |
| R2.2 (validación largo 1-20) | 0110 | T4(e) vacío/>20 rechazado por CHECK; válido entra |
| R2.3 (escritura owner-only vía RPC) | 0110 | T4(a) owner ok · T4(b) vet 42501 · T4(c) field_op 42501 · T4(d) UPDATE directo de vet bloqueado (policy 0007) · cross-tenant 42501 · anon revocado |
| R3.1 (schema + UNIQUE) | 0111 | T5(a) owner inserta · T5(d) 2do INSERT del par viola UNIQUE |
| R3.2 (scoped por establishment) | 0111 | T5(g) mismo animal en 2 campos (origen transferred + destino active) → cada uno declara su perfil, sin cross-leak |
| R3.5 (RLS SELECT has_role_in; INSERT owner/vet) | 0111 | T5(a) owner · T5(b) vet · T5(c) field_op rechazado · T5(e/f) cross-tenant no ve |
| R3.6 (declared_by forzado) | 0111 | T5(h) declared_by=auth.uid() aunque el payload mande otro UUID |
| R3.7 (IDOR-check animal_profile↔establishment) | 0111 | T5(i) animal_profile_id de otro est rechazado con establishment_id propio |
| R4.1 (schema export_log + CHECKs) | 0112 | T6(a) owner inserta · T6(g) file_content>5MB y file_name>255 rechazados |
| R4.2 (RLS SELECT has_role_in; INSERT owner/vet) | 0112 | T6(a) owner · T6(b) vet · T6(c) field_op rechazado · T6(d) cross-tenant no ve |
| R4.4 (generated_by forzado) | 0112 | T6(h) generated_by=auth.uid() aunque el payload mande otro UUID |
| R11.1 (audit export_log) | 0112 | T6(a)/(h) (registro con generated_by forzado) |
| R11.2 (audit sigsa_declarations + FK export_log) | 0111+0112 | T5(h) (declared_by) · T6(e) FK export_log_id real/inexistente · T6(f) ON DELETE SET NULL |
| R11.3 (append-only, sin delete cliente) | 0111+0112 | T5 R11.3 (cliente no UPDATE/DELETE declaración) · sin grant update/delete en ambas tablas |

Notas:
- **R3.3/R3.4** (modelo: marcador no en animals/animal_profiles; re-export sin tocar el marcador) son
  propiedades de diseño cubiertas estructuralmente (el marcador vive solo en sigsa_declarations;
  export_log es la tabla de generaciones). No requieren test de DB aislado (se ejercen en la capa de
  servicio T11/T20, diferida).
- **R15.x** (multi-tenant) se ejerce transversalmente por los tests cross-tenant de T5/T6 (un usuario
  sin rol no ve ni escribe); el scope de PowerSync (R15.1 sync) es de T7 (diferido).

---

## Autorrevisión adversarial (paso 8)

Busqué activamente, como revisor hostil:

**(a) Desviaciones del spec.** El único delta real vs el design es la reconciliación de R1.6 (best-effort
no-op por columna inexistente) + la herencia de R1.7 va al perfil del ternero (no a reproductive_events).
Ambas reconciliadas en design.md + nota en requirements.md. No quedó ningún R<n> sin cubrir.

**(b) Bugs / edge cases.**
- Redefiniciones de `register_birth` (0109) y trigger mono (0108): verificadas con `diff` contra el
  as-built (0075/0048) → minimales, lógica de seguridad preservada (guard idempotencia HIGH-D1, authz
  de la fila real, rollback atómico). Sin regresión del path online (p_client_op_id default null).
- best-effort de 0108: confirmé que los 32 nombres del seed son distintos case-insensitive → el JOIN
  por `lower(trim(name))` es determinista (no hay 2 filas que colisionen el mismo nombre).
- CHECK de renspa: `<= 20` (20 chars pasan), `char_length(trim(...)) > 0` (blanco rechazado), NULL ok.
  Test T4(e) con exactamente 20 y 21 chars + blanco.
- 5MB: `octet_length(file_content) <= 5000000`; test con 5_000_001 bytes ASCII (rechaza) + 1000 (pasa).

**(c) Gaps de seguridad.**
- RLS fail-closed: breed_catalog sin policies de escritura (read-only); sigsa_declarations/export_log
  sin grant ni policy UPDATE/DELETE (append-only, R11.3).
- `search_path = public` en todas las funciones SECURITY DEFINER (update_renspa, los 2 triggers de
  creación de ternero que ya lo tenían). Los 2 triggers force-auth.uid() (declared_by/generated_by) NO
  llevan SECURITY DEFINER ni search_path — IDÉNTICO al patrón as-built 0043/0073 (son asignaciones
  triviales sobre NEW, sin acceso a tablas → no necesitan hardening; corren como invoker).
- `revoke execute ... from public, anon` + `grant ... to authenticated` en update_renspa (igual que el
  patrón de 0005/0041). register_birth re-aplica su revoke/grant de 0075.
- IDOR: el WITH CHECK de sigsa_declarations verifica `animal_profile_id` pertenece al `establishment_id`
  (R3.7) — test T5(i). El de import (MEDIUM-4) está cubierto.
- declared_by/generated_by forzados por trigger → no spoofeables (test T5(h)/T6(h)).
- **Gotcha documentado**: como declared_by/generated_by se fuerzan a `auth.uid()`, una inserción por
  service_role SIN contexto JWT (auth.uid()=NULL) violaría el NOT NULL. NO es un problema: los clientes
  siempre tienen JWT; los tests insertan en esas tablas SOLO vía user clients (admin/service_role solo
  SELECT/DELETE). Consistente con import_log (0073, mismo patrón).

**(d) Gaps offline-first / multi-tenant.** El sync de PowerSync (org_scope) es T7 (diferido, no este
chunk). A nivel DB: todas las tablas nuevas tienen establishment_id (directo) + RLS has_role_in; los
tests cross-tenant (T5/T6) confirman que un usuario sin rol no ve ni escribe.

**(e) Tests que pasan por la razón equivocada.**
- T4(d) (UPDATE directo de vet bloqueado): el assert acepta `error !== null || data.length === 0`
  (PostgREST puede devolver 0 filas por el USING `is_owner_of` en vez de error) + verifica
  no-mutación adversarial → no es un falso verde.
- T1(b) UPDATE/DELETE de catálogo: verifico no-mutación con admin (no me confío de que PostgREST tire
  error) → robusto.
- T2(d/e) best-effort: **limitación honesta** — el UPDATE one-shot de 0108 corre al APLICAR la
  migración (filas pre-apply); mis filas de test nacen post-apply, así que el one-shot no las toca. El
  test REPLICA el predicado EXACTO (match por lower(trim(name)) solo donde breed_id IS NULL) vía
  service_role para ejercer la MISMA lógica sobre filas nuevas. El harness usa PostgREST (no SQL crudo)
  → no se puede re-disparar el UPDATE de la migración; replicar el predicado es la vía disponible y
  ejerce la lógica correcta. Documentado en el test.
- Adversarial en cada rechazo (field_op INSERT, IDOR, cross-tenant): verifico que la fila NO quedó
  escrita con admin, no solo que hubo error.

**Hallazgos corregidos durante la autorrevisión:**
1. Saqué una llamada a una RPC helper inexistente (`exec_best_effort_breed_match`) que había dejado
   con `.catch()` defensivo en T2(d/e) — quedaba sucia y confusa; el UPDATE directo del predicado es
   el path real. Limpio.
2. Reforcé T5(g): de "estB declara su perfil" a un modelado FIEL de R3.2 (mismo animal_id, origen
   transferred + destino active, ambas declaraciones coexisten) — el partial-unique
   `animal_profiles_active_animal_unique` (0020) obliga a que el origen deje de estar activo, lo
   repliqué.
3. Saqué vars no usadas (hId en T2, alias hByName en T3).

Re-verifiqué `node scripts/check.mjs` → VERDE tras los fixes. `node --check` sobre la suite y
run-tests.mjs → OK.

---

## Idempotencia (el apply corre SQL crudo vía Management API)

Cada migración es re-corrible: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX
IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY/TRIGGER/CONSTRAINT IF EXISTS` antes de
recrear, seed con `ON CONFLICT (senasa_code) DO NOTHING`.

## Lo que NO hice (gating del leader)

- NO apliqué ninguna migración al remoto (ni apply-migration-mgmt.mjs ni nada). Lo aplica el leader
  tras revisar el SQL; si algo falla, me relanza con los errores.
- NO marqué `[x]` en `tasks.md`.
- NO toqué PowerSync (schema.ts / rafaq.yaml), ni la capa pura, ni otras specs, ni nada fuera de
  `supabase/migrations/0107..0112` + `supabase/tests/sigsa/run.cjs` + el hook (comentado) en
  `scripts/run-tests.mjs`.
- Typecheck: NO toqué TS → el typecheck global de check.mjs pasa igual (verde).
