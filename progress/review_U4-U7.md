# Review U4 + U7 -- tanda docs/plan-mejoras-2026-07-20.md (frontend puro, arbol sin commitear)

Revisor: reviewer. Fecha: 2026-07-21. Baseline: cf791e4.
Contexto: 2 bugfixes revisados en una pasada. El FAIL de check.mjs "features in_progress" = coordinacion
(leader), IGNORADO por instruccion. NO se corrio check.mjs full ni suites remotas. 0 BLE.

Verificacion ejecutada (ambas unidades, read-only):
- Unit repro-status.test.ts + tab-bar-insets.test.ts + local-reads.test.ts -> 220/220 pass.
- pnpm --dir app typecheck -> EXIT 0.

## U4 -- ficha de animal incompleta (paridad card<->ficha) -> APPROVED

### 1. teeth_state (brecha a)
- Proyeccion buildAnimalDetailQuery (local-reads.ts): rama synced "ap.teeth_state AS teeth_state" (linea
  1352), rama overlay "NULL AS teeth_state" (linea 1385). Misma posicion ordinal (11a, tras coat_color,
  antes de entry_date) en ambas ramas del UNION ALL -> alineacion correcta (matchea por posicion).
  Patron overlay=NULL identico a is_cut=0 (documentado). Test local-reads.test.ts asserta ambos literales. OK
- Fila "Dientes" condicional (teethState != null, [id].tsx:2396) -- no aparece si no hay dato. Label
  correcto: teethLabel (es-AR; fallback al valor crudo si el enum es desconocido). OK
- Mapper aditivo: AnimalDetail.teethState + LocalDetailRow.teeth_state? + teethState: row.teeth_state ?? null. OK

### 2. reproStateRowDisplay (punto de riesgo -- logica compartida con la card)
La fila se ancla en detail.reproStatus ([id].tsx:2380, mismo single-slot que el chip de la card) y solo
ENRIQUECE con termino+fecha del timeline cuando hay evento determinante. Barrido de estados (NINGUNO
queda peor que antes; NINGUNO duplica la fila Aptitud):
- empty sin evento timeline -> "Vacia" (antes "Sin registrar"). MEJOR -- es el reporte de Raf. OK
- empty/pregnant con evento -> "Vacia . fecha" / "Prenada (x) . fecha". IDENTICO (ruta enriquecida). OK
- pregnant sin evento timeline -> "Prenada" (antes "Sin registrar"). MEJOR (paridad). OK
- served_untested -> "Servida sin tacto". IDENTICO. OK
- cut -> "No apta" (antes podia mostrar "Prenada.fecha" del timeline en un CUT con tacto). MEJOR
  (paridad; test linea 381 cubre cut+hasPregnancyEvent -> "No apta"). OK
- fitness/unknown con aptitudeShown (vaquillona) -> none -> "Sin registrar"; el veredicto vive en Aptitud.
  IDENTICO (no duplica). OK
- unknown no-vaquillona -> "Sin evaluar" (antes "Sin registrar"). MEJOR (paridad). OK
- none (macho): la fila NO se renderiza (gate sex==female, linea 2402). ternera (female): "Sin registrar". IDENTICO. OK
- No regresa el display de prenez del timeline (se preserva via reproRow.kind==pregnancy). OK
Guard real de la divergencia = el UNIT reproStateRowDisplay (la asercion E2E "Vacia" pasa por la ruta
pregnancy y no distingue el fix). Split honesto del impl confirmado.

### 3. No regresion
Mapper AnimalDetail 100% aditivo. Estado reproductivo sigue female-only; Aptitud sin cambios
(showAptitude = female && vaquillona). Fila Dientes nueva y condicional. OK

### 4. Gate 2.5 (evaluado por LECTURA)
- Capture ficha-paridad.capture.ts: 3 shots; __shots__ gitignored, .capture.ts commiteable. Bien formado. OK
- Descendentes: los labels nuevos (Dientes, Boca llena, Vacia, Prenada, No apta, Sin evaluar, Servida sin
  tacto) NO tienen glifos descendentes en la parte visible -> sin riesgo de recorte. CurrentStateRow pre-existente. OK
- E2E ficha-paridad.spec.ts NO ejecutada por decision de reviewer: sesion paralela (terminal BLE sobre la
  misma Supabase remota -> flake por rate-limit) + e2e:build re-renderiza design PNG (churn espurio). Impl
  la reporto PASS; el guard real (unit) pasa; la spec esta bien formada. NO bloquea (per instruccion). OK

### 5. Fencing + specs
0 BLE / 0 RLS / 0 migracion; lectura local SQLite (offline-first); sin establishment_id hardcodeado.
Specs 02 reconciliadas coherentes con el as-built (design-aptitud-reproductiva.md + design.md). requirements
sin cambio de EARS. OK

## U7 -- navbar Android pegado a la barra del sistema -> APPROVED

### 1. computeTabBarInsetLayout (pura)
safeInset = max(nonNegative(live), nonNegative(initial)); paddingBottom = max(safeInset, nonNegative(min));
height = nonNegative(navHeight) + paddingBottom. El max(live, startup, min) correcto; nonNegative defiende
NaN/negativos/Infinity -> 0. OK
- iOS: max(34,34,12)=34, height 94 -> byte-identico. OK
- Web/E2E: initialWindowMetrics=null -> 0; max(0,0,12)=12, height 72 -> byte-identico (sin churn design). OK
- Android frame-0: max(0,48,12)=48 (3 botones) / max(0,24,12)=24 (gesture) -> ya NO colapsa a 12. Unico caso que cambia. OK
- Unit tab-bar-insets.test.ts (11): iOS, frame-0 live=0/initial=48, gesture, resolucion post-arranque, web
  minimo, inset<min, max en ambas direcciones, NaN/neg/Inf, invariante height-padding=navHeight. Cubre todo. OK

### 2. NO esconde la barra del sistema / contenido no tapado
Solo agrega paddingBottom (no modo inmersivo). height = navHeight + paddingBottom -> el contenido mide
siempre navHeight, el padding vive debajo -> iconos/labels nunca tapados. Invariante testeada. FAB intacto:
navHeight/navItemTop/FAB_SIZE/FAB_RAISE (linea 176) NO tocados -> overhang del FAB sin cambio. OK

### 3. Fencing
Solo _layout.tsx + tab-bar-insets.ts/.test.ts (nuevos). run-tests.mjs registra el test nuevo (+ tests BLE
de la otra terminal, no de mi incumbencia, no rompen nada). navHeight/navBottomMin existen en navColors()
(lineas 63/66). Verificacion real = device Android (Raf); reviewer por lectura/unit (insets no reproducen en web). OK

## CHECKPOINTS (bugfixes frontend, arbol sin commitear)
- C1 -- [ ] N/A (no es cierre de sesion; check.mjs full no corrido por instruccion).
- C2 -- [ ] N/A (coordinacion de features = leader).
- C3 arquitectura -- [x] capas previstas; 0 deps nuevas; sin logs/TODOs; 0 establishment_id hardcodeado.
- C4 verificacion real -- [x] test por modulo con logica; fixtures reales; runner 220/220 verde. RLS N/A.
- C5 -- [ ] N/A (leader commitea; __shots__ gitignored verificado).
- C6 SDD -- [x] specs 02 reconciliadas; U7 bugfix sin specs/active (sin EARS). Trazabilidad sintoma<->test cubierta.
- C7 multi-tenant -- [x] sin tabla nueva; teeth_state ya en animal_profiles (stream tenant-scoped); sin RLS/FK nuevas.
- C8 offline-first -- [x] U4 lee SQLite local (display-only, funciona offline); sin bucket nuevo; sin writes.
- C9 E2E+visual -- [x] U4 spec + capture (verde per impl; reviewer por lectura); __shots__ no commiteados. U7 [ ] N/A.

## Checklist RAFAQ-especifico
- A (multi-tenancy/RLS) -- N/A: ninguna unidad crea tabla ni policy; teeth_state ya existe (0020) en stream tenant-scoped.
- B (offline-first) -- U4 aplica: [x] funciona offline (buildAnimalDetailQuery local); [x] sin bucket nuevo; [x] sin conflicto (display-only, 0 writes); [x] sin request sincrono a Supabase. U7 N/A.
- C (BLE) -- N/A ambas.
- D (UI de campo) -- N/A: ficha = pantalla de lectura (no manga/wizard); tab bar = chrome de navegacion (label 11px estandar).
- E (Edge Functions) -- N/A ambas.

## Veredicto final
- U4: APPROVED
- U7: APPROVED
Reglas duras OK: 0 tests rojos (220/220), typecheck verde, cada brecha/sintoma con test, sin tasks
pendientes sin justificar, specs no contradicen el as-built, secciones RAFAQ aplicables sin box pendiente.
