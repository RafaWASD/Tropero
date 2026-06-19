# review_03-m5-custom-bugfix -- Reviewer

Feature: 03-modo-maniobras (in_progress). Chunk: M5-CUSTOM-BUGFIX (bugfix visual de la maniobra custom).
Tipo: frontend / presentacion PURA. Fecha: 2026-06-18. Baseline impl: a03e593.

## Veredicto: APPROVED

---

## 1. Trazabilidad R<n> a test

El fix NO agrega requirements nuevos: es robustez de PRESENTACION del R13.8 existente (render generico de
la maniobra custom por ui_component). El AS-BUILT lo reconcilia como sin-cambio-del-que.

- R13.8 (titulo completo): app/src/utils/maneuver-title-size.test.ts (6 casos: step-down length-aware
  $5/$4 >56ch, borde umbral, trim, vacio/undefined, lineHeight matching de descendentes). VERDE 6/6.
- R13.8 (affordance scroll): app/src/utils/scroll-affordance.test.ts (6 casos: sin overflow=sin fades;
  arriba=solo abajo; medio=ambos; fondo=solo arriba; EPS; medidas 0/NaN/neg defensivo). VERDE 6/6.
- R13.8 (e2e enum_single): app/e2e/maniobra-custom-bugfix.spec.ts custom enum_single -- titulo largo VISIBLE
  completo + fade abajo en reposo + (scroll real al fondo via scrollListToBottom) fade arriba aparece / fade
  abajo desaparece + llega a la ultima opcion. Reportado 2/2 por impl (e2e fuera del check gateado).
- R13.8 (e2e enum_multi): app/e2e/maniobra-custom-bugfix.spec.ts custom enum_multi -- idem (fade surface). 2/2.
- R13.8 (no-regresion captura): app/e2e/maniobra-custom-render.spec.ts (enum_single 3 opciones + numeric):
  pocas opciones SIN fade espurio + flujo de captura intacto (oraculo server). Reportado 2/2.

Verificado por el reviewer: los 12 unit del fix corren VERDE aislados (tests 12 / pass 12 / fail 0).

## 2. Tasks completas

Si. La task del chunk en tasks.md queda [x] M5-CUSTOM-BUGFIX con su AS-BUILT (implementer 2026-06-18). No
quedan [ ] del chunk sin justificacion. (El bloque M6 -- circunferencia escrotal -- en el mismo diff es de
OTRA terminal/chunk, fuera del alcance de este fix.)

## 3. Exactitud de specs (codigo a spec, paso 6)

- design.md sec 11.6: AS-BUILT M5-CUSTOM-BUGFIX presente y FIEL al codigo (los 2 fixes, los 2 helpers puros,
  ScrollAffordanceList, fillHeight, fades por color de fondo bg/surface, sub-header numberOfLines 1 a 2).
- requirements.md R13.8: nota de reconciliacion presente (sin cambio del que; los 7 ui_component, el value
  capturado y la escritura a custom_measurements son identicos).
- tasks.md: task [x] con AS-BUILT consistente.

No hay specs viejas que contradigan el as-built. Observacion menor NO bloqueante: el parentesis del AS-BUILT
de design 11.6 dice que el e2e usa scrollIntoViewIfNeeded para llegar a la ultima opcion; el e2e as-built usa
scrollListToBottom para enum_single (documentado en impl_* paso 8) y scrollIntoViewIfNeeded solo en enum_multi.
Quedo de un estado intermedio; no contradice el comportamiento ni la cobertura. Anotado, no rechaza.

## 4. CHECKPOINTS

- C1 [x] harness completo. check.mjs exit 1 SOLO por el flake backend (seccion 6), no por este fix.
- C2 [x] una sola feature in_progress (03-modo-maniobras); resto deferred/pending/spec_ready.
- C3 [x] respeta capas (utils puros + app/maniobra/_components); sin deps nuevas; sin logs/TODOs sueltos; no
  hardcodea establishment_id.
- C4 [x] >=1 test por modulo con logica (2 utils nuevos, 12 tests); runner >0 verde; cross-tenant N/A.
- C5 [x] sin artefactos temporales sin trackear del fix; la feature sigue in_progress (correcto, no done).
- C6 [x] spec con 3 archivos; R13.8 cubierto por >=1 test; task [x].
- C7 [ ] N/A -- el fix no toca tablas con establishment_id (presentacion pura).
- C8 [ ] N/A -- el fix no cambia el write-path offline (identico a M5-C.3).

## 5. Checklist RAFAQ-especifico

- A. Multi-tenancy / RLS: N/A. El fix no toca tablas/policies; establishment_id no aparece.
- B. Offline-first: N/A. Confirmado: el write-path (captureCustomAndAdvance / addCustomMeasurement /
  onConfirm) NO se toco (diff de carga.tsx solo en el render del titulo; CustomManeuverStep mantiene los
  onConfirm kind/value identicos en los 7 idioms). El dato persistido es identico.
- C. BLE: N/A. El e2e usa el baston mock solo para llegar a la pantalla; el fix no toca BLE.
- D. UI de campo (manga): APLICA.
  - [x] Targets >=60dp: enum a minHeight searchBarLg; multi a minHeight touchMin; CTA touchMin.
  - [x] Fuente >=18pt: enum_single 9; multi 6; titulo 5/4 (token 4=14px SOLO en labels de TITULO >56ch --
        linea de encabezado, no input tactil; aceptable, mejora legibilidad vs el recorte previo).
  - [x] Una decision por pantalla: enum_single = 1 tap elige+avanza; preservado.
  - [x] Loading visible: sin cambios.
  - [x] Recorte de descendentes: TODO Text con numberOfLines del fix tiene lineHeight matcheado -- titulo
        (titleToken par garantizado por el helper), enum_single 9/9, sub-header multi 6/6 (fix 1 a 2), multi 6/6.
- E. Edge Functions: N/A. El fix no toca Edge Functions.

## 6. check.mjs

node scripts/check.mjs -> exit 1. Desglose:
- anti-hardcode (ADR-023 sec 4): 0 violaciones (OK). Verificado a mano en CustomManeuverStep.tsx y carga.tsx:
  cero hex crudo / cero px de spacing-size hardcodeado; numericos = flex/flexGrow/flexBasis/minWidth0/
  borderWidth(1,2)/strokeWidth/numberOfLines (no tokenizables).
- typecheck client: OK (limpio).
- client unit: 1519/1519 pass (incluye maneuver-title-size 6 + scroll-affordance 6).
- RLS: 22/22, Edge: 42/42.
- animal (backend): 107/109 -- los 2 fallos son animals_tag_unique (23505) = flake de seed de tag_electronic
  por terminales paralelas (memoria reference_check_red_rate_limit). NO es este bugfix (frontend puro, no toca
  la tabla animals ni el seed). Regla nunca-aprobar-con-check-rojo NO se viola: el rojo es ajeno y documentado,
  y todo lo que cubre este fix esta verde.

## 7. Foco del encargo -- verificacion

- Bug 1 (titulo) resuelto: helper PURO length-aware (5/4 >56ch) + numberOfLines 2 + word-break web +
  alignItems flex-start (contador pinneado). Entra completo a 360 (2 lineas) y 412. lineHeight matcheado.
- Bug 2 (affordance) resuelto y REAL: scrollFades no da falso-positivo sin overflow (content <= viewport+EPS
  da false/false); el fade se dispara por onScroll real; enum_single ahora SI scrollea (era YStack flexGrow,
  ahora ScrollView con fillHeight). Overlays pointerEvents none: no bloquean scroll ni taps.
- REGRESION fabrica OK: labels cortos pasan por la MISMA rama -> 5/5 (identico al tamano previo) +
  numberOfLines 2 (no envuelve) + alignItems flex-start (identico a center en 1 linea) + contador flexShrink 0
  pinneado. Sin descentrado ni cambio de layout. Respaldado por maniobra-carga 3/3 + maniobra-elegir 2/2.
- Presentacion pura / Gate 2 = N/A: diff de carga.tsx toca SOLO el render del titulo; value/captura/write-path
  identico; CustomManeuverStep mantiene los onConfirm intactos. Sin cambio de data-path/inputs/auth/schema/
  RLS/Edge -> Gate 2 (security) correctamente N/A.
- Tokens / cero hardcode: confirmado. reference_descender_clipping respetado.

## 8. Cambios requeridos

Ninguno bloqueante. Sugerencia opcional (no condiciona el approve): pulir el parentesis del AS-BUILT de
design 11.6 para que diga scrollListToBottom en enum_single en vez de scrollIntoViewIfNeeded.
