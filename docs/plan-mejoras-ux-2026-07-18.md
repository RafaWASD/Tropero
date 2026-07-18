# Plan de mejoras UX — 2026-07-18

> Sesión de planificación abierta por Raf con un listado de 5 mejoras/correcciones.
> Este doc captura el análisis, las decisiones tomadas y lo que queda pendiente.
> **No es un ADR** — las decisiones que toquen arquitectura (navbar) se promueven a ADR al cerrarse.

## Resumen de estado

| # | Item | Estado | Bloqueante |
|---|---|---|---|
| 1 | Pelaje → catálogo de opciones | Decidido, falta lista | **Facundo** (definir pelajes) |
| 2 | Input de teléfono | Decidido, listo para implementar | — |
| 3 | Orden de lista de miembros | Decidido, listo para implementar | — |
| 4 | Scroll affordance | Política decidida | — |
| 5 | Bottom navbar | Direcciones elegidas, renders en curso | Raf elige diseño final |

---

## 1. Pelaje → catálogo

**Hallazgo clave**: pelaje **no es un `field_definition`**. Es columna hardcodeada
`animal_profiles.coat_color` (text, cap 64 en `0070:194`) con `FormField` de texto libre
en `crear-animal.tsx:1355`. No pasa por el motor de form dinámico.

**Decisión (Raf)**: catálogo cerrado **+ opción "Otro (especificar)"** con texto libre.
Razón del escape: pelaje no tiene autoridad externa (SIGSA pide RFID-SEXO-RAZA-fecha, no
pelaje), y una lista cerrada sin escape puede dejar clavado al operario en la manga con un
término regional que falta. Raza puede darse ese lujo porque la lista la fija SENASA.

**Camino**: replicar el patrón de raza 1:1 — tabla catálogo read-only (molde: `0107_breed_catalog.sql`),
picker sheet (molde: `BreedPickerSheet.tsx`), helper puro (molde: `breed-picker.ts`), trigger que
deriva el id (molde: `0113`). **Descartado**: convertirlo en `field_definition` + `enum_single`
(exige seed per-establecimiento por el filtro `establishment_id IS NOT NULL` de
`local-reads.ts:2251`, más migración de los `coat_color` existentes).

**Gaps colaterales a arreglar en la misma pasada**:
- No editable desde la ficha (`animal/[id].tsx:1016` es `AttributeRow` read-only) mientras raza sí lo es.
- Se oculta si está vacío → sin afordancia de "completá el pelaje" (raza sí tiene CTA).
- **Contradicción spec↔código**: `dominio-categorias-facundo-2026-06-03.md:111` dice que pelaje pasa a
  dato base de todas las categorías y **no opcional**; el código dice `"Pelaje (opcional)"`.

**Pendiente**: que Facundo apruebe la lista. Sin eso no arranca.

### Lista propuesta a Facundo (2026-07-18) — PENDIENTE DE APROBACIÓN

> Enviada como página para que la marque:
> https://claude.ai/code/artifact/c285e038-ba05-4bed-82bc-b4db3617701d
> **Estado: TENTATIVA.** No sembrar ninguna migración con esto hasta que Facundo la apruebe.

**Fuente**: Bavera, G. A. (2009). *El pelaje del bovino y su importancia en la producción*,
1ª ed., Río Cuarto, págs. 27-39 (Sitio Argentino de Producción Animal). Texto de zootecnia
argentino, explícitamente bovino. Las razas asociadas a cada pelaje salen del catálogo SENASA
que ya usa la app (`0107_breed_catalog.sql`).

> ⚠️ **Trampa verificada**: el "Código de Pelajes" de la Sociedad Rural Argentina es de
> **equinos**, no de bovinos (95 pelajes de caballo criollo). No usarlo como fuente acá.
> Dicho eso, términos que parecen equinos (moro, cebruno, rosillo, lobuno) **sí** son
> nomenclatura bovina válida en la tradición argentina según Bavera.

| Grupo | Pelaje | Definición (Bavera) | Razas donde aparece |
|---|---|---|---|
| Base | Negro | Pelos negros sobre piel y mucosas del mismo color | Angus, Brangus, Galloway |
| Base | Colorado (rojo) | Del claro al cereza, hasta requemado / sangre de toro | Angus colorado, Hereford, Shorthorn, Santa Gertrudis |
| Base | Blanco | Plateado, porcelano o rosado según la piel que transparenta | Charolais, Shorthorn blanco, Brahman |
| Base | Bayo | La variante más clara del colorado, amarillenta | Limousin, Criolla |
| Compuesto | Overo negro | Manchas negras y blancas bien delimitadas | Holando Argentino |
| Compuesto | Overo colorado | Ídem con manchas coloradas | Hereford, Simmental, Flamenca |
| Compuesto | Rosillo (ruano, roano) | Pelos colorados y blancos entremezclados, no en manchas | Shorthorn, Criolla |
| Compuesto | Barcino (atigrado) | Rayas verticales oscuras sobre el fondo, como piel de tigre | Cruzas cebuinas (Angus×Brahman, Hereford×Brahman) |
| Compuesto | Moro | Negro mate con pocos pelos blancos, matiz azulado | Criolla, cruzas Shorthorn blanco × Angus |
| Cabeza | Pampa | Cabeza blanca; albinismo típico del Hereford | Hereford, Polled Hereford, Braford |
| Cabeza | Careta | Cuerpo negro con cabeza pampa | Cruza Hereford × Aberdeen Angus |
| Escape | Otro (especificar) | Habilita texto libre | — |

**Criterio de recorte**: la taxonomía de Bavera es exhaustiva (decenas de términos: zaino, cebruno,
lobuno, azulejo, yaguané, tordillo, hosco, más ~40 particularidades). **No** se puede usar entera como
picker: el operario elige con guante en la manga y cada opción de más cuesta tiempo (Hick). Se recortó
al cruce entre la taxonomía y las razas realmente presentes en un rodeo de cría pampeano.

**Las 4 preguntas abiertas a Facundo**:
1. **¿Un campo o dos?** Bavera trata `pampa` como *particularidad de cabeza*, no color de cuerpo
   (un Hereford es `colorado` + `cabeza pampa`). Un solo campo = un toque pero mezcla dimensiones;
   dos campos = más preciso pero dos toques. **Propuesta: un solo campo**, por velocidad de manga.
2. **¿El pelaje identifica o describe?** Si sirve para reconocer un animal con la caravana ilegible,
   la lista necesita más poder discriminante (y quizás más opciones).
3. **¿Obligatorio?** El doc de dominio del 2026-06-03 dice no-opcional; el código dice opcional.
4. **¿Falta o sobra algo?** Términos de uso corriente en la zona que no estén, o de la lista que
   nunca se usen en cría.

## 2. Input de teléfono

**Gold standard (respuesta a la pregunta de Raf)**: **teclado numérico**, no el normal.
`keyboardType="phone-pad"` (no `number-pad`: phone-pad incluye `+ * #`). Razones: prevención de
errores (Nielsen #5), teclas más grandes → Fitts, y es lo que prescriben HIG y Material para
campos `tel`. El teclado completo solo se justifica con alfanuméricos tipo `1-800-FLOWERS`.

**Ya está bien**: los dos inputs usan `phone-pad` + `autoComplete="tel"` + `textContentType="telephoneNumber"`.

**El bug real — asimetría entre los dos inputs**:
| | `crear-campo.tsx:154` (gate al crear campo) | `mas.tsx:464` (perfil) |
|---|---|---|
| `maxLength` | **ausente** | `PHONE_MAX_LENGTH` (20) |
| `onChangeText` | `setPhone` **crudo** | `sanitizePhoneInput(text)` |

El fix se aplicó a un solo lado → en `crear-campo` se pueden tipear letras y largo ilimitado.
Eso es exactamente lo que Raf reportó.

**Gaps de fondo**:
- **Cero normalización**: se guarda el string crudo trimeado. `"+54 9 11 2345-6789"` y
  `"5491123456789"` son filas distintas para el mismo número.
- **Server casi sin validación**: solo `user_private_phone_len_chk` (`char_length <= 32`, `0070:142`).
  Ni formato, ni mínimo. Toda la validación real es client-side → bypasseable vía PostgREST.
- **Techos desalineados**: cliente 20 chars, server 32.
- `inputMode` no está en el contrato de `FormField` (`FormField.tsx:18-49`).

**Decisión (leader, default técnico menor)**: enfoque AR — prefijo `+54` como adorno visual fijo,
10 dígitos nacionales, máscara en vivo `11 2345-6789`, validación de 10 dígitos exactos con escape a
8-15 si el usuario arranca con `+` (caso vet extranjero). CHECK server-side real. **No** se agrega
`libphonenumber` (~150KB para un solo país).

## 3. Orden de la lista de miembros

**Hallazgo**: hoy **no hay `ORDER BY`**. `buildMembersQuery` (`local-reads.ts:303`) y
`buildPendingInvitationsQuery` (`:347`) no ordenan → el orden lo decide SQLite y puede cambiar entre
syncs. No es solo estética: es no-determinismo.

**Decisión (Raf)**: **rol → alfabético dentro de cada rol → "vos" marcado en su lugar** (no primero).

**Razón** (se le discutió la premisa original de "yo primero"): la pantalla existe para gestionar a
**otros**, y la fila propia es la única no accionable — `canManage = isOwner && !m.isCurrentUser`
(`miembros.tsx:234`), no tiene menú `⋯`. Ponerla primera pone una fila muerta en la posición de mayor
valor (tope de lista = mejor Fitts + primera lectura). Además el no-owner ve *solo* su propia fila por
RLS, así que para él el orden es indistinto.

El gold standard está partido y se explica por eso: WhatsApp pone "You" primero porque **ahí tu fila sí
es accionable** (salir del grupo, silenciar). Slack y Notion usan orden estable con badge "you" en su
lugar porque gestionás a otros. RAFAQ está en el segundo grupo.

**Detalles**: los roles reales son **tres**, no cuatro — `owner` / `field_operator` / `veterinarian`
(= Dueño / Operario / Veterinario, `establishment.ts:255`). Entre Operario y Veterinario no hay jerarquía
de permisos; se agrupan igual por legibilidad del equipo (Gestalt: similitud), operarios primero
(equipo diario) y vets después (colaborador externo). El badge "vos" ya existe (`miembros.tsx:402`).

**Además**: ordenar las invitaciones pendientes por `created_at DESC`.

## 4. Scroll affordance

**Hallazgo que cambia el costo**: el primitivo **ya existe, testeado y documentado**.
- `app/src/utils/scroll-affordance.ts` — lógica pura (`scrollFades`, `hasOverflow`) + tests.
- `ScrollAffordanceList` en `CustomManeuverStep.tsx:128-230` — fade arriba/abajo, `ChevronDown`,
  peek, `fadeColorToken` configurable, testIDs.

Está usado en **3 de ~50** contenedores scrolleables. O sea: **promover y adoptar**, no construir.

**Tres datos que simplifican**:
- **La barra NO tapa contenido**: `tabBarStyle` no es `position:absolute`, React Navigation ya achica
  el viewport. Lo único que solapa es **el FAB: 43px** (35 raise + 8 halo). La reserva necesaria es
  modesta, no 94px.
- **`(tabs)/index.tsx:624` (la home) no tiene `paddingBottom` en absoluto** — peor caso y primera
  pantalla. Para un usuario onboardeado la última card de Lote queda pegada al borde, bajo el FAB.
- **`AuthScreenShell.tsx:29` es un solo archivo que arregla 12 pantallas**, incluido el caso original
  del backlog (el link "No tengo cuenta · Registrarme" bajo el fold en login).
- **Cero `FlatList` en el repo** → todo es `ScrollView` mapeado, un wrapper cubre el 100%.

**Decisión (leader)** — regla de decisión única, aplicada consistentemente (ni "una sola solución para
todo" ni "improvisar por pantalla"):
1. Si lo que cae bajo el fold es un **CTA o una decisión** → **footer fijo**, nunca una pista.
   Ya lo hacen bien 14 pantallas.
2. Si es **más contenido del mismo tipo** (una lista) → **peek + fade** con el primitivo existente.
3. **Reserva de fondo obligatoria** en las 4 pantallas de `(tabs)`, codificada en `docs/design-system.md`
   (hoy solo documenta el caso de footers — por eso las 4 hermanas driftearon a tres valores distintos:
   `0`, `$8`, `insets.bottom+$6`).

**Deuda menor a foldear**: las 14 pantallas con footer fijo hardcodean `+ 12` en vez de usar
`$navBottomMin`, contra lo que prescribe `docs/design-system.md:105`.

## 5. Bottom navbar

**Medidas (fuente: código, no estimadas)**: barra 60px + `max(insets.bottom, 12)` → **94px en iPhone**.
FAB ⌀64 elevado 35px = **54.7% del círculo sobre la barra**, más halo ⌀80 → la masa visual invade
**43px** de contenido. Footprint total con halo: **137px en iPhone**.

**Diagnóstico — de las dos hipótesis de Raf, gana la segunda**:
- *"Está muy grande"*: la barra **no** es el problema. 60px está entre iOS (49) y Material (80), y para
  manga conviene grande. Lo que pesa es el conjunto FAB+halo.
- *"El FAB está muy arriba"*: **sí, y con evidencia dura.** El side-by-side contra Mercado Pago con el que
  se validó el diseño (`design/stitch-iter-4/nav-sbs-halo.png`) está titulado **"FAB 33%"** y al medirlo da
  35.5%. El código shippeó en **55%** (`FAB_RAISE_RATIO = 0.55`, así desde el primer commit del scaffold
  `5fe5f25`). **La comparación que validó el diseño nunca se rehizo con el valor implementado.**

**Principios violados**:
- La skill `design-review` nombra explícitamente "cuánto asoma un FAB sobre el navbar" como caso de la
  **regla de los tercios**, y dice evitar el centrado muerto. 55% ≈ centrado muerto; 33% cumple.
- **Gestalt figura-fondo**: el halo translúcido cruzando el borde de la barra es ambiguo — es un parche
  que suple la ausencia de una muesca/cradle (que es como Material resuelve el FAB-en-barra).

**Evidencia externa (Mobbin)**: dos búsquedas explícitas del patrón ("elevated center button",
"protruding above the bar overlapping it"), 12 pantallas devueltas (Strava, Slopes, Shazam, Apple News,
Notion, Superpower, Obsidian, Cosmos) → **cero** elevan un FAB sobre la barra. Strava —el análogo
funcional exacto, "Record" arranca una sesión que toma el control de la app, igual que Maniobra— lo pone
**inline, mismo baseline, mismo tamaño**. El FAB que sobresale es patrón Material 2 (~2016-2020).
Nota: **MP no le pone label al botón** (el QR es un círculo pelado); RAFAQ le agregó "Maniobra" debajo.

**Decisión (Raf)**: renderizar dos familias para comparar —
- **Familia A** (FAB elevado, proporción corregida; respeta ADR-018): A1 raise 0.33 + halo actual ·
  A2 raise 0.33 + halo ajustado · A3 raise 0.25 sin halo · A4 raise 0.42 sin label (estilo MP).
- **Familia D** (barra flotante pill): D1 pill con FAB inline · D2 pill + FAB separado a la derecha ·
  D3 pill + FAB separado centrado.
- Más A0 (baseline 0.55) como contraste.

Descartadas por ahora: FAB inline estilo Strava, y notch/cradle real.

**Implicancia de proceso**: la Familia D (y el inline) contradicen **ADR-018** ("centro, elevado") →
si Raf elige esa dirección, requiere **enmienda del ADR**, no es un cambio de token.

### Resultados de los renders (capturas en `design/nav-iter-2/`)

**⚠️ CORRECCIÓN al diagnóstico de arriba.** La tesis de "drift sin explicación" del 0.55 era
INCOMPLETA. El raise alto tiene una razón funcional: el label "Maniobra" vive en
`position:absolute; bottom:-2` de una celda de 60px (su techo de tinta cae en y≈47) y el círculo
mide 64, con fondo en `64 − raise`. Despejar el label exige:

| | raise mínimo |
|---|---|
| solo el círculo | ≥ .33 |
| círculo + halo +4 | ≥ .39 |
| círculo + halo +8 (el actual) | ≥ .45 |

Con el halo actual, **cualquier raise bajo .45 pisa el label** — verificado en A3 (el círculo recorta
el techo del glifo). O sea: **el culpable es el HALO, no el raise.** El halo existe para fingir una
separación figura-fondo que la barra no da (no hay muesca, es solapamiento plano), y ese parche es lo
que fuerza a elegir entre FAB bajo y label legible.

**Familia D DESCARTADA** (las 3 fallan, no por afinar):
- **Oclusión intrínseca**: un pill flotante siempre tapa una fila a mitad de scroll. La barra actual
  NO tapa nada (no es `position:absolute`; React Navigation achica el viewport). D introduciría un
  problema que hoy no existe.
- **Pierde el label "Maniobra"** (no entra en 60px de pill) → *mystery meat* en la acción primaria.
  El ⚡ no es universal como el QR de Mercado Pago.
- Figura-fondo débil (pill blanco sobre cards blancas) y **D1 achica el target 64→48 = −44% de área**
  (regresión de Fitts en pantalla 🔴).

**B5 (muesca/cradle real) DESCARTADA**, y es un dato valioso: la muesca es **invisible** porque dentro
del recorte el píxel es `$bg` (250,249,248) y fuera `$white` (255,255,255) — 2% de luminancia. Una
muesca Material funciona porque revela contenido en contraste; acá la barra se apoya sobre un fondo
casi idéntico. Además a raise .33 el arco degenera y secciona la barra. **La muesca NO rescata la
figura-fondo si se saca el halo.**

### El label "Maniobra" 12px más abajo — NO es defecto, es decisión (resuelto con Raf)

> **Resolución (Raf, 2026-07-18)**: el offset se **mantiene**. Raf ya lo conocía y lo considera parte
> de la diferenciación del FAB respecto de las tabs. **El leader coincide.** Fundamento: ADR-018 define
> el FAB como *no-tab* (entrada al wizard), y la skill `design-review` nombra explícitamente el label
> del FAB como caso de distinción justificada. El label ya se diferencia por peso (700 vs 500), tamaño
> ($2 vs $1) y color; la posición es un eje más de la misma decisión deliberada.
>
> **Única objeción vigente (menor)**: hoy los 12px no son un valor ELEGIDO sino el resultado de
> `position:absolute; bottom:-2`, un workaround por no entrar el FAB (64) en la celda (60). Al
> implementar, volverlo deliberado y elegir el offset (12 puede estar bien; 8 quizás se lea mejor)
> en vez de heredar el que quedó.
>
> **Consecuencia estratégica — esto cambia la decisión de diseño**: manteniendo el label abajo, el
> círculo solo debe despejar y≈45, y toda la familia B queda viable con recortes grandes de oclusión.
> **Alinearlo habría forzado el raise a ~.50 (C1, 1231 px²), comiéndose casi toda la ganancia.**
> El leader había encaminado a Raf hacia C1 tratando esto como defecto; **corregido**.
>
> **Recomendación vigente del leader: familia B, preferentemente B1** (64 · .33 · sin halo): −49% de
> oclusión conservando los 64px de target primario. B3 tapa menos (−61%) pero cuesta 8px de target en
> una pantalla 🔴 manga.

<details>
<summary>Medición original que abrió el tema (se conserva por trazabilidad)</summary>

Medido de forma independiente por el leader sobre `A0-baseline.png` (techo de tinta, px CSS):

| label | techo de tinta |
|---|---|
| Inicio · Animales · Reportes · Más | y ≈ **35** |
| **Maniobra** | y = **47** |

**Presente en lo que shippea hoy.** Es violación de ritmo/alineación de grilla: los 5 items son pares
y 4 comparten baseline. Que "Maniobra" sea más grande y bold es distinción justificada (etiqueta la
acción primaria); que cuelgue 12px NO es énfasis, es desalineación. Causa: el FAB (64) no entra en la
celda (60), así que el label se sacó del flujo con `absolute; bottom:-2`.

</details>

### El trade cuantificado (esto decide el diseño final)

Para alinear el label, el fondo del círculo debe despejar y≈33 → `tamaño × (1 − raise) ≤ 30`:

| FAB | raise mínimo para alinear | intrusión |
|---|---|---|
| 64px | ≥ .53 | 34px |
| 56px | ≥ .46 | 26px |
| 48px | ≥ .375 | 18px |

**Con FAB de 64, alinear el label exige raise ≥ .53 — prácticamente el 0.55 actual.** Alinear y bajar
el FAB son incompatibles a 64px; para las dos cosas hay que achicar el círculo.

**Observación de Raf, verificada**: el área que el FAB tapa no baja linealmente con el raise — al
asomar poco, lo que sobresale es un casquete circular fino, no medio disco.

| variante | asoma | área ocluida | vs A0 |
|---|---|---|---|
| A0 (hoy, 64 · .55) | 34px | ~1800 px² | — |
| B4 (64 · .40 · halo+4) | 26px | ~1201 px² | −33% |
| B1 (64 · .33 · sin halo) | 21px | ~918 px² | −49% |
| B3 (56 · .33 · sin halo) | 18px | ~708 px² | −61% |
| C1 (56 · .50 · label alineado) | 28px | ~1231 px² | −32% |

**La tensión final**: *label en ritmo* vs *tapar menos*. Alinear el label devuelve el casquete a medio
disco. B1/B3 tapan bastante menos pero conviven con la desalineación. Ronda 3 (C1/C2/C3 + comparativa
`sbs-DECISION.png`) en curso para que Raf decida con el área ocluida medida, no estimada.

**Decisión de Raf — historial**:
1. Primero eligió el paquete C1 (FAB 56 · raise ~.50 · label alineado), pero pidió NO descartar B1-B4
   ("no asoma TANTO como antes y tapa menos porque en el borde es menos ancho que en la mitad" —
   observación correcta, verificada: la oclusión no baja linealmente con el raise, es un casquete
   circular, no medio disco).
2. Después aclaró que **el label abajo le parece bien** y es parte de la diferenciación del FAB.
   → **C1/C2/C3 quedan como referencia, no como camino.** La decisión se mueve a la familia B.

La ronda 3 se dejó correr igual: el cuadro `sbs-DECISION.png` (7 paneles A0·B1·B3·B4·C1·C2·C3 con
área ocluida medida) sirve ahora para VER el costo de alinear al lado del de no alinear.

### ✅ DECISIÓN FINAL (Raf, 2026-07-18): variante **B4**

**B4 = FAB 64px · raise .40 · halo +4 · label abajo (sin alinear).**
Figura-fondo: **se conserva el halo verde** (no se adopta el anillo opaco propuesto).

Elección conservadora y coherente: conserva los 64px del target primario Y el halo, o sea mantiene la
identidad visual actual y no abre el riesgo de figura-fondo. **No contradice ADR-018** ("centro,
elevado, ~64px") → **no requiere enmienda de ADR**, solo reconciliar números en `docs/design-system.md`.

**Áreas MEDIDAS** (método: frame real vs frame de control con el disco oculto, conteo de píxeles sobre
el PNG, no fórmula analítica):

| var | label | target | área ocluida | vs A0 |
|---|---|---|---|---|
| A0 (hoy) | abajo | 64 | 2.484 px² | — |
| B3 | abajo | 56 | 639 | −74% |
| B1 | abajo | 64 | 871 | −65% |
| C1 | alineado | 56 | 1.091 | −56% |
| **B4 ← elegida** | abajo | 64 | **1.510** | **−39%** |

> ⚠️ **Corrección de un error del leader**: se le dijo a Raf que alinear el label "se comía casi toda
> la ganancia", estimando A0 en ~1800 px². Medido, A0 son **2.484 px²** (de los cuales **942 = 38% es
> halo puro**). Alinear costaba solo **9 puntos** (B1 −65% vs C1 −56%), no la mayoría de la ganancia.
> La preferencia de Raf por el label abajo se sostiene por sus propios méritos, pero fue tomada sobre
> un número inflado. Registrado para que no quede la versión equivocada.

**Cambio de implementación** (chico): `FAB_RAISE_RATIO` 0.55 → **0.40** · `$fabRaise` 35 → **26** ·
`$fabHaloInset` 8 → **4** · `$fabHalo` 80 → **72** (en `app/tamagui.config.ts`), + reconciliar la tabla
de tokens de `docs/design-system.md:99-101`.

### 🔴 HALLAZGO SEPARADO Y MÁS GRAVE — zona muerta de tap en el FAB (a verificar en device)

El círculo del FAB se dibuja **fuera de su celda** (34px hoy, vía `marginTop: -$fabRaise`). En React
Native los toques fuera de los límites del padre **no se entregan** (ni Android ni iOS). → **la mitad
superior del CTA más importante de la app podría no responder al tap en nativo.**

- En **web anda** (el DOM no clipea toques igual) — y la app se validó SIEMPRE en web hasta el
  bring-up nativo de 2026-07-16. Ver memoria `project_frontend_web_only_native_bringup`.
- Posible parentesco con el bug de taps Pressable/Tamagui ya barrido en 6 lotes
  (`reference_rn_pressable_tamagui_tap`, commits hasta `47a4b5c`), o independiente.
- **Independiente de la variante elegida.** B4 baja la zona muerta de 34px a 26px, pero no la elimina.
- **Fix**: `hitSlop` o un contenedor que abarque el círculo.
- **Test para Raf (iPhone, build preview)**: abrir la app y tocar el FAB **solo en su mitad de arriba**
  (la que sobresale por encima de la línea de la barra). Si no abre MODO MANIOBRAS, está confirmado.

**Mitigación PARCIAL aplicada**: `hitSlop` vertical en el Pressable. **NO recupera los 26px que
sobresalen** (`hitSlop` agranda el target *dentro* del ancestro). Sí gana: el target baja hasta el pie
de la celda → **el label "Maniobra" pasa a ser tocable** (antes no lo era) y el área útil in-bounds
crece de 64×38 a 64×58. **Descartado** agrandar el tabBar: dejaría una franja transparente de 412×26 a
ancho completo que en nativo igual captura toques → rompería botones y scroll en el borde inferior de
TODAS las pantallas. Fix real (overlay absoluto en el layout raíz con `pointerEvents="box-none"`)
**backlogueado** con el diagnóstico completo.

### 🐛 Bug encontrado de rebote — el halo se pintaba ENCIMA del FAB (preexistente)

Al verificar B4 sobre el nav canónico apareció que **el FAB de la app real nunca fue `$primary`**: el
relleno medido era `(82,142,112)` = `$primary` + 45% de `$greenLight` superpuesto. El halo estaba
montado como **hijo** del FAB con `zIndex:-1`, y eso no lo manda atrás: en RN-web el `<button>` computa
`position:relative; z-index:0` → crea stacking context; y en **nativo** un hijo nunca se pinta detrás
del background de su padre. **Roto en ambas plataformas desde el primer commit del scaffold.**

Detalle incómodo: el side-by-side original contra Mercado Pago (`design/stitch-iter-4/nav-sbs-halo.png`)
ya mostraba `(82,142,112)`. El leader lo midió al arrancar la sesión y lo anotó como "raro" sin
reconocerlo. **El bug estuvo a la vista todo el tiempo.**

**Fix**: el halo pasa a ser **hermano anterior** del círculo. Verificado por medición: relleno
`(30,90,62)` exacto, geometría y sombra sin cambios (reviewer comparó el perfil de sombra píxel a píxel:
idénticos). El anillo **se lee mejor** que antes — antes el disco lavado competía con el anillo y no
había figura-fondo.

**Advertencia general que salió de acá**: `{...shadows.*}` spreadeado sobre un componente **Tamagui**
NO equivale al estilo RN crudo — Tamagui trata `elevation` como shorthand propio y re-deriva la sombra,
atenuándola. El implementer lo cazó midiendo, no mirando. Usar `View` de RN con el estilo crudo.

**Beneficio lateral** (hallazgo del reviewer): a **360px** el halo pasó de ⌀80 —que desbordaba 4px sobre
las celdas vecinas— a **⌀72 = exactamente el ancho de celda**. B4 arregla de paso un desborde visual
preexistente.

**Estado**: ✅ B4 aplicado · ✅ `design-system.md` reconciliado · ✅ harness borrado · ✅ fix del halo ·
✅ reviewer APPROVED. **PENDIENTE**: Gate 2 → commit · verificar la zona muerta de tap en device ·
falta una captura a 360px de la variante elegida (el convenio del repo es 412 **y** 360).

---

## Empaquetado propuesto

- **Delta chico "fixes de forms"**: teléfono (#2) + orden de miembros (#3). Acotados, sin deps externas.
- **Delta "scroll policy"**: #4 — promover el primitivo a `src/components/`, arreglar `index.tsx` y
  `AuthScreenShell.tsx`, codificar la regla en `docs/design-system.md`.
- **Loop de diseño**: #5 — renders → Raf elige → implementación + posible enmienda de ADR-018.
- **Gate 0**: #1 pelaje — arranca cuando Facundo defina la lista.

## Pendientes de Raf

- Definir con Facundo la lista de pelajes (bloquea #1).
- Elegir la variante final de navbar cuando estén los renders (#5).
- Decidir qué terminal aplica `HANDOFF-feature19-closeout.md` (pide tocar `feature_list.json` +
  reconciliar specs de la 19; esta terminal no lo aplicó por disciplina de terminales paralelas).
