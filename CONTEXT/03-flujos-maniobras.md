# 03 — Flujos de Trabajo: MODO MANIOBRAS

## El concepto central del producto

**MODO MANIOBRAS** es el modo de trabajo guiado que el usuario activa al empezar una jornada de manga. Es el corazón operativo de la app — donde se carga el 90% de los datos del día.

## Cómo funciona

**Configuración inicial (una vez por jornada):**
1. Usuario activa MODO MANIOBRAS
2. Elige qué maniobras va a hacer hoy (puede ser una o varias combinadas)
3. Algunas maniobras requieren configuración previa (qué vacuna, qué pajuelas, etc.)
4. Puede guardar combinaciones como **presets** para usos futuros

**Operación (por cada animal):**
1. Usuario escanea TAG con bastón Bluetooth o tipea IDV manualmente
2. La app abre un wizard con las maniobras configuradas
3. Cada maniobra se presenta en su propia pantalla con botones grandes
4. Al terminar, aparece **pantalla de resumen** con todo lo cargado
5. Usuario confirma y pasa al siguiente animal, o corrige tocando una maniobra del resumen

## Diseño de UI (decisión cerrada)

**Pantallas secuenciales + pantalla de resumen final**.

Razones:
- El operador trabaja con una sola mano libre la mayor parte del tiempo
- Las manos pueden estar mojadas, con barro, o con guante
- Una pantalla con una decisión = touch targets enormes, sin posibilidad de mistap
- El resumen final permite verificar antes de commit

Cada pantalla cumple:
- Botones de mínimo 60px de alto (idealmente 80px)
- Fuentes 18-24px en botones
- Alto contraste para legibilidad en sol fuerte
- Confirmación táctil (vibración corta) al tocar
- Bordes generosos entre botones

**Datos se guardan a medida que avanza el wizard**, no al final. Si se queda sin batería o se crashea, lo cargado no se pierde. El resumen es de verificación, no de commit.

## Las 10 maniobras del MVP

### 1. Sangrado
**UI**: input de número de tubo + botones [SALTAR] / [CONTINUAR]
**Pre-config**: no
**Cargador**: cualquier rol
**Notas**: el número de tubo se vincula al animal escaneado. Después llega el resultado del laboratorio y se vincula automáticamente.

### 2. Tacto (vacas)
**UI**: [PREÑADA] / [VACÍA]. Si preñada: [CABEZA] / [CUERPO] / [COLA]
**Pre-config**: no
**Cargador**: cualquier rol (no requiere ser veterinario)
**Notas**: "cabeza/cuerpo/cola" equivale a "grande/mediana/chica" — son dos formas de decir lo mismo según el campo.

### 3. Tacto de vaquillona (pre-servicio)
**UI**: [APTA] / [NO APTA] / [DIFERIDA]
**Pre-config**: no
**Cargador**: cualquier rol
**Notas**: importante hacer pesaje en este momento. Vaquillonas deben tener 66% del peso adulto antes de su primer servicio. Pesaje no es parte de esta maniobra pero la app sugiere activarlo al configurar.

### 4. Vacunación
**UI**: aplicación silenciosa, aparece ✓ inline en el wizard
**Pre-config**: SÍ — elegir vacuna(s) antes de empezar. Puede elegir varias (ej: aftosa + brucelosis aplicadas simultáneamente)
**Cargador**: cualquier rol
**Notas**: cada vaca escaneada queda registrada con fecha actual y vacuna(s) configurada(s).

### 5. Inseminación
**UI**:
- Si pre-config tiene 1 pajuela: popup informativo no interactivo, queda registrado
- Si pre-config tiene varias: selector [Pajuela A] / [Pajuela B] / [Pajuela C]
**Pre-config**: SÍ — elegir pajuela(s)
**Cargador**: cualquier rol
**Notas**: en MVP NO se modela stock de pajuelas, solo nombres. Stock como módulo futuro.

### 6. Condición corporal
**UI**: selector 1.00 → 5.00 con incrementos de 0.25 (1.00, 1.25, 1.50, ..., 5.00)
**Pre-config**: no
**Cargador**: cualquier rol
**Notas**: evento con historial (te interesa la evolución del animal en el tiempo).

### 7. Dientes
**UI**: selector con opciones [2d] [4d] [6d] [Boca llena] [3/4] [1/2] [1/4] [Sin dientes]
**Pre-config**: no
**Cargador**: cualquier rol
**Notas**:
- Es **propiedad del animal**, no evento con historial. Se sobrescribe al actualizar (te interesa el estado actual, no la evolución).
- **Prompt automático CUT**: si se carga 1/2, 1/4 o sin dientes, la app pregunta "¿marcar como CUT?". Si sí → categoría pasa a CUT.
- No mostrar para terneros (no tiene sentido).

### 8. Pesaje
**UI**: input numérico (manual) o lectura automática si hay balanza Bluetooth conectada
**Pre-config**: no
**Cargador**: cualquier rol
**Notas**: pesaje accesible para todos los roles. Mismo flujo para adulto o ternero.

### 9. Raspado de toros
**UI**: 2 inputs de número de tubo (uno tricomoniasis, uno campylobacteriosis)
**Pre-config**: no
**Cargador**: cualquier rol
**Notas**: resultado llega del laboratorio días después. Se vincula automáticamente vía import de Excel/PDF del lab.

### 10. Pesaje de ternero
**UI**: igual que pesaje normal
**Pre-config**: no
**Cargador**: cualquier rol
**Notas**: queda como maniobra distinta solo para que la app autocomplete la categoría "ternero" en el animal. Pendiente confirmar con vet socio si hay otras diferencias (ej: vincular con la madre).

## Tratamientos (futuro cercano)

Antibióticos, antiparasitarios, suplementos vitamínicos y minerales también funcionan como maniobras silenciosas estilo vacunación. Pre-config el producto, aplicación silenciosa por animal.

Comentario en producto:
- Antibiótico/antiparasitario: opcional
- Suplemento: obligatorio

## Presets

El usuario puede guardar combinaciones frecuentes de maniobras como "presets" para no tildar la misma combinación todos los días. Ejemplos:

- Preset "Tacto general primavera": Tacto + Pesaje + Condición corporal
- Preset "Sangrado anual": Sangrado + Vacuna brucelosis
- Preset "Vaquillonas pre-servicio": Tacto vaquillona + Pesaje + Condición corporal

Los presets se crean tildando maniobras y guardando con un nombre. Al iniciar MODO MANIOBRAS aparecen los presets en el tope como acceso rápido.

## Validaciones cruzadas (analítica de la app)

Al cargar un parto, la app puede mirar el último tacto de la vaca y verificar si el tamaño de preñez predicho (cabeza/cuerpo/cola) era consistente con la fecha real de parto. Esto sirve para:
- Detectar errores de tacto
- Evaluar la precisión del veterinario en su portfolio
- Mejorar planificación a futuro

## Lotes

"Lote" en el contexto del trabajo cotidiano no es un terreno físico — es una etiqueta libre que el productor le pone a un grupo de animales para organizar su jornada (ej: "Lote A12", "Vacas Las Marías", "Lote venta noviembre").

En la app se modela como (ADR-020, tabla `management_groups`):
- Tabla `management_groups` (scope establishment, nombres libres del productor, sin presets) — **NO** "texto libre en la sesión".
- `animal_profiles.management_group_id` (FK nullable): asignación exclusiva (un lote a la vez), manual, sin historial en MVP.
- Regla de display: agrupar por lote si el animal tiene `management_group_id`, si no por categoría.
- La sesión de maniobras **no** lleva el lote como FK asignadora — el lote es per-animal (ver `specs/active/03-modo-maniobras/context.md`).
- NO se modelan terrenos físicos, ubicaciones, ni movimientos físicos entre lotes.
