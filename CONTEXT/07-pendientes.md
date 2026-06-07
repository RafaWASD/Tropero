# 07 — Pendientes y Preguntas Abiertas

Esta lista se mantiene viva. Cada item se cierra cuando se valida con el vet socio, con clientes reales, o con investigación adicional.

## Bloqueantes para implementación

Ninguno actualmente. Las decisiones cerradas alcanzan para empezar specs y código.

## A validar con el vet socio

> **🟢 RESUELTO en gran parte (sesión Facundo 2026-06-03)** — ver
> `specs/active/02-modelo-animal/dominio-categorias-facundo-2026-06-03.md`. Cerrados ahí: máquina de
> estados de categorías completa (novillito/novillo, castración, 2 años, destete como disparador),
> aborto (revierte + flag), destete → cría al pie en la madre, etiquetas de tacto (cabeza/cuerpo/cola),
> servicio (natural sin toro / IA-TE con pajuela), validación tacto↔parto (sí), pesaje de ternero (igual
> que el normal), **datos por categoría** (la tabla del alta guiada) y las **fórmulas de analytics**
> (% preñez / % destete / % cabeza-cuerpo-cola en tacto y destete). Los ítems de abajo que ya están
> cubiertos por ese doc se mantienen por trazabilidad pero quedan **CERRADOS**.

### 🟡 ABIERTO — Circunferencia escrotal (CE): modelado a refinar con Facundo (2026-06-05)
Facundo confirmó que la CE importa **sobre todo en toritos** (y toros) y que **se mide en 3 momentos distintos** para ver la progresión. Antes de modelarla hay que cerrar el detalle con él: **¿cuáles son esos 3 momentos** (¿edades/eventos fijos? ¿libre?)?, **¿qué rango/unidad** (cm) y qué valor es "apto" reproductivo?, **¿dato suelto con historial** (tabla `scrotal_circumference_events` estilo `weight_events`) **o atado a una maniobra**? Por eso quedó **DIFERIDA del chunk de la alta guiada** (Raf, 2026-06-05): la alta guiada se hace frontend-puro con los datos que YA existen (`teeth_state`, `is_cut`, peso, condición, pelaje, raza, lote, tamaño de preñez, `nursing`); la CE entra como follow-up chico (tabla nueva + campo en el wizard de toritos/toros) tras validar el detalle.

### 🟡 ABIERTO — Categoría genérica "Vaca" en el import masivo (2026-06-07)
El catálogo de cría (`categories_by_system`, seed `0015`) **no tiene un code `vaca` genérico**: parte "vaca" en `multipara` (Multípara), `vaca_segundo_servicio` y `vaca_cabana`. Pero el productor en su planilla escribe **"Vaca" a secas** (el término más común). Al importar, "Vaca" no matchea ningún `code` → el RPC `import_rodeo_bulk` cae al placeholder por sexo → la hembra entra como **vaquillona** (aunque tenga 6 años y diga "Vaca"). "Toro" sí entra bien porque el code `toro` existe. **Decisión de Raf (2026-06-07):** por ahora **avisar** en el preview qué categorías declaradas no están en el catálogo (van a quedar "a completar") — implementado client-side, sin adivinar el dominio. **Pendiente con Facundo (D3 de spec 12):** ¿qué hace una "Vaca" genérica declarada? Opciones a decidir: (a) agregar una categoría genérica "Vaca" al catálogo (¿conviene un bucket genérico junto a las granulares, o ensucia el benchmarking?), (b) tabla de sinónimos "Vaca"→Multípara (u otra) — ¿a cuál mapea cada término genérico?, (c) dejar el placeholder por sexo avisado. Relacionado: el RPC matchea solo por `code` exacto, no por `name` ni sinónimos (la spec 12 R10.3 anticipaba match por code/name + sinónimos TENTATIVOS).

### Pesaje de ternero
¿Hay alguna diferencia operativa real vs pesaje de adulto, más allá de la categoría que se autocompleta?
- ¿Se vincula con la madre automáticamente?
- ¿Se registra el peso al pie (mientras lacta) como dato distinto al peso al destete?

### Pricing concreto
¿Los números 5/20/20 USD/mes (vet base / vet pro / productor por campo) son los correctos para el mercado argentino?
- Validar con su intuición de mercado UNLP/Chascomús
- Validar con productores conocidos durante el beta

### Modelo de campos temporales del vet
La idea de "5 campos temporales que duran 1 semana" para el plan Vet Base.
- ¿Funciona en la realidad del trabajo del vet rural?
- ¿1 semana es el tiempo correcto o debería ser más/menos?
- ¿5 campos simultáneos es realista o quedan cortos?

### Categorías y transiciones
Confirmar que estas transiciones automáticas cubren todos los casos reales:
- Vaquillona → Vaquillona preñada: al registrar tacto positivo
- Vaquillona preñada → Vaca segundo servicio: al registrar parto
- Vaca segundo servicio → Multípara: al registrar segundo parto

¿Hay casos edge que rompan estas reglas? Ej: aborto, vaca comprada como multípara sin historial en el sistema.

### Validación tacto vs parto
¿Vale la pena implementar la validación cruzada que detecta inconsistencia entre el tamaño de preñez predicho (cabeza/cuerpo/cola) y la fecha real de parto? ¿Es feature útil para el vet o ruido?

### Eventos reproductivos y de categoría (surgidos en el refinamiento sesión 18)
Consolidados acá para llevar a la próxima charla con Facundo. No bloquean el resto del refinamiento, pero cierran el detalle fino de specs 02/03/08.
- **Aborto → categoría destino**: una vaca/vaquillona preñada que aborta, ¿a qué categoría vuelve? (¿`vaca`/vacía? ¿`vaquillona` si era vaquillona preñada?). La decisión (sesión 18) es que el aborto **revierte** la categoría y `compute_category` deja de contarla como preñez; falta el mapeo exacto.
- **Castración → efecto de categoría**: en cría **no existe la categoría "novillo"** (las categorías de cría son ternero/ternera/vaquillona/.../torito/toro). Si la castración va a ser maniobra de manga + operación masiva por rodeo, ¿qué pasa con la categoría del macho castrado? Opciones: (a) agregar categoría `novillo` a cría, (b) castración = solo evento sanitario sin cambio de categoría en cría, (c) el novillo "se va" a invernada (post-MVP). Definir con Facundo.
- **Destete → ¿marca algo en la madre?**: la decisión (sesión 18) pone el evento de destete en la ficha del **ternero** (transiciona su categoría, R7.8). ¿Conviene además registrar algo en la **madre** (fin de lactancia / disponible para próximo servicio), o se deriva? Definir con Facundo.
- **Razas para el catálogo SENASA (feature 08)**: lista de razas realmente usadas en la zona para sembrar el catálogo controlado de razas con su código SENASA (H/AA/HA/B/BG/BF/...). Hoy `breed` es texto libre; 08 lo vuelve catálogo. Validar el listado relevante con Facundo.

## A investigar técnicamente

### Formato de laboratorios
Sabemos que CEDIVE Chascomús tiene su formato. La Red Nacional de Laboratorios del SENASA tiene muchos labs (LR0008, LR0160, LR0182, Rosenbusch, etc.) cada uno con su formato.

- Investigar si existe un formato estándar SIGLAB (donde los labs cargan oficialmente al SENASA)
- Empezar con parser CEDIVE específicamente
- Diseñar arquitectura de parsers para que sumar nuevos formatos sea agregar archivos, no refactorizar

### Transporte del Allflex RS420 — 🟢 RESUELTO (ADR-024, feature 04)
El RS420 **NO es BLE GATT**: es Bluetooth Classic SPP + iAP/MFi (perfil propietario Apple). El
diseño BLE original de spec 04 / ADR-002 no aplica al transporte real. ADR-024 fija el **contrato de
ingesta agnóstico del transporte** + 5 adapters (manual, mock, web-serial, spp-android, hid-wedge). El
TAG sigue siendo ISO 11784/11785 FDX-B (15 díg, prefijo 982/032-Argentina); `parser-rs420.ts` +
`isValidTag` son insumo firme independiente del transporte. La capa buildable-hoy está implementada y
gateada (`app/src/services/ble/`, commit feature 04). Lo que sigue depende de **hardware** (ver abajo).

### Formato exacto del mensaje del Vesta 3516
- Día de campo: ver qué string emite por Pin 3 TX al pesar un animal
- Implementar parser robusto

### Exportación a SIGSA/SIGBIOTRAZA
Investigar el formato exacto de archivo que aceptan estos sistemas:
- SIGSA: sistema principal para gestión de sanidad animal
- SIGBIOTRAZA: app móvil de SENASA para declarar identificaciones electrónicas
- SIGSA App Actas: para registro de actas de vacunación

Si podemos exportar archivos importables en estos sistemas, eso es feature diferencial frente a Control Ganadero.

### Soft-delete vía RPC vs UPDATE (surgido al implementar spec 02 backend)
PostgREST rechaza un soft-delete por `UPDATE deleted_at` cuando la policy de SELECT de la tabla filtra `deleted_at is null` sobre la propia fila (exige que la fila siga visible tras el UPDATE; pasa aun con `Prefer: return=minimal`). Afecta a `rodeos`, `management_groups`, `animal_events` y los 5 eventos tipados de spec 02. Se resolvió con funciones SECURITY DEFINER (`soft_delete_*`, migration `0041`) que re-validan la misma autorización y hacen el UPDATE por dentro — preservando R12.3 (lecturas normales no retornan soft-deleted).
- **Pendiente para Raf/reviewer**: confirmar el enfoque. Cambia el contrato de soft-delete de "UPDATE columna" a "RPC", lo que **impacta la estrategia offline de PowerSync (Fase 5 de spec 02)**: un soft-delete offline ya no es un simple update local sincronizable; hay que decidir cómo encolar/reconciliar la RPC (o, alternativamente, relajar la policy de SELECT y filtrar `deleted_at` en el cliente, o un split de policies). Reversible. Detalle en `progress/impl_02-modelo-animal.md` § Desviaciones.

## Hardware día de campo

> **Pruebas pendientes de hardware** (juntar todas para una misma tanda):
- **🔵 Bastón RS420 en `pnpm web`** — pantalla de test ya construida y commiteada (`9dd2ed0`, ruta `/baston-test`). Probar: parear RS420 a Windows (COM virtual SPP) → `pnpm.cmd web` en Chrome/Edge → `localhost:8081/baston-test` → "Conectar" → bastonear → ver el EID de 15 díg entrando en vivo. Valida `adapter-web-serial` + parser + dedup end-to-end. Riesgo único: si un firmware nuevo cambió la trama, el EID no parsea → recapturar protocolo.
- Comprar multímetro nuevo (el DT-830B actual está roto)
- Sacar bloque loopback del código antes del día de campo
- Validar lectura del Pin 3 (TX) del Vesta cuando pesa un animal
- Si Vesta no saca datos por defecto: probar Plan B (Config → Lector → cable)

## Hardware del bastón (lector RFID) — pendiente para probar feature 04 end-to-end

Lo que Raf **tiene hoy**: el **Allflex RS420** + una **notebook con `pnpm web`**. Por eso la primera
prueba real es **web-serial** (Web Serial API, solo Chromium + secure context): enchufar el RS420 a la
notebook por su cable/COM y leer EIDs en vivo desde la pantalla de test web. Esto NO necesita celular ni
dev build.

Hardware/acciones a conseguir para cubrir los demás transportes (ADR-024):
- **Actualizar el firmware del RS420** (acción de Raf) — para descartar bugs viejos del lector antes del
  día de campo.
- **Celular Android de prueba** (comprar) — necesario para el adapter **SPP nativo** (`adapter-spp-android`,
  R6): requiere **dev build propio** (Expo Go SDK 56 no está en tiendas) + Bluetooth Classic SPP, que
  web no puede ejercitar.
- **Lector RFID barato con salida HID-keyboard** (comprar, mercado AR: tipo Montetech ME-BL01 / Smart
  LFID u similar) — para validar el adapter **HID-wedge** (`adapter-hid-wedge`, R8), el camino
  cross-platform abierto (el lector se presenta como teclado y "tipea" el EID). Sirve también como Plan B
  si el RS420 da problemas de pareo.
- **MFi-Allflex / lector MFi** (canal Facundo, "Pedido B") — para el camino iAP/MFi en iPhone, gateado
  por el gate físico de iPhone (R8). Depende de que Facundo gestione el pedido.

## Funcionalidades a priorizar después del MVP

Estas funcionalidades del vet son post-MVP, pero conviene tenerlas en cuenta para no contradecirlas en la arquitectura:

- Vista multi-cliente (un vet ve todos sus campos)
- Benchmarking anónimo entre campos
- Portfolio profesional exportable
- Agenda integrada de visitas
- Centralización de PDFs de laboratorio
- Protocolos sanitarios reutilizables
- Alertas cruzadas multi-campo
- **Detección automática de animales duplicados + merge guiado** — Red de seguridad para el caso de un animal cargado con solo ID visual al que después se le agrega caravana electrónica y se bastonea (genera duplicado lógico). Detectar candidatos en background (mismo rodeo, uno con solo visual + otro con solo electrónica, ventana de tiempo cercana) y ofrecer merge no automático. En MVP se cubre con dos flujos manuales: (A) búsqueda intermedia previa al alta cuando se bastonea algo sin match, y (B) flujo dedicado de "asignación masiva de caravanas" cuando llega un lote de caravanas nuevas. Ver memoria `product_feature_buscar_animal` para el contexto completo de la decisión.

## Anti-fraude

¿Cómo prevenimos que un dueño con 3 campos físicos los cargue todos como un solo establecimiento para pagar un solo plan?

Mecanismos a explorar (post-MVP):
- Validación opcional con CUIT y RENSPA
- Límites de animales por establecimiento (umbral alto)
- Análisis de patrones (heterogeneidad de lotes, geolocalización)
- Auditoría manual en casos sospechosos

## UI/UX por decidir

- Library de componentes (Tamagui vs NativeWind vs custom)
- Sistema de diseño (paleta, tipografía, espaciados)
- Modo oscuro (probablemente necesario para uso al sol)
- Wireframes y mockups de pantallas clave (manga, dashboard, ficha animal)

## Decisiones de negocio a tomar más adelante

- Estrategia exacta de pricing al salir del beta
- Política de planes anuales con descuento
- Estrategia de marketing y go-to-market
- Modelo de soporte (chat, email, presencial en CABA/Chascomús)
- Integraciones con otros sistemas (cabaña genética, frigoríficos, financieras)
