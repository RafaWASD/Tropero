# impl — spec 03 M2.1 (design spike): IDENTIFICACIÓN del animal en MODO MANIOBRAS

baseline_commit: 6308ff5c1e806a007144d9b244a667767d0f735f

DESIGN SPIKE visual-first, 100% MOCK, de la pantalla de **identificación del animal** de MODO
MANIOBRAS (US-3 identificación dual + US-4 find-or-create + R5.1 carga rápida destino). Igual que el
spike M2.0 (carga.tsx / paso.tsx): EXPLORACIÓN VISUAL para que el leader veteé con design-review antes
de mostrarle a Raf. **NO** cabla BLE real, **NO** toca servicios/backend, **NO** integra el
find-or-create real — mockea los estados con data de ejemplo y un `?state=` para que el e2e dispare
cada uno y capture.

> No hay superficie de seguridad (sin DB, sin RPC, sin tenant, sin red): **Gate 2 N/A**. Trazabilidad
> R<n>→test formal **N/A** — el criterio es visual y se prueba con las 4 capturas PNG. Las R que guían
> la dirección (R3.1/R3.4/R3.5, R4.1, R5.1) están cubiertas como ESTADOS renderizados, no como tests
> de comportamiento (esto es un spike exploratorio; la plomería real con sus tests viene después).

## Dirección implementada: "scan-first" (elegida y fundamentada por el leader)

El escaneo del bastón es el 95% del flujo (manos ocupadas, no hay que tocar nada), el manual es el
fallback. Layout 412×915, tres bandas:

1. **Header de sesión SLIM** (`SpikeSessionHeader`, nuevo) — visibilidad del estado del sistema
   (Nielsen #1): volver/pausar (izq, ≥touchMin) + rodeo (hero) + cola de maniobras truncada (centro)
   + contador de progreso "12 hoy" (der, chip verde). Fondo `$surface` (bone) = contexto, figura-fondo
   vs la zona de acción `$bg`. Mismo idiom que `SpikeIdentityHeader` (Jakob).
2. **Hero de escaneo** (dominante ~2/3) — figura-fondo (Gestalt) + Fitts (el target es el animal, no
   hay tap): disco de pulso gigante (`$heroScan`=200) con anillos concéntricos de onda (`$fabHalo` +
   `$greenLight`) + disco brand + `StickIcon` (ScanLine) + headline "Acercá el bastón al animal" + sub
   "La lectura entra sola, sin tocar la pantalla". Una sola cosa que mirar.
3. **Entrada manual** (tercio inferior, thumb zone — R3.5): colapsada = affordance "¿Sin chip? Ingresá
   la caravana" (≥touchMin, toda la franja tappable). Expandida = input grande manga-friendly
   (≥`$searchBarLg`, borde brand) con valor de ejemplo "0421" + CTA "Buscar".

## Estados renderizados (4 capturas, 412×915, `design/maniobra-identify/`)

| estado (`?state=`) | captura | qué muestra | R |
|---|---|---|---|
| `listening` (default) | `identify-listening.png` | header + hero "escuchando" + manual colapsado | R3.1/R3.5 |
| `found` | `identify-found.png` | lectura recibida → animal ENCONTRADO: disco verde + check + "Caravana 0385" hero + tag electrónico + rodeo/categoría | R3.4 |
| `manual` | `identify-manual.png` | entrada manual EXPANDIDA (input grande + Buscar) | R3.5 |
| `unknown` | `identify-unknown.png` | desconocido → find-or-create: PlusCircle + "Animal nuevo" + tag precargado + rodeo de la sesión + "Dar de alta" (lenguaje del FindOrCreateOverlay) | R4.1 |

## Archivos

- `app/app/maniobra/identificar.tsx` (NUEVO) — pantalla spike, 4 estados por `?state=`.
- `app/app/maniobra/_components/SpikeSessionHeader.tsx` (NUEVO) — header de sesión SLIM.
- `app/src/theme/icons.ts` — `StickIcon` (ScanLine) agregado al registro central de íconos.
- `app/tamagui.config.ts` — tokens nuevos `$heroScan` (200), `$heroRing` (8), `$heroIcon` (80).
- `app/app/_layout.tsx` — ruta `maniobra/identificar` en `DEV_WEB_ROUTES` + `Stack.Screen`.
- `app/e2e/maniobra-identify.spec.ts` (NUEVO) — captura de las 4 PNG.

## Token nuevo agregado (avisar al leader, ADR-023)

- `size.heroScan = 200` — diámetro del disco de pulso del hero de escaneo (figura-fondo, NO touch-target).
- `size.heroRing = 8` — grosor del anillo del disco interior.
- `size.heroIcon = 80` — tamaño del `StickIcon`/`Check`/`PlusCircle` dentro del disco.
- `StickIcon` (= lucide `ScanLine`) en `src/theme/icons.ts` — ícono de dispositivo bastón/RFID.

## Verificación

- `node scripts/check-hardcode.mjs` → 0 violaciones (tras pasar los `borderRadius={9999}` a `$pill`).
- `pnpm exec tsc --noEmit` → 0 errores.
- `node scripts/check.mjs` → **VERDE** (exit 0: typecheck + anti-hardcode + suite backend completa).
  El crash de teardown de Node en Windows (`UV_HANDLE_CLOSING`, exit 127) que aparece al final de la
  corrida de Playwright es ruido del runtime DESPUÉS de `N passed` — NO es falla de test.
- Captura e2e (`maniobra-identify.spec.ts`) → **4 PNG** en `design/maniobra-identify/`
  (identify-listening / identify-found / identify-manual / identify-unknown), las 4 verdes.

## Autorrevisión adversarial (paso 8)

Miré las 4 capturas finales con ojo de diseñador pro (Fitts, jerarquía, densidad, contraste,
descendentes) y busqué activamente lo cuestionable. Qué encontré y cómo lo cerré:

- **[ENCONTRADO Y CORREGIDO] Mensaje contradictorio en `manual`.** En la 1ª captura del estado
  `manual`, el `ScanHero` completo seguía dominando ("Acercá el bastón al animal" en `$9`) mientras
  abajo el operario tipea la caravana → DOS heroes de igual peso compitiendo (viola jerarquía / una
  decisión por pantalla). Conceptualmente el bastón sigue escuchando (R3.6), pero visualmente no puede
  competir con la tarea activa. **Fix**: agregué `ScanHero({ compact })` — con el manual expandido el
  hero se ATENÚA (opacity 0.55, disco a 0.55×, headline reemplazado por una línea chica muted "O
  acercá el bastón al animal"). Ahora el input + "Buscar" son la figura; el escaneo es un recordatorio
  de fondo. Re-verificado con `tsc`/hardcode/recapture (PNG final adjunto).
- **[ENCONTRADO Y CORREGIDO] `borderRadius={9999}` crudo (7×).** El anti-hardcode lo marcó: los
  círculos/anillos usaban el literal. Cambiado a `borderRadius="$pill"` (= 9999 en el token de radius).
- **[ENCONTRADO Y CORREGIDO] Hack feo en `ScanHero`.** Tenía un `<View opacity={0}>` muerto solo para
  "consumir" `primary` y callar un lint imaginario. Lo borré (primary no se usaba).
- **[ENCONTRADO Y CORREGIDO] Comentarios mentirosos.** Dos comentarios citaban copy que ya no existía
  ("Cuando lo leas…", "¡Listo!"). Alineados al copy real.
- **[ENCONTRADO Y CORREGIDO] `getByDisplayValue` no existe en esta versión de Playwright** → el test
  `manual` crasheaba. Cambiado a `getByLabel(...).toHaveValue('0421')`.
- **[VERIFICADO OK] Recorte de descendentes** (regla dura): "Acercá", "bastón", "Vacunación", "Cría
  hembras", "Ingresá", "Vaca segundo servicio", "Dar de alta" — todos limpios en las 4 PNG. Todo
  heading `$9/$10` y todo Text con `numberOfLines` lleva `lineHeight` matching.
- **[VERIFICADO OK] Safe areas**: el manual colapsado/expandido y el CTA "Dar de alta" usan
  `bottomPad = max(insets.bottom, $navBottomMin)` → nunca bajo el home indicator.
- **[VERIFICADO OK] es-AR**: el `tag_electronic` (982 000…) es ID de máquina → NO se formatea es-AR
  (correcto). No hay números es-AR (cantidades) que formatear en esta pantalla.
- **[VERIFICADO OK] Fitts / thumb zone**: volver, manual colapsado y todos los CTA ≥`$touchMin`, en la
  zona del pulgar (75% de los toques). El disco de escaneo es un target PASIVO (no se toca) → no
  necesita touch-target, sigue la escala de figura-fondo.
- **[VERIFICADO OK] Consistencia (Jakob)**: el `unknown` reusa fielmente el idiom del
  `FindOrCreateOverlay` (PlusCircle + "Animal nuevo" + copy + tag precargado + rodeo + "Dar de alta").
  El header de sesión espeja el figura-fondo del `SpikeIdentityHeader` ($surface vs $bg).

### Notas para el veto del leader (cosas opinables, NO bugs)

- **Contador "12 hoy"** es el copy literal sugerido por el brief; es un poco ambiguo ("12 qué"), pero
  el contexto (manga) lo desambigua. Si el leader prefiere "12 animales" o un ícono de animal al lado,
  es un cambio de una línea.
- **`StickIcon = ScanLine`**: elegí la metáfora "escaneo" (pasar el bastón) sobre `Radio`/`RadioTower`
  (ondas BLE), porque el bastón físicamente se acerca/escanea, no "transmite". El `FindOrCreateOverlay`
  usa `Radio` para "caravana leída" — si el leader quiere coherencia estricta con ese glifo, es un
  cambio de una línea en `icons.ts`.
- **Hero compacto en `manual`**: opté por atenuar+achicar en vez de ocultar el hero del todo, para no
  perder la pista "seguís pudiendo bastonear" (R3.6). Decisión vetar-able.
