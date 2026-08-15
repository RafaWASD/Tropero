baseline_commit: c84014dd4a036871c802772f4736431b26c8017d

# impl 23 · request_id / operationId end-to-end — SLICE FRONTEND (tests unit + typecheck)

> Slice de FRONTEND de la feature 23. El backend (`supabase/**`) está en
> `impl_23-request-id-correlation-backend.md`. La implementación del cliente (T11–T18) la hicieron
> chunks previos de esta misma corrida frontend; **este archivo cubre la sub-slice de TESTS UNIT PUROS +
> TYPECHECK** (T19 + T23 + registro en el runner). NO cubre E2E ni capturas (T25–T28, otro paso) ni las
> tareas DB-gated (T29–T32).
>
> Baseline = `c84014dd`. HEAD == baseline: toda la feature 23 (backend + frontend) vive en el working
> tree, sin commitear. El diff del Gate 2 se calcula desde ese SHA.

## Alcance de esta sub-slice

- **T19** — `app/src/utils/request-id.test.ts` (NUEVO): `newRequestId()` devuelve string con forma de uuid
  y dos llamadas devuelven ids distintos. Cubre R1.1, R1.2.
- **T23** — `app/src/services/observability/payloads.test.ts` (EXTENSIÓN): `buildUploadRejectedPayload`
  ahora incluye `id` (= `op.id`) ADEMÁS de table/op/code, y sigue SIN `opData` ni ninguna clave extra del
  CrudEntry (mutante falsificable). Cubre R4.3, R5.6.
- **Registro** — `scripts/run-tests.mjs`: `request-id.test.ts` agregado a la lista explícita del bloque
  `client unit tests`, adyacente a los tests de observability.
- **T24 (fix-loop reviewer)** — tag `request_id` por-captura de Sentry (R4.1/R4.4). As-built: se extrajo el armado
  del `tags` de `captureExceptionSafe` a un builder PURO `buildCaptureTags({ mechanism, requestId })` en
  `payloads.ts` (consistente con R4.3, «en payloads.ts se centraliza … donde hay builder puro se extiende»);
  `sentry.native.ts` lo consume (`buildCaptureTags(hint)` → `{ tags }` de esa `Sentry.captureException`, sin
  `setTag` global). 3 tests nuevos en `payloads.test.ts`: (R4.1) el tag `request_id` lleva el valor del requestId
  + `mechanism`, solo esas 2 claves; (R4.4) por-captura — una captura sin requestId NO hereda el de otra, y dos
  requestIds → objetos independientes; (R4.4) omite claves ausentes (`buildCaptureTags()`/`{}` → `{}`).
  Falsificación: mutante que deja de adjuntar `request_id` en el builder → 3 fail → revert → verde. **Límite
  anotado:** el prop `request_id` de PostHog (R4.2) lo arma el call-site inline (`captureDomainEvent(name, {
  ...props, request_id })` en `invitar.tsx`/`carga.tsx`/`useImportRodeo.ts`, `.tsx` con JSX no importables por
  node:test sin mockear el SDK), no un builder puro → se cubre por typecheck (firma) + E2E; no hay guard unit puro
  para él sin inventar andamiaje (mock de posthog). El crítico —el tag de Sentry— sí quedó falsificable.
- **Registro T24** — no hace falta bloque nuevo: los tests viven en `payloads.test.ts`, ya listado en
  `client unit tests` de `scripts/run-tests.mjs`.
- **Typecheck** — `pnpm typecheck` (tsc --noEmit) sobre todo `app/` — valida el cableado cruzado de TODA
  la feature (firmas de `captureExceptionSafe`, `invokeFn`/`serve` con requestId, props de eventos,
  `SupportCodeRow`, `REQUEST_ID_TAG`, etc.).

## Archivos frontend tocados por TODA la feature (chunks previos + esta sub-slice)

Implementación del cliente (chunks previos de la corrida frontend):
- `app/src/utils/request-id.ts` (NUEVO) — `newRequestId()` = `globalThis.crypto.randomUUID()`.
- `app/src/services/observability/payloads.ts` — `buildUploadRejectedPayload` incluye `id`; export
  `REQUEST_ID_TAG = 'request_id'`.
- `app/src/services/observability/sentry.ts` — wrapper web/stub (tag `request_id` por-captura, no global).
- `app/src/services/observability/sentry.native.ts` — `captureExceptionSafe`/`captureDomainEvent` con
  `request_id` con scope acotado a la captura (sin `setTag` global persistente, R4.4).
- `app/app/_components/SupportCodeRow.tsx` (NUEVO) — fila "Código de soporte: XXXX" + Copiar.
- `app/app/_components/RootErrorBoundary.tsx` — fallback de crash muestra el código de soporte.
- `app/app/maniobra/_components/SyncRechazoSheet.tsx` — muestra el código de soporte con el `id` de la op.
- `app/src/services/members.ts` — `invokeFn` propaga `X-Rafaq-Request-Id`.
- `app/app/invitar.tsx` — camino de invitación con requestId.
- `app/src/services/account.ts` — delete_account con requestId.
- `app/src/services/push-notifications.ts` — register_push_token con requestId.
- `app/app/maniobra/carga.tsx` — carga de maniobra con requestId en la captura.
- `app/src/hooks/useImportRodeo.ts` — import con requestId.

Sub-slice de tests (esta corrida):
- `app/src/utils/request-id.test.ts` (NUEVO) — T19.
- `app/src/services/observability/payloads.test.ts` (EXTENSIÓN) — T23.
- `scripts/run-tests.mjs` — registro de `request-id.test.ts`.

## Trazabilidad (R<n> → archivo:test)

| R<n> | Test |
|------|------|
| R1.1 (genera requestId por invocación de EF) | `app/src/utils/request-id.test.ts` → `newRequestId(): devuelve un string con forma de uuid` + `dos llamadas devuelven ids distintos` |
| R1.2 (uuid v4 random, no-PII) | `app/src/utils/request-id.test.ts` → ambos tests (regex uuid 8-4-4-4-12) |
| R4.3 (builders puros incluyen `request_id`/`id` sin PII) | `app/src/services/observability/payloads.test.ts` → `R4.1/R4.2 (+ spec 23): upload_rejected lleva SOLO {id, table, op, code} — JAMÁS opData` |
| R5.6 (incluir `id` de la op en `upload_rejected`) | `app/src/services/observability/payloads.test.ts` → mismo test (`assert.equal(payload.id, 'row-1')`) |
| R4.1 (tag `request_id` en Sentry con el valor del requestId) | `payloads.test.ts` → `R4.1 (spec 23): captureExceptionSafe adjunta el tag request_id con el valor del requestId` |
| R4.4 (tag por-captura, sin `setTag` global sticky) | `payloads.test.ts` → `R4.4 (spec 23): el request_id es POR-CAPTURA …` + `R4.4: buildCaptureTags omite las claves ausentes …` |

> T24 — el tag `request_id` por-captura de Sentry (R4.1/R4.4) quedó CUBIERTO por el fix-loop del reviewer
> vía builder puro `buildCaptureTags` en `payloads.test.ts` (SIN mockear el SDK — ver bloque «T24» del
> alcance). El prop `request_id` de PostHog (R4.2) sigue validado por typecheck + E2E (no hay builder puro:
> lo arma el call-site inline). R6.1/R6.2 (no-op web/E2E) se validan por typecheck (firmas) + E2E.

## Verificación (números exactos)

### `pnpm typecheck` (tsc --noEmit sobre `app/`)
```
> rafaq-app@0.1.0 typecheck
> tsc --noEmit
EXIT_CODE=0
```
LIMPIO — 0 errores. Valida el cableado cruzado de toda la feature 23 en el cliente.

### Unit tests (`node --test` sobre los archivos de esta sub-slice)
`request-id.test.ts` + `payloads.test.ts` + `redact.test.ts`:
```
ℹ tests 19
ℹ pass 19
ℹ fail 0
```
(2 nuevos en request-id + 6 en payloads [1 extendido] + 11 en redact = 19.)

## Autorrevisión adversarial (paso 8)

Busqué:
1. **¿Typecheck 100% limpio?** Sí — `tsc --noEmit` exit 0. Es la prueba del cableado cruzado
   (`captureExceptionSafe`, `serve`/`invokeFn` con requestId, `SupportCodeRow`, `REQUEST_ID_TAG`); si un
   chunk previo hubiera dejado una firma desalineada o un import muerto entre chunks, caía acá.
2. **¿El test de payloads FALSIFICA de verdad?** MUTANTE aplicado: inyecté
   `(out as any).opData = (op as any)?.opData;` en `buildUploadRejectedPayload` → el test cayó en ROJO
   (2 tests fallando, `actual` mostrando `opData: {peso, tag, nombre}`). Revertido y re-verificado verde.
   El test no pasa por la razón equivocada: el `deepEqual` + el barrido de substrings (`385` / EID /
   `La Vaca` / `opData`) cierran tanto la clave como los valores de campo.
3. **El `deepEqual` viejo iba a romper.** El test previo aserta `{table, op, code}` (sin `id`); con el
   `payloads.ts` as-built (que ya incluye `id`) ese assert era rojo. Lo actualicé a `{id, table, op, code}`
   con `keys.sort() === ['code','id','op','table']` — la extensión que pide T23, no un espejo.
4. **¿Imports rotos entre chunks?** Grep de `newRequestId|requestId|captureExceptionSafe|REQUEST_ID_TAG|
   SupportCodeRow` → 14 archivos, todos los de la feature + el test nuevo; typecheck resuelve todos los
   imports. No hay dead import.
5. **Import `.ts` explícito** en `request-id.test.ts` (`./request-id.ts`), igual que `payloads.test.ts`
   → lo resuelve `ts-ext-resolver.mjs` del runner. Sin él, node:test no reescribe la extensión.

## Reconciliación de specs (paso 9)

- `tasks.md`: T19 y T23 marcados `[x]` (las tasks reales de esta sub-slice).
- No hubo desvío de comportamiento respecto de `design.md`/`requirements.md`: el as-built de `payloads.ts`
  (incluir `id`) ya estaba especificado en R4.3/R5.6; el test se alineó al as-built, no al revés. Nada que
  reconciliar en los EARS.

## Fuera de alcance (otros pasos)
- T24: el tag de Sentry (R4.1/R4.4) YA quedó cubierto por el fix-loop (builder puro, sin mock). Sigue afuera
  solo el prop `request_id` de PostHog como guard unit puro (requiere mockear el SDK / importar `.tsx`) — se
  cubre por typecheck + E2E. T25–T28 (E2E + capturas, Gate 2.5).
- T29–T32 (DB-gated: audit/request_id/anti-spoof/grants) — bloqueadas por el deploy gateado de 0131.
