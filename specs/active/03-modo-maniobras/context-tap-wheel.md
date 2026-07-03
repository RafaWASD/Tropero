# Spec 03 — Delta TAP-TO-SELECT en la rueda inercial (#16) — Contexto (Gate 0)

**Status**: `context_ready` · Delta **Nivel B (ADR-028)** sobre spec 03 (`done`) · **frontend-only** (sin backend) · Gate 1 N/A.
**Fecha**: 2026-07-03.
**Origen**: corrección **#16** del testeo en vivo (`docs/correcciones-prueba-en-vivo-2026-06-27.md`). Raf: "hacer después" → ahora.
**Gate 0**: aprobado por el leader (modo autónomo) — es una mejora de interacción acotada, sin decisiones de dominio.

---

## Problema

Las **ruedas inerciales** (`WheelPicker.tsx`) solo cambian de valor **arrastrando**. Si estás parado en un valor y **tapeás** una opción visible arriba/abajo del centro, **no pasa nada** — hay que arrastrar a mano hasta el valor. En la manga (una mano, con guante/barro), tapear la opción que ya ves es más rápido y natural que arrastrar con precisión.

Aplica a los **dos wheels** del paso de circunferencia escrotal (`CircunferenciaEscrotalStep.tsx`): la rueda **dominante de CE** y la rueda **secundaria de edad en meses** — **ambas son instancias de `WheelPicker.tsx`**, así que **un solo fix en el componente cubre las dos** (y cualquier wheel futuro).

## Estado as-built

- `app/app/maniobra/_components/WheelPicker.tsx` (369 líneas): `Animated.ScrollView` (reanimated) con `snapToInterval = wheelCell` (64) + `decelerationRate="fast"` + un LOCK determinístico en JS para el snap (web no lockea con `snapToInterval` — `reference_rn_web_pitfalls`). Renderiza `WheelCell` desde `values.map`. Las celdas **NO tienen `onPress`** hoy.
- Ya existe el mecanismo de "ir a un offset animado": `scrollRef.current?.scrollTo({ y: snap.offset, animated: true })` (~L208) + la lógica pura de offset por índice en `app/src/utils/wheel-picker.ts`. El tap reusa eso.
- Guards de plataforma ya resueltos: doble-rAF / settle / momentum / web-debounce (no romperlos).

## Decisiones (Gate 0)

**D1 — Tapear una celda visible la selecciona (anima + snap).** Cada `WheelCell` pasa a ser tappable; al tapear una celda **≠ la central**, la rueda **anima suave** hasta centrar ese valor (reusa el `scrollTo({animated:true})` + el snap por índice) y dispara el mismo `onValueChange` que el drag. Tapear la celda **ya central** es no-op (o confirma, sin cambio de valor).

**D2 — No romper el drag ni los guards de plataforma.** El tap-to-select convive con el arrastre inercial existente (native + web). El tap se distingue del drag (un tap no es un scroll); el `scrollTo` programático del tap entra por el MISMO camino que el snap actual (sincroniza los shared values antes, para no pisar el valor con un intermedio — mismo patrón que el lock existente). Sin regresión del settle/momentum/háptica.

**D3 — Solo las celdas VISIBLES importan.** El requisito es tapear una opción **que se ve** (arriba/abajo del centro, dentro del "drum"). No hace falta un mapeo de coordenada-a-valor sofisticado: cada `WheelCell` conoce su índice → su tap sabe a qué valor ir. Las celdas fuera del viewport no son tappables (no se ven).

**D4 — Háptica/feedback consistente.** El tap-select dispara la misma háptica de "settle" que el snap por drag (si el wheel la tiene), para que se sienta igual.

## Alcance

- **Frontend-only**: `WheelPicker.tsx` (agregar `onPress` a `WheelCell` → handler que anima al índice tapeado + `onValueChange`). Posible ajuste menor en `wheel-picker.ts` (helper puro para el offset destino por índice, si no está). NO se toca backend, ni `CircunferenciaEscrotalStep.tsx` (hereda el fix del componente), ni otros steps.
- **Gate 1 N/A** (sin migración/RLS/RPC; `git diff supabase/` vacío).
- **Gate 2.5**: capture del wheel (estado antes/después del tap) + **E2E** que tapea una celda visible y assertea que el valor cambió al de esa celda (la interacción, no solo el estado). El E2E es la evidencia clave (una captura estática no muestra el tap→snap).

## Edge cases

- **Tap durante un fling en curso**: el tap cancela/reemplaza el momentum y anima al valor tapeado (o se ignora hasta el settle — decisión del implementer, preferible cancelar y snap al tap).
- **Web táctil real** (`reference_rn_web_pitfalls`): el tap-through / click emulado no debe cerrar el sheet ni disparar dos veces; reusar los guards existentes.
- **Celda central tapeada**: no-op de valor (no re-dispara onValueChange espurio).
- **Accesibilidad**: la celda tappable lleva su `a11y` (label del valor + role).

## No-alcance

- Rediseñar la rueda o su estética. Cambiar el snap por drag. Otros pickers (Lote/Rodeo/Breed son listas, no wheels).

## Tareas para la spec

El spec_author redacta `{requirements,design,tasks}-tap-wheel.md` (numeración `RTW.<n>`), con: el `onPress` de `WheelCell` + el handler de animación por índice, la no-regresión del drag/settle/momentum (native+web), el helper puro testeable del offset destino, el E2E del tap (native mock + web), y el capture del Gate 2.5. Gate 1 N/A. Marcá decisiones de criterio propio (cancelar-fling-vs-esperar, háptica) para Puerta 1.
