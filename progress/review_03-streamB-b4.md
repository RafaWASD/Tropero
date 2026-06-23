# Review - Spec 03 / Stream B / Chunk B4 (RPSC.1): alinear el espejo client-side de categoria

**Reviewer**: reviewer (subagente)  
**Fecha**: 2026-06-23  
**Feature**: 03-modo-maniobras - delta Stream B, chunk B4 (RPSC.1)  
**Tipo**: logica pura (TS) + tests. Frontend puro. Gate 1 N/A (design seccion 0). Gate 2 (code) lo evalua el leader (N/A - logica pura sin superficie de seguridad).  
**Ledger revisado**: progress/impl_03-streamB-b4.md

---

## Veredicto: APPROVED

El chunk B4 alinea el espejo client-side computeCategoryCode con compute_category server 0104 (ya deployado), cerrando el drift display-only vivo. El cambio es exactamente el prescrito en design 4.1/4.2/DD-PSC-7. El invariante anti-drift (RC6.5) se cumple, verificado linea por linea contra la migracion. check.mjs verde. Tests invertidos reales (no verde-falso). Cero usos colgados de hasService. MIRROR_EVENT_TYPES intacto. El boundary IA-write-path quedo correcto.

---

## Invariante anti-drift (RC6.5) - espejo igual a compute_category 0104

Verificado linea por linea computeCategoryCode (animal-category.ts) contra 0104_compute_category_drop_service.sql (server deployado):

| Caso clave | Server 0104 | Espejo computeCategoryCode | Match |
|---|---|---|---|
| ternera menor 1 ano + SOLO service -> ternera | lineas 115-118 (sin or v_has_service) | lineas 276-279 (sin termino hasService) | SI |
| destete/edad mayor-igual 365 -> vaquillona | linea 115 | linea 276 | SI |
| tacto+ vigente -> vaquillona_prenada | lineas 91-104, 113 | hasPositiveTactoVigente + linea 275 | SI |
| parto: mayor-igual 2 -> multipara; =1 -> vaca_segundo_servicio | lineas 109-112 | lineas 273-274 | SI |
| rama macho (cortes 2/1 ano + is_castrated) | lineas 68-82 | lineas 245-258 | SI (intacta, 0104 no la toco) |
| precedencia LOAD-BEARING | lineas 109-121 | lineas 273-280 | SI (mismo orden) |
| contrato de retorno | category_id uuid / MirrorCategoryCode | sin cambio | SI |

- hasService eliminado por completo: Grep en app/src devuelve solo comentarios nuevos (animal-category.ts:265,277). CERO usos colgados en codigo ejecutable.
- eventType service ya no se lee en computeCategoryCode, pero service sigue en MIRROR_EVENT_TYPES (ver RPSC.1.6).
- Header anti-drift (RC6.5.1) actualizado (animal-category.ts:7-13): la base es 0062; en lo que toca la rama vaquillona, el espejo refleja la reconciliacion de 0104. Fiel: 0104 es un diff quirurgico sobre 0062 que solo toca la rama vaquillona (la propia migracion lo dice). Las referencias residuales a 0062 (rama macho, conteo de partos, tacto+) son correctas porque 0104 no toco esas ramas. Sin contradiccion comentario/codigo/server.

## RPSC.1.6 - MIRROR_EVENT_TYPES NO se toco

local-reads.ts:936 sigue (birth,weaning,service,tacto,abortion) - verificado con Grep. El service se sigue trayendo del SQLite (timeline) y se usa en las queries (:949, :953); solo dejo de influir en el code computado. Correcto.

## Preview offline (R8.4 / RPSC.1.5) - no miente vs el server

- syntheticEventsForFemaleCategory(vaquillona) reconstruye con weaning (DD-PSC-7), no con service (maneuver-category-preview.ts:78-83,97-98). Verificado por el round-trip antidrift (maneuver-category-preview.test.ts:39-52): reconstruir vaquillona via weaning y pasarlo a computeCategoryCode da vaquillona. Si quedara service, el round-trip romperia.
- capturedReproEvents elimino la rama kind inseminacion -> service (maneuver-category-preview.ts:120-134). El tipo kind inseminacion sigue en StepValue (maneuver-sequence.ts:71), asi que el fixture INSEM es type-valid y el escaneo del mapa compila; solo el runtime dejo de inyectar el evento.
- Consistencia con el server confirmada: el write-path de la IA (maneuver-event-query.ts:159-164) SIGUE persistiendo service+ai (R6.5), pero compute_category 0104 ya no lo lee, asi que no transiciona categoria. Preview (display-only) igual al server (cero drift). El boundary preview-vs-write-path es correcto: B4 toco solo el preview; la IA sigue registrando la servida para Stream C (RPS.4.8, categoria distinta de elegibilidad).

## Tests reales, no verde-falso

Run aislado con el resolver de extensiones de check.mjs (--import ./scripts/ts-ext-resolver.mjs): 103 tests, 0 fail (83 animal-category + 20 preview). Aserciones invertidas que prueban el comportamiento NUEVO:
- ternera menor 1 ano + SOLO service (sin destete) -> ternera (animal-category.test.ts:265-267): si la rama hasService no se hubiera quitado, daria vaquillona. Prueba la eliminacion.
- ternera menor 1 ano + service + DESTETE -> vaquillona (:272-281): prueba que el disparador es el DESTETE, no el service (sin destete daria ternera).
- ternera + inseminacion (IA) -> null (maneuver-category-preview.test.ts:153-163): si capturedReproEvents no hubiera quitado la rama IA, daria vaquillona. Prueba la eliminacion.
- ternera + tacto+ Y inseminacion -> vaquillona_prenada (:169-179): defensa de regresion - quitar la rama IA NO rompio la extraccion del tacto.
- antidrift round-trip (:39-52): atrapa estructuralmente cualquier drift sintetico/espejo/server.

Nota sobre flake de invocacion (no es hallazgo): correr node --test directo sobre los .test.ts (sin --import ./scripts/ts-ext-resolver.mjs) da ERR_MODULE_NOT_FOUND por los imports sin extension. NO es regresion: es el patron conocido de invocacion. El oraculo valido es check.mjs (verde) y la corrida con el resolver (103/103).

---

## Trazabilidad RPSC.1.x con su test (lista completa)

| RPSC | Test concreto | OK |
|---|---|---|
| RPSC.1.1 (service no computa vaquillona) | animal-category.test.ts:265 ternera menor 1 ano + SOLO service -> ternera | SI |
| RPSC.1.2 (destete + edad siguen) | animal-category.test.ts:268,272 (vaquillona por edad + service; ternera+service+destete->vaquillona) + :303 (ternera+weaning) + :253 (mayor-igual 1 ano) | SI |
| RPSC.1.3 (ramas sin service sin cambio + precedencia + retorno) | animal-category.test.ts:282 (tacto+ + service -> vaquillona_prenada) + :437 (service+tacto+parto -> vaca_segundo_servicio) + :422 (tacto+ gana a destete/edad) | SI |
| RPSC.1.4 (suite invertida) | animal-category.test.ts:260-291 (bloque T2.23, 4 tests) | SI |
| RPSC.1.5 (preview no anticipa por IA) | maneuver-category-preview.test.ts:153,165,169 + round-trip :39 | SI |
| RPSC.1.6 (MIRROR_EVENT_TYPES intacto) | T-B4.9 (local-reads.ts:936 Grep) + ejercido por fixtures que leen service | SI |
| RPSC.1.7 (nota anti-drift actualizada) | No-unit (comentario); cubierto por lectura + round-trip antidrift | SI |
| RPSC.8.5 (check verde) | check.mjs exit 0 (Entorno listo) | SI |

Cada RPSC.1.x tiene al menos 1 test concreto. RPSC.1.7 es cambio de comentario (no unit-testeable), pero el round-trip antidrift garantiza estructuralmente que el comentario no miente respecto del codigo/server.

## Tasks completas: si (para el chunk B4)

T-B4.1 a T-B4.10 todas [x] en tasks-puesta-en-servicio-cliente.md (lineas 17-26). Las tasks [ ] restantes (B1/B2/B3/B-VERIF/T-REC) pertenecen a OTROS chunks de Stream B, fuera del alcance de B4 (DD-PSC-1: B4 primero, independiente). No bloquean este chunk. La revision es por-chunk (Gate 2 por chunk, design seccion 0).

## CHECKPOINTS

Aplicables a un chunk de logica pura display-only:
- [x] C2 - estado coherente (no flipea feature a done; el ledger documenta el tracking de estado de Stream B).
- [x] C3 - respeta arquitectura: utils puro, sin I/O, sin deps nuevas, sin logs sueltos, sin hardcode de establishment_id.
- [x] C4 - verificacion real: 103 tests verdes con fixtures reales (sin mocks de I/O), round-trip antidrift.
- [x] C6 - SDD: los 3 archivos de spec existen; requirements en EARS; tasks B4 [x]; cada RPSC.1.x con al menos 1 test.
- N/A C1, C5 (no es cierre de sesion/harness), C7 (no toca tablas/RLS), C8 (no toca offline write-path - display-only).

## Checklist RAFAQ-especifico

- A. Multi-tenancy / RLS - N/A. B4 es logica pura display-only, no toca tablas, RLS ni establishment_id.
- B. Offline-first (carga/edicion en campo) - N/A. No carga ni edita datos; no toca sync buckets ni repositorios. El espejo se consume offline, pero B4 no cambia el modelo offline.
- C. BLE - N/A. No toca BLE.
- D. UI de campo - N/A. Sin UI nueva (el ledger y el design confirman: sin design-spike, sin componente).
- E. Edge Functions - N/A. No toca Edge Functions.

Todas las secciones N/A documentadas. B4 es un chunk de logica pura sin superficie multi-tenant/offline/BLE/UI/Edge - coherente con design seccion 0 (Gate 1 N/A) y con que Gate 2 lo evalua el leader como N/A.

## Flag para el leader (Gate 2 - no es mi decision, pero lo reviso)

No encontre ningun camino de datos/auth/input nuevo que el leader haya pasado por alto. B4 es PURE: sin I/O, sin red, sin schema, sin escritura, sin parseo de input externo (no toca el TEXT de PowerSync - eso es B1). El boundary mas sutil (IA-write-path vs IA-preview) esta correcto y verificado: la IA sigue persistiendo service+ai real; solo el preview display-only dejo de anticipar transicion. Sin superficie de seguridad. Coincido con el N/A.

## Exactitud de specs (codigo -> spec)

design.md (4.1/4.2/DD-PSC-7/seccion 7) y requirements.md (RPSC.1.1-1.7) describen EXACTAMENTE el as-built: el codigo elimino solo hasService, reconstruyo vaquillona con weaning, quito la rama IA del preview, actualizo el header anti-drift. No hubo desviacion, asi que no hay specs viejas que reconciliar. El ledger (paso 9) lo confirma y es correcto. Sin contradiccion spec/codigo.

---

**Cambios requeridos**: ninguno.
