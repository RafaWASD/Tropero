baseline_commit: f41749ea8ca9555dad711a89db7c9aec383fcadf

# Delta-fix F — Recorte del "%" en las KPI cards (ADR-028, Nivel A, frontend puro)

Bug F del triage `docs/correcciones-demo-facundo-padre-2026-07-10.md`. Gate 1 N/A (sin backend, sin superficie de seguridad). En Reportes, el valor grande de la KPI card (ej. "89,1 %") se RECORTABA con ellipsis "…" en anchos angostos porque `adjustsFontSizeToFit` es NO-OP en react-native-web (memoria `reference_rn_web_pitfalls`): en vez de encoger, TRUNCA.

## Plan (una sola task, delta chico)
- T1: eliminar el recorte del valor de la KpiCard garantizando no-truncado a 320/360/412 px, conservando coma decimal es-AR y la jerarquía (número = héroe). + test unit + reconciliar capturas Gate 2.5.

## Solución elegida y por qué

**Separar el "%" como sufijo más chico al lado del número (patrón de UIs financieras) + tamaño length-aware sobre el NÚMERO (sin la unidad).** El caller sigue pasando el valor con el "%" pegado (`formatPercentAR` → "84,6 %"); el KpiCard lo separa con la nueva función pura `splitKpiValue` y renderiza:
- el **número** GRANDE (héroe) — `$10`=38px si el número tiene ≤3 chars ("100","50","—"), `$9`=30px si tiene 4+ ("84,6","150,5"),
- el **"%"** al lado, más chico (`$6`=18px) y en `$textMuted` (unidad secundaria), baseline-aligned (`alignItems="baseline"`, mismo patrón que ya usa `ReportSectionHeader` en el archivo).

### Por qué esta y no las otras
No confié en estimaciones de ancho: **medí el render real** con Playwright cargando Inter con el MISMO faux-bold de la web build (el peso `800` no tiene face cargada — el `_layout.tsx` sólo carga 400/500/600/700 — así que el navegador lo sintetiza y ENSANCHA los glifos; por eso truncaba peor de lo que sugería la métrica ingenua). Ancho útil de texto de la MEDIA card (2-por-fila): ≈98px @320 / 118px @360 / 144px @412. Resultados clave:

| valor | pegado @ $9=30px | pegado @ $10=38px | SPLIT (nº + "%" $6) |
|---|---|---|---|
| "84,6 %" | **101px → TRUNCA @320** | 128px → trunca @320/360 | nº "84,6" $9 + "%" = **84px → entra @320** |
| "100 %" | 88px | **111px → trunca @320** | nº "100" $10 + "%" = **84px → entra @320** |
| "89,1 %" | 93px | 117px → trunca @320 | 75px → entra @320 |

- **Bajar todo a un bucket $8 (23px)** también entraba, pero deja el número en 23px: héroe débil y muy dispar cuando la card vecina muestra "50 %" a 38px. La separación mantiene el número en 30-38px (héroe fuerte) → mejor jerarquía, que es lo que pide el objetivo.
- **2ª línea (`numberOfLines={2}`)**: funciona pero rompe "89,1"/"%" en dos renglones (pierde jerarquía y crece la card). No hizo falta: con el split TODO entra en 1 línea a 320/360/412 (ver tabla), así que se mantiene 1 línea como pide el objetivo.
- **Reducir gap/padding**: gana pocos px, no alcanzaba solo. No lo toqué (menos riesgo de layout).
- **NO toqué `formatPercentAR`** (sigue devolviendo "84,6 %") → cero ruptura de `calvingCardView`/`weaningCardView`, del slot `detail`, ni de los tests de reports-format que asertan el string "84,6 %". El split vive 100% en el rendering.
- **NO toqué `reportes.tsx`** (layout intacto: destete sigue full-width; preñez|parición 2-por-fila). El fix es enteramente KpiCard + reports-format.

## Anchos garantizados sin recorte (verificado por medición real, faux-bold)
Para TODOS los valores reales que pasan por KpiCard (todos son `%` vía `formatPercentAR`; no pasa ningún "kg"):
- **2-por-fila (Preñez | Parición, 0-100%)**: "0 %", "8 %", "50 %", "88 %", "100 %", "8,3 %", "89,1 %", "84,6 %" → grupo número+"%" ≤ 84px < **98px @320** (margen ≥14px), y con más aire a 360/412.
- **Destete full-width (puede >100% por mellizos)**: "150 %", "200 %", "150,5 %", "108,7 %" → ancho útil ≈248px @320 → entran holgadísimos.
- **Muted "—"**: sin "%", número $10 muted, 38px < 98px.

Garantizo **no-recorte a 320 / 360 / 412 px**.

## Archivos tocados
- `app/src/utils/reports-format.ts` — nueva fn pura `splitKpiValue(value)` (separa número + "%"); `kpiValueFontToken` ahora decide por la longitud del NÚMERO (≤3 → $10, 4+ → $9), no del string completo. Comentario del módulo reescrito con las mediciones.
- `app/src/components/reports/KpiCard.tsx` — el valor hero se renderiza en un `XStack alignItems="baseline"`: número (length-aware, `$textPrimary`/muted) + "%" chico (`$6`, `$textMuted`). Header/JSDoc actualizados.
- `app/src/utils/reports-format.test.ts` — +2 tests de `splitKpiValue` (con/sin decimal; sin "%" → percent=null; defensivo "385,5 kg" no se parte); test de `kpiValueFontToken` actualizado a la lógica por número (los casos previos siguen dando el mismo token → sin regresión de aserción).
- `app/e2e/captures/destete-kpi.capture.ts` + `app/e2e/captures/paricion-fix.capture.ts` — **reconciliación**: 4 aserciones `getByText('NN %', exact)` rompían porque ahora el valor son DOS Text nodes ("NN" y "%") sin espacio literal entre medio. Cambiadas a asertar el número (único por pantalla: preñez=89,1 / parición=82,6 / destete=87/60,9) + presencia de "%". Sin cambiar los screenshots (los `shot(...)` quedan igual; el leader re-captura en Gate 2.5).

## Trazabilidad (objetivo → test)
- Objetivo "el valor NO se recorta, separando el % y bajando el nº largo" → `splitKpiValue: separa el número de la unidad "%"` + `splitKpiValue: valor sin "%" → entero, percent=null` + `kpiValueFontToken: número ≤3 chars → $10; 4+ chars → $9` en `app/src/utils/reports-format.test.ts`.
- No-recorte visual real → mediciones Playwright faux-bold (arriba) + capturas del leader a 320/360/412 en Gate 2.5 (deliverable del leader por instrucción de la task).

## Autorrevisión adversarial (qué busqué / encontré / cerré)
1. **Tests que rompen por el split (2 Text nodes)** — ENCONTRADO: 4 aserciones `getByText('87 %'/'60,9 %'/'82,6 %'/'65,2 %', exact)` en las capturas de Gate 2.5 (el `textContent` del grupo es "87%" sin espacio, y los spans son "87" y "%" por separado → el match exacto con espacio no matchea). CERRADO: reconciliadas a asertar el número (verifiqué que "89,1"/"82,6"/"87"/"60,9" son únicos en cada pantalla del spike, sin colisión con detail/footnote/cards vecinas) + "%".
2. **Otros consumidores de `getByText('… %')`** — buscado en todo `e2e/` y `src/`: los únicos matches de `%`/decimales son `score-display` (condición corporal) y CE ("35,5 cm"/"38,5 cm"), componentes DISTINTOS que no usan KpiCard/splitKpiValue → intactos. `reportes-spike.capture.ts` sólo asserta labels ("Preñez"/"Parición"), no valores → intacto.
3. **Regex de `splitKpiValue`** (`/^(.*\S)\s*%$/` sobre `value.trim()`): probado "84,6 %"/"100 %"/"0 %"/"200 %"/"150,5 %" → número correcto; "—"/""/"385,5 kg" → percent=null (no parte lo que no es "%"); "%" suelto → no matchea (no ocurre). Trailing spaces tolerados (trim previo).
4. **Recorte de descendentes**: número = dígitos/coma/guion (sin descendentes) con `lineHeight` matcheado al token ($9/$10); "%" sin descendente. Sin recorte.
5. **`—` muted**: número "—" (len 1 → $10) muted, sin span "%" espurio (percent=null). Igual que antes.
6. **Baseline align en native**: `alignItems="baseline"` ya se usa en `ReportSectionHeader` del mismo módulo → soportado; el veto real es web (captures) que es donde medí.
7. **Casing de notes/leyendas** (commit dae1233): NO toqué ningún `note`/`legend` ni `calvingCardView`/`weaningCardView`. Sin reintroducir minúsculas.
8. **Multi-tenant / offline-first**: N/A — cambio puramente de presentación, sin datos ni red.

## Reconciliación de specs
No hay `specs/active/<feature>/` para este delta-fix (bug de triage, Nivel A, sin spec formal). La documentación as-built vive en este archivo + en los comentarios del código. El triage (`docs/correcciones-demo-facundo-padre-2026-07-10.md` §F) queda como el requerimiento; la solución elegida (separar "%") es una de las opciones que listaba. Las 4 capturas reconciliadas quedan consistentes con el render nuevo.

## Verificación
- `pnpm run typecheck` → **exit 0** (e2e está excluido del tsconfig; las capturas se validan en Gate 2.5).
- Reports unit suite (`app/src/utils/reports-format.test.ts`) → **54/54 pass**.
- NO corrí `node scripts/check.mjs` completo ni `e2e:build` (por instrucción de la task; el render de capturas a 320/360/412 lo hace el leader en Gate 2.5).
- NO `git add` / NO commit (por instrucción de la task).
