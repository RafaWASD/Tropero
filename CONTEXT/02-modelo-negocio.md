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

**No vendemos gestión ganadera. Vendemos la declaración de dispositivos a SIGSA sin trámite manual, con lectura BLE.**

Es la diferencia entre competir contra Control Ganadero (USD 129,99/año, instalado hace años, con la confianza del rubro) y competir contra el trámite manual y la multa. Contra software somos caros; contra el trámite somos baratos.

El valor de gestión (KPIs, historia individual, comparativas) es lo que retiene, no lo que vende.

### Límite del claim — no decir "cumplí la 841 con miTropero"

Verificado el 1/8/2026: la Res. 841/2025 tiene **tres** obligaciones operativas. miTropero cubre una — pero **no las tres caen sobre nuestro cliente**, y eso cambia la severidad:

| Obligación | Quién la carga | ¿miTropero? |
|---|---|---|
| Declarar dispositivos en 10 días hábiles (Art. 8°) | El que aplica la caravana — **nuestro ICP** | **Sí** (feature 08) |
| **TRI** al emitir el DT-e | El RENSPA de origen — **nuestro ICP** | **No** — es la pata que falta |
| Declarar el 100% de dispositivos al **cerrar** el DT-e | El **destino**: comprador, invernador, feedlot, feria | **No** — y no es nuestro cliente |

El riesgo propio del criador es que *"el movimiento de terneros sin identificación electrónica podrá generar restricciones para el RENSPA remisor"*, y eso **se previene declarando los dispositivos** — o sea con lo que 08 ya hace. El bloqueo de CUIG por cierre de DT-e lo sufre el comprador.

Aun así el claim completo no se sostiene, por la TRI. Y hay una discrepancia sin resolver: el manual oficial de SENASA (dic-2025) dice que la TRI *"no es obligatoria"*; la prensa del memorándum de julio dice que el sistema la exige. El texto del memorándum no está publicado.

**Frase vendible:** *"te generamos el archivo de declaración de dispositivos para SIGSA"*. **Frase prohibida:** *"cumplí la 841 con miTropero"*.

La TRI es un delta barato (un TXT de RFIDs separados por espacio) y cerraría la pata de emisión. Decisión de scope abierta — ver `specs/active/08-export-sigsa/research-findings.md` §9.

### Pista a perseguir: puede haber API

El manual de token de SENASA dice que el mecanismo permite que *"otras aplicaciones externas"* interactúen con el sistema oficial, con permisos de *"gestionar microchips de identificación y consulta de movimientos"*. Si esa API existe y es accesible, la feature deja de ser "generar archivo + upload manual" y pasa a ser **declarar desde la app** — un producto bastante mejor y un moat más profundo. La especificación no es pública. Preguntar a `hacelafacil@senasa.gob.ar`. Ver §9.7.

## Capa 1 — SaaS al productor (mes 0-18)

### Pricing

> # ⚠️ ESTOS NÚMEROS NO ESTÁN APROBADOS
>
> **Marcado el 13/08/2026.** Rafael confirmó que **este modelo de precios lo generó un agente en una
> sesión anterior sin consultarlo**. Nunca fue una decisión suya. Estaba escrito acá —en CONTEXT, que
> está por encima de las specs en la jerarquía de verdad del repo— con formato de decisión cerrada, y
> **se citó como doctrina al menos una vez** antes de que se detectara.
>
> **Separá los datos de la conclusión.** La distribución del rodeo de más abajo **sí tiene fuente real
> y verificable** (MAGyP, Anexo II, datos SIGSA/SENASA al 31/12/2023) y es lo más valioso de este
> archivo. Lo que nadie aprobó es el precio que se apoyó encima de esos datos.
>
> **La dirección que Rafael quiere** (13/08/2026, todavía sin cerrar): estrategia de precio bajo para
> ganar mercado. Dos o tres planes, el más caro **USD 9,90/mes** como techo, intermedios cerca de USD 5.
> Prueba gratuita de **3 meses**. Decisiones abiertas: el eje que separa los planes (por cabezas o por
> funcionalidad), si sobrevive el "gratis hasta 50", y el descuento de la modalidad anual.
>
> **Hasta que se cierre, no tomar los números de abajo como vigentes.**

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
- El componente por cabeza captura la cola. **El valor está mucho más concentrado de lo que creíamos** y el pricing plano lo regalaba entero — ver la distribución real abajo.
- El tope existe para no volverse impagable en campos de 5.000+ y para no invitar a la fragmentación de establecimientos (ver anti-fraude). **Está en revisión**: con la distribución a la vista, deja ~44% sin cobrar en el estrato de más de 4.000 cabezas.

### La distribución real del rodeo (corrige un dato que veníamos usando mal)

Fuente: MAGyP / Dirección Nacional de Producción Animal, *Caracterización de la producción de carne bovina por provincia*, año 2023, Anexo II — datos SIGSA/SENASA al 31/12/2023. **Unidad de conteo: CUIT (productor), no RENSPA.**

> ⚠️ **Corrección**: veníamos citando *"el 70% de las unidades tiene <500 cabezas y agrupa el 36% del rodeo"*. El 36% da exacto; **el 70% está mal — es 90,6%**.

| Estrato | Productores | % | Cabezas | % | Peso de cría (vacas/total) |
|---|---:|---:|---:|---:|---:|
| hasta 20 | 65.283 | 27,0% | 697.533 | 1,3% | 49,4% |
| 21–100 | 93.663 | 38,7% | 4.623.394 | 8,8% | 49,9% |
| 101–250 | 39.666 | 16,4% | 6.351.525 | 12,0% | 48,0% |
| 251–500 | 20.772 | 8,6% | 7.325.946 | 13,9% | 45,5% |
| 501–750 | 8.238 | 3,4% | 5.034.790 | 9,5% | 43,6% |
| 751–1.000 | 4.333 | 1,8% | 3.752.347 | 7,1% | 42,1% |
| 1.001–2.000 | 6.259 | 2,6% | 8.614.669 | 16,3% | 40,2% |
| 2.001–4.000 | 2.568 | 1,1% | 6.988.784 | 13,2% | 38,5% |
| más de 4.000 | 1.264 | 0,5% | 9.394.904 | 17,8% | 36,6% |
| **Total** | **242.046** | 100% | **52.783.892** | 100% | 42,4% |

**Lo que se lee de acá:**

- **El mercado direccionable son ~79.000 campos, no 242.046.** La banda **101–2.000 cabezas** es el 32,8% de los productores, el **58,9% de la hacienda** y el **82% del techo de facturación** (USD 48,6 M de 59,4 M totales con la tarifa actual). Ese es el ICP, y es un universo que un canal de veterinarios puede recorrer de verdad.
- **El tier gratuito hasta 50 cabezas sale barato**: los dos estratos de abajo son el **65,7% de los productores** y solo el **10,1% de la hacienda**. Regalamos dos tercios del padrón como superficie de adquisición a cambio de una décima parte del mercado real.
- **La cría tira hacia abajo en la banda**: el peso de vacas cae parejo con el tamaño (49% en los chicos, 37% arriba de 4.000). Los campos grandes son más de ciclo completo e invernada. Con el MVP limitado a cría entramos mejor en la mitad baja de la banda, así que **el ARPU real va a estar por debajo de la tabla de precios**.
- **Limitar el MVP a cría casi no achica el mercado**: por sistema de producción (esta vista sí va por RENSPA — 291.687 UP), cría es el **64% de las unidades y el 55% del stock**.

**Caveat de unidad**: la estratificación cuenta por CUIT, y nosotros cobramos **por campo**. Hay 291.687 UP contra 242.046 productores (1,21 RENSPA por productor), y esa vista no está estratificada por tamaño en ninguna fuente pública. O sea que el techo está **subestimado**, no inflado.

Gráfico y método completo: `docs/marketing/` → artifact "El rodeo argentino por tamaño de campo".

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

SENASA no es cliente. Ciclo de licitación de ~18 meses y sin equipo comercial para sostenerlo.

El rol del gobierno en el modelo es **definir el formato al que nos integramos**. El export a SIGSA no es un moat — es una brecha que el Estado puede cerrar cuando quiera (SIGBIOTRAZA, la app oficial, ya declara dispositivos; lo único que no hace es generar el archivo). Lo defendible es la **capa de captura en la manga** (BLE, offline, wizard de una decisión por pantalla), que SENASA no va a construir nunca.

**Nota sobre TRAZA** (verificado 1/8/2026, contra una alarma falsa): la Res. 117/2026 es de la **Secretaría de Agricultura**, no de SENASA, y crea una herramienta **optativa y de consulta** que **no reemplaza a SIGSA ni deroga nada**. No hay migración ni riesgo de que el formato del export caduque. El manual de SIGSA no se modificó desde enero de 2026.

## Canal y expansión

**No hay publicidad en redes como canal de adquisición.** El universo direccionable son **~79.000 campos** (la banda 101–2.000 cabezas), no 242.046 productores ni las "130.000 explotaciones" del censo 2018 que citábamos antes. El que firma tiene 55+ y decide por el consignatario y por el veterinario. Un distribuidor de caravanas firmado vale más que todo un presupuesto de pauta. La pauta se reevalúa recién si aparece un producto self-serve con alta autoservicio y las tiendas publicadas.

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
