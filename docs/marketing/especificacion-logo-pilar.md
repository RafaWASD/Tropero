# miTropero — qué archivos necesitamos del logo

**13/08/2026** · Para Pilar. Todo lo de acá está verificado contra la configuración real de la app.

---

## 1. Ícono de la app — los cinco archivos

Van con **estos nombres exactos**, porque así los busca la configuración de la app. Si cambia el nombre, no los encuentra.

| Archivo | Medida | Fondo | Qué es |
|---|---|---|---|
| `icon.png` | **1024 × 1024** | **Opaco, sin transparencia** | El ícono de iOS y el que se sube a las tiendas |
| `android-icon-foreground.png` | **1024 × 1024** | **Transparente** | Capa de **frente** de Android: sólo el símbolo |
| `android-icon-background.png` | **1024 × 1024** | Opaco | Capa de **fondo** de Android: color o textura, sin el símbolo |
| `android-icon-monochrome.png` | **1024 × 1024** | Transparente | Silueta plana, **un solo color**, para los íconos temáticos de Android |
| `favicon.png` | **512 × 512** | Transparente | Para el sitio web |

Más el **archivo fuente vectorial** (`.svg` o el original de Illustrator/Figma). No sólo los PNG exportados.

### Las dos reglas que hacen que un envío se rechace

**1. `icon.png` va cuadrado y opaco, sin esquinas redondeadas.**
Apple **rechaza la entrega** si el ícono tiene canal alfa. El redondeo lo aplica el sistema operativo: si viene ya redondeado, queda redondeado dos veces y se ve mal.

**2. En Android el ícono son dos capas separadas, no una imagen.**
El sistema las superpone y las recorta según el teléfono: círculo, cuadrado redondeado, gota. Por eso `foreground` y `background` son **dos archivos distintos**. Si llega una sola imagen aplanada, el ícono adaptativo no se puede armar.

### La zona segura, con el número exacto

Sobre el lienzo de **1024 px**, todo lo legible tiene que caber dentro de un **círculo centrado de 626 px de diámetro** — es decir, dejando **199 px de margen por lado**.

Ese 61% sale de la especificación de Android: el lienzo es de 108dp y el área garantizada es un círculo de 66dp. Lo que quede afuera **se corta en los teléfonos que recortan en círculo**, y no se descubre hasta que la app está publicada.

### Dos pruebas antes de darlo por bueno

1. **A 48 píxeles.** Es el tamaño real en la grilla de un teléfono. Si a esa escala no se distingue, no sirve: nadie lo va a ver a 1024.
2. **En negro plano**, sobre la capa monocroma. Si sin color no se reconoce, el logo está apoyado en el color y no en la forma.

*(Tenemos un script que arma estas dos pruebas y dibuja la zona segura sobre el ícono real. Se corre en un minuto y devuelve una imagen — se puede iterar con eso antes de dar nada por cerrado.)*

---

## 2. Dos colores que hoy son de ejemplo y hay que reemplazar

Están en la configuración de la app con los valores que vienen por defecto de la herramienta. Son azules, no tienen nada que ver con la marca:

| Dónde | Valor actual | Qué es |
|---|---|---|
| Fondo del ícono de Android | `#E6F4FE` | El color detrás de la capa de frente |
| Ícono de notificaciones | `#1A73E8` | El color del ícono chiquito en la barra de estado |

Hacen falta los dos valores de marca.

---

## 3. Piezas para las tiendas

Son distintas del ícono y también obligatorias para publicar.

| Pieza | Medida | Notas |
|---|---|---|
| **Gráfico destacado** de Google Play | **1024 × 500** | **Obligatorio**, sin él no se publica. Es una pieza gráfica, no una captura |
| Capturas de pantalla | Según tienda | Van compuestas: la captura del producto + un texto que explique qué se ve |

Para las capturas hay materia prima en `docs/marketing/kit-capturas/` — 17 capturas reales del producto. Falta componerlas.

---

## 4. Variantes de marca, más allá del ícono

Lo que se va a necesitar apenas arranque el contenido:

- **Logo horizontal** (símbolo + palabra) — para el sitio, el pie de las piezas y presentaciones.
- **Sólo símbolo** — para fotos de perfil de las redes, que son circulares.
- **Sólo palabra** — para donde el símbolo no entra.
- Cada uno en **positivo y negativo** (para fondo claro y fondo oscuro).
- **Versión de un solo color**, para cuando no hay color disponible.

**La grafía es `miTropero`**: `mi` en minúscula, pegado, con la `T` mayúscula. Con una excepción que no es error: **Facebook fuerza la mayúscula inicial** por su política de nombres y no se puede evitar.

---

## 5. Lo urgente vs. lo que puede esperar

**Hoy**: los cinco archivos del ícono y los dos colores. Es lo único que hoy frena la publicación en las tiendas — la app se publicaría con el ícono de ejemplo que trae la herramienta, una "A" azul con las guías de construcción todavía dibujadas.

**Esta semana**: las fotos de perfil de las siete redes. Alcanza con el símbolo sobre color plano; no hace falta esperar a que esté todo cerrado.

**Después**: el gráfico destacado, las capturas compuestas y las variantes de marca.
