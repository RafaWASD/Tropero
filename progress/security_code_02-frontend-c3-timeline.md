# Security Code Review — Gate 2 — C3.1 (spec 02 frontend: ficha de animal · timeline + 3 eventos simples)

**Modo**: `code` · **Skill usada**: `sentry-skills:security-review` (Sentry) · **Fecha**: 2026-06-02
**Veredicto**: **PASS**

> No high-confidence vulnerabilities identified.

Delta **frontend-only**: no agrega schema, RLS ni Edge Functions. Consume tablas/RPC ya existentes
y auditadas en su momento (migr. 0025/0028/0034/0035). La barrera de seguridad real es la RLS
server-side (`has_role_in` / triggers); el cliente NO fuerza permisos — y se confirmó que no asume
permisos que la RLS no da. Resultado PASS es el esperable para este tipo de delta.

---

## Baseline + alcance del diff

- `baseline_commit` (de `progress/impl_02-frontend-c3-timeline.md`): el delta está **untracked / sin
  commitear** sobre `main`. Verificado con `git status --porcelain`.
- Archivos del delta confirmados como nuevos (`??`) o modificados (` M`) — coinciden 1:1 con el brief.

## Archivos analizados

| Archivo | Estado | Rol |
|---|---|---|
| `app/src/services/events.ts` | NEW | capa de datos: `fetchTimeline` (RPC `animal_timeline`), `addWeight`/`addConditionScore`/`addObservation` |
| `app/src/utils/event-timeline.ts` | NEW | lógica pura: parseo/format/humanizadores |
| `app/src/utils/event-input.ts` | NEW | validación pura (peso, score cerrado, observación) |
| `app/src/components/TimelineEvent.tsx` | NEW | render de una fila del riel |
| `app/app/agregar-evento.tsx` | NEW | wizard de carga (2 pasos) |
| `app/app/animal/[id].tsx` | MODIFIED | ficha + carga del timeline |
| `app/src/services/animals.ts` | MODIFIED | `fetchAnimalDetail` agregó `establishment_id` al select/tipo |

---

## Findings HIGH (Sentry)

Ninguno.

## Findings RAFAQ-SPECIFIC

Ninguno.

---

## Análisis de los 5 vectores del foco (data-flow trazado, metodología de la skill)

### 1. IDOR / aislamiento multi-tenant — OK (mitigado server-side, patrón cliente correcto)

- **`fetchTimeline(profileId)`** (`events.ts:51-52`) → `supabase.rpc('animal_timeline', { profile_id })`.
  El `profileId` viene de `params.id` (URL → `animal/[id].tsx:34`), o sea **attacker-controlled**.
  Pero la RPC es `security definer` + filtra por `has_role_in` dentro de la función (migr. 0035, ya
  auditada): un usuario sin rol en el establishment del animal recibe **set vacío**. El cliente no
  scopea ni puede — la autorización vive server-side. Patrón correcto (`authorization.md`: nunca
  confiar en checks de cliente; acá el check NO está en el cliente, está en la RPC). **No es IDOR.**
- **`addObservation`** (`events.ts:162-170`): manda `establishment_id` (columna denormalizada). Se
  derivó de `fetchAnimalDetail(profileId)` → SELECT con RLS `has_role_in` → `establishment_id` **del
  perfil** (`animals.ts:563`) → params → wizard (`agregar-evento.tsx:67-68,172`). NO es input
  arbitrario: es un valor de una fila que el usuario ya puede leer (pasó RLS). Y aunque un atacante
  forjara el `establishment_id`, hay **doble red server-side**: (a) policy de INSERT exige
  `has_role_in(establishment_id)`; (b) trigger 0034 valida coincidencia perfil↔establishment (23514).
  El cliente además se niega a improvisar con el contexto activo si falta el param
  (`agregar-evento.tsx:164-168`). **No explotable.**
- **`addWeight` / `addConditionScore`** (`events.ts:97-108,126-139`): no mandan `establishment_id`
  (lo setea trigger desde el perfil). Único FK = `animal_profile_id`; el INSERT pasa por RLS
  `has_role_in(establishment_of_profile(...))`. **OK.**

### 2. Inyección — OK (todo parametrizado)

Todos los filtros del delta usan `.eq` / `.in` / `.rpc` de supabase-js (parametrizan). No hay
construcción de filtro string con input crudo en los archivos C3.1. El único patrón string-en-filtro
del repo (`escapeIlike` + `%...%` en `animals.ts:280,318,341-343`) **no es parte del delta C3.1**
(es búsqueda C2 preexistente; el único cambio en `animals.ts` fue sumar `establishment_id` al select
de `fetchAnimalDetail`) y además neutraliza `% _ ,`. **Sin inyección.**

### 3. Validación de límites — OK (DB es la última red, sin impacto de seguridad)

Cliente valida: `validateWeight` (>0, ≤99999.99, `event-input.ts:72-85`), score por selector
**cerrado** de 17 valores (`event-input.ts:28-37` + `agregar-evento.tsx:467-511`, nunca texto libre),
`validateObservation` (no vacío, ≤1000, `event-input.ts:148-157`). Un atacante puede saltear el
cliente, pero el DB tiene los CHECK (0028) + `numeric(7,2)` como última red. El peor caso de bypass
es persistir un valor fuera de rango → el CHECK lo rechaza. Impacto de **integridad/UX**, no de
seguridad. No reportable como HIGH.

### 4. Exposición de datos — OK

`fetchAnimalDetail` agregó `establishment_id` (UUID de tenant, no PII; necesario para el flujo de la
observación). El timeline trae solo columnas de dominio (peso, score, texto de obs, fechas, enums).
Sin over-fetch sensible. **Sin logging**: 0 matches de `console.*` / `logger.*` en todos los archivos
del delta (verificado por grep). **OK.**

### 5. Fail-open — OK (degrada UX, no abre acceso)

`fetchTimeline` (`events.ts:71-73`): si falla la resolución de **nombres de categoría**, devuelve los
items sin el nombre resuelto (el componente muestra "categoría" de fallback,
`event-timeline.ts:479`). Los items ya pasaron por la RPC con RLS; el fallback es sobre *labels
cosméticos*, no omite ningún control de autorización. **No es fail-open de seguridad.**

---

## False positives descartados (trazabilidad)

- **`establishment_id` mandado por el cliente en `addObservation`** — *descartado*: no es
  attacker-controlled de forma insegura (se deriva de fila RLS-filtrada) y hay doble red server-side
  (policy INSERT + trigger 23514). Marcarlo sería defensa-en-profundidad ya mitigada.
- **`profileId` desde la URL (`params.id`) hacia la RPC** — *descartado*: la RPC `security definer`
  con `has_role_in` es la barrera; el cliente correctamente NO scopea.
- **Validación de límites client-side salteable** — *descartado*: el bypass solo persiste basura que
  el CHECK del DB rechaza; sin impacto de seguridad.
- **Filtro `ilike`/`escapeIlike` en `animals.ts`** — *descartado*: fuera del delta C3.1 (código C2
  preexistente) y ya neutraliza comodines.

---

## Cobertura indirecta (advertencia de alcance de la skill)

La skill `sentry-skills:security-review` razona sobre patrones JS/TS genéricos; **no modela
nativamente** Supabase RLS, triggers Postgres, ni PowerSync. La validación de que la barrera real
(RLS `has_role_in`, trigger 0034 → 23514, CHECK 0028, RPC `security definer` 0035) está bien puesta
es **server-side y corresponde a Gate 1 / las migraciones ya auditadas** — NO se re-verifica acá
(este delta no las toca). Para este Gate 2 frontend-only, la cobertura es suficiente: el delta solo
*consume* esas barreras y se confirmó que las consume correctamente (no asume permisos del cliente).
PowerSync no aplica (C5 diferido; el delta usa supabase-js directo). No hay BLE en este delta.
