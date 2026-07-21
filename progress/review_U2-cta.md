# Review — U2 "CTA siempre visible (teclado + scroll)"

**Veredicto: APPROVED**

Revisión de CODIGO (correccion + NO-regresion). El diseno ya fue vetado por el leader (Gate 2.5, diseno PASS).
Arbol sin commitear = U2 (+U9, ignorado por instruccion). Baseline `7477b21` == HEAD.

Archivos U2 revisados (diff vs HEAD):
- `app/src/components/FooterActionShell.tsx` (nuevo, primitivo)
- `app/src/utils/footer-action.ts` + `.test.ts` (nuevos)
- `app/src/hooks/useKeyboardVisible.ts` (nuevo)
- `app/app/crear-animal.tsx`, `app/app/agregar-evento.tsx`, `app/app/maniobra/carga.tsx` (M)
- `app/src/components/index.ts`, `app/src/hooks/index.ts`, `scripts/run-tests.mjs`, `docs/design-system.md` (M)

## 1. NO-REGRESION validacion de formulario (crear-animal) — CRITICO — PASS
- `scrollRef = useRef<RNScrollView>` (crear-animal.tsx:259) se pasa al shell como `scrollViewRef={scrollRef}`
  (crear-animal.tsx:794). El shell lo relaya pass-through a su ScrollView interno: AffordanceBody ->
  `<ScrollView ref={scrollViewRef}>` (FooterActionShell.tsx:100-108, 233). EL SCROLLVIEW DEL SHELL ES EL QUE
  LA VALIDACION REFERENCIA. Confirmado.
- `scrollToField(year|dayMonth|weight)` usa `scrollRef.current.scrollTo({y})` (crear-animal.tsx:268-281) y
  sigue invocandose en el submit fallido (crear-animal.tsx:559-561). Intacto.
- Geometria preservada: el shell renderiza {children} DIRECTO dentro del contentContainer del ScrollView (el
  View position:relative que aloja el fade queda FUERA del scroll -> no desplaza coordenadas). contentPaddingTop
  $3 (default) / contentPaddingHorizontal $4 (default) / contentGap $4 (pasado) = IDENTICO al contentContainerStyle
  viejo. onSectionLayout/onFieldLayout de Step4Data miden y en el MISMO sistema de coordenadas -> scrollTo cae al
  campo correcto. Sin regresion.
- Borde-rojo/error-inline: viven en Step4Data + setters del submit (setBirthYearError/setDayMonthError/
  setEntryWeightError) — NO tocados. keyboardShouldPersistTaps=handled preservado (default del shell). El cambio de
  paddingBottom del scroll (insets.bottom+$6 -> peekPad $6, con la safe-area migrada al footer fijo) NO afecta el
  calculo de scrollToField (no depende del paddingBottom).

## 2. maniobra/carga (manga) — PASS
- Componentes de paso (producto/tubo/pajuela/fecha/dato custom + pesaje/wheel/opciones) INTACTOS: el diff solo (a)
  envuelve el paso en KeyboardAvoidingView (carga.tsx:977-1005) y (b) cambia el computo de bottomPad. Los steps no
  se modificaron — solo reciben bottomPad.
- KAV POR-PASO: el header de identidad (SpikeIdentityHeader), la linea de maniobra + contador y el
  ManeuverErrorBanner quedan FUERA del KAV (arriba) -> fijos. Correcto.
- Pasos SIN teclado (tacto/pesaje-keypad/boolean/enum): keyboardVisible=false -> bottomPad = safe-area plena (sin
  regresion). Con teclado abierto (pasos de texto): bottomPad encoge a $2 + el KAV sube el CTA. Correcto.
- CTA "Aplicar y seguir": el wiring onCapture/onConfirm -> captureAndAdvance/captureCustomAndAdvance NO cambio -> la
  logica del paso sigue disparando. EmptySequence recibe bottomPad (carga.tsx:923), fuera del KAV -> inset pleno.

## 3. Keyboard-avoiding (iOS/Android) — PASS (por lectura)
- behavior={Platform.OS===ios ? padding : undefined} en el shell (FooterActionShell.tsx:98) y en maniobra
  (carga.tsx:979). IDENTICO a AuthScreenShell (produccion, AuthScreenShell.tsx:25-27).
- Android: sin override de softwareKeyboardLayoutMode en app.config.ts -> default de Expo (adjustResize) resuelve
  el lift. El encoje de safe-area con teclado abierto (resolveFooterPaddingBottom -> $2 gap en vez de reservar ~34px)
  evita el hueco. Device-test real = Raf.

## 4. Inset frame-0 Android — PASS
- computeSafeBottomInset reusa el enfoque de U7/tab-bar-insets.ts: max(insetVigente, initialWindowMetrics.insets.bottom,
  minInset). El padding NO colapsa a 0 en frame-0 (unit: live=0/init=48 -> 48). Cableado en FooterActionShell.tsx:141-145
  y carga.tsx:826-830.

## 5. Logica pura (footer-action.ts) — PASS
- computeSafeBottomInset / resolveFooterPaddingBottom / shouldShowScrollPeek correctas. shouldShowScrollPeek reusa
  scrollFades() de scroll-affordance.ts (una sola fuente de verdad, sin duplicar geometria). Defensa NaN/negativos ->
  minimo. Unit: 14/14 VERDE (node --import ./scripts/ts-ext-resolver.mjs --test footer-action.test.ts).

## 6. Firmas / capas / tokens / specs — PASS
- Primitivo CERO-HARDCODE: spacing/color por tokens; lo no-Tamagui (LinearGradient/ChevronDown) via getTokenValue.
- Capas OK: FooterActionShell (component) importa useKeyboardVisible (hook de UI puro, sin I/O) — con precedente
  (GroupViewScreen.tsx) y avalado por architecture.md L30 (hooks exponen estado a components).
- Exports: FooterActionShell(+type) en components/index; useKeyboardVisible en hooks/index. Unit registrado en
  run-tests.mjs (tras tab-bar-insets.test.ts).
- docs/design-system.md reconciliado al as-built: seccion 4 (blindaje frame-0 + caso teclado) y seccion 6 (primitivo
  canonico FooterActionShell). Sin specs/active/U2/ (delta de plan-doc, flujo lite) -> sin EARS que contradecir.
- typecheck: exit 0 (toda la app, incluye U9). Sin imports muertos (ScrollView de tamagui removido en ambas pantallas;
  getTokenValue/insets siguen en uso). Sin deps nuevas (package.json sin cambios).

## Trazabilidad (responsabilidad <-> test)
Sin requirements.md formal (delta de plan-doc, flujo lite documentado en el progress). Se mapea contra las 4
responsabilidades del primitivo:

| Resp | Test | Estado |
|---|---|---|
| P1 — CTA en footer FIJO, visible sin/tras scrollear | e2e/cta-siempre-visible.spec.ts (pasos 1+4) + capture 06 | coherente (E2E no re-corrida aca; ver nota 1) |
| P2 — safe-area encoge con teclado abierto | footer-action.test.ts > resolveFooterPaddingBottom (2) | VERDE |
| P3 — peek <-> contenido bajo el fold | footer-action.test.ts > shouldShowScrollPeek (4) + e2e | VERDE |
| P4 — reserva safe-area robusta frame-0 Android | footer-action.test.ts > computeSafeBottomInset (7) | VERDE |

testIDs del spec (footer-action, footer-scroll-fade-bottom) matchean los defaults del componente
(FooterActionShell.tsx:153, 266). Oracle solido (footer/CTA visible antes+despues del wheel, peek on->off, tap dispara el alta).

## Tasks completas: SI
T1-T9 en [x] (progress/impl_U2-cta-siempre-visible.md). Verificado: T1 (unit 14/14), T2 (hook), T3 (primitivo+export),
T4-T6 (3 pantallas), T9 (design-system). T7/T8 (E2E+captures) reportadas verdes por el implementer y vetadas por el
leader (Gate 2.5); no re-ejecutables aca (ver nota 1).

## CHECKPOINTS
- C1 [x] base/docs/agentes existen. check.mjs full = Gate 2 del leader (instruccion: no correrlo aca); corri la
  verificacion acotada pedida (unit + typecheck) -> verde.
- C2 [~] fuera de foco de esta review de codigo (cierre de sesion).
- C3 [x] capas OK (components/utils/hooks previstas); sin deps nuevas; sin logs/TODOs sueltos; sin establishment_id
  hardcodeado (UI pura).
- C4 [x] modulo con logica (footer-action) con 14 tests verdes; runner >0 y verde. Cross-tenant N/A.
- C5 [~] cierre de sesion (leader). __shots__ NO trackeados (git status limpio de PNGs de captura).
- C6 N/A: no es feature sdd:true formal (delta de plan-doc, flujo lite). Trazabilidad via P1-P4.
- C7 N/A (UI pura, sin tablas/RLS).
- C8 N/A (UI pura; los repos de datos de las pantallas — createAnimal / persistManeuverEvent — no se tocaron -> offline intacto).
- C9 [x] E2E existe y es coherente; capture file existe; leader corrio Gate 2.5 + veto visual (diseno PASS); __shots__ no commiteados.

## Checklist RAFAQ-especifico
- A (RLS / multi-tenancy) N/A (UI pura, sin tablas).
- B (offline-first) N/A (U2 no toca el path de datos; las pantallas siguen usando sus repos locales).
- C (BLE) N/A (instruccion: no tocar BLE).
- D (UI de campo) APLICA:
  - [x] Targets: el CTA usa el primitivo Button fullWidth y los steps minHeight=$touchMin — tamanos PRE-EXISTENTES, no
        alterados por U2; U2 mejora la alcanzabilidad (footer fijo, thumb-zone).
  - [x] Fuente >=18pt: labels de CTA/titulos en tokens grandes ($6/$7) — sin cambios.
  - [x] Una decision por pantalla: wizard de alta (rodeo/sexo/categoria/datos) y maniobra (1 maniobra por paso) — sin cambios.
  - [x] Loading visible: "Creando..." (alta) / spinner "Abriendo el animal..." (maniobra) — sin cambios.
- E (Edge Functions) N/A.

## Notas (no bloqueantes)
1. E2E no re-ejecutada en este entorno: cta-siempre-visible.spec.ts crea usuarios en Supabase remoto
   (createTestUser/seedEstablishmentWithRodeo) y las credenciales (SUPABASE_SERVICE_ROLE_KEY etc.) NO estan seteadas
   aca; ademas la instruccion prohibe remotas. Por instruccion explicita ("si flakea, reportalo, no bloquees") NO
   bloquea. La E2E es coherente con el componente (testIDs + oracle), el implementer la reporto 1 passed, y el leader
   veto las capturas del mismo harness. Que Raf la corra en device (donde ademas se valida el lift real sobre el teclado).
2. Par de capturas a 360px pendiente (el implementer lo dejo anotado para el veto del leader). Scope de veto visual /
   convencion de capturas, no de correccion de codigo; el leader ya dio diseno PASS.
3. check.mjs full = responsabilidad del Gate 2 del leader (instruccion de no correrlo aca).

Ningun hallazgo es un defecto de correccion de codigo ni una regresion. APPROVED.
