# Cuestionario de intake — respuestas

> App de gestión ganadera (cría bovina, Argentina). Respondido el **31/07/2026**.
> Las respuestas salen del estado real del proyecto, no de la intención. Donde no hay dato, dice "no lo sé".
> 🔴 = las que vos marcaste como críticas.

---

## Antes de leer nada: cuatro hechos duros

Para que no armes un plan sobre una base que no existe.

1. **La app no está en Play Store ni en App Store.** No hay de dónde bajarla. Hoy se instala a mano.
2. **No hay nombre definitivo, ni dominio, ni web, ni Instagram, ni cuenta de anuncios.** El rebranding está arrancando y bloquea el resto (el link de invitación que manda la app hoy apunta a un dominio que no existe).
3. **No hay un solo usuario productor.** La usamos dos personas: yo y Facundo, el veterinario socio.
4. **Nunca facturó un peso y nunca gastó un peso en publicidad.**

Lo que sí hay es **producto construido y andando**: dos meses y medio de desarrollo intensivo, el backend completo, la carga en la manga funcionando, y desde el 30 de julio la app **lee caravanas electrónicas de un bastón Allflex real en un Android real**.

---

# Bloque 1 — Los siete que definen todo

### 1. 🔴 Qué es exactamente y a qué precio

**Qué es:** una app móvil (SaaS por suscripción) para manejar un rodeo de cría bovina desde el celular: se carga en la manga, con o sin señal, y convierte esa carga en historia por animal, indicadores y cumplimiento con SENASA.

**Cobro:** abono mensual. **Por campo**, no por cabeza — sin límite de animales ni de usuarios invitados.

| Plan | Quién paga | Precio (provisorio) |
|---|---|---|
| **Productor** | El dueño del campo | **USD 20 / mes por campo** |
| **Vet Base** | El veterinario | **USD 5 / mes** |
| **Vet Pro** | El veterinario | **USD 20 / mes** |

**Los tres números son provisorios**, están escritos así en la documentación del proyecto y se validan durante la beta. Nadie los pagó todavía.

La lógica de los dos planes de veterinario: el vet es el canal de venta, no un cliente más. El Base le deja trabajar en la manga en campos ajenos; el Pro le da campos propios, vista de todos sus clientes juntos y comparación entre campos. Esa comparación es algo que ninguna competencia puede ofrecer, porque nadie más tiene los datos agregados.

**Cobro fuera de las tiendas** (link de pago propio, MercadoPago/Stripe), justamente para no regalar el 15-30%. Es una suscripción de software profesional, no una compra dentro de la app.

### 2. 🔴 Qué queda limpio por cliente por mes

Sobre USD 20 de un plan Productor:

| Concepto | Costo |
|---|---|
| Servidores por campo (a 50 campos) | ~USD 1,50 |
| Comisión de cobro (MercadoPago, ~7%) | ~USD 1,40 |
| Comisión de tienda | **USD 0** (no se cobra por dentro de la app) |
| **Queda antes de mi tiempo** | **~USD 17** |

La infraestructura hoy cuesta **casi cero** (todo en planes gratuitos, porque no hay volumen). La proyección propia del proyecto es ~USD 75/mes de infraestructura total con 50 campos y ~USD 800/mes con 200+.

**El costo que no está medido es mi tiempo de soporte**, y es el que más pesa: si un campo consume 2 horas mías por mes, USD 17 no cubren nada. Eso recién se puede medir con campos reales encima.

### 3. Cuánto facturás hoy y de dónde salieron esos clientes

**Cero.** No hay clientes. No es que vende y no con publicidad: **todavía no salió a vender.**

### 4. 🔴 ¿Ya pusiste plata en publicidad?

**Nunca. Cero pesos.** No hay cuenta de anuncios, ni página, ni pixel, ni nada previo que analizar.

### 5. 🔴 Cuánto podés poner por mes, 3 meses seguidos

**Hoy: USD 0, a propósito.** Mientras la app no esté en las tiendas y no haya una landing donde caiga el interesado, la pauta es plata tirada — el que hace clic no tiene dónde ir.

**Cuando eso esté resuelto: USD 200-300 por mes, sostenidos**, sin que me duela. Ese es el número real para planificar.

### 6. 🔴 Si entran 50 clientes de golpe, ¿los atendés?

**Sí, con dos condiciones que hoy no están cumplidas:**

- Que el alta sea autoservicio de punta a punta (hoy el alta de un campo nuevo necesita que alguien acompañe, y las invitaciones a otros usuarios están rotas por el tema del dominio).
- Que haya respuestas de soporte armadas y un canal único donde caigan las consultas.

Con eso resuelto, el producto escala solo: es multi-campo desde el día uno, cada campo está aislado del otro y no hay trabajo manual por alta. **Sin eso resuelto, 50 de golpe me rompe la reputación**, así que no generes esa demanda antes de que te confirme que están las dos cosas.

### 7. 🔴 Qué querés lograr y en cuánto tiempo

**10 a 15 campos usándola de verdad, en 3 meses.** No facturación: uso real y sostenido.

Ya sé que es ambicioso y que el ciclo de venta del rubro es de 60 a 90 días. Lo pongo así a propósito. Lo que te pido es que me digas vos qué parte de eso es alcanzable con lo que hay, y qué haría falta para el resto.

Dos cosas que juegan a favor del plazo: la obligación de SENASA ya rige (no hay que esperar a nada) y el canal es un veterinario que ya atiende campos.

---

# Bloque 2 — La app, en mis palabras

### 8. Dos frases en un remate

> "Es una app para manejar el rodeo desde el celular: bastoneás la caravana en la manga y queda cargado el tacto, el peso, la vacuna, todo, sin señal y sin cuaderno.
> Después te dice cómo viene el rodeo con números de verdad, y te arma el archivo para declararle a SENASA las caravanas electrónicas dentro de los 10 días."

### 9. 🔴 Qué hace exactamente

**Funcionando hoy (probado, con tests automáticos):**

- Cuentas y **roles por campo**: dueño, operario, veterinario. Una persona puede estar en varios campos y cambiar de contexto.
- **Alta de animal** tipo "identificá y creá si no existe", con caravana electrónica, caravana visual o apodo.
- **Ficha del animal** con toda su historia en orden cronológico.
- **Eventos reproductivos**: tacto, servicio, parto (con mellizos), aborto, destete, vínculo madre-ternero, cría al pie.
- **Categorías automáticas** de cría (ternero → vaquillona → vaca; novillito, novillo, toro, torito) que se recalculan solas por edad y por evento, con ajuste manual cuando hace falta.
- **Sanidad**: vacunación, tratamientos, marca de "en tratamiento", descarte (CUT).
- **Datos de producción**: pesaje, condición corporal, dientes, circunferencia escrotal.
- **Lotes** (agrupaciones de manejo con nombre libre).
- **MODO MANIOBRAS**: el modo de trabajo de la jornada. Elegís qué maniobras vas a hacer, las guardás como combinación reutilizable, y después es un animal por vez, una decisión por pantalla, con resumen antes de confirmar.
- **Operaciones masivas por rodeo**: vacunar, destetar o castrar a todo un grupo de una, con vista previa y corrección.
- **Importación masiva del padrón** desde Excel, CSV o TXT (incluido el formato de SIGSA).
- **Búsqueda de animal** por caravana o identificador.
- **Baja y egreso** (venta, muerte, transferencia) preservando toda la historia.
- **Transferencia de animales entre campos** llevándose la historia.
- **Reportes**: indicadores del rodeo (% de preñez, % de parición, peso promedio por categoría), curva de concentración de pariciones, alertas y comparación entre períodos.
- **Funciona sin señal**: se carga todo offline en el teléfono y sincroniza solo cuando vuelve la conexión.
- **Login con Google y Apple**, además de email.
- **Registro de auditoría** de quién hizo qué (importa cuando hay peones y veterinarios cargando en el mismo campo).

**Funcionando, recién validado, todavía sin luz verde final:**

- **Lectura de caravana electrónica con bastón Allflex por Bluetooth en Android.** El 30 de julio la app leyó por primera vez una caravana real del bastón físico. Está pasado por un banco de pruebas de 26 escenarios (cortes, reconexión, tramas rotas, lecturas repetidas).

**Construido pero frenado por algo externo:**

- **Exportación a SENASA (SIGSA)** para declarar las identificaciones dentro de los 10 días hábiles. El código está terminado y probado; falta una validación del formato exacto con SIGSA y un despliegue. **Este es el diferencial competitivo.**

**Falta construir:**

- Conexión con la **balanza** (hoy el peso se tipea).
- Importación de **análisis de laboratorio** con vínculo automático por número de tubo.
- Publicación en las **tiendas**.

### 10. La función por la que alguien la bajaría / la que más usan

**Por la que la bajarían:** cumplir con SENASA sin trámite manual. Es obligatorio, tiene plazo, y no depende de que al productor le guste la tecnología.

**La que más usan:** no lo sé, y no te lo voy a inventar. **No hay usuarios todavía.** Mi apuesta es que va a ser la carga en la manga, porque es lo que se hace todos los días; el resto se usa una vez por temporada.

### 11. 🔴 El momento "ah, mirá vos"

**Bastonear una caravana y que aparezca el animal entero.** El tipo pasa el bastón por la oreja de la vaca y en el celular sale ese animal con su historia: cuándo parió, cuánto pesó la última vez, qué vacuna tiene, cómo vino su condición corporal. Sin buscar, sin escribir, sin cuaderno.

El segundo momento es al terminar la jornada: en vez de una planilla para pasar a la noche, ya está todo cargado y el resumen del día hecho.

### 12. Qué no hace y me lo piden seguido

Todavía nadie me pide nada porque no hay usuarios. Lo que **sé** que va a faltar:

- **Invernada, feedlot, tambo y cabaña.** Hoy es solo cría. Invernada es un mercado más grande y es lo primero de la lista.
- **Stock** de pajuelas, medicamentos y alimento.
- **Potreros y mapas.** Se manejan lotes con nombre, no superficie geográfica.
- **Contabilidad.** No va a estar nunca, hay sistemas dedicados.
- **Bastón en iPhone.** Ver la 26.

### 13. Por qué la construí

Tres cosas, en este orden:

1. **Facundo, el veterinario socio, trajo el dolor desde adentro.** Él atiende campos todas las semanas y ve cómo se pierde el dato: se anota en un cuaderno, se pasa a una planilla si hay suerte, y termina en un PDF que el productor mira una vez y archiva.
2. **Vi el campo de cerca y cómo se pierde la información.** No es que falten datos: se generan todos los días y se evaporan.
3. Y arriba de eso, **la regulación de 2026** convirtió un "estaría bueno" en una obligación con fecha.

---

# Bloque 3 — Para quién es y quién paga

### 14. 🔴 Para qué tipo de campo

**Cría bovina, exclusivamente.** La arquitectura está preparada para los demás sistemas pero solo cría está habilitado.

Y **es donde más rinde**, no es una limitación de arranque: la cría es el sistema donde el dato individual vale más (¿esta vaca preñó?, ¿parió?, ¿destetó?, ¿cuánto pesó el ternero?) y donde la decisión de descartar un animal se toma con historia, no con memoria. En feedlot importa más el promedio del corral que el animal.

### 15. 🔴 De qué tamaño de campo

Se piensa en **cabezas**, no en hectáreas.

- **No hay límite técnico de volumen**: la base de datos y la importación masiva están hechas para el padrón entero de un campo.
- La franja donde tiene más sentido es **200 a 3.000 cabezas**: abajo de eso el cuaderno todavía alcanza y arriba suele haber sistemas y personal dedicado.
- **Advertencia honesta: nunca se probó con un rodeo real grande.** El campo de prueba interno tiene 350 cabezas y ~2.000 eventos, y eso es data cargada por mí, no de un campo real trabajando.

### 16. 🔴 Quién la usa físicamente

- **El capataz o el peón** en la manga, todos los días. Es el usuario del que depende que esto funcione: por eso los botones son enormes, hay una sola decisión por pantalla y se puede usar con una mano.
- **El veterinario**, en las jornadas de tacto y sanidad.
- **El dueño**, desde la casa o la camioneta, para mirar números.

### 17. 🔴 Quién decide y firma

**El dueño del campo.** Pero casi nunca es él quien lo descubre: **el que lo trae es el veterinario**. Por eso la estrategia comercial entera cuelga del vet, no del productor.

### 18. Edad y manejo del celular

Esto es **hipótesis mía, no dato medido** — es de lo primero que hay que validar con Facundo:

- El **operario** de manga: mucho rango de edad, celular Android de gama baja, usa WhatsApp con soltura y poco más. Hay que llevarlo de la mano la primera jornada; después es repetición.
- El **veterinario**: 25-45, se maneja solo sin problema.
- El **dueño**: cualquier edad, y ahí sí puede haber alguien que directamente no la abra nunca y mire lo que le muestra el vet.

Argentina es mayoritariamente Android, y eso es una suerte, porque el bastón funciona en Android y no en iPhone.

### 19. Solo Argentina o la región

**Solo Argentina, por ahora.** El diferencial es la exportación a SIGSA y la resolución de SENASA: es argentino y no viaja. En Uruguay la trazabilidad individual es obligatoria hace años (con su propio sistema, el SNIG): mercado maduro, pero habría que construir un integrador nuevo y competir contra gente instalada.

---

# Bloque 4 — El problema y la plata que mueve

### 20. 🔴 Qué hace hoy el que no la tiene

Tres cosas mezcladas, en general las tres a la vez:

- **Cuaderno en la manga** y planilla de Excel después, si alguien la pasa.
- **La memoria**: "esa vaca vino fallada el año pasado" y nadie lo puede verificar.
- **Control Ganadero**, que es el sistema dominante en Argentina: le entrega **informes en PDF**, sin identificación individual del animal, sin comparación histórica. Papeles que se miran y se archivan.

### 21. 🔴 Qué le está costando eso

Te doy lo que es verificable y lo que es hipótesis, separado, porque acá es donde uno se tienta y miente.

**Verificable y con fecha:**
- Desde el **1/1/2026** es obligatorio identificar electrónicamente a los terneros al destete, y **declarar cada identificación ante SENASA dentro de los 10 días hábiles** (Res. SENASA 841/2025). Es una obligación con plazo corto y repetida en el tiempo. El que no tiene sistema, lo hace a mano.

**Hipótesis a cuantificar con Facundo (no la uses como número hasta que él la firme):**
- La vaca que queda vacía dos años seguidos y sigue comiendo, porque nadie cruzó los tactos.
- La vaquillona que va a servicio sin llegar al peso mínimo, y no preña.
- El ternero que se destetó tarde o temprano de más.

**Esto es lo primero que te va a hacer falta para escribir un anuncio y todavía no lo tenemos.** Facundo tiene los casos y los números del rubro; hay que sentarse y sacarlos.

### 22. Caso real de alguien que ganó o dejó de perder plata

**No hay ninguno.** Cero usuarios, cero casos.

### 23. La excusa más común del que la ve y no la usa

**No la sé todavía** — no hubo suficiente gente que la viera. Lo que **espero** escuchar: "el peón no lo va a usar", "yo con el cuaderno me arreglo", "¿y si se queda sin batería?", y sobre todo "esto ya lo hago con Control Ganadero".

---

# Bloque 5 — Cómo funciona de verdad, en el corral

### 24. 🔴 ¿Se conecta a la balanza?

**Hoy no: el peso se tipea a mano**, con un teclado enorme pensado para la manga.

La conexión está diseñada y a medio construir: el equipo del campo de prueba es una **Vesta 3516**, que saca los datos por cable serie. Se armó un puente electrónico (un ESP32) que toma esa salida y la manda al celular por Bluetooth. El puente funciona; **falta probarlo con la balanza pesando un animal de verdad**.

### 25. Si se conecta: a qué balanzas y cómo

- **Vesta 3516** por cable serie + puente Bluetooth. Probado en banco, no en campo.
- El módulo está hecho **enchufable**: una balanza con Bluetooth propio se suma sin rehacer nada.
- El puente **no es un producto que se venda**: es una solución para el equipo viejo del campo de prueba. No vamos a fabricar hardware.

### 26. 🔴 ¿Lee caravana electrónica o RFID?

**Sí, y funciona.** Bastón **Allflex RS420** por Bluetooth, en **Android**. El 30 de julio leyó su primera caravana real. Lee el estándar de la caravana oficial argentina (ISO 11784/11785, 15 dígitos), tanto las oficiales como las de fabricante.

Tres cosas que tenés que saber, porque son estructurales:

- **En iPhone no funciona, y no es culpa nuestra.** Los bastones del mercado no usan Bluetooth "abierto": usan un protocolo cerrado que en iPhone exige una **autorización del fabricante** (Apple lo llama MFi). Allflex la da de rutina — hay tres competidores internacionales que la tienen — pero hay que pedirla. Facundo tiene ese pedido redactado. **Es un problema de negocio, no de código.**
- **La app está hecha agnóstica de marca**: hay un registro de bastones y cada uno entra como un adaptador. No estamos casados con Allflex.
- **Siempre se puede cargar a mano.** La app nunca se bloquea porque falte el bastón; si se cae, la carga manual está a un toque.

### 27. 🔴 ¿Anda sin señal?

**Sí. Es el principio de diseño número uno del producto**, no un agregado.

Todo se guarda en el teléfono (base de datos local) y sincroniza solo cuando vuelve la conexión, incluida la reconexión automática al recuperar señal o al volver a abrir la app. Está verificado con pruebas automáticas de apagar la red en medio de una carga.

### 28. 🔴 ¿Saca algo hacia SENASA?

**Sí, y es el diferencial más fuerte que tenemos:** exportación en el formato **SIGSA/SIGBIOTRAZA** para declarar las identificaciones electrónicas dentro de los 10 días hábiles.

**Estado:** el código está terminado y probado (72 pruebas automáticas en verde). Está frenado por dos cosas que no dependen de programar: validar el formato exacto del archivo con SIGSA (lo gestiona Facundo) y un despliegue mío. **Le evita al productor un trámite obligatorio y repetido**, que es exactamente la clase de cosa por la que se paga un abono.

### 29. ¿La usaste vos en la manga?

**No como se debe, y prefiero decirlo derecho.** Hubo un día de campo el 30 de mayo con el bastón y la balanza conectados, pero fue para capturar cómo hablan los equipos, no para cargar una jornada.

**La app nunca cargó una jornada real de manga.** Es el próximo hito y es el que más miedo me da: es donde estos productos se mueren.

Lo que sí está resuelto por diseño: botones de 80-88 píxeles (se tocan con guante), una decisión por pantalla, alto contraste medido para el sol, vibración al confirmar, y todo se guarda a medida que avanzás — si se apaga el teléfono no se pierde lo cargado.

### 30. Android, iPhone, web

- **Android:** sí, funcionando, instalada en un teléfono real. Es la plataforma completa (única con bastón).
- **iPhone:** la app corre, pero **sin bastón** (ver la 26).
- **Web:** existe, pero como entorno de desarrollo y pruebas. **No es producto**, y hay una decisión explícita de que no va a haber app web completa: esto es móvil.
- **Escritorio:** no, y no está planeado.

### 31. ¿Exporta a Excel o PDF? ¿Manda algo por WhatsApp?

- **Importa** desde Excel, CSV y TXT (el padrón entero del campo).
- **Exporta** el archivo para SENASA, y ese archivo se puede compartir desde el teléfono (WhatsApp incluido).
- **Reportes en PDF: no.** Está explícitamente afuera de esta etapa. Los indicadores se ven en la app.

### 32. ¿Pueden cargar varias personas del mismo campo a la vez?

**Sí.** Multi-usuario con roles por campo desde el día uno, y como cada uno carga en su teléfono aunque no haya señal, dos personas pueden trabajar en paralelo y todo se junta después.

**Pero hoy está roto el paso de invitar:** el link que manda la app apunta a un dominio que no existe, y encima la app no está en las tiendas, así que el invitado no tendría de dónde bajarla. **Se arregla entero con el rebranding** (nombre → dominio → tiendas). Es una de las razones por las que el rebranding es el camino crítico y no un tema estético.

### 33. Dónde quedan los datos y qué pasa si se rompe el celular

Los datos viven en **la nube** (base Postgres administrada), con una **copia local en cada teléfono** para poder trabajar sin señal.

Si se rompe el celular: **no se pierde nada** de lo que ya sincronizó. Se pierde solo lo que quedó cargado offline y nunca llegó a subir. Cada campo está aislado de los demás a nivel base de datos, con reglas que se testean automáticamente.

---

# Bloque 6 — Dónde está parada hoy

### 34. 🔴 ¿Está terminada?

**No.** Está en un punto donde el núcleo funciona y falta la periferia.

| Falta | Cuánto |
|---|---|
| Conexión con la balanza | 2-3 semanas, y depende de un día de campo |
| Importación de análisis de laboratorio | 1-2 semanas |
| Desbloquear la exportación a SENASA | Días de trabajo, semanas de gestión externa |
| **Rebranding**: nombre, dominio, identidad | Depende de mí, es lo que bloquea el resto |
| Publicación en tiendas | 2-3 semanas después del nombre |
| Ambiente de producción y monitoreo | 1-2 semanas |

**Para tener beta con productores reales: entre 6 y 10 semanas**, y el cuello de botella ya no es escribir código, es el nombre, las tiendas y los días de campo.

### 35. 🔴 Cuánta gente la usa hoy

**Dos: Facundo y yo.** Facundo tiene una cuenta con un campo de demostración cargado (350 cabezas, dos rodeos, ~2.000 eventos) que se usa para mostrarla.

**Productores reales usándola: cero.**

### 36. 🔴 Cuántos siguen después del primer mes

No aplica. No hubo nadie durante un mes.

### 37. 🔴 Los que la dejaron, ¿por qué?

**Nadie la dejó, porque nadie la empezó.**

Ya sé que es la pregunta que más te importa y que mi respuesta es la peor posible. Te digo dónde creo que va a estar el riesgo, para que sepas qué mirar cuando haya diez campos:

**Que en la manga sea más lenta que el cuaderno.** No que falle: que sea más lenta. El cuaderno no se queda sin batería, no pierde el Bluetooth y no hace preguntas. Si cargar un animal tarda más que anotarlo, el peón vuelve al cuaderno en la segunda jornada y nadie me lo va a decir: simplemente van a dejar de abrirla.

El segundo riesgo es que la use el vet y no el campo, y que cuando el vet no está, no la abre nadie.

### 38. ¿Alguien pagó algo alguna vez?

**No.**

### 39. Qué dijeron los que la probaron

Solo la probamos nosotros dos, y el feedback fue de fallas concretas que se arreglaron: el teclado tapaba los campos, había botones que no respondían al tacto, el bastón se colgaba al reconectar. Todo eso está corregido.

**Feedback de un productor real: ninguno.** Es un agujero grande y lo sé.

### 40. ¿Está en las tiendas? ¿Web, Instagram?

**No a todo.** No hay listado en Play Store ni App Store, no hay dominio, no hay web, no hay Instagram, no hay nada. **Se arranca de cero, y eso es tu terreno.**

### 41. ¿La mantenés solo? ¿Cuánto cuesta tenerla prendida?

La mantengo yo solo, con Facundo aportando el conocimiento del rubro y la red comercial.

**Infraestructura hoy: prácticamente USD 0** (todo en planes gratuitos, no hay volumen que los rompa). Proyectado: ~USD 75/mes a 50 campos.

El gasto real de hoy no es servidor, son **mis herramientas de desarrollo** (el desarrollo corre con un sistema de agentes de IA, que es lo que explica el ritmo). Ese número te lo paso aparte.

---

# Bloque 7 — Contra quién competimos

### 42. 🔴 Qué otras apps o sistemas conozco

- **Control Ganadero** — el dominante en Argentina, opera prácticamente como monopolio. Informes PDF, sin individualización.
- **Identigan** — conceptualmente parecida, presencia en otros países; su alcance real en Argentina no lo tengo claro.
- **Software de las marcas de hardware** — Tru-Test/Datamars (Data Link), Allflex, Gallagher (Animal Performance). Funcionan como jardines cerrados: te sirven si comprás su equipo.
- **Internacionales** que no sé si están en Argentina: AgriWebb (Australia, con inversión fuerte), CattleMax (EE.UU.), Herdwatch (Irlanda), iLivestock.

### 43. Qué cobran

**No lo sé.** Es un dato que no tenemos y que hace falta. Facundo puede averiguar el precio de Control Ganadero preguntando en dos llamadas — es lo que pagan sus propios clientes. Decime si lo querés como tarea de él o lo investigo yo.

### 44. 🔴 Qué hace la mía que las otras no

Sin diplomacia, cuatro cosas:

1. **Trazabilidad individual real.** Control Ganadero te dice cómo viene el rodeo; nosotros te decimos cómo viene **esa** vaca, con toda su historia. Esa es la diferencia entre un informe y una decisión.
2. **El trámite de SENASA resuelto.** El archivo sale de la app.
3. **Agnóstica de hardware.** No te vendemos el bastón ni te atamos a una marca.
4. **Offline de verdad**, hecho desde el primer día y no parchado después.

Y la que no se ve pero es la que más va a doler a la competencia: **con los datos de muchos campos se puede comparar** — "tu cliente está 4% arriba del promedio de la zona". Nadie más tiene esa data junta.

### 45. Qué hacen ellas mejor

**Casi todo lo que no es producto.** Están instaladas hace años, tienen clientes que las conocen, soporte, gente en la calle, y —lo más importante— **funcionan hoy en campos reales**, cosa que la nuestra todavía no. Control Ganadero tiene la confianza del rubro y un nombre que el productor ya escuchó. Nosotros tenemos cero de eso.

Contra un software viejo pero probado, "es más moderno" no alcanza como argumento.

### 46. Las balanzas con software propio, ¿competencia o plataforma?

**Las dos cosas, y la estrategia es no pelearlas.** Su software es el jardín cerrado que le viene con el equipo: cómodo si comprás todo de esa marca, inútil si tenés una balanza de una marca y un bastón de otra, que es lo que pasa en la realidad.

Nosotros no competimos en hardware: nos colgamos de lo que el campo ya tiene. Es un argumento de venta directo — *"no cambies nada de lo que tenés"*.

---

# Bloque 8 — Cómo se vende hoy

### 47. 🔴 Cuánto pasa desde que la ve hasta que paga

**No lo sé, no hubo una sola venta.** Lo que sí sé del rubro: las decisiones se toman en **momentos del calendario** (tacto, destete, servicio), no cuando uno quiere. Si le mostrás la app a un tipo a mitad de temporada, la decisión se le va a los meses siguientes. Contá 60-90 días y planificá contra el calendario ganadero, no contra el mes.

### 48. 🔴 ¿Vendés vos o alguien más?

**Vende Facundo, y es fundamental que lo sepas.** Es veterinario, socio al 50%, y es él quien tiene la relación con los campos y la credibilidad técnica. Yo construyo el producto; no vendo y no tengo la red.

Traducción para tu plan: **la publicidad genera interesados, pero el que cierra es un veterinario con agenda propia y trabajo de campo.** Si le generás 40 interesados en una semana, hay que ver cuántos puede atender de verdad.

### 49. Dónde caen los que preguntan

**Hoy en ningún lado formal**: WhatsApp de Facundo o mío, boca a boca. No hay formulario, ni web, ni casilla. Es de lo primero que hay que armar.

### 50. ¿Hay prueba gratis?

**Sí: beta gratuita de 6 a 12 meses**, diciendo desde el día uno que después va a ser paga. El cobro se activa cuando haya 10+ campos pidiendo entrar.

### 51. A cuántos productores podría llamar mañana

**Entre 5 y 10 productores míos, más los clientes de Facundo** (un veterinario rural atiende entre 10 y 30 campos, y esos son los que importan).

### 52. Veterinarios, agroveterinarias, consignatarias, CREA

**La red es de Facundo**, veterinario recibido en la UNLP, con campos que atiende hoy. Los contactos de agroveterinarias, consignatarias y grupos CREA hay que preguntárselos a él directamente — yo no los tengo.

---

# Bloque 9 — Lo que necesitás para trabajar

| Lo que pediste | Estado |
|---|---|
| **Video usándola en el campo** | ❌ No existe. Se puede grabar recién en la primera jornada real de manga, que es el próximo hito. Puedo grabar mientras tanto un recorrido con el campo de demostración cargado. |
| **Capturas de las pantallas principales** | ✅ **Hay cientos**, generadas automáticamente en cada revisión de diseño. Decime cuáles querés y te armo el set. |
| **Nombre y logo** | ⏳ **El nombre está en definición y es el bloqueo principal.** No hay logo. La paleta y la tipografía actuales van adjuntas en documento aparte. |
| **Teléfono de 2 o 3 que la estén usando** | ❌ No hay usuarios. Los únicos que la usaron somos Facundo y yo. Hablá con Facundo: él no es usuario pero sí es el que conoce a los que van a serlo. |
| **Accesos** (anuncios, Facebook, Instagram, web) | ❌ No existe ninguna de las cinco cosas. Hay que crear todo. |

---

# Y si contestara una sola

**"De los que la probaron y la dejaron: ¿por qué la dejaron?"**

**Nadie la probó y la dejó, porque todavía nadie la probó.** Esa es la respuesta y es incómoda, pero cualquier otra cosa que te dijera sería inventada.

Lo que te puedo ofrecer a cambio: en los próximos dos meses van a entrar los primeros campos reales. **Preguntales vos, no yo.** Yo voy a escuchar lo que quiero escuchar, y a esta altura del proyecto eso es peligroso.

---

## Las tres cosas que decidiría con vos primero

1. **El nombre.** Bloquea el dominio, las tiendas, el logo, la web y las invitaciones dentro de la app. Nada de marketing arranca de verdad antes de esto.
2. **Dónde caen los interesados** el día que exista el primer aviso: WhatsApp de quién, con qué mensaje, y quién contesta.
3. **El número que le cuesta al productor no tener esto**, sentándonos con Facundo. Sin ese número no hay anuncio que funcione, y hoy no lo tenemos.
