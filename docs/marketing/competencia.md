# Auditoría de competencia

> **Corte**: 5/8/2026. Relevamiento de 30+ productos en tres clusters (hispano, brasileño, anglosajón), perfilados contra la misma grilla.
> **Reemplaza** la versión anterior de este documento, que estaba construida sobre supuestos que este relevamiento desmintió.

---

## Veredicto: cuál se parece más

La pregunta tiene **dos respuestas distintas** y conviene no mezclarlas.

### El más parecido por producto: **AgriWebb** (Australia)

Cumple 8 de los 9 rasgos que definen a RAFAQ. Lo único que no comparte es el mercado.

Cría extensiva a pasto · app nativa con offline real · identificación individual por EID · **Bluetooth genuinamente agnóstico de marca** (Gallagher, Tru-Test, Allflex RS420, Agrident, Shearwell, Te Pari, Pharmweigh, PTS) · módulo reproductivo con KPIs · **exporta a NLIS**, el sistema oficial de trazabilidad australiano · multi-establecimiento con acceso de asesores · **no vende hardware**.

Es, punto por punto, la misma tesis de producto que la nuestra, ejecutada en el país cuya ganadería más se parece a la argentina. Difiere en dos cosas: cobra **por cabeza** en vez de por campo, y suma ovinos y finanzas.

#### ⚠️ AgriWebb ya está prospectando Argentina (verificado 5/8/2026)

Entrar a `agriwebb.com` desde una IP argentina **redirige a `info.agriwebb.com/es-ar/`: "Software de Gestión Ganadera para Productores de Argentina"**, escrita en español rioplatense con voseo y vocabulario rural correcto (*"Tomá mejores decisiones"*, potrero, destete, carga animal, lote, caravana electrónica).

Lo que **sí** hay: landing dedicada, **Gerente de Éxito del Cliente para Latinoamérica con nombre y cara** (Heloisa Dominguez), canal de **WhatsApp** ("Hablá con nosotros"), CTA de prueba gratuita, login, y agendamiento de demo por HubSpot.

Lo que **no** hay: ni un precio en pesos ni en dólares, ni un solo testimonio o caso de un campo argentino, ni oficina ni teléfono local, ni cifras de clientes en Argentina, ni cobertura de prensa de un lanzamiento. Y —lo más importante— **ninguna mención a SENASA, SIGSA, trazabilidad argentina ni caravanas oficiales.** La página incluso se contradice sola: dice "más de 20.000 productores" en un lugar y "18.000" en otro.

**Lectura**: es una **cabecera de playa de generación de leads, no una operación instalada.** Están testeando el mercado. Pero es el producto más parecido al nuestro, con ~USD 64,6M levantados, recién comprado por URUS Group y ya operando en Brasil vía Cargill — y está tocando la puerta de nuestro mercado. **La ventana es más corta de lo que pensábamos.**

**Nuestro margen sigue estando en el mismo lugar**: no tienen integración con SENASA, no tienen el archivo SIGSA, y no tienen el trámite de la 841/2025 resuelto. Es literalmente lo único que su landing argentina no nombra.

#### Cómo cobra AgriWebb, en detalle

| | |
|---|---|
| **Unidad** | Por cabeza, normalizada en **DSE** (*Dry Sheep Equivalent*): **1 bovino = 8 DSE · 1 ovino = 1,5 DSE** |
| **Base** | *"Subscription fees start with a baseline fee for an active subscription, and then this will increase according to the number of livestock you run"* |
| **Cómo cuentan los animales** | **Promedio de los últimos 12 meses**, no una foto: *"to handle any fluctuations depending on your operation type"*. Se recalcula en la renovación |
| **Si el rodeo cambia** | Hay que avisar a soporte antes de renovar (destetes forzados por sequía o inundación, saltos de stock) |
| **Ciclo** | Mensual o anual, **con descuento por pago anual**. **Sin contrato de permanencia.** Sin reembolso de lo pagado por adelantado |
| **Planes** | Essentials → Compliance → Performance (solo 2 en Reino Unido). Cada nivel se elige además como **Mob management** (por lote) o **Individual management** (por animal) |
| **Qué separa los planes** | Essentials: mapa del campo + registros. Compliance: + auditoría, bioseguridad, tratamientos, pesos, alimentación. Performance: + proyecciones de peso, pastoreo, reportes financieros |
| **Add-ons con precio** | Movement Planning **AU$300/año** · Grazing Planning **AU$300/año** (en EEUU: US$100 y US$150) · Cibo Labs PastureKey **desde US$1.000/año**. En Reino Unido y Europa van incluidos |
| **Canal de asesores** | Programa de referidos: **30% de descuento el primer año + voucher de US$100 para el asesor** |
| **Tarifa por DSE** | **No es pública.** La página de precios es una calculadora en JavaScript: hay que cargar la cantidad de cabezas. Titular: *"only pay for the animals you manage"*. Fuentes terciarias ubican los planes australianos en ~AU$34 / 48 / 61 por mes, sin verificar |

**Lo que hay que copiarles**: el **promedio de 12 meses**. Nuestro pricing cobra por cabeza sobre una foto del padrón, y un campo de cría oscila fuerte — 500 madres son ~700 cabezas en invierno y ~1.200 con los terneros al pie. Cobrar sobre la foto invita a que el productor descargue animales antes de la fecha de corte y garantiza discusiones de facturación. El promedio móvil lo resuelve y ya está probado en producción por alguien más.

**Lo que no necesitamos**: el DSE. Es su solución para mezclar bovinos con ovinos. Con el MVP bovino puro no aplica — pero es el patrón a seguir si alguna vez entran ovinos.

### El más parecido que te importa: **Vacuno** (Argentina) — y no lo teníamos en el radar

`vacuno.app`. Argentino. **Es casi el mismo producto, en el mismo mercado, ya funcionando.**

| | Vacuno | RAFAQ |
|---|---|---|
| Sistema | Cría, foco reproductivo | Cría |
| Offline-first | Sí | Sí |
| RFID individual | Sí, HDX y FDX-B | Sí |
| Bluetooth | Sí, **bastón propio** | Sí, **agnóstico de marca** |
| Reproductivo | Servicios, tactos, partos, IA, destete | Igual |
| Rol veterinario | Sí, plan "prestadores de servicios" | Sí |
| Trazabilidad oficial | Parcial — planillas SENASA | **Export SIGSA de caravanas** |
| Cobro | Por cantidad de animales, en pesos | Por campo |
| Precios | Gratis ≤50 · $19.999/mes ≤500 · $49.999/mes ilimitado · $9.999/mes prestadores | USD 300 + 0,80/cabeza |

**Las dos diferencias reales**: ellos **venden su propio bastón** (nosotros somos agnósticos, que es un argumento de venta directo: *"no cambies nada de lo que tenés"*), y **cobran por cabeza en pesos**, no por campo en dólares.

Que exista Vacuno no invalida el proyecto — valida que la tesis tiene mercado. Pero cambia el discurso: ya no somos los primeros en hacer esto en Argentina, y hay que saber por qué somos mejores antes de que lo pregunte un productor.

---

## Tres correcciones a nuestros propios documentos

Esto es lo más importante de la auditoría. Veníamos operando sobre premisas falsas.

### 1. "Control Ganadero opera como monopolio" — **es falso**

`CONTEXT/01-producto.md` dice que Control Ganadero es el dominante y opera prácticamente como monopolio. El mercado argentino tiene, como mínimo: **Vacuno, Digirodeo, Huella, Ñandú, Albor, Agrodeo, Cattler, Wincampo, Kelpie, SYNAgro, Calipso**, más los regionales (Control Ganadero, Software Ganadero SG). No es un monopolio: es un mercado fragmentado con una docena de jugadores.

### 2. "Control Ganadero produce informes PDF estáticos sin individualización" — **también es falso, o está muy desactualizado**

Es la premisa de la que cuelga todo nuestro posicionamiento. La realidad relevada:

- **Funciona offline** ("registre información sin internet", guarda local y sincroniza).
- **Identificación individual con RFID**: chips subcutáneos, caravanas electrónicas y stickers NFC.
- **Lee lectores RFID por Bluetooth y balanzas electrónicas** con registro automático.
- **Tiene módulo reproductivo**: inseminación, alertas de parto, días abiertos, secado.
- **Tiene rol de veterinario** y soporta múltiples fincas por cuenta.
- Autorreporta **22.712 ganaderos activos y 583.925 animales**. En iOS desde 2013 — trece años.

O sea: **hace casi todo lo que hacemos nosotros.** El diferencial "nosotros individualizamos y ellos no" no se sostiene. Lo que sí le falta, y es nuestro hueco real: **ninguna integración con SENASA/SIGSA**, sesgo lechero en el módulo reproductivo, y profundidad no verificada en KPIs de cría extensiva.

**Hay que reescribir el pitch competitivo antes del material de marca.**

### 3. Identigan es **colombiano**, no argentino

`CONTEXT/01` lo lista como competidor argentino. Opera en Colombia. 800+ usuarios, 50.000+ animales — chico. Y **0 anuncios activos** en Meta. No es una amenaza en nuestro mercado.

---

## La grilla completa

Rasgos de RAFAQ: ① cría bovina extensiva · ② móvil offline-first · ③ RFID individual · ④ BLE agnóstico de marca · ⑤ reproductivo con KPIs · ⑥ export a trazabilidad oficial · ⑦ rol vet multi-campo · ⑧ no vende hardware · ⑨ mercado hispano.

| Producto | País | ① | ② | ③ | ④ | ⑤ | ⑥ | ⑦ | ⑧ | ⑨ | Cobro |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| **AgriWebb** | AU | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | por cabeza (DSE) |
| **Vacuno** | **AR** | ✅ | ✅ | ✅ | ❌ | ✅ | 🟡 | ✅ | ❌ | ✅ | por cabeza (ARS) |
| **Control Ganadero** | LatAm | 🟡 | ✅ | ✅ | ✅ | 🟡 | ❌ | ✅ | ✅ | ✅ | por cuenta, freemium |
| iRancho | BR | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❓ | ✅ | ❌ | por cabeza |
| iLivestock | UK | 🟡 | ✅ | ✅ | ✅ | 🟡 | ✅ | ❌ | ❌ | ❌ | **£300/año por campo** |
| Herdwatch | IE/UK | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | por granja |
| CattleMax | US | ✅ | 🟡 | ✅ | ✅ | ✅ | ❌ | 🟡 | ✅ | ❌ | por cabeza, tiers |
| Fertili | BR | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | 🟡 | ✅ | ❌ | suscripción |
| Digirodeo | **AR** | ✅ | ✅ | ✅ | ❌ | ❓ | 🟡 | ❓ | ❌ | ✅ | suscripción, 3 niveles |
| Breedr | UK | ✅ | ✅ | ✅ | ❓ | ✅ | ❌ | 🟡 | ✅ | ❌ | freemium + 2% marketplace |
| Identigan | **CO** | 🟡 | ✅ | ✅ | ❌ | 🟡 | ❌ | 🟡 | ❌ | ✅ | freemium |
| Huella | **AR** | ✅ | ❓ | ✅ | ❓ | 🟡 | 🟡 | ❓ | ✅ | ✅ | licencia + anual |
| Agrodeo | UY/AR | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ✅ | ✅ | USD 0–89,99/mes |
| Albor | **AR** | 🟡 | 🟡 | ❌ | ❌ | ❌ | ✅ | 🟡 | ✅ | ✅ | por usuario |
| Datamars/Tru-Test | CH/NZ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | gratis con hardware |
| Gallagher | NZ | ✅ | ❓ | ✅ | ❌ | 🟡 | ✅ | ✅ | ❌ | ❌ | gratis / USD 25 mes |
| Mobble | AU | ✅ | ✅ | ❌ | ❌ | 🟡 | ❌ | ✅ | ✅ | ❌ | USD 30–210/mes |
| Sistema Mais Leite | BR | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❓ | ✅ | ❌ | por vacas adultas |
| Performance Beef | US | ❌ | ✅ | ✅ | ❓ | ❌ | ❌ | ✅ | ✅ | ❌ | **USD 195/mes** |
| Nedap Livestock | NL | ❌ | 🟡 | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | a cotización |
| Rúmina | BR | ❌ | ❓ | ❌ | ❌ | ✅ | ❌ | ❓ | ❌ | ❌ | a cotización |

✅ sí · 🟡 parcial · ❌ no · ❓ no encontrado

**No son competencia** y estaban ensuciando la lista: **Pecuaria Digital** (escuela online de engorde, Paraguay — vende un curso de USD 297), **AGROS** (agencia de marketing digital agro que compite por el keyword, no por el producto), **Sygma Sistemas** (ERP fiscal brasileño), **Primaza** (fabricante de caravanas y bastones — es socio potencial, no rival), **Probeef** (marca de nutrición de **Cargill**; su software *es* AgriWebb, del que Cargill es distribuidor exclusivo en Brasil).

---

## Lo que no hace casi nadie — y es donde queda nuestro espacio

De los 21 productos con perfil completo:

1. **Integración con el sistema oficial de trazabilidad**: solo la tienen los de mercados donde es obligatoria hace años — AgriWebb (NLIS), Herdwatch (ICBF/BCMS/ScotEID), iLivestock (BCMS), Datamars y Gallagher (NAIT/NLIS), y Albor en Argentina. **Ningún producto brasileño la publica. Control Ganadero no la tiene. Vacuno solo tiene planillas, no el archivo SIGSA.**
2. **Rol de veterinario con cuenta propia multi-establecimiento**: casi nadie lo tiene como figura de primera clase. Lo más cercano son "asesores con permisos". Es un diferencial real y es nuestro canal de venta.
3. **Bluetooth agnóstico de marca**: lo tienen AgriWebb, Herdwatch, CattleMax, iLivestock, iRancho. **En Argentina no lo tiene nadie** — Vacuno, Digirodeo e Identigan venden su propio lector.

**Ese es el hueco**: en Argentina, ser el único que combina *export SIGSA + agnóstico de hardware + rol de veterinario*.

---

## Riesgos competitivos

**AgriWebb fue adquirida por URUS Group** (anunciado mayo 2026, cierre esperado Q3 2026), una empresa estadounidense de genética bovina. Sigue con marca y management propios. Levantó ~USD 64,6M en 11 rondas, opera en 18 países, ~23-25M animales, y **ya está en Brasil vía Cargill**. No hay señal de entrada a Argentina ni producto en español, pero un dueño norteamericano con foco en genética bovina cambia el cálculo para 2027.

**Vacuno ya está en el mercado** con un producto casi idéntico y precios en pesos. Es el competidor a estudiar de cerca, no Control Ganadero.

**Albor es el más grande de Argentina**: 4.000+ usuarios, 5,6M ha, 2,2M cabezas. Su diferencial declarado es justamente conectar con entes reguladores nacionales y provinciales de Argentina, Paraguay, Uruguay y Bolivia. Es carga manual y economía-first, así que no compite en la manga — pero si decide bajar al dato individual, tiene la base instalada para hacerlo.

---

## Uruguay: el espejo de lo que viene, y una advertencia

En Uruguay la trazabilidad individual es obligatoria desde 2006. **El software de declaración no lo hace el mercado: lo hace el Estado.** El SNIG cubre los 12 millones de bovinos, tiene portal del productor renovado en diciembre de 2025, **app móvil oficial desde noviembre de 2016** y guías digitales de propiedad y tránsito. El productor uruguayo no compra una app para declarar — declara en el sistema oficial.

Lo que sí compra es **gestión productiva que dialogue con el sistema oficial**. Y ahí aparece la feature más interesante de todo este relevamiento: **Gecos** (Montevideo) *"compara el archivo bajado del SNIG contra la base del establecimiento y reporta las diferencias"*.

**La advertencia**: SENASA ya publicó SIGBIOTRAZA para declarar caravanas. Si Argentina sigue el camino uruguayo, **exportar el archivo SIGSA es un puente, no un foso** — el Estado lo va a cerrar solo. El foso durable es lo que hace Gecos: **reconciliar el rodeo real contra el oficial y mostrar la diferencia**. Eso el Estado no lo va a construir nunca, porque solo ve su propio lado.

---

## Precios verificados

| Producto | Precio | Modelo |
|---|---|---|
| Control Ganadero | USD 14,99/mes · 79,99 semestral · 149,99/año · internacional USD 99,99/año · MX $299/mes | freemium ≤20-30 animales |
| **Vacuno (AR)** | Gratis ≤50 · **$19.999/mes** ≤500 · **$49.999/mes** ilimitado · $9.999/mes prestadores | por cantidad de animales |
| CattleMax | 50 cab. USD 144/año · 100 → 216 · 250 → 288 · 500 → 336 · 750 → 420 · 1.000 → **660/año** | por cabeza en tramos |
| iLivestock | **£27,50/mes o £300/año** por granja | por granja |
| Mobble | USD 30 / 50 / 95 / 210 por mes según tope de 120 / 600 / 3.000 / 9.000 cabezas | por tope de stock |
| Agrodeo | USD 0 / 19,99 / 34,99 / 49,99 / 89,99 por mes | escalonado |
| Performance Beef | **USD 195/mes** o 2.106/año | plano por operación |
| Gallagher | Gratis con hardware · Plus **USD 25/mes** | freemium atado a hardware |
| Breedr | 12 meses gratis de Pro (valor **£354**) si comercializás 20+ animales · comisión **2%** al vendedor | freemium + marketplace |
| Sygma Sistemas | R$ 270/mes + R$ 45/mes por propiedad adicional | por establecimiento |
| Herdwatch | Promo 6 meses €79/£79/USD 49 · lista a cotización | por granja |
| AgriWebb | Tarifa por DSE **no pública** (calculadora JS). Add-ons: AU$300/año pastoreo, AU$300/año movimientos, PastureKey desde US$1.000/año. Terciarias: ~AU$34/48/61 por mes | por cabeza vía DSE (1 bovino = 8), **promedio de 12 meses**, sin permanencia |
| **RAFAQ (propuesto)** | USD 300 + USD 0,80/cabeza, tope 3.500, gratis ≤50 | por campo |

**Recalibración del ancla**: seguimos siendo caros contra Control Ganadero (USD 130/año), pero el rango de la categoría es más ancho de lo que creíamos — iLivestock cobra £300/año por campo y Performance Beef USD 2.340/año. Nuestro USD 860 en un campo de 500 madres queda en el medio del rango internacional, no en el techo.

---

## Qué falta averiguar

1. **Vacuno**: cuántos clientes tiene, hace cuánto opera, si levantó inversión. Es la incógnita más importante del documento.
2. **Digirodeo**: precio exacto de sus tres niveles.
3. **Control Ganadero en Argentina**: precio local y cuántos de esos 22.712 ganaderos son argentinos.
4. **Comitiva Gestão** (Brasil): anuncia en Meta pero no tiene huella pública verificable. Se resuelve entrando al anuncio y viendo el dominio de destino.
5. **Herdwatch y AgriWebb**: precio de lista real, que ninguno publica.

**Método**: perfilado por tres relevamientos paralelos contra la misma grilla, sobre sitios oficiales, tiendas de aplicaciones, prensa sectorial y la guía de apps ganaderas de CREA. Todo lo que no se pudo verificar quedó marcado como no encontrado en vez de completarse por inferencia.
