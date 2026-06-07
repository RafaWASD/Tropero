// useImportRodeo — orquesta el flujo de importación masiva de rodeo (spec 12, Fase 4 / T4.1).
//
// El hook NO renderiza: maneja el estado de la máquina (paso/fuente/archivo/headers/mapeo/preview/
// resultado/loading/error) + las acciones (pickFile/setMapping/buildPreview/confirm/reset). La
// pantalla (app/app/import-rodeo.tsx) lo consume.
//
// CAPA DE DATOS — NO se reimplementa, se consume:
//   - parseo local (R12.1): parse-csv / parse-xlsx / parse-sigsa-txt (utils puros).
//   - normalización/validación: normalize-row + validate-rows (utils puros) vía import-ui.
//   - dedup contra existentes + escritura: dedupAgainstExisting + confirmImport (service I/O).
//   - guard de tamaño (R3.1): checkFileSize (re-exportado del service).
//
// NOTAS DE SEGURIDAD carry-forward (security_code_12-service.md §Fase 4) que el hook cumple:
//   1. R3.1 — checkFileSize(asset.size) corre ANTES de leer/parsear el contenido (barrera real del
//      char-flood de 1 celda gigante; lo testea Gate 2). Ver pickFile: el size-check es lo primero.
//   2. error.message/sqlerrm NUNCA se renderiza crudo: el hook clasifica los errores del service a
//      copy legible (mapErrorToCopy) y los motivos de fila pasan por import-ui (writeErrorCopy, etc.).
//   3. field_operator: el gate de rol vive en la PANTALLA (no se ofrece el flujo). El hook igual es
//      inerte sin rodeo/establishment (no escribe).

import { useCallback, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

import { useEstablishment, useRodeo } from '@/contexts';
import type { Rodeo } from '@/services/rodeos';
import {
  checkFileSize,
  confirmImport,
  dedupAgainstExisting,
  fetchCategoryCatalogCodes,
  type ImportFileFormat,
  type ImportRunResult,
} from '@/services/import-rodeo';
import { parseCsv } from '@/utils/import/parse-csv';
import { parseXlsx } from '@/utils/import/parse-xlsx';
import { parseSigsaTxt } from '@/utils/import/parse-sigsa-txt';
import {
  autoDetectMapping,
  applyMappingOverride,
  type CensusField,
  type ColumnMapping,
} from '@/utils/import/column-mapping';
import type { NormalizedRow } from '@/utils/import/normalize-row';
import { validateRows, type ValidationResult } from '@/utils/import/validate-rows';
import {
  buildCategoryLabelByIndex,
  buildCategoryStatusByIndex,
  buildColumnSamples,
  buildPreviewItems,
  mappingIsComplete,
  normalizeSigsaRows,
  normalizeTableRows,
  summarizeUnrecognizedCategories,
  toCandidates,
  type PreviewItem,
  type UnrecognizedCategories,
} from '@/utils/import/import-ui';

/** La fuente elegida en el paso 1 (R1.3). 'spreadsheet' = CSV/Excel (mapeo); 'sigsa' = TXT fijo. */
export type ImportSource = 'spreadsheet' | 'sigsa';

/** El paso del wizard (R1.3 — una decisión por pantalla). */
export type ImportStep = 'source' | 'mapping' | 'preview' | 'result';

/** El archivo elegido (lo que da expo-document-picker, normalizado). */
type PickedFile = {
  uri: string;
  name: string;
  size: number;
  /** Formato derivado de la fuente + extensión (espejo del enum import_file_format). */
  format: ImportFileFormat;
};

/** El preview computado tras buildPreview (R5.3 — conteos + lista capeada + candidatas). */
export type ImportPreview = {
  /** Conteos EXACTOS (no capeados): válidas escribibles. */
  validCount: number;
  /** Filas con error de validación (no escribibles). */
  errorCount: number;
  /** Filas duplicadas (intra-archivo + contra existentes). */
  duplicateCount: number;
  /** Lista capeada para render (R5.4 — primeras N + "y N más"). */
  items: PreviewItem[];
  /** Cuántas filas quedaron fuera de la lista capeada. */
  hiddenCount: number;
  /** Total de filas de datos del archivo (para el conteo del import_log). */
  totalRecords: number;
  /**
   * Categorías DECLARADAS que NO están en el catálogo del system del rodeo → van a quedar "a
   * completar" (placeholder por sexo del RPC, R10.5). SOLO visibilidad: avisamos sin cambiar el
   * mapeo ni el RPC. `null` si no hay ninguna no reconocida, o si el catálogo no se pudo traer
   * (degradación graciosa: el preview igual funciona, sin este aviso).
   */
  unrecognizedCategories: UnrecognizedCategories | null;
};

/** El error de un paso del flujo, ya legible en español (nunca sqlerrm crudo). */
export type ImportError = { message: string };

/** El estado completo que el hook expone a la pantalla. */
export type ImportState = {
  step: ImportStep;
  source: ImportSource | null;
  rodeoId: string | null;
  rodeos: Rodeo[];
  file: PickedFile | null;
  headers: string[];
  mapping: ColumnMapping;
  /**
   * Muestra de datos por COLUMNA (índice = posición de la columna en headers) para el paso de
   * mapeo source-driven: los primeros valores no vacíos de cada columna, para que el operador vea
   * qué trae sin adivinar (patrón Expensify). Para SIGSA queda [] (no hay mapeo, no se usa).
   */
  columnSamples: string[];
  /** ¿El mapeo tiene ≥1 identificador + sexo? (habilita "Continuar" en el paso 2). */
  mappingComplete: boolean;
  preview: ImportPreview | null;
  result: ImportRunResult | null;
  /** true mientras se lee/parsea/valida/escribe. */
  loading: boolean;
  error: ImportError | null;
};

export type UseImportRodeo = {
  state: ImportState;
  /** Elige la fuente (paso 1). Limpia archivo/preview previos si cambia. */
  setSource: (source: ImportSource) => void;
  /** Elige el rodeo destino (paso 1, ≥2 rodeos). */
  setRodeo: (rodeoId: string) => void;
  /** Abre el document-picker, valida tamaño ANTES de leer (R3.1), parsea y avanza. */
  pickFile: () => Promise<void>;
  /** Ajusta el mapeo de una columna (paso 2, R4.2). */
  setColumnMapping: (columnIndex: number, field: CensusField | null) => void;
  /** Valida + dedup contra existentes y arma el preview (paso 2→3, R5.3). */
  buildPreview: () => Promise<void>;
  /** Confirma y escribe (paso 3→4, R5.5/R8). Guard de conexión (R12.2) dentro del service. */
  confirm: () => Promise<void>;
  /** Vuelve un paso (la pantalla decide a dónde sale del paso 1). */
  goBack: () => void;
  /** Resetea todo a "elegir fuente" (para "Importar otro archivo" del paso 4). */
  reset: () => void;
};

// Tipos de MIME por fuente para el document-picker.
const SPREADSHEET_MIME = [
  'text/csv',
  'text/comma-separated-values',
  'application/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];
const SIGSA_MIME = ['text/plain'];

/** Deriva el formato del archivo (enum import_file_format) de la fuente + la extensión. */
function deriveFormat(source: ImportSource, name: string): ImportFileFormat {
  if (source === 'sigsa') return 'sigsa_txt';
  return /\.xlsx?$/i.test(name) && !/\.csv$/i.test(name) ? 'xlsx' : 'csv';
}

/** ¿El archivo elegido es .xlsx (binario) y no CSV? */
function isXlsx(format: ImportFileFormat): boolean {
  return format === 'xlsx';
}

/**
 * Lee el contenido del archivo del URI del picker. PARA EL TEXTO (csv/sigsa) devuelve string; para
 * .xlsx (binario) devuelve un ArrayBuffer. Cross-platform: web usa fetch (blob: URI), native usa el
 * File API de expo-file-system (file:// URI). SOLO se llama DESPUÉS del size-check (R3.1).
 */
async function readFileText(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return await res.text();
  }
  return new File(uri).text();
}

async function readFileBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    return new Uint8Array(await res.arrayBuffer());
  }
  return new File(uri).bytes();
}

/** Mapea un error del service a copy legible (nota de seguridad #2 — nunca el crudo de la DB). */
function mapErrorToCopy(error: { kind: 'network' | 'offline' | 'unknown'; message: string }): string {
  if (error.kind === 'offline') {
    return 'La importación necesita conexión a internet. Conectate y volvé a confirmar.';
  }
  if (error.kind === 'network') {
    return 'Sin conexión. Revisá tu internet y volvé a intentar.';
  }
  return 'No pudimos completar la importación. Volvé a intentar.';
}

const INITIAL_MAPPING: ColumnMapping = [];

export function useImportRodeo(): UseImportRodeo {
  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();

  const establishmentId = estState.status === 'active' ? estState.current.id : null;
  const rodeos: Rodeo[] = rodeoState.status === 'active' ? rodeoState.available : [];

  const [step, setStep] = useState<ImportStep>('source');
  const [source, setSourceState] = useState<ImportSource | null>(null);
  // Con 1 rodeo, lo preseleccionamos (R2.2 — read-only). Con ≥2, el usuario elige (R2.3).
  const [rodeoId, setRodeoId] = useState<string | null>(rodeos.length === 1 ? rodeos[0].id : null);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [sigsaRows, setSigsaRows] = useState<NormalizedRow[] | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(INITIAL_MAPPING);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ImportError | null>(null);

  // Mantener el rodeo preseleccionado coherente si el set cambia (ej. carga tardía del contexto).
  const effectiveRodeoId = useMemo(() => {
    if (rodeoId && rodeos.some((r) => r.id === rodeoId)) return rodeoId;
    if (rodeos.length === 1) return rodeos[0].id;
    return rodeoId;
  }, [rodeoId, rodeos]);

  const mappingComplete = useMemo(() => mappingIsComplete(mapping), [mapping]);

  // Muestra de datos por columna (paso 2 source-driven). SIGSA no tiene headers → []. PURO.
  const columnSamples = useMemo(() => buildColumnSamples(headers, dataRows), [headers, dataRows]);

  const setSource = useCallback((next: ImportSource) => {
    setSourceState((prev) => {
      if (prev === next) return prev;
      // Cambiar de fuente invalida lo parseado (otro formato).
      setFile(null);
      setHeaders([]);
      setDataRows([]);
      setSigsaRows(null);
      setMapping(INITIAL_MAPPING);
      setPreview(null);
      setError(null);
      return next;
    });
  }, []);

  const setRodeo = useCallback((id: string) => {
    setRodeoId(id);
    setError(null);
  }, []);

  const pickFile = useCallback(async () => {
    if (!source) return;
    setError(null);
    const type = source === 'sigsa' ? SIGSA_MIME : SPREADSHEET_MIME;
    let picked: DocumentPicker.DocumentPickerResult;
    try {
      picked = await DocumentPicker.getDocumentAsync({
        type,
        multiple: false,
        copyToCacheDirectory: true,
      });
    } catch {
      setError({ message: 'No pudimos abrir el archivo. Volvé a intentar.' });
      return;
    }
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    const size = typeof asset.size === 'number' ? asset.size : NaN;

    // ── R3.1 (nota de seguridad #1) — SIZE-CHECK ANTES DE LEER/PARSEAR EL CONTENIDO. ──
    // Es la primera barrera: el cap de filas de los parsers NO cubre un archivo de 1 celda de 50MB
    // (char-flood). checkFileSize opera sobre los bytes, sin tocar el contenido.
    const sizeCheck = checkFileSize(size);
    if (!sizeCheck.ok) {
      setError({ message: sizeCheck.message });
      return;
    }

    const format = deriveFormat(source, asset.name ?? 'archivo');
    const pickedFile: PickedFile = {
      uri: asset.uri,
      name: asset.name ?? 'archivo',
      size,
      format,
    };

    setLoading(true);
    try {
      if (source === 'sigsa') {
        const text = await readFileText(asset.uri);
        const { records, recordsExceeded } = parseSigsaTxt(text);
        if (recordsExceeded) {
          setLoading(false);
          setError({
            message:
              'El archivo tiene más de 5000 animales. Dividilo en archivos más chicos e importá por partes.',
          });
          return;
        }
        if (records.length === 0) {
          setLoading(false);
          setError({ message: 'No encontramos animales en el archivo. Revisá el formato de SIGSA.' });
          return;
        }
        // SIGSA no mapea: normalizamos directo (R6.2) y vamos al preview.
        const normalized = normalizeSigsaRows(records);
        setFile(pickedFile);
        setSigsaRows(normalized);
        setHeaders([]);
        setDataRows([]);
        setMapping(INITIAL_MAPPING);
        setPreview(null);
        setLoading(false);
        setStep('preview');
        return;
      }

      // CSV / Excel.
      let table: { headers: string[]; rows: string[][]; rowsExceeded: boolean; parseError?: boolean };
      if (isXlsx(format)) {
        const bytes = await readFileBytes(asset.uri);
        table = parseXlsx(bytes);
      } else {
        const text = await readFileText(asset.uri);
        table = parseCsv(text);
      }

      if (table.parseError) {
        setLoading(false);
        setError({
          message: 'No pudimos leer el archivo. Revisá que sea un CSV o Excel válido.',
        });
        return;
      }
      if (table.rowsExceeded) {
        setLoading(false);
        setError({
          message:
            'El archivo tiene más de 5000 filas. Dividilo en archivos más chicos e importá por partes.',
        });
        return;
      }
      if (table.headers.length === 0 || table.rows.length === 0) {
        setLoading(false);
        setError({
          message: 'El archivo está vacío o no tiene filas de datos. Revisá que tenga encabezados y filas.',
        });
        return;
      }

      setFile(pickedFile);
      setHeaders(table.headers);
      setDataRows(table.rows);
      setMapping(autoDetectMapping(table.headers)); // R4.1 — pre-llena; el usuario ajusta (R4.2).
      setSigsaRows(null);
      setPreview(null);
      setLoading(false);
      setStep('mapping');
    } catch {
      setLoading(false);
      setError({ message: 'No pudimos leer el archivo. Volvé a intentar.' });
    }
  }, [source]);

  const setColumnMapping = useCallback((columnIndex: number, field: CensusField | null) => {
    setMapping((prev) => applyMappingOverride(prev, columnIndex, field));
    setError(null);
  }, []);

  const buildPreview = useCallback(async () => {
    if (!establishmentId) {
      setError({ message: 'No hay un campo activo. Volvé a entrar al campo y reintentá.' });
      return;
    }
    setError(null);
    setLoading(true);

    // Filas normalizadas: SIGSA ya las tiene; CSV/Excel se normaliza por el mapeo (R4).
    const rows: NormalizedRow[] =
      source === 'sigsa' && sigsaRows ? sigsaRows : normalizeTableRows(dataRows, mapping);

    const validation: ValidationResult = validateRows(rows);

    // Dedup contra existentes (R7.2/R7.4) — I/O en el service. Sobre las válidas únicamente.
    const candidates = toCandidates(rows, validation.valid);
    const dedup = await dedupAgainstExisting(establishmentId, candidates);
    if (!dedup.ok) {
      setLoading(false);
      setError({ message: mapErrorToCopy(dedup.error) });
      return;
    }

    const existingSkips = dedup.value.skipped.map((s) => ({ index: s.index, reason: s.reason }));
    const validIndices = dedup.value.toWrite.map((c) => c.index);

    // Conteos EXACTOS (no capeados). duplicateCount = intra-archivo + contra existentes.
    const intraDupRows = new Set<number>();
    for (const g of validation.intraDuplicates) for (const i of g.indices) intraDupRows.add(i);
    const duplicateCount = intraDupRows.size + existingSkips.length;

    // Badge "lo que dice tu archivo" (R10.3 client-side nicety): el texto crudo de la columna de
    // categoría que el operador mapeó, solo para las válidas que la traen (SIGSA/sin columna → null,
    // sin badge). NO es la categoría que resuelve el RPC server-side.
    const categoryLabelByIndex = buildCategoryLabelByIndex(rows, validIndices);

    // Visibilidad de categorías declaradas vs catálogo del system del rodeo (R10.5): avisamos qué
    // categorías NO matchean el catálogo (van a caer en placeholder "a completar"). MIRROR del match
    // server-side del RPC (no lo cambia). Degradación graciosa: si no hay rodeo destino o la query del
    // catálogo falla, NO rompemos el preview — seguimos sin el aviso de categorías (categoryStatus
    // queda en 'none' por fila → ningún aviso ni señal de "a completar").
    let categoryStatusByIndex: ReturnType<typeof buildCategoryStatusByIndex> | undefined;
    let unrecognizedCategories: UnrecognizedCategories | null = null;
    if (effectiveRodeoId) {
      const catalog = await fetchCategoryCatalogCodes(effectiveRodeoId);
      // Solo computamos el aviso si el catálogo se trajo Y no vino vacío: con un set vacío toda
      // categoría declarada caería en 'unmatched' falsamente, así que ahí preferimos NO avisar.
      if (catalog.ok && catalog.value.size > 0) {
        categoryStatusByIndex = buildCategoryStatusByIndex(rows, validIndices, catalog.value);
        unrecognizedCategories = summarizeUnrecognizedCategories(
          rows,
          validIndices,
          categoryStatusByIndex,
        );
      }
    }

    const { items, hiddenCount } = buildPreviewItems({
      rows,
      validIndices,
      errors: validation.errors,
      intraDuplicates: validation.intraDuplicates,
      existingSkips,
      categoryLabelByIndex,
      categoryStatusByIndex,
    });

    setPreview({
      validCount: validIndices.length,
      errorCount: validation.errors.length,
      duplicateCount,
      items,
      hiddenCount,
      totalRecords: rows.length,
      unrecognizedCategories,
    });
    setLoading(false);
    setStep('preview');
  }, [establishmentId, effectiveRodeoId, source, sigsaRows, dataRows, mapping]);

  const confirm = useCallback(async () => {
    if (!establishmentId || !effectiveRodeoId || !file || !preview) return;
    if (preview.validCount === 0) return; // R5.6 — no escribir con 0 válidas (defensa; el CTA ya bloquea).

    setError(null);
    setLoading(true);

    // Re-armamos las candidatas (las válidas + no-dup): re-normalizamos + re-validamos + re-dedup.
    const rows: NormalizedRow[] =
      source === 'sigsa' && sigsaRows ? sigsaRows : normalizeTableRows(dataRows, mapping);
    const validation = validateRows(rows);
    const candidates = toCandidates(rows, validation.valid);

    const run = await confirmImport({
      establishmentId,
      rodeoId: effectiveRodeoId,
      fileName: file.name,
      fileFormat: file.format,
      totalRecords: rows.length,
      candidates,
    });

    if (!run.ok) {
      setLoading(false);
      setError({ message: mapErrorToCopy(run.error) });
      return;
    }

    setResult(run.value);
    setLoading(false);
    setStep('result');
  }, [establishmentId, effectiveRodeoId, file, preview, source, sigsaRows, dataRows, mapping]);

  const goBack = useCallback(() => {
    setError(null);
    setStep((s) => {
      if (s === 'result') return 'source';
      if (s === 'preview') return source === 'sigsa' ? 'source' : 'mapping';
      if (s === 'mapping') return 'source';
      return 'source';
    });
  }, [source]);

  const reset = useCallback(() => {
    setStep('source');
    setSourceState(null);
    setRodeoId(rodeos.length === 1 ? rodeos[0].id : null);
    setFile(null);
    setHeaders([]);
    setDataRows([]);
    setSigsaRows(null);
    setMapping(INITIAL_MAPPING);
    setPreview(null);
    setResult(null);
    setLoading(false);
    setError(null);
  }, [rodeos]);

  const state: ImportState = {
    step,
    source,
    rodeoId: effectiveRodeoId,
    rodeos,
    file,
    headers,
    mapping,
    columnSamples,
    mappingComplete,
    preview,
    result,
    loading,
    error,
  };

  return {
    state,
    setSource,
    setRodeo,
    pickFile,
    setColumnMapping,
    buildPreview,
    confirm,
    goBack,
    reset,
  };
}
