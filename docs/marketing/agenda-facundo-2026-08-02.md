# Qué sacarle a Facundo — domingo 02/08

Ordenado por lo que destraba. El bloque A es el que no podés dejar pasar; el B destraba código que hoy está frenado; el C es sobremesa.

**Regla para todo lo que sea número o nombre: que te lo mande por escrito** (WhatsApp sirve). Lo que quedó en la charla no existe.

---

## BLOQUE A — Lo que necesita Gonzalo (15 min, no negociable)

### A1. El número del dolor 🔴 *es el insumo #1 de todo el marketing*

No alcanza con "se pierde plata". Necesitamos números que aguanten una objeción:

- **La vaca vacía**: ¿cuánto le cuesta al productor una vaca que queda vacía un año? (lo que come + el ternero que no produjo). ¿Y dos años seguidos?
- **Cuántas hay**: ¿qué porcentaje de vacas vacías tiene un campo típico *sin* control, y cuánto baja *con* control?
- **La vaquillona bajo peso**: si va a servicio sin llegar al 66% del peso adulto, ¿cuánto le baja la preñez?
- **El destete**: ¿cuántos kilos se pierden por destetar tarde o temprano de más?

**Y lo más importante: ¿de dónde sale cada número?** INTA, Rosgan, la cátedra, alguna revista del rubro. Un número con fuente aguanta la charla con el productor; uno sin fuente se cae en la primera objeción.

> Aclarale la línea: esto sirve para decir *"una vaca vacía te cuesta tanto"*. **No** para decir *"con la app recuperás tantos kilos"* — eso no lo podemos respaldar con nada, no tenemos un solo usuario.

### A2. Las dos preguntas de Gonzalo 🔴

1. **¿Cuántas horas por semana reales tiene para vender?** Todo el plan de 3 meses asume que el canal es él. Si son 2 horas, se planifica distinto que si son 10. No es reproche, es dimensionar.
2. **¿Qué 5-10 campos entrarían primero a la beta?** Nombres concretos. La meta de 10-15 campos sale de esa lista o no sale.

### A3. Precio de Control Ganadero

- ¿Qué pagan hoy sus clientes? ¿Qué incluye?
- Y la que más importa: **¿qué le costaría a un cliente cambiarse?** Si tiene años de historia cargada ahí, el precio pasa a segundo plano y el argumento tiene que ser otro.

### A4. La jornada de manga de mediados de agosto

- ¿Qué día aproximado, en qué campo?
- ¿Qué maniobras se van a hacer y cuántos animales?
- Aclarale que **la primera no se filma**: es la prueba del producto. Si hay cámara, nadie testea bien y encima el video sale de cosas que fallan. Se filma la segunda.

### A5. El WhatsApp del proyecto

Que las consultas caigan en una **línea nueva del proyecto**, no en su celular personal. Atiende él igual, pero un lead en un WhatsApp personal no se mide, no se transfiere y se mezcla con su clínica.

---

## BLOQUE B — Lo que destraba código frenado hoy (10 min)

### B1. SIGSA 🔴 *bloquea el diferencial de venta entero*

El código está terminado y probado. Lo único que falta es su gestión:

- **¿Subió ya el archivo de prueba a SIGSA web** (2-3 animales, con clave fiscal)? Es el gate duro. De ahí necesitamos cinco respuestas: ¿lleva `;` al final del último registro?, ¿espacios?, ¿limita el rango de fechas de nacimiento?, ¿cómo valida el RFID (ceros a la izquierda, checkdigit)?, ¿acepta mayúsculas y minúsculas mezcladas?
- **Raza desconocida: ¿`OR` o `S/E`?** Cuando el productor no sabe la raza, ¿qué código espera SENASA en la declaración de dispositivos?
- **RENSPA: ¿puede repetirse?** ¿Un mismo RENSPA puede aparecer legítimamente en dos campos distintos (por ejemplo si se vende el campo), o es único e intransferible? **Esto bloquea una migración de base de datos** que está esperando la respuesta.

### B2. Reportes por campaña 🔴 *bloquea una tanda de mejoras*

Los reportes no cambian con el selector de año, y no es un bug de código: **falta definir qué es "servida en la campaña 2026"**. Hoy una hembra cuenta como servida por estar en el rodeo, no por un evento fechado.

La propuesta es anclarlo a evidencia con fecha: servida = elegible + en el rodeo + con un tacto o parto atribuible a esa campaña. **Necesita que él lo firme**, porque cambia números que hoy se ven en pantalla (una servida todavía sin tactar deja de contar hasta que se la tacte).

### B3. El pedido a Allflex (MFi)

¿Mandó el pedido de autorización del SDK? **Es lo único que destraba el bastón en iPhone.** Hay tres competidores internacionales que ya la tienen, así que no es un favor raro: es un trámite que Allflex da de rutina.

---

## BLOQUE C — Si hay tiempo (sobremesa)

- **Aplicabilidad de maniobras**: ¿el raspado es solo de toros y toritos, o de todo macho? ¿El sangrado de brucelosis a qué categorías y desde qué edad? ¿Los dientes y la condición corporal se le hacen a los terneros?
- **Circunferencia escrotal**: ¿en qué tres momentos se mide? ¿Qué valor es apto?
- **"Vaca" a secas**: cuando el productor escribe "Vaca" en su planilla, ¿a qué categoría nuestra mapea? Hoy el import la mete como vaquillona aunque tenga 6 años.
- **Precios**: ¿USD 20 por campo, 5 y 20 para el vet, le cierran para el mercado argentino?
