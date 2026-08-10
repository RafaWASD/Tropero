# Kit de capturas — 17 pantallas

Cubre las cinco zonas pedidas: modo maniobras, ficha del animal, lectura del bastón, reportes y exportación a SENASA.

## Antes de usarlas: tres advertencias

1. **Los datos son de prueba, no de un campo real.** Nombres, caravanas y porcentajes son fixtures de testing. Si algo de esto va a una landing, los números tienen que revisarse o reemplazarse por datos del campo demo.
2. **Son renders de la app en el navegador**, a ancho de teléfono (412px), no fotos de un celular. Para redes conviene montarlas dentro de un marco de teléfono.
3. **La app todavía no tiene nombre ni logo**, así que ninguna captura tiene marca. Cuando se cierre el nombre habrá que regenerarlas (es automático, no es trabajo manual).

## Las pantallas

### La carga en la manga — el corazón del producto

| Archivo | Qué muestra |
|---|---|
| `01-jornada-inicio.png` | Arranque de la jornada de trabajo |
| `02-jornada-elegir-maniobras.png` | Elegir qué se va a hacer hoy (se guarda como rutina reutilizable) |
| `03-esperando-el-baston.png` | **La mejor pantalla del producto para comunicar.** "Acercá el bastón al animal — la lectura entra sola, sin tocar la pantalla" |
| `04-animal-identificado.png` | El animal aparece con su historia después del bastonazo |
| `05-tacto-prenada-vacia.png` | Tacto: dos bloques gigantes, se toca con guante sin mirar |
| `06-pesaje.png` | Carga de peso con teclado grande |
| `07-resumen-antes-de-confirmar.png` | Resumen de todo lo cargado antes de pasar al siguiente animal |

### El bastón

| Archivo | Qué muestra |
|---|---|
| `08-baston-escaneando.png` | Esperando la lectura |
| `09-baston-caravana-leida.png` | La caravana leída en pantalla, para confirmar antes de guardar |
| `10-baston-conectado.png` | Estado de conexión del bastón |

### El animal

| Archivo | Qué muestra |
|---|---|
| `11-ficha-animal.png` | Ficha con identificación, datos, manejo y lote |
| `12-ficha-historial-sanitario.png` | Historial de tratamientos de un animal |
| `13-lista-de-animales.png` | Lista del rodeo con buscador y filtros |

### Reportes

| Archivo | Qué muestra |
|---|---|
| `14-reportes-prenez-paricion.png` | % de preñez y % de parición sobre las servidas |
| `15-reportes-destete.png` | % de destete |

> Ojo: estas dos pantallas están **vacías de la mitad para abajo** porque el rodeo de prueba tiene pocos animales. Con un campo real se llenan. Si van a un material de venta, conviene recortarlas o volver a generarlas con el campo demo cargado.

### Cumplimiento SENASA

| Archivo | Qué muestra |
|---|---|
| `16-export-senasa.png` | "Generá el archivo para declarar las caravanas electrónicas en SIGSA web" + cuántos animales están listos |
| `17-export-senasa-faltantes.png` | Los animales a los que les falta un dato para poder declararlos |

> **No prometer esto en ningún material todavía**: el formato del archivo está pendiente de validación con SIGSA.
