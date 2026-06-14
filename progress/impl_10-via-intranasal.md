baseline_commit: 6308ff5c1e806a007144d9b244a667767d0f735f

# impl — spec 10 delta VÍA-INTRANASAL (selector de vacunación = 3 vías curadas)

> Delta acotado a spec 10 (ya implementada): el selector de **Vía (opcional)** de la VACUNACIÓN MASIVA
> deja de ofrecer las 5/6 vías del enum y ofrece EXACTAMENTE 3 vías curadas de vacuna:
> **Subcutánea · Intramuscular · Intranasal**. Se AGREGA `intranasal` al enum `sanitary_route` (vía real
> de vacunas respiratorias vivas IBR/BRSV/PI3) y se quitan del SELECTOR `oral`/`topical`/`other` (NO del
> enum — el enum las conserva para desparasitación/tratamiento). Decisión de producto YA cerrada por Raf.

## Plan (T1..T7)
- T1 — Migración `0090_sanitary_route_intranasal.sql`: `add value if not exists 'intranasal'` (idempotente,
  solo ARCHIVO, NO se aplica a remoto).
- T2 — `sanitary-route.ts`: agregar `intranasal` a `SANITARY_ROUTES` (mirror del enum, ahora 6) + a
  `ROUTE_LABEL`; nuevo `VACCINE_ROUTES`/`vaccineRouteOptions()` (3 curadas); anti-drift actualizado a 0090.
- T3 — `sanitary-route.test.ts`: oráculo enum 6 valores; `routeOptions` 6 + `intranasal`; nuevo test
  `vaccineRouteOptions` (3, sin topical/oral/other, sin dups, todos isValidRoute); `isValidRoute`/
  `toRouteValue` con `intranasal` válido + topical/oral siguen válidos.
- T4 — `vacunacion-masiva.tsx`: usar `vaccineRouteOptions` en el `.map` del selector (solo eso).
- T5 — `event-timeline.ts`: `ROUTE_LABELS.intranasal = 'Intranasal'` + caso en el test de `humanizeRoute`.
- T6 — E2E capture: assert 3 chips (SC/IM/Intranasal) + ausencia de Oral/Tópica/Otra; sigue seleccionando
  "Subcutánea". `operaciones-vacunacion.spec.ts`: NO cambia (ya seleccionaba "Subcutánea", que permanece).
- T7 — Reconciliación de specs (design.md AS-BUILT UI-B2, tasks.md T-UI.6, requirements.md R4.1 as-built).

## Qué hice — DONE (esperando reviewer + re-gateo Gate 2)

### T1 — Migración `0090_sanitary_route_intranasal.sql` ✅
- Verificado: la última migración en disco era `0089_*`; NO existía `0090_*` (sin colisión con M5/otra terminal).
- Contenido EXACTO del pedido: `alter type public.sanitary_route add value if not exists 'intranasal';` +
  `notify pgrst, 'reload schema';`. Idempotente. NO usa el valor nuevo en ningún otro statement del archivo
  (PG15 permite ADD VALUE en migración sin USAR el valor en la misma transacción).
- ⚠️ NO la apliqué a la DB remota (ni `apply_migration` MCP ni `apply-migration.mjs`). Solo el ARCHIVO.
  No hay DB local levantada → no forcé verificación contra DB. El deploy lo autoriza Raf aparte.

### T2 — `sanitary-route.ts` ✅
- `SANITARY_ROUTES` ahora 6: `[subcutaneous, intramuscular, intranasal, oral, topical, other]`. Comentario
  ANTI-DRIFT actualizado: enum = 0027 + delta 0090 (`intranasal`), 6 valores.
- `ROUTE_LABEL.intranasal = 'Intranasal'`.
- NUEVO `export const VACCINE_ROUTES = ['subcutaneous','intramuscular','intranasal'] as const` + nuevo
  `vaccineRouteOptions(): RouteOption[]` (las 3 con su label). Documentado POR QUÉ es subconjunto (topical =
  pour-on antiparasitario; oral irrelevante en vacuna; other innecesario; el enum las conserva para
  desparasitación/tratamiento futuros).
- `routeOptions()` se MANTIENE (las 6 genéricas) como API para forms sanitarios NO-vacuna futuros. Doc
  aclara cuándo usar cada uno.
- `isValidRoute`/`toRouteValue` NO cambian su comportamiento: siguen operando sobre `SANITARY_ROUTES`
  COMPLETO (topical/oral/intranasal/other válidos como valor de DB; barrera anti-22P02 intacta). Solo
  actualicé el comentario para reflejar las 6 vías.

### T3 — `sanitary-route.test.ts` ✅
- Oráculo renombrado `ENUM_0027` → `ENUM_SANITARY_ROUTE` (0027 + 0090, 6 valores). Anti-drift matchea el
  enum real.
- `routeOptions`: ahora 6; assert `byCode.intranasal === 'Intranasal'`.
- NUEVO test `vaccineRouteOptions`: EXACTAMENTE 3; códigos = `[subcutaneous, intramuscular, intranasal]` en
  orden; `VACCINE_ROUTES` igual; labels Subcutánea/Intramuscular/Intranasal; NO incluye topical/oral/other;
  sin dups; todos `isValidRoute`. + test `vaccineRouteOptions ⊂ routeOptions`.
- `isValidRoute`: `intranasal` true; topical/oral SIGUEN true (son del enum). `toRouteValue`: `intranasal`
  pasa; topical/oral SIGUEN pasando; texto libre/basura → null (invariante intacto).

### T4 — `vacunacion-masiva.tsx` ✅
- Import `routeOptions` → `vaccineRouteOptions`. En el `.map` del selector de vía: `routeOptions()` →
  `vaccineRouteOptions()`. Comentario actualizado (3 vías curadas). NADA MÁS: estado `route: SanitaryRoute |
  null`, `toggleRoute`, `toRouteValue(route)` en `onConfirm` quedan idénticos. Sin import muerto
  (`routeOptions` ya no se importa acá; `vaccineRouteOptions` reemplaza).

### T5 — `event-timeline.ts` ✅
- `ROUTE_LABELS.intranasal = 'Intranasal'` (display del timeline muestra "Intranasal", no el código crudo).
- `event-timeline.test.ts`: caso `humanizeRoute('intranasal') === 'Intranasal'`.

### T6 — E2E ✅ (capture actualizado; PNG pendiente de regenerar — ver nota)
- `spec10-uib2-screenshots.capture.ts`: el assert de chips de vía pasa de 5 a 3 (SC/IM/Intranasal) + nuevo
  loop que verifica que Oral/Tópica/Otra tienen `toHaveCount(0)` (YA NO están). Sigue seleccionando
  "Subcutánea" para la captura (consistente con la captura previa; criterio: mínimo cambio de la imagen +
  Subcutánea es la vía default razonable). Header doc actualizado.
- `operaciones-vacunacion.spec.ts`: NO requirió cambios. Ya seleccionaba "Subcutánea" (que permanece en el
  subconjunto) y asserta `aria-pressed=true`; no asserta cantidad de chips ni labels excluidos.
- ⚠️ El PNG `design/spec10-ui-b2/vacunacion-preview.png` quedó STALE (muestra los 5 chips viejos). El
  `.capture.ts` es un GENERADOR MANUAL (NO `.spec.ts` → `pnpm e2e` no lo corre) y necesita dev server +
  Supabase remoto + PowerSync. NO lo regeneré porque (1) es informativo para design-review, NO gate de test;
  (2) las terminales paralelas están rate-limiteando el auth de Supabase ahora mismo (mismo flake que rompe
  el backend del check) → correr el capture fallaría por rate limit. El script YA asserta el estado nuevo
  (3 chips) → al regenerarlo en una ventana sin contención sale correcto. Anotado para el leader.

### T7 — Reconciliación de specs ✅
- `design.md` (AS-BUILT chunk UI-B2): nuevo sub-bullet **DELTA VÍA-INTRANASAL (2026-06-14)** bajo la
  pantalla T-UI.6 — 3 vías curadas vía `vaccineRouteOptions()` (NO las 6), razonamiento de producto, delta
  de enum (0090 agrega `intranasal`), por qué el enum conserva topical/oral/other, la barrera sigue sobre
  el enum completo, deploy de 0090 = prerequisito de la UI, tests. Caption de la captura actualizado (3 vías
  + ausencia de Oral/Tópica/Otra).
- `tasks.md` T-UI.6 (sigue `[x]`): nota DELTA VÍA-INTRANASAL (sin re-numerar) — `vaccineRouteOptions`,
  migración 0090, prerequisito de deploy, tests ampliados, capture.
- `requirements.md` R4.1: nota AS-BUILT (2026-06-14) — la vía de vacunación se restringe a SC/IM/Intranasal;
  el enum conserva los 6 para otros sanitary_events. Sin EARS nuevo (sub-detalle del pre-config, mismo
  criterio que el fix VIA-ENUM-MISMATCH trató la vía).

## Cadena `route → enum-o-null` (confirmada, intacta)
`chip (vaccineRouteOptions → opt.code ∈ {subcutaneous,intramuscular,intranasal})` → `toggleRoute(code)` →
`setRoute(SanitaryRoute|null)` → `onConfirm` → `toRouteValue(route)` → `applyBulkVaccination({ route })` →
`planVaccination(route ?? null)` → `buildAddVaccinationInsert(..., route, ...)` → `INSERT ... route ...`.
El ÚNICO productor de `route` es el chip (los 3 códigos curados, todos del enum) y `toRouteValue` es la
barrera dura (cualquier cosa fuera del enum → null). En ningún punto entra texto libre. `intranasal` es un
código del enum → `toRouteValue('intranasal') === 'intranasal'` → viaja al INSERT.

## ⚠️ NOTA DURA — el deploy de migración 0090 es PREREQUISITO de la UI
La UI ya puede producir `route = 'intranasal'` (chip nuevo). Pero el valor `intranasal` NO existe en el enum
`public.sanitary_route` de la DB hasta que se aplique `0090_sanitary_route_intranasal.sql`. Si la UI manda
`intranasal` ANTES del deploy, el INSERT de `sanitary_events` lo rechaza con `22P02` (invalid input value
for enum) → la CrudEntry se clasifica permanente → se descartaría la vacunación al subir (la MISMA familia
de bug que el fix VIA-ENUM-MISMATCH original). **Por eso 0090 debe deployarse ANTES de que esta UI llegue a
producción/uso.** No apliqué la migración a remoto (lo autoriza Raf). El leader debe coordinar deploy(0090)
antes (o junto) al release de este delta de UI.

## Autorrevisión adversarial (qué busqué / qué encontré / cómo cerré)
1. **¿Switch/exhaustividad sobre `SanitaryRoute` que rompa al sumar `intranasal`?** (auditado): grep de
   `switch.*route` / `case 'subcutaneous'|'topical'|'oral'` → cero switches sobre `SanitaryRoute` en el
   código de la app (los hits en `(tabs)/index.tsx` son de expo-router, otro `route`). El ÚNICO mapeo
   exhaustivo es `ROUTE_LABEL: Record<SanitaryRoute, string>` en sanitary-route.ts → lo completé con
   `intranasal` (TypeScript habría fallado si faltaba; typecheck verde lo confirma). `ROUTE_LABELS` de
   event-timeline es `Record<string, string>` (no exhaustivo) → sumé `intranasal` igual para que el timeline
   no muestre el código crudo.
2. **¿La UI puede mandar `intranasal` antes de que el enum exista en la DB?** (SÍ → documentado): es
   exactamente la familia VIA-ENUM-MISMATCH. Por eso el deploy de 0090 es prerequisito EXPLÍCITO (sección
   arriba). No es un bug del delta, es un orden de release que el leader debe respetar.
3. **¿Quedó `routeOptions` o algún import muerto?** (verificado): `routeOptions` se MANTIENE a propósito
   (API genérica de las 6 vías para forms no-vacuna futuros) con sus propios tests; ya no lo importa la
   pantalla, pero un export no-usado por el cliente no es "muerto" (es API pública con test). `vacunacion-
   masiva.tsx` importa solo `vaccineRouteOptions`/`toRouteValue`/`SanitaryRoute`; sin `routeOptions`
   colgado. Typecheck (noUnusedLocals) verde.
4. **¿El capture/e2e asserta el estado nuevo por la razón correcta?** (verificado): el capture asserta
   3 chips VISIBLES (SC/IM/Intranasal) Y `toHaveCount(0)` para Oral/Tópica/Otra — verifica tanto la
   inclusión nueva como la EXCLUSIÓN (no pasa por la razón equivocada). Renderiza el componente real (no
   mock). El `vaccineRouteOptions` test ejerce el reject (assert explícito de que topical/oral/other NO
   están) y la inclusión.
5. **¿Toqué algo fuera de scope?** (verificado): MI diff = `0090_*.sql` (nuevo) + `sanitary-route.ts` +
   `sanitary-route.test.ts` + `vacunacion-masiva.tsx` (solo import + `.map` + comentario) + `event-timeline
   .ts` (1 línea) + `event-timeline.test.ts` (1 caso) + `spec10-uib2-screenshots.capture.ts` (asserts) +
   specs 10. Los OTROS archivos modificados en el working tree (spec 03 maniobras, spec 08 sigsa,
   tamagui.config, local-reads, outbox, upload, etc.) son de OTRAS terminales/trabajo paralelo — NO los
   toqué. NO toqué producto/filtro/preview/apply/progreso de vacunación, ni `$chipMin`, ni otras pantallas.
6. **¿La barrera anti-22P02 se debilitó?** (verificado): NO. `isValidRoute`/`toRouteValue` siguen sobre el
   enum COMPLETO (6). Curé la lista OFRECIDA (display), no la lista ACEPTADA (validación de DB). topical/
   oral siguen siendo valores válidos de DB (lo asserta el test) → un evento legacy/desparasitación con
   esos valores se humaniza y persiste igual.
7. **¿`other` queda accesible para vacunación?** (decisión): NO, sale del selector de vacunación (decisión
   cerrada por Raf). Sigue en el enum y en `routeOptions()` para forms futuros. Sin pérdida de capacidad de
   DB.

## Verificación
- `cd app; pnpm.cmd typecheck` → **verde** (`tsc --noEmit` sin output).
- `sanitary-route.test.ts` + `event-timeline.test.ts` aislados (con `ts-ext-resolver`) → **97/97 pass**
  (incluye los casos nuevos: anti-drift 6 valores, `vaccineRouteOptions` 3, `isValidRoute`/`toRouteValue`
  intranasal/topical/oral, `humanizeRoute('intranasal')`).
- `node scripts/check.mjs` → la fase de cliente PASA: anti-hardcode ADR-023 §4 = **0 violaciones**;
  typecheck client OK; client unit tests (incl. `sanitary-route` + `vaccination-preview` + `event-timeline`)
  verdes. **El check sale exit 1 por un FLAKE conocido**: la suite backend `animal/run.cjs` falla con
  `Request rate limit reached` en `signIn(...)` → cliente `undefined` → cascada de `Cannot read properties
  of undefined (reading 'id'/'rpc')`. Es el flake documentado de auth de Supabase por terminales paralelas
  (ver MEMORY: "Check rojo = rate-limit"), NO una regresión: mi delta no toca NINGÚN backend/SQL/RPC (la
  migración 0090 es solo un archivo, no aplicada; el `animal` suite no tiene relación con `sanitary_route`
  ni vacunación). Confirmado el signature corriendo la suite aislada (`Request rate limit reached` +
  `undefined.id/.rpc`).

## Archivos tocados (MI delta)
NUEVOS:
- `supabase/migrations/0090_sanitary_route_intranasal.sql` (solo archivo; NO aplicado a remoto)
MODIFICADOS:
- `app/src/utils/sanitary-route.ts` (intranasal en enum mirror + ROUTE_LABEL; VACCINE_ROUTES +
  vaccineRouteOptions; anti-drift a 0090; comentarios)
- `app/src/utils/sanitary-route.test.ts` (oráculo 6 valores; routeOptions 6 + intranasal; vaccineRouteOptions
  + ⊂ routeOptions; isValidRoute/toRouteValue intranasal/topical/oral)
- `app/app/vacunacion-masiva.tsx` (SOLO: import routeOptions→vaccineRouteOptions + el `.map` del selector +
  comentario)
- `app/src/utils/event-timeline.ts` (ROUTE_LABELS.intranasal)
- `app/src/utils/event-timeline.test.ts` (humanizeRoute('intranasal'))
- `app/e2e/captures/spec10-uib2-screenshots.capture.ts` (assert 3 chips + ausencia Oral/Tópica/Otra; header)
- `specs/active/10-operaciones-rodeo/{design.md,requirements.md,tasks.md}` (reconciliación as-built del delta)
PENDIENTE (anotado, NO bloqueante para el delta de código):
- `design/spec10-ui-b2/vacunacion-preview.png` STALE (5 chips viejos) → regenerar con el capture en una
  ventana sin rate-limit de Supabase (es design-review informativo, no gate de test).

## Flags para el leader
- **Migración 0090 NO aplicada a remoto** (por diseño). **Deploy de 0090 es prerequisito** del release de
  esta UI (sin el enum, `route='intranasal'` → 22P02 → pérdida de la vacunación). Coordinar deploy antes/
  junto al release.
- **check.mjs exit 1 = FLAKE de rate-limit de Supabase** (terminales paralelas), no regresión. La fase de
  cliente (lo que toca mi delta) está toda verde. Re-correr el check en una ventana sin contención lo
  confirma.
- **PNG de design-review pendiente de regenerar** (capture ya actualizado; bloqueado por el mismo rate-limit
  ahora). No es gate de test.
- **Sin colisión de número de migración** (0089 era la última; 0090 libre).

## NO marqué nada done
No toqué `feature_list.json`. No commiteé. Espero al reviewer + re-gateo de Gate 2 (security_analyzer modo
code, baseline_commit arriba) + la decisión del leader sobre el orden de deploy de 0090.
