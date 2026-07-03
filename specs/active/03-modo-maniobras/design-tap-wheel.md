# Spec 03 — Delta TAP-TO-SELECT en la rueda inercial (#16) — Design

**Status**: `spec_ready` — delta **Nivel B (ADR-028)**, **frontend-only**. Gate 1 **N/A**.
**Fecha**: 2026-07-03. **Autor**: spec_author.
**Fuente de verdad**: `context-tap-wheel.md` (Gate 0). As-built revisado: `WheelPicker.tsx` (369 líneas), `wheel-picker.ts`(+`.test.ts`), `CircunferenciaEscrotalStep.tsx`, `rueda-ce.tsx` (spike), `e2e/maniobra-circunferencia-escrotal.spec.ts`, `e2e/captures/rueda-ce.spec.ts`.

> Apoyado en `docs/architecture.md` / `docs/conventions.md`: solo se documenta donde la feature roza la frontera (tap sobre la mecánica de scroll/lock existente). ADR-023 (tokens / cero hardcode) y `reference_rn_web_pitfalls` (web táctil) son las reglas activas.

---

## 1. Alcance de archivos

**Se modifican (frontend):**

- `app/src/utils/wheel-picker.ts` — **agrega** el helper puro `tapTarget(currentOffset, tappedIndex, cellHeight, spec)` (RTW.6). Sin tocar la aritmética existente.
- `app/src/utils/wheel-picker.test.ts` — extiende con los casos de `tapTarget` (RTW.6.2).
- `app/app/maniobra/_components/WheelPicker.tsx` — `WheelCell` pasa a ser tappable (`onPress` + a11y + `testID` por celda, RTW.1.1/RTW.3.1/RTW.5.3) y el `WheelPicker` gana el handler `handleCellTap` (RTW.1.2–1.4, RTW.2.\*, RTW.4.1, RTW.5.1).

**Se agregan (evidencia Gate 2.5):**

- `app/e2e/maniobra-tap-wheel.spec.ts` **(nuevo, REGRESIÓN)** — E2E táctil del tap sobre la rueda (RTW.7.1): tapea celdas visibles no centrales de `ce-wheel` y assertea que `ce-input` cambia al valor tapeado (37 → 36,5 → 35,5) + no-op de la celda central (RTW.1.4) + no cierra la pantalla (RTW.5.2). Corre en `pnpm e2e`.
- `app/e2e/captures/tap-wheel.capture.ts` **(nuevo, CAPTURE Gate 2.5, ADR-029)** — capturas NOMBRADAS del drum **antes/después** del tap a 360 y 412 (RTW.7.2), a `e2e/captures/__shots__/tap-wheel/` (gitignoreado). Se dispara con `--config playwright.capture.config.ts`.

Ambos corren sobre el **spike** `/maniobra/rueda-ce` (en `DEV_WEB_ROUTES`, alcanzable en web sin auth/seed — la instancia real de CE hereda el mismo `WheelPicker`), en context propio `hasTouch:true`+`isMobile:true` (Playwright Desktop enmascara el touch, `reference_rn_web_pitfalls`).

> **Reconciliación as-built:** el spec original (T6+T7) folaba las capturas dentro del `.spec.ts` (a `tests/modo-maniobra/`). As-built se SEPARÓ regresión (`.spec.ts`) de captura (`.capture.ts` → `__shots__/`), por ADR-029 + convención del repo (`.spec.ts`=regresión en `pnpm e2e`; `.capture.ts`=Gate 2.5 a mano, shots gitignoreados). El comportamiento verificado es idéntico; solo cambia la ubicación de los `.png`.

**NO se tocan:** `CircunferenciaEscrotalStep.tsx` (hereda el fix del componente — sus dos instancias `ce-wheel`/`age-wheel` quedan tappables sin cambios), `rueda-ce.tsx`, otros steps, **y nada de `supabase/`** (RTW.8).

---

## 2. As-built relevante (por qué el tap engancha limpio)

`WheelPicker` ya tiene toda la maquinaria; el tap **reusa** el mismo camino que el snap/lock por drag:

- **Motor de scroll**: `Animated.ScrollView` (reanimated) con `snapToInterval={cell}` + `decelerationRate="fast"`. `cell = $wheelCell` (64). En web `snapToInterval` **no** es fiable → el snap real lo garantiza el lock JS.
- **Shared values** (worklet ↔ JS): `offsetY` (px crudos, actualizado cada frame por `onScroll`), `scrollIndex` (índice fraccional para el gradiente 3D), `lastNotified` (último índice notificado a JS → evita spamear `onValueChange`/háptica).
- **`notifyIndex(idx)`** (JS): `hapticTick()` + `onValueChange(indexToValue(idx, spec))`. Es el **único** punto de feedback (tick + valor).
- **`lockToOffset(rawOffset)`** (JS): si `isOffsetSnapped` → no-op; si no, `snap = snapOffset(...)`, **sincroniza `offsetY`/`scrollIndex` ANTES** del `scrollTo({animated:true})`, y si `snap.index !== lastNotified` notifica una vez. Este "sync antes" es el patrón que el tap replica (RTW.2.2).
- **Locks de plataforma**: native `onMomentumScrollEnd` (lock inmediato) / `onScrollEndDrag` (diferido, cede al momentum); web `scheduleSettle` (debounce `WEB_SETTLE_MS=140` desde `onScroll`).
- **Sincronía externa** (`value` controlado → rueda): usa `animated:false` **a propósito** para NO pasar por índices intermedios (bug v2 documentado). El tap, en cambio, **sí** quiere animar (D1); la diferencia de intención se resuelve abajo (§4).

Las celdas **hoy no tienen `onPress`**; el gradiente de tamaño/opacidad lo da `useAnimatedStyle` sobre la distancia al centro. Las líneas de selección y los fades son `pointerEvents="none"` (no interceptan el tap del cell central).

---

## 3. Helper puro nuevo — `tapTarget` (RTW.6)

En `wheel-picker.ts`, componiendo helpers ya testeados (cero aritmética nueva):

```ts
export type WheelTapTarget = WheelSnap & { isCentral: boolean };

/**
 * Destino de un TAP sobre la celda `tappedIndex`, dado el offset ACTUAL del scroller. Reusa offsetToIndex
 * (índice centrado actual), indexToOffset (offset destino, múltiplo exacto de cellHeight) e indexToValue
 * (valor de grilla). `isCentral` = la celda tapeada YA es la centrada → el caller hace no-op de valor (RTW.1.4).
 */
export function tapTarget(
  currentOffset: number,
  tappedIndex: number,
  cellHeight: number,
  spec: WheelSpec,
): WheelTapTarget {
  const centeredIndex = offsetToIndex(currentOffset, cellHeight, spec);
  const index = Math.min(wheelCount(spec) - 1, Math.max(0, Math.round(tappedIndex)));
  return {
    index,
    offset: indexToOffset(index, cellHeight),
    value: indexToValue(index, spec),
    isCentral: index === centeredIndex,
  };
}
```

Puro/testeable en `node:test`: destino no central, `isCentral` en el central, clamp en bordes, round-trip con `offsetToIndex(indexToOffset(...))`. No duplica lógica: `offsetToIndex`/`indexToOffset`/`indexToValue`/`wheelCount` ya existen y están cubiertos.

---

## 4. Handler del tap en el componente — cómo engancha con el lock (RTW.1/RTW.2/RTW.4/RTW.5)

### 4.1 `WheelCell` tappable (RTW.1.1, RTW.3.1, RTW.3.2, RTW.5.3)

`WheelCell` recibe dos props nuevas: `onTap: (index: number) => void` y `cellTestID?: string`. El contenido (el `Animated.View` con el gradiente) se envuelve en un `Pressable` que:

- llama `onTap(index)` en `onPress` (el índice lo conoce la celda — sin coordenada-a-valor, RTW.3.2);
- lleva `testID={cellTestID}` = `` `${testID}-cell-${index}` `` para que el E2E ubique una celda visible concreta;
- lleva a11y de botón: `{...buttonA11y(Platform.OS, { label: `Seleccionar ${label}` })}` (RTW.5.3).

Solo se renderizan (y por ende solo son tappables) las celdas del `values.map` dentro del drum; las de fuera del viewport no reciben eventos (RTW.3.1). El `Pressable` dentro del `ScrollView` distingue **tap** (dispara `onPress`) de **drag** (el pan-responder del scroller cancela el press y scrollea) — comportamiento estándar de RN/rn-web; el drag no queda roto (RTW.2.1).

### 4.2 `handleCellTap(tappedIndex)` en el `WheelPicker` (RTW.1.2–1.4, RTW.2.2–2.4, RTW.4.1, RTW.5.1)

Corre en el JS thread (lee `.value` de los shared values). Replica el patrón de `lockToOffset` pero keyed en un **índice conocido** (no en un offset crudo):

```ts
const handleCellTap = useCallback((tappedIndex: number) => {
  const t = tapTarget(offsetY.value, tappedIndex, cell, spec);
  if (t.isCentral) return;                    // celda central → no-op de valor (RTW.1.4)
  if (settleTimer.current) {                  // cancela settle/lock diferido pendiente (RTW.2.3, RTW.5.1)
    clearTimeout(settleTimer.current);
    settleTimer.current = null;
  }
  // Sync ANTES del scrollTo (mismo patrón que lockToOffset): el valor final committeado es el de la celda
  // tapeada, no un índice intermedio; el lock posterior ve el offset ya snapeado y hace no-op (RTW.2.2/2.4).
  offsetY.value = t.offset;
  scrollIndex.value = t.index;
  lastNotified.value = t.index;
  scrollRef.current?.scrollTo({ y: t.offset, animated: true }); // anima suave (RTW.1.2)
  notifyIndex(t.index);                        // háptica settle + onValueChange UNA vez (RTW.1.3/RTW.4.1)
}, [cell, spec, notifyIndex]);
```

Puntos clave del enganche:

- **Reusa el snap por índice + `scrollTo({animated:true})`** que ya existen (D1). El offset destino sale de `tapTarget` (= `indexToOffset`, múltiplo exacto de `cell`).
- **Sync antes del `scrollTo`** (RTW.2.2): `offsetY`/`scrollIndex`/`lastNotified` quedan en el destino → cuando el `onScroll` programático de la animación aterrice en el índice destino, `idx === lastNotified` y **no** re-notifica; y el momentum-end (native) / settle (web) que cierre la animación llama `lockToOffset(offsetDestino)` → `isOffsetSnapped` **true** → **no-op** (RTW.2.4). Sin doble commit ni fight con el motor.
- **`notifyIndex` una sola vez** por el tap (RTW.1.3/RTW.4.1): mismo `onValueChange` + misma `hapticTick` de settle que el drag. Durante la animación de un tap de varias celdas, el `onScroll` puede cruzar celdas intermedias y emitir ticks/valores transitorios — es idéntico a arrastrar por esas mismas celdas (la lectura "barre" hasta el valor y aterriza en él); el valor **committeado final** es el tapeado por el sync de arriba.
- **Fling en curso** (RTW.5.1): el `scrollTo({animated:true})` a un nuevo target **interrumpe** el momentum en vuelo (native cancela el fling; web reemplaza el smooth-scroll destino); el cancel del `settleTimer` evita que un settle diferido asiente el offset pre-tap. Resultado: se asienta en el **tap**, no donde iba el fling. **Criterio propio** (§Decisiones), a confirmar en Puerta 1.
- **No-loop con la sincronía externa** (RTW.5.4): `handleCellTap` deja `lastNotified === t.index`; el efecto `value → rueda` (que compara `targetIndex === lastNotified.value`) ve el eco del propio tap y no re-mueve la rueda.

### 4.3 Plataformas

- **Native**: el `Pressable` distingue tap/drag; el `scrollTo({animated:true})` dispara `onMomentumScrollEnd` al completar → `lockToOffset(offsetDestino)` no-op (ya snapeado). Sin regresión del momentum/drag-end.
- **Web** (`reference_rn_web_pitfalls`): `scrollTo({animated:true})` = `scrollTo({ behavior:'smooth' })` a un offset que **es** un snap-point → aterriza exacto pese a que `snapToInterval` (CSS scroll-snap) no sea fiable. El `scheduleSettle` (debounce) hace de red de seguridad y lockea no-op. El tap-through/click-emulado no aplica al cell (está dentro del body de la card/sheet, no sobre el scrim); el `Pressable` emite un `onPress` por touch → sin doble disparo (RTW.5.2).

---

## 5. Offline-first (regla dura — dato de campo)

La rueda es 🔴 manga (carga en el brete, sin señal). Este delta es **interacción pura**: no agrega ni cambia ningún camino de red ni de persistencia. El valor tapeado fluye por el **mismo** `onValueChange` → estado local del step → write-path offline existente (`addScrotalMeasurement`, PowerSync) del baseline M6. **Offline-first inalterado**: el tap funciona sin conexión igual que el drag (todo el cómputo es local; `hapticTick` degrada en silencio en web).

---

## 6. Multi-tenant / RLS

**N/A** — sin acceso a datos ni `establishment_id` en el alcance del delta (interacción de UI). El write-path aguas abajo ya está cubierto por el baseline M6 (RLS de `scrotal_measurements`), sin cambios.

---

## 7. Alternativa descartada

**Salto instantáneo (`animated:false`) al valor tapeado, notificando una sola vez.** Evitaría por completo cualquier `onValueChange` transitorio durante el barrido (el patrón exacto de la sincronía externa campo→rueda). **Descartada** porque D1 pide explícitamente que el tap **anime suave** hasta centrar el valor (feedback físico del "drum" girando hacia la opción, coherente con el arrastre); un salto seco rompe esa lectura y se sentiría distinto del drag. El barrido transitorio de valores durante la animación es benigno (espeja arrastrar por esas mismas celdas) y el valor **committeado final** ya queda garantizado por el sync-antes-del-scrollTo (§4.2).

**Otra alternativa considerada y descartada:** mapear la coordenada Y del tap a un valor (hit-testing sobre el drum). Innecesariamente complejo y frágil con el gradiente de escala; D3 lo evita: cada celda ya conoce su índice.

---

## 8. Decisiones de criterio propio (marcar en Puerta 1)

1. **Cancelar el fling en curso al tapear** (RTW.5.1): un tap durante un momentum **cancela** el fling y asienta en el valor tapeado (vs. ignorar el tap hasta el settle). Elegido por coherencia con "tapeo lo que veo ahora"; el contexto lo prefiere. → **Confirmar en Puerta 1.**
2. **Háptica del tap = háptica de settle del drag** (RTW.4.1): el tap dispara el mismo `hapticTick` (8ms) que el cruce/settle por drag, vía `notifyIndex`. No se agrega un patrón háptico distinto para el tap. → **Confirmar en Puerta 1.**

Ambas son reversibles sin cambio de arquitectura.

---

## 9. Reconciliación al baseline (al cerrar el delta)

Al aprobarse (Puerta 2) se folda al `design.md` baseline, bajo el bloque **"Deltas posteriores"**, un puntero: `tap-wheel — WheelPicker: celdas tappables (tap→anima+snap al valor), reusa el lock determinístico; frontend-only.` + nota as-built de alto nivel bajo R14.5 (la rueda ahora también selecciona por tap). El `requirements.md`/`tasks.md` baseline **no** se reescriben (ADR-028).
