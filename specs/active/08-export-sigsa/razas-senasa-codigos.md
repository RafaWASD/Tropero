# Códigos de raza SENASA/SIGSA — tabla completa (sub-tarea pre-spec de 08)

> **Estado**: research CERRADO. Insumo firme para el catálogo controlado de razas (decisión 1 del `context.md` de 08) y para el mapeo de raza del importador (feature 12).
> **Fecha**: 2026-06-01 (sesión 22, terminal secundaria). **Método**: `pdftotext -layout` sobre el manual oficial + verificación directa del leader.
> **Confianza global**: ALTA. El pairing código↔nombre se extrajo de la fuente primaria oficial y se verificó a mano (línea por línea, `-layout`).

## TL;DR

- La tabla oficial tiene **32 códigos de raza** (28 bovinas + 3 bubalinas + `S/E` genérico). Es una **lista cerrada**.
- El caveat previo ("el manual es un PDF de imágenes, no extraíble") **era incorrecto**: el PDF v2.42.80 tiene **capa de texto**. `WebFetch` no la lee (stream comprimido), pero `pdftotext` la extrae sin OCR. **No hace falta login a SIGSA ni contacto con SENASA para esta tabla.**
- Las 8 razas que el research s16 había confirmado parcialmente (H, AA, HA, B, BG, BF, OR, S/E) coinciden **100%** con la tabla completa → cross-check OK.

## ⚠️ OJO: SIGSA tiene DOS catálogos de raza distintos — no mezclar

Verificado en **sesión 25 (2026-06-13)** a raíz de una foto que Facundo sacó del sistema vivo. SIGSA usa **dos sets de códigos de raza diferentes según el flujo**:

1. **Declaración de dispositivos RFID** (lo que genera la feature 08 — el TXT de alta) → usa los códigos de **ESTE documento** (Tabla 1 de abajo): `AA` Aberdeen Angus, `B` Brahman, `HA` Holando, `J` Jersey, `CR` Criolla, `FS` Simmental, `SI` San Ignacio… **Re-verificado directo del PDF oficial** con `pdftotext -layout` (s25); el ejemplo literal del manual usa `-H-`, `-AA-`, `-B-`. **Esta es la tabla autoritativa para el export.**

2. **Nuevo movimiento / DT-e / TRI** (mover o vender animales — **FUERA de scope de 08**) → el picker del sistema vivo usa códigos "amigables" distintos: `A` Angus, `BR` Brahman, `HO` Holando, `JE` Jersey, `C` Criolla, `SI` **Simmental**. Incluye razas que NO están en la tabla de dispositivos (Piamontesa, Normando, Pardo Suizo, Guzerat, Nelore). Fuente: foto de Facundo del sistema vivo (s25), no transcripta entera.

**Trampa peligrosa — el código `SI`**: en el flujo de dispositivos (Tabla 1) `SI` = **San Ignacio**; en el flujo de movimiento `SI` = **Simmental**. Usar los códigos del picker de movimiento en el TXT de dispositivos **mis-declararía la raza**. El export de 08 usa SIEMPRE la Tabla 1 de abajo.

> **Para el GATE DURO de formato (08)**: cuando se haga el upload real, sacar la tabla de razas desde la pantalla de **declaración de dispositivos**, NO desde la de movimiento.

## Fuente primaria

Manual oficial SENASA: **"Declaración de dispositivos de identificación RFID"**, versión SIGSA **2.42.80** (diciembre 2025), sección *"CÓDIGOS DE LAS RAZAS BOVINAS, BUBALINAS Y CÉRVIDOS"* (págs. 8-9 del PDF; el research s16 las citó como 7-8).
URL: https://www.argentina.gob.ar/sites/default/files/2026/01/declaracion_de_dispositivos_de_identificacion_electronicos_en_sigsa_.pdf

**Reproducción del cómo**: descargar el PDF y correr `pdftotext -layout -f 6 -l 9 <archivo>.pdf -` (poppler). La sección de códigos sale con el nombre y el código en la misma línea → pairing inequívoco.

## Formato del archivo TXT (confirmado, cita del manual)

Registro: `DISPOSITIVO-SEXO-RAZA-FECHANACIMIENTO`. Campos separados por **guion del medio** `-`; dispositivos separados por **punto y coma** `;`.

Ejemplo literal del manual: `032010000000000-M-H-08/2025;032010000000001-H-AA-08/2025;032010000000002-M-B-08/2025`

- `DISPOSITIVO` (RFID): 15 dígitos numéricos.
- `SEXO`: **`M`** (macho) / **`H`** (hembra).
- `RAZA`: código de la tabla de abajo.
- `FECHANACIMIENTO`: `MM/AAAA`.

> **Gotcha de parsing**: la letra `H` es ambigua — en posición SEXO = Hembra, en posición RAZA = Hereford. Lo desambigua **la posición**, no el valor. El parser del importador (feature 12) debe respetar el orden posicional, no buscar `H` por contenido.

## Tabla 1 — Códigos de raza individual (esto es lo que va en el TXT)

Orden tal cual el manual. Grafías **literales del manual** (respetarlas: SIGSA valida contra estos códigos exactos).

| Código | Raza (grafía del manual) | Especie | Confianza |
|---|---|---|---|
| HA | Holando Argentino | Bovino | CONFIRMADO |
| PH | Polled Hereford | Bovino | CONFIRMADO |
| J | Jersey | Bovino | CONFIRMADO |
| LA | Limangus | Bovino | CONFIRMADO |
| FS | Simmental | Bovino | CONFIRMADO |
| SG | Santa Gertrudis | Bovino | CONFIRMADO |
| OR | Otra Raza | Bovino | CONFIRMADO |
| L | Limousine | Bovino | CONFIRMADO |
| K | Kiwi | Bovino | CONFIRMADO |
| BO | Bosmara *(raza real: Bonsmara; grafía del manual)* | Bovino | CONFIRMADO |
| SRB | Sueca Roja y Blanca | Bovino | CONFIRMADO |
| SA | Senangus | Bovino | CONFIRMADO |
| B | Brahman | Bovino | CONFIRMADO |
| SH | Shorthorn | Bovino | CONFIRMADO |
| SP | Senepol | Bovino | CONFIRMADO |
| TL | Tuli | Bovino | CONFIRMADO |
| SI | San Ignacio | Bovino | CONFIRMADO |
| GC | Ganado Cruza | Bovino | CONFIRMADO |
| H | Hereford | Bovino | CONFIRMADO |
| W | Wagyu | Bovino | CONFIRMADO |
| SF | Seneford | Bovino | CONFIRMADO |
| CH | Charolais | Bovino | CONFIRMADO |
| AA | Aberdeen Angus | Bovino | CONFIRMADO |
| BG | Brangus | Bovino | CONFIRMADO |
| BF | Braford | Bovino | CONFIRMADO |
| CR | Criolla | Bovino | CONFIRMADO |
| MG | Murray Grey | Bovino | CONFIRMADO |
| G | Galloway | Bovino | CONFIRMADO |
| ME | Mediterranea | Bubalino | CONFIRMADO (código/nombre); especie por dominio |
| JA | Jafarabadi | Bubalino | CONFIRMADO (código/nombre); especie por dominio |
| MU | Murrah | Bubalino | CONFIRMADO (código/nombre); especie por dominio |
| S/E | Sin Especificar | genérico | CONFIRMADO |

**Notas de rigor:**
- El pairing **código↔nombre** de las 32 filas: CONFIRMADO (verificado a mano sobre `pdftotext -layout`, mismo renglón).
- La columna **ESPECIE** del PDF sale desalineada en la extracción (columna aparte). El split bovino/bubalino igual es claro: las únicas 3 razas no bovinas son razas de **búfalo** conocidas (Mediterranea, Jafarabadi, Murrah). Las otras 28 son bovinas. → la especie de esas 3 está marcada "por dominio" más que por alineación limpia del PDF; no afecta el MVP (bovino).
- No hay un "sin especificar" propio de bovinos en esta tabla: para un bovino sin raza conocida el fallback es **`OR` (Otra Raza)**; `S/E` es el genérico de cierre de la tabla.
- El manual tiene un typo en su propio ejemplo en una versión de la extracción (`...-AA8/2025`); el formato correcto es `MM/AAAA` (`08/2025`).

## Relevante para el MVP de RAFAQ (cría bovina)

Las 28 bovinas son el universo. Las que probablemente toquen al beta de Chascomús / zona pampeana (validar con Facundo el subconjunto real): **AA** (Aberdeen Angus), **H/PH** (Hereford / Polled Hereford), **BG** (Brangus), **BF** (Braford), **SH** (Shorthorn), **CH** (Charolais), **L** (Limousine), **LA** (Limangus), **HA** (Holando Argentino, si hay tambo), **CR** (Criolla), **GC** (Ganado Cruza), con **OR** (Otra Raza) de fallback. El catálogo se siembra con las 28; el subset "relevante" es solo para priorizar el picker (default/orden), no para recortar el enum.

## Códigos de sexo (confirmado)

| Código | Sexo |
|---|---|
| M | Macho (`male`) |
| H | Hembra (`female`) |

## Tabla 2 — Códigos de TIPO / grupo racial (DDJJ de existencias) — NO confundir

Estos NO van en el TXT de dispositivos. Son los grupos raciales de la **declaración de existencias** (stock), un sistema distinto. Se documentan solo para evitar que alguien los mezcle con la Tabla 1.

| Código | Tipo/grupo | Confianza |
|---|---|---|
| BR | Británicos | TENTATIVO (no verificado contra fuente primaria) |
| BX | Cruza Británicos | TENTATIVO |
| CB | Cebuinos | TENTATIVO |
| CX | Cruza Cebuinos | TENTATIVO |
| CO | Continental | TENTATIVO |
| LE | Lecheros | TENTATIVO |
| BU | Bubalinos | TENTATIVO |
| CE | Cérvidos | TENTATIVO |

Si en algún momento se necesitan en firme: salen del manual de DDJJ de existencias de SIGSA (documento aparte), extraíble con el mismo `pdftotext`.

## Implicancias para las features

- **Feature 08 (export SIGSA)**: cierra la sub-tarea pre-spec "extraer la tabla de razas". El catálogo controlado (decisión 1 de 08) se siembra con las **28 razas bovinas** (código→nombre), grafías literales. El export mapea `animal_profiles.breed (catálogo) → código` 1:1. Fallback bovino = `OR`.
- **Feature 12 (importador)**: el mapeo de raza usa el mismo catálogo. La fuente **TXT de SIGSA** trae el código directo (parse posicional). La fuente **CSV** trae texto libre → match best-effort al catálogo (por nombre/sinónimos), sin match → `OR`/`a completar`.
- **Delta de modelo (spec 02)**: `animal_profiles.breed` texto libre → referencia al catálogo + migración best-effort de los textos existentes (ya anotado en el `context.md` de 08). El seed de este catálogo es esta tabla.

## Pendiente (no bloqueante)
- **Validar con Facundo** el subconjunto de razas realmente usadas en la zona (para ordenar/defaultear el picker, no para recortar el enum). Ya en CONTEXT/07.
- **Especie de las 3 bubalinas**: confirmada por dominio, no por alineación limpia del PDF. Irrelevante para el MVP bovino; chequear si alguna vez se habilita bubalino.
