# ADR-016 — Terminología: rodeo (grupo de animales) y sistema (tipo productivo)

**Status**: Accepted
**Fecha**: 2026-05-26
**Decisores**: Raf, con validación del vet socio (Facundo, UNLP)

## Contexto

En sesiones tempranas del proyecto se usaron varios términos intercambiablemente para referirse al **grupo de animales gestionado como unidad** dentro de un establecimiento, y a su **categoría productiva** (cría, invernada, etc.). El vocabulario no estaba cerrado y aparecía mezclado en specs, copy de UI tentativo y conversaciones.

El 2026-05-26, durante el discovery de la feature BUSCAR ANIMAL, Raf propuso como hipótesis inicial: **lote = grupo de animales**, **rodeo = tipo de sistema productivo** (de modo que el usuario diría "tengo 3 lotes de tipo rodeo cría"). El leader cuestionó la propuesta basándose en el uso real del lenguaje en el campo argentino, donde el productor habla naturalmente de "el rodeo de cría" o "el rodeo de vaquillonas" para referirse al grupo concreto.

Raf consultó en el momento con el vet socio (Facundo, UNLP) y validó:
- **Rodeo** es la palabra natural para referirse al grupo de animales agrupado y gestionado dentro del campo. El productor dice "tengo 3 rodeos de cría".
- **Lote** casi no se usa en este contexto. Cuando aparece, suele referirse a una **unidad de terreno** o agrupación logística circunstancial, no al grupo permanente de animales.
- **Sistema** es el término profesional para la categoría productiva: "sistema de cría", "sistema de tambo", "sistema de feedlot". Es palabra natural tanto para el productor como para el vet.

Cerrar esta terminología en un ADR ahora evita propagación de inconsistencias a las specs que vienen (02 modelo de animal, 09 BUSCAR ANIMAL, 03 MODO MANIOBRAS), al copy de UI, a los nombres de tablas/columnas en DB, y a la documentación.

## Decisión

**El vocabulario oficial del proyecto RAFAQ es**:

- **Rodeo** — Entidad concreta. El grupo de animales agrupado y gestionado como unidad productiva dentro de un establecimiento. Es el sustantivo principal de la app cuando se habla de agrupaciones de animales. Un establecimiento puede tener N rodeos. Cada animal pertenece a exactamente un rodeo en un momento dado.

- **Sistema** (a veces "sistema productivo" cuando hace falta desambiguar) — Atributo del rodeo. Categoría productiva que define qué datos se capturan, qué transiciones de categoría aplican, y qué workflows operativos están habilitados. Valores reconocidos para vacunos en MVP: **cría**, **recría**, **invernada**, **feedlot**, **tambo**, **cabaña**. Solo cría está habilitado en UI para MVP (ver `CONTEXT/01-producto.md`); el resto están preparados en la arquitectura pero ocultos hasta que se habiliten.

- **Lote** — **No usar** en MVP para grupos de animales. Reservado para una posible necesidad futura de "agrupación temporal dentro de un rodeo o cruzando rodeos" (ej. armar un lote para mandar al remate, asignar un grupo a un potrero específico, separar terneros para vacunación). Esa necesidad no está confirmada para MVP. Si surge post-MVP, evaluar entonces.

Aplicación práctica:

- **DB**: tablas y columnas usan `rodeos`, `system_type` (o equivalente, ver spec 02 refinada), nunca `lots` o `lotes` para grupos de animales.
- **UI**: copy en español usa "rodeo" y "sistema" consistentemente. Ejemplos válidos: "Crear rodeo", "Sistema productivo: cría", "Rodeo de vaquillonas", "¿A qué rodeo va este animal?".
- **Specs y docs**: prosa técnica usa la misma nomenclatura. Cuando hay ambigüedad temporal durante exploración, vale usar términos genéricos en código (`HERD`, `PRODUCTION_SYSTEM`) como placeholder explícito a resolver antes de implementación.

## Alternativas consideradas

### Lote = grupo / Sistema = tipo (propuesta inicial de Raf)
- **Pros**: separa "qué" (lote, concreto) de "qué clase" (sistema, categórico) de forma más abstracta y orientada a desarrolladores.
- **Contras**: suena traducido en boca del productor argentino. "Tengo 3 lotes de tipo rodeo cría" no es habla natural. Validado con el vet socio: rechazado.

### Rodeo = tipo de sistema / Lote = grupo (otra variante)
- **Pros**: igual de simétrica.
- **Contras**: misma objeción — invierte el uso natural del idioma.

### Rodeo = grupo / Tipo = atributo (sin la palabra "sistema")
- **Pros**: simplifica una palabra.
- **Contras**: "tipo" es demasiado genérico — se confunde con "tipo de animal", "tipo de evento", "tipo de identificación". "Sistema" es lo específico y profesional.

### Nombres genéricos en clave (HERD / PRODUCTION_SYSTEM) como placeholder durante toda la app
- **Pros**: máxima neutralidad lingüística, internacionalización trivial.
- **Contras**: descarta la oportunidad de hablar el idioma del usuario. RAFAQ es producto argentino para el productor argentino; usar nombres traducidos es perderse el efecto de proximidad cultural que es parte del posicionamiento.

## Consecuencias

**Positivas**:

- **Coherencia con el lenguaje del usuario**: el copy de UI se va a sentir natural para el productor argentino desde el primer touchpoint, alineado con el posicionamiento "el mejor en el primer try" (ver memoria `product_positioning`).
- **Decisión transversal cerrada de una sola vez**: evita refactor masivo de copy y nombres de columnas cuando se descubra la inconsistencia más tarde.
- **Onboarding tiene la palabra correcta**: cuando el productor crea su primer rodeo, la elección de sistema productivo es un campo obligatorio con vocabulario familiar.
- **Internacionalización futura no se bloquea**: si en post-MVP se exporta a Uruguay, Brasil, Paraguay, etc., se puede mapear "rodeo/sistema" → su equivalente regional, igual que cualquier i18n. La decisión actual es "español rioplatense, MVP argentino".

**Negativas**:

- **Si en post-MVP aparece la necesidad real de "agrupación temporal cruzando rodeos"** (ej. armar un lote para sanidad de animales que vienen de 2 rodeos distintos), va a haber que introducir "lote" como concepto nuevo. La buena noticia: la palabra está libre y queda disponible exactamente para ese caso. Mitigación: documentar este uso reservado en el copy de los docs para que no se pierda la intención.

- **El término "sistema" puede colisionar en UI con "configuración del sistema" o "sistema operativo"**. Mitigación: cuando haya riesgo de ambigüedad, escribir "sistema productivo" completo en lugar de "sistema".

**Notas de implementación**:

- Validar consistencia en `specs/active/02-modelo-animal/{requirements,design,tasks}.md` durante el refinamiento previo a aprobación (item A.5 del plan).
- Validar consistencia en `CONTEXT/01-producto.md`, `CONTEXT/03-flujos-maniobras.md`, `CONTEXT/04-modelo-datos.md`, `CONTEXT/08-roadmap.md`.
- Cuando se redacte la spec 09 (BUSCAR ANIMAL), usar este vocabulario desde el primer borrador.
- Lista canónica de sistemas para vacunos: `cría | recría | invernada | feedlot | tambo | cabaña`. Lista canónica de datos por sistema queda pendiente con el vet socio (item en `CONTEXT/07-pendientes.md`).

**Reversibilidad**: media. Cambiar terminología después del MVP es costoso (toca copy en UI, possibly nombres de tablas/columnas, código que referencia esos nombres, traducciones futuras, docs externos). Cerrarlo ahora es la jugada correcta.
