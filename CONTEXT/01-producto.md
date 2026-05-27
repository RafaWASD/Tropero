# 01 — Producto

## Qué construimos

Una plataforma de gestión ganadera mobile-first para el mercado argentino. El producto transforma datos crudos de campo (RFID, pesajes, eventos reproductivos, eventos sanitarios) en inteligencia accionable: dashboards, análisis de tendencias, comparativas y alertas automáticas.

## Para quién

**Comprador**: dueño/productor del campo.
**Influenciador técnico**: veterinario de campo.
**Operador diario**: capataz/peón.

## El problema que resolvemos

Las soluciones existentes en Argentina (principalmente Control Ganadero, que opera como monopolio) producen informes estáticos en PDF, sin identificación individual de animales, sin comparación histórica y sin análisis cruzado de datos. El productor recibe papeles que mira y archiva, no datos sobre los que pueda actuar.

Hay además un driver regulatorio fuerte: desde julio 2026 las caravanas electrónicas son obligatorias para todo el ganado bovino bajo SENASA. Eso crea un deadline de mercado y fuerza la adopción de identificación electrónica.

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

**Control Ganadero**: dominante, monopolio actual. Genera informes estáticos sin individualización. Vulnerable a una solución que ofrezca trazabilidad real e inteligencia continua.

**Identigan**: app similar conceptualmente, presente en otros países. No es claro su alcance en Argentina.

**Software propietario de marcas de hardware** (Tru-Test, Datamars, Allflex): silos cerrados, atados a comprar hardware específico.

## Posicionamiento

No competir en hardware. Competir en inteligencia de datos. Ser el sistema operativo de la gestión ganadera argentina, agnóstico de marca de bastón o balanza.
