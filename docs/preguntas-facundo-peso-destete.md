# Preguntas para Facundo — Peso al destete (#7)

**Para**: reunión Raf + Facundo · **Fecha**: 2026-07-03 · **Tema**: cómo, cuándo y dónde marcar el **peso al destete** en la app.

> **Cómo usar este doc**: cada sección tiene (1) **por qué preguntamos** — el contexto de producto/dato; (2) las **opciones** que estamos evaluando; (3) **lo que necesitamos que Facundo defina**. La idea es que Raf sepa qué preguntar y Facundo sepa qué tiene que responder. Al final hay un resumen de "decisiones mínimas para poder empezar a construir".

---

## 0. Por qué esto importa (el norte)

El **kilo de ternero destetado por vaca** es, en la práctica, el **producto final** de un sistema de cría: no alcanza con que la vaca se preñe y para — lo que se vende/pesa es el ternero al destete. Ese número (y sus componentes: % destete × peso al destete) es **el KPI de fondo** que un dueño mira para saber si el campo anda bien, y el que permite:
- **Seleccionar** vaquillonas de reposición (hijas de las mejores vacas).
- **Descartar** vacas de bajo rendimiento (paren poco o destetan liviano).
- **Comparar** campañas entre sí, y eventualmente toros/pajuelas.
- **Benchmarkear** contra la zona/raza.

Hoy la app ya tiene **% destete** (#10, recién hecho: terneros destetados / vacas servidas). Falta el **peso**. La combinación de los dos es el diferencial analítico de RAFAQ. Por eso vale la pena diseñarlo bien desde el principio, no improvisarlo.

## 1. Estado actual de la app (lo que ya existe)

- **Destete** ya es un evento (`weaning`) que se registra **por ternero**, incluso en **destete masivo** (marcás varios terneros como destetados de una).
- **Peso** ya es un evento (`weight`) que se registra por animal (pesaje individual, con o sin balanza).
- **PERO**: hoy el destete y el peso son **eventos separados**, y el **destete masivo NO pide peso**. No hay un "peso al destete" como dato de campaña ligado al destete.
- Ya tenemos fecha de nacimiento del ternero (cuando se carga) → se **podría** calcular edad al destete y ganancia diaria.

---

## 2. CÓMO se mide/registra el peso al destete

**Por qué preguntamos**: define el modelo de dato y qué análisis se puede hacer después. Un peso **individual** por ternero permite selección y ranking; un **promedio del lote** solo da un número de campaña.

**Opciones / preguntas concretas:**

1. **¿Peso individual por ternero, o promedio del lote?**
   - Individual (recomendado analíticamente): cada ternero su kg → permite ranking, selección de madres, peso ajustado.
   - Promedio: se pesa el lote/jaula y se divide. Más rápido, menos preciso, no permite selección individual.
   - **¿En el campo del socio/beta se pesa ternero por ternero al destete, o "a ojo"/promedio?**

2. **¿El peso al destete se ajusta a una edad estándar?**
   - En genética/cría se suele usar el **peso ajustado a 205 días** (o a otra edad) para comparar terneros nacidos en distintas fechas, con una fórmula que usa peso, edad al pesaje y (a veces) edad de la madre.
   - **¿Facundo quiere que la app calcule un peso ajustado (¿a 205 días? ¿otro?) o alcanza con el peso crudo + la edad al destete?** Si ajustado: **¿qué fórmula exacta usa** (con/sin corrección por edad de la vaca, con/sin sexo)?

3. **¿Un solo peso al destete, o el destete puede tener varios pesajes?**
   - Normalmente es **uno** (el del día del destete). Pero, ¿hay casos de "pre-destete" + "destete" con dos pesos?

4. **¿De dónde sale el peso: balanza (bastón/celda de carga) o carga a mano?**
   - Esto es de UX/hardware, no bloquea el modelo, pero conviene saber si el destete se hace **en la manga con balanza** (el peso entra solo) o **a mano** (el operario lo tipea).

**Lo que necesitamos que Facundo defina**: individual vs promedio · crudo vs ajustado (y la fórmula si es ajustado) · uno vs varios pesos.

---

## 3. CUÁNDO se pide el peso (obligatorio / opcional / nunca)

**Por qué preguntamos**: esto es exactamente lo que Raf marcó — **hoy el destete masivo no lo tiene**, y no queremos forzar un peso donde no corresponde ni omitirlo donde sí. Define la regla de negocio del formulario.

**Opciones / preguntas concretas:**

1. **¿Todo destete lleva peso, o el peso es opcional?**
   - Siempre obligatorio: el destete no se puede cerrar sin peso.
   - Opcional pero incentivado: se puede destetar sin peso (con un aviso de que el %destete "con peso" queda incompleto).
   - **¿Existe un destete legítimo SIN pesaje** (p.ej. destete de emergencia por seca, o un campo que no tiene balanza)? Si sí → el peso tiene que ser opcional.

2. **¿El "destete" y el "peso al destete" son el MISMO evento o dos?**
   - Mismo evento: al marcar destetado, se pide el peso ahí.
   - Dos eventos: primero se pesa (evento peso), después/aparte se marca destetado (evento destete), y la app los liga por fecha.
   - **¿En el campo, el día del destete se pesa y se marca destetado en el mismo momento, o son dos actos separados?**

3. **¿Hay una ventana de fecha? ¿El peso del destete es el peso "más cercano al destete", o exactamente el del día?**
   - P.ej. si pesaron 3 días antes de apartar, ¿ese peso cuenta como "peso al destete"?

**Lo que necesitamos que Facundo defina**: peso obligatorio vs opcional (y si hay destete-sin-peso legítimo) · mismo evento vs dos eventos · tolerancia de fecha.

---

## 4. DÓNDE se marca (en qué flujo de la app)

**Por qué preguntamos**: define en qué pantalla/maniobra vive, y cuánto toca el destete masivo actual.

**Opciones / preguntas concretas:**

1. **¿En el destete masivo, en el individual, o en una maniobra de pesaje aparte?**
   - Dentro del destete masivo: al marcar el lote como destetado, se pide un peso por ternero (más pasos por animal, pero un solo flujo).
   - Maniobra de pesaje que "también deste­ta": pasás los terneros por la manga, se pesan, y el pesaje marca destete.
   - Peso aparte del destete: se destetan y después se hace una maniobra de pesaje.
   - **¿Cómo lo hacen físicamente en el campo — apartan y pesan en el mismo encierre, o son dos trabajos distintos?**

2. **¿El peso al destete se ve en la ficha del ternero, en la de la madre, o en los dos?**
   - Ficha del ternero: su peso al destete + edad + GDP.
   - Ficha de la madre: "sus terneros y cuánto destetaron" (esto es la parte "madre → crías" de #7).
   - **¿Facundo quiere ver, parado en una vaca, cuánto destetaron sus hijos a lo largo de los años?** (es la métrica de "vaca productiva").

**Lo que necesitamos que Facundo defina**: en qué flujo (masivo/pesaje/aparte) · dónde se muestra (ternero/madre/ambos).

---

## 5. Qué ANALÍTICA sale de esto (para no diseñar el dato corto)

**Por qué preguntamos**: si sabemos qué números quiere ver Facundo, modelamos el dato para que se puedan calcular sin rehacer nada.

**Preguntas concretas:**

1. **¿Cuál es LA métrica de fondo?** Candidatas: **kg destetados por vaca servida** (producción de campaña), peso promedio al destete, **peso ajustado a 205 días** promedio, **GDP** (ganancia diaria: (peso destete − peso nacimiento) / días), % destete × peso.
2. **¿Peso al nacer?** El GDP y algunos ajustes necesitan el **peso al nacer**. **¿Se pesa el ternero al nacer en el campo, o casi nunca?** (si no, la app asume un default o no calcula GDP).
3. **¿Benchmark?** ¿Facundo tiene un rango de referencia de peso al destete para la zona/raza (p.ej. "un buen destete en Chascomús para un británico es X kg a Y meses")? Sirve para pintar el número en verde/amarillo/rojo.
4. **¿Comparaciones?** ¿Entre campañas, entre vacas (ranking), por toro/pajuela, por rodeo?

**Lo que necesitamos que Facundo defina**: la métrica prioritaria · si hay peso al nacer · si hay benchmark de referencia · qué comparaciones quiere.

---

## 6. Decisiones MÍNIMAS para poder empezar a construir

Si la reunión se acorta, con esto ya podemos arrancar el diseño técnico de #7:

1. **Peso individual o promedio** (define el modelo de dato). → *lo más importante.*
2. **Obligatorio u opcional** (define si hay destete-sin-peso). → *lo que Raf marcó.*
3. **Mismo evento que el destete, o aparte** (define el flujo).
4. **Crudo o ajustado** (y la fórmula si es ajustado).
5. **La métrica de fondo** que hay que poder mostrar (aunque sea una).

El resto (benchmarks, peso al nacer, comparaciones finas) se puede sumar después sin rehacer el dato, **siempre que 1–4 estén bien**.

---

## 7. Notas técnicas (contexto para Raf, no para preguntar)

- Modelar el peso al destete probablemente sea **una columna `weaning_weight` en el evento de destete** (o ligar el evento `weight` al `weaning` por fecha). La decisión 3 (mismo evento vs dos) define cuál.
- El **peso ajustado a 205 días** es puro cálculo (peso, fecha nacimiento, fecha destete) → si Facundo lo quiere, se computa client-side/RPC sin dato extra, salvo que la fórmula pida **edad de la madre** o **peso al nacer** (ahí sí necesitamos esos datos).
- **Facundo NO bloquea** poder capturar el peso (eso es UX): bloquea las **decisiones de dominio** de arriba (qué es "un buen" peso, qué fórmula de ajuste, qué métrica priorizar). Sin esas, se puede construir la captura pero no la analítica "que no miente".
