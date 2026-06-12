# Security review (modo code) — spec 10 UI fixes Raf (gating por candidatos + optimismo en ficha)

- **Fecha**: 2026-06-12
- **Baseline**: `1a1dc83003b8febec297e4ce6e0424ba40f6e86c` (cambios sin commitear en working tree)
- **Input**: `progress/impl_10-ui-fixes-raf.md` + diff working-tree vs baseline
- **Skill**: `sentry-skills:security-review` corrida sobre el diff (metodología: trace data flow + exploitability)

## Veredicto: **PASS**

Sin delta de seguridad. Frontend puro: gating de DISPLAY + estado local optimista. Cero writes nuevos, cero
migraciones, cero Edge Functions, cero cambios en `config.toml`/rate limits. Los 4 puntos del mandato del
leader verificados, todos OK.

## Verificación punto por punto (mandato del leader)

### 1. El gating es solo DISPLAY, no autorización — CONFIRMADO
- `applyCandidateGating` (`app/src/utils/group-actions.ts`) y `fetchRodeoGroupActions`/`fetchLoteGroupActions`
  (`app/src/services/group-data.ts`) solo deciden qué botón se RENDERIZA (`GroupViewScreen.tsx:95`:
  `{actions && (actions.vaccinate || actions.wean || actions.castrate) ? ...}`).
- No se introdujo ninguna decisión de autorización client-side: las mutaciones reales (`applyBulkCastration`,
  `applyBulkWeaning`, `applyBulkVaccination`, `setCastrated`, `setFutureBull`, `deleteTypedEvent`,
  `assignAnimalToGroup`) NO aparecen en el diff — siguen as-built, con la autorización server-side (RLS) intacta.
- **Mejora colateral (positiva)**: el fallback de los loaders pasó de fail-open parcial
  (`castrate: true` si fallaba el gating) a **fail-closed total** (`{ castrate: false, vaccinate: false,
  wean: false }` en `rodeo/[id].tsx:62` y `lote/[id].tsx:71`). Es display igual, pero la postura es más
  conservadora que el baseline.

### 2. Queries de candidatos scopeadas y parametrizadas — CONFIRMADO
- `buildGroupCandidateFlagsQuery` (`app/src/services/powersync/local-reads.ts:1342-1358`): SQL con
  placeholders `?` + `args: [...profileIds]` — **parametrizada**, sin concatenación de input.
- Los `profileIds` vienen de la lista del grupo ya cargada (`fetchAnimals(establishmentId, { rodeoId, ... })`,
  scopeada por establishment activo), no de input tipeado por el usuario.
- Las lecturas son contra el **mirror SQLite local de PowerSync**, que solo contiene los datos sincronizados
  del tenant (sync rules) — no hay camino cross-tenant desde el cliente por estas queries.
- `fetchRodeoConfigGating(rodeoId)` reusa `fetchRodeoGating` existente (por rodeoId, local) — config-only,
  sin superficie nueva.

### 3. El optimismo es estado LOCAL, sin writes nuevos — CONFIRMADO
- `animal/[id].tsx`: los patches optimistas son `setDetail((d) => ...)` / `setTimeline((tl) => ...)` —
  estado React local. No se manda ninguna columna al server desde código nuevo (nada de `establishment_id`,
  `author_id`, etc.).
- La única llamada NUEVA en el flujo es `previewCastrationCategory` (`app/src/services/animals.ts:1073`):
  **read-only** sobre el SQLite local (espejo C6), parametrizada, usada solo para anticipar la categoría en
  el patch optimista. Blanda: si falla, no anticipa.
- Los writes reales siguen siendo los as-built ya gateados: `setCastrated`, `setFutureBull`,
  `deleteTypedEvent`, `assignAnimalToGroup` — sin cambios en el diff.
- `load({ silent: true })` es el mismo `load` (reads) sin togglear `loading` — no agrega requests nuevos.

### 4. Revert seguro, sin re-emitir writes — CONFIRMADO
- Snapshot tomado ANTES del patch (`const snapshot = detail` / `= timeline`), y el revert es
  `setDetail(snapshot)` / `setTimeline(snapshot ?? null)` — restauración de estado local pura.
  Ningún camino de revert emite una mutación.
- En silent-refresh, un fallo transitorio NO blanquea ni dispara reintentos automáticos (sin loop de writes).

## Findings de la skill `sentry-skills:security-review`
**Ninguno HIGH-confidence.** El diff no contiene sinks de inyección (las queries SQLite locales están
parametrizadas), no hay XSS (React Native, sin `dangerouslySetInnerHTML`/`v-html`), no hay secrets, no hay
fetch a URLs influenciadas por usuario, no hay deserialización.

## Findings RAFAQ-SPECIFIC
**Ninguno.** Catálogo recorrido contra el diff: A (no hay admin-client, ni `.insert(body)`/`.update(body)`,
ni FKs nuevas), B1 (sin `err.message` nuevo hacia el usuario — ver false positives), C (lecturas locales son
el patrón existente; sin sync rules ni Realtime tocados), D (sin secrets ni imports nuevos), E (queries
batched sobre la lista ya cargada del grupo, acotada por naturaleza; sin endpoint nuevo), F/G/H (no aplica:
sin ingesta, BLE ni auth tocados).

## False positives descartados (trazabilidad)
1. **`r.error.message` mostrado en la UI** (`animal/[id].tsx`, varias acciones): patrón PRE-EXISTENTE (el
   diff solo lo re-indenta/mueve). Son errores de servicios locales del cliente mostrados al MISMO usuario
   en su propio dispositivo — no cruza trust boundary. No es delta de este cambio. (El tema general de
   mensajes de error crudos server-side está trackeado aparte como B1 en EFs — no aplica acá.)
2. **`page.evaluate` en `e2e/helpers/ui.ts` (`readMaxScrollTop`)**: código de test E2E con script constante
   (sin input externo). Fuera de scope per skill ("do not flag test files").
3. **Interpolación de `placeholders` en el SQL de `buildGroupCandidateFlagsQuery`**: lo interpolado es la
   cadena `'?, ?, ...'` generada por código (constantes), los VALORES van por `args`. Parametrización correcta.

## Tabla de inputs
| campo | límite | validación | OK? |
|---|---|---|---|
| — (el diff no agrega ni modifica ningún campo tipeable por el usuario: ni forms, ni buscadores, ni texto libre, ni prompts) | n/a | n/a | ✅ n/a |

## Tabla de rate limits
| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| — (sin acciones abusables nuevas: no hay EF nueva, no hay email/SMS/API externa, no hay bulk endpoint nuevo; los writes bulk existentes no se tocaron) | n.a. | n.a. | n.a. | El gating por candidatos es display-only; el fan-out de las masivas sigue as-built |

## Archivos analizados
- `app/src/utils/group-actions.ts` (+ `.test.ts`)
- `app/src/services/group-data.ts`
- `app/src/services/powersync/local-reads.ts` (solo `buildGroupCandidateFlagsQuery`, reusada — verificación de parametrización)
- `app/src/services/animals.ts` (solo `previewCastrationCategory`, reusada — verificación read-only)
- `app/src/components/GroupViewScreen.tsx`
- `app/app/animal/[id].tsx`, `app/app/rodeo/[id].tsx`, `app/app/lote/[id].tsx`
- `app/app/seleccion-masiva.tsx`, `app/app/vacunacion-masiva.tsx`
- `app/e2e/helpers/ui.ts`, `app/e2e/operaciones-{castracion,destete,vacunacion}.spec.ts` (test code, no flaggeable)
- (committed en el rango pero no-código: `docs/backlog.md`, `docs/conventions.md`, specs de la 10)

## Cobertura indirecta
- **RLS / Edge Functions / Deno**: no tocados por este diff → sin cobertura necesaria. La autorización de
  los writes existentes depende de las RLS as-built (gate verde en los reviews previos de spec 10).
- **PowerSync sync rules**: no tocadas. Las lecturas locales nuevas asumen el scoping de las sync rules
  existentes (correcto para este diff; el dominio C1 sigue pendiente de auditoría cuando se reabra sync).

## MED/LOW → backlog
Ninguno surgido de este diff.
