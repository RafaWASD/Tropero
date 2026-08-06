# 01 — Producto

## Qué construimos

Una plataforma de gestión ganadera mobile-first para el mercado argentino. El producto transforma datos crudos de campo (RFID, pesajes, eventos reproductivos, eventos sanitarios) en inteligencia accionable: dashboards, análisis de tendencias, comparativas y alertas automáticas.

## Para quién

**Comprador**: dueño/productor del campo.
**Influenciador técnico**: veterinario de campo.
**Operador diario**: capataz/peón.

## El problema que resolvemos

Las soluciones existentes en Argentina (principalmente Control Ganadero, que opera como monopolio) producen informes estáticos en PDF, sin identificación individual de animales, sin comparación histórica y sin análisis cruzado de datos. El productor recibe papeles que mira y archiva, no datos sobre los que pueda actuar.

Hay además un driver regulatorio fuerte: desde el 1/1/2026 la identificación electrónica es obligatoria para los terneros bovinos al destete (Res. SENASA 841/2025), y el rodeo adulto queda cubierto por reposición natural. Cada identificación debe declararse ante SENASA dentro de los 10 días hábiles. Eso fuerza la adopción de identificación electrónica y crea demanda recurrente de la declaración.

## La propuesta de valor

Convertir el día a día del campo en una capa de inteligencia continua:
- Trazabilidad individual real por animal (TAG electrónico + caravana visual)
- Dashboards y KPIs que muestran tendencias, no fotos puntuales
- Alertas automáticas (vacunaciones vencidas, animales no pesados, partos próximos)
- Reportes comparables entre períodos
- Carga rápida y offline-first en el campo
- Integración con SENASA (exportación a SIGSA) — feature diferencial

## Por qué no es solo Bluetooth

La integración con bastón y balanza Bluetooth es una **capacidad necesaria**, no el diferencial. Cualquier competidor puede integrar Bluetooth. El diferencial es la **capa de inteligencia** construida sobre los datos del campo.

## MVP scope

Sistema de cría bovina exclusivamente. Otros sistemas (invernada, feedlot, tambo, cabaña) y otras especies (equino, porcino) son evolutivos posteriores. La arquitectura está preparada desde día 1 pero solo cría está habilitado en la UI.

Ver `CONTEXT/08-roadmap.md` para el detalle de qué está dentro y fuera del MVP.

## Equipo

Raf — desarrollo completo del producto.
Vet socio (UNLP) — dominio, validación de flujos, red comercial, ventas. Equity 50/50.
Padre del vet socio — primer cliente beta. Campo en Chascomús.

## Competencia identificada

> ⚠️ **Revisado el 5/8/2026** contra una auditoría de 30+ productos. La versión anterior de esta sección era falsa en dos puntos: decía que Control Ganadero opera "como monopolio" y que genera "informes estáticos sin individualización". Ver `docs/marketing/competencia.md` — ese documento es la fuente de verdad de competencia.

**El mercado argentino NO es un monopolio.** Hay al menos una docena de jugadores: Vacuno, Digirodeo, Huella, Ñandú, Albor, Agrodeo, Cattler, Wincampo, Kelpie, SYNAgro, Calipso, más los regionales.

**Vacuno** (`vacuno.app`, Argentina): **el competidor más parecido a RAFAQ.** Cría, offline-first, RFID HDX/FDX-B, bastón Bluetooth propio, módulo reproductivo completo, rol de prestador de servicios. Cobra por cantidad de animales en pesos. Sus dos debilidades frente a nosotros: vende su propio bastón (no es agnóstico) y no exporta el archivo SIGSA.

**Control Ganadero**: el más instalado (autorreporta 22.712 ganaderos y 583.925 animales, en iOS desde 2013). **Hace más de lo que asumíamos**: funciona offline, identifica por RFID, lee lectores Bluetooth y balanzas, tiene módulo reproductivo y rol de veterinario. Sus huecos reales: **ninguna integración con SENASA/SIGSA** y sesgo lechero en el módulo reproductivo.

**Identigan**: **es colombiano, no argentino** (800+ usuarios, 50.000+ animales). No es una amenaza en nuestro mercado.

**Albor**: el más grande de Argentina (4.000+ usuarios, 2,2M cabezas). Carga manual, cobro por usuario, enfoque económico. Su diferencial es la conexión con entes reguladores — si baja al dato individual, tiene la base instalada para hacerlo.

**AgriWebb** (Australia): el producto más parecido al nuestro en el mundo — cría extensiva, offline, BLE agnóstico, export a trazabilidad oficial. **Adquirida por URUS Group en 2026**, ya presente en Brasil vía Cargill. **Ya está prospectando Argentina** (verificado 5/8/2026): landing en español rioplatense, gerenta de éxito del cliente para LatAm, WhatsApp y prueba gratuita. Es una cabecera de leads, no una operación instalada — sin precios locales, sin casos argentinos y **sin ninguna mención a SENASA ni SIGSA**. Cobra por cabeza vía DSE sobre el promedio de 12 meses.

**Software propietario de marcas de hardware** (Tru-Test/Datamars, Allflex, Gallagher): silos cerrados, atados a comprar hardware específico.

**SIGBIOTRAZA** (app oficial de SENASA, gratis): cubre las tres obligaciones de la 841/2025. Le ganamos solo en el alta, donde obliga a tipear raza, sexo y fecha animal por animal en la manga.

## Posicionamiento

No competir en hardware. Competir en inteligencia de datos. Ser el sistema operativo de la gestión ganadera argentina, agnóstico de marca de bastón o balanza.
