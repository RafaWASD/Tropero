baseline_commit: cf791e4e439f7479e46c3b50d042c40c9e42bedb

# Impl U7 — navbar pegado a la barra del sistema en Android (insets edge-to-edge)

Tanda `docs/plan-mejoras-2026-07-20.md`, Tier-2, unidad atómica U7.
Alcance: SOLO el tab bar layout (`app/app/(tabs)/_layout.tsx`). Sin BLE, sin ficha/reportes/vacunas/invitación.

## Síntoma
iOS: bottom-nav impecable. Android: el tab bar queda **pegado a la barra del sistema** (gesture bar / 3 botones);
los íconos/labels quedan al ras de la barra o por debajo.

## Investigación — la causa del plan está IMPRECISA (confirmado por código, no por device)

El plan dice: *"el patrón `paddingBottom = max(insets.bottom, mínimo)` ya está en la skill de diseño pero
NO está aplicado al tab bar"*. **Eso no es exacto: el patrón YA estaba aplicado** (`_layout.tsx` lo tenía
desde el scaffold: `navBottom = Math.max(insets.bottom, navBottomMin)` con `height = navBar + navBottom`).
Verifiqué además que nuestro `tabBarStyle` gana sobre el default de React Navigation:

- `expo-router/.../BottomTabBar.js` aplica nuestro `tabBarStyle` **último** en el array de estilos (su
  default es `paddingBottom: insets.bottom`); nuestro `navBottom` es siempre `≥` ese default.
- `getTabBarHeight` respeta nuestro `height` explícito.
- Tanto nuestro `useSafeAreaInsets()` como el `insets` interno de RN (`BottomTabView` →
  `SafeAreaInsetsContext.Consumer`) leen el **mismo** SafeAreaProvider raíz.

Conclusión: si igual queda pegado en Android, el problema no es la fórmula sino que **`insets.bottom`
llega en 0** en Android en (al menos) los primeros frames → `navBottom` colapsa al mínimo (12) y el
contenido queda pegado a la barra.

Por qué llega en 0 y por qué solo Android:
- Expo SDK 56 / RN 0.85 / Android 15: **edge-to-edge es OBLIGATORIO y siempre-on** (verificado en
  `@expo/prebuild-config/.../withEdgeToEdge.js`: `edgeToEdgeEnabled` ya ni se puede configurar; el plugin
  corre incondicional). La ventana dibuja **debajo** de la barra del sistema → la app debe compensar.
- El `SafeAreaProvider` raíz (`app/app/_layout.tsx`) **NO está sembrado con `initialWindowMetrics`**
  (grep: `initialWindowMetrics`/`initialMetrics` sin uso en todo el repo). Sin ese seed, el provider
  arranca con insets = 0 y los mide **async**; en Android edge-to-edge ese frame-cero (o un update que
  no propaga a tiempo) deja el nav en el mínimo. En iOS el inset (~34) es estable desde el arranque →
  nunca se ve el 0 → "impecable". Asimetría iOS/Android explicada.

## Fix (scope tab bar, sin tocar root layout ni config)
Uso como **piso** —además del inset vigente— el inset medido al **arranque**
(`initialWindowMetrics.insets.bottom`), que en nativo llega **sincrónico** desde `getConstants()` ya con
el valor real de la barra de navegación. Así, aunque el inset vigente sea 0 en el frame-cero, el nav
arranca con el respiro correcto.

`paddingBottom = max(insetVigente, insetArranque, mínimo)` · `height = navBar + paddingBottom`.

- **iOS**: `max(34, 34, 12) = 34` → idéntico a antes. Sin regresión.
- **Web / E2E**: `initialWindowMetrics` es `null` → `max(0, 0, 12) = 12` → idéntico a antes. No re-renderiza
  design/*.png (comportamiento web sin cambios).
- **Android edge-to-edge**: `max(0, 48, 12) = 48` (3 botones) o `max(0, 24, 12) = 24` (gesture) → **ya no
  pegado**. Es el único caso cuyo resultado cambia; el fix domina estrictamente al comportamiento previo.

El cálculo se extrajo a una **función pura testeada** (`@/utils/tab-bar-insets`); el layout solo lee tokens
e insets y los pasa. Sin literales de color/spacing nuevos (anti-hardcode ADR-023 §4: 0 violaciones).

### Caveat honesto documentado
`initialWindowMetrics` queda congelado al arranque. Si el usuario cambiara el modo de navegación del
sistema (3 botones ↔ gestos) EN CALIENTE hacia uno más chico, el `max` sobre-padea un poco (el bar
"flota" unos px) en vez de quedar pegado — trade-off aceptable y muy raro (la app está bloqueada en
portrait, sin rotación). Nunca produce el síntoma pegado.

## Archivos
- `app/src/utils/tab-bar-insets.ts` (NUEVO) — `computeTabBarInsetLayout()` pura + tipos.
- `app/src/utils/tab-bar-insets.test.ts` (NUEVO) — 11 tests node:test.
- `app/app/(tabs)/_layout.tsx` — import de `initialWindowMetrics` + `computeTabBarInsetLayout`; reemplaza
  el cálculo inline de `navBottom`/`height` (líneas ~313-346).
- `scripts/run-tests.mjs` — registra el nuevo test en la lista explícita (un test no listado nunca corre).

## Verificación (scope: typecheck + unit; NO check.mjs full ni suites remotas)
- `pnpm --dir app run typecheck` → EXIT 0.
- unit `tab-bar-insets.test.ts` → 11/11 pass.
- `node scripts/check-hardcode.mjs` → 0 violaciones.

## Trazabilidad (bugfix, no EARS)
- Síntoma "navbar pegado en Android" → `tab-bar-insets.test.ts` "Android frame-cero (live=0)… padding 48"
  (encodea el fix: NO colapsa a 12).
- "no romper iOS" → test "iOS home indicator (~34)…" (padding 34, height 94).
- "no romper web/E2E" → test "Web (initialWindowMetrics=null → 0)… mínimo (12)".

## Autorrevisión adversarial
- ¿La fórmula sub/sobre-padea? Cubierto con tests de max(live,initial), mínimo, NaN/negativos/Infinity → 0.
- ¿Rompe iOS/web? No: ambos casos dan exactamente el valor previo (tests lo fijan). Typecheck limpio.
- ¿Rompe el FAB (marginTop -fabRaise / hitSlop derivado de navBar)? No se tocó `navBar`, `navItemTop`,
  `fabRaise` ni el cálculo del FAB; el padding vive DEBAJO del contenido, no cambia el overhang del FAB.
- ¿`initialWindowMetrics?.insets.bottom` type-safe? Sí (`Metrics | null`; `?.` + `?? 0`). Typecheck OK.
- ¿Test que pasa por la razón equivocada? El test ejercita la lógica real (Math.max encadenado) y asserta
  el reject del mínimo en el caso-bug (`!== 12`). No hay mock que lo falsee.

## Reconciliación de specs
Unidad de bugfix de la tanda (no tiene `specs/active/<name>/`). El as-built quedó igual a lo pedido por el
plan (patrón de insets con mínimo), con la precisión de que la causa real era el frame-cero de
`useSafeAreaInsets` sin seed, no la ausencia del patrón. Documentado acá; no hay EARS que reconciliar.

## Recomendación de follow-up (FUERA de scope, para el leader)
Sembrar el provider raíz: `app/app/_layout.tsx` → `<SafeAreaProvider initialMetrics={initialWindowMetrics}>`.
Es el fix canónico de safe-area-context (arregla el frame-cero app-wide, no solo el tab bar, y hace que el
inset vigente sea correcto desde el frame 1). Requiere verificación app-wide en device (afecta TODAS las
pantallas), por eso NO lo hice en esta unidad atómica. El fix del tab bar es autosuficiente para el síntoma
reportado. Si tras verificar en Android el nav SIGUIERA pegado, la causa sería más profunda (el módulo
nativo de safe-area no reporta el inset inferior ni en getConstants) → ahí sí toca el seed raíz o revisar
el setup edge-to-edge nativo.

## Verificación que debe hacer Raf en un ANDROID físico (los insets no se reproducen en web/E2E)
1. Build/OTA de esta rama en un Android (idealmente uno con **gestos** y otro con **3 botones**, o probar
   ambos modos desde Ajustes → Navegación del sistema).
2. Abrir cualquier tab (Inicio/Animales/Reportes/Más): el bottom-nav debe quedar **separado** de la barra
   del sistema — íconos y labels por encima de la gesture bar / 3 botones, sin quedar tapados ni al ras.
3. El FAB central "Maniobra" debe seguir flotando igual (elevación y label intactos).
4. Confirmar que **iOS sigue impecable** (mismo gap del home indicator que antes — no cambió).
5. Contenido de las pantallas: el nav no debe "flotar" con un hueco excesivo (si aparece hueco raro,
   avisar: sería el caveat de nav-mode en caliente o que hay que seguir con el follow-up del seed raíz).
