# 07 — Pendientes y Preguntas Abiertas

Esta lista se mantiene viva. Cada item se cierra cuando se valida con el vet socio, con clientes reales, o con investigación adicional.

## Bloqueantes para implementación

Ninguno actualmente. Las decisiones cerradas alcanzan para empezar specs y código.

## A validar con el vet socio (Joaquín / amigo de Raf)

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

## A investigar técnicamente

### Formato de laboratorios
Sabemos que CEDIVE Chascomús tiene su formato. La Red Nacional de Laboratorios del SENASA tiene muchos labs (LR0008, LR0160, LR0182, Rosenbusch, etc.) cada uno con su formato.

- Investigar si existe un formato estándar SIGLAB (donde los labs cargan oficialmente al SENASA)
- Empezar con parser CEDIVE específicamente
- Diseñar arquitectura de parsers para que sumar nuevos formatos sea agregar archivos, no refactorizar

### Protocolo BLE del Allflex RS420
- Escanear con nRF Connect el día del campo
- Identificar service y characteristic UUIDs
- Documentar formato del mensaje cuando lee TAG

### Formato exacto del mensaje del Vesta 3516
- Día de campo: ver qué string emite por Pin 3 TX al pesar un animal
- Implementar parser robusto

### Exportación a SIGSA/SIGBIOTRAZA
Investigar el formato exacto de archivo que aceptan estos sistemas:
- SIGSA: sistema principal para gestión de sanidad animal
- SIGBIOTRAZA: app móvil de SENASA para declarar identificaciones electrónicas
- SIGSA App Actas: para registro de actas de vacunación

Si podemos exportar archivos importables en estos sistemas, eso es feature diferencial frente a Control Ganadero.

## Hardware día de campo

- Comprar multímetro nuevo (el DT-830B actual está roto)
- Sacar bloque loopback del código antes del día de campo
- Validar lectura del Pin 3 (TX) del Vesta cuando pesa un animal
- Si Vesta no saca datos por defecto: probar Plan B (Config → Lector → cable)

## Funcionalidades a priorizar después del MVP

Estas funcionalidades del vet son post-MVP, pero conviene tenerlas en cuenta para no contradecirlas en la arquitectura:

- Vista multi-cliente (un vet ve todos sus campos)
- Benchmarking anónimo entre campos
- Portfolio profesional exportable
- Agenda integrada de visitas
- Centralización de PDFs de laboratorio
- Protocolos sanitarios reutilizables
- Alertas cruzadas multi-campo

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
