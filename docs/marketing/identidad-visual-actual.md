# Identidad visual actual

> Estado al **31/07/2026**. Material para pasarle a quien trabaje la marca.
> Adjunto visual: **`identidad-visual-actual.png`** (lámina con todos los colores, contrastes y escala tipográfica).

**Advertencia de fuente**: estos valores salen de `app/tamagui.config.ts`, que es la **única fuente de colores del frontend** — un lint rompe el build si una pantalla escribe un color a mano. Cualquier otro documento del repo con hex distintos (por ejemplo `design/FRONTEND-STATUS.md`, que quedó viejo) **no vale**: gana el código.

---

## 1. Lo que hay y lo que no

| | Estado |
|---|---|
| Nombre definitivo | ❌ En definición. Bloquea dominio, tiendas, logo y web. |
| Logo / isotipo | ❌ No existe. Hubo un monograma "R" de exploración, descartable. |
| Paleta | ✅ Definida, en uso, con contrastes medidos |
| Tipografía | ✅ Definida (Inter) |
| Iconografía | ✅ Definida (Lucide) |
| Tono de voz | ✅ Definido (voseo argentino) |
| Manual de marca | ❌ No existe. Esto es lo más parecido. |

---

## 2. Paleta

### Marca

| Nombre | Hex | Rol |
|---|---|---|
| Verde botella | `#1E5A3E` | **Primario.** Botones, botón flotante central, ítem activo, estado positivo |
| Verde claro brand | `#2E8259` | Tono superior de degradés. Mismo matiz, más luminoso |
| Verde contenedor | `#93CFAC` | Fondo de badges e íconos, halo del botón flotante |
| Verde presionado | `#184A33` | Estado presionado del primario |

### Superficies y texto

| Nombre | Hex | Rol |
|---|---|---|
| Fondo de app | `#FAF9F9` | Blanco neutro, **sin tinte frío ni cálido** |
| Bone | `#F8F6F1` | Cálido. **Solo tarjetas**, nunca fondo general |
| Negro de marca | `#0F0E0C` | Texto principal. No es negro puro |
| Gris texto | `#5C655F` | Labels secundarios, navegación inactiva |
| Gris terciario | `#807A74` | Texto de apoyo, solo en tamaño grande |
| Divisor | `#E5E5E3` | Líneas y separadores |

### Colores con significado operativo

No son decorativos: cada uno codifica un estado del animal que el operario lee con guante, a pleno sol, de un vistazo. **Un rebranding puede mover el verde de marca, pero estos significados tienen que seguir siendo inconfundibles entre sí.**

| Nombre | Hex | Significa |
|---|---|---|
| Terracota | `#C0451F` | Alertas y resultado negativo (NO APTA) |
| Ámbar | `#9A6206` | Pausa / posponer decisión (DIFERIDA) |
| Par de descarte | `#FBE6AE` fondo / `#855300` texto | Animal marcado para descarte (CUT) |
| Teal sanitario | `#DBEEF3` fondo / `#106B7A` texto | En tratamiento (marca clínica) |

### Translúcidos

| Nombre | Valor | Rol |
|---|---|---|
| Halo del botón flotante | `rgba(147, 207, 172, 0.45)` | Verde contenedor al 45% |
| Velo de modales | `rgba(15, 14, 12, 0.45)` | Negro de marca al 45% |

---

## 3. Contraste medido (WCAG 2.1)

Todos los pares en uso pasan AA. No son estimaciones: están calculados.

| Par | Ratio | AA |
|---|---|---|
| Negro sobre fondo de app | 18.36 | ✓ |
| Blanco sobre verde botella | 8.12 | ✓ |
| Verde botella sobre fondo | 7.72 | ✓ |
| Teal sobre fondo | 5.87 | ✓ |
| Gris texto sobre fondo | 5.74 | ✓ |
| Par del badge de descarte | 5.27 | ✓ |
| Blanco sobre terracota | 5.11 | ✓ |
| Blanco sobre ámbar | 5.09 | ✓ |
| Terracota sobre fondo | 4.86 | ✓ |
| Verde sobre verde contenedor | 4.55 | ✓ |
| Gris terciario sobre fondo | 4.03 | Solo texto grande |

---

## 4. El agujero que la paleta nueva tiene que cerrar

Los tres bloques de la pantalla de tacto de vaquillona (**APTA / NO APTA / DIFERIDA**) se diferencian **solo por matiz**.

- Terracota y ámbar tienen **luminancia prácticamente idéntica**: el contraste entre ellos es **1.00**.
- Simulados con daltonismo rojo-verde, los dos caen en el mismo oliva: `#877819` y `#82730B`.
- Eso afecta a cerca de **1 de cada 12 varones**, y el usuario de manga es casi siempre varón.

Hoy lo salva el texto del botón, no el color — o sea que el color **no está haciendo el trabajo que decimos que hace**.

**Regla para la paleta nueva:** los colores de estado tienen que separarse también por **luminosidad**, no solo por matiz. Con eso, un operario daltónico distingue los bloques aunque le fallen los tonos.

---

## 5. Tipografía

**Inter**, exclusiva, cuatro pesos. Sin segunda familia.

| Peso | Uso |
|---|---|
| 700 | Display, títulos, número héroe |
| 600 | Subtítulos y títulos de tarjeta |
| 500 | Labels |
| 400 | Texto e inputs |

Escala en uso (tamaño / interlineado, en px):

| Tamaño | Uso |
|---|---|
| 64 / 72 | Número héroe: el valor que se carga en la manga (el peso) |
| 38 / 46 | Títulos de pantalla |
| 30 / 38 · 23 / 31 | Titulares intermedios |
| 20 / 28 · 18 / 25 | Títulos de tarjeta |
| 16 / 22 | Texto grande e inputs |
| 14 / 20 | Texto base |
| 13 / 18 · 12 / 17 | Texto secundario |
| 11 / 16 | Micro-labels del menú inferior |

---

## 6. Forma, íconos y tono

- **Bordes:** 16px en tarjetas, pill completo en botones primarios.
- **Área táctil mínima:** 56px. Los botones de manga van a 80-88px (se tocan con guante).
- **Íconos:** Lucide, trazo lineal. **Nunca emoji como sustituto de ícono** (solo emoji en saludos, tipo "¡Hola Lucas! 👋").
- **Sombra:** dos niveles nada más. La del botón flotante va **teñida de verde**, no de negro.
- **Tono de voz:** voseo argentino, microcopy explicativo, tildes correctas.
- **Regla de producto:** una decisión por pantalla durante la carga en la manga.
- **Prohibido:** azul frío (`#F8F9FF` y familia). Se probó y ensucia el verde.

---

## 7. Restricciones para la paleta nueva

Lo que puede moverse y lo que no:

**Se puede mover libremente**
- El matiz del primario de marca (hoy verde botella).
- La temperatura del neutro base.
- El color del contenedor / badges.

**Tiene que sobrevivir al cambio**
- **Cuatro estados inconfundibles entre sí**: positivo, alerta, pausa, clínico.
- **Separación por luminosidad además de matiz** (ver punto 4).
- **Contraste mínimo AA (4.5:1)** en todo par texto/fondo. La pantalla se lee a pleno sol.
- **Blanco legible sobre el primario** — el botón principal y el flotante llevan texto blanco.
- **Neutro sin tinte** en el fondo: cualquier desvío frío o cálido se nota y ensucia.

**Costo de cambiarla:** bajo. Todos los colores viven en un solo archivo y ninguna pantalla los escribe a mano. Cambiar la paleta entera es editar un archivo y volver a medir contrastes.
