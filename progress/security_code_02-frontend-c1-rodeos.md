# Security review (Gate 2, modo `code`) — spec 02 frontend · C1 RODEOS

**Veredicto: PASS**

Foco: multi-tenant / IDOR + authz client-side del frontend de RODEOS. El backend (RLS de
`rodeos` / `rodeo_data_config`, migration 0017/0018) está fuera de scope (ya gateado) — se
asume que la RLS funciona y se verifica que el CLIENTE no la eluda ni asuma permisos que no tiene.

Baseline: `acf1d3dbde8bab8a5944a2695d09f4ecfcc7cd41` (registrado en `progress/impl_02-frontend-c1-rodeos.md`).
Todos los archivos en foco están sin commitear (nuevos, salvo `_layout.tsx` modificado).

---

## Findings HIGH

Ninguno.

---

## Verificación del foco (cada punto del prompt, con evidencia)

### 1. Multi-tenant / IDOR — PASS

- **`establishment_id` se deriva del contexto activo, no de un valor manipulable ni hardcodeado.**
  `crear-rodeo.tsx:64` y `rodeos.tsx:33-42` toman `establishmentId` de
  `useEstablishment()` (`estState.status === 'active' ? estState.current.id : null`). Ese estado
  proviene de `EstablishmentContext`, que carga `user_roles` vía supabase-js con RLS sobre
  `auth.uid()` (`EstablishmentContext.tsx:12` lo documenta; `utils/establishment.ts:167` arma el
  estado `active` con `role: match.role` derivado del join server-side). El cliente nunca compone
  ni acepta un `establishment_id` de input del usuario.

- **`fetchRodeos` está scopeado y RLS-respaldado.** `rodeos.ts:127-138`:
  `.eq('establishment_id', establishmentId).eq('active', true).is('deleted_at', null)`. El
  `.eq(establishment_id)` solo restringe lo que ya filtra `rodeos_select` (`has_role_in`,
  0017:50-51). Un establishmentId de otro tenant devolvería 0 filas (RLS). No hay camino de lectura
  cross-tenant.

- **`createRodeo` (split insert+select por diff de set) NO abre IDOR.** `rodeos.ts:211-234`:
  `before = fetchRodeos(establishmentId)` → `insert` SIN `.select()` → `after = fetchRodeos(...)`
  → `created = after.find(r => !beforeIds.has(r.id))`. Tanto `before` como `after` están scopeados
  por `.eq(establishment_id)` + RLS; el `insert` con un `establishment_id` ajeno sería rechazado por
  `rodeos_insert` (`is_owner_of`, 0017:53-54). El `created` solo puede ser un rodeo visible al
  usuario en SU campo. No cruza tenant.

- **`editar-plantilla` con `rodeoId` arbitrario (deep-link) NO opera fuera del campo activo.**
  `editar-plantilla.tsx:60-64`: el `systemId` se resuelve buscando `rodeoId` en
  `rodeoState.available` (el set scopeado del campo activo). Si el `rodeoId` no está en ese set,
  `systemId === null` → `load()` corta con "No pudimos identificar el rodeo" (`:77-80`) y no hace
  ninguna mutación. Y aun si llegaran a llamarse `toggleRodeoField`/`enableNonDefaultField` con un
  rodeoId ajeno, la RLS (`is_owner_of`) los bloquea (count=0). Defensa en profundidad correcta.

- **`fetchRodeoConfig` / `toggleRodeoField` / `enableNonDefaultField`** (`rodeo-config.ts`) no
  aceptan establishment_id alguno: operan por `rodeo_id`, y la RLS deriva el acceso desde el
  establishment del rodeo (documentado en `rodeo-config.ts:9-10`). Sin camino cross-tenant.

### 2. Authz owner-only (R2.3/R2.12) — PASS

- **El cliente confía en la RLS, no solo oculta botones.** `rodeos.tsx:36` y
  `editar-plantilla.tsx:56` derivan `isOwner` de `estState.role === 'owner'` SOLO para gating de
  UI. Las mutaciones reales (`createRodeo`, `softDeleteRodeo`, `toggleRodeoField`,
  `enableNonDefaultField`) van a tablas con RLS `is_owner_of` (0017:53-58 / 0018). Un
  field_operator que llegara a la mutación (UI manipulada) recibe count=0 / error.

- **`softDeleteRodeo` distingue bloqueo de RLS de éxito (no falso éxito).** `rodeos.ts:281-298`:
  `UPDATE ... { count: 'exact' } ... .is('deleted_at', null)`; `if (count === 0)` devuelve error
  accionable ("Solo el dueño del campo puede hacerlo"). No marca OK ante un bloqueo de RLS.

- **`toggleRodeoField` mismo patrón** (`rodeo-config.ts:138-160`): `count:'exact'`, count=0 → error,
  no falso OK.

- **`enableNonDefaultField` es INSERT** (`rodeo-config.ts:168-178`): si la RLS bloquea, supabase-js
  devuelve `error` (no count=0 silencioso) → `ok:false`. Correcto.

- **`role` no es manipulable client-side**: viene de `user_roles` (server) vía el join RLS-protegido
  de `EstablishmentContext`. No se inyecta desde input del usuario.

### 3. Fuga de datos / PII en logs — PASS

- **Cero `console.*` en los 7 archivos en foco** (grep sobre rodeos.ts, rodeo-config.ts,
  rodeo-store.ts, RodeoContext.tsx, crear-rodeo.tsx, editar-plantilla.tsx, rodeo-template.ts: sin
  matches). No se loguea nada.

- **`rodeo-store.ts`** persiste solo un UUID de rodeo (no PII), por `(userId, establishmentId)`
  saneando la key (`:15-21`), web→localStorage / native→SecureStore (igual patrón que
  establishment-store). Best-effort con `try/catch` que no propaga el valor. Correcto.

### 4. Gate de navegación — PASS

- **El empty-state de rodeo NO introduce bypass.** `_layout.tsx:262-289`: el chequeo de rodeo corre
  DESPUÉS del gating de establecimiento, SOLO en `est.status === 'active'`. En
  `rodeo.status === 'loading'` mantiene el splash (`:266-270`, no afirma bloqueo ni muestra (tabs) a
  ciegas). En `no_rodeos` fuerza `/crear-rodeo` y solo deja pasar esa ruta (`:271-276`), bloqueando
  (tabs)/mis-campos. No deja ver (tabs) sin rodeo.

- **El orden de gates no abre hueco de spec 01.** auth → emailVerified → token de invitación →
  establecimiento → rodeo (`:192-289`). El gate de rodeo está anidado dentro del de
  establecimiento `active`, así que no puede ejecutarse sin un campo activo válido (sin sobre qué
  rodeo decidir). Los destinos de rodeo (`rodeos`/`crear-rodeo`/`editar-plantilla`) se excluyen del
  de-stranding (`:282-287`) solo cuando ya hay rodeo activo — no relajan el bloqueo total.

- **Scope por campo activo + recarga en switch.** `RodeoContext.tsx:96-136`: deps PRIMITIVAS
  (`userId`, `establishmentId`), `loadSeq` guard (`:108,112,116`) descarta resultados de una carga
  vieja si cambió el campo en vuelo (switch rápido). Sin campo activo queda en `loading` y no
  fetcha (`:98-107`). No mezcla rodeos entre campos.

- **Fallo de red al cargar rodeos NO produce falso bloqueo total.** `RodeoContext.tsx:117-127`: ante
  error de fetch deja `loading` + error reintentable (no afirma `no_rodeos`). El RootGate mantiene
  splash. Correcto (un falso `no_rodeos` mandaría a crear-rodeo sin necesidad, no es un hueco de
  seguridad pero el manejo es el correcto).

### 5. Otros HIGH client-side — ninguno

- `rodeo-template.ts` es lógica pura (sin red, sin estado mutable compartido); el diff
  (`computeConfigDiff`/`computeEditDiff`) ignora `required` y no emite DELETE (`:281,271`). Sin
  superficie de ataque.
- Sin `dangerouslySetInnerHTML`, `eval`, deep-link sin validar que dispare navegación privilegiada,
  ni secretos hardcodeados en el diff.

---

## False positives descartados (para trazabilidad)

- **"Race en `createRodeo` por diff de set podría atribuir el rodeo equivocado"** — descartado como
  finding de seguridad. Si dos creates concurren en el MISMO campo por el MISMO usuario, a lo sumo
  el caller abre/edita su propio rodeo recién creado; no cruza tenant ni escala privilegios (el
  usuario ya es owner del campo). Es un edge de corrección/UX, no de security. Fuera de scope de
  este gate.

- **`establishment_id` "se pasa como argumento a `createRodeo`/`fetchRodeos`"** — no es
  attacker-controlled: el único productor es `estState.current.id` (RLS-derivado). No hay ruta donde
  el usuario inyecte un id arbitrario, y aunque lo hiciera, la RLS (`is_owner_of` para insert,
  `has_role_in` para select) es la barrera real. Patrón correcto, no finding.

---

## Observaciones LOW (no bloquean — anexo)

- **Mensaje de error crudo de Postgres/PostgREST mostrado al usuario** —
  `crear-rodeo.tsx:190` (`result.error.message`), `rodeos.tsx:85`, `editar-plantilla.tsx:127`.
  `classifyError` (`rodeos.ts:24-30`, `rodeo-config.ts:26-32`) solo customiza el copy para
  `kind:'network'`; para `kind:'unknown'` deja el `message` crudo del backend, que puede contener
  texto interno (nombre de constraint, mensaje del trigger `invalid species/system combination`,
  etc.). Impacto bajo: es un cliente (el usuario ya ve la respuesta de red en su propio device), no
  un endpoint server; no es attacker-controlled ni cruza tenant. Es UX/defense-in-depth, no un hueco
  explotable. Sugerencia (no bloqueante): mapear `kind:'unknown'` a un copy genérico salvo los
  errores de negocio que el caller quiera mostrar explícitamente.

---

## Archivos analizados

- `app/src/services/rodeos.ts`
- `app/src/services/rodeo-config.ts`
- `app/src/services/rodeo-store.ts`
- `app/src/contexts/RodeoContext.tsx`
- `app/app/crear-rodeo.tsx`
- `app/app/rodeos.tsx`
- `app/app/editar-plantilla.tsx`
- `app/app/_layout.tsx` (gate de rodeo)
- `app/src/utils/rodeo-template.ts`

Cross-referenciados (no en scope, para verificar derivación de contexto / barrera RLS):
`app/src/contexts/EstablishmentContext.tsx`, `app/src/utils/establishment.ts`,
`supabase/migrations/0017_rodeos.sql`.

---

## Cobertura: qué cubrió la skill vs. revisión manual RAFAQ

- **Skill Sentry `security-review`**: cargada (authorization/IDOR + data-protection refs). Su
  metodología (trazar data flow + verificar exploitability antes de reportar) se aplicó a cada
  punto. La skill apunta a patrones server-side clásicos (SQLi, XSS, SSRF) que no aplican a este
  diff (cliente RN + supabase-js, sin SQL crudo ni HTML inyectable).
- **Cobertura indirecta / revisión manual RAFAQ**: el modelo multi-tenant de RAFAQ (RLS de Supabase
  como barrera real + cliente que NO debe eludirla) lo verifiqué a mano contra la RLS de 0017 y la
  derivación de `establishment_id`/`role` desde los contexts — la skill no modela RLS de Postgres.
  PowerSync: no aplica (C1 usa supabase-js directo, PowerSync diferido a C5). BLE: no aplica a este
  diff.
