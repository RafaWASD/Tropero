# Bastones lectores del mercado argentino — qué Bluetooth usa cada uno

**13/08/2026** · Relevamiento para decidir el alcance de iOS. Cada fila dice de dónde salió el dato.

---

## El mercado es más chico de lo que parece

Cruzando los catálogos de **Don Agro** y **Farmquip** —dos distribuidores locales— el surtido real son **cuatro marcas y unos diez modelos**, no diez marcas. Repiten los mismos productos.

Distribuidores identificados: ADN Ganadería (oficial de Gallagher, Datamars, Allflex y Lorentz), Farmquip, Soluciones Ganaderas y Don Agro.

## La tabla

| Modelo | Bluetooth | ¿Anda en iOS? | Fuente |
|---|---|---|---|
| **Allflex RS420** | SPP + **iAP** | ✅ vía **MFi** | Ficha Allflex (leída) + búsqueda (sin confirmar) |
| **Gallagher HR4** | Clásico | ❌ **Android solamente** | AgriWebb, textual: *"Bluetooth connections for the HR-4 can be made on Android devices only"* |
| **Gallagher HR5** | Clásico | ❌ **Android solamente** | AgriWebb, textual: *"...for the HR-5 can be made on Android devices only"* |
| **Gallagher HR5 v3** | **BLE** | ✅ **sin MFi** | AgriWebb: *"introducing Bluetooth Low Energy (BLE) capabilities which allows the device to connect via Bluetooth to both Apple and Android devices"* |
| **Tru-Test SRS2** | Clásico, **sin chip MFi** | ❌ | iLivestock: *"no longer supported by Apple iOS devices (...) use classic Bluetooth and don't have the Apple MFi certification chip"* |
| **Tru-Test XRS2** | Clásico, **sin chip MFi** | ❌ | ídem |
| **Tru-Test SRS2i** | **MFi** | ✅ vía **MFi** | iLivestock: emparejan por el **Accessory Picker** de iOS |
| **Tru-Test XRS2i** | **MFi** | ✅ vía **MFi** | ídem |
| **Gallagher HR0** | Bluetooth · **posible modo HID** | ✅ | Gallagher declara en los datos de su ficha `Compatible with: Android` y `Compatible with: iOS`. El **modo HID/teclado** aparece en descripciones de revendedores, **sin confirmar del fabricante** |
| **TRAZA 2 PRO** | Bluetooth · USB 2.4G | ✅ | Ficha del distribuidor: *"compatible con Windows, Android, IOS"*. HDX y FDX-B. **Compatible con la app oficial de SENASA, SIGTRAZA** |
| **Tru-Test XRP2** | ❓ | ❓ | **Pendiente** — es panel con antena, no bastón de mano |

### La regla que ordena todo

**En Tru-Test, la "i" del modelo significa MFi.** `SRS2` → clásico sin certificar → no anda en iPhone. `SRS2i` → certificado → anda. Mismo para `XRS2`/`XRS2i`.

En Gallagher el corte es por generación: **hasta el HR5 estándar es Android solamente; el HR5 v3 pasó a BLE** y con eso entró a iOS sin necesidad de MFi.

---

## Qué significa esto para nosotros

**1. En Android anda todo.** Ninguno de los modelos relevados tiene problemas en Android. Y Android es donde está el productor argentino.

**2. En iOS, buena parte del parque instalado no puede conectarse — y no es culpa de la app.** El HR4, el HR5 estándar, el SRS2 y el XRS2 **no se conectan a un iPhone por Bluetooth**, con ninguna app. Es una limitación del hardware, no del software.

**3. Por lo tanto, "compatible con todos los bastones" es imposible en iOS.** Bovitag lo afirma en su portada; no puede ser cierto para los modelos de arriba. Sus propias notas de versión nombran **Gallagher** — que es coherente con el **HR5 v3**, el que tiene BLE.

**4. Hay sólo dos caminos a iOS**, y conviene no mezclarlos:
- **BLE** (HR5 v3) → CoreBluetooth, sin licencias, sin acuerdos. Cualquiera lo puede hacer.
- **MFi / iAP** (RS420, SRS2i, XRS2i) → hay que declarar la cadena de protocolo del fabricante. **Es una gestión comercial**, no un problema técnico.

## Lo del "SIGTRAZA" de la ficha: falsa alarma mía

La ficha del TRAZA 2 PRO dice que es *"compatible con la aplicación oficial de SENASA **SIGTRAZA**"*, y
acá lo marqué como la incógnita más grande del relevamiento. **Estaba equivocado: no era una
incógnita.**

La app se llama **SIGBIOtraza** y el proyecto ya la tenía relevada desde la sesión 16, con manual leído
y todo, en `specs/active/08-export-sigsa/research-findings.md`. La spec 08 existe **precisamente** para
convivir con ella. Lo que la ficha llama "SIGTRAZA" es el nombre mal escrito por el revendedor.

Lo que ya estaba documentado y sigue valiendo, en una línea: SIGBIOtraza **captura y nada más** —lee
caravanas por Bluetooth y arma una planilla que se termina de procesar en SIGSA web, desde una
computadora—. No gestiona rodeo: por animal sólo guarda **raza, mes/año de nacimiento y sexo**. No
compite con miTropero; compite con el paso de tipear números.

Los formatos de archivo de SIGSA (alta `RFID-SEXO-RAZA-MM/AAAA;`, TRI separada por espacios,
reidentificación `ORIGINAL-NUEVO;`) están todos en la spec 08, verificados contra los manuales
oficiales. No hay que volver a buscarlos.

### Lo que sí es nuevo, y es sobre bastones

**La app oficial de SENASA tampoco puede conectar un bastón en iPhone.** Está en las reseñas públicas
de la App Store, con **1,8 de 5** estrellas:

> *"No hay manera de conectar el bastón y realizar lecturas. Ojalá que el equipo actualice la app y le
> den continuidad… estamos muy entusiasmados, pero por ahora, esta es la triste realidad. Sin uso."*
> — reseña del 23 de enero

Y el manual oficial pide, como requisito previo, que el lector esté *"encendido y vinculado al teléfono
mediante Bluetooth"*, con este ítem en la solución de problemas: *"¿El lector RFID no envía datos?
Asegúrese de que no esté conectado a otro teléfono"* — que es el síntoma clásico del **Bluetooth
clásico**, no de BLE.

**Por qué importa**: el muro de iOS no es una carencia de miTropero. Es del mercado, y **el Estado
también se lo comió**. Sirve para dos cosas concretas:

1. **Deja de ser una vergüenza a esconder.** Que la app oficial esté en 1,8 estrellas por esto mismo
   convierte "en iPhone anda con estos bastones y con estos no" en un dato honesto que nadie más está
   dando, no en una excusa.
2. **Refuerza que el camino es BLE, no HID.** Si SENASA con presupuesto estatal no logró que el
   Bluetooth clásico funcione en iOS, es porque no se puede: iOS no habla SPP sin MFi. Ver abajo.

## 🔴 Un problema para ADR-024 que hay que mirar

`ADR-024` eligió el **HID keyboard-wedge** como el camino iOS-sin-MFi, y `R8` de la spec 04 lo especifica esperando el gate físico `R8.7`.

**Apareció un candidato: el Gallagher HR0.** Descripciones de revendedores dicen que se emparejea *"via HID mode, acting as a sort of keyboard"*, tipeando el número en el campo de texto que esté enfocado. **No lo pude confirmar en la documentación de Gallagher** — su ficha oficial confirma la compatibilidad con iOS pero no describe el mecanismo.

Si se confirma, es una noticia muy buena y algo irónica: **el bastón más barato del catálogo es el que destraba iOS gratis**, sin MFi y sin acuerdo con nadie.

Ninguno de los otros modelos relevados menciona modo teclado. Así que el `hid-wedge` tendría **un solo dispositivo conocido** con el que hablar en este mercado, y conviene saberlo antes de construirlo.

**Lo que hay que verificar, en este orden:**
1. Si algún bastón del mercado tiene modo HID en su menú de configuración (requiere el aparato en la mano).
2. Si conviene reemplazar el camino HID por **BLE**, que es lo que efectivamente usan los modelos nuevos.

## Qué pedirle a cada fabricante (2026-08-17)

Ordenado por interlocutor, porque el pedido **no es el mismo** y confundirlos cuesta semanas.

| Fabricante | Modelo que sirve en iOS | Qué pedir | Qué NO pedir |
|---|---|---|---|
| **Gallagher** | **HR5 v3** (BLE) | **Documentación técnica de integración**: UUID de servicio, UUID de la característica de notificación, formato de trama y terminador | ❌ **Una key MFi.** BLE no lleva licencia ni acuerdo con Apple. Pedirla es pedir algo que no existe |
| **Allflex** | RS420 (SPP + iAP) | **Cadena de protocolo iAP** (`com.allflex.…`) **+ licencia MFi** | — |
| **Datamars** (Tru-Test) | SRS2i / XRS2i | Cadena de protocolo iAP + licencia MFi | — |

**Dos cosas que se deducen de la tabla y conviene tener a mano en la llamada:**

- **El HR4 y el HR5 estándar son Bluetooth clásico sin chip MFi.** No se van a conectar a un iPhone con
  ninguna app, nunca, por ningún acuerdo. Gestionar algo por esos modelos es tiempo perdido.
- **Gallagher es el interlocutor más barato de los tres**: su camino no depende de ningún trámite con
  Apple, solo de que alguien de soporte técnico mande un documento.

> Estado del lado del software (delta `ios-ble-mfi` de spec 04, aprobado el 2026-08-17): el transporte
> **BLE-GATT** se está construyendo y se prueba contra el emulador ESP32 en `MODO_GATT`; el **MFi** queda
> prearmado y gateado, y se destraba el día que llegue una cadena de protocolo **sin escribir código**
> (una línea en `app.config.ts` + una capability en el driver). O sea: cuando llegue el dato, no hay que
> esperar a que se programe nada.
>
> ⚠️ **No se va a registrar ningún driver con UUIDs o formato de trama inventados.** Un fabricante entra
> al registro cuando entrega su documentación. Adivinar los parámetros convertiría una incógnita en un
> verde falso.

## Qué falta

1. **Confirmar el modo HID del HR0** con Gallagher, no con un revendedor. Decide si el `hid-wedge` de ADR-024 tiene con qué hablar. Es lo primero.

   > **Actualización 2026-08-17**: el *gate físico* de ese camino (que iOS entregue los keystrokes a un
   > campo enfocado) **ya no depende del HR0**: se corre con el ESP32 en `MODO_HID`, que es un teclado
   > BLE HID. Pero son **dos incógnitas distintas** — el gate valida el lado del teléfono, no que exista
   > un bastón comercial con modo HID. Esta pregunta sigue abierta tal cual.
2. **El XRP2**: sin relevar. Es panel con antena, no bastón de mano, así que es el menos urgente.
3. **Confirmar el iAP del RS420** leyendo el manual. El PDF no tiene capa de texto extraíble y ManualsLib devuelve 403.
4. **Ningún dato de cuota de mercado.** No existe un ranking publicado de "los más usados en Argentina". Lo de arriba es el **surtido de los distribuidores**, que es una señal de lo que se vende, no una medición. Si hace falta el dato duro, la vía es preguntarle a un distribuidor cuánto vende de cada uno.
