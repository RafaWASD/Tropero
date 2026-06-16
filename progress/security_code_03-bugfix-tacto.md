# security_code_03-bugfix-tacto — Gate 2 (security code, modo `code`, ADR-019)

> Bugfix del tacto (spec 03, MODO MANIOBRAS): exact-match en la identificación manual + fail-closed del
> guardado de maniobra + banner de error + helper de inyección de fallos e2e-only. **Frontend puro**.
> Skill: `sentry-skills:security-review` (cargó error-handling + business-logic + JS/TS).

## VEREDICTO: **PASS**

0 findings HIGH-confidence. 0 RAFAQ-SPECIFIC. El punto a confirmar (gating del e2e-fault) quedó confirmado
como INERTE en prod, mismo patrón y threat-model que `ble-e2e-flag.ts` (ya vetado por Gate 2).

---

## Baseline / archivos analizados

- `baseline_commit` (de `progress/impl_03-bugfix-tacto.md`): `638679fa61672e884fc75b3ae94a855bf9853642`.
- Trabajamos sobre `main` (no feature-branches) → diff `baseline..HEAD` + working tree.
- El diff del baseline arrastra todo spec 03; el **ALCANCE de este Gate** son SOLO los 5 archivos del bugfix
  (leídos en su totalidad), per el prompt del leader:
  1. `app/src/utils/maniobra-identify.ts` (`resolveManualIdentify` + `isExactMatch`, 239 líneas).
  2. `app/app/maniobra/identificar.tsx` (`onPickCandidate`, ruteo `found`/`ambiguous`, 873 líneas).
  3. `app/app/maniobra/_components/CandidatePicker.tsx` (copy 1-candidato, 226 líneas).
  4. `app/app/maniobra/carga.tsx` (`captureAndAdvance` fail-closed + `ManeuverErrorBanner`, 728 líneas).
  5. `app/app/maniobra/_components/maneuver-e2e-fault.ts` (**NUEVO**, 37 líneas).

## Findings HIGH de Sentry

Ninguno. "No high-confidence vulnerabilities identified."

## Findings RAFAQ-SPECIFIC

Ninguno.

---

## Verificación por foco (lo que se trazó + por qué pasa)

### Foco 1 (PRIMARIO) — `maneuver-e2e-fault.ts`: gating del inyector de fallos → INERTE en prod

El mecanismo fuerza un fallo del write LOCAL de una maniobra para tener una red de seguridad e2e del camino
de error. **Confirmado seguro:**

- **Único escritor** de `window.__RAFAQ_MANEUVER_FAULT__`: el e2e spec via Playwright `page.evaluate`
  (`app/e2e/maniobra-tacto-bugfix.spec.ts:169`). Grep sobre `app/src` + `app/app` → **cero** asignaciones a la
  global fuera del doc-comment del propio módulo. Ninguna ruta de UI, deep-link, `URLSearchParams`,
  `localStorage` ni input de usuario la escribe.
- **Guard estricto** (`maneuver-e2e-fault.ts:28`): `g[FAULT_GLOBAL_KEY] !== true` (igualdad estricta a `true`,
  no truthy) → no se dispara por strings/objetos accidentales. Sin la global → `consumeManeuverPersistFault()`
  devuelve `false` → **cero efecto** en dev/prod. El consumidor (`carga.tsx:347`) sólo entra al path de fallo
  si la marca está armada.
- **Mismo patrón que `ble-e2e-flag.ts`** (`app/app/_components/ble-e2e-flag.ts`, vetado por Gate 2): flag
  global deliberado que sólo Playwright pone; sin NODE_ENV/__DEV__ extra, igual que el precedente aprobado.
- **El módulo SE compila al bundle** (visto en `app/dist/.../entry-*.js:16014`) — esperado e **inocuo**: es
  inerte sin la global. No es un finding (el código muerto/inerte no se reporta).
- **Threat-model**: aun si un atacante setea la global en SU PROPIO runtime (lo cual ya implica control de su
  propia consola JS), el único efecto es que SU PRÓXIMA captura falle UNA vez — la marca se **autodesarma**
  (`maneuver-e2e-fault.ts:30`). NO abre ningún path de seguridad, NO cruza tenant, NO persiste nada, NO afecta
  a otros usuarios. Es self-DoS de un solo intento sobre el propio cliente → **no explotable**.

### Foco 2 — exact-match (`resolveManualIdentify` / `isExactMatch`)

- `isExactMatch` (`maniobra-identify.ts:159-163`) exige igualdad NORMALIZADA (trim + lowercase) contra
  `idv`, `visualIdAlt` o `tagElectronic`, con guard `t.length === 0 → false`. Un candidato SIN campos de
  display nunca matchea exacto → cae a `ambiguous` (estado seguro, no auto-carga).
- Único candidato NO-exacto (substring) → `ambiguous` → `CandidatePicker` → el operario CONFIRMA con un tap
  (`onPickCandidate`, `identificar.tsx:304`). El picker **no auto-elige**. → no hay bypass que auto-cargue una
  caravana ajena (el bug "otra caravana" queda cerrado).
- Los candidatos vienen de `searchAnimals(establishmentId, trimmed)` (`identificar.tsx:179`) ya scopeado al
  campo activo + RLS/sync-stream (auditado en M2.1-edge). El flash de confirmación muestra la caravana del
  animal ELEGIDO, no el texto tecleado (`identificar.tsx:312-319`) → sin confusión.

### Foco 3 — banner de error (`ManeuverErrorBanner`, info-disclosure)

- `error.detail` superficia `res.error.message` / `err.message` del write **LOCAL** (SQLite via PowerSync) o
  un throw del SDK (`carga.tsx:337,367,392`). Es el motor de persistencia LOCAL — no contiene secretos server,
  no cruza tenant. Patrón ya conocido/aceptado (backlog `local-query.ts`).
- Se renderiza en el propio dispositivo del operario AUTENTICADO; **no** se manda a ningún sink remoto
  (Sentry/analytics/red). → no es info-disclosure explotable.

### Foco 4 — `captureAndAdvance` fail-closed

- TODOS los caminos de fallo → `setCaptureError(...)` + `return` SIN avanzar y SIN `setCaptured`:
  soft-delete de huérfanos `!del.ok` (`carga.tsx:336-339`), fault inyectado (347-350), persist `!res.ok`
  (366-369), throw del `catch` (388-392). `capturingRef` se libera en `finally` (393-395) → el reintento
  procede. → **fail-closed correcto**: ningún path abre en fallo, no hay IDOR/cambio de tenant.
- El rechazo ASÍNCRONO de sync server-side (gating capa 2 / tenant-check) NO llega acá (el write local ya
  devolvió ok) → lo maneja `uploadData` + el canal de status (fuera de scope de este diff).

### Foco 5 — secrets

Cero hardcode en los 5 archivos (sin keys, tokens ni service-role).

---

## False positives descartados

Ninguno: la skill no levantó findings sobre estos archivos (frontend puro, sin query/authz/SSRF/crypto).

## Tabla de inputs (campos que el usuario tipea, tocados por el diff)

| campo | límite | validación (server / solo-cliente / ausente) | OK? |
|---|---|---|---|
| texto manual de búsqueda (`onManualSearch`) | `trim()` + scoped a `searchAnimals(establishmentId,…)` | server-side: el match autoritativo es el lookup local scopeado al campo activo (RLS/sync); el `isExactMatch` es lógica pura de RUTEO (no de seguridad) | sí — no se concatena en `.or()/ilike` crudo desde este diff; el search-path autoritativo se auditó en M2.1-edge |

> El diff del bugfix NO agrega formularios ni campos nuevos de texto libre: reusa el search ya existente y
> sólo cambia la DECISIÓN sobre su resultado (exacto → found / resto → picker). Sin superficie de input nueva.

## Tabla de rate limits (acciones abusables tocadas por el diff)

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| guardar maniobra (`captureAndAdvance`) | n.a. | n.a. | sí | write CRUD-plano LOCAL offline; sin endpoint server nuevo. `capturingRef` evita doble-tap. El push a server lo hace PowerSync `uploadData` (no tocado). |
| búsqueda manual (`onManualSearch`) | n.a. | n.a. | n.a. | lectura LOCAL del SQLite (offline), sin pegada a server ni API externa. |

> Ninguna acción del diff abre un endpoint server nuevo ni manda email/SMS/API-externa → no requiere rate
> limit propio. Sin cambios a `[auth.rate_limit]` de `config.toml`.

## Dominios revisados (catálogo RAFAQ)

- **B1 (info-disclosure en respuestas)** → revisado, banner = mensaje local, no server (Foco 3).
- **E (abuso/DoS)** → revisado, fault e2e-only es self-DoS de 1 intento, no explotable (Foco 1); guard de
  doble-tap (`capturingRef`) presente.
- **Business-logic / fail-closed** → revisado, `captureAndAdvance` no abre path en fallo (Foco 4).
- **Inputs (F1 PostgREST filter injection)** → revisado, el diff no agrega input nuevo ni concatena texto en
  `.or()/.filter()/ilike`; el search-path se auditó en M2.1-edge.

## Dominios excluidos (con justificación)

- **A (service-role bypass / mass assignment / IDOR), Edge Functions, RLS policies, triggers, schema** —
  N/A: frontend puro, el diff NO toca backend (verificado por el implementer: binding del tacto idéntico en
  capa1↔capa2, sin migración). Gate 1 N/A para este bugfix.
- **C (PowerSync sync rules / Realtime / data-at-rest)** — no tocado por el diff.
- **D (secrets/supply-chain), F2/F3 (import/SSRF), G (BLE), H (auth/sesión), I (compliance)** — fuera del
  alcance de los 5 archivos.

## Cobertura indirecta de Deno / RLS / PowerSync

Sin Deno ni RLS en el diff (frontend). El write local pasa por PowerSync `uploadData` (no tocado por este
bugfix) — su tenant-check server-side es el de spec 03 ya auditado en gates previos (M2.1-edge / M3.x). Este
Gate cubre la lógica de UI del bugfix; la frontera de tenant real vive en el upload + RLS, no en estos archivos.

## Estado de verificación

- `node scripts/check.mjs` → RC del run (flake de rate-limit/auth de Supabase por terminales paralelas NO es
  finding, per memoria `reference_check_red_rate_limit`). No es regresión ni hueco de seguridad.

## NO marco done — la decisión final es de Raf (Puerta de código humana).
