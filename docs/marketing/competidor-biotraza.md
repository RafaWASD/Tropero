# Biotraza (KYAS SRL) — el competidor que no teníamos en la grilla

**13/08/2026** · Apareció relevando bastones, buscando otra cosa. No estaba en `competencia.md`.

---

## Por qué importa más que Bovitag

Bovitag es un competidor de producto. Biotraza es un competidor **de la spec 08**: regala gratis,
hoy, exactamente el archivo que estamos por construir.

De su propia página, la lista de la **versión gratuita**:

> - *"Registro individual con lector RFID (compatible con cualquier dispositivo)"*
> - *"Carga masiva desde Excel"*
> - *"Generación de planilla oficial PDF y TXT (Resolución 841/2025)"*

Esa tercera línea es la feature 08 entera, en el tier gratuito de alguien que ya está en la calle.

## Qué es

| | |
|---|---|
| **Empresa** | KYAS SRL |
| **Desde** | 2019 — no es un lanzamiento oportunista por la 841/2025 |
| **Plataforma** | Web + iOS + Android |
| **Gratis** | "Versión Base SENASA": alta RFID, carga por Excel, planilla oficial PDF y TXT |
| **Pago** | "Versión Pro": *"manejo sanitario completo"*, *"datos productivos (alimentación, peso, genética)"*, *"reportes avanzados y exportación"* |
| **Precio Pro** | **No publicado.** El botón es "Solicitar Demo" |
| **Lectores** | *"cualquier equipo con conexión abierta vía Bluetooth y/o USB"* |
| **Offline** | Lo declaran para carga en campo. Sin verificar |
| **iOS** | 5,0 de 5 — con **4 reseñas**. Estadísticamente, nada |

## Las dos cosas que hacen bien y nos conviene mirar

**1. El nombre.** Se llaman **Biotraza**; la app oficial de SENASA se llama **SIGBIOtraza**. Tienen que
aclarar en su propio FAQ que son distintas: *"No. Son apps diferentes e independientes."* Esa aclaración
es la prueba de que la confusión existe — y la confusión los favorece: el productor que busca la app
oficial los encuentra a ellos. No propongo imitarlo (ver `guia-inpi-marca-mitropero.md`: es exactamente
el riesgo del que nos estamos cuidando), pero explica parte de su distribución sin pauta.

**2. El canal veterinario, ejecutado en serio.** No es un vet suelto: se presentaron en la **asamblea de
la FeVA** (federación) y el **Colegio Veterinario de Río Negro** publicó la disponibilidad de la
plataforma a sus matriculados. Encabezado: *"Estimados colegas"*.

Vale la pena nombrarlo sin vueltas: **es la jugada que acabamos de despriorizar**. El principio 5 cambió
el 13/08 a "la adquisición se juega en el contenido; el veterinario es credibilidad, no el canal". No
creo que el cambio esté mal —el canal de colegios es lento, y ellos llevan siete años—, pero conviene
saber que alguien lo está corriendo en paralelo y que ese camino, si lo queremos después, ya va a estar
ocupado.

## Lo que esto le hace a la spec 08

**No la mata. Le saca el argumento de venta.**

Lo que muere es *"generamos el TXT de SENASA"* como diferencial. Es gratis en dos lados: en la app
oficial (por planilla, vía SIGBIOtraza) y en Biotraza (por archivo). Cobrar por eso, o publicitarlo como
motivo de compra, es insostenible.

Lo que sigue en pie es el framing que la spec ya tiene escrito, y que resiste bien:

> *"miTropero es la alternativa a SIGBIOTRAZA para quien ya carga en miTropero y quiere cumplir sin re-cargar en
> otra app."* — `requirements.md`, línea 9

Ese sigue siendo cierto contra Biotraza: si el rodeo vive en miTropero, cumplir no debería costar
exportar a Excel y cargar en otra plataforma. **El valor no es el archivo, es no tener que salir.** La
spec 08 pasa de ser una feature-imán a ser higiene: si no está, hay una razón para irse.

Y hay una asimetría a favor nuestro que conviene no perder: el tier gratis de Biotraza es cumplimiento
puro, y su Pro es *"manejo sanitario completo"* + datos productivos. **No mencionan reproducción en
ningún lado** — ni servicio, ni tacto, ni preñez, ni CCL, ni índices de destete. Para un sistema de
**cría**, que es nuestro ICP, ese es el corazón del negocio y nosotros lo tenemos cerrado (feature 07).
No lo doy por confirmado sin ver el Pro por dentro, pero si se sostiene, ahí está la diferencia real.

## Qué falta

1. **El precio del Pro.** Es el dato que fija nuestro techo en el mercado local, más que Bovitag. Se
   consigue pidiendo la demo.
2. **Si el Pro hace reproductivo.** Decide si la diferencia de arriba es real o es un hueco de su web.
3. **Tamaño.** Cero datos de clientes o cabezas. Siete años operando y 4 reseñas en iOS es una señal
   ambigua: puede ser un producto web con clientes grandes, o puede ser chico.

## Fuentes

- Sitio: https://biotraza.com/ganaderia/
- App Store: https://apps.apple.com/ec/app/biotraza/id1471542186 (KYAS SRL, v8.13.1)
- Google Play: `srl.kyas.fixbean`
- Colegio Veterinario de Río Negro: https://www.colvetrionegro.com.ar/disponibilidad-de-plataforma-gratuita-biotraza-resolucion-senasa-841-2025/
