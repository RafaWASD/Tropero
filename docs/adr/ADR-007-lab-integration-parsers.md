# ADR-007 — Integración de Laboratorios vía Parsers Configurables

**Status**: Accepted
**Fecha**: 2026-05
**Decisores**: Raf

## Contexto

En Argentina los análisis de laboratorio agropecuarios (brucelosis, tricomoniasis, campylobacteriosis, etc.) los emiten una red de laboratorios habilitados por SENASA: CEDIVE Chascomús (LR0182), Laboratorio de Resistencia (LR0008), Análisis Clínicos (LR0160), Rosenbusch, y decenas más.

**Cada laboratorio emite resultados en su propio formato**:
- Algunos en PDF imprimible (con tablas que hay que parsear)
- Otros en Excel (con headers no estandarizados)
- Algunos digitales vía SIGLAB (sistema SENASA donde labs cargan oficialmente)
- Otros directamente en papel

**No existe un formato estándar entre laboratorios**. Tratar de construir un parser único que entienda "todo" es imposible. Tratar de obligar a los labs a un formato unificado es fuera de scope.

Sin embargo, la vinculación de resultados es **funcionalidad crítica**: el productor saca sangre en manga (registra número de tubo), después de 1-2 semanas llega el archivo del lab, y la app debería automáticamente vincular cada resultado al animal correcto vía número de tubo.

## Decisión

**Arquitectura de parsers configurables, uno por proveedor de laboratorio**.

### Componentes

1. **Capa de parsers** (`/lib/lab-parsers/`)
   - Un archivo TypeScript por laboratorio (ej: `cedive.ts`, `rosenbusch.ts`)
   - Cada parser implementa interface común:
     ```ts
     interface LabParser {
       provider: string;
       canParse(file: File): boolean;
       parse(file: File): Promise<LabResult[]>;
     }
     ```
   - Output normalizado: `{ tube_number, animal_id?, sample_type, result, result_date }`

2. **Registry de parsers**
   - Lista de parsers disponibles
   - Detección automática por contenido del archivo
   - Selector manual si la detección automática falla

3. **Capa de matching**
   - Toma resultados normalizados y los vincula a `lab_samples` por `tube_number`
   - Resuelve conflictos (tubo duplicado, tubo no encontrado, etc.)

4. **UI de import**
   - Drag-and-drop o file picker
   - Preview de qué se va a importar
   - Reporte de éxitos/fallos por fila

### MVP: solo parser CEDIVE

Empezar con un solo parser concreto (CEDIVE Chascomús). Sumar más parsers a medida que entren campos con otros labs.

## Alternativas consideradas

### Parser único universal
- **Pros**: simplicidad inicial
- **Contras**: imposible mantener; formatos cambian; bug en parser afecta todos los labs

### Cargar resultados manualmente (sin import automático)
- **Pros**: cero código
- **Contras**: fricción inaceptable. Un campo de 500 animales con 500 tubos no se carga a mano.

### Forzar a labs a usar nuestro formato
- **Pros**: data limpia
- **Contras**: imposible (los labs no son clientes nuestros, no van a cambiar)

### Integrarse con SIGLAB de SENASA
- **Pros**: data oficial estandarizada
- **Contras**: SIGLAB no tiene API pública para consumir. Es flujo de upload de labs hacia SENASA, no de consulta.

### Plugin system con marketplace
- **Pros**: extensibilidad sin tocar core
- **Contras**: prematuro. YAGNI.

## Consecuencias

**Positivas**:
- Sumar nuevo lab = agregar un archivo TS, sin tocar el core
- Cada parser se puede testear aisladamente
- Si un lab cambia su formato, solo afecta ese parser
- Comunidad/clientes podrían contribuir parsers a futuro

**Negativas**:
- Si entra un campo con un lab nuevo, hay que escribir el parser antes que pueda importar
- Mantenimiento: si lab cambia formato, hay que actualizar el parser
- Duplicación de código entre parsers similares

**Mitigaciones**:
- Documentar contrato de parser claramente
- Tests con archivos reales de cada lab versionados
- Comunicar limitación al onboardar campo nuevo (qué labs soportamos, cuáles no)

**Notas de implementación**:
- Archivos de laboratorio se suben a Supabase Storage (queda histórico)
- Tabla `lab_imports` registra cada import con metadata (parser usado, errores)
- Tabla `lab_samples` registra los tubos al momento de sacar sangre (antes de tener resultado)
- El parser actualiza filas existentes de `lab_samples` con el resultado, o crea nuevas si no había sample registrada (caso de campos donde no se carga la sample en manga)
