# Plan de toma de marca — miTropero

**Actualizado: 10/08/2026** · Documento vivo. Refleja lo hecho, lo que falta, y quién hace cada cosa.

> **Convención de responsable**
> **[RAF]** — lo hace Rafael a mano (requiere clave fiscal, tarjeta, un teléfono, o un clic de verificación).
> **[CLAUDE]** — lo hago yo desde acá, con las herramientas de Cloudflare conectadas.
> **[AMBOS]** — arranca uno y lo termina el otro.

---

## 1. Estado actual

### ✅ Hecho

| Qué | Detalle |
|---|---|
| **Nombre definitivo** | **miTropero** |
| **Dominio principal** | `mitropero.com.ar` — comprado en nic.ar, AR$ 8.500 |
| **Dominio corto** | `mitropero.ar` — comprado en nic.ar, AR$ 25.000 |
| **Dominio internacional** | `mitropero.com` — comprado en Cloudflare Registrar, USD 10,46. Renovación automática activa, bloqueo de transferencia puesto, privacidad de WHOIS activa. Vence 07/08/2027 |
| **`mitropero.com` → `mitropero.com.ar`** | ✅ Redirección 301 configurada y verificada |
| **Titularidad** | Clave fiscal personal de Rafael |
| **Casilla del proyecto** | `mitropero@proton.me` — cuenta Proton nueva y gratuita |
| **Cuenta de Cloudflare** | Creada con la casilla del proyecto |
| **Zona `mitropero.com.ar`** | Creada · NS asignados: `mckinley` + `ryan` |
| **Zona `mitropero.ar`** | Creada · NS asignados: `marvin` + `shubhi` |
| **Delegación** | ✅ Cargada por TAD y **propagada**. Las dos zonas quedaron `active` |
| **Dirección de destino del correo** | `mitropero@proton.me` verificada |
| **Email Routing** | ✅ **Activo** en `mitropero.com.ar`. MX, SPF y DKIM visibles en DNS público |
| **`hola@mitropero.com.ar`** | ✅ Reenvía a `mitropero@proton.me` |
| **Catch-all** | ✅ Cualquier otra dirección del dominio va a `mitropero@proton.me` |
| **`mitropero.ar` → `mitropero.com.ar`** | ✅ Redirección 301 verificada, preservando ruta y parámetros. `www` incluido |
| **Herramientas de Cloudflare** | Plugin instalado y autenticado — puedo operar la cuenta |
| **Decisión: dominio principal** | `mitropero.com.ar`. El `.ar` redirige |
| **Identificador de la app** | `com.mitropero.app` *(a confirmar por Rafael)* |
| **Cuenta de Google del proyecto** | ✅ Creada con `mitropero@proton.me` |
| **Instagram** | ✅ Cuenta creada con la casilla del proyecto |
| **Línea del proyecto** | ✅ Chip Tuenti · **11 7058-0364** |
| **WhatsApp Business** | ✅ Registrado con esa línea |

| **Marca en INPI** | ✅ `MITROPERO` denominativa, clases **42** y **9** — en trámite |
| **Manual de marca** | ✅ Nombre real puesto en las 36 secciones · `manual-de-marca.html` / `.pdf` |
| **Landing "próximamente"** | ✅ Armada, **sin publicar** — esperando el OK |

### ❌ Todavía no arrancado

Facebook · TikTok · X · LinkedIn · clase 44 del INPI · documento de titularidad con Facundo · cuentas de desarrollador · fase 2 del rebrand.

---

## 2. Lo primero que hay que destrabar

*(La delegación por TAD ya cerró y las tres zonas quedaron `active`. Ese cuello de botella se destrabó el 05/08.)*

### 🔴 [RAF] Los tres dominios no muestran nada

`mitropero.com.ar` **no tiene registro A**: no resuelve a ningún servidor. Verificado el 10/08 — devuelve error de conexión. Y como el `.ar` y el `.com` redirigen ahí, **los tres dominios terminan en un error del navegador**.

Hay una página mínima de "próximamente" lista en `docs/marketing/landing-proximamente/index.html`, sin publicar, esperando el OK. Se publica gratis en Cloudflare Pages y las redirecciones existentes no se tocan.

### [RAF] + [FAC] Confirmar los dos destinos de correo

Los mails de verificación de Cloudflare ya salieron a `ravennarafael59@gmail.com` y a `iamfadolf@gmail.com`. Es **un clic en cada casilla** y desbloquea `rafa@` y `facundo@`. Avisarle a Facundo antes: le llega un mail de un servicio que él no dio de alta y se lo puede comer el spam.

---

## 3. Correo — paso a paso

**El modelo mental, que es lo que más confunde:**

- **Cloudflare = el cartero.** Recibe todo lo dirigido a `@mitropero.com.ar` y lo reparte. No guarda nada.
- **Proton = el buzón.** Donde los mails caen y se leen.

Las direcciones `hola@`, `rafa@` y `facundo@` **no se crean en Proton ni en ningún lado**: son reglas de reenvío en Cloudflare.

| # | Paso | Quién | Estado |
|---|---|---|---|
| 1 | Crear la casilla `mitropero@proton.me` | [RAF] | ✅ |
| 2 | Crear la cuenta de Cloudflare con esa casilla | [RAF] | ✅ |
| 3 | Comprar los dominios | [RAF] | ✅ |
| 4 | Crear las zonas en Cloudflare | [CLAUDE] | ✅ |
| 5 | Cargar la delegación en TAD | [RAF] | ✅ propagada |
| 6 | Verificar la dirección de destino `mitropero@proton.me` | [CLAUDE] | ✅ |
| 7 | Activar Email Routing en `mitropero.com.ar` | [CLAUDE] | ✅ |
| 8 | Crear la regla de `hola@` | [CLAUDE] | ✅ |
| 9 | Poner el catch-all | [CLAUDE] | ✅ |
| 10 | Redirigir `mitropero.ar` → `mitropero.com.ar` | [CLAUDE] | ✅ verificada |
| 11 | **Probar mandando un mail a `hola@mitropero.com.ar`** | [RAF] | ⛔ **hacelo ahora** |
| 12 | Agregar como destino `ravennarafael59@gmail.com` | [CLAUDE] | ✅ 10/08 |
| 13 | **Confirmar ese destino** desde el Gmail de Rafael | [RAF] | ✅ 10/08 |
| 14 | Agregar como destino `iamfadolf@gmail.com` | [CLAUDE] | ✅ 10/08 |
| 15 | **Confirmar ese destino** desde el Gmail de Facundo | [FAC] | ⛔ **un clic** — avisarle antes, le llega un mail de un servicio que él no dio de alta |
| 16 | Crear la regla de `rafa@` | [CLAUDE] | ✅ 10/08 |
| 17 | Crear la regla de `facundo@` | [CLAUDE] | ⛔ bloqueado por 15 |
| 18 | **Probar de punta a punta**: mandar un mail a `rafa@` desde otra cuenta | [RAF] | ⛔ nunca se probó la cadena entera |

> Cloudflare rechaza crear la regla mientras el destino no esté verificado (`2054: Destination address is not verified`), y está bien que lo haga: si no, cualquiera podría desviar correo a una casilla ajena. Los dos mails de verificación ya salieron el 10/08.

### Las reglas que voy a crear

| Dirección | Reenvía a | Estado |
|---|---|---|
| `hola@mitropero.com.ar` | `mitropero@proton.me` | ✅ activa |
| `rafa@mitropero.com.ar` | `ravennarafael59@gmail.com` | ✅ activa desde el 10/08 |
| `facundo@mitropero.com.ar` | `iamfadolf@gmail.com` | ⛔ falta que Facundo confirme |
| **catch-all** (cualquier otra) | `mitropero@proton.me` | ✅ activa |

El catch-all evita que rebote un mail a `info@`, `ventas@` o `contacto@`. Alguien va a escribir a una de esas.

**Límite conocido:** Cloudflare **solo recibe**. Para crear cuentas y recibir códigos alcanza y sobra. Cuando haga falta escribir desde `hola@`, se resuelve entonces.

---

## 4. Redes sociales — paso a paso

### Corrección importante sobre con qué mail registrarse

Antes había escrito que las redes se crearan con `hola@mitropero.com.ar`. **Cambio esa indicación**, por dos motivos:

1. Esa dirección **todavía no funciona** —depende del Email Routing, que depende de la delegación—, y las redes son lo urgente.
2. Aunque funcionara, hacer que las cuentas dependan del reenvío agrega un punto de falla: si el routing se rompe, se pierde la recuperación de todas.

**Registrá todas las cuentas con `mitropero@proton.me`.** Es el buzón real, no depende de nada, y es el mismo lugar donde caen los mails de `hola@` igual.

`hola@mitropero.com.ar` es la dirección que **se publica** —en la bio, en la web, en el folleto—, no con la que te registrás.

### Reglas generales

- **Mismo usuario en todas: `mitropero`.**
- **Si está tomado en una, usá la misma variante en TODAS** (`mitropero.ar` o `mitroperoapp`). Lo peor es un usuario distinto en cada red.
- **No las dejes vacías.** Foto y una línea de bio: algunas plataformas liberan usuarios inactivos y sin contenido.
- **Doble factor en todas**, con los códigos guardados en el gestor del proyecto.
- **Navegador en incógnito o perfil aparte**, para que no se enganchen con tus cuentas personales.
- La foto de perfil es **provisoria**: el logo lo está haciendo Pilar. Un cuadrado de color plano con la palabra alcanza para reservar.

### Orden de creación

#### 1. Instagram — ✅ hecho (cuenta creada, profesional, foto, bio y 2FA)

Queda el enlace de la bio, que se pone cuando la landing esté publicada. Los pasos de abajo quedan como registro de cómo se hizo.

1. Entrá desde **instagram.com en el navegador**, no desde la app: la app tiende a engancharlo con tu cuenta personal y a sugerirte tus contactos.
2. Registrate con `mitropero@proton.me`.
3. **Usuario: `mitropero`** · **Nombre: `miTropero`**.
4. Confirmá el mail (llega al Proton del proyecto).
5. Pasala a **cuenta profesional** — hace falta para las estadísticas, el enlace en la bio y para conectarla después con Meta Business.
6. Categoría: *Software* o *Empresa agropecuaria*.
7. Bio provisoria: qué es en una línea. El enlace lo dejás vacío hasta que exista la web.
8. **Activá el doble factor.**

#### 2. Cuenta de Google del proyecto · ✅ hecha

Hacela **una sola vez** y reusala: la vas a necesitar para YouTube y, más adelante, para **Google Play Console**.

1. Creá una cuenta de Google **usando `mitropero@proton.me` como dirección** (Google permite cuentas con mail que no sea de Gmail).
2. Doble factor.
3. Con esa cuenta creás el canal de YouTube cuando lo necesites — no es urgente hasta que haya video.

#### 3. Facebook y Meta Business · [RAF]

**Aviso honesto:** Meta **exige un perfil personal** detrás de toda página. No hay forma de tener una página sin que un humano figure como administrador, y crear un perfil falso viola sus términos y expone a perder la página.

1. Creá la **página** de miTropero desde tu perfil personal de Facebook. Tu perfil no se muestra públicamente como dueño.
2. Creá el **Business Manager** con `mitropero@proton.me`.
3. Meté la página adentro del Business Manager.
4. **Agregá a Facundo como administrador** de la página, así no depende solo de vos.
5. La cuenta publicitaria se crea acá adentro cuando llegue el momento — no ahora.

#### 4. WhatsApp Business · ✅ hecho

Chip propio del proyecto **11 7058-0364**, registrado en WhatsApp Business. Quedó como se había decidido con Gonzalo: línea nueva del proyecto, no el celular de Facundo. Atiende Facundo, pero el número es del proyecto.

Falta sólo cargarle `hola@mitropero.com.ar` como mail de contacto en el perfil — ya funciona.

#### 5. Defensivas — ✅ TikTok, X y Threads tomadas · ⛔ falta LinkedIn

Tomás el usuario, ponés foto y bio, y las dejás quietas. No hace falta publicar nada.

> **Dos trampas que aparecieron al hacerlo (11/08/2026):**
>
> **YouTube: crear el canal y reclamar el `@` son dos pasos distintos.** El canal nace con una URL de `/channel/UC…` y el identificador queda libre hasta que lo definís a mano en Studio → Personalización → Información básica. Al 11/08 `youtube.com/@mitropero` daba 404: nadie lo tomó todavía, pero nosotros tampoco.
>
> **Facebook no deja crear la página con un perfil nuevo, y castiga el reintento.** Devuelve "intentaste crear demasiadas páginas recientemente" y dice "unos minutos", pero el bloqueo dura horas y cada reintento lo extiende. La página va creada desde el **perfil personal de siempre** de Rafael: Meta exige un humano detrás de toda página, y un perfil inventado se cae y se lleva la página puesta.

#### 6. Reserva del nombre en las tiendas · [RAF] — cuando existan las cuentas

- **App Store Connect** permite **reservar el nombre** creando el registro de la app antes de tener nada que subir. Requiere la cuenta de desarrollador de Apple (USD 99/año).
- **Google Play no reserva nombres**: se define al publicar.

---

## 5. INPI — registro de marca · [RAF]

**Estado al 10/08/2026: clases 42 y 9 presentadas, en trámite.** El detalle completo —qué ítem se tildó en cada clase y por qué— está en `guia-inpi-marca-mitropero.md`.

La protección corre desde el **día que presentás**, no desde que te la conceden, y podés usar la marca mientras tanto (con ™; el ® recién cuando esté concedida). No necesitás abogado para presentar.

> **Dos correcciones a lo que decía este documento antes.** Decía "12 a 18 meses": es **~2 meses** si se eligen las descripciones del desplegable de TMClass, sin gestor y sin pedir prioridad; se estira a ~6 meses si hay vistas u oposiciones. Y decía "clave fiscal nivel 3": alcanza con **nivel 2**, que es hasta donde llega el homebanking.

### Pasos

1. ✅ **Clave fiscal nivel 2** + **adherir el servicio del INPI** desde el portal de ARCA.
2. ✅ **Búsqueda de antecedentes** (gratis, en el portal): "TROPERO" y variantes fonéticas.
3. ✅ **Presentar**: denominación `MITROPERO`, tipo **denominativa**, clases **42** y **9**.
4. ⛔ **Clase 44** — pendiente de un dato: apareció un "Tropero" de Mendoza que vende cuchillos, pero **falta saber en qué clase está**. Una cuchillería es clase 8 (y 35 si además vende); la 44 son servicios veterinarios, de cría y agrícolas. Si el registro no está en la 44, la clase sigue limpia y conviene tomarla.
5. **Pagar** ~AR$ 39.000 por clase (100 UMAPIs; la UMAPI se ajusta por inflación cada mes — verificá el valor vigente).
6. Publicación en el Boletín · 30 días hábiles de oposiciones · examen de fondo · concesión.

**Regla que vale para las tres clases:** una oposición en una clase **no toca a las otras**. La 42 y la 9 ya tienen fecha de prioridad propia y son independientes de lo que pase con la 44.

### Denominativa, no mixta

- **Denominativa** = solo la palabra `MITROPERO`. **Protege más**: te cubre escrita con cualquier tipografía o color.
- **Mixta** = con el logo. Protege ese diseño puntual.

Se presentó la **denominativa**, que era lo correcto: no dependía de que Pilar terminara el logo, así que la fecha de prioridad ya está corriendo. La mixta se suma cuando exista el logo.

### El riesgo real — lo que se encontró en la búsqueda

| Quién | Clase | Estado | Qué implica |
|---|---|---|---|
| **EL TROPERO** (mixta) · Sánchez, Alfredo Luis · Nogoyá, ER | **35** | Vigente, presentada 07/04/2025 | Es por lo que **se descartó la clase 35**. Su limitación cubre ferias de venta de ganado y venta de maquinaria agrícola y productos veterinarios: demasiado cerca |
| **"Tropero" de Mendoza** (cuchillos) | ❓ **falta el dato** | Vigente | Si está en la 8 o la 35, no afecta la 44. Es lo único que falta para decidir |
| *El Tropero S.A.* / *S.R.L.* | — | Sin balances desde 2000; sin marcas vivas o vencidas | Prácticamente inertes |
| Marca de carne española *Tropero* | — | — | Lejos: otro país, otra clase |

**No te bloquean** —ninguna vende software y el examen se hace contra los servicios reclamados— pero **suben la chance de una oposición** en los 30 días. El "mi" adelante agrega distintividad y las clases de software están lejos de la carne. Si aparece oposición hay mediación obligatoria antes de resolver; ahí sí conviene un abogado.

**No contrates agencia** para presentar: cobran USD 300-500 por un formulario. Guardá esa plata por si hay oposición.

---

## 6. A nombre de quién va todo

### El límite duro

**Los dominios `.ar` no admiten cotitularidad**: el titular es un CUIT/CUIL, uno solo. Ya quedaron a nombre de Rafael, que es lo correcto operativamente — el que opera tiene que poder actuar sin pedir firma.

**La marca en INPI sí admite cotitularidad**, pero no conviene sin sociedad: con dos titulares, transferir o accionar exige la firma de los dos, y un desacuerdo congela la marca.

### [AMBOS] La hoja que hay que firmar

La asimetría se dice en voz alta: **todo a nombre de Rafael lo favorece a él**. Lo que la corrige es un documento firmado por los dos, con cuatro puntos:

1. Los dominios, la marca, las redes y las cuentas de desarrollador se registran a nombre de Rafael pero **pertenecen al proyecto conjunto**.
2. **Se transfieren a la sociedad** cuando se constituya.
3. Qué pasa **si uno se va**: quién conserva los activos y cómo se compensa al otro.
4. Fecha y firma de ambos.

Un documento privado firmado ya tiene valor; certificar las firmas cuesta poco y lo vuelve difícil de discutir. Que lo mire un abogado societario.

> **No mezclar con el acuerdo de socios.** El de activos es angosto y urge; el del 50/50 es otra conversación y no hace falta cerrarla para seguir con esto.

### Cuentas de desarrollador

Sin sociedad, Apple y Google Play van como **individuo, a nombre de Rafael**. La modalidad de organización exige entidad legal. Se transfieren después. Entra en la misma hoja.

---

## 7. Seguridad de las cuentas · [RAF]

- **Doble factor en todo**, y los **códigos de recuperación guardados fuera** de la casilla del proyecto. Si el segundo factor y el mail viven en el mismo teléfono, perderlo deja al proyecto afuera de todo.
- **Gestor de claves del proyecto: ✅ resuelto.** Se usa el **Proton Pass que viene con la cuenta del proyecto** (`mitropero@proton.me`), no el Proton personal de Rafael. Es lo correcto: las claves del proyecto no cuelgan de una cuenta privada. Queda pendiente sólo **compartir el acceso con Facundo**, para que la pérdida del teléfono de uno no deje al proyecto afuera de todo.
- Ahí van: Proton del proyecto, Cloudflare, nic.ar, y todas las redes.

### Qué dirección usar para cada cosa

| Servicio | Dirección |
|---|---|
| Cloudflare, nic.ar, Bitwarden, **todas las redes**, Google, tiendas | `mitropero@proton.me` |
| La que se publica en bio, web y folletos | `hola@mitropero.com.ar` |
| Correspondencia de Rafael con la marca | `rafa@mitropero.com.ar` |
| La de Facundo | `facundo@mitropero.com.ar` |

---

## 8. Gastado y por gastar

| Concepto | Monto | Estado |
|---|---|---|
| `mitropero.com.ar` | AR$ 8.500 | ✅ pagado |
| `mitropero.ar` | AR$ 25.000 | ✅ pagado |
| `mitropero.com` | USD 10,46 | ✅ pagado (vence 07/08/2027, renovación automática) |
| INPI clases 42 + 9 | ~AR$ 78.000 | ✅ pagado |
| INPI clase 44 | ~AR$ 39.000 | ⛔ a decidir |
| Chip prepago para WhatsApp Business | bajo | ✅ pagado |
| Cuenta de desarrollador de Apple | USD 99/año | ⛔ cuando toque publicar |
| Casilla, Cloudflare, DNS, redes, landing, gestor de claves | AR$ 0 | ✅ |

---

## 9. Checklist de lo que queda

```
CORREO
[x] [RAF]    Delegación cargada y propagada
[x] [CLAUDE] Email Routing activo + hola@ + catch-all + redirección del .ar
[x] [RAF]    Pasar el mail personal propio y el de Facundo
[x] [CLAUDE] Dar de alta los dos destinos en Cloudflare
[x] [RAF]    Confirmar el destino desde ravennarafael59@gmail.com
[x] [CLAUDE] Crear la regla de rafa@
[ ] [FAC]    Confirmar el destino desde iamfadolf@gmail.com
[ ] [CLAUDE] Crear facundo@ (bloqueado hasta que confirme)
[ ] [RAF]    Probar de punta a punta: mandar un mail a rafa@ desde otra cuenta
[ ] [RAF]    Compartir el vault de Proton Pass del proyecto con Facundo

REDES
[x] [RAF]    Instagram @mitropero (profesional, foto, bio, 2FA)
[x] [RAF]    Cuenta de Google del proyecto
[x] [RAF]    Chip nuevo (11 7058-0364) + WhatsApp Business
[x] [RAF]    TikTok @mitropero — verificado, responde
[x] [RAF]    Threads @mitropero — verificado, responde
[x] [RAF]    X — creada; falta confirmar que el usuario quedó "mitropero"
[x] [RAF]    YouTube: canal creado
[ ] [RAF]    YouTube: RECLAMAR el identificador @mitropero (hoy da 404, está libre)
[ ] [RAF]    YouTube: confirmar que el canal está en la cuenta del PROYECTO
[ ] [RAF]    Página de Facebook + Business Manager + Facundo como admin
[ ] [RAF]    LinkedIn (defensiva)
[ ] [RAF]    Poner el link a mitropero.com.ar en la bio de cada red

MARCA — detalle completo en guia-inpi-marca-mitropero.md
[x] [RAF]    Clave fiscal + adherir el servicio del INPI en ARCA
[x] [FAC]    Búsqueda de antecedentes "TROPERO"
[x] [RAF]    Presentar MITROPERO denominativa, clase 42 — EN TRÁMITE
[x] [RAF]    Presentar MITROPERO denominativa, clase 9 — EN TRÁMITE
[—] [AMBOS]  Clase 35 DESCARTADA: hay un "EL TROPERO" vivo desde abril 2025
[ ] [FAC]    Averiguar EN QUÉ CLASE está el "Tropero" de Mendoza (cuchillos)
[ ] [RAF]    Si no está en la 44, presentar la clase 44 (~AR$ 39.000)
[ ] [RAF]    Seguimiento quincenal en el portal — los plazos son perentorios
[ ] [AMBOS]  Firmar la hoja de titularidad de activos

WEB
[x] [CLAUDE] Armar la landing "próximamente" (sin publicar, esperando OK)
[ ] [RAF]    Decidir: publicar sí/no, e indexable o noindex
[ ] [CLAUDE] Publicarla en Cloudflare Pages sobre mitropero.com.ar
[ ] [CLAUDE] Página /invite que reciba los links de invitación

PRODUCTO — rebrand
[x] [CLAUDE] Fase 1: nombre visible en la app, los mails y el copy + guard automático
[ ] [RAF]    Cambiar las plantillas de mail de Supabase Auth (en DEV **y** en PROD)
[ ] [RAF]    Re-correr el prebuild de Android antes del próximo build local
[ ] [RAF]    Confirmar el identificador definitivo para arrancar la fase 2
[ ] [RAF]    Fase 2: Apple (App IDs + Services ID + client secret), Google (OAuth
             Clients + pantalla de consentimiento), App Store Connect (app nueva)
[ ] [CLAUDE] Fase 2: recién después, app.config.ts y eas.json

ORDEN INTERNO
[ ] [RAF]    Confirmar en qué cuenta de Proton Pass vive el vault del proyecto
[ ] [RAF]    Confirmar el identificador com.mitropero.app
[x] [CLAUDE] Reemplazar [NOMBRE] por miTropero en el manual de marca
```

---

## 10. Lo que sigue del lado del producto

El relevamiento del 10/08 mostró que el rebrand del código **no es un rename**: se parte en dos fases muy distintas.

### Fase 1 — nombre visible · [CLAUDE] · hecha en código

Sin dependencias externas y sin riesgo: el nombre de la app en la config de Expo, los wordmarks de la Home y de las pantallas de auth, el subtítulo de la pantalla de invitación, el copy que se manda por WhatsApp, y el nombre del remitente de los mails. Queda un guard automático que escanea el árbol y falla si aparece el nombre viejo en una superficie nueva.

> El **nombre para mostrar** del remitente sí se pudo cambiar hoy: Resend verifica el **dominio de la dirección**, no el nombre. El mail ya llega de "miTropero <noreply@rafq.ar>". Cambiar la dirección a `@mitropero.com.ar` es fase 2 y necesita verificar el dominio en Resend.

#### 🔴 [RAF] Lo que quedó fuera del código y sólo podés hacer vos

1. **Las plantillas de mail de Supabase Auth** —confirmación de cuenta y reseteo de contraseña— siguen diciendo el nombre viejo. Viven en el dashboard de Supabase, no hay archivo en el repo que las contenga. **Es el único texto cara al usuario que todavía dice RAFAQ, y lo ve todo usuario nuevo al registrarse.** Hay que cambiarlas en **DEV y en PROD**, son dos proyectos distintos.
2. **El prebuild de Android que está en disco está viejo**: su `strings.xml` todavía dice `RAFAQ`. Es un archivo generado y gitignoreado, pero si buildeás local hoy, la app se instala con el nombre viejo en el launcher. Hay que re-correr el prebuild antes del próximo `gradlew assembleDebug`.
3. **La pantalla de consentimiento de OAuth de Google** está dada de alta como "RAFAQ" — es lo que ve el usuario cuando entra con Google. Consola externa; va con el resto de la fase 2.

### Fase 2 — identidad de la app · [AMBOS] · bloqueada por trabajo en consolas

Cambiar el identificador `ar.rafq.app` **crea una app nueva** a los ojos de las tiendas. Arranca por afuera del código, en este orden:

1. [RAF] Confirmar el identificador definitivo (`com.mitropero.app`).
2. [RAF] Apple: App IDs nuevos, **Services ID nuevo**, regenerar el client secret, reconfigurar Supabase Auth en dev y prod con el orden exacto de Client IDs.
3. [RAF] Google: OAuth Clients nuevos para iOS y Android (el de Android va atado a package + SHA-1).
4. [RAF] App Store Connect: **app nueva**. La actual (`ascAppId 6797347994`) quedó atada al bundle viejo y ese dato no se puede cambiar nunca.
5. [CLAUDE] Recién entonces, tocar `app.config.ts` y `eas.json`.
6. [CLAUDE] **Actualizar la página web en el mismo movimiento.** El botón "Abrir en la app" de `mitropero.com.ar/invite` usa `rafq://`: el scheme dejó de ser un identificador interno y pasó a ser un contrato con el sitio publicado. Si se cambia en la app y no en la web, el botón deja de funcionar sin que ningún test lo note.
7. [CLAUDE] Publicar los archivos de asociación (`apple-app-site-association` y `assetlinks.json`) para que tocar el link abra la app. Van firmados con el identificador y la huella del certificado, por eso van acá y no antes.

> **Por qué conviene hacerlo ahora y no en tres meses:** Apple emite un identificador de usuario distinto por Services ID. Cualquiera que ya haya entrado con Apple aparecería como cuenta nueva y perdería el acceso a sus datos. Hoy eso no le pasa a nadie —no hay productores usando la app y la cuenta demo entra por Google—, así que es la ventana más barata que va a existir.

**Lo que NO se toca en ninguna fase**, porque parece marca y son contratos internos: los prefijos de storage `rafq.*` (renombrarlos le borra a cada usuario el rodeo activo, el bastón recordado y el token de invitación a medio usar), el header `X-Rafaq-Actor` que lee un trigger de auditoría en Postgres, las GUCs `rafaq.*`, el nombre del archivo `sync-streams/rafaq.yaml`, y `slug`/`owner`/`projectId` de EAS (cambiarlos pierde historial de builds y credentials).

### El resto

| Qué | Quién | Nota |
|---|---|---|
| **Links de invitación** contra `mitropero.com.ar` | [CLAUDE] | ✅ **Cerrado en DEV el 11/08.** Página `/invite` publicada, las cuatro puntas del repo alineadas con guard, y `invite_user` v9 + `resend_invitation` v8 desplegadas y verificadas en el artefacto. El secret `APP_URL` no existía y se dejó así a propósito. En PROD estas funciones nunca se desplegaron. Falta probar una invitación real de punta a punta |
| **Remitente de mails** `@mitropero.com.ar` | [CLAUDE] | Requiere verificar el dominio en Resend (SPF/DKIM). El Email Routing de Cloudflare sirve para **recibir**; enviar es otra configuración |
| **Publicación en tiendas** | [AMBOS] | Depende de la fase 2 |
| **Paleta e identidad** | Pilar | Al cerrar, le mido los contrastes y la simulación de daltonismo |
