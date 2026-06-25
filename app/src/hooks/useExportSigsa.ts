// useExportSigsa — orquesta el flujo de exportación SIGSA (spec 08, T12).
//
// El hook NO renderiza: maneja el estado (pendientes / exportables / incompletos / loading / último export /
// error) + las acciones (refresh / generateExport / markDeclared / redownload). La pantalla
// (ExportSigsaScreen, T16) lo consume.
//
// CAPA DE DATOS — NO se reimplementa, se consume:
//   - query de pendientes + escrituras + share: sigsa-export-service (boundary de I/O, T11/T19/T20).
//   - validación pre-export (separar exportables vs a-completar): validateForExport (capa pura, T10).
//   - generación del TXT: generateSigsaTxt (capa pura, T9).
//
// FLUJO de generateExport (R9.x): cargar pendientes (ya en estado) → validateForExport → generateSigsaTxt
// (solo los exportables) → saveAndShare (archivo + share sheet) → persistDeclarations (export_log + N
// sigsa_declarations) → refrescar pendientes (los recién declarados desaparecen) + setear lastExport.
//
// SEGURIDAD / offline:
//   - El botón de export se deshabilita con exportableCount === 0 (R10.1 / T12 test a). generateExport
//     igual revalida (no escribe con 0 exportables — defensa, el CTA ya bloquea).
//   - error.message del service NUNCA se renderiza crudo: el hook lo clasifica a copy legible (mapError).
//   - field_operator: el gate de rol vive en la PANTALLA (T16, no se ofrece el flujo). El hook igual es
//     inerte sin establishment activo. Si un field_operator forzara una escritura, la RLS la rechaza al
//     subir (0111/0112) — NO el hook.
//   - NUNCA se hardcodea establishment_id (CLAUDE.md ppio 6): sale del EstablishmentContext.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useEstablishment } from '@/contexts';
import {
  fetchExportHistory,
  markAsDeclared,
  persistDeclarations,
  queryPendingAnimals,
  redownload,
  saveAndShare,
  type ExportLogEntry,
  type SigsaPendingFilters,
  type SigsaServiceError,
} from '@/services/sigsa/sigsa-export-service';
import { generateSigsaTxt } from '@/services/sigsa/sigsa-txt-generator';
import { validateForExport } from '@/services/sigsa/sigsa-validator';
import type { PendingAnimalInfo } from '@/services/sigsa/types';

/** Un animal que NO se puede exportar todavía + el/los motivos (R8.3). Lo arma validateForExport. */
export type IncompleteAnimal = {
  animalProfileId: string;
  reasons: import('@/services/sigsa/types').ExportValidationReason[];
};

/** El resultado de un export recién hecho (para el checklist post-export + confirmación, R10.1/R13). */
export type LastExport = {
  exportLogId: string;
  fileName: string;
  animalCount: number;
};

/** Error del flujo, ya legible en español (nunca sqlerrm/SO crudo). */
export type ExportError = { message: string };

export type UseExportSigsa = {
  /** Todos los pendientes crudos del campo (con el filtro aplicado). La UI muestra ambas listas desde acá. */
  pendingAnimals: PendingAnimalInfo[];
  /** Cuántos pasan validación (habilita el botón de export si > 0). */
  exportableCount: number;
  /** Los que NO pasan + el dato faltante por animal (lista "A completar"). */
  incompleteAnimals: IncompleteAnimal[];
  /** true mientras se carga / genera / persiste. */
  isGenerating: boolean;
  /** El último export hecho en esta sesión (para el checklist), o null. */
  lastExport: LastExport | null;
  /** Historial de exports del campo (para re-descarga, R10.1). */
  history: ExportLogEntry[];
  /** Error legible del último intento, o null. */
  error: ExportError | null;
  /** Filtros activos (rodeo / rango de fechas de nacimiento). */
  filters: SigsaPendingFilters;
  /** Setea los filtros y recarga los pendientes. */
  setFilters: (next: SigsaPendingFilters) => void;
  /** Recarga pendientes + historial (tras montar, cambiar filtro, o un cambio externo). */
  refresh: () => Promise<void>;
  /** Genera el TXT de los exportables, lo comparte y persiste las declaraciones (R9.x). */
  generateExport: () => Promise<void>;
  /** Marca un animal como "ya declarado por otro medio" (T19/R10.2) y recarga. */
  markDeclared: (animalProfileId: string) => Promise<void>;
  /** Re-descarga un export previo por id (T20/R10.1) — NO crea declaraciones. */
  redownloadExport: (exportLogId: string) => Promise<void>;
};

/** Clasifica un error del service a copy legible (nunca el crudo). */
function mapError(error: SigsaServiceError): string {
  if (error.kind === 'network') {
    // runLocalQuery degrada a 'network' cuando el sync aún no bajó (SYNCING_MESSAGE ya es legible es-AR).
    return error.message;
  }
  return 'No pudimos completar la operación. Volvé a intentar.';
}

/**
 * Nombre del archivo SIGSA — formato R5.3: `sigsa_<slug>_<YYYYMMDD_HHMMSS>.txt`.
 *
 * El slug del establecimiento: minúsculas, sin acentos (NFD + strip de combinantes), no-alfanum→guion,
 * acotado a 80 chars (el server CHECKea ≤255 el nombre completo, HIGH-2). El timestamp con SEGUNDOS hace
 * único cada export del mismo día (R5.3) → re-exportar no pisa el nombre del anterior en el share/historial.
 * Usa la hora LOCAL del dispositivo (el productor reconoce "cuándo lo generó").
 */
function buildFileName(establishmentName: string | null): string {
  const slug =
    (establishmentName ?? 'campo')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '') // saca los diacríticos combinantes (acentos) tras NFD
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'campo';
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `_${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `sigsa_${slug}_${stamp}.txt`;
}

export function useExportSigsa(): UseExportSigsa {
  const { state: estState } = useEstablishment();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;
  const establishmentName = estState.status === 'active' ? estState.current.name : null;

  const [pendingAnimals, setPendingAnimals] = useState<PendingAnimalInfo[]>([]);
  const [history, setHistory] = useState<ExportLogEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastExport, setLastExport] = useState<LastExport | null>(null);
  const [error, setError] = useState<ExportError | null>(null);
  const [filters, setFiltersState] = useState<SigsaPendingFilters>({});

  // Validación derivada (PURA, sin I/O): separa los pendientes en exportables vs incompletos. Se recomputa
  // cuando cambia la lista de pendientes. exportableCount alimenta el gating del botón (T12 test a).
  const validation = useMemo(() => validateForExport(pendingAnimals), [pendingAnimals]);
  const exportableCount = validation.exportable.length;
  const incompleteAnimals = validation.incomplete;

  const loadPending = useCallback(
    async (estId: string, f: SigsaPendingFilters) => {
      const r = await queryPendingAnimals(estId, f);
      if (!r.ok) {
        setError({ message: mapError(r.error) });
        return;
      }
      setPendingAnimals(r.value);
    },
    [],
  );

  const loadHistory = useCallback(async (estId: string) => {
    const r = await fetchExportHistory(estId);
    // El historial es secundario: si falla, NO bloqueamos la pantalla principal (degradación graciosa).
    if (r.ok) setHistory(r.value);
  }, []);

  const refresh = useCallback(async () => {
    if (!establishmentId) {
      setPendingAnimals([]);
      setHistory([]);
      return;
    }
    setError(null);
    await Promise.all([loadPending(establishmentId, filters), loadHistory(establishmentId)]);
  }, [establishmentId, filters, loadPending, loadHistory]);

  // Carga inicial + recarga cuando cambia el campo activo o los filtros.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setFilters = useCallback((next: SigsaPendingFilters) => {
    setError(null);
    setFiltersState(next);
  }, []);

  const generateExport = useCallback(async () => {
    if (!establishmentId) {
      setError({ message: 'No hay un campo activo. Volvé a entrar al campo y reintentá.' });
      return;
    }
    // Revalida UNA vez con los pendientes ACTUALES (no confía en el exportableCount memoizado: el estado
    // pudo cambiar). Devuelve exportables (records limpios) + incompletos (con id) en un solo paso PURO.
    const { exportable, incomplete } = validateForExport(pendingAnimals);
    if (exportable.length === 0) {
      // T12 test b: con 0 exportables, generateExport NO escribe y devuelve un error accionable.
      setError({
        message: 'No hay animales listos para exportar. Completá los datos faltantes (caravana, fecha o raza).',
      });
      return;
    }

    // profileIds de los exportables, EN EL MISMO ORDEN que los records: son los pendientes cuyo id NO está
    // en `incomplete`. validateForExport itera en orden y empuja exportables/incompletos preservando el
    // orden de entrada, así que filtrar los pendientes por "no incompleto" reconstruye el alineamiento 1:1
    // con `exportable` (lo que persistDeclarations necesita: 1 declaración por record, mismo orden).
    const incompleteIds = new Set(incomplete.map((i) => i.animalProfileId));
    const exportableProfileIds = pendingAnimals
      .filter((a) => a != null && !incompleteIds.has(a.animalProfileId))
      .map((a) => a.animalProfileId);

    setError(null);
    setIsGenerating(true);
    try {
      // 1) Generar el TXT (capa pura). trailingSemicolon default false (GATE DURO R6.3, no confirmado).
      let content: string;
      try {
        content = generateSigsaTxt(exportable);
      } catch {
        // El generador lanza fail-closed ante un record inválido (no debería: el validador ya filtró).
        // No exponemos el detalle; copy accionable.
        setIsGenerating(false);
        setError({ message: 'No pudimos generar el archivo. Revisá los datos de los animales.' });
        return;
      }

      const fileName = buildFileName(establishmentName);

      // 2) Escribir + compartir (archivo en cache + share sheet nativa).
      const shareRes = await saveAndShare(content, fileName);
      if (!shareRes.ok) {
        setIsGenerating(false);
        setError({ message: 'No pudimos generar o compartir el archivo. Volvé a intentar.' });
        return;
      }

      // 3) Persistir export_log (1) + sigsa_declarations (N). declared_by/generated_by los fuerza el trigger.
      const persistRes = await persistDeclarations(
        exportableProfileIds,
        {
          animalCount: exportableProfileIds.length,
          fileName,
          fileContent: content,
          rodeoFilterId: filters.rodeoId ?? null,
          dateFrom: filters.dateFrom ?? null,
          dateTo: filters.dateTo ?? null,
        },
        establishmentId,
      );
      if (!persistRes.ok) {
        setIsGenerating(false);
        setError({ message: mapError(persistRes.error) });
        return;
      }

      setLastExport({
        exportLogId: persistRes.value.exportLogId,
        fileName,
        animalCount: exportableProfileIds.length,
      });

      // 4) Recargar: los recién declarados salen de pendientes; el nuevo export entra al historial.
      await refresh();
    } finally {
      setIsGenerating(false);
    }
  }, [establishmentId, establishmentName, pendingAnimals, filters, refresh]);

  const markDeclared = useCallback(
    async (animalProfileId: string) => {
      if (!establishmentId) return;
      setError(null);
      setIsGenerating(true);
      try {
        const r = await markAsDeclared(animalProfileId, establishmentId);
        if (!r.ok) {
          setError({ message: mapError(r.error) });
          return;
        }
        await refresh(); // el animal marcado desaparece de pendientes (T19 test a).
      } finally {
        setIsGenerating(false);
      }
    },
    [establishmentId, refresh],
  );

  const redownloadExport = useCallback(async (exportLogId: string) => {
    setError(null);
    const r = await redownload(exportLogId);
    if (!r.ok) {
      setError({ message: mapError(r.error) });
    }
    // NO recarga pendientes ni historial: re-descargar no cambia el estado (T20 — no inserta declaraciones).
  }, []);

  return {
    pendingAnimals,
    exportableCount,
    incompleteAnimals,
    isGenerating,
    lastExport,
    history,
    error,
    filters,
    setFilters,
    refresh,
    generateExport,
    markDeclared,
    redownloadExport,
  };
}
