# Review — 03-modo-maniobras / M6-C.2 — Tarjeta de tendencia de CE + CE en el timeline (R14.14)

Reviewer: reviewer (Opus). Fecha: 2026-06-18. Baseline HEAD a03e593 (M6-C.1 + M6-C.2 en working-tree, no commiteados).

## Veredicto: APPROVED

Frontend puro, display read-only. Gate 2 = N/A RATIFICADO. R14.14 cubierto entero; no-regresion de utils compartidos probada; specs reconciliadas; check.mjs verde salvo el flake ambiental animals_tag_unique.

## Trazabilidad R14.14 a test (cada parte con >=1 test)

- Serie cm+edad+fecha es-AR: ScrotalTrendSection/ScrotalSeriesRow (animal/[id].tsx:1970,2123), describeScrotalTimeline/formatAgeMonthsAR (event-timeline.ts:967,979). Tests: event-timeline.test.ts:1164 (formatAgeMonthsAR), :1174 (describeScrotalTimeline 36,5 cm . 24 meses / edad null -> solo cm); e2e ficha-circunferencia-escrotal.spec.ts:84-89 (38 cm / 35,5 cm / 32 cm + 30 meses, coma decimal es-AR).
- Mini-tendencia: ScrotalSparkline (animal/[id].tsx:2002, barras con tokens, sin lib). e2e capturas ficha-ce-tarjeta-{360,412}.png (:93,96); serie larga 7 barras (:149).
- CE en el timeline: kind scrotal (event-timeline.ts:32), scrotalRowsToTimelineItems (:516), composedTimeline (animal/[id].tsx:281), TimelineEvent case scrotal (TimelineEvent.tsx:143). Tests: event-timeline.test.ts:1180 (mapeo), :1213 (sortTimelineItems merge CE+server dia desc); e2e :101-104 (nodo riel 38 cm . 30 meses + titulo Historial).
- Solo machos enteros: isBullEntire (maneuver-applicability.ts:73); gate carga (animal/[id].tsx:199) + render null-guard (:749). Tests: maneuver-applicability.test.ts:260,268 (torito/toro/null->true; hembra/ternero/novillo/castrado/sin-cat->false), :279 (paridad EXACTA isBullEntire vs appliesToAnimal sobre matriz {torito,toro,novillo,novillito,ternero,vaquillona,vaca_multipara,null} x {true,false,null}); e2e hembra :182 + castrado con CE historica :212 (toHaveCount 0).
- date-only: isDateOnlyKind scrotal (event-timeline.ts:52). Test :1160.
- CE no contamina estado actual: CurrentStateSection recibe timeline no-compuesto (:743); HistorySection recibe composedTimeline (:764). Test :1240 (deriveCurrentState ignora la CE).

Trazabilidad completa: unit + e2e (4/4).

## NO-REGRESION en utils compartidos (foco principal)

(a) sortTimelineItems extraido de parseTimeline NO cambia el orden. parseTimeline ahora hace return sortTimelineItems(items) (event-timeline.ts:399); comparador (dia desc -> createdAt desc -> seq desc -> eventId) IDENTICO al previo. Unico delta: copia (spread) vs mutar-en-sitio, sobre array local a parseTimeline -> ningun caller ve diferencia. Tests previos de orden (event-timeline.test.ts:256,271,315,342,352,372,405) siguen verdes -> riel server ordena igual.

(b) isBullEntire extraido byte-equivalente al predicado de CE. appliesToAnimal case circunferencia_escrotal llama isBullEntire(categoryCode,isCastrated) (:123) = categoryCode!=null && BULL_ENTIRE_CATEGORY_CODES.has(categoryCode) && isCastrated!==true, la misma expresion inline de M6-C.1. Test de paridad EXACTA (maneuver-applicability.test.ts:279) barre categoria x castracion: cubre {torito,toro} + castrado (novillo/novillito/toro+castrado=true) + null. El gate display no puede divergir de la aplicabilidad.

## Display
- Ausente en hembra/ternero/castrado: scrotalHistory null si no isBullEntire (:204); render scrotalHistory!=null ? card : null (:749). e2e toHaveCount 0.
- Serie larga peek/fade: ScrotalSeriesList capea a 4 filas + 0,5 peek + scrollFades (:2058-2098). e2e toro 7 CE: la mas vieja 30 cm reachable por scrollIntoViewIfNeeded (:152).
- Titulo sin recorte: CE fontSize 6 lineHeight 6 (:2145); empty 5/5 (:1980); titulo de card via DetailSection. Capturas verificadas por el implementer.
- es-AR coma decimal: formatCmWithUnitAR/formatCmAR (:2146); e2e prueba 35,5 cm.

## Tokens / CERO hardcode
- Solo tokens (primary/greenLight/surface/divider/card/textMuted/1..6) + getTokenValue para el icono lucide. Geometria del sparkline (CHART_H/CHART_MIN_H/FADE_H/ROW_H) decorativa, no token de spacing. Anti-hardcode ADR-023 sec 4: 0 violaciones.
- Sin hardcode de establishment_id: fetchScrotalHistory(profileId) parametriza por profileId; RLS + frontera WAL son la barrera.

## Tasks completas: SI
Todas las tasks de M6 en [x] (M6-B.1..B.5, M6-C.0..C.2). M6-C.2 [x] (tasks.md:519) con AS-BUILT fiel al codigo. Ninguna [ ] pendiente.

## Exactitud de specs (codigo -> spec): OK
- design.md sec 12.6 (1681-1685): nota AS-BUILT M6-C.2 (opcion a composicion en cliente, sortTimelineItems extraido, isBullEntire reusado, ScrotalTrendSection sparkline/peek/fade, Gate 2 N/A) coincide con el codigo.
- requirements.md R14.14 NO se toco; se cumple tal cual. Sin contradiccion.
- El refactor DRY appliesToAnimal -> isBullEntire esta documentado con paridad probada. El design no quedo mintiendo.

## Gate 2 (security code) = N/A — RATIFICADO
Display read-only. No introduce data-path/write/input/RPC/auth/schema. Lee el historico LOCAL (fetchScrotalHistory de C.1, parametrizada por profileId) de scrotal_measurements, ya gateada por RLS server-side (R14.15) + frontera WAL ev_scrotal_measurements scope establishment (R14.16) — Gate 1 PASS + M6-BACKEND Gate 2 PASS + suite scrotal 12/12 verde. isBullEntire es UX, no seguridad (la RLS de la lectura es la barrera). Sin hardcode de tenant. El diff no agrega superficie de seguridad -> N/A correcto.

## CHECKPOINTS
- C1: [x] archivos/docs/agentes; [ ] check.mjs exit 0 (exit 1 SOLO por el flake animals_tag_unique 23505, suite backend spec-02, terminales paralelas; typecheck+anti-hardcode+1559 unit+RLS 22+Edge 42 verdes).
- C2: [x] una feature in_progress (03); [x] current.md describe la sesion.
- C3: [x] capas previstas; [x] sin deps nuevas; [x] sin logs/TODOs sueltos; [x] no hardcode establishment_id.
- C4: [x] test por modulo; [x] fixtures reales; [x] runner >0 verde (1559 + e2e 4/4); [x] RLS cross-tenant (suite scrotal backend).
- C5: [~] la cierra el leader; M6-C.2 in_progress, no marcada done.
- C6: [x] 3 archivos; [x] EARS; [x] tasks [x]; [x] cada R14.x con >=1 test.
- C7: [x] scrotal_measurements con establishment_id + RLS (M6-BACKEND); [x] helpers canonicos; [x] test cross-tenant (suite scrotal). M6-C.2 read-only sobre esa barrera.
- C8: [x] lectura del SQLite local (no request sincrono); [x] bucket ev_scrotal_measurements scope establishment; conflict resolution N/A (no escribe).

## Checklist RAFAQ-especifico
- A (RLS/multi-tenancy): N/A (display read-only; la tabla y su RLS las creo M6-BACKEND). isBullEntire no es barrera de seguridad.
- B (offline-first): [x] funciona offline (SQLite local via fetchScrotalHistory); [x] bucket scoped por establishment; conflict resolution N/A (no escribe); [x] no hace requests sincronos a Supabase (usa el repo local).
- C (BLE): N/A.
- D (UI de campo): la ficha es consulta, no manga; [x] fuente legible (CE 6, sub 3); [x] loading/empty visible (empty calido, sin parpadeo). Botones >=60dp N/A (display sin acciones).
- E (Edge Functions): N/A.

## Cambios requeridos
Ninguno.

## Nota
check.mjs exit 1 por el flake animals_tag_unique en supabase/tests/animal/run.cjs:1881 (colision del tag_electronic global-unique entre terminales paralelas contra la DB compartida). NO toca codigo de M6-C.2 (frontend display). El resto del check (typecheck client, anti-hardcode 0, 1559 client unit incl +12 de M6-C.2, RLS 22/22, Edge 42/42) VERDE. Rojo ambiental, no regresion.
