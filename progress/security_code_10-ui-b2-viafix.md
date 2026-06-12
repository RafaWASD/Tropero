# Security re-gateo (modo code, delta) — spec 10 UI-B2 fix-loop: VIA-ENUM-MISMATCH

> Re-chequeo PUNTUAL del fix del finding HIGH del Gate 2 anterior (`progress/security_code_10-ui-b2.md`,
> veredicto FAIL). Baseline: `b1bd0a0` (todo el chunk UI-B2 + el fix viven sin commitear en el working
> tree). Reporte del fix: `progress/impl_10-ui-b2-viafix.md`. Fecha: 2026-06-12.
> Alcance acotado al delta del fix — NO se re-auditó el chunk entero (ya gateado, resto del reporte
> anterior sigue vigente).

## Veredicto: PASS — el fix CIERRA el finding HIGH VIA-ENUM-MISMATCH

`sanitary_events.route` ya NO puede recibir texto libre desde la vacunación masiva: el único productor
del valor es un selector de chips cerrado sobre los 5 códigos del enum, y `toRouteValue()` actúa de
barrera dura (cualquier cosa fuera del enum → `null`) justo antes de entregar el valor al service.
Cadena completa re-trazada hasta el INSERT: no queda ningún path de texto libre. El `22P02` → descarte
permanente de la op → pérdida de datos del happy path queda eliminado por construcción.

---

## 1. `route` SOLO manda enum-válido o `null` — VERIFICADO

Cadena completa (re-trazada archivo por archivo):

1. **Estado**: `app/app/vacunacion-masiva.tsx:88` — `useState<SanitaryRoute | null>(null)`. El
   `FormField` (TextInput) de "Vía" NO existe más; `ROUTE_MAX` borrado (grep en `app/`: cero hits).
2. **Único productor**: los chips (`:338-347`) iteran `routeOptions()` (solo los 5 códigos del enum) y
   llaman `toggleRoute(opt.code)` (`:201-203`), que setea el código o `null` (toggle de deselección).
   `setRoute` aparece SOLO en el `useState` y en `toggleRoute` — no hay otro escritor (ni params de
   ruta, ni texto, ni deep-link).
3. **Barrera dura**: `onConfirm` (`:228`) manda `route: toRouteValue(route)` a `applyBulkVaccination`.
   `toRouteValue` (`app/src/utils/sanitary-route.ts:55-57`) = `isValidRoute(x) ? x : null` — todo lo
   que no sea uno de los 5 códigos exactos (case-sensitive, lowercase) se normaliza a `null`, nunca
   pasa el string crudo.
4. **Downstream sin transformación**: `applyBulkVaccination` (`bulk-operations.ts:118-139`) →
   `planVaccination` (`bulk-operations-plan.ts:93-107`, `params.route ?? null`) →
   `buildAddVaccinationInsert` (`local-reads.ts:1168-1182`, placeholder `?` parametrizado). Ningún
   punto re-introduce ni altera el valor.
5. **Único caller**: grep de `applyBulkVaccination` en `app/` — el único caller de app es
   `vacunacion-masiva.tsx:226`. No hay otro path que alimente `route` en una masiva.

Los 5 códigos de `SANITARY_ROUTES` (`sanitary-route.ts:18-24`) son EXACTAMENTE el enum
`public.sanitary_route` verificado contra la fuente (`supabase/migrations/0027_sanitary_events.sql:5`):
`intramuscular | subcutaneous | oral | topical | other`. Columna `route` nullable (`0027:16`) → `null`
es válido (vía opcional respetada).

## 2. Anti-drift — VERIFICADO

- `sanitary-route.ts:10-15`: nota ANTI-DRIFT explícita anclando al enum de 0027.
- `sanitary-route.test.ts:17-23`: el test pinea `ENUM_0027` como **oráculo independiente** del módulo
  (copia propia en el test, no importa SANITARY_ROUTES para compararse consigo mismo) y asserta
  igualdad exacta sin sobra ni falta. Asserta además que `intravenous` (que existe en `humanizeRoute`
  de event-timeline pero NO en `sanitary_route`) es inválido, y el invariante completo de
  `toRouteValue` (texto libre es-AR, case, tilde, no-strings, `''`, `null`, `undefined` → `null`).
- Registrado en `scripts/run-tests.mjs:53`. **Corrido en este re-gateo: 6/6 pass.**
- Límite honesto del anti-drift: es una copia pineada, no un parse de la migración — si una migración
  futura ALTERa el enum, la detección depende de que el autor siga la nota (ver Anexo LOW). Cumple lo
  que el fix recomendado pedía.

## 3. No se rompió nada más — VERIFICADO

Lectura completa de `vacunacion-masiva.tsx` post-fix contra lo gateado en el reporte anterior:
- **Producto**: intacto — `FormField` con `maxLength={PRODUCT_NAME_MAX}` (=80, `:62,330`), obligatorio
  (trim no vacío, `:206-208`). El CHECK server autoritativo (≤160, `0070`) no se tocó (cero migraciones
  nuevas en el diff). Cliente 80 ≤ server 160 ✓.
- **Filtro categoría/sexo**: intacto (chips cerrados derivados de datos locales, `:148-165,186-198`).
- **Preview/confirm/progreso**: intactos (`previewVaccination` recalcula en vivo, confirmación
  explícita, `BulkProgressPanel`). El INSERT sigue parametrizado, con whitelist de columnas, sin
  `created_by`/establishment del cliente. RLS + gating capa 2 (0054) sin cambios.
- Diff del fix acotado a: `sanitary-route.ts` + test (nuevos), bloque de vía en `vacunacion-masiva.tsx`,
  capture e2e (assert de chips), `run-tests.mjs`, screenshot, reconciliación de specs. Consistente con
  `impl_10-ui-b2-viafix.md`.

## 4. Ningún otro campo de las masivas manda texto libre a columna enum/constrained — VERIFICADO

Auditados los builders de las masivas en `local-reads.ts`:

| Builder | Campos del usuario | Columna destino | OK? |
|---|---|---|---|
| `buildAddVaccinationInsert` (1168) | `product_name` (texto libre legítimo → `text` + CHECK ≤160); `route` → **ahora enum-o-null** | `text` / enum | ✅ |
| `buildAddWeaningInsert` (1191) | ninguno (`event_type='weaning'` literal; `event_date`/`created_at` generados, no tipeados) | — | ✅ |
| `buildSetCastratedUpdate` (1218) | ninguno (literales 0/1) | — | ✅ |
| `buildSetFutureBullUpdate` (1241) | ninguno (boolean → 0/1) | — | ✅ |
| `buildAddObservationInsert` (1139) | `text` → columna `text` `notes`-style (libre legítimo; en castración masiva viene de la constante `OBSERVATION_CASTRATED`, no del usuario) | `text` | ✅ |

El único free-text→enum era la vía. Cerrado.

## Tabla de INPUTS (delta)

| Campo | Límite cliente | Validación server | OK? |
|---|---|---|---|
| **Vía** (`route`) | Selector cerrado (5 chips del enum) + barrera `toRouteValue` (enum-o-null) — texto libre IMPOSIBLE | Enum `sanitary_route` (0027) — autoritativa; el cliente ahora solo genera valores que la pasan | ✅ **CIERRA VIA-ENUM-MISMATCH** |
| Producto (`product_name`) | Sin cambios (maxLength 80) | Sin cambios (CHECK ≤160 + not null) | ✅ (ya gateado) |

## Tabla de RATE LIMITS

Sin cambios en el delta (el fix no toca encolado ni endpoints). Vigente lo del reporte anterior:
tope de N por masiva queda como deuda LOW compartida de spec 10.

## Archivos analizados

- `app/src/utils/sanitary-route.ts` (nuevo) + `sanitary-route.test.ts` (nuevo, corrido: 6/6)
- `app/app/vacunacion-masiva.tsx` (completo, post-fix)
- `app/src/services/bulk-operations.ts` (`applyBulkVaccination`, trace)
- `app/src/utils/bulk-operations-plan.ts` (`planVaccination`/`VaccinationParams`, trace)
- `app/src/services/powersync/local-reads.ts` (builders de las masivas, re-auditoría punto 4)
- `supabase/migrations/0027_sanitary_events.sql` (enum fuente, re-verificado)
- `scripts/run-tests.mjs` (registro del test)

## Skill de Sentry

NO re-corrida sobre el delta: el fix es 100% client-side RN/TS puro (un util de validación + chips),
sin superficie nueva de injection/XSS/secrets/SSRF; el dominio del finding (contrato cliente↔enum DB)
es RAFAQ-specific y se verificó a mano contra la migración (la skill no cubre Postgres/PowerSync —
misma cobertura indirecta declarada en el gate anterior).

## Anexo LOW (no bloquea — backlog)

1. **Anti-drift por copia, no por parse**: `sanitary-route.test.ts` pinea el enum como copia. Hardening
   opcional: que el test lea `0027_sanitary_events.sql` y extraiga los valores del `create type` por
   regex — detectaría un `ALTER TYPE` futuro sin depender de la disciplina del autor de la migración.
2. **Fixtures con valor hoy-imposible**: `bulk-operations-plan.test.ts:64` y `local-reads.test.ts:1187`
   pasan `'subcutánea'` (texto libre) por la plomería agnóstica. No es bug (testean la plomería, no el
   app-path, y la firma `route: string | null` es deliberadamente agnóstica), pero modelan un valor que
   el app ya no puede producir y que la DB rechazaría — cosmético, alinear cuando se toquen esos tests.
3. **Tensión `$chipMin` 40px vs ≥44px** (flageada por el implementer, punto 8 de su autorrevisión): es
   decisión de DISEÑO (token global, consistencia con los chips adyacentes), no de seguridad — fuera de
   alcance de este gate; queda para el leader/Raf.
