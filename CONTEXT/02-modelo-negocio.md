# 02 — Modelo de Negocio

## Estado de la decisión

**Revisado el 1/8/2026** tras una sesión de council sobre modelo de negocio, con research de mercado (SENASA, CREA, IPCVA, precios públicos de competencia local e internacional).

Qué cambió respecto de la versión anterior:
- El pricing pasa de **plano por campo** (USD 20/mes) a **base + por cabeza con tope**.
- Se separa explícitamente **usuario / canal / pagador**: dejan de ser la misma persona.
- Se define una **segunda capa de monetización** (verificación pagada por un tercero) con un evento concreto que la habilita.
- El gobierno queda descartado como cliente y redefinido como **estándar de integración**.
- Se descarta **publicidad en redes** como canal de adquisición.

Lo que NO cambió: **nadie pagó todavía**. Todo el pricing de este documento es una hipótesis calibrada contra el mercado, no una validación. El criterio de validación está al final.

## Los tres roles que no son la misma persona

El error del modelo anterior era asumir que el que usa, el que trae y el que paga son la misma figura.

| Rol | Quién | Qué necesita |
|---|---|---|
| **Usuario** | Capataz / peón en la manga | Velocidad. Si es más lento que el cuaderno, no se usa. |
| **Canal** | Veterinario (cuenta multi-establecimiento) | Que le sirva a él en la jornada, y que lo haga quedar bien con su cliente. |
| **Pagador (capa 1)** | Dueño del campo | Cumplir 841/2025 sin trámite manual. |
| **Pagador (capa 2)** | Exportador / certificador | Prueba auditable del origen del animal. |

El veterinario **no es un cliente más: es el canal**. Un vet rural atiende entre 10 y 30 campos. Regla central: **nunca degradar la experiencia operativa del vet**.

## Posicionamiento del pitch

**No vendemos gestión ganadera. Vendemos cumplimiento de la Res. 841/2025 con lectura BLE.**

Es la diferencia entre competir contra Control Ganadero (USD 129,99/año, instalado hace años, con la confianza del rubro) y competir contra el trámite manual y la multa. Contra software somos caros; contra el trámite somos baratos.

El valor de gestión (KPIs, historia individual, comparativas) es lo que retiene, no lo que vende.

## Capa 1 — SaaS al productor (mes 0-18)

### Pricing

**USD 300/año de base + USD 0,80 por cabeza. Tope: USD 3.500/año.**
**Gratis hasta 50 cabezas.**

| Escala | Precio/año | % de facturación bruta del campo |
|---|---|---|
| ≤50 cabezas | Gratis | — |
| 200 cabezas | USD 460 | — |
| 500 madres (~700 cab.) | USD 860 | ~0,35% |
| 2.000 cabezas | USD 1.900 | — |
| 3.000+ cabezas | Tope USD 3.500 | — |

Condiciones de cobro:
- **Anual adelantado**, cobrado en la zafra de terneros (no mensual: el flujo de caja del campo es estacional).
- **En pesos, indexado** (kg de novillo del Mercado Agroganadero, o USD del día de emisión). El productor no factura en dólares.
- **Fuera de las tiendas** (link de pago propio) para no perder 15-30%.
- **Precio congelado 24 meses** para los primeros 25 clientes.
- Sin límite de usuarios invitados.

### Por qué estos números

- El mercado de gestión ganadera converge en **USD 130-240/año** en 8 productos y 8 países independientes (Control Ganadero 130, CattleMax 144-660, Herdwatch 240, Gallagher 300, Breedr ~£354, Performance Beef 2.340). Ese es el precio de equilibrio de una categoría donde el que paga es el mismo que usa.
- Cobrar 6x el incumbente solo se sostiene si el pitch **no es gestión**. Ver posicionamiento.
- El componente por cabeza captura la cola: el 70% de las unidades tiene <500 cabezas pero solo el 36% del rodeo. El valor está concentrado y el pricing plano lo regalaba.
- El tope existe para no volverse impagable en campos de 5.000+ y para no invitar a la fragmentación de establecimientos (ver anti-fraude).

### Planes de veterinario

Se mantienen del modelo anterior, con la lógica de canal intacta:

- **Vet Base — USD 5/mes.** Funcionalidad completa en manga, hasta 5 campos temporales simultáneos de 1 semana cada uno. Reportes por sesión, sin historial comparativo.
- **Vet Pro — USD 20/mes.** Campos propios con persistencia, vista multi-cliente, benchmarking anónimo entre campos, portfolio profesional exportable, agenda de visitas, centralización de análisis de lab, protocolos reutilizables, alertas cruzadas.

Cuando el vet entra a un campo con plan Productor activo, trabaja con funcionalidad completa y los datos quedan en la cuenta del dueño.

| Situación del vet | Campo del cliente | Experiencia del vet |
|---|---|---|
| Vet Base | Sin plan Productor | Campo temporal propio (1 semana) |
| Vet Base | Con plan Productor | Funcionalidad completa, datos al campo del dueño |
| Vet Pro | Sin plan Productor | Campo propio con persistencia |
| Vet Pro | Con plan Productor | Igual que Base + features Pro propias |

## Capa 2 — Verificación pagada por un tercero (diferida)

El productor no tiene miles de dólares para software. El que sí los tiene es **el que hoy se come un riesgo porque el dato no existe o no es auditable**.

**Un solo tercero al arranque: el exportador / certificador EUDR.**

Por qué ese y no otro:
- Deadline legal duro: **30/12/2026**, aplicación de EUDR a exportadores argentinos. Registro en VISEC Carne, no-deforestación post-31/12/2020.
- Comprador obligado y solvente: la tonelada premium de Cuota Hilton ronda **USD 24.000**, y Argentina completó la cuota al 100% por primera vez en 6 años.
- No requiere licencia regulatoria propia (a diferencia de warrant, seguro o crédito).

**Evento que habilita la capa 2** — las dos condiciones, no una:
1. **30.000 cabezas bajo gestión activa** en la plataforma.
2. **Un exportador que pida el dato primero** (inbound, no outbound).

Antes de eso no hay nada que vender: sin cobertura de cabezas no hay producto, y sin demanda del tercero es una venta institucional de ciclo largo que no soporta la estructura actual.

### Qué significa "verificado" (mecanismo, no adjetivo)

Ningún tercero paga por un registro que el propio productor carga solo. La cadena que hace verificable el dato:

1. Caravana electrónica **leída por hardware** (bastón BLE), no tipeada.
2. Peso de **balanza**, no tipeado.
3. **Timestamp y geolocalización** de la captura.
4. **Cruce contra la declaración a SENASA** ya realizada desde la app.
5. **Veterinario matriculado como testigo** del evento.

El punto 5 es donde el vet socio vale más que como vendedor. Los puntos 3 y 5 **no están implementados**; son prerequisito de la capa 2, no de la capa 1.

### Conflicto de interés a resolver antes

Monetizar el dato hacia arriba puede frenar la adopción hacia abajo: el banco o el certificador quieren ver mortandad, sanidad y stock real; el productor argentino no necesariamente quiere que eso sea visible. Cualquier flujo hacia un tercero tiene que ser **opt-in explícito por campo y por dataset**, con consentimiento registrado, o se pierde la manga.

## Adyacencias diferidas (2028, no antes)

Warrant ganadero, crédito, seguro ganadero, créditos de carbono, marketplace de comercialización. Todas requieren ser entidad regulada o tener un acuerdo de distribución firmado, y ninguna es ejecutable con la estructura actual. Se registran acá para que no se re-discutan cada seis meses, no como plan.

## Gobierno: estándar, nunca cliente

SENASA no es cliente. Ciclo de licitación de ~18 meses, sin equipo comercial, y con un organismo que además está reescribiendo su propio sistema (Res. 117/2026 oficializó TRAZA el 23/7/2026).

El rol del gobierno en el modelo es **definir el formato al que nos integramos**. El export a SIGSA/TRAZA no es un moat — es una brecha que el Estado tiene mandato de cerrar. Lo defendible es la **capa de captura en la manga** (BLE, offline, wizard de una decisión por pantalla), que SENASA no va a construir nunca.

## Canal y expansión

**No hay publicidad en redes como canal de adquisición.** El TAM son ~130.000 entidades, el que firma tiene 55+ y decide por el consignatario y por el veterinario. Un distribuidor de caravanas firmado vale más que todo un presupuesto de pauta. La pauta se reevalúa recién si aparece un producto self-serve con alta autoservicio y las tiendas publicadas.

Orden de expansión:
1. **Cuenca del Salado** vía la red de Facundo, hasta agotar el canal.
2. **Colegios de veterinarios, agroveterinarias, consignatarias, grupos CREA** — canal, no impresiones.
3. **Un distribuidor de caravanas firmado.** El que vende el botón sabe exactamente quién tiene 10 días hábiles para declarar. Ese es el vector nacional, no un mapa de 23 provincias.

## Fast-follower a vigilar

**No es SENASA: es Control Ganadero.** Tiene base instalada, distribución armada y confianza del rubro. Puede agregar un botón de export a SIGSA en semanas. Lo que no puede copiar rápido es la captura BLE offline y el modelo de datos individual.

## Anti-fraude

Con pricing por cabeza, el incentivo cambia: ya no es abrir una sola cuenta para varios campos (eso ahorra solo la base), sino **subdeclarar cabezas**. Mecanismos:

- Validación opcional con CUIT y RENSPA al crear campo.
- Cruce entre cabezas facturadas y cabezas efectivamente cargadas en la base.
- Cruce contra declaraciones a SENASA emitidas desde la app.
- Análisis de patrones (rodeos heterogéneos, geolocalización, saltos de padrón).
- Auditoría manual en casos sospechosos.

El tope de USD 3.500 reduce el incentivo a fragmentar en el segmento grande.

## Criterio de validación (lo único que cierra este documento)

Este modelo **no está validado**. Se valida así:

- **Test de precio**: el precio es correcto cuando lo rechazan **3 de cada 10** prospectos. Hoy el ratio es 0 de 0.
- **Primer hito**: una transferencia recibida de un productor **sin vínculo personal** con Raf o Facundo.
- **Hito de capa 1**: 10 campos pagando.
- **Hito de capa 2**: 30.000 cabezas activas + un exportador que pida el dato.

Hasta el primer hito, todo lo de arriba es hipótesis.

## Lo que se prepara en el código

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

Con pricing por cabeza, `plan_limits` necesita además el **snapshot de cabezas facturadas** y la fecha de corte del conteo. Middleware de límites stub en MVP.

**No implementar billing hasta 20 clientes.** Alias de MercadoPago, factura manual y una planilla aguantan hasta ahí, y el tiempo de desarrollo rinde más en producto.

Ver `docs/adr/ADR-009-billing-deferred.md`.

## Lanzamiento

Beta gratuita para el campo beta de Chascomús y los campos que sume Facundo, **comunicando desde el día 1 que el producto es pago**. La beta gratuita de 6-12 meses del modelo anterior queda acotada: se cobra apenas haya con qué, porque el dato que falta no es "¿lo usan?" sino "¿lo pagan?".
