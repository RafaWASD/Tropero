reviewed_commit_base: 1f1c002a85f5b4d6c2033515180d7c70e8d6dde0 (diff SIN commitear)
informe_revisado: progress/impl_fab-hitslop-pill.md

# Review — unidad «el FAB de Maniobra le roba los taps a la banda de arriba del nav»

## Veredicto: **CHANGES_REQUESTED**

El bugfix del `hitSlop.top` está bien hecho, medido y guardado. **Lo que lo frena es la contracara**: al
volver tocable el pill se creó un target flotante nuevo y se lo contrastó contra **una sola** pantalla. Lo
barrí yo y le roba los toques a controles en **tres** pantallas más, una de ellas el wizard de jornada
(🔴 manga). Y encontré una **fuga en el guard central**: el `hitSlop.top` puede volver en una línea con los
30 casos en verde. Más las specs describiendo un oráculo de E2E que se descartó.

Nada de esto es re-hacer la unidad: son un barrido, una aserción, un regex y tres párrafos de spec.

---

## 🔴 1 — El pill le roba los taps en más pantallas que "Más", y una es un wizard de maniobra

**Medido por mí** (sonda temporal de Playwright, ya borrada; build web @412×915, conexión demo viva,
mismo oráculo de hit-test que usa el guard). Caja del pill constante: `y=[759,799] x=[133,279] 145×40 dp`.

| Pantalla | Controles cuyos toques se queda el pill |
|---|---|
| tab **Inicio** (home) | `"Ir a Animales"` |
| tab **Más** | `"Eliminar campo (acción destructiva)"` ← el único que reporta el informe |
| **`/maniobra/jornada` etapa 2** (elección de maniobras) | `"Antibiótico (tocá para sumar)"`, `"Circunferencia escrotal (tocá para sumar)"` |
| **`/maniobra/jornada` etapa 2** con Vacunación sin producto | `"Antiparasitario (tocá para sumar)"` |
| tab Animales · `/maniobra` (etapa 0) | ninguno |

En las tres el pill es el **elemento topmost** en su centro (medido con `elementFromPoint`).

El informe hace la pregunta correcta (§6 ítem 13) y la cierra con **una** pantalla. Eso es **el mismo error
de método que la entrada de backlog del 2026-07-18** que esta unidad vino a corregir: se previó un solo
caso y se declaró cerrado al no ver más. La unidad escribió en tres archivos que *"cuando se sospecha de la
geometría de un target, se mide contra QUÉ choca"* — y no lo aplicó al target que ella misma creó.

**Severidad**: el daño en runtime es 🟠 (el mis-tap va a `/baston`, la vuelta funciona, el estado del
wizard sobrevive en el stack: dos taps perdidos y confusión, no pérdida de datos). Lo pongo en 🔴 por la
**clase**: es el defecto que la unidad existe para cerrar, reintroducido en la otra dirección, sin barrido
y sin gate. Con guante, en la manga, "me sacó del wizard" no es benigno (CLAUDE.md principio 4).

### Sobre "medido e impreso pero NO asertado"

La justificación del informe (§3 decisión 7) es correcta **para la aserción que plantea**: *"el pill no
tapa nada"* sería falsa por diseño. Pero esa no es la aserción que corresponde. La que corresponde es
acotada y sí es un invariante defendible:

> el pill no se queda con los toques de **ningún control en las rutas 🔴 de manga**
> (`maniobra/*`, `asignar-caravanas`, el sheet de find-or-create)

y **hoy estaría en ROJO** (`/maniobra/jornada` etapa 2). Un número que se imprime y no falla nunca es
decoración; en este caso además tapó el hallazgo. → **tiene que ser una aserción.**

**Qué pido**

1. Barrer las pantallas donde el pill es visible (todas menos `/baston`, con transporte y estado ≠ `'off'`)
   y dejar la lista medida en el as-built.
2. Una aserción acotada a las rutas 🔴 (lista blanca explícita), no el `console.log`.
3. La decisión de producto que la aserción necesite para ponerse verde. No la elijo yo: correr el ancla,
   achicar el target del pill, o algo mejor. **Gatear por ruta ya lo descartó Raf** — no lo re-propongas.

**Sheets modales**: el pill se monta después de `FindOrCreateOverlay` y del `<Stack>` en `BleHost`
(`app/app/_layout.tsx:611-623`) y **ningún** sheet declara `zIndex` (grep vacío en `BottomSheetShell.tsx`,
`FindOrCreateOverlay.tsx`, `TagScanSheet.tsx`), así que pinta y captura por encima de todos los sheets,
incluido el de find-or-create — que es el sheet del bastoneo. **Derivado del orden de render, NO medido
con un sheet abierto**: no lo pude reproducir en la sonda. Entra en el barrido del punto 1.

---

## 🔴 2 — El `hitSlop.top` puede volver en una línea con los 30 casos en verde

**Mutante mío, no está entre los 15 del informe. Ejecutado**, sobre `app/app/(tabs)/_layout.tsx:201`:

```
- hitSlop={HIT_SLOP}
+ hitSlop={{ ...HIT_SLOP, top: FAB_RAISE }}
```

→ `nav-target-bands.test.ts` + `tap-target-collision-guard.test.ts` = **30/30 PASS**.
→ `node scripts/check-hardcode.mjs` = **0 violaciones**.

Por qué se cuela por los cuatro lados:

- **(A)** exime el archivo entero (está en `CHECKED_SLOPS`).
- **(A-fix)** (`tap-target-collision-guard.test.ts:277-296`) solo inspecciona el cuerpo de
  `const HIT_SLOP = { … }`, que sigue sin `top`.
- **(A-inverso)** cuenta ocurrencias de `hitSlop=`: sigue habiendo **1**, así que `declarados: 1` cuadra.
  El campo `declarados` cierra M15 (un *segundo* slop) pero no mira el **valor** del que ya está.
- **(C)/(D)** comparan el espejo del E2E contra los tokens y contra `const HIT_SLOP`; ninguno lee el JSX.
- El **E2E** tampoco: `FAB_HIT_SLOP` (`e2e/fab-target-geometry.spec.ts:34`) es un espejo escrito a mano.
  No puede leerlo del DOM — en web `hitSlop` es no-op. Ese es justamente el motivo de existir del guard
  estático, y es donde el guard estático no llega.

Verifiqué que el camino "obvio" sí está cubierto: re-agregar `top: FAB_RAISE` **dentro** de
`const HIT_SLOP` (el M1 del informe) pone **`(A-fix)` en rojo** — lo corrí. El agujero es el override.

**Fix sugerido** (una línea de regex): que `(A-fix)` valide también el **sitio de uso** —exigir
`hitSlop={HIT_SLOP}` con identificador pelado, o aplicar el `doesNotMatch(/\btop\s*:/)` sobre el `hitSlop=`
del JSX además de sobre la const.

---

## 🟠 3 — Las specs describen un oráculo del E2E que se descartó (paso 6 del protocolo)

El informe cuenta bien que el primer oráculo daba falso positivo y que se cambió a hit-test (§2, §6-5).
**Las specs quedaron con el viejo:**

- `specs/active/04-bluetooth-baston/design-multivendor.md` §7, bloque de guards, pieza 3:
  *"…exige que no se cruce con **ningún** otro elemento interactivo del DOM (**intersección 2D** → cubre
  también las celdas vecinas y el label)"* — **falso dos veces**: (a) el oráculo no intersecta rects,
  muestrea puntos con `document.elementFromPoint`; (b) con `left/right = 0` **ninguna celda vecina se
  muestrea jamás**.
- `specs/active/04-bluetooth-baston/tasks-multivendor.md`, T-MV.4.8: *"(2 casos: **intersección 2D** del
  rect del FAB expandido contra todo elemento interactivo del DOM)"* — mismo error.
- Y el mismo texto viejo quedó en el **código**: `app/src/utils/tap-target-collision-guard.test.ts:73`
  → `verificadoEn: '… + e2e/fab-target-geometry.spec.ts (cajas reales, intersección 2D)'`.

Es exactamente el caso del paso 6: un fix de autorrevisión cambió el mecanismo y el design quedó
mintiendo. Reconciliar los tres sitios.

---

## 🟠 4 — La reconciliación de RMV3.6 subdeclara el cambio de contrato

`requirements-multivendor.md`, nota bajo RMV3.6: *"sigue sin bloquear nada: no hay modal, no hay scrim, la
carga manual queda intacta"*, y el trade-off descrito como *"es un target MÁS flotando sobre las pantallas
de manga"*. El as-built es más fuerte: **el pill le saca los toques a los controles que tapa, en todas las
pantallas donde es visible** (antes los dejaba pasar con `pointerEvents="none"`). El `design.md` sí lo dice
pero con una única víctima en una única pantalla; con 🔴-1 esa redacción quedó corta. Reconciliar junto
con el barrido.

---

## 🟡 5 — `(B)` no vigila la banda del FAB: vigila el token `$fabRaise`

**Mutante mío, ejecutado.** Archivo nuevo con:

```
bottom={safeBottom + getTokenValue('$navBar','size') + getTokenValue('$6','space')}   // = 84 dp
<XStack minHeight="$chipMin" onPress={…} {...buttonA11y(…)}>
```

84 dp es **el pico exacto del círculo del FAB** (`tabBarTop + fabRaise - navItemTop`). → **30/30 PASS**.

El docblock de `(B)` promete *"un toast/snackbar/banner nuevo que se cuelgue ahí arriba nace en rojo,
aunque no declare ningún hitSlop"*. Nace en rojo **solo si el autor casualmente usa `$fabRaise`** — que es
la firma menos probable, porque nadie ancla un toast al pico del FAB: lo anclan al nav. La firma tendría
que incluir `$navBar` combinado con `position="absolute"` / `bottom=`, no solo `$fabRaise`.

(Misma lección que "bug de clase: barrer la ausencia" — el guard se escribió sobre la superficie que
existe, no sobre la forma en que va a nacer la próxima.)

---

## 🟡 6 — Los 3 capture files migrados no se re-corrieron

§7 solo lista `fab-hitslop-pill.capture.ts` (6 PNG). Los otros tres cambiaron anclas (6 sitios) y no
aparecen en la lista de ejecutados. **Los corrí yo y están verdes** — `baston-multivendor.capture.ts` 2/2,
`baston-chip-sin-transporte.capture.ts` 2/2, `baston-spp-bloqueantes.capture.ts` 1/1 — así que no hay
defecto; lo que había era una afirmación de cobertura incompleta.

## ⚪ 7 — Conteos del informe

§7 dice `tap-target-collision-guard.test.ts` **15/15**; son **14** (§2 lo dice bien). Los dos guards
juntos suman **30**.

## ⚪ 8 — Estado en `feature_list.json`

`04-bluetooth-baston` está en **`deferred`** y **no hay ninguna feature `in_progress`**. El paso 2 del
protocolo de review no resuelve. No bloquea el código (es un bugfix sobre una feature diferida); la
coherencia de estado la decide el leader.

---

# Lo que verifiqué EN VERDE (ejecutado, no leído)

- **`node scripts/check.mjs` → RC=0.** Corrida completa mía: "All tests passed" + "Entorno listo".
- **Los dos guards corren de verdad, no solo está el string.** Extraje el comando exacto del bloque de
  `scripts/run-tests.mjs` y lo ejecuté: **2762 tests / 0 fail**, con
  `el target del FAB y el del pill NO se solapan`, `(A-fix) el hitSlop del FAB NO tiene top` y
  `(B) nadie se ancla en la BANDA DEL FAB` nombrados en el log. Además verifiqué que los **148** archivos
  de esa lista existen (ninguno se saltea en silencio).
- **Mutante M1** (re-agregar `top: FAB_RAISE` dentro de `const HIT_SLOP`) → **`(A-fix)` en rojo**.
  Restaurado y verificado por md5.
- **`e2e/fab-target-geometry.spec.ts` → 2/2**, con la medición idéntica a la reportada:
  `pill y=[759,799] alto=40 · FAB y=[820,884] · aire=21 dp · sampled=288` + la línea de la víctima.
- **El oráculo nuevo del E2E no tiene falso positivo propio.** Con `top/left/right = 0` solo muestrea la
  franja de 20 dp **dentro de la propia celda del FAB**, donde el único vecino es su label "Maniobra", que
  se descarta por `contains`. El precio, que hay que decirlo: la aserción (1) es **casi vacua** en el
  as-built; lo que la sostiene es la auto-falsificación (1-bis), que sí es real (con `top:26` muestrea 704
  puntos y encuentra `stick-status-pill`). Está bien resuelto y está escrito en el archivo.
- **`pointerEvents` del contenedor — verificado por COMPORTAMIENTO**, no solo leyendo (sonda mía, borrada):
  `getComputedStyle(contenedor).pointerEvents === 'none'`, el pill `'auto'`, y **7 puntos a lo ancho de la
  banda** (x = 8, 40, 80, 123, 289, 380, 404 @ y=779) resuelven a la pantalla de abajo, **ninguno** al
  contenedor. El borde inferior de las pantallas no se rompe. `box-none` intacto.
- **`role="button"` nuevo: no rompe strict-mode.** El pill está suprimido en corridas E2E no-demo
  (`isNonDemoE2E()`), así que solo lo ven las 5 specs/captures con `__RAFAQ_BLE_DEMO__`, y ninguna usa un
  `getByRole('button', {name})` que pueda colisionar (todas `exact:true` o regex ancladas). Corrido:
  `baston-multivendor` + `baston-chip` + `asignar-caravanas-sin-transporte` → **10/10**; los 3 captures
  migrados → **5/5**.
- **`StickStatusIndicator.tsx` — leído ENTERO** (206 líneas, 12.479 bytes, `+64/−14`). Nada raro del
  incidente de los 343 KB: sin duplicados, sin imports muertos (`labelA11y` salió; `useRouter`,
  `buttonA11y` y `connectionIndicatorA11yLabel` entraron y se usan), comentarios completos, las **4**
  supresiones intactas (`isNonDemoE2E`, `/baston`, `!hasTransport`, `'off'`), `iconFor` /
  `connectionStatusView` / la geometría por tokens intactos. El `toneColorToken` local duplicado **ya
  estaba en `1f1c002`** y está documentado en `connection-view.ts` — no es daño de esta unidad.
- **`lotes.spec.ts:61` → rojo confirmado**, misma firma que reporta el informe (falla en
  `lotes.spec.ts:103`, `getByText(...).first()` → `hidden`), 4/5 del archivo pasan. **No lo cuento como
  regresión.** Aclaración honesta: la atribución al baseline la hizo el implementer stasheando; **yo no la
  re-verifiqué contra `1f1c002`**. Lo que sí verifiqué es que ninguno de los 5 archivos de producción
  participa de esa pantalla.
- **`docs/backlog.md`**: la corrección refleja que la hipótesis **(a)** era la correcta y nombra el error
  de método con precisión (prever **un solo** modo de falla + un experimento que da el mismo resultado con
  y sin el defecto). Cumple lo pedido.
- **Reglas de la casa**: `check-hardcode` 0 violaciones (ADR-023 §4) · `lineHeight="$2"` en el `Text` del
  pill · sin `<Pressable>` de RN envolviendo un Tamagui con `pressStyle` (todo en el mismo `XStack`) ·
  target `minHeight="$chipMin"` (40) para chrome compacto · es-AR voseo en todo el copy nuevo.
- **Sin `git add`, sin commits.** Tree byte-idéntico al de partida (md5 de los 2 archivos que muté y
  restauré), `git status -- design/` **limpio** (no corrí specs de screenshot de `design/`; las capturas
  van a `__shots__/`, gitignored).

---

# Trazabilidad `R<n>` ↔ test

| Requisito / invariante | Test concreto | Estado |
|---|---|---|
| **RMV3.5** el indicador global existe y refleja el estado | `e2e/baston-multivendor.spec.ts` (a–f) · `connection-view.test.ts` | ✅ 10/10 corrido |
| **RMV3.6** (mod.) el CONTENEDOR no captura | `tap-target-collision-guard.test.ts` → `(D) el pill se ancla con TOKENS…` + sonda de comportamiento del reviewer | ✅ |
| **RMV3.6** (mod.) el pill SÍ es tocable → `/baston` | `e2e/fab-target-geometry.spec.ts` → `el pill del bastón es TOCABLE y abre /baston` | ✅ 2/2 corrido |
| **RMV3.6** (mod.) **el pill no le roba toques a controles críticos** | — | ❌ **SIN TEST** (medido e impreso; hoy estaría ROJO en `/maniobra/jornada` etapa 2) → 🔴-1 |
| **RMV3.1** el rótulo de la sección "Dispositivos" | `e2e/captures/fab-hitslop-pill.capture.ts` shots 04/05 | ⏸ pendiente del veto visual del leader |
| **BUG 🔴** el target del FAB no invade a nadie | `nav-target-bands.test.ts` (solape) · `(A-fix)` · `e2e/fab-target-geometry.spec.ts` (1)+(1-bis) | ⚠️ verde, **con la fuga de 🔴-2** |
| El `top` no puede volver | `(A-fix)` | ⚠️ cubre la const, **no el override** → 🔴-2 |
| Separación ≥ piso, en las 4 reservas de plataforma | `nav-target-bands.test.ts` (piso + independencia del inset) | ✅ |
| El pill llega a `$chipMin` | `nav-target-bands.test.ts` + `e2e/fab-target-geometry.spec.ts` (3) | ✅ |
| El fix no crea zona muerta en el FAB | `nav-target-bands.test.ts` (el círculo entero dentro de su target) | ✅ |
| El `bottom` no invade la reserva del sistema | `nav-target-bands.test.ts` | ✅ |
| a11y: el `role="button"` nuevo no rompe strict-mode | `connection-view.test.ts` (6 casos) + 10/10 + 5/5 corridos | ✅ |
| Clase: un `hitSlop` nuevo sin verificar | `(A)` / `(A-inverso)` — M11/M12/M15 rojo, M14 verde | ⚠️ **salvo el override** → 🔴-2 |
| Clase: una superficie nueva en la banda del FAB | `(B)` | ⚠️ **solo si usa `$fabRaise`** → 🟡-5 |
| El fix del `hitSlop` **en device** | — | ⏸ exige build de EAS (gate de `CLAUDE.md`). Correctamente declarado. |

## Tasks completas

**Sí.** `T-MV.4.8` está en `[x]`. Quedan **6** `[ ]` en `tasks-multivendor.md` (T-MV.5.6, T-MV.5.18,
T-MV.6.2, T-MV.6.3, T-MV.7.3, T-MV.7.4), **todas con justificación escrita in-line** (GATED por hardware
RS420, por MFi/negocio, por corrida en device, o doc de cierre de la feature). Ninguna es de esta unidad.

---

# CHECKPOINTS

**C1 — El harness está completo**
- [x] `AGENTS.md`, `feature_list.json`, `progress/current.md`, `progress/history.md`
- [x] `architecture.md`, `conventions.md`, `verification.md`, `specs.md`
- [x] los 5 agentes en `.claude/agents/`
- [x] `node scripts/check.mjs` exit 0

**C2 — El estado es coherente**
- [x] como mucho una feature `in_progress` (hay **0** — ver el punto 8)
- [x] toda feature `done` con tests que pasan
- [x] `progress/current.md` describe la sesión activa

**C3 — El código respeta la arquitectura**
- [x] capas previstas (`app/`, `src/features`, `src/utils`, `src/components`, `e2e/`)
- [x] sin dependencias nuevas en `package.json`
- [ ] **sin logs de debug sueltos** — el `console.log` de `e2e/fab-target-geometry.spec.ts:259-264` es
      deliberado y está documentado, pero es exactamente el vehículo del punto 1: tiene que ser aserción
- [x] no se hardcodea `establishment_id`

**C4 — La verificación es real**
- [x] al menos un test por módulo con lógica
- [x] fixtures reales (Playwright contra Supabase remoto; los puros son aritmética sin mocks)
- [x] el runner muestra > 0 tests y todos verdes (**2762 / 0 fail**)
- [x] RLS → **N/A** (la unidad no toca la DB)

**C5 — La sesión se cerró bien**
- [x] sin artefactos temporales sin trackear (`__shots__/`, `test-results/`, `dist/` gitignored, verificado)
- [ ] `progress/history.md` con entrada de la sesión → **es del leader al cerrar**, no del implementer
- [x] `progress/current.md` actualizado con la unidad

**C6 — Spec Driven Development**
- [x] `specs/active/04-bluetooth-baston/` con los 3 archivos (+ los `-multivendor`)
- [x] `requirements.md` en EARS estricto (la nota de reconciliación no reescribe los EARS, los anota)
- [x] las tasks de la unidad en `[x]`
- [ ] **cada `R<n>` cubierto por >=1 test concreto** → el as-built de RMV3.6 (el pill se queda con los
      toques de lo que tapa) **no tiene test**; y el design describe un oráculo que no existe (puntos 1 y 3)

**C7 — Multi-tenant** → **N/A**: la unidad no toca ninguna tabla, policy ni migración. Diff de
`supabase/` y `sync-streams/` vacío (verificado).

**C8 — Offline-first** → **N/A**: cero red, cero PowerSync, cero repositorio. Geometría + `router.push`.

**C9 — Verificación E2E + visual (ADR-029)**
- [x] suite E2E de regresión verde (`fab-target-geometry` 2/2, BLE 10/10, captures 5/5)
- [x] capture file con los estados clave (`fab-hitslop-pill.capture.ts`, 6 shots, incluido el de PRESS)
- [ ] Gate 2.5 del leader (E2E + capturas + veto visual) → **pendiente, es del leader**
- [x] los `__shots__/*.png` NO están commiteados (gitignored, verificado con `git status --ignored`)

---

# Checklist RAFAQ-específico

**A. Multi-tenancy / RLS** — **N/A**: no toca tablas, policies ni migraciones. Diff de `supabase/` y
`sync-streams/` vacío.

**B. Offline-first** — **N/A**: cero I/O, cero red, cero `establishment_id`. Solo geometría y navegación
local.

**C. BLE (Vesta / Allflex)** — **parcialmente aplicable** (el pill vive del estado de conexión):
- [x] manejo de desconexión repentina + UI clara: el pill refleja `disconnected` / `permission_denied` y
      ahora **lleva** a la pantalla que lo explica (mejora real del delta)
- [x] modo manual de fallback en <=1 tap: intacto; no se tocó la carga manual y `/baston` la ofrece
- N/A correlación TAG-peso por ventana temporal (la unidad no toca ingesta)
- [ ] **los eventos BLE no bloquean el flujo del operario** — el pill sí lo interrumpe ahora: un mis-tap
      sobre una fila de maniobra en `/maniobra/jornada` etapa 2 saca al operario del wizard (punto 1,
      medido). Es la única caja de esta sección que no pasa.

**D. UI de campo (manga, wizard)** — aplica:
- [x] target: el pill llega a `$chipMin` (40) **agrandando la pintura**, que es el bar del repo para chrome
      compacto y la decisión correcta (`$touchMin` 56 sobre un chip flotante sería una losa). El FAB sigue
      en 64 dp + 20 dp de slop hacia abajo, que ahora además hace tocable el label "Maniobra"
- [x] fuente: `fontSize="$2"` con `lineHeight="$2"` **matching**; es chrome de estado, no texto de lectura
- [x] una decisión por pantalla: no agrega formularios
- [x] estado de loading visible: el pill **es** el feedback, y el `pressStyle` se corrigió a `$divider`
      después de falsificar el `$bg` con la captura (ese hallazgo vale)
- [ ] **separación de targets adyacentes**: 20 dp pill-FAB OK, pero el pill **no tiene separación de lo que
      tapa**: cae encima (punto 1)

**E. Edge Functions** — **N/A**: no hay funciones ni cambios en `supabase/`.

---

# Cambios requeridos (priorizados)

1. **🔴 Barrer el pill contra las pantallas donde es visible y asertarlo en las rutas 🔴.** Evidencia
   medida arriba (Inicio, Más, `/maniobra/jornada` etapa 2). Reemplazar el `console.log` de
   `app/e2e/fab-target-geometry.spec.ts:259-264` por una **aserción acotada** (lista blanca de rutas de
   manga) y tomar la decisión de producto que haga falta para ponerla verde. Reconciliar el resultado en
   `design-multivendor.md` §7 y en la nota de RMV3.6.
2. **🔴 Cerrar el override del `hitSlop`.** `app/src/utils/tap-target-collision-guard.test.ts:277-296`:
   `(A-fix)` tiene que mirar también el **sitio de uso** en el JSX (`app/app/(tabs)/_layout.tsx:201`), no
   solo el cuerpo de `const HIT_SLOP`. Hoy el override con spread reabre el bug con 30/30 en verde
   (mutante corrido).
3. **🟠 Reconciliar el oráculo del E2E en las specs y en el código**: `design-multivendor.md` §7 (pieza 3
   de los guards), `tasks-multivendor.md` T-MV.4.8, y `tap-target-collision-guard.test.ts:73`. Ya no es
   "intersección 2D" ni "cubre las celdas vecinas": es un hit-test muestreado de la franja del slop, y con
   `left/right = 0` no toca ninguna celda vecina.
4. **🟠 Reforzar la nota de RMV3.6** en `requirements-multivendor.md`: el as-built no es solo "un target
   más flotando", es "el pill se queda con los toques de los controles que tapa, en todas las pantallas
   donde es visible". Con la lista del punto 1.
5. **🟡 Ampliar la firma de `(B)`** en `tap-target-collision-guard.test.ts:300-312`: hoy solo dispara con
   `$fabRaise`. Un overlay interactivo anclado con `$navBar + $6` (= el pico del FAB) pasa limpio
   (mutante corrido). Sumar la combinación `position="absolute"` + `bottom=` + lectura de `$navBar`.
6. **⚪ Corregir el conteo** de §7 del informe: `tap-target-collision-guard` tiene **14** casos, no 15.
7. **⚪ Decidir el estado de `feature_list.json`** (04 en `deferred`, sin `in_progress`) — es del leader.

## Lo que NO pido que se toque

- El fix en sí (`hitSlop.top` fuera, `bottom` derivado de tokens): correcto, bien medido, bien comentado.
- `minHeight="$chipMin"` en vez de `hitSlop` en el pill: es la decisión correcta y por la razón correcta.
- Los nombres accesibles centralizados en `connection-view.ts` con su test de colisión: bien resuelto,
  incluido el detalle de la puntuación duplicada (WCAG 2.5.3).
- "Bastón" → "Dispositivos" + el `testID`: bien argumentado y bien migrado (los 3 captures pasan).
- La corrección de `docs/backlog.md`: es lo mejor de la unidad. El error de método está bien nombrado.
- `lotes.spec.ts:61`: rojo pre-existente, ya anotado en el backlog. No es de acá.

## Pendiente declarado que acepto como tal

⏸ **El fix no está verificado en DEVICE.** `hitSlop` es no-op en react-native-web, así que la corrección
real solo se prueba en un APK → build de EAS (OK explícito de Raf, por plataforma). El informe lo declara
con el procedimiento de verificación (barrido de `adb shell input tap` en y≈1290, 720×1600 densidad 300).
Correcto: no es una omisión, es un límite del entorno. **No lo cuento en contra.**

---

## Nota de método del reviewer

Todo lo que digo "medido" lo ejecuté yo en esta sesión. Las sondas de Playwright que escribí para el
barrido del pill y para el `pointerEvents` del contenedor **están borradas**; los dos mutantes que corrí
(`hitSlop` con spread override, y el overlay nuevo anclado con `$navBar`) están **restaurados y
verificados por md5**. `git status` quedó idéntico al de partida, `design/` limpio, sin `git add` ni
commits. Lo que no verifiqué está marcado como tal: la atribución de `lotes.spec.ts:61` al baseline, el
comportamiento del pill sobre un sheet modal abierto, y cualquier cosa en device.
