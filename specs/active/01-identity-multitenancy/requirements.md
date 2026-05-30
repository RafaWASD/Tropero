# Spec 01 — Identidad y Multi-Tenancy

**Status**: Draft (pendiente de aprobación humana)
**Fecha**: 2026-05-25
**Última revisión**: 2026-05-29 — refinamiento de edge cases sesión 17 (switch=dropdown, estado `active_lost`, persistencia del token de invitación, crear campo online, owner único, etc. — ver "Historial de refinamiento"). Previas: 2026-05-29 — landing por cantidad de campos + pantalla "Mis campos" (R6.6–R6.9); 2026-05-25 — refinamiento de invitaciones a link shareable (ver `ADR-014`).
**Autor**: Raf

## Resumen

Primer bloque fundacional del producto. Establece el modelo de identidad de usuarios, autenticación, jerarquía de establecimientos, roles por relación usuario-establecimiento, e invitaciones por **link shareable** que el owner reparte por el canal que prefiera (WhatsApp, mail, copy-paste). Sin rodeos en este spec (van en spec 02).

Sirve como sustrato de todas las features que vienen después: ninguna entidad de negocio se puede crear sin `establishment_id`, y ningún acceso se permite sin un `user_roles` activo.

## Decisiones tomadas

Antes de las requirements, dejo registradas las decisiones que ya están cerradas para esta spec:

- **Auth provider**: Supabase Auth (email + password) — ver `ADR-002`.
- **Invitaciones (modelo link shareable)**: el owner crea la invitación sin ingresar email del destinatario. El sistema genera un link tipo `https://app.rafq.ar/invite?token=XXX` (y deep link `rafq://invite?token=XXX`) que el owner comparte por el canal que prefiera (WhatsApp, mail, SMS, copy/paste) usando la share sheet nativa o el botón de copy. El token vale por sí solo (modelo bearer, ver `ADR-014`).
- **Signup neutro**: el signup no pregunta "soy productor" vs "soy vet". El rol vive solo en `user_roles` (relación user-establishment). Un mismo usuario puede ser owner de su campo y veterinario invitado en otro.
- **Sin `user_type` en MVP**: la diferenciación de UX para el cold-start del vet se resuelve con un CTA dual en el empty state, no con autodeclaración en signup. Mantiene `ADR-006` intacto. Si más adelante hace falta segmentar para analytics o marketing, se agrega post-MVP con data real.
- **Modelo de roles**: `owner` / `field_operator` / `veterinarian` — ver `ADR-006`.
- **Multi-tenant enforcement**: Row Level Security de Postgres — ver `ADR-004`.
- **Soft deletes**: `deleted_at nullable timestamp` en todas las entidades de negocio.
- **Hard-delete fuera de scope MVP**: la política de retención (cuándo convertir soft-deletes en hard-deletes) se difiere hasta que SENASA publique requerimientos formales de retención. Anotar en `CONTEXT/08-roadmap.md` como trigger explícito.
- **Onboarding post-signup**: wizard con dos CTAs visibles — primario "crear mi primer campo" y secundario "pegar link de invitación". El mismo wizard sirve a productores y a veterinarios/operarios sin necesidad de segmentar (ver `ADR-014`).
- **Teléfono**: opcional en signup, obligatorio al crear establecimiento. Refleja que el contacto telefónico solo importa para clientes que pagan (owners).
- **Email de invitación al destinatario**: **no aplica** en el modelo link shareable. El owner es responsable de hacer llegar el link al destinatario por el canal que elija. Eliminado.
- **Notificación al owner cuando aceptan invitación**: email transaccional al owner (via Resend) + push notification (Expo Notifications). Este flujo se mantiene intacto.
- **Transferencia de ownership**: no implementamos flujo en MVP. El único owner activo debe soft-deletear el establecimiento antes de darse de baja de su cuenta (`R2.5`). Documentar como limitación conocida.
- **Email opcional como anotación en `invitations`**: el owner puede registrar a quién dirige la invitación (campo `email` nullable), pero **no se valida contra el destinatario que acepta** (eso es del modelo bearer). Sirve solo para la lista de "invitaciones pendientes" del owner.
- **Sin rodeos en este spec**: rodeos quedan para spec 02 (modelo de animal).
- **Landing por cantidad de campos + pantalla "Mis campos"** (decidido sesión 17, ver `R6.6`–`R6.9`): el driver es la **cantidad de establecimientos activos**, no el rol. Con **≥2 campos** el usuario aterriza en la pantalla **"Mis campos"** (selector); con **exactamente 1** aterriza directo en la home de ese campo y "Mis campos" queda accesible desde el **switch del header** (arriba a la izquierda), que también ofrece "crear campo". Los **veterinarios** y los **productores multi-campo** caen naturalmente en el selector (suelen tener varios); al dueño de un solo campo no se le interpone una pantalla de selección con un único ítem. Realiza la mitigación que `ADR-018` dejó anotada (promover el switch de establecimiento al header en vez de esconderlo en "Más").
- **Switch del header = dropdown rápido + "Mis campos"** (refinado sesión 17, ver `R6.8`/`R6.8.1`): el switch despliega un dropdown inline (campo activo + últimos 2 visitados + "Ver todos mis campos" + "Crear nuevo campo +"), no navega directo al selector. Esto promueve `last_establishment_opened` (`R6.9`) de nice-to-have a **requerido** (los "últimos visitados" lo necesitan).
- **Crear campo requiere conexión** (decidido sesión 17, ver `R9.2`): el alta de establecimiento es operación administrativa online. **Cambiar de campo activo sí funciona offline** si el campo destino ya está sincronizado en el cliente.
- **Aviso al miembro cuando le quitan o le borran un campo: NO en MVP** (decidido sesión 17): cuando a un miembro le remueven el rol (`R4.7`) o el owner soft-deletea el campo (`R3.6`), el miembro **no** recibe push ni email; se entera **silenciosamente** la próxima vez que opera, vía el estado `active_lost` y el re-ruteo de `R6.10`. La notificación proactiva al miembro afectado queda como mejora **post-MVP**.
- **Limitación conocida — owner único = punto único de falla**: en MVP no hay segundo owner ni transferencia de ownership (`R5.1` solo invita a `field_operator`/`veterinarian`; `R2.5`/`R2.5.1` obligan a soft-deletear el campo para darse de baja). Un campo con un solo owner es por tanto un punto único de falla: si ese usuario pierde acceso a su cuenta, no hay otro owner que pueda recuperar el campo ni reasignar roles. Mitigado parcialmente por el soft-delete en todo (nada se pierde físicamente) y la auditoría de `user_roles`. La transferencia de ownership y/o múltiples owners se difieren a post-MVP.

## Requirements (EARS)

### R1. Registro y autenticación

**R1.1** El sistema deberá permitir que un usuario se registre con email, password y nombre como únicos datos obligatorios. El teléfono no se pide en signup; se requiere recién al crear un establecimiento (ver `R3.8`).

**R1.2** Cuando un usuario se registra, el sistema deberá enviar un email de verificación con un link único.

**R1.3** Mientras el email del usuario no esté verificado, el sistema deberá permitir el login pero restringir la creación de establecimientos y la aceptación de invitaciones.

**R1.4** El sistema deberá permitir login con email y password.

**R1.5** El sistema deberá permitir solicitar recuperación de password mediante un link enviado al email.

**R1.6** El sistema deberá permitir logout, invalidando la sesión local.

**R1.7** Si el usuario falla el login 5 veces consecutivas en menos de 10 minutos, entonces el sistema deberá bloquear temporalmente los intentos para ese email durante 15 minutos.

**R1.8** El sistema deberá hashear las passwords con el mecanismo de Supabase Auth (bcrypt / Argon2 según provisión).

### R2. Perfil de usuario

**R2.1** El sistema deberá permitir que el usuario edite su nombre, teléfono y email.

**R2.2** Cuando un usuario cambia su email, el sistema deberá enviar verificación al nuevo email y mantener el viejo hasta que se confirme.

**R2.3** El sistema deberá registrar `created_at` y `updated_at` en todo usuario.

**R2.4** El sistema deberá permitir que el usuario elimine su cuenta. Cuando esto ocurra, el sistema deberá hacer soft-delete (set `deleted_at`) en el usuario y desactivar todos sus `user_roles`.

**R2.5** Si un usuario es el único `owner` activo de un establecimiento, el sistema no deberá permitir la eliminación de su cuenta hasta que transfiera o elimine ese establecimiento.

**R2.5.1** (refina R2.5, sesión 17) Cuando un usuario intenta eliminar su cuenta y es el único `owner` activo de uno o más establecimientos, el sistema deberá rechazar la operación y devolver al cliente la **lista de los establecimientos bloqueantes** (id + nombre). El cliente deberá mostrar esa lista con un atajo directo por cada campo para **soft-deletearlo** (dispara `R3.6` sobre ese establecimiento). No alcanza con un error genérico: el flujo debe ser accionable de modo que el usuario pueda resolver cada bloqueante sin salir de la pantalla de baja de cuenta. Como en MVP no hay transferencia de ownership (ver "Decisiones tomadas"), soft-deletear cada campo bloqueante es la única vía de desbloqueo.

### R3. Establecimientos

**R3.1** El sistema deberá permitir que cualquier usuario con email verificado cree un establecimiento.

**R3.2** Cuando un usuario crea un establecimiento, el sistema deberá crear automáticamente un `user_roles` con `role = 'owner'` y `active = true` para ese usuario en ese establecimiento.

**R3.3** El sistema deberá requerir nombre y provincia al crear un establecimiento. El resto (ciudad, lat/long, hectáreas) son opcionales.

**R3.4** El sistema deberá permitir que un `owner` edite los datos del establecimiento.

**R3.5** Mientras un usuario tenga rol `field_operator` o `veterinarian` en un establecimiento, el sistema no deberá permitirle editar los datos del establecimiento.

**R3.6** El sistema deberá permitir que un `owner` haga soft-delete de un establecimiento. Cuando esto ocurra, todos los `user_roles` asociados deberán quedar `active = false`.

**R3.6.1** (refina R3.6, sesión 17) Antes de confirmar el soft-delete de un establecimiento, el cliente deberá mostrar un warning que incluya el **conteo de miembros activos** (`user_roles.active = true`) distintos del owner que ejecuta la acción, ya que esos miembros perderán acceso al campo (sus `user_roles` quedan `active = false` por `R3.6`, y serán re-ruteados por `R6.10` la próxima vez que operen). El cliente deberá requerir confirmación explícita del owner tras mostrar el conteo. El conteo se deriva de los `user_roles` activos del establishment (ya sincronizados vía el bucket `est_members`).

**R3.7** El sistema deberá incluir los campos `plan_type`, `plan_started_at`, `plan_limits` en `establishments`, sin lógica de validación activa en MVP (ver `ADR-009`).

**R3.8** Cuando un usuario intenta crear un establecimiento sin tener teléfono registrado en su perfil, el sistema deberá pedirle completar el teléfono antes de finalizar la creación.

### R4. Roles y acceso

**R4.1** El sistema deberá modelar la relación usuario-establecimiento como tabla pivot `user_roles` con `(user_id, establishment_id, role, active)`.

**R4.2** Un mismo `user_id` deberá poder tener `user_roles` distintos en distintos `establishment_id`.

**R4.3** El sistema deberá permitir un único rol activo por par `(user_id, establishment_id)`. Si se le cambia el rol, el viejo se desactiva (`active = false`) y se crea uno nuevo activo, manteniendo historial.

**R4.4** Cuando un usuario tiene rol `owner`, el sistema deberá permitirle también operar como `field_operator` en ese mismo establecimiento sin necesitar un `user_roles` adicional.

**R4.5** El sistema deberá permitir que un `owner` cambie el rol de otro usuario en su establecimiento (entre `field_operator` y `veterinarian`).

**R4.6** El sistema no deberá permitir que un `owner` se degrade a sí mismo si es el único owner activo del establecimiento.

**R4.7** El sistema deberá permitir que un `owner` remueva el acceso de otro usuario al establecimiento, marcando el `user_roles` correspondiente como `active = false`.

### R5. Invitaciones (modelo link shareable, ver `ADR-014`)

**R5.1** El sistema deberá permitir que un `owner` cree una invitación a su establecimiento seleccionando solo el rol destino (`field_operator` o `veterinarian`). Opcionalmente, el owner podrá registrar un email destinatario como anotación, **sin que ese email se valide al aceptar** (es solo etiqueta para que el owner reconozca la invitación en su lista de pendientes).

**R5.2** Cuando un owner crea una invitación, el sistema deberá:
- Crear una fila en `invitations` con token único (UUID v4), expiración 7 días, estado `pending`, y `email` opcional.
- Retornar al cliente `{ invitation_id, token, accept_url, expires_at }`, donde `accept_url` es un universal link (`https://app.rafq.ar/invite?token=XXX`) que también funciona como deep link nativo (`rafq://invite?token=XXX`).
- **No** disparar email automático al destinatario.

**R5.3** El cliente del owner deberá ofrecer al menos dos acciones visibles sobre el link generado:
- **Copiar al portapapeles** (`Clipboard.setStringAsync`).
- **Compartir vía share sheet nativa** (`expo-sharing` o `Share.share`), permitiendo elegir WhatsApp, mail, SMS, Instagram, Telegram, etc. según las apps que el dispositivo del owner exponga.

**R5.4** Cuando un destinatario abre el link de invitación:
- Si el deep link se abre en la app y el usuario ya está logueado, el sistema deberá mostrar una pantalla de aceptación con info del establishment y rol.
- Si el usuario no está logueado, el sistema deberá ofrecerle "Registrarme" o "Iniciar sesión", **persistiendo el token de invitación en almacenamiento seguro** (ver `R5.13`) y completando la aceptación después de auth.
- Si el deep link no autoabre la app (caso degradado, ej. browser desktop, restricción del SO), el destinatario podrá entrar a la app manualmente, ir al wizard de onboarding y usar el CTA "pegar link de invitación" (ver `R6.5`).

**R5.5** Cuando el destinatario logueado acepta una invitación válida (token correcto, no expirada, estado `pending`), el sistema deberá:
- Crear un `user_roles` con `(user_id = auth.uid(), establishment_id, role, active = true)`. Si ya existe un `user_roles` activo para ese par (race condition), no falla: se reutiliza el existente.
- Marcar la invitación como `accepted` con `accepted_at = now()`.

**R5.6** Si una invitación está expirada (`expires_at < now()`), cancelada, o ya aceptada, el sistema no deberá permitir su aceptación y deberá retornar un error claro al cliente para que muestre un mensaje legible. El link de invitación es **single-use de facto**: al aceptarse, la invitación pasa a `accepted` (`R5.5`) y su token deja de ser válido. (refina, sesión 17) Para el caso de quien llega tarde a un link ya usado, el cliente deberá mostrar copy accionable: **"Este link ya fue usado. Pedile al dueño que te genere uno nuevo."** La regeneración la cubre `R5.8`.

**R5.7** El sistema deberá permitir que el owner cancele una invitación pendiente (estado pasa a `cancelled`, el token deja de ser válido).

**R5.8** El sistema deberá permitir **regenerar el link** de una invitación pendiente. La operación deberá generar un nuevo token (invalidando el anterior) y reiniciar `expires_at`. Sirve como mecanismo de revocación cuando el owner comparte el link por error o sospecha que llegó a la persona equivocada.

**R5.9** Cuando el destinatario intenta aceptar una invitación y ya tiene un `user_roles` activo en ese establecimiento, el sistema deberá retornar un error claro `already_member`. La validación se hace en la aceptación, no en la creación (el modelo bearer no conoce al destinatario al crear el link). (refina, sesión 17) El sistema **no deberá** auto-cambiar el rol del usuario vía la invitación, ni siquiera cuando el rol de la invitación difiere del rol activo que ya tiene (evita escalada accidental de privilegios — un link a "owner" no debe poder reescribir el rol de alguien que ya es `field_operator`). El cliente deberá mostrar copy accionable que nombre el rol actual del usuario en ese campo: **"Esta persona ya es miembro como `<rol>`. Para cambiarle el rol, usá Miembros → Cambiar rol."** El cambio de rol vive exclusivamente en el flujo de `R4.5`, nunca en la aceptación de invitaciones. Es ajuste de copy + confirmación de la lógica existente, no un cambio de comportamiento.

**R5.10** Cuando una invitación pasa a estado `accepted`, el sistema deberá enviar un email transaccional al owner que la creó, notificándolo de la aceptación (incluye nombre/email del nuevo miembro y rol asignado). El envío es best-effort: si falla, no debe revertir la aceptación.

**R5.11** Donde el owner tenga la app instalada y permisos de notificaciones otorgados (token registrado en `push_tokens`), el sistema deberá enviar también una push notification cuando una invitación que él creó sea aceptada. El envío es best-effort en paralelo al email (R5.10).

**R5.12** El sistema deberá listar al owner las invitaciones de su establishment activo en estado `pending`, exponiendo para cada una: rol, fecha de creación, expiración, email opcional, y acciones (copiar link, compartir link, regenerar, cancelar).

**R5.13** (nueva, sesión 17 — persistencia del token a través del cold-start) Cuando un destinatario aún no logueado abre un link de invitación (`R5.4`) o lo pega manualmente en el wizard (`R6.5`), el sistema deberá persistir el token de invitación en **almacenamiento seguro** (`expo-secure-store`), no solo en el estado de navegación en memoria. El onboarding del invitado atraviesa signup + verificación de email + un posible cierre o kill de la app entre medio; el estado de navegación no sobrevive ese cold-start, así que persistirlo es requisito para no perder la invitación. Cuando el usuario pasa el gate de verificación de email (`R1.3`) y existe un token pendiente en almacenamiento seguro, el sistema deberá **re-rutear automáticamente** a la pantalla de aceptación de invitación (`R5.4`) en lugar de aterrizar en el wizard de onboarding (`R6.5`) o en el landing (`R6.7`). Tras consumir el token (aceptación exitosa de `R5.5`, o error terminal de `R5.6` como expirado/ya usado), el sistema deberá **borrar** el token persistido para no re-disparar el flujo en arranques futuros.

### R6. Contexto activo de establecimiento

**R6.1** Cuando un usuario tiene `user_roles` activos en más de un establecimiento, el sistema deberá pedirle elegir uno como "establecimiento activo" al iniciar sesión.

**R6.2** El sistema deberá permitir cambiar el establecimiento activo en cualquier momento desde la UI.

**R6.3** Mientras haya un establecimiento activo en sesión, el sistema deberá usar ese `establishment_id` por default para todas las queries y operaciones de carga.

**R6.4** Cuando un usuario solo tiene `user_roles` activo en un único establecimiento, el sistema deberá seleccionarlo automáticamente sin pedir input.

**R6.5** Cuando un usuario verificado no tiene ningún `user_roles` activo, el sistema deberá mostrar un wizard de onboarding con dos CTAs visibles: (a) primario, "crear mi primer campo", que inicia el flujo de creación de establecimiento; y (b) secundario, "pegar link de invitación", que abre un input para que el usuario pegue manualmente un link `https://app.rafq.ar/invite?token=XXX` o `rafq://invite?token=XXX` recibido por WhatsApp, mail o cualquier otro canal. Al pegar un link válido, el sistema deberá extraer el token, navegar a la pantalla de aceptación de invitación (ver `R5.4`) y completar el flujo. Este CTA actúa como red de seguridad cuando el deep link no autoabre la app por restricciones del SO o porque el usuario abrió el link desde un dispositivo distinto.

**R6.6** El sistema deberá exponer una pantalla **"Mis campos"** que liste todos los establecimientos donde el usuario tiene `user_roles.active = true`, mostrando para cada uno al menos: nombre del establecimiento, rol del usuario en ese campo (owner / field_operator / veterinarian) y un indicador visual del campo activo actual. Al tocar un item, el sistema deberá fijarlo como establecimiento activo (ver `R6.3`) y navegar a su home. La pantalla deberá incluir un CTA "crear campo" (inicia el flujo de creación de establecimiento, `R3.1`) y, si corresponde, el CTA "pegar link de invitación" (`R6.5`).

**R6.6.1** (refina R6.6, sesión 17 — orden y búsqueda) El sistema deberá ordenar la lista de "Mis campos" con el **campo activo o el último visitado primero** (usando `last_establishment_opened`, ver `R6.9`) y el resto en orden **alfabético** por nombre. Cuando el usuario tenga **más de ~8 campos activos**, la pantalla deberá ofrecer una **barra de búsqueda** que filtre la lista por nombre del establecimiento. El umbral atiende al caso del veterinario (canal de adquisición), que puede acumular del orden de 20 campos donde es miembro; el dueño de pocos campos no ve el search bar.

**R6.6.2** (refina R6.6, sesión 17 — presentación de cada campo como card) Cada establecimiento en "Mis campos" deberá renderizarse como una **card (`EstablishmentCard`)** de densidad media (dirección "híbrido adaptivo", no fila plana ni banner full-screen — escala del dueño de 1 campo al vet con ~20). La card deberá mostrar:
- un **banner/imagen** del campo: por **default** un banner generado (gradiente en verde botella + inicial del campo); el owner podrá opcionalmente subir una **foto custom** (almacenada en Supabase Storage, cacheada offline). Nunca se fuerza subir imagen.
- **nombre** del establecimiento + **badge de rol** (owner / field_operator / veterinarian) + indicador del **campo activo**.
- hasta **2 contadores**: cantidad de animales activos y cantidad de rodeos.
- una **métrica hero adaptativa** (una sola, la más relevante según el estado del campo):
  - si hay tacto reciente → **% de preñez** del último tacto (con mes/año);
  - si no, pero hay animales → **cabezas** + fecha de la última maniobra;
  - si el campo está vacío (recién creado) → CTA **"Configurá tu rodeo"** (engancha con el wizard de la home, no un número vacío).
- una **señal de atención** opcional cuando aplique (ej. "⚠ tacto pendiente", datos sin sincronizar) — convierte la pantalla en triage para el vet con muchos campos.
- un **slot de benchmarking** reservado en la línea de la métrica hero (ej. "92% · +5 vs zona ▲"): **en MVP no se muestra comparación** (no hay baseline con pocos campos beta); el layout reserva el lugar y la comparación **se enciende post-beta** cuando exista baseline de zona/otros campos. No prometer comparación sin datos.

**Nota de arquitectura (no-bloqueante MVP)**: calcular los contadores y la métrica hero para N campos en vivo en el landing es costoso y poco offline-friendly. Con pocos campos (beta) se computa en vivo; al escalar conviene un **rollup de resumen por establecimiento** (agregado cacheado, refrescado al cerrar una maniobra) que la card lee. Ver backlog.

`EstablishmentCard` es un componente reusable de la librería (ADR-023); su UI fina es TENTATIVA hasta el design system, pero la anatomía (banner + nombre + rol + 2 contadores + métrica hero adaptativa + señal de atención + slot de benchmark) queda fijada acá.

**R6.7** Al abrir la app con sesión válida, email verificado y al menos un `user_roles` activo, el sistema deberá enrutar el landing según la **cantidad** de establecimientos activos del usuario:
- **Exactamente 1** → aterrizar directo en la **home** de ese establecimiento (consistente con `R6.4`, sin interponer selección).
- **2 o más** → aterrizar en la pantalla **"Mis campos"** (`R6.6`), que realiza la selección de establecimiento activo de `R6.1`.

El criterio es la cantidad de campos, no el rol; los veterinarios y productores multi-campo caen naturalmente en "Mis campos" por tener varios. (El caso de 0 campos activos lo cubre `R6.5`.)

**R6.8** Mientras haya un establecimiento activo, el sistema deberá mostrar en el header (arriba a la izquierda) de las pantallas principales un **switch de establecimiento** que muestre el nombre del campo activo como feedback de contexto.

**R6.8.1** (refina R6.8, sesión 17 — switch = dropdown rápido) Al tocar el switch del header, el sistema deberá desplegar un **dropdown inline** (no navegar directamente a "Mis campos") con, en este orden:
- el **campo activo actual** (marcado como tal);
- los **últimos 2 campos visitados** distintos del activo (derivados de `last_establishment_opened`, ver `R6.9`); si el usuario tiene menos de 3 campos en total, se muestran los que haya;
- **"Ver todos mis campos"** → abre la pantalla "Mis campos" (`R6.6`) para la lista larga y la gestión;
- **"Crear nuevo campo +"** → inicia el flujo de creación de establecimiento (`R3.1`).

Tocar el campo activo no hace nada (o cierra el dropdown); tocar uno de los últimos visitados deberá fijarlo como establecimiento activo (`R6.3`) y navegar a su home sin pasar por "Mis campos". El dropdown es un atajo de cambio rápido entre los campos de uso frecuente; la pantalla "Mis campos" (`R6.6`) sigue siendo la vía para la lista completa, la búsqueda (`R6.6.1`) y la gestión. Esto realiza la mitigación que `ADR-018` dejó anotada (promover el switch de establecimiento al header).

**R6.9** (refinada y promovida a REQUERIDO, sesión 17) El sistema **deberá** persistir por usuario el último establecimiento abierto (`last_establishment_opened`) y, en general, el rastro de los **últimos campos visitados** suficiente para alimentar los "últimos 2 visitados" del dropdown del switch (`R6.8.1`). Antes era nice-to-have; pasa a requerido porque el dropdown de cambio rápido depende de este dato. Se usa para: **pre-destacar / pre-seleccionar** el campo en "Mis campos" (`R6.6`), ordenar esa lista (`R6.6.1`), fijar el contexto activo por defecto al reabrir la app, y poblar los últimos visitados del dropdown del header. No deberá usarse para **saltear** la pantalla "Mis campos" en usuarios con ≥2 campos al hacer el landing inicial (el selector sigue siendo el landing deseado para vets y multi-campo, `R6.7`); el dropdown del switch es un atajo *posterior* al landing, no un reemplazo de él. El rastro de visitados deberá ser robusto frente a campos que dejaron de ser accesibles: si `last_establishment_opened` apunta a un campo donde el usuario ya no tiene rol activo, se ignora ese valor y se aplica `R6.10`.

**R6.10** (nueva, sesión 17 — pérdida del campo activo y re-ruteo) El sistema deberá manejar un estado **`active_lost`**: la situación en la que el establecimiento activo en sesión dejó de ser válido para el usuario. Este estado cubre cuatro casos:
- (a) al usuario le **removieron el rol** (`R4.7`) mientras estaba operando dentro del campo;
- (b) el `owner` **soft-deleteó** el establecimiento activo (`R3.6`);
- (c) `last_establishment_opened` apunta a un campo ya **inaccesible** al reabrir la app;
- (d) un **sync revocó el rol** (consistente con `R7.4`: la desactivación se detecta en la próxima query, no por logout forzado).

Cuando una query al establecimiento activo falle por pérdida de rol (`R7.2`/`R7.4`) o el campo dejó de ser válido (soft-deleted), el sistema deberá entrar en `active_lost` y:
- mostrar un **aviso legible** según el caso — *"Ya no tenés acceso a `<campo>`"* (rol removido/revocado) o *"`<campo>` fue eliminado"* (soft-delete del owner);
- **re-rutear según `R6.7`** evaluado sobre los `user_roles` activos **restantes**: si queda **≥1 campo**, llevar a "Mis campos" (`R6.6`) o, si queda exactamente 1, a su home; si quedan **0 campos**, llevar al wizard de onboarding (`R6.5`).

El sistema **no deberá** forzar logout en `active_lost` (consistente con `R7.4`): el usuario sigue autenticado; solo pierde el contexto del campo que ya no le pertenece. El aviso al miembro de que perdió acceso a un campo se da **solo dentro de la app** vía este re-ruteo; en MVP no se envía push ni email al miembro afectado (ver "Decisiones tomadas").

### R7. Aislamiento multi-tenant

**R7.1** El sistema deberá hacer cumplir el aislamiento entre tenants mediante Row Level Security de Postgres.

**R7.2** El sistema deberá garantizar que ningún usuario pueda leer ni modificar datos de un establecimiento donde no tenga `user_roles.active = true`.

**R7.3** El sistema deberá garantizar que las operaciones administrativas (invitar, cambiar rol, editar campo, eliminar campo) solo sean accesibles a usuarios con `role = 'owner'` en ese establecimiento.

**R7.4** Si un `user_roles` se desactiva mientras el usuario tiene una sesión activa, el sistema deberá invalidar el acceso a ese establecimiento en la próxima query (no es necesario forzar logout inmediato).

### R8. Soft deletes y auditoría

**R8.1** El sistema deberá incluir `deleted_at` (timestamp nullable) en `users`, `establishments` y `invitations`.

**R8.2** El sistema deberá incluir `created_at` y `updated_at` en todas las entidades.

**R8.3** Cuando una entidad tiene `deleted_at != null`, el sistema no deberá retornarla en queries normales (solo en queries administrativas explícitas).

**R8.4** Las RLS policies deberán filtrar `deleted_at IS NULL` por default.

### R9. Sincronización offline (preparación)

**R9.1** Las tablas de este spec (`users`, `user_roles`, `establishments`, `invitations`) deberán estar configuradas en PowerSync como sincronizables, scoped por el set de `establishment_id` donde el usuario tiene rol activo.

**R9.2** Las operaciones de registro, login y password reset deberán requerir conectividad (no se sincronizan offline). (refina, sesión 17) La **creación de un establecimiento** (`R3.1`) también deberá **requerir conexión**: es una operación administrativa de baja frecuencia, no de campo, y su efecto (auto-asignar el `user_roles` de owner por `R3.2`, sembrar la configuración inicial) debe quedar firme en el server antes de que el usuario empiece a operar. En cambio, **cambiar de establecimiento activo** (`R6.2`, `R6.3`, vía el switch `R6.8.1` o "Mis campos" `R6.6`) **sí deberá funcionar offline** siempre que el campo destino ya esté sincronizado en el cliente (sus filas de `establishments`/`user_roles` ya bajaron por los buckets de `R9.1`): cambiar de campo es solo fijar el `establishment_id` activo localmente, no requiere round-trip. Si el campo destino aún no sincronizó, el cliente deberá indicarlo. El resto (editar perfil, invitar, etc.) puede tolerar offline si tiene sentido, pero no es requisito para este spec.

## Criterios de aceptación globales

Esta spec se considera implementada cuando:

- Un usuario nuevo puede registrarse, verificar email, crear un establecimiento y verlo en su lista.
- Un owner puede invitar a otro usuario por email, ese usuario recibe el email, acepta y aparece como miembro del establecimiento con el rol correcto.
- Un usuario con roles en múltiples establecimientos puede cambiar el contexto activo y todos los datos visibles cambian acordemente.
- Las RLS policies impiden que un usuario lea datos de un campo donde no tiene rol activo (validado con tests).
- Un owner puede remover el acceso de otro usuario y ese usuario pierde acceso inmediatamente.
- Todo lo anterior funciona end-to-end con Supabase + cliente React Native.

## Historial de refinamiento

> Audit trail de los refinamientos posteriores a la redacción inicial. No se borra.

- **2026-05-29 (sesión 17) — Refinamiento de edge cases (Gate 0 retroactivo)**. Decisiones tomadas por Raf en sesión 17 sobre la spec ya redactada. Cambios en `requirements.md`:
  - **R6.8 / R6.8.1 (nueva)** — el switch del header pasa de "navegar a Mis campos" a **dropdown rápido**: campo activo + últimos 2 visitados + "Ver todos mis campos" + "Crear nuevo campo +". "Mis campos" (`R6.6`) sigue para la lista larga y gestión.
  - **R6.9 (refinada y promovida)** — `last_establishment_opened` deja de ser nice-to-have y pasa a **requerido** (lo necesita el dropdown de últimos visitados); también alimenta orden de "Mis campos" y robustez ante campos inaccesibles.
  - **R6.6.1 (nueva)** — orden de "Mis campos": activo/último-visitado primero, resto alfabético; search bar cuando hay >~8 campos (caso vet con ~20).
  - **R6.10 (nueva)** — estado **`active_lost`** + re-ruteo: cubre los 4 casos de pérdida del campo activo (rol removido estando adentro, owner borró el campo, `last_establishment_opened` inaccesible, sync revocó el rol). Aviso legible + re-ruteo según `R6.7` sobre los campos restantes; sin logout forzado (consistente con `R7.4`).
  - **R9.2 (refinada)** — **crear campo requiere conexión** (operación administrativa); **cambiar de campo activo funciona offline** si el destino ya sincronizó.
  - **R5.4 + R5.13 (nueva)** — persistencia del **token de invitación pendiente** en almacenamiento seguro (`expo-secure-store`) para sobrevivir signup + verificación de email + posible kill de la app; re-ruteo automático a la pantalla de aceptación al pasar el gate de verificación (`R1.3`); borrado del token tras consumirlo.
  - **R2.5.1 (nueva)** — el owner único que se quiere ir recibe la **lista de campos bloqueantes** con atajo directo para soft-deletear cada uno (no solo error genérico).
  - **R3.6.1 (nueva)** — antes del soft-delete de un campo, **warning con el conteo de miembros activos** que perderán acceso + confirmación explícita.
  - **R5.9 (refinada)** — `already_member`: se mantiene la lógica (no auto-cambiar rol vía invitación, evita escalada), se agrega **copy accionable** nombrando el rol actual ("usá Miembros → Cambiar rol").
  - **R5.6 (refinada)** — documentado que el link es **single-use de facto** + copy para el que llega tarde ("Este link ya fue usado. Pedile al dueño que te genere uno nuevo."). Regeneración por `R5.8`.
  - **Decisiones tomadas** — agregadas como limitaciones/decisiones: switch=dropdown, crear campo online, **aviso al miembro = NO en MVP** (silencioso vía `active_lost`, notificación proactiva post-MVP), y **owner único = punto único de falla** (sin 2do owner ni transferencia en MVP).
  - **Decisión de criterio propio del autor (a validar por Raf)**: umbral de "~8 campos" para mostrar el search bar de "Mis campos" en `R6.6.1` (heurística, no número cerrado por Raf); y el alcance de "últimos visitados" se interpretó como "últimos 2 distintos del activo" según el pedido literal del punto 1.
