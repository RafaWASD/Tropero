# Cattle App — Context Bundle

Este paquete contiene todo el contexto del proyecto antes de empezar a codear.

## Cómo usarlo

1. Crear tu repo local con la estructura de `harness-sdd`
2. `git init`
3. Descomprimir este ZIP en la raíz del repo
4. Primer commit:
   ```bash
   git add .
   git commit -m "Bootstrap: contexto inicial del proyecto"
   ```
5. Abrir Claude Code en el directorio:
   ```bash
   cd cattle-app
   claude
   ```
6. Decirle a Claude Code algo como:
   > Leé `CLAUDE.md` y después la carpeta `CONTEXT/`. Después armá el scaffold del proyecto Expo TypeScript siguiendo el stack definido. No empieces a codear features todavía, solo el scaffold inicial.

## Qué contiene

```
.
├── CLAUDE.md                  # Instrucciones de orientación para Claude Code
├── CONTEXT/                   # Background reading del proyecto
│   ├── 01-producto.md
│   ├── 02-modelo-negocio.md
│   ├── 03-flujos-maniobras.md
│   ├── 04-modelo-datos.md
│   ├── 05-hardware-vesta.md
│   ├── 06-stack-tecnologico.md
│   ├── 07-pendientes.md
│   └── 08-roadmap.md
└── docs/
    └── adr/                   # Architecture Decision Records
        ├── README.md
        ├── ADR-001-spec-driven-development.md
        ├── ADR-002-tech-stack.md
        ├── ADR-003-ble-nordic-uart.md
        ├── ADR-004-multi-tenancy-hierarchy.md
        ├── ADR-005-flexible-animal-identification.md
        ├── ADR-006-role-model.md
        ├── ADR-007-lab-integration-parsers.md
        ├── ADR-008-automatic-category-transitions.md
        ├── ADR-009-billing-deferred.md
        └── ADR-010-vesta-hardware-integration.md
```

## Diferencia entre `CONTEXT/` y `docs/adr/`

- **`CONTEXT/`** = decisiones de **producto** y background del negocio. "Qué construimos y por qué".
- **`docs/adr/`** = decisiones **arquitectónicas** y técnicas. "Cómo lo construimos y por qué".

Ambas son lectura recomendada antes de codear cualquier feature.

## Próximos pasos sugeridos

1. **Bootstrap del repo** con este bundle
2. **Scaffold del proyecto** (Expo + TS + Supabase config)
3. **Setup de Supabase** (proyecto creado, conectado al cliente)
4. **Primera spec**: `001-core-identidad-multitenancy` siguiendo modelo Kiro (requirements.md, design.md, tasks.md)
5. **Iterar**: spec → implementación → review → próxima spec

## Items pendientes para validar antes de specs específicas

Ver `CONTEXT/07-pendientes.md` para la lista actualizada.
