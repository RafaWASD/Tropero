# impl_03-m5-customfieldsheet-fix — Bugfix de diseño del sheet de CREAR maniobra/dato custom + sweep

baseline_commit: a03e593406da77096a239f7d54eb262ec1f9098f

> Feature `03-modo-maniobras` (in_progress). Chunk **M5-CLIENTE** (CustomFieldSheet, M5-C.2, ya en prod).
> Frontend PURO / presentación + cómo se superficia el error. **NO se toca backend ni `validateCustomFieldDraft`** (solo CÓMO se muestra el error y el layout). Gate 2 = N/A (sin cambio de data-path/inputs/auth/schema).

## Bug (cazado EN VIVO por Raf) — evidencia `tests/modo-maniobra/error-maniobra-custom.png`
El título "Nueva maniobra" del sheet de creación aparece **cortado por la mitad de ARRIBA** (contra el tope), y empeora cuando aparece el error "Agregá al menos una opción" porque crece el contenido y empuja todo hacia arriba.

## Causa raíz (confirmada en el código)
`app/app/maniobra/_components/CustomFieldSheet.tsx`:
- El `ScrollView` del form (≈L258) **NO tiene `flex:1`** → no absorbe el alto disponible: crece con su contenido.
- El `FormError` banner (≈L428) se inserta ENTRE el ScrollView y los botones → suma alto.
- El `YStack` del sheet tiene `maxHeight: 90%` y está anclado ABAJO (`justifyContent="flex-end"` del backdrop). Cuando el contenido supera el 90%, el clip cae sobre el **tope** (grip + título FIJO) → el título se recorta.

## Plan (T1..T6)
- [x] T1 — Helper PURO `customFieldErrorTarget(draft)` en `custom-field.ts` (mapea draft → campo culpable `'label'|'options'|null`, MISMA precedencia que `validateCustomFieldDraft` pero solo el TARGET; NO re-decide el mensaje, NO toca la validación) + 7 tests (incl. consistencia con la validación). 30/30 verdes.
- [x] T2 — FIX 1 (layout robusto): header fijo (`flexShrink:0`) + cuerpo `ScrollView flex:1 minHeight:0` + footer fijo (`flexShrink:0`). El título NUNCA se recorta. (classify step también → ScrollView flex:1.)
- [x] T3 — FIX 2 (UX de validación a nivel de campo): al tocar "Crear" inválido → `customFieldErrorTarget` da el campo → (a) `scrollTo({y})` al campo (offset capturado por onLayout, fiable en web+native), (b) borde terracota (`$terracota` token, borderWidth 2) en el input Nombre / el editor de Opciones, (c) `FieldError` inline JUSTO en ese campo. El banner `FormError` del fondo se ELIMINÓ. Error general (residual del server) → al final del cuerpo (nunca tapa el título). Limpieza al editar el campo.
- [x] T4 — FIX 3 (sweep): ver "Resultado del sweep" abajo. TOCADO: `ManeuverConfigSheet` (mismo patrón exacto → header fijo + ScrollView flex:1 + footer fijo). YA OK (no clipeable): `ExitJornadaSheet`, `NuevaJornadaConfirmSheet`, `OtherRodeoSheet`, `SavePresetSheet` (sin ScrollView/maxHeight o todo numberOfLines, contenido fijo), `SyncRechazoSheet` + `CandidatePicker` (ScrollView HARD-capped a `$candidateListMax=300`, header con numberOfLines, footer pinned → la suma máx < maxHeight → título nunca se recorta), age-sheet de `CircunferenciaEscrotalStep` (contenido fijo: grip+título+rueda+2 botones, todo numberOfLines=1).
- [x] T5 — Verificación: typecheck 0 + anti-hardcode 0 + unit verdes; capturas web táctil 360/412 (reposo + error reproducido); e2e nuevo del flujo de validación 1/1.
- [x] T6 — Autorrevisión adversarial + reconciliación design §11.6 AS-BUILT + tasks.md (entrada `[x]` M5-CUSTOMFIELDSHEET-FIX).

## Causa raíz (resumen)
El `ScrollView` del form en `CustomFieldSheet.tsx` no tenía `flex:1`, y el `FormError` era un banner ENTRE el scroll y los botones. Como el sheet ancla ABAJO (`justifyContent:"flex-end"` del backdrop) y tiene `maxHeight:90%`, cuando el contenido (form largo + banner de error) superaba el 90% el clip caía sobre el TOPE → el grip + el título se recortaban contra el borde. Aparecía/empeoraba al mostrarse el error porque el banner sumaba alto.

## Qué cambié (los 3 fixes)
- **FIX 1 — layout robusto** (`CustomFieldSheet.tsx`): HEADER FIJO (`YStack flexShrink:0`: grip + título) + CUERPO `ScrollView flex:1 + minHeight:0` (web) + FOOTER FIJO (`YStack flexShrink:0`: Crear/Cancelar). El paso `classify` también → `ScrollView flex:1`. El título nunca se recorta por más que crezca el contenido o aparezca el error.
- **FIX 2 — error a nivel de campo** (`custom-field.ts` + `CustomFieldSheet.tsx`): helper PURO nuevo `customFieldErrorTarget(draft)` (mapea draft inválido → `'label'|'options'|null`, MISMA precedencia que `validateCustomFieldDraft`, sin re-validar ni re-decidir el mensaje; un test garantiza consistencia). Al "Crear" inválido: `validate…` da el mensaje y `…ErrorTarget` el campo → (a) scroll al campo (Nombre `scrollTo({y})` con offset de onLayout; Opciones `scrollToEnd` diferido 1 frame para que el mensaje recién agregado entre a la vista), (b) borde `$terracota` (token, borderWidth 2) en el input Nombre / el editor de Opciones, (c) mensaje INLINE (`FieldError`, terracota, lineHeight matching) en ese campo. El banner `FormError` del fondo se ELIMINÓ. Error residual del server (sin target) → al final del cuerpo + scrollToEnd (nunca tapa el título). Limpieza al editar el campo. Testids: `custom-field-label-error`, `custom-field-options-editor`, `custom-field-options-error`, `custom-field-general-error`.
- **FIX 3 — sweep**: `ManeuverConfigSheet.tsx` tocado (mismo patrón → header fijo + ScrollView flex:1 + footer fijo). Ver "Resultado del sweep".

## Resultado del sweep
| Sheet | Veredicto | Acción |
|---|---|---|
| `CustomFieldSheet.tsx` | EL BUG | FIX 1+2 |
| `ManeuverConfigSheet.tsx` | Mismo patrón (ScrollView sin flex:1, maxHeight 85%, contenido —chips+input+sugerencias— puede crecer) | TOCADO (header fijo + ScrollView flex:1 + footer fijo) |
| `ExitJornadaSheet.tsx` | OK — sin ScrollView/maxHeight, contenido fijo con `numberOfLines` | sin cambio |
| `NuevaJornadaConfirmSheet.tsx` | OK — sin ScrollView, contenido fijo | sin cambio |
| `OtherRodeoSheet.tsx` | OK — sin ScrollView/maxHeight | sin cambio |
| `SavePresetSheet.tsx` | OK — sin ScrollView, contenido fijo (tiene FormError pero no clipea) | sin cambio |
| `SyncRechazoSheet.tsx` | OK — ScrollView HARD-capeado a `$candidateListMax=300`, header `numberOfLines`, footer pinned → suma máx < maxHeight → título no clipeable | sin cambio |
| `CandidatePicker.tsx` | OK — mismo cap `$candidateListMax=300`; total máx ≈500px < maxHeight 85% → título no clipeable | sin cambio |
| age-sheet en `CircunferenciaEscrotalStep.tsx` | OK — contenido fijo (grip+título+rueda alto-fijo+2 botones), todo `numberOfLines=1` | sin cambio |

## Mapa R→test (presentación; los R de comportamiento ya están cubiertos por M5-C.2/C.3)
- **Layout robusto del título (FIX 1)** → `maniobra-customfield-validacion.spec.ts::expectTitleNotClipped` (bounding-box `titleBox.y ≥ sheetBox.y` en reposo Y con el error) + capturas `customfield-{reposo,error}-{360,412}.png`.
- **`customFieldErrorTarget` (FIX 2, lógica)** → `custom-field.test.ts` (7 casos: label vacío/largo → 'label'; enum sin/invalidas opciones → 'options'; precedencia label-antes-que-options; válido → null; consistencia con `validateCustomFieldDraft`).
- **Error a nivel de campo (FIX 2, UI)** → `maniobra-customfield-validacion.spec.ts` (mensaje inline `custom-field-options-error` visible+in-viewport + editor resaltado `custom-field-options-editor` + input scrolleado a la vista + título completo con el error + limpieza al editar).
- **Sweep `ManeuverConfigSheet` (FIX 3)** → regresión `maniobra-wizard.spec.ts` (abre `maneuver-config-sheet`, captura `etapa2-sheet.png` con el título "Vacunación" completo) verde.

## Autorrevisión adversarial (qué busqué / encontré / cerré)
- **Spec drift**: ¿toqué la validación? NO — `validateCustomFieldDraft` byte-idéntico; `customFieldErrorTarget` es PURO y PRESENTACIONAL, con un test de consistencia que lo ata a la validación (no pueden divergir). El *qué* (comportamiento/contrato R13.5–R13.8) no cambió → no se reabre `requirements.md`; solo el *cómo* (design §11.6 AS-BUILT).
- **Bug de timing del scroll (ENCONTRADO + CERRADO)**: el primer intento de `scrollToEnd` corría SINCRÓNICO con el `setError` → el contentContainer todavía no había crecido con el mensaje inline → el scroll quedaba corto y el mensaje recién agregado quedaba por debajo del fondo (lo cazó el e2e: `optionsError.toBeInViewport()` falló; ver `customfield-error` antes/después). Fix: diferir el scroll 1 frame (`requestAnimationFrame`, fallback `setTimeout(0)`).
- **Error residual del server invisible (ENCONTRADO + CERRADO)**: el error general (target null) renderiza al final del cuerpo; si el body estaba scrolleado arriba, quedaba below-the-fold. Fix: `scrollToEnd` diferido también para el error general.
- **Edge: límites/duplicados de opciones (addOption)**: los errores de "max opciones / opción muy larga / ya está" ahora setean `target:'options'` (resaltan el editor) pero SIN scroll (el usuario ya está tipeando en ese input → ya está a la vista). Correcto.
- **Edge: `error!` non-null asserts** en los render sites — guardados por `labelInvalid`/`optionsInvalid` derivados de `error?.target` → `error` no-null ahí; tsc verde.
- **Edge: classify con `ScrollView flex:1` + contenido corto** — patrón flex-column-en-maxHeight estándar; con contenido corto el sheet se compacta (verificado: `maniobra-custom.spec.ts` que usa el path classify → verde). Sin regresión.
- **Recorte de descendentes** (regla dura): el `FieldError` y todos los Text con `numberOfLines` llevan `lineHeight` matching; el título conserva su `lineHeight="$7"`. Verificado visualmente a 360/412.
- **Multi-tenant / offline-first**: N/A — fix de presentación puro, no toca data-path, contexto, ni red.
- **Tests que pasan por la razón equivocada**: el e2e verifica el título-no-recortado por GEOMETRÍA (bounding-box), no por presencia del texto (el texto era visible incluso recortado a media línea en el bug original) → ejercita el path real del recorte. El `toBeInViewport()` del mensaje verifica que el auto-scroll REALMENTE lo trajo a la vista (cazó el bug de timing).

## Reconciliación de specs
- `design.md §11.6`: AS-BUILT nuevo (M5-CUSTOMFIELDSHEET-FIX) con los 3 fixes + el resultado del sweep + verificación.
- `tasks.md`: entrada `[x]` M5-CUSTOMFIELDSHEET-FIX (paralela a M5-CUSTOM-BUGFIX).
- `requirements.md`: SIN cambios (el *qué* no cambió; solo presentación).

## Gate 2
**N/A** por el alcance (presentación + cómo se superficia el error; sin cambio de data-path / inputs / auth / schema). Baseline registrado por regla del agente: `a03e593` (no hay diff de seguridad que auditar).

## FIX-LOOP scroll-360 (post-veto del leader: "a 412 perfecto; a 360 el auto-scroll se queda corto")
**Síntoma**: a 360 (NO a 412) el `scrollToEnd` diferido 1 frame para el caso Opciones quedaba CORTO → el input
de Opciones (borde terracota) + el mensaje inline caían DEBAJO del fold (below-the-fold). El operador a 360 no
veía el campo a completar — que es el punto del fix. Confirmado en `customfield-error-360.png` (pre-fix): el
scroll paraba en "Opciones (0)"/InfoNote; input+mensaje no visibles.

**Causa**: el defer FIJO de 1 frame no contempla que el mensaje inline crece el contenido DESPUÉS de que el
scroll ya corrió, y a 360 el contenido es más alto (el texto wrapea más) → el `scrollToEnd` medía un contentSize
viejo y quedaba corto. Frágil por diseño (adivinar el frame).

**Qué cambié del scroll (lo hice DETERMINISTA por geometría MEDIDA, no por defer fijo)**:
- Saqué el `scrollToEnd({defer 1 frame})` del caso Opciones y el `scrollTo({y:fieldYRef.label})` del caso Nombre.
- Nuevo modelo: capturo por `onLayout` (relativo al contentContainer) el **rect {y, height}** de CADA sección
  culpable (`label` y `options`) + el **alto del viewport** (`onLayout` de la propia ScrollView). El `onLayout`
  de la sección culpable **se re-dispara cuando el mensaje inline crece su alto** → ahí consumo el pedido de
  scroll pendiente con la geometría DEFINITIVA (post-mensaje). El scroll calcula el `y` para meter la sección
  COMPLETA (input + borde terracota + mensaje) en el viewport: si la sección entra entera → alineo su TOPE; si
  es más alta que el viewport (muchas opciones) → alineo su FONDO contra el fondo del viewport (el input+mensaje
  son lo último → siempre visibles). Independiente del ancho: se basa en alto MEDIDO, no en un defer arbitrario.
- **Determinismo en ambos caminos**: el scroll lo consume el `onLayout` post-crecimiento (camino normal); si por
  lo que sea el `onLayout` no re-dispara (alto sin cambio: la geometría ya estaba completa), un **doble-rAF de
  fallback** lo ejecuta igual con la geometría actual. Sin doble-scroll (el primero que corre nulea el pending ref).
- **Misma robustez para el error general/residual del server** (target null, renderiza al final del cuerpo): saqué
  el `scrollToEnd` con defer fijo y lo encadené a `onContentSizeChange` de la ScrollView (dispara JUSTO cuando el
  contenido crece con el mensaje) + doble-rAF de fallback. No interfiere con el scroll-al-campo (refs separados).
- `testID="custom-field-scroll"` en la ScrollView → el e2e mide el viewport real del scroll para el oráculo.

**Oráculo e2e de geometría (nuevo)**: `expectInvalidFieldFullyInScrollViewport(page)` — tras "Crear" inválido,
afirma que el bounding box del **input** (`custom-field-option-input`) Y del **mensaje inline**
(`custom-field-options-error`) caen COMPLETOS (top y bottom) dentro del rect del **viewport del ScrollView**
(`custom-field-scroll`), no solo `toBeInViewport()` (que pasaba con visibilidad parcial / contra el viewport del
browser). El test ahora **fuerza 360 ANTES de tocar "Crear"** (el ancho del bug: el auto-scroll corre a ESE ancho
y el oráculo lo valida ahí), captura `customfield-error-360.png`, y luego re-valida a **412** (re-dispara el
scroll, oráculo + título completo, captura `customfield-error-412.png`). 1/1 verde.

**Autoevaluación 360/412 (con el oráculo)**:
- **360**: input inválido + borde terracota + mensaje inline COMPLETAMENTE visibles dentro del viewport del
  scroll (NO below-the-fold) — confirmado por el oráculo de bounding-box Y por la captura `customfield-error-360.png`
  re-tomada (título "Nueva maniobra" completo arriba + input/borde/mensaje a la vista sobre el footer Crear/Cancelar).
- **412**: no se rompió — oráculo verde + `customfield-error-412.png` muestra el input/borde/mensaje a la vista y
  el título completo.
- FIX 1 (header fijo/título) y FIX 2 (borde terracota + inline) intactos: NO se tocaron, solo se robusteció el scroll.

**Verificación**: typecheck 0 + anti-hardcode 0 + unit `custom-field.test.ts` 30/30 + e2e `maniobra-customfield-
validacion` 1/1 (con el oráculo de geometría a 360 y 412). NO se tocó `validateCustomFieldDraft` ni
`customFieldErrorTarget` ni ninguna otra capa pura → spec-08 / feature_list.json intactos.

**Reconciliación**: el cambio es de presentación (CÓMO se scrollea al error), no del *qué* → `requirements.md`
sin cambios. `design.md §11.6` ya documenta el patrón de auto-scroll del FIX 2; el AS-BUILT del scroll ahora es
"geometría medida (onLayout/onContentSizeChange) + doble-rAF fallback", no "scrollToEnd con defer de 1 frame".

## NO marqué la feature `done`. Espera reviewer.
