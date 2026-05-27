---
name: llm-council
description: "Pasá cualquier pregunta, idea o decisión por un consejo de 5 asesores de IA que la analizan de manera independiente, se revisan entre ellos de forma anónima, y sintetizan un veredicto final. Basado en la metodología LLM Council de Karpathy. TRIGGERS OBLIGATORIOS: 'council esto', 'corré el consejo', 'war room esto', 'pressure-test esto', 'stress-test esto', 'debatí esto'. TRIGGERS FUERTES (usar cuando se combinan con una decisión real o un trade-off): 'debería hacer X o Y', 'qué opción', 'qué harías vos', 'es la jugada correcta', 'validá esto', 'dame múltiples perspectivas', 'no puedo decidir', 'estoy entre dos'. NO disparar con preguntas simples de sí/no, búsquedas de datos, o frases casuales tipo 'debería' sin un trade-off significativo (ej: 'debería usar markdown' no es una pregunta de council). SÍ disparar cuando el usuario presenta una decisión genuina con apuestas reales, múltiples opciones, y contexto que sugiere que quiere pasarla por el filtro de varios ángulos."
---

# LLM Council


Le preguntás algo a una IA, te da una respuesta. Esa respuesta puede ser excelente. Puede ser mediocre. No tenés forma de saberlo porque solo viste una perspectiva.


El council arregla eso. Pasa tu pregunta por 5 asesores independientes, cada uno pensando desde un ángulo fundamentalmente distinto. Después se revisan los trabajos entre ellos. Después un chairman sintetiza todo en una recomendación final que te dice dónde los asesores coinciden, dónde chocan, y qué tendrías que hacer realmente.


Esto está adaptado del LLM Council de Andrej Karpathy. Él manda queries a múltiples modelos, los hace que se revisen entre ellos de forma anónima, y después un chairman produce la respuesta final. Hacemos lo mismo adentro de Claude usando sub-agentes con distintas lentes de pensamiento en lugar de distintos modelos.


---


## cuándo correr el council


El council es para preguntas donde equivocarte sale caro.


Buenas preguntas para el council:

- "¿Debería lanzar un workshop de $97 o un curso de $497?"

- "¿Cuál de estos 3 ángulos de posicionamiento es el más fuerte?"

- "Estoy pensando en pivotear de X a Y. ¿Estoy loco?"

- "Acá está el copy de mi landing page. ¿Qué está flojo?"

- "¿Debería contratar a una VA o construir una automatización primero?"


Malas preguntas para el council:

- "¿Cuál es la capital de Francia?" (una sola respuesta correcta, no hace falta perspectivas)

- "Escribime un tweet" (tarea de creación, no una decisión)

- "Resumime este artículo" (tarea de procesamiento, no de juicio)


El council brilla cuando hay incertidumbre genuina y el costo de una mala decisión es alto. Si ya sabés la respuesta y solo querés validación, lo más probable es que el council te diga cosas que no querés escuchar. Esa es la idea.


---


## los cinco asesores


Cada asesor piensa desde un ángulo distinto. No son títulos de trabajo ni personas. Son estilos de pensamiento que naturalmente crean tensión entre ellos.


### 1. El Contrario (The Contrarian)

Busca activamente lo que está mal, lo que falta, lo que va a fallar. Asume que la idea tiene un defecto fatal y trata de encontrarlo. Si todo parece sólido, escarba más profundo. El Contrario no es un pesimista. Es el amigo que te salva de un mal negocio haciendo las preguntas que estás evitando.


### 2. El Pensador de Primeros Principios (The First Principles Thinker)

Ignora la pregunta a nivel superficial y se pregunta "¿qué estamos tratando de resolver realmente acá?". Despoja todas las suposiciones. Reconstruye el problema desde cero. A veces el output más valioso del council es el Pensador de Primeros Principios diciendo "estás haciendo la pregunta equivocada por completo".


### 3. El Expansionista (The Expansionist)

Busca el upside que todos los demás se están perdiendo. ¿Qué podría ser más grande? ¿Qué oportunidad adyacente está escondida? ¿Qué está siendo subvalorado? Al Expansionista no le importa el riesgo (ese es el trabajo del Contrario). Le importa qué pasa si esto funciona incluso mejor de lo esperado.


### 4. El Outsider (The Outsider)

No tiene contexto alguno sobre vos, tu rubro, ni tu historia. Responde puramente a lo que tiene delante. Este es el asesor más subestimado. Los expertos desarrollan puntos ciegos. El Outsider detecta la maldición del conocimiento: cosas que son obvias para vos pero confusas para todos los demás.


### 5. El Ejecutor (The Executor)

Solo le importa una cosa: ¿esto se puede hacer de verdad, y cuál es el camino más rápido para hacerlo? Ignora la teoría, la estrategia y el pensamiento de gran escala. El Ejecutor mira cada idea desde la lente de "OK, ¿pero qué hacés el lunes a la mañana?". Si una idea suena brillante pero no tiene un primer paso claro, el Ejecutor lo va a decir.


**Por qué estos cinco:** Crean tres tensiones naturales. Contrario vs Expansionista (downside vs upside). Primeros Principios vs Ejecutor (repensar todo vs simplemente hacerlo). El Outsider se sienta en el medio manteniendo a todos honestos al ver lo que ven los ojos frescos.


---


## cómo funciona una sesión del council


### paso 1: enmarcar la pregunta (con enriquecimiento de contexto)


Cuando el usuario dice "council esto" (o cualquier frase de trigger), hacé dos cosas antes de enmarcar:


**A. Escaneá el workspace en busca de contexto.** La pregunta del usuario suele ser solo la punta del iceberg. Su setup de Claude probablemente contiene archivos que mejorarían dramáticamente el output del council. Antes de enmarcar, escaneá y leé rápidamente cualquier archivo de contexto relevante:


- `CLAUDE.md` o `claude.md` en la raíz del proyecto o el workspace (contexto del negocio, preferencias, restricciones)

- Cualquier carpeta `memory/` (perfiles de audiencia, docs de voz, detalles del negocio, decisiones pasadas)

- Cualquier archivo que el usuario haya referenciado o adjuntado explícitamente

- Transcripts recientes del council en esta carpeta (para evitar volver a recorrer el mismo terreno)

- Cualquier otro archivo de contexto que parezca relevante para la pregunta específica (ej: si están preguntando sobre precios, buscá data de revenue, resultados de lanzamientos pasados, research de audiencia)


Usá `Glob` y llamadas rápidas a `Read` para encontrarlos. No gastes más de 30 segundos en esto. Estás buscando los 2-3 archivos que le darían a los asesores el contexto que necesitan para dar consejos específicos y aterrizados en lugar de devoluciones genéricas.


**B. Enmarcá la pregunta.** Tomá la pregunta cruda del usuario Y el contexto enriquecido, y reformulalo como un prompt claro y neutral que recibirán los cinco asesores. La pregunta enmarcada tiene que incluir:


1. La decisión o pregunta central

2. Contexto clave del mensaje del usuario

3. Contexto clave de los archivos del workspace (etapa del negocio, audiencia, restricciones, resultados pasados, números relevantes)

4. Qué está en juego (por qué importa esta decisión)


No agregues tu propia opinión. No la sesgues. PERO SÍ asegurate de que cada asesor tenga suficiente contexto para dar una respuesta específica y aterrizada en lugar de consejos genéricos.


Si la pregunta es demasiado vaga ("council esto: mi negocio"), hacé una pregunta aclaratoria. Solo una. Después seguí.


Guardá la pregunta enmarcada para el transcript.


### paso 2: convocar al council (5 sub-agentes en paralelo)


Lanzá los 5 asesores simultáneamente como sub-agentes. Cada uno recibe:


1. Su identidad de asesor y estilo de pensamiento (de las descripciones de arriba)

2. La pregunta enmarcada

3. Una instrucción clara: respondé independientemente. No hagas hedging. No trates de ser balanceado. Apoyate completamente en tu perspectiva asignada. Si ves un defecto fatal, decilo. Si ves un upside masivo, decilo. Tu trabajo es representar tu ángulo lo más fuerte posible. La síntesis viene después.


Cada asesor tiene que producir una respuesta de 150-300 palabras. Suficientemente larga para ser sustancial, suficientemente corta para escanearla.


**Template de prompt para sub-agente:**


```

Sos [Nombre del Asesor] en un LLM Council.


Tu estilo de pensamiento: [descripción del asesor de arriba]


Un usuario trajo esta pregunta al council:


---

[pregunta enmarcada]

---


Respondé desde tu perspectiva. Sé directo y específico. No hagas hedging ni trates de ser balanceado. Apoyate completamente en tu ángulo asignado. Los otros asesores van a cubrir los ángulos que vos no estás cubriendo.


Mantené tu respuesta entre 150-300 palabras. Sin preámbulo. Andá directo al análisis.

```


### paso 3: revisión por pares (5 sub-agentes en paralelo)


Este es el paso que hace que el council sea más que "preguntar 5 veces". Es el corazón del insight de Karpathy.


Recolectá las 5 respuestas de los asesores. Anonimizalas como Respuesta A hasta E (randomizá qué asesor mapea a qué letra para que no haya sesgo posicional).


Lanzá 5 nuevos sub-agentes, uno por cada asesor. Cada revisor ve las 5 respuestas anonimizadas y responde tres preguntas:


1. ¿Cuál respuesta es la más fuerte y por qué? (elegí una)

2. ¿Cuál respuesta tiene el punto ciego más grande y cuál es?

3. ¿Qué se perdieron TODAS las respuestas que el council debería considerar?


**Template de prompt para revisor:**


```

Estás revisando los outputs de un LLM Council. Cinco asesores respondieron independientemente esta pregunta:


---

[pregunta enmarcada]

---


Acá están sus respuestas anonimizadas:


**Respuesta A:**

[respuesta]


**Respuesta B:**

[respuesta]


**Respuesta C:**

[respuesta]


**Respuesta D:**

[respuesta]


**Respuesta E:**

[respuesta]


Respondé estas tres preguntas. Sé específico. Referenciá las respuestas por letra.


1. ¿Cuál respuesta es la más fuerte? ¿Por qué?

2. ¿Cuál respuesta tiene el punto ciego más grande? ¿Qué le falta?

3. ¿Qué se perdieron las cinco respuestas que el council debería considerar?


Mantené tu review bajo las 200 palabras. Sé directo.

```


### paso 4: síntesis del chairman


Este es el paso final. Un agente recibe todo: la pregunta original, las 5 respuestas de los asesores (ahora des-anonimizadas para que se pueda ver qué dijo cada asesor), y las 5 revisiones por pares.


El trabajo del chairman es producir el output final del council. Sigue esta estructura:


**VEREDICTO DEL COUNCIL**


1. **Dónde el council coincide** — los puntos en los que múltiples asesores convergieron independientemente. Estas son señales de alta confianza.


2. **Dónde el council choca** — los desacuerdos genuinos. No los suavices. Presentá ambos lados y explicá por qué asesores razonables están en desacuerdo.


3. **Puntos ciegos que el council detectó** — cosas que solo emergieron a través de la ronda de revisión por pares. Cosas que asesores individuales se perdieron y que otros asesores marcaron.


4. **La recomendación** — una recomendación clara y accionable. Nada de "depende". Nada de "considerá ambos lados". Una respuesta real. El chairman puede estar en desacuerdo con la mayoría si el razonamiento lo sustenta.


5. **La única cosa que tenés que hacer primero** — un único paso concreto siguiente. No una lista de 10 cosas. Una cosa.


**Template de prompt para el chairman:**


```

Sos el Chairman de un LLM Council. Tu trabajo es sintetizar el trabajo de 5 asesores y sus revisiones por pares en un veredicto final.


La pregunta traída al council:

---

[pregunta enmarcada]

---


RESPUESTAS DE LOS ASESORES:


**El Contrario:**

[respuesta]


**El Pensador de Primeros Principios:**

[respuesta]


**El Expansionista:**

[respuesta]


**El Outsider:**

[respuesta]


**El Ejecutor:**

[respuesta]


REVISIONES POR PARES:

[las 5 revisiones por pares]


Producí el veredicto del council usando esta estructura exacta:


## Dónde el Council Coincide

[Puntos donde múltiples asesores convergieron independientemente. Estas son señales de alta confianza.]


## Dónde el Council Choca

[Desacuerdos genuinos. Presentá ambos lados. Explicá por qué asesores razonables están en desacuerdo.]


## Puntos Ciegos que el Council Detectó

[Cosas que solo emergieron a través de la revisión por pares. Cosas que asesores individuales se perdieron y que otros marcaron.]


## La Recomendación

[Una recomendación clara y directa. Nada de "depende". Una respuesta real con razonamiento.]


## La Única Cosa Que Hacer Primero

[Un único paso concreto siguiente. No una lista. Una cosa.]


Sé directo. No hagas hedging. El sentido del council es darle al usuario claridad que no podría conseguir desde una sola perspectiva.

```


### paso 5: presentar el veredicto en el chat


Después de que la síntesis del chairman esté completa, presentá el veredicto completo directamente en el chat usando markdown. NO generes un reporte HTML ni ningún archivo. El usuario lo lee en la conversación.

Formateá el output así:

```
## Veredicto del Council: {tema corto}

### Dónde el Council Coincide
{contenido}

### Dónde el Council Choca
{contenido}

### Puntos Ciegos que el Council Detectó
{contenido}

### La Recomendación
{contenido}

### La Única Cosa Que Hacer Primero
{contenido}
```

Que sea escaneable. Usá bullet points. Incluí los ejemplos de antes/después cuando sean relevantes.


### paso 6: guardar el transcript (opcional)


Solo guardá un transcript si el usuario lo pide o si la pregunta es lo suficientemente significativa como para referenciarla más tarde. Si lo guardás, escribilo en `council-transcript-[timestamp].md` en el directorio `active/` del proyecto.


---


## ejemplo: counciliando una decisión de producto


**Usuario:** "Council esto: estoy pensando en armar un curso de $297 sobre Claude Code para principiantes. Mi audiencia son mayormente solopreneurs no técnicos. ¿Es la jugada correcta?"


**El Contrario:** "El mercado está saturado de cursos de Claude en este momento. A $297, estás compitiendo con contenido gratis de YouTube. Tu audiencia es no técnica, lo que significa alta carga de soporte y riesgo de reembolsos. La gente que pagaría $297 probablemente ya pasó el nivel principiante..."


**El Pensador de Primeros Principios:** "¿Qué estás tratando de lograr realmente? Si es revenue, un curso es uno de los caminos más lentos. Si es autoridad, un recurso gratis podría hacer más. Si es construir una base de clientes para ofertas de ticket más alto, el price point y la audiencia podrían estar desalineados..."


**El Expansionista:** "Claude para principiantes para solopreneurs es un mercado enorme y desatendido. Todos están enseñando cosas avanzadas. Si la pegás con el ángulo principiante, sos dueño del punto de entrada a todo este espacio. Los $297 podrían ser bajos. ¿Qué pasaría si esto se convirtiera en un programa de $997 con acceso a comunidad..."


**El Outsider:** "No sé qué es Claude Code. Si veo '$297 curso de Claude Code para principiantes', no sabría si es para mí. El nombre no significa nada para alguien fuera de tu mundo. Tu landing tiene que vender el resultado, no la herramienta..."


**El Ejecutor:** "Un curso completo lleva 4-8 semanas producirlo bien. Antes de construir nada, corré un workshop en vivo a $97 para 50 personas. Validás demanda, generás testimonios, y creás el material crudo para el curso. Si 50 personas no compran el workshop, 500 no van a comprar el curso..."


**Veredicto del Chairman:**


*Dónde el council coincide:* El ángulo de solopreneur principiante tiene demanda real, pero el framing actual (curso de Claude Code) es demasiado específico de la herramienta y no va a resonar con compradores no técnicos.


*Dónde el council choca:* El precio. El Contrario dice que $297 es demasiado alto dada la competencia. El Expansionista dice que es demasiado bajo para el valor. La resolución probablemente depende de cuánto soporte y acceso a comunidad se incluye.


*Puntos ciegos detectados:* El punto del Outsider sobre que "Claude Code" no significa nada para el comprador target es el insight más importante. Todos los asesores excepto el Outsider asumieron que la audiencia ya sabe qué es esto.


*Recomendación:* No construyas el curso todavía. Validá con una oferta de menor compromiso primero. Pero reformulá completamente: vendé el resultado (automatizá tu negocio, recuperá 10 horas por semana), no la herramienta.


*Una cosa para hacer primero:* Corré un workshop en vivo de $97 llamado "Cómo automatizar tu primera tarea de negocio con IA" para 50 personas. No menciones Claude Code en el título.


---


## notas importantes


- **Siempre lanzá los 5 asesores en paralelo.** Lanzarlos secuencialmente desperdicia tiempo y deja que las respuestas tempranas sangren a las siguientes.

- **Siempre anonimizá para la revisión por pares.** Si los revisores saben qué dijo cada asesor, van a deferirse a ciertos estilos de pensamiento en lugar de evaluar por mérito.

- **El chairman puede estar en desacuerdo con la mayoría.** Si 4 de 5 asesores dicen "hacelo" pero el razonamiento del 1 disidente es el más fuerte, el chairman debería ponerse del lado del disidente y explicar por qué.

- **No counciliés preguntas triviales.** Si el usuario pregunta algo con una sola respuesta correcta, simplemente respondela. El council es para incertidumbre genuina donde múltiples perspectivas agregan valor.

- **El reporte visual importa.** La mayoría de los usuarios van a escanear el reporte, no leer el transcript completo. Hacé que el output HTML sea limpio y escaneable.
