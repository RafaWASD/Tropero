# 02 — Modelo de Negocio

## Estado de la decisión

**Modelo de negocio definido a nivel conceptual. Pricing concreto a validar con vet socio. Billing diferido para post-beta.**

## Estrategia comercial

El veterinario es el canal de adquisición más importante. Un vet rural atiende entre 10 y 30 campos. Si el vet adopta la herramienta porque le facilita su trabajo, lleva a sus clientes detrás como efecto natural.

Por eso la regla central: **nunca degradar la experiencia operativa del vet**. El vet no tiene un "trial limitado" — tiene una herramienta profesional con scope natural según el plan.

## Estructura de planes

**Plan Vet Base — 5 USD/mes (a confirmar)**
Para veterinarios que trabajan en campos sin VESTA Productor activo.
- Funcionalidades completas en manga (carga de maniobras, BLE, presets, etc.)
- Hasta 5 campos temporales en simultáneo, cada uno dura 1 semana
- Genera reportes de cada sesión
- No conserva historial comparativo entre períodos
- Al borrarse un campo temporal, permite crear otro

**Plan Vet Pro — 20 USD/mes (a confirmar)**
Para veterinarios que quieren autonomía total.
- Todo lo del Base
- Crear campos propios con persistencia de datos a largo plazo
- Vista multi-cliente
- Benchmarking anónimo entre campos
- Portfolio profesional exportable
- Agenda integrada de visitas
- Centralización de análisis de laboratorio
- Protocolos sanitarios reutilizables
- Alertas cruzadas multi-campo

**Plan Productor — 20 USD/mes por campo (a confirmar)**
Lo paga el dueño del establecimiento.
- Todas las funcionalidades operativas y de gestión
- Cuando el vet con plan Base entra a este campo, accede con funcionalidades completas y los datos quedan en la cuenta del dueño
- Sin límite de animales ni de usuarios invitados

## Reglas de cruce entre planes

| Situación del vet | Campo del cliente | Experiencia del vet |
|---|---|---|
| Vet Base | Sin VESTA Productor | Trabaja en campo temporal propio (1 semana) |
| Vet Base | Con VESTA Productor activo | Trabaja con funcionalidades completas, datos van al campo del dueño |
| Vet Pro | Sin VESTA Productor | Crea campo propio con persistencia |
| Vet Pro | Con VESTA Productor activo | Igual que Vet Base con campo del dueño + features Pro propias |

## Funcionalidades específicas para el veterinario

El vet paga porque le ofrecemos algo que **solo tiene sentido cruzando data de todos sus clientes**:

- **Vista multi-cliente**: pantalla única con todos los campos atendidos, alertas por campo, próximas visitas
- **Benchmarking anónimo**: "tu cliente está 4% arriba del promedio Chascomús, 2% abajo de tu histórico"
- **Portfolio profesional**: dashboard exportable con su trayectoria, resultados, % de mejora en clientes
- **Agenda integrada**: visitas planificadas, qué campos necesitan atención
- **Centralización de análisis de lab**: todos los PDFs de laboratorios en un solo lugar organizados por animal y campo
- **Protocolos reutilizables**: planes sanitarios propios aplicables con dos clicks en cualquier campo
- **Alertas cruzadas**: "5 animales positivos sin acción registrada en 3 campos"

Ninguna competencia ofrece esto porque ninguna tiene la data agregada.

## Anti-fraude

Necesitamos prevenir que un dueño con varios campos físicos abra una sola cuenta y los use a todos como uno solo (para no pagar por cada uno).

Mecanismo propuesto a discutir:
- Validación opcional con CUIT y RENSPA al crear campo
- Límite de animales por campo (umbral alto pero detectable)
- Análisis de patrones de uso (lotes muy heterogéneos, geolocalización al cargar, etc.)
- Auditoría manual en casos sospechosos

## Lo que NO se decide ahora

- Números exactos de pricing (se ajustan tras beta)
- Si hay tier completamente gratuito (vet socio decide, depende de psicología de mercado)
- Modelo de venta (suscripción mensual vs anual con descuento)
- Marketing y go-to-market detallado

## Lo que se prepara en el código desde día 1

Solo lo necesario para que cualquier modelo de pricing sea trivial de implementar:

```sql
establishments
  + plan_type        (default 'free')
  + plan_started_at  (default null)
  + plan_limits      (JSON, default '{}')

users
  + subscription_type (default 'free')
  + subscription_data (JSON, default '{}')
```

Y un middleware de límites que en MVP no chequea nada. Cuando se active billing, solo se modifica qué se carga en `plan_limits` y qué chequea el middleware. Cero refactor de tablas.

Ver `docs/adr/ADR-009-billing-deferred.md`.

## Lanzamiento

**Beta gratuita 6-12 meses** para el campo del vet socio en Chascomús y campos adicionales que sume el vet socio. Comunicando desde el día 1 que el producto será pago a futuro.

Cuando haya 10+ campos pidiendo entrada activa, se activa el sistema de pricing real.
