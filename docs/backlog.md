# Backlog

Overflow de scope: ítems que aparecieron durante una sesión pero exceden su objetivo. Se anotan acá para no perderse y se procesan después como feature nueva, ADR, spec o nota informativa.

No es un sustituto de `feature_list.json` ni de los ADRs — es la antesala donde se acumulan cosas pendientes de clasificar.

## Formato

````
## YYYY-MM-DD — <título corto>

**Origen**: sesión X, mientras se trabajaba en Y.
**Qué**: descripción breve.
**Por qué importa**: 1-2 líneas.
**Próximo paso sugerido**: feature nueva en `feature_list.json` / ADR / spec / nada (info).
````

## Ítems pendientes

## 2026-05-28 — Pesaje de ternero: peso al pie vs peso al destete

**Origen**: sesión 15, refinamiento de contexto (Gate 0) de spec 03 MODO MANIOBRAS.
**Qué**: en MVP, pesaje de ternero = pesaje adulto + autocompleta categoría ternero/ternera (vínculo con la madre ya viene de `reproductive_events.calf_id`). Falta modelar peso al pie (lactancia) vs peso al destete como pesajes tipados distintos.
**Por qué importa**: son métricas productivas distintas para analítica de cría; pero la distinción no está validada con Facundo y modelarla a ciegas arriesga rehacer schema.
**Próximo paso sugerido**: refinar con Facundo post-MVP; si se confirma, agregar tipo/contexto al pesaje (posible data_key o columna de contexto en `weight_events`) vía migration, sin reabrir spec 03.

## 2026-05-29 — Estrategia de testing en device real (dev-build) — gap de Expo Go para SDK 56

**Origen**: sesión 17, intento de correr la app en el teléfono de Raf.
**Qué**: el proyecto está en Expo SDK 56 (salió 21-may-2026). Expo Go para SDK 56 **no está en App Store ni Play Store** (sin fecha) → la Expo Go de tienda (SDK 54) no carga el proyecto. Para device real hay 3 opciones: (a) sideload del APK Expo Go SDK 56 en **Android** (vía Expo CLI / expo.dev/go); (b) **iOS** vía TestFlight beta o `eas go` (necesita cuenta Apple Developer US$99/año); (c) **dev-build propio** (expo-dev-client + EAS build o build local) — el camino "correcto" para una app real, no Expo Go.
**Por qué importa**: el veredicto de "primer try" en hardware real (manga, sol, guante) es clave para RAFAQ, y el peón usa Android probablemente. Pero NO bloquea iterar diseño (eso va por web ahora).
**Próximo paso sugerido**: cuando importe device real, decidir entre dev-build (recomendado para app seria, alineado con ADR-013/EAS) vs sideload Android. Por ahora: **web** (`pnpm.cmd web`) para diseño. Sub-decisión latente: ¿quedarse en SDK 56 bleeding-edge o alinear a un SDK con Expo Go en tiendas? (rework si se baja).

## 2026-05-29 — Rollup de resumen por establecimiento (stats de la card "Mis campos")

**Origen**: sesión 17, diseño de la card `EstablishmentCard` (R6.6.2 de spec 01).
**Qué**: la card de cada campo muestra contadores (animales, rodeos) + métrica hero (% preñez último tacto, etc.). Calcularlos en vivo para N campos en el landing es costoso y poco offline-friendly.
**Por qué importa**: con pocos campos beta se computa en vivo sin problema; cuando un vet tenga 15-20 campos, N agregaciones en el landing = lento + mal offline.
**Próximo paso sugerido**: cuando escale, agregar un agregado cacheado por establecimiento (vista materializada o tabla de resumen), refrescado al cerrar una maniobra. No MVP.

## 2026-05-29 — Vista mapa de "Mis campos" (post-MVP)

**Origen**: sesión 17, diseño de "Mis campos".
**Qué**: los `establishments` ya tienen lat/long en el schema → vista mapa de los campos del usuario como alternativa a la lista.
**Por qué importa**: un vet que cubre una zona geográfica vería sus clientes en el mapa (UX potente para multi-campo). El dato ya existe.
**Próximo paso sugerido**: toggle lista/mapa en "Mis campos", post-MVP.

## 2026-05-29 — Benchmarking en la card de "Mis campos" (prender post-beta)

**Origen**: sesión 17, diseño de `EstablishmentCard`.
**Qué**: el slot de comparación ("% preñez 92% · +5 vs zona ▲") ya queda en el layout de la card (R6.6.2) pero VACÍO en MVP — requiere baseline (suficientes campos / datos de zona) que no existe con 1-3 campos beta.
**Por qué importa**: benchmarking es pilar de producto; para el vet con muchos campos, ver cada cliente vs promedio de zona es killer. Pero prometerlo sin datos sería humo.
**Próximo paso sugerido**: encender la comparación cuando haya baseline (post-beta). Posible vista derivada: "ranking de mis campos por % preñez vs zona" para el vet.

## 2026-05-29 — `entry_origin` como enum (analytics)

**Origen**: sesión 17, refi de edge cases de spec 02.
**Qué**: hoy `animal_profiles.entry_origin` es texto libre (ternero al pie usa `'born_here'` hardcodeado). Para analytics de "origen de ingreso" (compra vs nacido vs otro) conviene un enum consistente.
**Por qué importa**: analytics es pilar del producto; texto libre = estadísticas sucias. No bloquea MVP (cría-only, origen mayormente 'born_here' o compra).
**Próximo paso sugerido**: convertir a enum vía migration cuando se aborde el módulo de analytics/reportes (spec 07). NO tocar ahora. (Nota: `exit_reason` SÍ pasa a enum ya, por la decisión de baja/egreso de la misma refi — eso va en el delta backend de spec 02.)

## 2026-05-29 — Pantalla "Mis campos" + landing por rol (selección de establecimiento) — ✅ RESUELTO (misma sesión 17)

**Resolución (2026-05-29)**: Raf decidió la regla → landing por **cantidad de campos** (no por rol): ≥2 campos activos → pantalla "Mis campos" (selector, landing de vets y multi-campo); ==1 → home directa + "Mis campos" accesible vía switch del header. Folded en **spec 01** como `R6.6`–`R6.9` + flujo en `design.md`. No se creó ADR nuevo (es comportamiento de producto/navegación acoplado a la multi-tenancy de spec 01; realiza la mitigación que ADR-018 ya había anotado sobre el switch en el header). Memoria `project-mis-campos-landing` actualizada a "decidido". Se implementa en B.1 (frontend de spec 01).

**Origen**: sesión 17, design review de la home (Stitch). Al decidir reemplazar el menú hamburguesa por un switch de establecimiento en el header, Raf detectó que **nunca diseñamos ni pensamos la pantalla ANTERIOR a la home**: la que lista los establecimientos del usuario antes de entrar a uno.
**Qué**: definir (1) la pantalla **"Mis campos"** (listado de establecimientos donde el usuario tiene rol activo, multi-tenant de spec 01) y (2) **cuál es el landing por rol**:
- **Owner / dueño**: hipótesis = entrar directo a la home del **último campo abierto** (`last_establishment_opened`), con el switch en el header para ir a "Mis campos" manualmente. (Pocos campos, contexto estable.)
- **Veterinario**: hipótesis = el landing principal podría ser **"Mis campos"** directamente, porque probablemente tenga +10 campos para revisar. Pregunta abierta: ¿o también conviene abrirle el `last_establishment_opened` y que navegue al listado vía el switch?
**Por qué importa**: es un hueco de flujo de navegación de nivel app, no un detalle de UI. Afecta a spec 01 (multi-tenant / contexto activo) y al shell de navegación (ADR-018, que ya contempló "promover el switch de establecimiento al header de Inicio" como mitigación). Decidirlo mal obliga a rehacer el arranque de la app. Toca persistir `last_establishment_opened` por usuario.
**Próximo paso sugerido**: refinar en sesión dedicada (probable Gate 0 de contexto). Candidato a ajuste/extensión de spec 01 o nota en su design.md + posible actualización del shell de ADR-018. NO bloquea el design de la home actual: por ahora solo se implementa el **switch entre campos en el header** (reemplaza el hamburguesa); el switch además sirve de feedback de "en qué campo estás parado".

## 2026-05-30 — Stats reales de `EstablishmentCard` (hoy MOCK) + `last_establishment_opened` — backend

**Origen**: sesión 20, build del componente `EstablishmentCard` + preview "Mis campos" (frontend, spec 01 R6.6.2). La card ya está construida y vetada (ver `progress/impl_mis-campos-card.md`), pero alimentada con **mock data**.
**Qué**: la card consume hoy props con datos inventados. Necesitan venir del backend:
- **contadores**: `animalCount` (animales activos por establecimiento) + `rodeoCount` (rodeos por establecimiento).
- **métrica hero adaptativa**: `% de preñez` del último tacto (con período `mmm'aa`) · o `cabezas` + fecha de la última maniobra · o estado "vacío" (sin animales) → CTA. El cliente decide cuál mostrar según qué datos haya.
- **señal de atención** (ej. "tacto pendiente"): deriva de reglas de negocio del campo (tacto vencido, datos sin sincronizar).
- **`last_establishment_opened`** (R6.9, ya **requerido** en la spec): persistencia por usuario del último campo abierto + rastro de últimos visitados (alimenta orden de "Mis campos" R6.6.1, dropdown del switch R6.8.1, landing R6.7). El frontend del incremento 2 lo necesita.
**Por qué importa**: sin estas queries/rollup la card es una maqueta; con ellas es la pantalla de triage del vet multi-campo (pilar producto). Computar N campos en vivo en el landing no escala (ver entrada 2026-05-29 "Rollup de resumen por establecimiento" — misma raíz; este ítem es el corte concreto que la card destrabó).
**Próximo paso sugerido**: sub-tarea de la **terminal/backend** (otra terminal maneja supabase/). Definir la fuente de cada stat (query directa con pocos campos beta / rollup cacheado al escalar) + el almacenamiento de `last_establishment_opened` (columna por usuario o tabla de visitas). Frontend incremento 2 cablea la card a esos datos reemplazando los mocks de `app/app/mis-campos.tsx`.

## 2026-05-30 — Deuda de seguridad pre-existente: `soft_delete_event` omite `has_role_in` (L1)

**Origen**: sesión 20, Gate 1 (security modo spec) del delta Tier 1 de spec 02 (`progress/security_spec_02-modelo-animal.md`, anexo L1).
**Qué**: el RPC genérico `soft_delete_event` (`supabase/migrations/0041_soft_delete_rpcs.sql` ~l.110, **ya mergeado**) autoriza con `is_owner_of(v_est) or v_created_by = auth.uid()` — **omite** el `has_role_in(v_est)` que su hermano `soft_delete_animal_event` sí exige. Es la misma clase del finding SEC-SPEC-01 (autor cuyo rol fue desactivado sigue pudiendo borrar su evento). Quedó **fuera del alcance Tier 1** (no se reabre código ya cerrado en este fold), por eso se asienta acá.
**Por qué importa**: mismo-tenant authz: un usuario removido del establecimiento conserva la capacidad de soft-deletear los eventos que cargó. Bajo impacto (no cross-tenant, requiere haber tenido rol), pero inconsistente con el patrón canónico endurecido.
**Próximo paso sugerido**: al tocar `0041` o en un barrido de hardening, agregar `has_role_in(v_est) and (...)` a la guarda de `soft_delete_event` + test de no-bypass del autor-sin-rol (espejo de T2.18/T2.19). No urgente; no MVP-blocker.
