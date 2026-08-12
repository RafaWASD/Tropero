# Consulta a Facundo — qué hay que conservar y por cuánto tiempo

**12/08/2026** · Para: Facundo · De: Rafa
**Se necesita para**: poder publicar la app en Google Play y escribir la política de privacidad.

---

## Por qué te pregunto esto

La app tiene un botón de "eliminar mi cuenta". Hoy, cuando alguien lo aprieta, **no se borra casi nada**: se marca la cuenta como dada de baja y se le corta el acceso, pero el mail, el teléfono y el nombre de la persona quedan guardados para siempre.

Eso hay que arreglarlo, y no sólo por las tiendas: **Google Play exige** que una app que permite crear cuenta también permita borrarla junto con sus datos. Se puede retener lo que haya obligación legal de conservar, pero hay que declararlo y acotarlo — no vale "guardamos todo por las dudas".

Y acá está el punto donde te necesito: **yo sé qué guarda el sistema, pero no sé qué obliga a guardar la normativa.** Si borro de más, podemos dejar a un productor sin respaldo ante una inspección. Si guardo de más, incumplimos y además es feo.

---

## Qué guarda el sistema hoy

Separo dos cosas, porque la respuesta puede ser distinta para cada una.

### A. Datos del animal y del campo

Caravana y número de identificación · nacimientos, pesajes, tactos, servicios y pariciones · tratamientos sanitarios (producto, dosis, vía, fecha) · movimientos y transferencias entre campos · declaraciones a SIGSA · RENSPA y ubicación del establecimiento.

### B. Datos de la persona

Nombre, mail y teléfono del usuario · qué rol tiene en cada campo · **quién cargó cada evento** (queda registrado el usuario que hizo cada carga) · registro de auditoría de acciones sensibles.

---

## Las cuatro preguntas

**1. De lo del punto A, ¿qué obliga SENASA a conservar y por cuánto tiempo?**
Me sirve el plazo concreto si lo hay (¿dos años? ¿cinco? ¿mientras viva el animal y N años después?), y si es distinto según el tipo de dato — no es lo mismo un pesaje que un tratamiento con período de retiro o un movimiento con DTe.

**2. Esa obligación, ¿de quién es: del productor o del software?**
O sea: ¿el que tiene que poder mostrar los registros ante una inspección es el dueño del campo, y nosotros somos apenas la herramienta donde los anotó? Cambia bastante. Si la obligación es del productor, lo que tenemos que garantizar es que **él** pueda exportar y conservar lo suyo, no que nosotros lo guardemos eternamente.

**3. 🔴 La más importante: ¿la obligación alcanza a los datos de la PERSONA?**
Es decir, ¿hace falta que quede registrado el nombre, el mail o el teléfono del que cargó cada evento, o alcanza con el registro del animal y del establecimiento?

Te lo pregunto así de puntual porque **de esto depende todo el arreglo**: si la trazabilidad se sostiene con el animal y el RENSPA, podemos borrar los datos personales al eliminar la cuenta y quedarnos tranquilos. Si en cambio hay que poder decir *quién* aplicó un tratamiento, entonces no podemos borrar la identidad y hay que declararlo en la política de privacidad.

**4. ¿Hay alguna exigencia de identificar al veterinario actuante?**
Distinta de la anterior: en tratamientos o en ciertas maniobras, ¿tiene que constar la matrícula del vet que las hizo? Si sí, ese dato es de otra naturaleza —es un acto profesional— y probablemente se conserve aunque la persona se dé de baja.

---

## Qué hago con cada respuesta

| Si la respuesta es… | Lo que implementamos |
|---|---|
| La trazabilidad no necesita a la persona | Al eliminar la cuenta se **borran** mail, teléfono y nombre. Los eventos del animal quedan, referenciados a un usuario anónimo |
| Hay que poder identificar quién cargó | No se borra la identidad; se declara en la política de privacidad **con el plazo y el fundamento** |
| Depende del tipo de evento | Se borra lo que se pueda y se retiene lo puntual, que es lo más prolijo pero también lo más caro de hacer bien |

No necesito precisión de abogado. Con que me digas **qué se te exige a vos en la práctica** cuando te cae una inspección, y qué plazos manejás, alcanza para decidir. Si hay algo que no sabés con certeza, decime eso también — prefiero saber qué es firme y qué es tu impresión, porque lo firme lo escribimos en la política de privacidad y lo otro no.

---

## Una cosa más, no urgente

Cuando puedas, ¿podés confirmar **en qué clase del INPI** está registrado ese "Tropero" de Mendoza que vende cuchillos? Es el último dato que falta para cerrar el tema de las clases, aunque la decisión que tomamos —no presentar la 44— ya no depende de eso.
