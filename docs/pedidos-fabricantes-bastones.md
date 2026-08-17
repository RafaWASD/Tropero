# Qué pedirle a cada fabricante de bastones — guion de las llamadas

**2026-08-17.** Para Raf. Insumo: `docs/bastones-mercado-argentino.md` (relevamiento del 13/08) y la
enmienda 2026-08-17 de `docs/adr/ADR-024`.

> **Lo único que hay que tener claro antes de levantar el teléfono: son TRES pedidos DISTINTOS.**
> Pedirle a Gallagher lo que hay que pedirle a Allflex es pedirle algo que **no existe**, y quema la
> llamada.

| Fabricante | Modelo | Qué se pide | Cuánto cuesta conseguirlo |
|---|---|---|---|
| **Gallagher** | HR5 v3 | **Documentación técnica de integración BLE** | Barato: un mail de soporte técnico |
| **Allflex** | RS420 | Cadena de protocolo **iAP** + **licencia MFi** | Caro: trámite con Apple de por medio |
| **Datamars** (Tru-Test) | SRS2i / XRS2i | Cadena de protocolo **iAP** + **licencia MFi** | Ídem |

**Empezá por Gallagher.** Es el único que no depende de ningún trámite con Apple y el único cuyo camino
ya está construido de nuestro lado.

---

## 1. Gallagher — HR5 v3 (BLE)

**Por qué a ellos primero**: el HR5 v3 pasó a **Bluetooth Low Energy** justamente para entrar a iOS **sin
MFi** (lo declara el fabricante). Es el **único** modelo del mercado argentino con un camino iOS abierto y
documentado. Nuestro `adapter-ble-gatt` ya está escrito y probado contra un emulador: lo único que falta
son **sus parámetros**.

**Qué pedir, textual:**

> Estamos integrando el HR5 v3 en una app de gestión ganadera (iOS y Android) y necesitamos la
> **documentación de integración Bluetooth LE**. Concretamente:
> 1. el **UUID del servicio** que anuncia el lector,
> 2. el **UUID de la característica** por la que notifica las lecturas,
> 3. el **formato de la trama** que emite y su **terminador**,
> 4. si hay **emparejamiento con PIN** o algún handshake previo,
> 5. si el lector **transmite continuamente** o solo al gatillo,
> 6. el **nombre** con el que el equipo se anuncia (advertised / GAP name).

**Cómo saber si la respuesta alcanza**: con (1), (2), (3) y (6) ya se puede escribir el driver. Sin (6) el
reconocimiento queda flojo — ver la nota de abajo sobre la balanza.

**Aprovechá la llamada para cerrar la otra incógnita** (es el ítem 1 de "qué falta" del relevamiento):

> ¿El **HR0** tiene **modo HID / teclado**? Lo dicen algunos revendedores pero no lo encontramos en su
> documentación.

Si la respuesta es **sí**, es una noticia grande y algo irónica: sería el bastón **más barato del catálogo**
el que destraba iOS gratis, sin MFi y sin acuerdo con nadie.

**Lo que NO hay que pedirles**: una *key* o licencia MFi. **No tienen ninguna que dar** — su camino iOS es
BLE, que no lleva licencia de Apple. Pedirla confunde al interlocutor y hace perder el pedido real.

---

## 2. Allflex — RS420 (SPP + iAP)

El RS420 **no es BLE**: es Bluetooth Classic SPP más el perfil propietario de Apple (iAP). En Android ya
funciona y está probado en device. En iPhone **no hay camino sin MFi**.

**Qué pedir:**

> 1. La **cadena de protocolo iAP** del RS420 (el string tipo `com.allflex.…` que la app declara en su
>    `Info.plist`).
> 2. El **camino para la autorización MFi** como desarrollador integrador: a quién se le pide, qué
>    requisitos hay, y si existe un programa de integradores.

**Precedentes que conviene mencionar** (ya hay apps de gestión ganadera integradas con el RS420 en iPhone):
CattleMax, AgriWebb, Herdwatch. No estamos pidiendo algo inédito.

**El día que llegue la cadena, de nuestro lado no hay que programar nada**: entra como **una línea en la
config** más una capacidad declarada en el driver. Está probado con una cadena sintética para que ese día
sea trámite y no desarrollo.

---

## 3. Datamars (Tru-Test) — SRS2i / XRS2i

**Este no estaba en el radar y cubre dos de los cuatro modelos iOS-capaces del relevamiento.**

La regla que ordena su catálogo: **la "i" del modelo significa MFi.** `SRS2` → clásico sin certificar → no
anda en iPhone. `SRS2i` → certificado → anda. Lo mismo con `XRS2` / `XRS2i`.

**Qué pedir**: exactamente lo mismo que a Allflex — cadena de protocolo iAP + camino de autorización MFi
para los modelos con "i".

---

## Lo que NO hay que gestionar con nadie

**Gallagher HR4, Gallagher HR5 estándar, Tru-Test SRS2 y Tru-Test XRS2** son **Bluetooth clásico sin chip
MFi**. No se conectan a un iPhone **con ninguna app, nunca, por ningún acuerdo**. Es una limitación del
hardware. Cualquier gestión por esos modelos es tiempo tirado — y conviene saberlo para no prometerle a un
cliente que su bastón va a andar en iPhone.

Dato útil para la conversación comercial: **la app oficial de SENASA tampoco puede conectar un bastón en
iPhone** (1,8 estrellas en la App Store, con reseñas que se quejan exactamente de eso). El muro de iOS es
del mercado, no nuestro.

---

## Una regla nuestra que conviene no romper

**No vamos a registrar ningún lector con UUIDs o formato de trama adivinados.** Un driver con parámetros
inventados convierte una incógnita en un verde falso: la app diría "reconozco tu bastón" y no leería nada,
que es peor que decir "no lo reconozco". Un fabricante entra al registro **cuando entrega su
documentación**.

Y un caso concreto de por qué el **nombre anunciado** importa tanto como los UUIDs: el bridge de la
**balanza Vesta** anuncia **los mismos UUIDs Nordic UART** que usa nuestro banco de pruebas. Si el
reconocimiento fuera solo por UUID de servicio, la app reconocería **la balanza como un bastón**. Por eso
se reconoce por nombre.
