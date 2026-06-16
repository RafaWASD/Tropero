# Security Code Review — spec 03 MODO MANIOBRAS, chunk M2.2

> Gate 2 (security code, modo `code`, ADR-019). Frontend puro sobre backend done (`0050-0057`).
> Baseline: `f518ea56b8dec3db34ec5e8427a6f1b95b0a858b`. Skill `sentry-skills:security-review` corrida
> sobre el diff (metodología: trazar data flow + verificar exploitability ANTES de reportar).

## Veredicto: **PASS**

No se identificaron findings HIGH-confidence. Los seis focos obligatorios se trazaron contra las
defensas server-side y todas existen y son no-bypasseables desde el cliente attacker-controlled (Expo).
El cliente es el escritor optimista; la AUTORIZACIÓN, el tenant-check y las cotas viven en la DB y
corren al SUBIR (uploadData → PostgREST → RLS + triggers + CHECKs).

---

## Foco 1 — Escritura de eventos con session_id (CRUD-plano)

Data flow: `carga.tsx:captureAndAdvance` → `maneuver-events.persistManeuverEvent` →
`maneuver-event-query.buildManeuverEventQuery` → `local-reads.buildAddTactoInsert`/`buildAddWeightInsert`
→ `runLocalWrite` (INSERT local SQLite) → PowerSync PUT → `connector.ts:78`
`supabase.from(table).upsert({ ...op.opData, id: op.id })` (cliente AUTENTICADO del usuario, RLS-bound).

- **(a) `created_by` NO se manda desde el cliente** — OK. `buildAddTactoInsert` (`local-reads.ts:1242-1258`)
  y `buildAddWeightInsert` (`local-reads.ts:1186-1200`) NO incluyen `created_by` en la lista de columnas
  del INSERT. Lo fuerza el trigger server-side `tg_set_created_by_auth_uid` desde `auth.uid()`
  (`0025_weight_events.sql:24-26`, `0026_reproductive_events.sql:58-60`). El payload del cliente ni lo
  trae. Cubierto por el unit `local-reads` (`doesNotMatch /created_by/`).
- **(b) `session_id` no puede apuntar a una sesión de OTRO establecimiento** — OK. El INSERT lleva el
  `session_id` tal cual lo pasa el frame, pero el trigger `tg_event_session_tenant_check` corre
  `BEFORE INSERT` en `weight_events`/`reproductive_events` (`0056_event_session_tenant_check_split.sql:24-37`,
  fix del bug de 0052 donde el `INSERT OR UPDATE OF session_id` combinado no disparaba en INSERT). Valida:
  cross-tenant (`sessions.establishment_id == establishment_of_profile(animal_profile_id)`, 23514), sesión
  `active` (23514), y rodeo del animal == rodeo de la sesión (23514) — `0052:27-77`. Un `session_id` ajeno
  → rechazo permanente al subir (`upload.ts:217-219` → `permanent_reject` → rollback + superficia).
- **(c) `establishment_id`/`rodeo_id` NO spoofeables** — OK. El INSERT de evento NO setea
  `establishment_id` (queda NULL local; lo fuerza el trigger desde el perfil al subir,
  `local-reads.ts:1165-1170`); el `rodeo_id` no es columna del evento — el tenant-check lo deriva del
  PERFIL activo del animal server-side (`0052:43-45`), no de un valor del cliente. El frame nunca hardcodea
  ni pasa `establishment_id` (`carga.tsx` deriva todo del `profileId`/`sessionId` de la ruta).

## Foco 2 — Corrección desde el resumen (UPDATE) → IDOR

Data flow: `carga.tsx:onEdit` (vuelve al paso) → `captureAndAdvance` con `isCorrection=true` →
`buildManeuverEventQuery` (`maneuver-event-query.ts:56-63`) → `buildUpdateManeuverWeight`/
`buildUpdateManeuverTacto` (`local-reads.ts:1272-1295`) → PowerSync PATCH → `connector.ts:83`
`supabase.from(table).update(op.opData).eq('id', op.id)` (cliente AUTENTICADO del usuario, RLS-bound).

- **No hay IDOR** — OK. Dos barreras:
  1. **Local**: el `id` del UPDATE es el `eventIdFor(maneuver)` ESTABLE generado por el propio cliente
     (`carga.tsx:124-130`, `crypto.randomUUID`) para el evento que ÉL creó en la captura previa. No hay
     superficie para que el operario "elija" un id ajeno desde la UI; y el SQLite local solo contiene
     filas ya scopeadas por la sync stream al tenant del usuario.
  2. **Server**: aunque un atacante forzara un `id` arbitrario de otro tenant, el PATCH va por el cliente
     Supabase del usuario, sujeto a la policy `weight_events_update`/`reproductive_events_update`:
     `is_owner_of(establishment_of_profile(animal_profile_id)) OR created_by = auth.uid()`
     (`0025:40-45`, `0026:67-70`). Un evento de otro establecimiento del que no es owner ni autor → 42501
     → `permanent_reject`. El UPDATE solo toca columnas de DATO (`weight_kg`/`pregnancy_status`/`*_date`);
     NO re-apunta `session_id` ni `animal_profile_id` (`local-reads.ts:1278`, `1291`) → no abre una vía de
     re-tenanting.

## Foco 3 — Inputs de usuario (peso, tacto)

- **Peso (keypad numérico)** — OK, cota en dos capas.
  - Cliente (UX, attacker-controlled): `PesajeStep.pressKey` (`PesajeStep.tsx:82`) topea a 5 dígitos
    enteros (`p.replace(DECIMAL_SEP,'').length >= 5`); `parsePesoKg` (`:44-48`) descarta NaN; el CTA queda
    deshabilitado si `kg <= 0` o no finito (`:71`, `:157`). Bien, pero no es la defensa (bypasseable).
  - **Server (autoritativa)**: `weight_kg numeric(7,2) not null check (weight_kg > 0)`
    (`0025_weight_events.sql:11`). Topea a 99999.99 kg; un número absurdo/gigante da overflow numérico o
    viola el CHECK → 22003/23514 → `permanent_reject` al subir. **Cota server-side existe.** Un número
    "que no rompe" es correcto: el local write no valida (contrato T5), el reject lo maneja uploadData.
  - **Tacto**: enum CERRADO sin texto libre. El cliente solo emite `'empty'/'small'/'medium'/'large'`
    (`TactoStep.tsx`, `maneuver-sequence.ts:23`); la columna es `pregnancy_status_enum`
    (`0026_reproductive_events.sql:9`) → un valor inválido es rechazado por el tipo al subir.
  - **Otros inputs editables**: ninguno en el alcance de M2.2. `work_lot_label`/`name` de preset son texto
    libre pero pertenecen a M1.2/M1.3 (no tocados por este chunk); igual tienen CHECK de tamaño server-side
    (`sessions_config_size` 16KiB, `maneuver_presets_name_not_empty`).

## Foco 4 — Doble-encoding del config jsonb (fix)

- **Parse seguro, sin inyección** — OK. `parseManeuverConfig` (`maneuver-config.ts:28-48`) usa `JSON.parse`
  (no `eval`, no `Function`), tolerante: `null`/malformado/array/no-objeto → `{}` (try/catch). El doble
  `JSON.parse` (`:43`) re-parsea SOLO si el primer resultado es un `string` (caso de la fila sincronizada
  doble-serializada) — sigue siendo `JSON.parse` puro, sin riesgo. `extractManeuvers` (`:55-67`) NO confía
  en el contenido: filtra contra un `Set` whitelist (`MANEUVER_SET = ALL_MANEUVERS`), descarta cualquier
  valor que no sea un `ManeuverKind` conocido, deduplica. El jsonb es pass-through pero el cliente nunca lo
  ejecuta ni lo interpola en SQL. El tamaño lo acota el CHECK `sessions_config_size` server-side. Sin
  prototype-pollution: el objeto parseado solo se lee por `config.maniobras` (no se hace merge recursivo ni
  spread sobre objetos sensibles).

## Foco 5 — Offline no evade validación server-side

- OK. El camino offline es CRUD-plano local (INSERT/UPDATE SQLite) → encola CrudEntry → uploadData drena al
  reconectar. TODA la autorización (RLS), el tenant-check del session_id (0056), las cotas (CHECK weight_kg,
  enum pregnancy_status) y el force de created_by corren server-side AL SUBIR, no local. El contrato T5
  (documentado en `maneuver-events.ts:15-23`) es explícito: el local write siempre devuelve ok offline; el
  rechazo real lo maneja `connector.uploadData` (`connector.ts:96-106`), clasificado como
  `permanent_reject` para RLS 42501/FK/CHECK (`upload.ts:217-219`). El e2e `offline` del implementer
  verifica que los eventos suben con session_id tras reconectar (oráculos service_role `*WithSession`).

## Foco 6 — Secrets / logs de identificadores sensibles

- OK. Grep de `console.*`/`SERVICE_ROLE`/`secret`/`api_key`/`Bearer` sobre `app/app/maniobra/**` y
  `maneuver-events.ts`: **cero matches**. Ningún hardcode. No se loggea peso, EID, idv ni session_id en los
  archivos de M2.2. (El `console.log('[powersync] fetchCredentials', …)` y `surfaceUploadRejection` viven
  en `connector.ts` — código PREEXISTENTE no tocado por M2.2 — y ya están escritos defensivamente: el
  primero loggea solo booleanos + endpoint público con NUNCA-el-token explícito; el segundo loggea solo
  `{table, op, code}`, nunca `opData` ni `error.message` crudo. Fuera de alcance, sin finding.)

---

## False positives descartados (validación manual de la skill)

| Candidato | Por qué NO es finding |
|---|---|
| `buildManeuverEventQuery` pasa `pregnancy`/`weightKg` directo al INSERT sin validar | El INSERT es PARAMETRIZADO (`args: [...]`), no interpolación de string → sin SQL injection. El valor llega de un selector cerrado (tacto) o de un keypad acotado (peso); la cota dura es el enum/CHECK server-side. Local-write sin validación es el contrato T5 by design. |
| UPDATE de corrección `WHERE id = ?` sin filtro de tenant en el SQL | El SQL local opera sobre el SQLite ya scopeado por la stream; el PATCH server-side está sujeto a la RLS-update policy (foco 2). No es service-role (`connector.ts:75` usa `supabase.from`, cliente del usuario). |
| `parseManeuverConfig` doble-`JSON.parse` | `JSON.parse` no ejecuta código; whitelist en `extractManeuvers`. Sin RCE/pollution. |
| `setSessionCounts` escribe `animal_count` desde el cliente | Metadata de conveniencia NO-autoritativa (`sessions.ts:177-193`); el conteo real se recomputa con `count(*)` por session_id server-side. `Math.max(0, trunc())` defensivo. No es constraint de integridad. |
| `formatEidReadable(tagElectronic)` en el header | Render de identidad en pantalla (R12.4), no es log ni se exfiltra; el EID es del propio animal del tenant. |

## Cobertura indirecta (advertencia de scope de la skill)

La skill `sentry-skills:security-review` es fuerte en patrones web (XSS/SQLi/SSRF) pero **NO cubre
directamente**: (a) triggers/policies de Postgres, (b) el modelo de sync de PowerSync (overlay
local-only vs CRUD-plano vs outbox), (c) el contrato offline-first RAFAQ. Esos dominios los revisé
**manualmente** contra las migraciones `0025`/`0026`/`0052`/`0056` y el `connector.ts`, que es donde vive
la frontera de seguridad real de este chunk. Conclusión: la frontera está server-side y es correcta.

## Tabla de inputs (campos que el usuario tipea/elige en M2.2)

| campo | límite | validación | OK? |
|---|---|---|---|
| peso (keypad) | 5 díg enteros + 1 decimal (cliente); `numeric(7,2)` ≤ 99999.99 + `CHECK > 0` (server) | **server-side autoritativa** (CHECK weight_kg) + UX client | ✅ |
| tacto preñez/tamaño | enum cerrado `empty/small/medium/large` | **server-side** (`pregnancy_status_enum`) — sin texto libre | ✅ |
| (sin otros inputs editables en M2.2) | — | — | — |

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| INSERT evento (tacto/pesaje) CRUD-plano | n.a. | — | sí (RLS+tenant-check al subir) | Escritura local offline; no es endpoint custom. La RLS/CHECK gatea al subir. Sin fan-out: 1 evento por confirmación de paso. No es vector de amplificación. |
| UPDATE corrección | n.a. | — | sí (RLS-update) | idem; 1 fila por id estable. |
| `setSessionCounts` | n.a. | — | sí (RLS sessions_update) | metadata no-autoritativa. |

No hay Edge Functions custom, email/SMS, API externa ni bulk/import en este chunk → rate limit no aplica.
El path de sync de PowerSync no es un endpoint de la app susceptible al abuso clásico de cuota.

## Archivos analizados (diff de M2.2 desde baseline)

- `app/app/maniobra/carga.tsx`
- `app/app/maniobra/_components/{TactoStep,PesajeStep,PlaceholderStep,AnimalSummary,SpikeIdentityHeader}.tsx`
- `app/src/services/maneuver-events.ts`
- `app/src/utils/{maneuver-sequence,maneuver-step-kind,maneuver-event-query,maneuver-config}.ts`
- `app/src/services/powersync/local-reads.ts` (builders session_id + UPDATE corrección)
- `app/src/services/{sessions,maneuver-presets}.ts`
- `app/src/services/powersync/{connector,upload}.ts` (frontera de seguridad del upload — leídos como contexto)
- Migraciones de referencia server-side: `0025`, `0026`, `0052`, `0056` (defensas confirmadas)

## check.mjs

- **REAL_RC=1**, pero el rojo es EXCLUSIVAMENTE el flake de rate-limit de Supabase Auth documentado
  (`reference_check_red_rate_limit`): 2 tests de la suite Edge fallan con `Request rate limit reached` en
  `signIn` (`R10.2 change_member_role invalida la sesión del target` + su cascada), por correr en paralelo
  con otra terminal. **NO es regresión de M2.2 ni un finding de security.**
- **Todos los unit de M2.2 pasan en verde**: `maneuver-config`, `maneuver-step-kind`, `maneuver-sequence`,
  `maneuver-event-query`, `local-reads` (builders de session_id + UPDATE de corrección, `created_by` NULL),
  `maneuver-reads`, `upload` (clasificación 42501→permanent_reject). 40/42 pass; las 2 fallas son el flake
  de auth. El rojo ajeno de spec 12 (`import_rodeo_bulk`) no se reprodujo en este entorno.

---

**Resultado**: PASS. Sin findings HIGH. Las defensas server-side de los focos 1/2/3 (tenant-check del
session_id, RLS-update anti-IDOR, CHECK del peso + enum del tacto, force de created_by) existen,
corren al subir, y NO son bypasseables desde el cliente. NO marco done (espera reviewer ya aprobado +
Puerta final de Raf).
