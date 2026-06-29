# Security Review (code) — correcciones-fase1

**Modo**: `code` (Gate 2, ADR-019)
**Baseline**: `48b75ac` — diff = working tree vs HEAD (`git diff 48b75ac`)
**Fecha**: 2026-06-29
**Veredicto**: **PASS** (0 HIGH, 0 RAFAQ-SPECIFIC)

## Contexto

Batch de 3 correcciones Nivel A (ADR-028) sobre features `done`, todas de UI/formato:
1. Copy "KPIs"→"Datos" en la sección reproductiva de reportes.
2. Reordenar el catálogo estático de dientes (`TEETH_OPTIONS`) gastada→joven (FIX #12).
3. Display de CE en la ficha: remover el sparkline de barras + cambiar el formateador de edad puro a años tras 24m (FIX #11).

Sin schema, RLS, Edge Functions, RPC, auth, ni input nuevo de usuario.

## Archivos analizados (solo código de app; docs/specs excluidos)

- `app/app/(tabs)/reportes.tsx` — 2 strings de copy (label de spinner + texto de empty-state). Sin cambio de lógica/datos.
- `app/app/animal/[id].tsx` — se eliminó el componente `ScrotalSparkline` y la constante de geometría; se cambió `formatAgeMonthsAR`→`formatAgeYearsAR` en `ScrotalSeriesRow`; se agregó `lineHeight="$3"` a un `<Text>`. Display read-only.
- `app/src/utils/teeth-options.ts` — reordenado del array literal `TEETH_OPTIONS`. `value` (enum DB) y `label` idénticos; `cutTrigger` se sigue derivando de `CUT_PROMPT_TEETH.has(value)` por opción → la lógica CUT no cambia, solo el orden de presentación.
- `app/src/utils/animal-category-fields.ts` — idéntico reordenamiento del `TEETH_OPTIONS` del selector de alta. Solo orden visual.
- `app/src/utils/event-timeline.ts` — `formatAgeMonthsAR` renombrado a `formatAgeYearsAR` y extendido (años tras 24m). Función pura `number|null|undefined → string|null`. `describeScrotalTimeline` ahora la usa.
- Tests (`*.test.ts`) y `e2e/ficha-circunferencia-escrotal.spec.ts` — actualizan expectativas al nuevo formato/orden. No se evalúan como superficie de seguridad (skill regla "Do Not Flag: test files").

## Findings HIGH de Sentry (security-review)

Ninguno. "No high-confidence vulnerabilities identified."

Skill corrida sobre el diff. Trace de data flow + verificación de explotabilidad:
- El diff **no agrega ninguna superficie de datos**: scan de líneas agregadas por `createAdminClient | service_role | .or( | .filter( | select( | ilike | dangerouslySetInnerHTML | console.log | Deno.env | fetch( | api_key | password | secret | token` → único match es la palabra "token" dentro de un comentario sobre *design tokens* de Tamagui (false positive léxico).
- React Native `<Text>{string}</Text>` escapa el contenido por default; no hay `dangerouslySetInnerHTML`/`v-html`. Las dos strings de copy nuevas son constantes hardcodeadas (no atacante-controladas).

## Findings RAFAQ-SPECIFIC

Ninguno.

Checklist RAFAQ aplicado al diff:
- **Cross-tenant / queries de display**: el diff NO toca ninguna query. La serie de CE la sigue trayendo `buildScrotalHistoryQuery`/`fetchScrotalHistory` (sin cambios), que ya estaba scopeada y testeada en spec 03. La remoción del sparkline solo deja de *dibujar* datos que el componente ya recibía — no agrega ni amplía el fetch. Sin leak.
- **Formateador de edad con input adversarial** (`formatAgeYearsAR`): traza segura.
  - `null`/`undefined`/`NaN`/`±Infinity` → `null` (guard `months == null || !Number.isFinite`). La fila omite la edad. OK.
  - Negativo (ej. `-5`) → `"-5 meses"`: string raro pero sin crash, sin injection, sin XSS (es texto en `<Text>`). Cosmético, no de seguridad. El dato `ageMonths` es un snapshot server-side, no atacante-controlado.
  - Enorme (ej. `1e20`) → string largo, O(1), sin DoS ni overflow explotable.
  - No hay vector de inyección: la salida es una string renderizada como texto.
- **Reorden de `TEETH_OPTIONS`**: cambia solo el orden de presentación. `value` (enum `teeth_state_enum`) y `cutTrigger` (derivado de `CUT_PROMPT_TEETH` por value) intactos → no altera ni el valor persistido ni la lógica de CUT (R6.8). No es superficie de seguridad.
- **Mass assignment / IDOR / service-role / err.message crudo**: no aplica — el diff no toca writes, FKs, admin-client ni respuestas de error.

## False positives descartados (skill)

- "token" en `app/app/animal/[id].tsx` (comentario `lineHeight … del token`) — refiere a un *design token* de Tamagui, no a un secreto/credencial. Descartado.

## Tabla de inputs

| campo | límite | validación | OK? |
|---|---|---|---|
| (ninguno) | — | — | — |

El diff no agrega ni modifica ningún campo que el usuario tipee (form / buscador / texto libre / prompt). `formatAgeYearsAR` consume un `ageMonths` numérico de un snapshot persistido server-side, no input de usuario.

## Tabla de rate limits

| acción | rate limit | keyeo | fail-closed? | nota |
|---|---|---|---|---|
| (ninguna) | n.a. | — | — | El diff no toca acciones abusables (sin Edge Functions, email/SMS, API externa, bulk/import ni buscadores). |

## Cobertura indirecta de Deno / RLS / PowerSync / BLE

No aplica a este diff: no se tocó código Deno (Edge Functions), policies RLS, sync rules de PowerSync ni BLE. La skill de Sentry no cubre esos dominios, pero como el diff no los toca, no hay gap de cobertura. Revisión manual del resto del checklist RAFAQ: completa, sin findings.

## Conclusión

Superficie = frontend display puro, sin frontera de datos nueva. La skill no reporta HIGH y la revisión manual RAFAQ tampoco. **PASS**.
