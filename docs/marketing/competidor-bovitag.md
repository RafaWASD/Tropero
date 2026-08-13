# Bovitag — relevamiento del competidor

**13/08/2026** · Fuente: `bovitag.com` e Instagram público, leídos directo. Lo que no se pudo verificar está marcado como tal.

---

## Lo que dicen ser

> "Con Bovitag, llevá la trazabilidad de tu rodeo, simple y ordenada, desde el celular."
> "Hecho por gente de campo."

Tres fundadores —Luca, Fede y Maggie—, con hacienda en **Córdoba y Entre Ríos**. Sitio en español, **inglés y portugués**: apuntan afuera de Argentina. Estado: *"Sumate al lanzamiento"* — también son nuevos.

## Precio

| Tramo | Precio |
|---|---|
| Hasta 150 cabezas | **USD 135/año de lista · USD 81 con 40% de descuento de lanzamiento** |
| Hasta 300 / 600 / 1.500 / +1.500 | ❓ **No se pudo leer** — están detrás de un selector |

**Sin prueba gratuita.** Ofrecen *"pedí una demostración"*.

> ⚠️ **Corrige un supuesto nuestro.** Se venía asumiendo que Bovitag cobra "3 o 4 veces" nuestro precio. **En el tramo de entrada es al revés**: USD 81-135/año contra los USD 100-119 que estábamos pensando. Los tramos de arriba podrían justificar esa impresión, pero **no están verificados**.

## Lo que reclaman, y que se superpone con nuestros diferenciales

| Nuestro supuesto diferencial | Qué dice su portada |
|---|---|
| Funciona sin señal | *"La app está diseñada offline-first. Registrás todo sin señal y se sincroniza cuando hay conexión."* · *"Funciona sin señal ni wifi"* |
| Declaración/trámites de SENASA | *"Trámites de SENASA integrados. Los trámites los hacés directo, sin volver a escanear."* |
| Bastón multivendor | *"Compatible con TODOS los bastones: desde el más barato (USD 35) hasta el más caro (USD 2.500)."* |

> 🔴 **El offline no es territorio libre.** Se había afirmado —en este repo y en el plan de contenido— que *"nadie más está usando ese argumento de forma explícita"*. **Es falso**: está en su portada con esas palabras. La idea de contenido que lo *demuestra* sigue siendo válida (mostrar es más fuerte que decir), pero es **paridad, no diferenciación**.
>
> 🔴 **Los trámites de SENASA los venden como hechos**, que es exactamente lo que nosotros no podemos ofrecer hoy. No está verificado que funcione — es lo que afirma la página — pero **como posicionamiento ya está ocupado**.

## Funcionalidades que listan

**Producción**: pesaje individual y en lote · ganancia diaria de peso · destete · castración
**Sanidad**: vacunación con dosis y producto · estado sanitario · registro de muertes con evidencia
**Reproducción**: tacto (preñada/vacía) · estado de gestación
**Movimientos**: rotación entre potreros · compra y venta · recaravaneo con trazabilidad
**Otros**: app para el equipo de campo · web para el productor · historial completo por animal

## Distribución — acá está su debilidad

| | |
|---|---|
| Instagram `@bovitag` | **278 seguidores · 116 seguidos · 7 publicaciones** |
| Facebook | No lo enlazan desde el sitio |
| Píxel de Meta | **Instalado** — corrieron o corren anuncios |
| Biblioteca de anuncios de Meta | ❓ **No verificado**: la página no cargó en tres intentos |

**Siete publicaciones.** Tienen el producto y el mensaje armados, y prácticamente cero distribución.

## Lectura

**Nos ganan en la página de aterrizaje.** Su mensaje está más ordenado, su precio de entrada es más bajo, y reclaman tres cosas que nosotros considerábamos ventajas — dos de las cuales todavía no podemos ofrecer.

**Les ganamos en distribución, si la estrategia de contenido se ejecuta.** Siete publicaciones y 278 seguidores es no existir. Ese es el hueco real, y es justo donde miTropero decidió apostar.

**Y hay un diferencial disponible hoy, sin depender de nada: la prueba de 3 meses.** Ellos piden una llamada de demostración. Contra eso, *"probalo tres meses vos solo, sin tarjeta"* es una ventaja concreta y verificable — no una promesa a futuro.

## Su app en las tiendas

| | |
|---|---|
| App Store | **v1.0.3** · publicada **22/05/2026**, actualizada 29/07 · 44 MB · gratis · iOS 15.1+ |
| Cuenta de desarrollador | **Individual**, a nombre de uno de los fundadores — no una empresa |
| Valoraciones | **2**, con 5 estrellas |
| Google Play | No se encontró la app |

### 🔴 El claim de "todos los bastones" no se sostiene con lo que dice su propia app

La web dice *"compatible con TODOS los bastones: desde el más barato (USD 35) hasta el más caro (USD 2.500)"*. Las notas de la versión 1.0.3 en la App Store dicen otra cosa:

> "Mejoras en la conexión con lectores y balanzas **Gallagher**."

Nombran **una marca**. La distancia entre el claim de la portada y lo que declaran en la tienda es de ellos.

### Y corrige una creencia nuestra que estaba condicionando el roadmap

Se venía asumiendo que **iOS exige llaves MFi por fabricante para cualquier bastón**. Es incompleto:

- **Bluetooth Classic SPP** → sí exige MFi (el accesorio lleva el chip de autenticación de Apple y la app declara el protocolo). **El Allflex RS420 es este caso**, y por eso está trabado.
- **BLE** → cualquier app se conecta por CoreBluetooth. **Sin MFi, sin llaves, sin acuerdo con nadie.** Los bastones baratos suelen ser BLE.
- **HID teclado** → el bastón se emparejea como teclado Bluetooth y tipea el EID en un campo enfocado. **Cero integración.**

**Esto ya está resuelto en el repo**: `ADR-024` eligió el camino HID sin MFi para iOS y está especificado en `R8.1` de la spec 04. Lo que lo frena es el **gate `R8.7`** — probarlo en un iPhone real antes de implementar.

**Conclusión**: Bovitag no resolvió algo que nosotros no podemos. Nuestro bloqueo es una prueba en device, no un muro de licencias.

## Lo que falta verificar

1. **Los precios de los tramos de arriba.** Definen si la tesis de "somos más baratos" se sostiene o no.
2. **Si los trámites de SENASA funcionan de verdad** o es una afirmación de portada.
3. **Sus anuncios en Meta**: cuántos, desde cuándo, y si siguen activos. Ojo con el método — la búsqueda por palabra clave cuenta anuncios de todos los anunciantes e infla el número; hay que usar la vista por página del anunciante.
