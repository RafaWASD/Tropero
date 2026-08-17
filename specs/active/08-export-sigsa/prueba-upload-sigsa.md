# Prueba de upload real en SIGSA — instructivo para Facundo

> **Para qué**: es lo único que falta para dar por cerrada la exportación a SENASA. El formato del archivo ya está confirmado contra el manual oficial; lo que no sabemos es si el **portal** lo acepta al primer intento. Hasta que esto no se haga, no podemos venderle la feature a nadie.
>
> **Cuánto lleva**: 15 minutos, una sola sesión.
> **Fecha del instructivo**: 1/8/2026.

---

## ⚠️ Leé esto antes que nada

**El upload es una declaración FIRME ante SENASA. No hay modo de prueba, no hay simulacro, no se puede deshacer.**

Consecuencias:

1. **Usá caravanas reales que ya estén colocadas y que efectivamente quieras declarar.** No inventes números de RFID: estarías declarando dispositivos que no existen.
2. **Respetá el plazo.** Lo que subas cuenta contra los 10 días hábiles del Art. 8°. Si son caravanas colocadas hace más de 10 días hábiles, ya estás fuera de plazo — no las uses para la prueba.
3. **Desde el 3/8/2026 hay bloqueo de CUIG en juego.** SIGSA valida automáticamente los movimientos de terneros. Una declaración mal hecha ahora tiene costo real.

Si no tenés caravanas reales pendientes de declarar, **la prueba se pospone**. No la fuerces.

---

## Lo que necesitás tener a mano

- Clave fiscal con acceso a **SIGSA** (`https://aps2.senasa.gov.ar/sigsa`).
- El **RENSPA** del establecimiento.
- La **fecha de aplicación** de las caravanas y el **motivo** de la declaración (acta de vacunación antiaftosa / novedad de nacimiento / reinscripción de RENSPA).
- La app con las caravanas ya cargadas y con los tres datos obligatorios completos por animal: **RFID, sexo, raza y fecha de nacimiento**. La app no deja exportar un animal al que le falte alguno.

---

## El diseño de la prueba

**Tres pruebas en cascada, no un archivo mezclado.** Si metemos todas las variantes en un solo archivo y SIGSA lo rechaza, no sabemos cuál de las variantes lo rompió — y habríamos gastado una declaración firme para no aprender nada.

| # | Qué sube | Qué pregunta responde | Cuándo se hace |
|---|---|---|---|
| **1** | El archivo tal cual sale de la app | **¿SIGSA acepta lo que hoy generamos?** | Siempre. Es la única obligatoria. |
| **2** | Igual, con `;` al final | ¿El portal exige el punto y coma final? | **Solo si la 1 falla.** |
| **3** | Un registro con fecha de nacimiento de 2-3 años atrás | ¿Hay tope de antigüedad? | **Solo si la 1 pasa** y tenés un animal viejo pendiente. Opcional. |

Lo que **no** vamos a probar: el espacio después del punto y coma. El manual de SENASA lo tiene en su propio ejemplo (probablemente sea un error de tipeo del PDF), pero nosotros nunca generamos espacios. Probarlo gastaría una declaración firme para responder algo que no cambia ninguna decisión.

---

## Prueba 1 — la que importa

### En la app

1. Menú **Más** → **Exportar a SENASA**.
2. Revisá la lista. Los animales que no estén listos aparecen aparte, con el dato que les falta.
3. Tocá **Exportar N animales**.
4. Se abre el menú de compartir. Mandátelo **a vos mismo por mail** (no por WhatsApp: comprime y renombra). Lo vas a necesitar abierto en la computadora.

### Antes de subir: mirá el archivo

Abrilo con el Bloc de notas. Tiene que verse como **una sola línea larga**, así:

```
032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025;032010000000002-M-B-07/2025
```

Chequeá tres cosas:

- Los campos van separados por **guion del medio** (`-`), y los animales entre sí por **punto y coma** (`;`).
- **No hay espacios** en ningún lado.
- **No termina en `;`** ← esto es justamente lo que estamos probando.

Si ves algo distinto, **pará y avisame antes de subir**.

### En SIGSA

1. Entrá a `https://aps2.senasa.gov.ar/sigsa` con clave fiscal.
2. **Existencias** → **Dispositivos de Identificación** → **Nueva Declaración**.
3. Elegí la opción de **importar / subir archivo** (no la carga manual ni la de SIGBIOTRAZA).
4. Completá los cuatro datos que **no** van en el archivo y que el portal pide en pantalla:
   - **RENSPA**
   - **Especie** (bovina)
   - **Fecha de aplicación**
   - **Motivo**
5. Subí el `.txt` y confirmá.

### Anotá exactamente esto

| Qué mirar | Anotá |
|---|---|
| ¿Aceptó el archivo? | Sí / No |
| Si dio error: **el texto exacto del mensaje** | (copiá y pegá, o sacá foto) |
| ¿Cuántos registros dice que procesó? | |
| ¿Los importó todos o algunos quedaron afuera? | |
| Si rechazó alguno: ¿cuál y por qué motivo? | |
| Captura de la pantalla de resultado | (sacá foto igual, aunque haya salido bien) |

**El mensaje de error textual es lo más valioso de toda la prueba.** Un "no anduvo" no me sirve para arreglar nada.

---

## Prueba 2 — solo si la 1 falló por formato

Si el error apunta al formato del archivo (no a los datos de un animal en particular):

1. Abrí el `.txt` en el Bloc de notas.
2. Agregá un **`;` al final** de la línea.
3. Guardá y subilo de nuevo.

Si con eso anda, el problema era el punto y coma final y lo arreglo con un flag que ya está en el código.

---

## Prueba 3 — solo si la 1 pasó, y es opcional

Si tenés algún animal pendiente de declarar con **fecha de nacimiento de 2 o 3 años atrás**, exportalo solo a él y subilo. Sirve para saber si el portal tiene un tope de antigüedad que no está documentado.

Si no tenés un caso real, **no lo fuerces**. No vale gastar una declaración firme en esto.

---

## Qué pasa después según el resultado

| Resultado | Qué significa | Qué toco yo |
|---|---|---|
| Prueba 1 acepta todo | El export queda cerrado | Levanto el gate R6.3/R8.6 y la feature 08 puede darse por terminada |
| Falla, anda con `;` final | Faltaba el punto y coma | Un flag que ya existe (`trailingSemicolon`), cambio de una línea |
| Falla por un animal puntual (raza, fecha, RFID) | La validación previa se quedó corta | Ajusto la validación pre-export |
| Falla con un error de formato que no entiendo | Hay una regla no documentada | Con el texto del error lo diagnostico |
| No te deja ni llegar a la pantalla | Tema de permisos o de RENSPA | Lo vemos juntos, no es de la app |

---

## Lo que esta prueba NO cubre

Que quede claro para no vender de más: esto valida **la declaración de altas de dispositivos**. La resolución tiene otras dos obligaciones que miTropero hoy **no** cubre —la **TRI** al emitir el DT-e y la declaración del **100% de dispositivos al cerrarlo**— y son justamente las que desde el 3/8 SIGSA valida sola, con bloqueo de CUIG.

Ver `context.md` (sección Alcance) y `research-findings.md` §8.5.
