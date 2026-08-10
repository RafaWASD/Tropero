# Brief para el manual de marca

**Para Pilar · 02/08/2026**

Va junto con la lámina de identidad visual actual (el PDF con la paleta, los contrastes y la tipografía). Esto es el complemento: **qué de lo que hay es estético y se puede mover, y qué es funcional y no se toca.**

---

## 1. Dónde vive esta marca

No en una pantalla de escritorio en una oficina. Vive en **un celular, al aire libre, a pleno sol, en la mano de alguien con guante, barro y a veces sangre**, que está apurado porque tiene un animal esperando en la manga.

Ese ambiente manda sobre cualquier decisión estética. Una paleta que se ve preciosa en una pantalla calibrada y se lava al sol no sirve, y el que la sufre es un peón que abandona la app en la segunda jornada.

El producto: app de gestión de rodeo bovino de cría. Se carga animal por animal en el corral, funciona sin señal, y lee la caravana electrónica con un bastón por Bluetooth.

---

## 2. Lo que se puede mover libremente

- **El matiz del color primario.** Hoy es verde botella. Puede cambiar entero.
- **La temperatura del neutro base.**
- **El color de contenedores y badges.**
- **La tipografía**, con las condiciones del punto 4.
- **Toda la identidad gráfica**: no hay logo, no hay isotipo, no hay nada. Estás en hoja en blanco.

## 3. Lo que no se puede mover (y por qué)

**Contraste mínimo AA (4.5:1) en todo par de texto sobre fondo.** No es un capricho de accesibilidad: es que la pantalla se lee bajo sol directo. Todos los pares actuales están medidos y pasan; están en la lámina.

**El primario tiene que aceptar texto blanco encima.** El botón principal y el botón flotante central llevan texto y un ícono blancos. Si el primario nuevo no da al menos 4.5:1 contra blanco, hay que rediseñar todos los botones.

**Cuatro estados que tienen que ser inconfundibles entre sí**, porque codifican decisiones sobre el animal:

| Estado | Hoy | Qué significa |
|---|---|---|
| Positivo | verde | apta, preñada, todo bien |
| Alerta | terracota | no apta, vacía, resultado negativo |
| Pausa | ámbar | diferida, posponer la decisión |
| Clínico | teal | en tratamiento |

Podés cambiarles el tono a los cuatro. Lo que no puede pasar es que dos se confundan.

**Y acá está el problema que hoy tenemos y que la marca nueva debería arreglar:** los colores de "alerta" y "pausa" tienen luminancia casi idéntica, así que para alguien con daltonismo rojo-verde —cerca de **1 de cada 12 varones**, y el usuario de manga es casi siempre varón— **son el mismo color**. Está simulado en la lámina. La regla que sale de ahí: **separar los estados también por luminosidad, no solo por tono.**

**Fondo neutro sin tinte.** Ya probamos un blanco levemente azulado y ensucia el verde de forma visible. Frío o cálido, se nota.

---

## 4. La tipografía tiene dos requisitos raros

**Necesita un peso que aguante un número gigante.** El dato más importante de la app es el peso del animal, y se muestra a 64px porque el operario lo verifica de un vistazo, a un metro, mientras sostiene el celular con una mano. Cualquier familia que elijas tiene que verse sólida a ese tamaño.

**Números tabulares.** Los pesos y los porcentajes van en listas alineadas. Con números proporcionales las columnas bailan y se vuelve ilegible de un vistazo. Y los números van en formato argentino: coma decimal, punto de miles (385 kg, 4,5, 1.050).

Hoy es Inter en cuatro pesos (400/500/600/700). Cumple las dos cosas. Si la cambiás, que las cumpla la nueva.

---

## 5. Dónde aparece la marca (inventario de superficies)

| Superficie | Nota |
|---|---|
| **Ícono de la app** | La pieza más importante. Tiene que funcionar a 48px |
| **Splash** (pantalla de arranque) | Imagen centrada sobre color plano |
| **Login y registro** | Es donde la marca se presenta |
| **Header de la app** | Con el nombre del campo activo al lado |
| **El botón flotante central** | Círculo con un rayo. Es la pieza más reconocible de la interfaz y aparece en todas las pantallas |
| **Estados vacíos** | "Todavía no cargaste ningún animal" y similares |
| **Ficha en Play Store y App Store** | Capturas + gráfico destacado |
| **Landing web** | No existe todavía |
| **Preview del link de invitación** | Se manda por WhatsApp: la imagen del preview es marca |

---

## 6. Lo que necesito de vos para poder publicar la app

Esto es la lista técnica, no de gusto. Sin estos archivos la app no se puede subir a las tiendas:

- **Logo en SVG**: versión horizontal (con texto) e isotipo solo.
- **Ícono de app, 1024×1024, sin transparencia** (lo pide Apple).
- **Ícono adaptativo de Android**: frente y fondo en **capas separadas**. El sistema lo recorta a círculo, a cuadrado redondeado o a lo que el fabricante quiera, así que el isotipo tiene que sobrevivir un recorte circular con margen.
- **Versión monocromática** del isotipo, para el ícono temático de Android 13+.
- **Splash**: el isotipo como imagen suelta + el color de fondo. No una imagen a sangre.
- **Favicon**.
- **La paleta en hexadecimales**, no como "el verde de la marca". Va a un archivo de código.

Dos pruebas que te pido que le hagas al isotipo antes de darlo por cerrado: **a 48px** y **en un solo color**. Si a 48px se convierte en una mancha, o si en negro plano deja de reconocerse, no sirve para app.

---

## 7. Lo que no hay que hacer

- **No lo valides sobre fondo blanco en una pantalla de escritorio.** Pedime una captura real de la app y probalo ahí; y si podés, mirala afuera.
- **No uses el color como único portador de significado.** Siempre acompañado de texto o forma.
- **Nada de detalle fino** en el isotipo: a 48px desaparece.
- **Tené presente el modo oscuro.** Todavía no existe, pero para una app que se usa al sol probablemente lo necesitemos. Si la paleta se piensa de entrada con esa segunda vida, después no hay que rehacerla.

---

## 8. Dos cosas que conviene cerrar hoy, porque después salen caras

**El nombre define el identificador técnico de la app** (algo del estilo `com.nombre.app`). Ese identificador **se congela el día que se publica en las tiendas**: cambiarlo después obliga a publicar una aplicación nueva y perder todas las instalaciones y reseñas. Sale del nombre definitivo, así que se decide hoy junto con él.

**Chequeo en INPI antes de cerrar.** Vale la pena mirar si el nombre está registrado en las clases de software y servicios antes de invertir en un manual de marca completo. Es gratis y evita rehacer todo.

---

## Contexto que quizás ayude

El comprador es el **dueño del campo**; el que la usa todos los días es el **capataz o el peón**; y el que la recomienda —y por eso es el canal de venta— es el **veterinario**. La marca tiene que resultarle seria al dueño, simple al peón, y profesional al veterinario. Ninguno de los tres es un usuario de tecnología por gusto.

Es cría bovina hoy, pero la idea es extenderla a invernada, feedlot, tambo y cabaña. **El nombre y la marca no deberían encerrarnos en "vacas de cría".**
