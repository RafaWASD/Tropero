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
| **Gallagher HR0** | ❓ | ❓ | **Pendiente** |
| **Tru-Test XRP2** | ❓ | ❓ | **Pendiente** (es panel con antena, no bastón de mano) |
| **TRAZA 2 PRO** | ❓ | ❓ | **Pendiente** — aparece en Don Agro, posible marca local |

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

## 🔴 Un problema para ADR-024 que hay que mirar

`ADR-024` eligió el **HID keyboard-wedge** como el camino iOS-sin-MFi, y `R8` de la spec 04 lo especifica esperando el gate físico `R8.7`.

**Ninguno de los bastones relevados del mercado argentino declara un modo teclado/HID.** Ni Allflex, ni Gallagher, ni Tru-Test lo mencionan en sus fichas ni en la documentación de los integradores.

Esto no prueba que no exista —los lectores suelen tener menús de configuración con más opciones que la ficha comercial— pero **abre la posibilidad de que el adaptador HID no tenga con qué hablar en este mercado**. Si es así, el gate `R8.7` no va a fallar por iOS: va a fallar por falta de un bastón que haga HID.

**Lo que hay que verificar, en este orden:**
1. Si algún bastón del mercado tiene modo HID en su menú de configuración (requiere el aparato en la mano).
2. Si conviene reemplazar el camino HID por **BLE**, que es lo que efectivamente usan los modelos nuevos.

## Qué falta

- **HR0, XRP2 y TRAZA 2 PRO**: sin relevar.
- **Confirmar el iAP del RS420** leyendo el manual. El PDF no tiene capa de texto extraíble y ManualsLib devuelve 403.
- **Ningún dato de cuota de mercado.** No existe un ranking publicado de "los más usados en Argentina": lo de arriba es el surtido de los distribuidores, que es una señal de lo que se vende, no una medición.
