# Plan de mejoras — tanda 2026-07-20

> **Estado**: orden **aprobado por Raf (2026-07-20)**. Ninguna unidad arrancada todavía.
> **Origen**: tanda de 9 reportes de Raf (device iOS + Android) + 1 pedido de dominio de Facundo.
> **Bloqueo de arranque**: la feature 20 (`20-reactividad-sync`) está en revisión. Regla de una feature
> activa por vez → no se arranca nada de acá hasta cerrar su Puerta 2.
>
> Tanda anterior: `docs/plan-mejoras-ux-2026-07-18.md` (de la cual **sigue pendiente el scroll affordance**,
> que se fusiona acá — ver U2).

## Agrupamiento: 9 reportes → 12 unidades

Tres reportes mezclaban cosas de naturaleza distinta y se parten; uno se fusiona con deuda previa.

| Reporte | Unidades | Por qué |
|---|---|---|
| 1 escala 1-9 | **U1** | Una sola: toca modelo de datos, no solo UI |
| 2 teclado tapa el CTA | **U2** (fusionada con el scroll affordance pendiente) | Mismo principio: *always-available primary action*. Separarlos daría dos primitivas que compiten |
| 3 preñez duplicada | **U3** | Atómico |
| 4 ficha incompleta | **U4** | Una unidad + auditoría de paridad listado↔ficha |
| 5 vacunas nativo | **U5** | Atómico 🔴 |
| 6 reportes | **U6a** bug de año · **U6b** skeletons · **U6c** límite de años | Un bug de correctitud, un polish y una decisión de producto. Naturalezas distintas |
| 7 navbar Android | **U7** | Atómico |
| 8 invitaciones | **U8a** deep links · **U8b** link duplicado | Una es config nativa + dominio; la otra es una línea |
| 9 seguridad del token | **U9** | Revisión de seguridad |

---

## Orden de ataque (aprobado)

### Tier 1 — rompe o miente, y sale barato

**U5 · Vacunas no cargan en maniobra nativo** 🔴
Anda en web, no en nativo. **Hipótesis fuerte**: es el bug conocido de `Pressable` de RN envolviendo un
Tamagui con `pressStyle` — el responder se lo roba el Pressable y `onPress` no dispara en nativo (ver
memoria `reference_rn_pressable_tamagui_tap`; ya se barrió en 6 lotes, este se escapó). Si es eso, es de
una línea. Máxima prioridad: es 🔴 manga y está roto en device.

**U6a · Reportes no filtran por año**
"Servidas" (y posiblemente otros) no está atado a campaña/año → muestra lo mismo sin importar el año
elegido. Un número mal es peor que ningún número: destruye la confianza en el módulo entero.

**U3 · Preñez duplicada en el alta durante una maniobra de tacto**
Al dar de alta una hembra DURANTE una maniobra que mide tacto, no preguntar preñez en el alta: la
maniobra la va a pedir igual → registro duplicado. Chico y evita datos basura en el momento de carga.

**U8b · Link de invitación duplicado en WhatsApp**
El mensaje sale con la URL dos veces. Probablemente el texto compartido ya incluye la URL y la API de
share la vuelve a anexar. Una línea.

### Tier 2 — alto valor, costo medio

**U7 · Navbar pegado a la barra del sistema en Android**
En iOS quedó impecable; en Android el tab bar queda pegado a la barra del SO. **No se esconde la barra
del sistema** (ver §Respuestas). El fix es de insets. Barato, muy visible, y es el mismo archivo que ya
tocamos en la tanda anterior (`app/app/(tabs)/_layout.tsx`).

**U8a · Deep links de invitación**
Sube de tier porque **desbloquea probar multi-usuario**, que hoy es imposible. Sin esto no se puede
testear invitaciones, roles ni nada de lo que arregla la feature 20 — incluida la propia revocación
en caliente.

**U9 · Seguridad del token de invitación**
Revisión primero (security_analyzer), acción después. Ver §Respuestas para el marco.

**U4 · Ficha de animal incompleta**
Los dientes no se muestran en "estado actual", y hay datos que sí aparecen en la card del listado del
rodeo (ej. el tag de "vacía") y no en la ficha. Incluye **auditoría de paridad**: enumerar qué muestra
la card vs. qué muestra la ficha y cerrar la brecha, en vez de parchear campo por campo.

### Tier 3 — features

**U2 · CTA siempre visible (teclado + scroll)** — inversión de design system, alto valor.
**U1 · Escala 1-9 de condición corporal** — ver el hallazgo de §Respuestas, cambia el diseño.
**U6c · Límite de años en reportes** — ✅ **DECIDIDO: opción B** (Raf, 2026-07-20). Rango limitado
**más** carga manual de los 3 KPIs (preñez, parición, destete) para años anteriores, en una sola unidad.
Se descartó la opción C (piso ahora / carga manual después): Raf prefiere entregarlo completo.
**U6b · Skeleton loaders** — polish; Raf los quiere a futuro en toda la app (anotado en backlog).

---

## Respuestas a las preguntas abiertas

### U1 — la conversión de escalas es EXACTA, no aproximada

Facundo escribió "esto es aprox". **No lo es.** Con paso 0,25 la escala 1-5 tiene 17 valores; con paso
0,5 la escala 1-9 tiene 17 valores. La conversión es biyectiva:

```
score9 = 2 × score5 − 1
```

Se verifica contra su propia tabla (1→1, 1,5→2, 2→3, 2,5→4, 3→5, 3,5→6, 4→7, 4,5→8, 5→9) y contra su
propio ejemplo de borde: `f(4,25) = 7,5`, que es exactamente lo que él dijo.

**Consecuencia de diseño**: se guarda **un solo valor canónico** y se renderiza en la escala que cada
usuario prefiera, **sin pérdida**. Dos usuarios con escalas distintas siguen siendo comparables y el
benchmarking no se parte en dos poblaciones. Si la conversión hubiera sido aproximada habría que guardar
la escala junto al valor, y todo — reportes, comparaciones, promedios — se ensuciaba.

⚠️ **Pendiente de Facundo**: confirmar que las granularidades son las correctas (0,25 en la de 1-5 y
0,5 en la de 1-9). De eso depende que la biyección se sostenga.

### U7 — no se esconde la barra de Android

El modo inmersivo es para video y juegos. Esconder la navegación del sistema en una app de carga de
datos rompe la expectativa del usuario, va contra las guías de Android, y en navegación por gestos la
barrita no se puede ocultar de forma confiable.

El problema real: Expo 56 apunta a Android 15, donde **edge-to-edge es obligatorio**, y el tab bar no
está respetando el inset inferior. El patrón correcto ya está escrito en nuestra propia skill de diseño
(`.claude/skills/design-review`): `paddingBottom = max(insets.bottom, mínimo)`. Está documentado y no
aplicado al tab bar.

> ⚠️ **CORREGIDO (unidad «aire», 2026-07-26): ese patrón estaba MAL y era la causa de un segundo bug 🔴.**
> `max(insets.bottom, mínimo)` reserva la barra del sistema **y nada más** en cualquier device con barra
> real (`max(48, 12) = 48`): el mínimo solo puede ganar cuando el inset es 0, o sea en web. Medido en el
> device de Raf (Samsung, 3 botones): el CTA quedaba a **1dp** de la barra.
> La fórmula correcta tiene **tres** términos, no dos:
> `paddingBottom = max(insetVigente, insetArranque, $navBottomMin=12) + (Android ? $navBarGap=16 : 0)`.
> El **aire** se suma **solo en Android**, donde el inset inferior ES la barra de navegación que el SO
> dibuja sobre el contenido; en **iOS** el inset de 34pt ya es espacio pintado con el fondo de la app (el
> home indicator es una pildorita fina adentro), así que sumarle aire solo engorda la tab bar (94 → 110pt)
> y come zona de pulgar. El **piso** `$navBottomMin` sigue existiendo para web (inset 0).
> Se pide con `useSafeBottomInset()`. Resultado: **web 12 · iOS 34 · Android 3 botones 64** — o sea, esto
> **no cambia nada en iOS ni en web**; solo arregla Android. Detalle en `docs/design-system.md` §4.
> Lo que U7 sí arregló y se conserva: el piso por `initialWindowMetrics` (frame-0 de Android edge-to-edge)
> — y su follow-up flageado, sembrar el `SafeAreaProvider` raíz con `initialMetrics`, quedó hecho acá.

### U8a — sí se puede antes de las tiendas

Universal Links (iOS) y App Links (Android) funcionan con builds `preview`. Requieren publicar los
archivos de asociación en `app.rafq.ar` (`apple-app-site-association` y `assetlinks.json`) más la
configuración en `app.config.ts`. Es el camino real y hay que hacerlo igual para producción → no es
trabajo tirado. Como red mientras la verificación propaga, la página web puede detectar mobile y
redirigir al scheme propio (`rafq://`).

### U9 — marco de seguridad del token (a auditar, no concluido)

**Encriptar el token no sirve**: quien recibe la invitación tiene que poder presentarlo, así que es un
token portador de todos modos; encriptarlo solo agrega una llave que también viaja. Lo que importa:

1. **¿Al aceptar se verifica que el email coincide con el invitado?** Es *la* pregunta. Si cualquiera con
   el link entra, un reenvío de WhatsApp mete un desconocido al campo.
2. ¿Vence? ¿En cuánto?
3. ¿Es de un solo uso?
4. ¿Se puede revocar una invitación ya enviada?
5. Entropía y generación (¿CSPRNG?).
6. ¿Filtra por referrer, logs o historial?

### U6c — ✅ DECIDIDO: opción B (Raf, 2026-07-20)

> Se implementa la **opción B**: rango limitado **+** carga manual de preñez, parición y destete para
> años anteriores, como una sola unidad. La opción C quedó descartada por preferencia de entregar
> completo en vez de en dos tiempos. El análisis de las tres se conserva abajo por trazabilidad.

- **Opción A de Raf** (no permitir años anteriores al alta en la app): simple, previene el absurdo, pero
  **mata el pilar de benchmarking justo en el año 1** — el productor abre reportes, no tiene con qué
  comparar, y la sección parece vacía exactamente cuando está decidiendo si la app le sirve.
- **Opción B de Raf** (rango razonable + carga manual de % de preñez, parición y destete para años
  anteriores): mejor producto. Los tres KPIs que nombró son justamente los que un productor sabe de
  memoria de sus propios registros.
- **Opción C (propuesta)**: que el límite y la feature sean **el mismo gesto de diseño**. Piso sensato en
  el selector, y para los años sin datos un estado vacío deliberado ("no hay datos de 2023") con un CTA
  *"cargar datos históricos"*. El borde deja de ser una restricción y se convierte en la invitación.
  Se shippea el piso ahora (barato) y la carga manual como feature chica después.

Con ojo de diseñador: un selector que te deja llegar a 1847 no es libertad, es una falla de affordance.
Acotarlo **es** el fix, no una limitación.

---

## ⛔ Fuera del alcance de esta terminal — BLE / bastón

**Raf está desarrollando TODO lo relacionado a bastón y Bluetooth en otra terminal** (2026-07-20). Esta
terminal **no toca** nada de eso, incluido el fix de UX del botón "conectar bastón" que no puede
funcionar en nativo (no hay librería BLE instalada y `selectTransportAdapter` devuelve `'manual'` en
todo nativo a propósito — feature `04-bluetooth-baston` en `deferred`). Archivos a evitar:
`app/src/services/ble/**`, `app/src/components/BleConnectionChip.tsx`, `app/src/components/TagScan*`,
`app/src/components/ble-connection-view.ts`.

⚠️ **Riesgo de coordinación a vigilar**: si la terminal de BLE mueve la feature 04 a `in_progress`, van a
quedar **tres** features activas (16, 20 y 04) y `check.mjs` ya marca la regla de una sola. Además esta
terminal es hoy dueña de `feature_list.json` y `progress/`. Conviene definir quién escribe qué antes de
que las dos toquen los mismos archivos de coordinación (ver memoria `feedback_parallel_terminals`).

## Notas de ejecución

- **U2 absorbe el scroll affordance** de la tanda anterior. La política ya decidida allá (CTA abajo del
  fold → footer fijo, nunca un hint; más contenido del mismo tipo → peek + fade; reserva inferior en las
  4 pantallas de `(tabs)`) se extiende con el caso del teclado. Patrón: *keyboard accessory view* /
  *sticky action bar*; en las pantallas 🔴 de maniobra es no negociable.
- **U5 se verifica en device**, no en web: es justamente un bug que no se reproduce en web.
- **U6b (skeletons)**: Raf los quiere a futuro en TODA la app → entrada propia en `docs/backlog.md`.
