// app/maniobra/carga.tsx — FRAME de CARGA RÁPIDA (spec 03 M2.2).
//
// De DESIGN SPIKE (M2.0, mock) a FRAME REAL: cablea la identificación (M2.1-core auto-avanza acá con
// `sessionId` + `profileId`) a datos reales y orquesta la SECUENCIA de maniobras del animal:
//   - Lee la SESIÓN (`getSessionById`) → maniobras de la jornada en orden (`config.maniobras`, R5.14).
//   - Lee el ANIMAL real (`fetchAnimalDetail`) → identidad (tag/idv/visual) + rodeo + categoría (R5.1/R12.4).
//   - Resuelve el GATING por el RODEO REAL del animal (`useManeuverGating(animal.rodeoId)`, R5.3/R5.5) →
//     la secuencia = orden de config ∩ maniobras que aplican (`buildSequence`).
//   - RENDER per-maniobra GENÉRICO (dispatcher `stepKindFor`): tacto → TactoStep (binario + tamaño),
//     pesaje → PesajeStep (keypad), resto → PlaceholderStep ("pendiente M3"). M3 enchufa las 10 sin tocar
//     el frame: agrega su renderer en el switch + su rama en el orquestador.
//   - PERSISTE cada maniobra al confirmar (`persistManeuverEvent` con `session_id`, R5.8/R5.11; `created_by`
//     por trigger R5.12), OFFLINE (CRUD-plano, R10.1).
//   - RESUMEN por animal (`AnimalSummary`): corregir tocando una maniobra (R5.9).
//   - Confirmar resumen → contador de progreso (`setSessionCounts`, animales++ R5.10) → SIGUIENTE animal
//     (vuelve a `identificar.tsx` con el sessionId).
//
// Una decisión por pantalla (R1.2): el header de identidad es MÍNIMO pero SIEMPRE visible (R12.4); debajo,
// la línea de maniobra + contador "Tacto · 2 de 4" (R5.14) sobre la secuencia FILTRADA; el cuerpo es el
// paso actual (dominante). Cero hardcode (ADR-023 §4): tokens. es-AR. Recorte de descendentes: lineHeight
// matching (el header lo trae; los pasos llevan sus propios headings con matching).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, Spinner, Text, View, XStack, YStack } from 'tamagui';

import { buttonA11y, labelA11y } from '@/utils/a11y';
import { fetchAnimalDetail, resolveCutCategory, type AnimalDetail } from '@/services/animals';
import { getSessionById, setSessionCounts, type Session } from '@/services/sessions';
import { persistManeuverEvent, softDeleteManeuverEvents } from '@/services/maneuver-events';
import { fetchEnabledCustomManeuvers, type EnabledCustomManeuver } from '@/services/custom-fields';
import { addCustomMeasurement } from '@/services/custom-measurements';
import { toCustomValue, type CustomCaptureValue } from '@/utils/custom-render';
import {
  filterByAnimalApplicability,
  type AnimalApplicabilityInfo,
} from '@/utils/maneuver-applicability';
import { useManeuverGating } from '@/hooks/useManeuverGating';
import {
  extractCustomManiobras,
  extractManeuvers,
  pajuelasFor,
  parseManeuverConfig,
  preconfigHistory,
  preconfigStringFor,
} from '@/utils/maneuver-config';
import { splitMultiPreconfig } from '@/utils/maneuver-wizard';
import { maneuverLabel } from '@/utils/maneuver-wizard';
import { formatEidReadable } from '@/utils/eid-format';
import { stepKindFor } from '@/utils/maneuver-step-kind';
import {
  buildSequence,
  sequenceItemKey,
  summaryRows,
  type CaptureMap,
  type CustomCaptureMap,
  type CustomManeuverSpec,
  type PregnancyStatus,
  type SequenceItem,
  type SilentSanitaryType,
  type StepValue,
} from '@/utils/maneuver-sequence';
import type { ManeuverKind } from '@/utils/maneuver-gating';

import { consumeManeuverPersistFault } from './_components/maneuver-e2e-fault';
import { SpikeIdentityHeader } from './_components/SpikeIdentityHeader';
import { TactoStep } from './_components/TactoStep';
import { TactoVaquillonaStep } from './_components/TactoVaquillonaStep';
import { CondicionCorporalStep } from './_components/CondicionCorporalStep';
import { DientesStep } from './_components/DientesStep';
import { PesajeStep } from './_components/PesajeStep';
import { SilentSanitaryStep } from './_components/SilentSanitaryStep';
import { SilentVaccinationStep } from './_components/SilentVaccinationStep';
import { InseminacionStep } from './_components/InseminacionStep';
import { LabSampleStep } from './_components/LabSampleStep';
import { LabDoubleStep } from './_components/LabDoubleStep';
import { CustomManeuverStep } from './_components/CustomManeuverStep';
import { PlaceholderStep } from './_components/PlaceholderStep';
import { AnimalSummary } from './_components/AnimalSummary';

/** ¿Qué muestra el frame? El paso actual de la secuencia, o el resumen del animal. */
type FrameMode = 'step' | 'summary';

/**
 * Identidad DOMINANTE del header (R5.1/R12.4): la CARAVANA VISUAL HUMANA que el operario LEE en la oreja,
 * NO el RFID de 15 dígitos. Prioridad visual > electrónico (consistente con `identify-found.png`, que
 * lidera con "Caravana 0385"):
 *   visual_id_alt → idv → (fallback) tag electrónico formateado → "—".
 * El tag electrónico solo es dominante cuando el animal NO tiene NINGUNA caravana visual (animal sin idv
 * ni visual cargados): recién ahí lo mostramos legible como identidad. Si hay visual/idv, el tag va MUTED
 * (ver `mutedTag`).
 */
function displayIdentity(a: AnimalDetail): string {
  if (a.visualIdAlt) return a.visualIdAlt;
  if (a.idv) return a.idv;
  if (a.tagElectronic) return formatEidReadable(a.tagElectronic);
  return '—';
}

/**
 * Tag electrónico MUTED (secundario) para confirmar la lectura BLE debajo de la caravana visual. Solo se
 * muestra cuando la identidad dominante NO es ya el tag (es decir, cuando hay visual/idv): si el animal no
 * tiene caravana visual, el tag ya subió a dominante (displayIdentity) → no lo repetimos abajo. Devuelve
 * null si no hay tag o si el tag ya es la identidad dominante.
 */
function mutedTag(a: AnimalDetail): string | null {
  if (!a.tagElectronic) return null;
  // ¿El tag YA es la identidad dominante? (no hay visual ni idv) → no repetirlo muted.
  if (!a.visualIdAlt && !a.idv) return null;
  return formatEidReadable(a.tagElectronic);
}

/** ISO 'YYYY-MM-DD' de hoy (wall-clock del dispositivo) para event_date. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Error de captura superficiado en la UI: línea accionable es-AR + detalle crudo (atenuado, diagnóstico). */
type CaptureError = { message: string; detail: string };

/**
 * Construye el error de captura accionable es-AR cuando el write LOCAL de una maniobra FALLA (R5.7/R10.8).
 * El operario está en la manga: la línea principal le dice QUÉ HACER (reintentar), no jerga técnica; el
 * detalle crudo (message del SDK/SQLite) va atenuado abajo, para que Raf/soporte puedan diagnosticar.
 */
function buildCaptureError(detail: string): CaptureError {
  return {
    message:
      'No se pudo guardar la maniobra. Tocá de nuevo para reintentar; si sigue fallando, revisá la conexión con la app.',
    detail,
  };
}

export default function ManiobraCarga() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ sessionId?: string; profileId?: string }>();
  const sessionId = Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId;
  const profileId = Array.isArray(params.profileId) ? params.profileId[0] : params.profileId;

  const [session, setSession] = useState<Session | null>(null);
  const [animal, setAnimal] = useState<AnimalDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Estado de la secuencia: paso actual, valores capturados, modo (paso vs resumen).
  const [mode, setMode] = useState<FrameMode>('step');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [captured, setCaptured] = useState<CaptureMap>({});
  // Capturas de las maniobras CUSTOM del animal (R13.8): por field_definition_id (paralelo a `captured`).
  const [customCaptured, setCustomCaptured] = useState<CustomCaptureMap>({});
  // Maniobras CUSTOM enabled en el rodeo del animal (enriquecidas con ui_component/options, tweak M1 §11.7 +
  // render genérico M5-C.3). Se cargan cuando se conoce el rodeo; vacío hasta que un campo cree maniobras custom.
  const [customManeuvers, setCustomManeuvers] = useState<EnabledCustomManeuver[]>([]);
  // Error de PERSISTENCIA de la maniobra actual (R5.7/R10.8): si el write LOCAL falla (o tira), NO se
  // avanza y se SUPERFICIA un mensaje accionable es-AR debajo del paso (en vez de tragar el error y dejar
  // al operario tapeando sin que pase nada). Se limpia al re-intentar (nuevo tap) o al entrar a otro paso.
  const [captureError, setCaptureError] = useState<CaptureError | null>(null);
  // Guard de re-entrada del capture: un segundo tap mientras el write anterior está en vuelo NO debe
  // disparar un segundo persist/avance (doble-tap del operario apurado). Se libera al terminar (ok o error).
  const capturingRef = useRef(false);
  // ¿El paso actual se está corrigiendo DESDE el resumen (R5.9)? Si sí, al re-confirmar se vuelve al
  // resumen (no se continúa la secuencia). Se limpia al volver al resumen / pasar de animal.
  const editingFromSummaryRef = useRef(false);
  // Nonce que cambia cada vez que se ENTRA a un paso (avance o corrección desde el resumen) → fuerza el
  // REMOUNT del componente del paso (key) para que re-lea su valor inicial (p. ej. el keypad arranca con el
  // peso ya cargado al corregir). Sin esto, React reusa la instancia y el estado interno queda stale.
  const [stepEntryNonce, setStepEntryNonce] = useState(0);

  // Guard de doble-confirmación del animal (el setSessionCounts + navegación corren UNA vez).
  const confirmingRef = useRef(false);

  // id de cliente del evento ESTABLE por maniobra (UUID válido). Generado lazy la 1ra vez que se captura;
  // al CORREGIR desde el resumen (R5.9) se reusa el MISMO id → el re-INSERT pisa la fila por PK (LWW de
  // PowerSync) en vez de duplicar el evento. El `id` de las tablas de evento es `uuid` → debe ser un UUID
  // válido (un literal "<profile>:<maniobra>" rompería con 22P02 al subir). Se resetea al cambiar de animal.
  const eventIdsRef = useRef<Partial<Record<ManeuverKind, string>>>({});
  // ids ADICIONALES para las maniobras MULTI-WRITE (raspado = 2 lab_samples; vacunación = N sanitary_events):
  // un array ESTABLE de UUIDs válidos por maniobra (índice = el i-ésimo write extra). El orquestador
  // (buildManeuverEventQueries) usa `eventId` para el 1er write y `eventIds[i-1]` para los siguientes; su
  // fallback (`${eventId}-${i}`) NO es un UUID → rompería al subir (22P02). Por eso los generamos acá.
  const extraIdsRef = useRef<Partial<Record<ManeuverKind, string[]>>>({});
  // Cuántas filas escribió la ÚLTIMA captura de una maniobra MULTI-WRITE de conteo variable (vacunación).
  // Sirve para soft-deletear los huérfanos al CORREGIR con MENOS vacunas (de 2 → 1: la 2da fila ya escrita
  // no se pisa por re-INSERT, hay que borrarla). El raspado es fijo (2) → no necesita esto.
  const lastWriteCountRef = useRef<Partial<Record<ManeuverKind, number>>>({});
  // id de cliente de la CAPTURA custom ESTABLE por field_definition_id (custom_measurements tiene `id` REAL):
  // al CORREGIR desde el resumen (R5.9) se reusa el MISMO id → el re-INSERT pisa la fila por PK (LWW) en vez de
  // duplicar la medición. Se resetea al cambiar de animal.
  const customIdsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    eventIdsRef.current = {};
    extraIdsRef.current = {};
    lastWriteCountRef.current = {};
    customIdsRef.current = {};
    setCustomCaptured({});
  }, [profileId]);
  const customIdFor = useCallback((fieldDefId: string): string => {
    const existing = customIdsRef.current[fieldDefId];
    if (existing) return existing;
    const id = globalThis.crypto.randomUUID();
    customIdsRef.current[fieldDefId] = id;
    return id;
  }, []);
  const eventIdFor = useCallback((maneuver: ManeuverKind): string => {
    const existing = eventIdsRef.current[maneuver];
    if (existing) return existing;
    const id = globalThis.crypto.randomUUID();
    eventIdsRef.current[maneuver] = id;
    return id;
  }, []);
  // Devuelve `count` UUIDs ESTABLES adicionales para una maniobra multi-write (crece la lista on-demand y la
  // reusa al corregir → re-confirmar no duplica). count = (writes - 1): raspado → 1; vacunación de N → N-1.
  const extraIdsFor = useCallback((maneuver: ManeuverKind, count: number): string[] => {
    const list = extraIdsRef.current[maneuver] ?? [];
    while (list.length < count) list.push(globalThis.crypto.randomUUID());
    extraIdsRef.current[maneuver] = list;
    return list.slice(0, count);
  }, []);

  // ─── Carga de la sesión + el animal (lectura LOCAL, offline) ───
  useEffect(() => {
    // Sin sessionId (llegada inválida a la ruta) → error accionable, no spinner infinito.
    if (!sessionId) {
      setLoadError('No se encontró la jornada. Volvé a iniciar la maniobra.');
      return;
    }
    let active = true;
    void getSessionById(sessionId).then((r) => {
      if (!active) return;
      if (!r.ok) setLoadError(r.error.message);
      // Sesión inexistente/borrada (value null) → error, no spinner colgado (la jornada ya no está).
      else if (!r.value) setLoadError('La jornada ya no está disponible. Volvé a iniciar la maniobra.');
      else setSession(r.value);
    });
    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!profileId) {
      setLoadError('No se encontró el animal. Volvé a identificarlo.');
      return;
    }
    let active = true;
    void fetchAnimalDetail(profileId).then((r) => {
      if (!active) return;
      if (r.ok) setAnimal(r.value);
      else setLoadError(r.error.message);
    });
    return () => {
      active = false;
    };
  }, [profileId]);

  // Gating por el RODEO REAL del animal (R5.3): cuáles de las maniobras de la sesión aplican (R5.5).
  const gating = useManeuverGating(animal?.rodeoId ?? null);

  // Maniobras de la jornada (orden de config.maniobras, R5.14) — del jsonb pass-through, ya filtrado.
  const sessionManeuvers = useMemo<ManeuverKind[]>(
    () => (session ? extractManeuvers(session.config) : []),
    [session],
  );

  // Maniobras CUSTOM de la jornada en su orden (config.customManiobras, R13.8) — namespace paralelo.
  const sessionCustomIds = useMemo<string[]>(
    () => (session ? extractCustomManiobras(session.config) : []),
    [session],
  );

  // Maniobras CUSTOM enabled en el rodeo REAL del animal (R13.8/R13.10): se cargan al conocer el rodeo. La
  // barrera real es el gating capa 2 server-side (0096) al subir; acá filtramos por enabled del rodeo (capa 1).
  const animalRodeoId = animal?.rodeoId ?? null;
  useEffect(() => {
    if (!animalRodeoId) {
      setCustomManeuvers([]);
      return;
    }
    let active = true;
    void fetchEnabledCustomManeuvers(animalRodeoId).then((r) => {
      if (!active) return;
      setCustomManeuvers(r.ok ? r.value : []);
    });
    return () => {
      active = false;
    };
  }, [animalRodeoId]);

  // Las maniobras custom de la SESIÓN (config.customManiobras) ∩ las ENABLED del rodeo, EN EL ORDEN de la
  // sesión, enriquecidas con ui_component/options para el renderer genérico. Una custom elegida en la jornada
  // que ya no esté enabled en el rodeo (o se haya borrado el field) se OMITE (paridad con el gating de fábrica).
  const customSequenceSpecs = useMemo<CustomManeuverSpec[]>(() => {
    if (customManeuvers.length === 0 || sessionCustomIds.length === 0) return [];
    const byId = new Map(customManeuvers.map((c) => [c.fieldDefinitionId, c]));
    const specs: CustomManeuverSpec[] = [];
    for (const id of sessionCustomIds) {
      const c = byId.get(id);
      if (c) {
        specs.push({
          fieldDefinitionId: c.fieldDefinitionId,
          uiComponent: c.uiComponent,
          label: c.label,
          options: c.options,
        });
      }
    }
    return specs;
  }, [customManeuvers, sessionCustomIds]);

  // La SECUENCIA del animal: orden de config ∩ gating del rodeo real (R5.14 + R5.5) ∩ aplicabilidad por
  // ATRIBUTOS del animal (R6.12: raspado solo machos → se salta en hembras/sexo desconocido), MÁS las maniobras
  // custom enabled de la jornada DESPUÉS (R13.8). Estable mientras no cambie el gating/animal/custom.
  const sequence = useMemo(() => {
    if (!animal || !session || gating.loading || gating.config === null) return [];
    const { applicable } = gating.filter(sessionManeuvers);
    // R6.12: filtra las maniobras que no aplican a ESTE animal por sus atributos (raspado en una hembra).
    const { applicable: perAnimal } = filterByAnimalApplicability(applicable, toApplicabilityInfo(animal));
    return buildSequence(sessionManeuvers, perAnimal, customSequenceSpecs);
  }, [animal, session, gating, sessionManeuvers, customSequenceSpecs]);

  // ¿El gating del rodeo aún no está USABLE? config null (no fetcheó aún) o config VACÍO mientras la sesión
  // TIENE maniobras (sync en curso: la fila del rodeo_data_config aún no bajó al SQLite local). Un rodeo de
  // cría SIEMPRE trae rodeo_data_config (trigger 0018) → un `{}` con maniobras de sesión = sync pendiente, NO
  // "el rodeo no habilita nada". Mientras esté pendiente seguimos en el spinner (no mostramos EmptySequence
  // prematuro). El hook re-carga en focus + cada `lastSyncedAt` → el config se llena y el spinner cede.
  const gatingNotUsableYet =
    animal != null &&
    gating.error === null &&
    (gating.config === null ||
      (sessionManeuvers.length > 0 && Object.keys(gating.config).length === 0));

  // Salvavidas: si el config nunca se llena (rodeo genuinamente sin config, o sync que no llega), tras un
  // máximo dejamos de esperar y mostramos la secuencia (vacía → EmptySequence) para no colgar el spinner.
  const [gatingWaitTimedOut, setGatingWaitTimedOut] = useState(false);
  useEffect(() => {
    if (!animal) return;
    setGatingWaitTimedOut(false);
    const t = setTimeout(() => setGatingWaitTimedOut(true), 30_000);
    return () => clearTimeout(t);
  }, [animal]);

  const gatingPending = !gatingWaitTimedOut && gatingNotUsableYet;

  // ¿Tenemos todo para renderizar el contenido (animal + sesión + gating usable)?
  const contentReady = !!animal && !!session && !gating.loading && !gatingPending;

  // Defensa en profundidad (bug s27): una vez que ya renderizamos contenido, una revalidación del gating en
  // background (focus/sync) NO debe blanquear la pantalla ni desmontar el paso en curso (perdería lo
  // tecleado). El fix del hook (stale-while-revalidate) ya evita que `gating.loading` re-flipee en el camino
  // común; este flag cubre cualquier flip transitorio residual SOLO del gating, sin esconder la carga inicial
  // genuina ni el caso real de que el animal/sesión todavía no resolvieron (ahí sí hay que esperar).
  const hasRenderedContentRef = useRef(false);
  if (contentReady) hasRenderedContentRef.current = true;

  const currentStep = sequence[currentIndex] ?? null;

  // ─── Persistir el valor de una maniobra + avanzar (R5.8) ───
  //
  // FAIL-CLOSED (R5.7/R10.8): la persistencia local SE VERIFICA. Si el write local FALLA (devuelve ok:false)
  // o TIRA (excepción inesperada — p. ej. el DB local no booteó), NO se avanza y se superficia un mensaje
  // accionable es-AR debajo del paso. Antes este error se TRAGABA (`void captureAndAdvance(...)` sin
  // try/catch + sin chequear el ServiceResult) → el operario tapeaba y no pasaba nada, sin feedback. El
  // rechazo de SYNC server-side (gating capa 2 / tenant-check) es PERMANENTE pero asíncrono: NO llega acá
  // (el write local ya devolvió ok) — lo maneja uploadData + el canal de status (R10.8). Acá cubrimos el
  // fallo del write LOCAL (offline-first: si el SQLite local no acepta el INSERT, hay un problema real).
  const captureAndAdvance = useCallback(
    async (maneuver: ManeuverKind, value: StepValue) => {
      if (!profileId || !sessionId) return;
      // Doble-tap del operario apurado: si ya hay una captura en vuelo, ignoramos el segundo tap.
      if (capturingRef.current) return;
      capturingRef.current = true;
      // Re-intento: limpiamos cualquier error previo al arrancar un nuevo intento de captura.
      setCaptureError(null);
      try {
        // ¿La maniobra YA tenía un evento PERSISTIDO? (corrección desde el resumen, R5.9) → UPDATE; si no →
        // INSERT (1ra captura). Una captura previa `skipped` NO contó como persistida (placeholder M3).
        const prev = captured[maneuver];
        const isCorrection = prev != null && prev.kind !== 'skipped';
        // 1.bis) DIENTES/CUT (R6.8): el orquestador necesita el `category_id` a fijar. Si el operario CONFIRMÓ
        //   CUT → el id de la categoría CUT del sistema; si REGISTRA SIN CUT / DESMARCA (corrección) → la
        //   categoría DERIVADA (para revertir consistentemente). Se resuelve del catálogo LOCAL (offline). Si
        //   no se resuelve, queda null → el orquestador solo setea teeth_state (fail-safe, R6.8/§M3.1).
        let cutCategoryId: string | null = null;
        if (value.kind === 'dientes') {
          const catRes = await resolveCutCategory(profileId);
          if (catRes.ok) {
            cutCategoryId = value.cut ? catRes.value.cutCategoryId : catRes.value.derivedCategoryId;
          }
        }
        // 1.ter) ids ADICIONALES para las maniobras MULTI-WRITE (raspado = 2 lab_samples; vacunación = N
        //   sanitary_events). count = writes-1: raspado siempre 1 (2do tubo); vacunación = N-1 (1 por vacuna
        //   extra). UUIDs estables (reusa al corregir → no duplica). Las demás maniobras no usan eventIds.
        let eventIds: string[] | undefined;
        if (value.kind === 'lab_double') {
          eventIds = extraIdsFor(maneuver, 1); // [campylo] (el tricho usa eventId)
        } else if (value.kind === 'vaccination') {
          // El orquestador usa eventId para la vacuna 0 y eventIds[i-1] para la vacuna i≥1 → necesita
          // (N-1) ids para N vacunas. 0/1 vacuna → no hace falta ningún id extra.
          const products = value.products.filter((p) => p.trim().length > 0);
          const newCount = products.length;
          eventIds = newCount > 1 ? extraIdsFor(maneuver, newCount - 1) : undefined;
          // CORRECCIÓN con MENOS vacunas (R5.9): las filas extra ya escritas no se pisan por el re-INSERT →
          // soft-delete de los huérfanos. ids por índice: 0 = eventId; i≥1 = extraIds[i-1].
          const lastCount = lastWriteCountRef.current[maneuver] ?? 0;
          if (lastCount > newCount) {
            const allExtras = extraIdsFor(maneuver, Math.max(lastCount - 1, 0));
            const idAt = (i: number) => (i === 0 ? eventIdFor(maneuver) : allExtras[i - 1]);
            const orphans: string[] = [];
            for (let i = newCount; i < lastCount; i++) {
              const oid = idAt(i);
              if (oid) orphans.push(oid);
            }
            if (orphans.length > 0) {
              const del = await softDeleteManeuverEvents('sanitary_events', orphans);
              // Si el soft-delete de los huérfanos falla, NO confirmamos la corrección (quedarían filas de
              // más): superficiamos y no avanzamos.
              if (!del.ok) {
                setCaptureError(buildCaptureError(del.error.message));
                return;
              }
            }
          }
          lastWriteCountRef.current[maneuver] = newCount;
        }
        // FALLA DE PERSISTENCIA INYECTADA (solo E2E, ver _components/maneuver-e2e-fault.ts): si Playwright
        // armó la marca, tratamos esta captura como un fallo de write local (mismo path que un fallo real)
        // → superficiamos el banner y NO avanzamos. En prod/dev la marca no existe → false → cero efecto.
        if (consumeManeuverPersistFault()) {
          setCaptureError(buildCaptureError('e2e: fallo de persistencia inyectado'));
          return;
        }
        // 2) Persistir el evento con session_id (CRUD-plano offline). Las skipped (placeholder) no persisten
        //    (el orquestador devuelve ok:true persisted:false). El rechazo real de sync lo maneja uploadData.
        const res = await persistManeuverEvent({
          maneuver,
          value,
          profileId,
          sessionId,
          eventDate: todayIso(),
          createdAt: new Date().toISOString(),
          eventId: eventIdFor(maneuver),
          eventIds,
          isCorrection,
          cutCategoryId,
        });
        // FAIL-CLOSED: el write local NO se pudo guardar → NO avanzamos, superficiamos el error (R5.7/R10.8).
        if (!res.ok) {
          setCaptureError(buildCaptureError(res.error.message));
          return;
        }
        // Recién con el write local CONFIRMADO guardamos en el mapa local (resumen + corrección) y avanzamos.
        setCaptured((c) => ({ ...c, [maneuver]: value }));
        // 3) Avanzar: si veníamos del resumen (corrección R5.9) → volver al resumen; si no, secuencia normal:
        //    último paso → resumen; intermedio → siguiente paso.
        if (editingFromSummaryRef.current) {
          editingFromSummaryRef.current = false;
          setMode('summary');
          return;
        }
        setCurrentIndex((i) => {
          const next = i + 1;
          if (next >= sequence.length) {
            setMode('summary');
            return i;
          }
          return next;
        });
        setStepEntryNonce((n) => n + 1); // nuevo paso → remount limpio del componente del paso
      } catch (err) {
        // Excepción INESPERADA (no un ServiceResult ok:false): p. ej. el DB local no booteó / un throw del
        // SDK. Antes se tragaba (void + sin try/catch) → "no avanza" silencioso. Ahora se superficia.
        const message = err instanceof Error ? err.message : String(err);
        setCaptureError(buildCaptureError(message));
      } finally {
        capturingRef.current = false;
      }
    },
    [profileId, sessionId, sequence.length, eventIdFor, extraIdsFor, captured],
  );

  // ─── Persistir el valor de una maniobra CUSTOM + avanzar (R13.8/R13.11) ───
  //
  // Espeja captureAndAdvance pero para custom_measurements (append-only, value tipado por ui_component). El
  // gating capa 2 genérico + la validación de value (0096) re-validan server-side al SUBIR (no acá); el rechazo
  // lo maneja uploadData (R10.8). FAIL-CLOSED igual que las de fábrica: si el write LOCAL falla, NO avanza y
  // superficia. La corrección desde el resumen (R5.9) reusa el MISMO id de captura (customIdFor) → LWW, sin
  // duplicar la medición.
  const captureCustomAndAdvance = useCallback(
    async (fieldDefinitionId: string, value: CustomCaptureValue) => {
      if (!profileId || !sessionId) return;
      if (capturingRef.current) return;
      capturingRef.current = true;
      setCaptureError(null);
      try {
        // Falla inyectada (solo E2E, mismo hook que las de fábrica) → superficia y NO avanza.
        if (consumeManeuverPersistFault()) {
          setCaptureError(buildCaptureError('e2e: fallo de persistencia inyectado'));
          return;
        }
        // ¿La maniobra custom YA tenía una captura? (corrección desde el resumen, R5.9) → UPDATE; si no → INSERT.
        const isCorrection = customCaptured[fieldDefinitionId] != null;
        const res = await addCustomMeasurement({
          animalProfileId: profileId,
          fieldDefinitionId,
          value: toCustomValue(value),
          sessionId,
          // id ESTABLE por field_def: corregir reusa el id → UPDATE explícito de la misma fila (no duplica).
          id: customIdFor(fieldDefinitionId),
          isCorrection,
        });
        if (!res.ok) {
          setCaptureError(buildCaptureError(res.error.message));
          return;
        }
        setCustomCaptured((c) => ({ ...c, [fieldDefinitionId]: value }));
        if (editingFromSummaryRef.current) {
          editingFromSummaryRef.current = false;
          setMode('summary');
          return;
        }
        setCurrentIndex((i) => {
          const next = i + 1;
          if (next >= sequence.length) {
            setMode('summary');
            return i;
          }
          return next;
        });
        setStepEntryNonce((n) => n + 1);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setCaptureError(buildCaptureError(message));
      } finally {
        capturingRef.current = false;
      }
    },
    [profileId, sessionId, sequence.length, customIdFor, customCaptured],
  );

  // ─── Corregir desde el resumen: volver a un paso (R5.9) ───
  const onEdit = useCallback((index: number) => {
    editingFromSummaryRef.current = true;
    setCaptureError(null); // entrar a un paso limpio: no arrastrar el error de un intento anterior.
    setCurrentIndex(index);
    setMode('step');
    setStepEntryNonce((n) => n + 1); // entrar a corregir → remount con el valor ya cargado
  }, []);

  // ─── Confirmar el animal → contador++ → siguiente animal (R5.10) ───
  const onConfirmAnimal = useCallback(async () => {
    if (!sessionId || confirmingRef.current) return;
    confirmingRef.current = true;
    // Contador app-maintained absoluto (D5): animal_count actual + 1 (event_count lo lleva M3/M4 — acá no
    // contamos eventos por maniobra, solo animales procesados). setSessionCounts es offline (CRUD-plano).
    const nextAnimalCount = (session?.animalCount ?? 0) + 1;
    await setSessionCounts(sessionId, nextAnimalCount, session?.eventCount ?? 0);
    // Volver a la identificación con la sesión intacta → siguiente animal de la fila.
    router.replace({ pathname: '/maniobra/identificar', params: { sessionId } });
  }, [router, sessionId, session]);

  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  // ─── Estados de carga / error ───
  if (loadError) {
    return (
      <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top} alignItems="center" justifyContent="center" paddingHorizontal="$5" gap="$3">
        <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" textAlign="center">
          No se pudo abrir el animal
        </Text>
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center">
          {loadError}
        </Text>
      </YStack>
    );
  }

  // El spinner full-screen "Abriendo el animal…" SOLO en la carga INICIAL:
  //  - animal/sesión todavía no resolvieron (no hay NADA que mostrar — siempre se espera), o
  //  - el gating del rodeo aún no está usable Y todavía no renderizamos contenido (primera vez).
  // Si ya mostramos un paso, un flip transitorio del gating NO vuelve al spinner (no desmonta el paso en
  // curso). `animal`/`session` se setean una vez y no se resetean a null (efectos sobre route params).
  // El check de animal/sesión va explícito (no en una variable booleana) para que TS narrowée a no-null abajo.
  const gatingSpinner = (gating.loading || gatingPending) && !hasRenderedContentRef.current;

  if (!animal || !session || gatingSpinner) {
    return (
      <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top} alignItems="center" justifyContent="center" gap="$3">
        <Spinner size="large" color="$primary" />
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted">
          Abriendo el animal…
        </Text>
      </YStack>
    );
  }

  // Header de identidad real (R5.1/R12.4): caravana VISUAL dominante + tag electrónico muted + rodeo +
  // categoría + contador de progreso (espeja identify-found.png: visual grande, electrónico abajo).
  const identity = displayIdentity(animal);
  const electronicMuted = mutedTag(animal);
  const progreso = `Animal ${(session.animalCount ?? 0) + 1}`;

  return (
    <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      {/* ── HEADER DE IDENTIDAD (sticky, SIEMPRE visible — R12.4) ── */}
      <SpikeIdentityHeader
        idv={identity}
        tagElectronic={electronicMuted}
        rodeo={animal.rodeoName || '—'}
        categoria={animal.categoryName || '—'}
        progreso={progreso}
      />

      {mode === 'summary' ? (
        <AnimalSummary
          rows={summaryRows(sequence, captured, customCaptured)}
          onEdit={onEdit}
          onConfirm={onConfirmAnimal}
        />
      ) : sequence.length === 0 ? (
        // Ninguna maniobra aplica a este animal en su rodeo (R5.5) → directo al resumen vacío (no frena la fila).
        <EmptySequence onConfirm={onConfirmAnimal} bottomPad={bottomPad} />
      ) : currentStep ? (
        <>
          {/* ── LÍNEA DE MANIOBRA + CONTADOR "Tacto · 2 de 4" (R5.14, sobre la secuencia filtrada combinada) ──
                ROBUSTEZ a labels largos (las custom también pueden ser largas): el label = flex/minWidth:0 +
                numberOfLines → elipsa con "…"; el contador = flexShrink:0 → nunca se recorta. El label es el
                maneuverLabel es-AR (fábrica) o el label del field custom (R13.8). ── */}
          <XStack paddingHorizontal="$4" paddingTop="$3" paddingBottom="$2" alignItems="center" gap="$2">
            <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
              {currentStep.source === 'custom' ? currentStep.custom.label : maneuverLabel(currentStep.maneuver)}
            </Text>
            <Text flexShrink={0} fontFamily="$body" fontSize="$5" lineHeight="$5" color="$textFaint" numberOfLines={1}>
              · {currentStep.position} de {currentStep.total}
            </Text>
          </XStack>

          {/* ── BANNER DE ERROR DE PERSISTENCIA (R5.7/R10.8): el write local falló → NO se avanzó. Mensaje
                accionable es-AR (reintentar) + detalle atenuado para diagnóstico. Visible solo cuando hay error. ── */}
          {captureError ? <ManeuverErrorBanner error={captureError} /> : null}

          {/* ── PASO ACTUAL (dispatcher por source). La key (item key + nonce de entrada) fuerza remount al
                avanzar/corregir → el paso re-lee su valor inicial. Custom → renderer genérico por ui_component
                (CustomManeuverStep, R13.8) → custom_measurements; fábrica → el dispatcher por StepKind. ── */}
          {currentStep.source === 'custom' ? (
            <CustomManeuverStep
              key={`${sequenceItemKey(currentStep)}-${stepEntryNonce}`}
              uiComponent={currentStep.custom.uiComponent}
              options={currentStep.custom.options}
              initialValue={customCaptured[currentStep.custom.fieldDefinitionId] ?? null}
              bottomPad={bottomPad}
              onConfirm={(value) =>
                void captureCustomAndAdvance(currentStep.custom.fieldDefinitionId, value)
              }
            />
          ) : (
            <ManeuverStep
              key={`${currentStep.maneuver}-${stepEntryNonce}`}
              maneuver={currentStep.maneuver}
              captured={captured[currentStep.maneuver]}
              animal={animal}
              config={session.config}
              bottomPad={bottomPad}
              onCapture={(value) => void captureAndAdvance(currentStep.maneuver, value)}
            />
          )}
        </>
      ) : null}
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// DISPATCHER GENÉRICO de render por maniobra (el SEAM de M3). Resuelve el StepKind y renderiza el paso.
// M3 agrega un `case` por StepKind nuevo — el frame (arriba) no cambia.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ManeuverStep({
  maneuver,
  captured,
  animal,
  config,
  bottomPad,
  onCapture,
}: {
  maneuver: ManeuverKind;
  captured: StepValue | undefined;
  /** El animal real — para los pasos que dependen de sus atributos (dientes: gate del prompt CUT, R6.8). */
  animal: AnimalDetail;
  /** El config jsonb de la sesión (pass-through) — para el preconfig de tanda de las sanitarias (R1.7/R1.8). */
  config: unknown;
  bottomPad: number;
  onCapture: (value: StepValue) => void;
}) {
  const kind = stepKindFor(maneuver);
  // Preconfig de tanda + histórico de autocompletar (R1.7/R1.8) para los pasos silent_apply (sanitarias).
  const parsedConfig = parseManeuverConfig(config);
  const history = preconfigHistory(parsedConfig);
  switch (kind) {
    case 'tacto':
      return (
        <TactoStep
          bottomPad={bottomPad}
          onConfirm={(status: PregnancyStatus) => onCapture({ kind: 'tacto', pregnancy: status })}
        />
      );
    case 'vaquillona':
      // Tacto vaquillona (R6.3): apta / no_apta / diferida → reproductive_events tacto_vaquillona.
      return (
        <TactoVaquillonaStep
          bottomPad={bottomPad}
          onConfirm={(fitness) => onCapture({ kind: 'vaquillona', fitness })}
        />
      );
    case 'score':
      // Condición corporal (R6.6): stepper 1,00–5,00 step 0,25 → condition_score_events.
      return (
        <CondicionCorporalStep
          bottomPad={bottomPad}
          initialScore={captured?.kind === 'score' ? captured.score : null}
          onConfirm={(score) => onCapture({ kind: 'score', score })}
        />
      );
    case 'dientes':
      // Dientes (R6.7) = propiedad teeth_state; prompt CUT (R6.8) si boca de descarte y NO ternero. El gate
      // "no ternero" lo decide shouldOfferCutPrompt con la categoría real → le pasamos sex + categoryCode.
      return (
        <DientesStep
          bottomPad={bottomPad}
          animal={toApplicabilityInfo(animal)}
          onConfirm={(teethState, cut) => onCapture({ kind: 'dientes', teethState, cut })}
        />
      );
    case 'pesaje':
      // Pesaje (R6.9) y pesaje de ternero (R6.10) comparten el keypad. El ternero se autocompleta su
      // categoría (ternero/ternera) por el espejo C6 → el header ya la muestra; el vínculo con la madre viene
      // de birth_calves (no se re-captura). El write-path es weight_events (igual) → mismo PesajeStep.
      return (
        <PesajeStep
          bottomPad={bottomPad}
          initialWeightKg={captured?.kind === 'pesaje' ? captured.weightKg : null}
          onConfirm={(weightKg: number) => onCapture({ kind: 'pesaje', weightKg })}
        />
      );
    case 'silent_single': {
      // Antiparasitario (deworming, R6.13) / Antibiótico (treatment, R6.15): silent_apply de UN producto.
      // El eventType lo determina la maniobra (NO el usuario); el producto sale de la preconfig de tanda.
      const eventType: SilentSanitaryType = maneuver === 'antiparasitario' ? 'deworming' : 'treatment';
      return (
        <SilentSanitaryStep
          title={maneuverLabel(maneuver)}
          preconfigProduct={preconfigStringFor(parsedConfig, maneuver)}
          initialProduct={captured?.kind === 'sanitary' ? captured.productName : undefined}
          history={history}
          bottomPad={bottomPad}
          onConfirm={(productName) => onCapture({ kind: 'sanitary', eventType, productName })}
        />
      );
    }
    case 'silent_multi':
      // Vacunación (R6.1): silent_apply MULTI (N vacunas → N sanitary_events vaccination). Vacunas de la
      // tanda (preconfig) pre-cargadas como chips, editables.
      return (
        <SilentVaccinationStep
          initialProducts={
            captured?.kind === 'vaccination'
              ? captured.products
              : splitMultiPreconfig(preconfigStringFor(parsedConfig, maneuver))
          }
          history={history}
          bottomPad={bottomPad}
          onConfirm={(products) => onCapture({ kind: 'vaccination', products })}
        />
      );
    case 'lab_single':
      // Sangrado brucelosis (R6.4): 1 número de tubo → lab_samples blood.
      return (
        <LabSampleStep
          bottomPad={bottomPad}
          initialTube={captured?.kind === 'lab' ? captured.tubeNumber : ''}
          onConfirm={(tubeNumber) => onCapture({ kind: 'lab', tubeNumber })}
        />
      );
    case 'lab_double':
      // Raspado de toros (R6.11, solo machos R6.12): 2 números de tubo → 2 lab_samples scrape_*. El skip de
      // hembras lo hace maneuver-applicability ANTES (la maniobra no entra a la secuencia de una hembra).
      return (
        <LabDoubleStep
          bottomPad={bottomPad}
          initialTricho={captured?.kind === 'lab_double' ? captured.tubeTricho : ''}
          initialCampylo={captured?.kind === 'lab_double' ? captured.tubeCampylo : ''}
          onConfirm={(tubeTricho, tubeCampylo) =>
            onCapture({ kind: 'lab_double', tubeTricho, tubeCampylo })
          }
        />
      );
    case 'inseminacion':
      // Inseminación (R6.5): pajuela de la tanda. 1 → confirmar de un toque (silent_apply single); >1 →
      // selector. Persiste reproductive_events service ai (M3.1; la pajuela en notes). La pajuela por texto
      // libre + autocompletar (R1.8).
      return (
        <InseminacionStep
          availablePajuelas={pajuelasFor(parsedConfig)}
          initialPajuela={captured?.kind === 'inseminacion' ? captured.semenName : undefined}
          history={history}
          bottomPad={bottomPad}
          onConfirm={(semenName) => onCapture({ kind: 'inseminacion', semenName })}
        />
      );
    default:
      return (
        <PlaceholderStep
          maneuverLabel={maneuverLabel(maneuver)}
          bottomPad={bottomPad}
          onSkip={() => onCapture({ kind: 'skipped' })}
        />
      );
  }
}

/** Subset de atributos del animal que la aplicabilidad per-animal necesita (R6.8 prompt CUT no-terneros). */
function toApplicabilityInfo(animal: AnimalDetail): AnimalApplicabilityInfo {
  return { sex: animal.sex, categoryCode: animal.categoryCode || null };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// BANNER DE ERROR DE PERSISTENCIA (R5.7/R10.8) — el write LOCAL de la maniobra FALLÓ → NO se avanzó. Antes
// el error se tragaba (`void captureAndAdvance` sin try/catch ni chequeo del ServiceResult) → el operario
// tapeaba PREÑADA/VACÍA y no pasaba nada, SIN feedback (el bug que reportó Raf). Ahora se superficia: línea
// accionable es-AR (reintentar) + detalle atenuado para diagnóstico. Anclado bajo la línea de maniobra,
// sobre el paso (no roba el área de acción de los botones gigantes — se reintenta tapeando de nuevo).
// Terracota (no rojo del DS — no hay token de error; terracota es el color de aviso/advertencia del DS).
// Recorte de descendentes: ambos Text llevan lineHeight matching.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function ManeuverErrorBanner({ error }: { error: CaptureError }) {
  return (
    <YStack
      testID="maneuver-capture-error"
      marginHorizontal="$4"
      marginBottom="$2"
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$terracota"
      borderRadius="$card"
      paddingHorizontal="$4"
      paddingVertical="$3"
      gap="$1"
      {...labelA11y(Platform.OS, error.message)}
    >
      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$terracota" numberOfLines={3}>
        {error.message}
      </Text>
      {error.detail ? (
        <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="500" color="$textFaint" numberOfLines={2}>
          {error.detail}
        </Text>
      ) : null}
    </YStack>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// SECUENCIA VACÍA — ninguna maniobra de la sesión aplica a este animal en su rodeo (R5.5). No frena la
// fila: se confirma directo al siguiente animal.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
function EmptySequence({ onConfirm, bottomPad }: { onConfirm: () => void; bottomPad: number }) {
  return (
    <YStack flex={1} backgroundColor="$bg" paddingHorizontal="$4" paddingTop="$4" paddingBottom={bottomPad} gap="$4">
      <YStack flex={1} alignItems="center" justifyContent="center" gap="$3">
        <Text fontFamily="$heading" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary" textAlign="center" numberOfLines={2}>
          Sin maniobras para este animal
        </Text>
        <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted" textAlign="center">
          Ninguna maniobra de la jornada aplica a este animal en su rodeo. Pasá al siguiente.
        </Text>
      </YStack>
      <View
        testID="confirm-animal"
        backgroundColor="$primary"
        borderRadius="$pill"
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        pressStyle={{ backgroundColor: '$primaryPress' }}
        onPress={onConfirm}
        {...buttonA11y(Platform.OS, { label: 'Confirmar y pasar al siguiente animal' })}
      >
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          Siguiente animal
        </Text>
      </View>
    </YStack>
  );
}
