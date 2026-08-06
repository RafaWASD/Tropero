# Competencia — panorama consolidado

> **Qué es esto**: todo lo que sabemos hoy sobre competidores, con precio y fuente cuando existe. Consolida lo que estaba disperso en `CONTEXT/01-producto.md`, `CONTEXT/02-modelo-negocio.md`, el cuestionario de intake de marketing y el research de mercado de julio 2026.
> **Corte**: 5/8/2026. Los precios son los publicados por cada empresa a julio 2026.
> **Estado**: los precios con URL son verificados. Lo que dice "sin precio público" es que no lo publican, no que no lo tengan.

---

## El número que ordena todo

**Nadie en el mundo cobra miles de dólares por gestión ganadera de un campo individual.** El precio de la categoría convergió en **USD 130–300 por año**, en ocho productos independientes de ocho países distintos.

Esa convergencia no es que estén todos regalando valor: es el precio de equilibrio de una categoría donde **el que paga es el mismo que usa y el único beneficiario es su propia productividad**. Ninguna feature mueve ese ancla. Se mueve cambiando de pagador, no de funcionalidad (ver `CONTEXT/02`, capa 2).

| Producto | País | Precio publicado | Equivalente anual (USD) |
|---|---|---|---:|
| **Control Ganadero** | LatAm / Argentina | USD 129,99/año · USD 69,99/semestre · USD 14,99/mes. Gratis hasta 30 animales y 1 finca | **130** |
| CattleMax (≤50 cab.) | EE.UU. | USD 144/año | **144** |
| Herdwatch PRO | Irlanda / UK / EE.UU. | USD 49 los primeros 6 meses, después USD 20/mes | **240** |
| Gallagher Animal Performance Plus | Nueva Zelanda / global | USD 25/mes | **300** |
| Breedr | Reino Unido | £29,50/mes + IVA — **gratis** si comercializás ≥20 animales/año por su marketplace | **~470** o 0 |
| CattleMax (≤1.000 cab.) | EE.UU. | USD 660/año | **660** |
| AgriWebb | Australia | Por cabeza (unidad DSE, bovino = 8) + tarifa base. Sitio oficial sin montos; terceros citan Hobby ~USD 45/mes y Advanced ~USD 125/mes | **~540 – 1.500** |
| Performance Beef (feedlot) | EE.UU. | USD 195/mes | **2.340** |
| **RAFAQ (propuesto)** | Argentina | USD 300 base + USD 0,80/cabeza, tope USD 3.500. Gratis ≤50 cabezas | **460 – 3.500** |

**Dónde nos deja**: en un campo de 500 madres (~700 cabezas) pedimos **USD 860/año**, que es **6,6x Control Ganadero**. Eso solo se sostiene si el pitch no es "software de gestión" sino "declaración de caravanas a SENASA sin trámite manual" — o sea, comparando contra la multa y contra las horas de carga, no contra otro software. Ver `CONTEXT/02` → Posicionamiento.

---

## 1. Argentina — el competidor real

### Control Ganadero
**El dominante. Opera prácticamente como monopolio en Argentina.**

- **Precio**: USD 129,99/año, USD 69,99/semestre, USD 14,99/mes. Freemium hasta 30 animales y 1 finca. Fuente: `controlganadero.app`, 2026.
- **Qué hace**: informes en PDF, sin identificación individual del animal, sin comparación histórica, sin análisis cruzado. El productor recibe papeles que mira y archiva.
- **Su fortaleza, y no es el producto**: años instalado, clientes que lo conocen, soporte, gente en la calle, y —lo decisivo— **funciona hoy en campos reales**, cosa que lo nuestro todavía no. Tiene la confianza del rubro y un nombre que el productor ya escuchó.
- **Nuestra ventaja**: trazabilidad individual real, offline-first de verdad, agnóstico de hardware, y el archivo de SENASA.
- **⚠️ Es nuestro fast-follower más probable — no SENASA.** Tiene base instalada y distribución armada: puede agregar un botón de export a SIGSA en semanas. Lo que no puede copiar rápido es la captura BLE offline y el modelo de datos individual.

### Identigan
- **Precio**: app gratis hasta 50 animales. Hardware + software **a cotización, sin precio público**. Fuente: `identigan.com`, 2026.
- Conceptualmente parecida a lo nuestro, con presencia en otros países. **Su alcance real en Argentina no lo tenemos claro** — es un hueco de información.

---

## 2. El Estado como competidor gratuito: SIGBIOTRAZA

**La app oficial de SENASA. Es gratis y hace las tres cosas que exige la Res. 841/2025.** Es el competidor que más se subestima.

- **Plataformas**: Android e iOS (App Store `id6756583501`).
- **Tres módulos**: declarar dispositivos · iniciar TRI · cerrar DT-e.
- **Dónde nos gana**: es gratis, es oficial, y cubre TRI y cierre de DT-e — que nosotros **no** cubrimos.
- **Dónde le ganamos, y es todo lo que importa**: en la **declaración de dispositivos** obliga a tipear **raza, mes/año de nacimiento y sexo, a mano, dispositivo por dispositivo, en la manga**. RAFAQ ya tiene esos datos cargados. Ahí la diferencia es abismal.
- **Su fricción estructural**: requiere un lector RFID Bluetooth externo (no lee sola); exige un **token QR generado en SIGSA desde una computadora** con clave fiscal; el CUIT propio y el representado tienen que coincidir exacto; recomienda internet para validar y enviar; y **nunca cierra el trámite** — siempre hay un segundo paso en SIGSA web.
- **No es integrable**: no exporta archivo. Es competidor, no plataforma.
- **Pista abierta**: el manual del token dice que el mecanismo es para que *"otras aplicaciones externas"* interactúen con el sistema oficial, con permisos de *"gestionar microchips de identificación y consulta de movimientos"*. Si esa API existe, cambia el juego. Ver `docs/backlog.md`.

---

## 3. Internacionales — no sabemos si están en Argentina

Ninguno tiene presencia confirmada en el mercado argentino. Sirven como **referencia de pricing y de modelo**, no como amenaza inmediata.

### Herdwatch (Irlanda / UK / EE.UU.)
USD 20/mes tras un promo de USD 49 por 6 meses. Freemium. El comparable más cercano en posicionamiento: cumplimiento regulatorio + gestión de rodeo, en un mercado (Irlanda) donde la trazabilidad individual es obligatoria hace años.

### AgriWebb (Australia)
**El que más se parece a lo que queremos ser, y el que más plata levantó.** Precio **por cabeza** con tarifa base, usando la unidad DSE (bovino = 8 DSE). El sitio oficial no publica montos — venden con contacto comercial. Es la validación de que el modelo por cabeza funciona en un mercado ganadero extensivo comparable al nuestro.

### CattleMax (EE.UU.)
Precio **por escalones de cabezas**: USD 144/año hasta 50, USD 660/año hasta 1.000. Plan "registrado" (cabañas con pedigree) USD 192–636. Fuente: `cattlemax.com/pricing`, 2026. Es la referencia más limpia de escalonamiento por tamaño.

### Breedr (Reino Unido)
**El modelo de negocio más interesante del lote**: el software es **gratis si comercializás ≥20 animales por año a través de su marketplace**; si no, £29,50/mes + IVA. O sea: el SaaS es el costo de adquisición y el negocio real es el take rate de la comercialización. Es exactamente la "capa 2" de nuestro `CONTEXT/02`, ejecutada por otro.

### Performance Beef (EE.UU.)
USD 195/mes. Enfocado en **feedlot**, no en cría. El precio más alto del lote, y no es casualidad: el feedlot tiene más plata por cabeza y decisiones diarias de alimentación.

### iLivestock
Mencionado en el intake como competidor internacional. **Sin datos de precio ni de alcance** — hueco abierto.

---

## 4. Jardines cerrados de las marcas de hardware

**Tru-Test / Datamars (Data Link) · Allflex · Gallagher (Animal Performance)**

- Su software viene con el equipo: cómodo si comprás todo de una marca, inútil si tenés balanza de una marca y bastón de otra — que es lo que pasa en la realidad de los campos.
- Gallagher publica **USD 25/mes** para Animal Performance Plus. Datamars/Tru-Test **no publican precio de software**.
- **La estrategia con ellos es no pelearlos.** No competimos en hardware: nos colgamos de lo que el campo ya tiene. Es un argumento de venta directo — *"no cambies nada de lo que tenés"*.
- Nuestra arquitectura multivendor de bastones (registro de drivers, selección por capacidad) existe para eso.

---

## 5. Adyacentes que NO son competencia

Se listan para que no se los confunda:

- **Agrotoken** — tokenización de commodities. Otro negocio.
- **Ruuts** — programa de carbono en ganadería regenerativa (2 tCO₂/ha/año, mercado voluntario LatAm USD 3–25/t). Es un **socio potencial de la capa 2**, no un competidor. Campos de menos de 100 ha no le son rentables.
- **CREA** — grupos de asesoramiento, no software. Pero sus miembros son el segmento grande de nuestro ICP y **ya tienen asesor y planillas**, lo que los hace más difíciles de ganar, no más fáciles.

---

## Lo que no sabemos y habría que averiguar

Ordenado por cuánto cambiaría una decisión:

1. **Cuántos clientes tiene Control Ganadero en Argentina y cuánto le facturan.** Sabemos el precio de lista, no el volumen. Facundo lo puede estimar preguntando a sus propios clientes.
2. **Si Identigan tiene tracción real en Argentina** o es una marca con web y poco más.
3. **Qué descuento real hace Control Ganadero cuando lo aprietan.** El precio de lista es el techo, no el piso.
4. **Si AgriWebb, Herdwatch o CattleMax tienen algún plan de entrar a LatAm.** Un AgriWebb con capital entrando a Argentina cierra nuestra ventana.
5. **Precio de software de Datamars/Tru-Test** — no publicado.
6. **Alcance y precio de iLivestock.**

---

## Cómo usar esto

- Para el **pitch**: no comparar contra software. Ver `CONTEXT/02` → Posicionamiento y el límite del claim.
- Para el **pricing**: la tabla de arriba es el ancla que tiene en la cabeza el comprador. Cualquier número nuestro se lee contra esos USD 130.
- Para el **producto**: lo único que ninguno de estos tiene es **data agregada de muchos campos**. El benchmarking anónimo entre campos del plan Vet Pro no es copiable sin la base instalada.

**Fuentes**: sitios oficiales de cada producto (julio 2026), `CONTEXT/01-producto.md`, `docs/marketing/cuestionario-intake-respuestas.md` §42-46, y el research de mercado de la sesión de modelo de negocio (1/8/2026).
