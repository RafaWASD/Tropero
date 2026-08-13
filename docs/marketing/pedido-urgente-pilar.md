# miTropero — lo urgente para diseño

**12/08/2026** · Una página. El detalle largo está en `brief-marca-pilar.md` y en el manual de marca.

---

## 1. El ícono de la app — es lo único que hoy frena las tiendas

Hoy la app se publicaría con **el ícono de ejemplo de Expo**: una "A" azul con las guías de construcción todavía dibujadas. Es lo primero que hay que reemplazar.

### Los cinco archivos

| Archivo | Especificación |
|---|---|
| `icon.png` | **1024 × 1024** · PNG · **sin transparencia y sin esquinas redondeadas** |
| `android-icon-foreground.png` | Capa de frente **sola**, sobre transparente |
| `android-icon-background.png` | Capa de fondo, **archivo separado** |
| `android-icon-monochrome.png` | Silueta plana, un solo color |
| `favicon.png` | Para la web |

Más el **SVG original**, no sólo los PNG exportados.

### Dos cosas que suelen volver mal

**Apple rechaza el canal alfa y las esquinas redondeadas.** El ícono va cuadrado y opaco; el redondeo lo hace el sistema. Si viene con transparencia, la entrega se rechaza.

**En Android el ícono son dos capas, no una imagen.** El sistema las recorta en círculo, cuadrado o gota según el teléfono. Todo lo que importe tiene que caber en el **66% central**: lo que llegue al borde se corta, y eso no se descubre hasta que está publicado.

### Las dos pruebas, antes de darlo por bueno

1. **A 48 píxeles.** Es el tamaño real en un teléfono. Si a ese tamaño no se distingue, no sirve: nadie lo va a ver a 1024.
2. **En negro plano.** Si sin color no se reconoce, el logo está apoyado en el color y no en la forma.

---

## 2. La regla de color que no se puede romper

Esto conviene leerlo **antes** de dibujar la paleta, porque si se rompe hay que rehacerla.

La app tiene **cuatro estados operativos** que el operario distingue de un vistazo, con barro, con una mano y a pleno sol.

En la paleta actual, dos de esos estados —el terracota y el ámbar— tienen **exactamente la misma luminosidad**: la relación entre ambos es de 1.00. Simulando daltonismo (deuteranopia) quedan en `#877819` y `#82730B`.

**Traducido: dos estados distintos se ven idénticos para uno de cada doce hombres.** Y el productor ganadero es mayoritariamente varón.

> **La regla: los estados se separan por LUMINOSIDAD, no sólo por tono.** Si dos estados tienen el mismo brillo, son el mismo estado para esa persona, por más distinto que sea el color.

Y todo texto sobre su fondo tiene que llegar a **4.5:1** de contraste.

**Cuando entreguen la paleta, se le miden los contrastes y la simulación de daltonismo, y se devuelven los números.** No es un juicio de gusto: es una medición, y se hace antes de que la paleta entre al código.

---

## 3. Redes — se puede resolver hoy y no depende del logo final

Las **siete cuentas** —Instagram, TikTok, X, Threads, YouTube, LinkedIn y Facebook— están **sin foto de perfil**. No es sólo estético: algunas plataformas liberan usuarios inactivos y sin contenido.

No hace falta esperar al logo definitivo. Un cuadrado de color plano con la palabra alcanza para hoy y se reemplaza después.

Además:
- **Facebook pide foto de portada** y marca la página como "necesita mejorar" hasta tenerla.
- **Poner `mitropero.com.ar` en la bio de las siete.** Estaban vacías porque hasta ayer no había sitio; ahora existe.

---

## Sobre cómo se escribe el nombre

**miTropero** — `mi` en minúscula, pegado, con la `T` mayúscula. No "Mi Tropero", no "MiTropero", no "MITROPERO".

Tres excepciones que **no son errores**:
- El registro de marca del INPI va en mayúsculas, por formato del trámite.
- **Facebook fuerza la mayúscula inicial**: su política prohíbe la "capitalización inusual" y normaliza sola a `MiTropero`. Está comprobado que no hay forma de evitarlo, así que no vale la pena pelearlo.
- El identificador técnico de la app va todo en minúscula.
