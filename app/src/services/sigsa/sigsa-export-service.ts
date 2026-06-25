// sigsa-export-service.ts — boundary de I/O de la exportación SIGSA (spec 08, T11/T19/T20).
//
// Orquesta el lado con efectos: lee los animales PENDIENTES del SQLite local (PowerSync), escribe el TXT
// al filesystem + abre la share sheet nativa, y PERSISTE la corrida (export_log + sigsa_declarations) por
// la cola de sync. La capa PURA (sigsa-validator.ts + sigsa-txt-generator.ts + types.ts) NO vive acá — se
// importa. Los SQL builders puros viven en powersync/local-reads.ts (testeables sin device); este módulo
// hace la I/O real (runLocalQuery/runLocalWrite + expo-file-system/expo-sharing).
//
// PATRONES DEL REPO seguidos (idénticos a management-groups.ts / sessions.ts):
//   - LECTURA: build<...>Query → runLocalQuery → mapear. NO re-scopea tenant (la stream ya scopeó); SÍ
//     conserva los filtros de DOMINIO del design (tag NOT NULL, sd.id IS NULL, status='active', deleted_at).
//   - ESCRITURA: build<...>Insert → runLocalWrite → PowerSync encola 1 CrudEntry/statement → uploadData la
//     sube al reconectar. El local write SIEMPRE devuelve ok offline (R14.1); el reject de RLS (un
//     field_operator que intenta declarar/exportar — owner/vet only, 0111/0112) lo resuelve uploadData
//     (descarta + superficia por status, R8.1), NO el return de acá. Contrato T5 de spec 15.
//   - `id` de cliente (crypto.randomUUID). NUNCA se hardcodea establishment_id (CLAUDE.md ppio 6): llega por param.
//
// ⚠ AUDIT FORZADO SERVER-SIDE (0111/0112, HIGH-1): NO se manda `declared_by` ni `generated_by`. Los triggers
// sigsa_declarations_set_declared_by / export_log_set_generated_by los FUERZAN = auth.uid(), ignorando el
// payload del cliente. Mandarlos es inútil (el trigger los pisa). Mismo criterio que created_by en el repo.
//
// OFFLINE-FIRST (R14): queryPendingAnimals + persistDeclarations + redownload son 100% locales (no tocan la
// red). Solo saveAndShare toca APIs del device (filesystem + share sheet), también sin red.

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import {
  buildPendingSigsaAnimalsQuery,
  buildExportLogInsert,
  buildSigsaDeclarationInsert,
  buildExportLogContentQuery,
  buildExportLogHistoryQuery,
  buildBreedCatalogQuery,
  toBool,
  type SigsaPendingRow,
  type SigsaPendingFilters,
  type BreedCatalogRow,
} from '../powersync/local-reads';
import { runLocalQuery, runLocalQuerySingle, runLocalWrite } from '../powersync/local-query';
import type { PendingAnimalInfo } from './types';
import type { BreedCatalogEntry } from '../../utils/breed-picker';

/** Error uniforme del service (mismo shape que el resto del repo). */
export type SigsaServiceError = { kind: 'network' | 'unknown'; message: string };

/** Result uniforme (espeja ServiceResult del repo). */
export type SigsaResult<T> = { ok: true; value: T } | { ok: false; error: SigsaServiceError };

/** Re-export para que el hook tipe los filtros sin importar de local-reads. */
export type { SigsaPendingFilters } from '../powersync/local-reads';

/** Una entrada del historial de export (R10.1) — sin file_content (pesado; se lee aparte en redownload). */
export type ExportLogEntry = {
  id: string;
  /** ISO de generación (orden DESC en la lista). */
  generatedAt: string | null;
  /** auth.uid() de quien generó (audit). */
  generatedBy: string | null;
  animalCount: number;
  fileName: string;
  rodeoFilterId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
};

/** Metadata de la corrida para persistir en export_log (lo arma el hook tras generar el TXT). */
export type ExportLogInput = {
  /** N de animales exportados (= filas de sigsa_declarations a crear). */
  animalCount: number;
  /** Nombre del archivo (slug del establecimiento, R5.3). */
  fileName: string;
  /** Contenido del TXT (R4.3 — para re-descarga). El server CHECKea ≤5 MB (HIGH-2). */
  fileContent: string;
  /** Filtro aplicado (registra el scope de la corrida, R4.3). null = sin filtro. */
  rodeoFilterId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
};

/**
 * Lee los animales PENDIENTES de declarar SIGSA del establecimiento (T11 / R9.1). Query 100% LOCAL
 * (SQLite de PowerSync), offline-first. Devuelve los `PendingAnimalInfo` CRUDOS que consume el validador
 * de la capa pura (sigsa-validator.ts) — este service NO valida (separación pura/I/O).
 *
 * La query NO toca la tabla `animals` (no está en el SQLite local, ADR-026): la identidad sale de las
 * columnas denormalizadas de animal_profiles (0079). Ver buildPendingSigsaAnimalsQuery.
 *
 * NUNCA se hardcodea establishmentId (CLAUDE.md ppio 6): lo pasa el caller desde el EstablishmentContext.
 * emptyIsSyncing default (true): un campo cuyo sync aún no bajó degrada a "Sincronizando" en vez de
 * mostrar "0 pendientes" falso (R5.4, patrón runLocalQuery).
 */
export async function queryPendingAnimals(
  establishmentId: string,
  filters: SigsaPendingFilters = {},
): Promise<SigsaResult<PendingAnimalInfo[]>> {
  const r = await runLocalQuery<SigsaPendingRow>(
    buildPendingSigsaAnimalsQuery(establishmentId, filters),
  );
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: r.value.map(toPendingAnimalInfo) };
}

/** Mapea la fila CRUDA de la query al PendingAnimalInfo de la capa pura. El sexo de la DB es 'male'/'female';
 *  cualquier otro valor inesperado se pasa como null (el validador lo trata defensivamente — no debería pasar
 *  porque el schema spec 02 garantiza NOT NULL/enum). Sin normalización de RFID/fecha/raza acá: eso es del
 *  validador (que separa exportables vs incompletos). */
function toPendingAnimalInfo(row: SigsaPendingRow): PendingAnimalInfo {
  return {
    animalProfileId: row.animal_profile_id,
    rfid: row.animal_tag_electronic,
    sex: row.animal_sex === 'male' || row.animal_sex === 'female' ? row.animal_sex : null,
    birthDate: row.animal_birth_date,
    breedId: row.breed_id,
    breedCode: row.senasa_code,
  };
}

/**
 * Lee el catálogo COMPLETO de razas del SQLite local (T13 — para el BreedPicker del alta/edición). Query
 * 100% LOCAL (catálogo global sincronizado por la stream catalog_breed), offline-first (R1.8). Devuelve las
 * 32 filas crudas mapeadas a `BreedCatalogEntry`; el FILTRO bovine+active y el orden de display los aplica el
 * helper PURO breedPickerOptions (no este service).
 *
 * emptyIsSyncing default (true): si el catálogo aún no bajó (primer login sin sync), degrada a "Sincronizando"
 * en vez de mostrar 0 razas falso (un alta sin razas disponibles sería un dead-end confuso). No hay scoping de
 * tenant (catálogo global, sin establishment_id).
 */
export async function fetchBreedCatalog(): Promise<SigsaResult<BreedCatalogEntry[]>> {
  const r = await runLocalQuery<BreedCatalogRow>(buildBreedCatalogQuery());
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: r.value.map(toBreedCatalogEntry) };
}

/** Mapea la fila cruda de breed_catalog al `BreedCatalogEntry` del helper puro (active: 0/1 → boolean). */
function toBreedCatalogEntry(row: BreedCatalogRow): BreedCatalogEntry {
  return {
    id: row.id,
    senasaCode: row.senasa_code,
    name: row.name,
    species: row.species,
    active: toBool(row.active),
    sortOrder: row.sort_order,
  };
}

/**
 * Escribe el contenido del TXT a un archivo local y abre la share sheet nativa (T11 / R5.4, R9.x). Cross-
 * platform: usa el File API de expo-file-system (v56) — `new File(Paths.cache, fileName).create()/.write()`.
 * El archivo va al cache dir (efímero, se puede limpiar): es un export de un solo uso que el usuario comparte
 * (mail / Drive / WhatsApp) hacia SIGSA web; no necesita persistir en el dispositivo (el contenido queda en
 * export_log para re-descarga, R10.1).
 *
 * UTF-8 sin BOM (R5.6): `File.write(string)` escribe el string JS tal cual, sin anteponer BOM. El generador
 * (sigsa-txt-generator.ts) ya devuelve un string sin BOM por construcción.
 *
 * Devuelve ok aunque la share sheet no esté disponible (web sin soporte): en ese caso el archivo igual se
 * escribió y la UI puede informar. `Sharing.isAvailableAsync()` evita lanzar en plataformas sin share.
 */
export async function saveAndShare(content: string, fileName: string): Promise<SigsaResult<void>> {
  try {
    const file = new File(Paths.cache, fileName);
    // create() con overwrite: una re-descarga del mismo archivo no debe fallar por "ya existe".
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(content); // string → UTF-8 sin BOM (R5.6)

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      // mimeType/UTI de texto plano: SIGSA importa un .txt. dialogTitle es es-AR (Android/web).
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/plain',
        UTI: 'public.plain-text',
        dialogTitle: 'Compartir archivo SIGSA',
      });
    }
    return { ok: true, value: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // No exponemos el error crudo del SO al usuario (la UI lo mapea a copy legible); lo pasamos como unknown.
    return { ok: false, error: { kind: 'unknown', message: message || 'No se pudo generar el archivo.' } };
  }
}

/**
 * Persiste la corrida de export en el SQLite local → cola de sync (T11 / R4.1-R4.3, R11.x): 1 fila en
 * export_log + N filas en sigsa_declarations (una por animal exportado). Offline-first: ambos pasos son
 * LOCALES y devuelven ok al instante; uploadData los sube al reconectar (RLS owner/vet + IDOR-check +
 * triggers de audit forzado los re-validan, 0111/0112).
 *
 * ⚠ ORDEN (FIFO de la upload queue): PRIMERO export_log, DESPUÉS las sigsa_declarations (cada una con su
 * export_log_id apuntando a esa fila). Así, al subir, export_log existe antes que las FKs que lo referencian
 * (la FK fk_sigsa_declarations_export_log es ON DELETE SET NULL — no NOT NULL — pero el orden correcto
 * mantiene la integridad referencial limpia y evita un SET NULL espurio si el server valida la FK).
 *
 * ⚠ NO se manda declared_by/generated_by: los fuerza el trigger server-side (HIGH-1). Ver el banner del módulo.
 *
 * NO ATÓMICO entre statements (igual que el resto del repo offline): si una declaración falla localmente
 * (no debería — el local write solo falla con DB no booteada), las previas ya están encoladas. El UNIQUE
 * server-side (establishment_id, animal_profile_id) hace idempotente un reintento. `establishmentId` por
 * param (nunca hardcode).
 *
 * @param records   los AnimalExportRecord EXPORTADOS (de validateForExport). Su animalProfileId NO viaja en
 *                  el record limpio → se pasa aparte la lista de profileIds alineada (el hook la arma).
 */
export async function persistDeclarations(
  profileIds: string[],
  exportLog: ExportLogInput,
  establishmentId: string,
): Promise<SigsaResult<{ exportLogId: string }>> {
  const exportLogId = randomUuid();

  // Paso 1: export_log (1 fila). generated_by lo fuerza el trigger (0112).
  const logWrite = await runLocalWrite(
    buildExportLogInsert(exportLogId, establishmentId, {
      animalCount: exportLog.animalCount,
      fileName: exportLog.fileName,
      fileContent: exportLog.fileContent,
      rodeoFilterId: exportLog.rodeoFilterId ?? null,
      dateFrom: exportLog.dateFrom ?? null,
      dateTo: exportLog.dateTo ?? null,
    }),
  );
  if (!logWrite.ok) {
    return { ok: false, error: { kind: logWrite.error.kind, message: logWrite.error.message } };
  }

  // Paso 2: N sigsa_declarations, cada una ligada al export_log de arriba. declared_by lo fuerza el trigger (0111).
  for (const profileId of profileIds) {
    const decWrite = await runLocalWrite(
      buildSigsaDeclarationInsert(randomUuid(), establishmentId, profileId, exportLogId),
    );
    if (!decWrite.ok) {
      return { ok: false, error: { kind: decWrite.error.kind, message: decWrite.error.message } };
    }
  }

  return { ok: true, value: { exportLogId } };
}

/**
 * Marca UN animal como "ya declarado por otro medio" (T19 / R10.2) — INSERT de 1 sigsa_declarations SIN
 * export_log_id (el NULL distingue la marca manual del export con archivo RAFAQ). Offline-first (local →
 * cola de sync). RLS owner/vet + IDOR-check (0111) lo re-validan al subir; un field_operator es rechazado
 * (42501, MEDIUM-3) por uploadData, NO por el return de acá. declared_by forzado por trigger.
 *
 * COPY DE LA UI (decisión 2, leader 2026-06-24): el botón que llama a esto dirá **"Marcar como ya declarado
 * por otro medio"**, NO "Declarar". El usuario NO debe creer que esto sube algo a SENASA: solo apaga el
 * recordatorio local (el animal sale de la lista de pendientes — su perfil pasa a tener una declaración, así
 * que buildPendingSigsaAnimalsQuery deja de traerlo). NO hay sub-selector de "¿por qué vía?" (over-engineering MVP).
 *
 * NUNCA se hardcodea establishmentId (CLAUDE.md ppio 6): lo pasa el caller desde el contexto activo.
 */
export async function markAsDeclared(
  animalProfileId: string,
  establishmentId: string,
): Promise<SigsaResult<void>> {
  const r = await runLocalWrite(
    // export_log_id = null → marca manual (R10.2).
    buildSigsaDeclarationInsert(randomUuid(), establishmentId, animalProfileId, null),
  );
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return { ok: true, value: undefined };
}

/**
 * Re-descarga un export previo (T20 / R10.1): lee el `file_content` de la fila de export_log del SQLite
 * local (NO de la red — offline-first) y abre la share sheet con el MISMO contenido. NO crea nuevas filas
 * de sigsa_declarations (los animales ya quedaron declarados en el export original — re-descargar es solo
 * volver a compartir el archivo, R10.1).
 *
 * Si el export_log_id no está local (borrado, o de otro campo que la stream no sincroniza) → error legible
 * (no se encontró). emptyIsSyncing=false: "no encontrado" es un caso de negocio esperado, no falta de sync.
 */
export async function redownload(exportLogId: string): Promise<SigsaResult<void>> {
  const r = await runLocalQuerySingle<{ id: string; file_name: string; file_content: string }>(
    buildExportLogContentQuery(exportLogId),
  );
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  if (r.value == null) {
    return { ok: false, error: { kind: 'unknown', message: 'No encontramos ese archivo para re-descargar.' } };
  }
  // Re-usa saveAndShare con el contenido y nombre originales. NO inserta declaraciones (R10.1).
  return saveAndShare(r.value.file_content, r.value.file_name);
}

/**
 * Lista el historial de exports del establecimiento (R10.1 — para ofrecer re-descarga), más reciente
 * primero. Query LOCAL (sin file_content; la re-descarga lo lee por id). Scoping ya aplicado por la stream.
 */
export async function fetchExportHistory(
  establishmentId: string,
): Promise<SigsaResult<ExportLogEntry[]>> {
  const r = await runLocalQuery<{
    id: string;
    generated_at: string | null;
    generated_by: string | null;
    animal_count: number;
    file_name: string;
    rodeo_filter_id: string | null;
    date_from: string | null;
    date_to: string | null;
  }>(buildExportLogHistoryQuery(establishmentId));
  if (!r.ok) return { ok: false, error: { kind: r.error.kind, message: r.error.message } };
  return {
    ok: true,
    value: r.value.map((row) => ({
      id: row.id,
      generatedAt: row.generated_at,
      generatedBy: row.generated_by,
      animalCount: row.animal_count,
      fileName: row.file_name,
      rodeoFilterId: row.rodeo_filter_id,
      dateFrom: row.date_from,
      dateTo: row.date_to,
    })),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────

/** Re-export de utilidades para que el hook arme records sin re-importar la capa pura por separado. */
export type { AnimalExportRecord } from './types';

/** UUID v4 de cliente (id de cliente, R4/R3). crypto.randomUUID está en RN (Hermes), web y Node. */
function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}
