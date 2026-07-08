// app/agregar-evento.tsx — wizard "Agregar evento" (spec 02 frontend C3.1, R10/R14).
//
// Carga UNITARIA de un evento desde la ficha del animal. Patrón wizard de 2 pasos (mismo modelo
// mental que crear-rodeo, que funcionó):
//   PASO 1 — elegí el TIPO: 3 cards grandes con ícono (Peso / Condición corporal / Observación).
//   PASO 2 — el FORM del tipo elegido (con "Atrás" para cambiar de tipo). CTA confirmar grande
//            (zona pulgar). Al confirmar → insert (events.ts) → router.back() a la ficha (que
//            recarga el timeline por useFocusEffect, y el evento nuevo aparece arriba).
//
// Los 3 tipos de C3.1 son SIMPLES (sin efecto colateral de categoría/ternero): Peso, Condición
// corporal, Observación libre. Los reproductivos/sanitarios/lab/category_change son C3.2/C3.3.
//
// Recibe profileId + establishmentId por params (Expo Router). El establishmentId viene de la FICHA
// (derivado del PERFIL, no del contexto activo) — crítico para la observación: animal_events valida
// que su establishment_id coincida con el del perfil (error 23514 si no). Si faltan params, la
// pantalla no se rompe (muestra un error claro y solo deja volver).
//
// Criticidad 🟡. Validación EN EL CAMPO (prevenir, no errorear al submit): peso decimal vía
// sanitizeWeightInput, fecha vía maskDateInput, score por selector CERRADO (nunca texto libre),
// texto con maxLength. Cero hardcode (ADR-023 §4): tokens + componentes; íconos lucide con
// getTokenValue. Voseo es-AR. a11y por helper (utils/a11y).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput, type TextStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import {
  Activity,
  Baby,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  HeartCrack,
  HeartHandshake,
  Plus,
  StickyNote,
  Stethoscope,
  Trash2,
  Weight,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Button, CapturedTagRow, Card, ComboOptionRow, FormField, FormError, InfoNote, TagScanCta, TagScanSheet } from '@/components';
import { useBusyWhileMounted } from '@/services/ble/stick';
import { useRodeo } from '@/contexts';
import type { Rodeo } from '@/services/rodeos';
import {
  addWeight,
  addConditionScore,
  addObservation,
  addTacto,
  addService,
  addAbortion,
  registerBirth,
  fetchMotherRodeoContext,
} from '@/services/events';
import {
  sanitizeWeightInput,
  sanitizeIdvInput,
  maskDateInput,
} from '@/utils/animal-input';
import {
  resolveEffectiveCalfRodeoId,
  resolveMotherSystemId,
  eligibleCalfRodeos,
  canEditCalfRodeo,
  calfIdvForSubmit,
} from '@/utils/calf-birth';
import {
  CONDITION_SCORES,
  formatConditionScore,
  sanitizeObservationInput,
  validateWeight,
  validateEventDate,
  validateObservation,
  validateCalves,
  reproductiveWarning,
  OBSERVATION_MAX_LENGTH,
  PREGNANCY_OPTIONS,
  SERVICE_TYPE_INPUT_OPTIONS,
  SEX_OPTIONS,
  type CalfDraft,
} from '@/utils/event-input';
import type { PregnancyStatus } from '@/utils/event-timeline';

// Tipo de servicio OFERTABLE para la carga manual NUEVA (B3 / RPSC.6.1): IA o TE. La monta natural
// (`natural`) se deprecó de esta vía (servicio natural = nivel-rodeo). El enum DB `ServiceType` conserva
// `natural` para los históricos; acá solo usamos el subset que el operario puede crear a mano.
type ManualServiceType = (typeof SERVICE_TYPE_INPUT_OPTIONS)[number]['value'];
import { buttonA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';
import { confirmAction } from '@/utils/confirm';

const OFFLINE_COPY =
  'Necesitás conexión para cargar un evento. Conectate a internet y volvé a intentar.';

type EventType =
  | 'weight'
  | 'condition_score'
  | 'observation'
  | 'tacto'
  | 'service'
  | 'birth'
  | 'abortion';

// Título del diálogo de confirmación del aviso suave reproductivo, por tipo de evento (es-AR). Solo
// los eventos que pueden disparar el aviso (parto/servicio/aborto) lo necesitan.
const REPRO_DIALOG_TITLE: Partial<Record<EventType, string>> = {
  birth: 'Parto',
  service: 'Servicio',
  abortion: 'Aborto',
};

// Un ternero del form de parto, con un id LOCAL estable (no el índice del array): permite borrar un
// ternero del MEDIO sin que React confunda los keys (lección de listas dinámicas — key=índice rompe
// el reconciliado al remover). `sex`/`weightRaw`/`tagRaw` espejan CalfDraft (validateCalves). `idvRaw` =
// caravana VISUAL POR CRÍA (delta parto-caravana-visual-por-ternero, PCV.1.4): cada ternero lleva su idv en
// el estado → agregar/quitar un mellizo no mezcla ni pierde los idv de los demás.
type CalfRow = { localId: string; sex: 'male' | 'female' | null; weightRaw: string; tagRaw: string; idvRaw: string };

let calfIdSeq = 0;
function newCalf(): CalfRow {
  calfIdSeq += 1;
  return { localId: `calf-${calfIdSeq}`, sex: null, weightRaw: '', tagRaw: '', idvRaw: '' };
}

// Fecha de hoy en ISO 'YYYY-MM-DD' (local) para pre-cargar el campo de fecha (el caso típico es
// "cargar el evento de hoy" — el operario rara vez cambia la fecha).
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function AgregarEventoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Anti-stacking (RB2.2): mientras este form de carga de evento está montado, suspendemos el listener
  // global del bastón → un bastonazo NO abre el overlay find-or-create encima. No-op seguro hasta el mount
  // del provider en la raíz (Run 2 del chunk BLE global).
  useBusyWhileMounted();

  const params = useLocalSearchParams<{
    profileId?: string;
    establishmentId?: string;
    sex?: string;
    pregnant?: string;
    rodeoId?: string;
    rodeoName?: string;
  }>();
  const profileId = typeof params.profileId === 'string' ? params.profileId : null;
  const establishmentId =
    typeof params.establishmentId === 'string' ? params.establishmentId : null;
  // Rodeo de la madre por PARAMS (seed inmediato del picker del parto — evita el flash de "—" mientras el
  // read local resuelve + nombre del rodeo en el fallback cross-field RPRC.1.8). La resolución AUTORITATIVA
  // (rodeoId + systemId) la hace el read local de abajo (fetchMotherRodeoContext), uniforme para todo caller.
  const paramRodeoId = typeof params.rodeoId === 'string' && params.rodeoId ? params.rodeoId : null;
  const paramRodeoName =
    typeof params.rodeoName === 'string' && params.rodeoName ? params.rodeoName : null;
  // Los eventos REPRODUCTIVOS (tacto/servicio/parto) son SOLO de hembras. Gateamos la sección
  // "Reproductivo" del paso 1 por el sexo del animal (viene de la ficha). Conservador: solo `'female'`
  // exacto habilita reproductivo; macho o sexo ausente/desconocido → NO se ofrecen esos eventos.
  const isFemale = params.sex === 'female';
  // ¿La hembra FIGURA preñada en nuestros registros? Lo computa la ficha (deriveCurrentState) y lo pasa
  // como '1'/'0'. Solo '1' cuenta como preñada; cualquier otra cosa (ausente/'0'/desconocido) → NO
  // figura preñada → al registrar un PARTO mostramos el aviso suave (conservador). Ver onSubmit/birth.
  const figuresPregnant = params.pregnant === '1';

  const [step, setStep] = useState<1 | 2>(1);
  const [eventType, setEventType] = useState<EventType | null>(null);

  // Campos de peso.
  const [weightKg, setWeightKg] = useState('');
  const [weightDate, setWeightDate] = useState(todayIso());
  const [weightErr, setWeightErr] = useState<string | null>(null);
  const [weightDateErr, setWeightDateErr] = useState<string | null>(null);

  // Campos de condición corporal.
  const [score, setScore] = useState<number | null>(null);
  const [scoreDate, setScoreDate] = useState(todayIso());
  const [scoreErr, setScoreErr] = useState<string | null>(null);
  const [scoreDateErr, setScoreDateErr] = useState<string | null>(null);

  // Campos de observación.
  const [observation, setObservation] = useState('');
  const [observationErr, setObservationErr] = useState<string | null>(null);

  // Campos de tacto (reproductivo).
  const [pregnancyStatus, setPregnancyStatus] = useState<PregnancyStatus | null>(null);
  const [tactoDate, setTactoDate] = useState(todayIso());
  const [tactoStatusErr, setTactoStatusErr] = useState<string | null>(null);
  const [tactoDateErr, setTactoDateErr] = useState<string | null>(null);

  // Campos de servicio (reproductivo). Notas OPCIONALES. Tipo restringido a IA/TE (B3: monta natural
  // deprecada de la carga manual). addService acepta el enum completo → el subset es válido.
  const [serviceType, setServiceType] = useState<ManualServiceType | null>(null);
  const [serviceDate, setServiceDate] = useState(todayIso());
  const [serviceNotes, setServiceNotes] = useState('');
  const [serviceTypeErr, setServiceTypeErr] = useState<string | null>(null);
  const [serviceDateErr, setServiceDateErr] = useState<string | null>(null);
  const [serviceNotesErr, setServiceNotesErr] = useState<string | null>(null);

  // Campos de parto (reproductivo). Lista dinámica de terneros (default 1, R9.5 mellizos).
  const [birthDate, setBirthDate] = useState(todayIso());
  const [calves, setCalves] = useState<CalfRow[]>(() => [newCalf()]);
  const [birthDateErr, setBirthDateErr] = useState<string | null>(null);
  const [calvesErr, setCalvesErr] = useState<string | null>(null);
  // Delta parto-rodeo-caravana (#4/#1a): rodeo a nivel PARTO (toda la camada). `calfRodeoId` = null → usar el
  // de la madre (RPRC.1.2); un valor = rodeo editado (RPRC.1.5). La caravana VISUAL (idv) ya NO vive acá a
  // nivel camada: pasó a ser POR CRÍA (cada CalfRow.idvRaw, delta parto-caravana-visual-por-ternero PCV.1).
  const [calfRodeoId, setCalfRodeoId] = useState<string | null>(null);
  const [rodeoPickerOpen, setRodeoPickerOpen] = useState(false);
  // Sheet de BASTONEO de la caravana electrónica POR TERNERO (delta bastoneo-captura-alta-parto, RCF.6
  // generalizado, modo CAPTURA). Solo UN sheet abierto a la vez → trackeamos el localId del ternero que está
  // escaneando (más robusto que un índice: inmune a reordenamientos, aunque con el sheet abierto la lista no
  // se puede mutar). null = ningún sheet. El scoped scanner se adquiere/suelta UNA vez por apertura.
  const [scanCalfLocalId, setScanCalfLocalId] = useState<string | null>(null);
  // Rodeo/sistema de la madre resueltos DESDE LOCAL (offline, uniforme para todo caller — veto leader #1).
  const [motherCtx, setMotherCtx] = useState<{ rodeoId: string; systemId: string } | null>(null);

  // Campos de aborto (reproductivo). Fecha + notas OPCIONALES (mismo shape que el servicio).
  const [abortionDate, setAbortionDate] = useState(todayIso());
  const [abortionNotes, setAbortionNotes] = useState('');
  const [abortionDateErr, setAbortionDateErr] = useState<string | null>(null);
  const [abortionNotesErr, setAbortionNotesErr] = useState<string | null>(null);

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);

  const missingParams = !profileId;

  const muted = getTokenValue('$textMuted', 'color');

  // ── Rodeo del parto (delta parto-rodeo-caravana, RPRC.1). ──
  // Rodeos del campo activo (lectura LOCAL vía useRodeo → offline, RPRC.4.4). `available` = [] si el contexto
  // no está `active` (loading/no_rodeos) → dispara el fallback no-editable (RPRC.1.8).
  const { state: rodeoState } = useRodeo();
  const availableRodeos = rodeoState.status === 'active' ? rodeoState.available : [];

  // Read LOCAL del perfil de la madre → rodeoId + systemId AUTORITATIVOS (uniforme para todo caller que pase
  // profileId, offline). El nombre lo resuelve la UI desde availableRodeos ?? el param. Solo corre con
  // profileId (no depende del eventType: es barato y deja el picker listo si el operario elige "Parto").
  useEffect(() => {
    let alive = true;
    if (!profileId) {
      setMotherCtx(null);
      return;
    }
    void fetchMotherRodeoContext(profileId).then((r) => {
      if (!alive) return;
      setMotherCtx(r.ok ? r.value : null);
    });
    return () => {
      alive = false;
    };
  }, [profileId]);

  // Resolución del rodeo de la madre (read local primero; params como seed/fallback del id y nombre).
  const motherRodeoId = motherCtx?.rodeoId ?? paramRodeoId;
  // systemId: read local primero; si aún no resolvió, el helper lo deriva de availableRodeos (RPRC.1.6).
  const motherSystemId = motherCtx?.systemId ?? resolveMotherSystemId(availableRodeos, motherRodeoId);
  const eligibleRodeos = useMemo(
    () => eligibleCalfRodeos(availableRodeos, motherSystemId),
    [availableRodeos, motherSystemId],
  );
  const canEditRodeo = canEditCalfRodeo(eligibleRodeos, motherRodeoId);
  const effectiveCalfRodeoId = resolveEffectiveCalfRodeoId(calfRodeoId, motherRodeoId);
  const isSameRodeoAsMother = effectiveCalfRodeoId === motherRodeoId;
  // Nombre a mostrar en el trigger: el del rodeo efectivo (desde availableRodeos) ?? el param de la madre ?? "—".
  const effectiveRodeoName =
    availableRodeos.find((r) => r.id === effectiveCalfRodeoId)?.name ?? paramRodeoName ?? '—';

  // Destino de fallback para el "Volver" robusto (backOr): volvemos a la FICHA del animal
  // (de donde se llega a "Agregar evento"). Si faltan params (profileId null), caemos a la tab
  // Animales en vez de romper. Solo se usa cuando el stack está vacío (web-refresh / hot-reload /
  // deep-link / cold-start en ruta profunda) — el caso normal sigue siendo router.back().
  const backFallback: Href = useMemo(
    () =>
      profileId
        ? { pathname: '/animal/[id]', params: { id: profileId } }
        : '/(tabs)/animales',
    [profileId],
  );

  const onChooseType = useCallback((t: EventType) => {
    setEventType(t);
    setFormError(null);
    setStep(2);
  }, []);

  const goBack = useCallback(() => {
    setFormError(null);
    if (step === 2) {
      setStep(1);
      return;
    }
    backOr(router, backFallback);
  }, [step, router, backFallback]);

  // ── Handlers de la lista dinámica de terneros (parto, R9.5). ──
  const addCalf = useCallback(() => {
    setCalves((prev) => [...prev, newCalf()]);
    setCalvesErr(null);
  }, []);

  const removeCalf = useCallback((localId: string) => {
    // Mantenemos el mínimo de 1 ternero: nunca quedamos en 0 (un parto tiene al menos un ternero).
    setCalves((prev) => (prev.length <= 1 ? prev : prev.filter((c) => c.localId !== localId)));
    setCalvesErr(null);
  }, []);

  const updateCalf = useCallback((localId: string, patch: Partial<Omit<CalfRow, 'localId'>>) => {
    setCalves((prev) => prev.map((c) => (c.localId === localId ? { ...c, ...patch } : c)));
    setCalvesErr(null);
  }, []);

  const finishSubmit = useCallback(
    (r: { ok: true } | { ok: false; error: { kind: string; message: string } }) => {
      setSubmitting(false);
      busyRef.current = false;
      if (!r.ok) {
        setFormError(r.error.kind === 'network' ? OFFLINE_COPY : r.error.message);
        return;
      }
      // Volvemos a la ficha: useFocusEffect recarga el timeline → el evento nuevo aparece arriba.
      // backOr: si el stack está vacío (web-refresh / deep-link / cold-start) router.back() fallaría
      // y dejaría al operario trabado tras GUARDAR — caemos a la ficha del animal (backFallback).
      backOr(router, backFallback);
    },
    [router, backFallback],
  );

  const onSubmit = useCallback(async () => {
    if (busyRef.current || !profileId || !eventType) return;
    setFormError(null);

    // AVISO SUAVE (no bloqueo) de los eventos reproductivos vs. el estado de preñez que figura en
    // nuestros registros: parto/aborto sobre hembra NO preñada, o servicio sobre hembra SÍ preñada →
    // confirmación "¿registrar igual?". reproductiveWarning(eventType, figuresPregnant) devuelve el copy
    // o null.
    //
    // PRECONDICIÓN: el caller ya tomó el re-entrancy guard (busyRef.current = true) ANTES de invocar
    // esta función — SINCRÓNICAMENTE tras validar, sin await de por medio (en native el Alert es async y
    // el botón sigue habilitado mientras está abierto → un doble-tap abriría un 2do Alert). Esta función
    // solo muestra el diálogo (si corresponde) y LIBERA el guard si el operario cancela; devuelve true
    // si hay que proceder, false si canceló. Si no hay aviso, retorna true sin diálogo (no-op).
    const confirmReproIfNeeded = async (): Promise<boolean> => {
      const warning = reproductiveWarning(eventType, figuresPregnant);
      if (!warning) return true;
      const proceed = await confirmAction({
        title: REPRO_DIALOG_TITLE[eventType] ?? 'Evento',
        message: warning.message,
        confirmLabel: warning.confirmLabel,
      });
      if (!proceed) busyRef.current = false;
      return proceed;
    };

    // Validación por tipo (espejo del DB; feedback inmediato sin round-trip).
    if (eventType === 'weight') {
      const w = validateWeight(weightKg);
      const d = validateEventDate(weightDate);
      setWeightErr(w.ok ? null : w.error);
      setWeightDateErr(d.ok ? null : d.error);
      if (!w.ok || !d.ok) return;
      busyRef.current = true;
      setSubmitting(true);
      const r = await addWeight({ profileId, weightKg: w.value, weightDate: d.value });
      finishSubmit(r);
      return;
    }

    if (eventType === 'condition_score') {
      const d = validateEventDate(scoreDate);
      setScoreDateErr(d.ok ? null : d.error);
      if (score == null) {
        setScoreErr('Elegí la condición corporal.');
      } else {
        setScoreErr(null);
      }
      if (score == null || !d.ok) return;
      busyRef.current = true;
      setSubmitting(true);
      const r = await addConditionScore({ profileId, score, eventDate: d.value });
      finishSubmit(r);
      return;
    }

    if (eventType === 'observation') {
      const o = validateObservation(observation);
      setObservationErr(o.ok ? null : o.error);
      if (!o.ok) return;
      if (!establishmentId) {
        // Sin el establishment del perfil no podemos insertar la observación de forma segura (el
        // trigger validaría 23514). No improvisamos con el contexto activo.
        setFormError('No pudimos determinar el campo del animal. Volvé a abrir la ficha.');
        return;
      }
      busyRef.current = true;
      setSubmitting(true);
      const r = await addObservation({ profileId, establishmentId, text: o.value });
      finishSubmit(r);
      return;
    }

    if (eventType === 'tacto') {
      const d = validateEventDate(tactoDate);
      setTactoDateErr(d.ok ? null : d.error);
      if (pregnancyStatus == null) {
        setTactoStatusErr('Elegí el resultado del tacto.');
      } else {
        setTactoStatusErr(null);
      }
      if (pregnancyStatus == null || !d.ok) return;
      // Guard ANTES de cualquier await (anti doble-tap). tacto NO dispara aviso (reproductiveWarning(
      // 'tacto', …) === null) → confirmReproIfNeeded es un no-op acá, pero pasamos por el gate uniforme.
      busyRef.current = true;
      if (!(await confirmReproIfNeeded())) return;
      setSubmitting(true);
      const r = await addTacto({ profileId, pregnancyStatus, eventDate: d.value });
      finishSubmit(r);
      return;
    }

    if (eventType === 'service') {
      const d = validateEventDate(serviceDate);
      setServiceDateErr(d.ok ? null : d.error);
      if (serviceType == null) {
        setServiceTypeErr('Elegí el tipo de servicio.');
      } else {
        setServiceTypeErr(null);
      }
      // Notas OPCIONALES: vacío es válido (no las mandamos). Si hay texto, validamos solo el tope
      // (validateObservation rechaza el vacío → no la usamos para el caso vacío; el sanitizer ya acota
      // en vivo al maxLength del textarea, así que este check es un backstop defensivo).
      const trimmedNotes = serviceNotes.trim();
      let notes: string | null = null;
      let notesOk = true;
      if (trimmedNotes.length > 0) {
        const o = validateObservation(serviceNotes);
        if (o.ok) {
          notes = o.value;
          setServiceNotesErr(null);
        } else {
          setServiceNotesErr(o.error);
          notesOk = false;
        }
      } else {
        setServiceNotesErr(null);
      }
      // Paramos si CUALQUIER campo es inválido (todos los errores ya quedaron seteados arriba).
      if (serviceType == null || !d.ok || !notesOk) return;
      // Guard ANTES de cualquier await (anti doble-tap). AVISO SUAVE: servicio sobre una hembra que SÍ
      // figura preñada (no se da servicio a una preñada; pero puede figurar preñada por un tacto viejo y
      // haberlo perdido) → confirmación "¿registrar igual?". Si NO figura preñada → sin aviso, directo.
      busyRef.current = true;
      if (!(await confirmReproIfNeeded())) return;
      setSubmitting(true);
      const r = await addService({ profileId, serviceType, eventDate: d.value, notes });
      finishSubmit(r);
      return;
    }

    if (eventType === 'birth') {
      // Validamos fecha + lista de terneros (cada uno con sexo; pesos opcionales válidos; tags
      // opcionales). validateCalves es PURO (testeable) y normaliza sexo/peso/tag.
      const d = validateEventDate(birthDate);
      setBirthDateErr(d.ok ? null : d.error);
      const drafts: CalfDraft[] = calves.map((c) => ({
        sex: c.sex,
        weightRaw: c.weightRaw,
        tagRaw: c.tagRaw,
      }));
      const v = validateCalves(drafts);
      setCalvesErr(v.ok ? null : v.error);
      if (!d.ok || !v.ok) return;
      // AVISO SUAVE (no bloqueo): un parto solo lo da una hembra preñada, PERO puede estar preñada de
      // verdad sin el tacto cargado (figura "Sin registrar") y el parto ya es prueba de la preñez. Si
      // la hembra NO figura preñada en nuestros registros, pedimos una confirmación suave ANTES de
      // registrar (no es un error: es "¿registrar igual?"). Guard ANTES del diálogo (doble-tap del Alert
      // async en native); confirmReproIfNeeded lo libera si cancela. NO tocamos `submitting` (visual)
      // hasta confirmar.
      busyRef.current = true;
      if (!(await confirmReproIfNeeded())) return;
      setSubmitting(true);
      // La RPC register_birth crea el evento + 1..N terneros + transición de la madre ATÓMICAMENTE
      // server-side (R9.4/R9.5). El cliente manda solo motherProfileId + fecha + terneros — el tenant
      // lo deriva el server de la fila real de la madre. Al volver, useFocusEffect refresca la ficha.
      // Delta parto-rodeo-caravana (RPRC.3): rodeo EFECTIVO del parto (el elegido en el picker ?? el de la
      // madre) → calfRodeoId para TODA la camada (RPRC.3.1). Delta parto-caravana-visual-por-ternero (PCV.3):
      // la caravana visual (idv) viaja POR CRÍA — el idv de cada ternero (calves[i].idvRaw) va en su elemento
      // del payload (single Y mellizos), sin el `calfIdv` a nivel camada (PCV.3.2). validateCalves devuelve
      // v.value EN EL MISMO ORDEN que `calves` (los drafts se arman calves.map) → zippeo por índice. El RPC
      // 6-arg re-valida server-side (rodeo activo/tenant/sistema → 23514; idv duplicado → 23505). El resto del
      // payload queda intacto (PCV.3.4).
      const r = await registerBirth({
        motherProfileId: profileId,
        eventDate: d.value,
        calves: v.value.map((c, i) => ({
          sex: c.sex,
          weightKg: c.weightKg,
          tag: c.tag,
          idv: calfIdvForSubmit(calves[i].idvRaw),
        })),
        calfRodeoId: effectiveCalfRodeoId,
      });
      finishSubmit(r);
      return;
    }

    if (eventType === 'abortion') {
      const d = validateEventDate(abortionDate);
      setAbortionDateErr(d.ok ? null : d.error);
      // Notas OPCIONALES (mismo manejo que el servicio): vacío es válido (no se mandan); con texto, se
      // valida el tope (backstop — el sanitizer ya acota en vivo).
      const trimmedNotes = abortionNotes.trim();
      let notes: string | null = null;
      let notesOk = true;
      if (trimmedNotes.length > 0) {
        const o = validateObservation(abortionNotes);
        if (o.ok) {
          notes = o.value;
          setAbortionNotesErr(null);
        } else {
          setAbortionNotesErr(o.error);
          notesOk = false;
        }
      } else {
        setAbortionNotesErr(null);
      }
      if (!d.ok || !notesOk) return;
      // AVISO SUAVE: aborto sobre una hembra que NO figura preñada → confirmación "¿registrar igual?".
      // Guard ANTES del diálogo (anti doble-tap); confirmReproIfNeeded lo libera si cancela.
      busyRef.current = true;
      if (!(await confirmReproIfNeeded())) return;
      setSubmitting(true);
      // El aborto revierte la preñez de la categoría server-side (dominio Facundo §1) y deja el estado
      // "Vacía" (deriveCurrentState con abortion). El flag "tuvo aborto" lo deriva hasAbortion al volver.
      const r = await addAbortion({ profileId, eventDate: d.value, notes });
      finishSubmit(r);
      return;
    }
  }, [
    eventType,
    profileId,
    establishmentId,
    weightKg,
    weightDate,
    score,
    scoreDate,
    observation,
    pregnancyStatus,
    tactoDate,
    serviceType,
    serviceDate,
    serviceNotes,
    birthDate,
    calves,
    effectiveCalfRodeoId,
    abortionDate,
    abortionNotes,
    figuresPregnant,
    finishSubmit,
  ]);

  const title =
    step === 1
      ? 'Agregar evento'
      : eventType === 'weight'
        ? 'Pesaje'
        : eventType === 'condition_score'
          ? 'Condición corporal'
          : eventType === 'tacto'
            ? 'Tacto'
            : eventType === 'service'
              ? 'Servicio'
              : eventType === 'birth'
                ? 'Parto'
                : eventType === 'abortion'
                  ? 'Aborto'
                  : 'Observación';

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header con back + título. */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={goBack} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            {title}
          </Text>
        </XStack>
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$2', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$4', 'space'),
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {missingParams ? (
          <InfoNote>
            No pudimos cargar el animal. Volvé a la ficha y abrí "Agregar evento" de nuevo.
          </InfoNote>
        ) : step === 1 ? (
          <Step1ChooseType onChoose={onChooseType} isFemale={isFemale} />
        ) : eventType === 'weight' ? (
          <WeightForm
            weightKg={weightKg}
            onWeightKg={(t) => {
              setWeightKg(sanitizeWeightInput(t));
              if (weightErr) setWeightErr(null);
            }}
            weightErr={weightErr}
            date={weightDate}
            onDate={(t) => {
              setWeightDate(maskDateInput(t));
              if (weightDateErr) setWeightDateErr(null);
            }}
            dateErr={weightDateErr}
          />
        ) : eventType === 'condition_score' ? (
          <ConditionForm
            score={score}
            onScore={(s) => {
              setScore(s);
              if (scoreErr) setScoreErr(null);
            }}
            scoreErr={scoreErr}
            date={scoreDate}
            onDate={(t) => {
              setScoreDate(maskDateInput(t));
              if (scoreDateErr) setScoreDateErr(null);
            }}
            dateErr={scoreDateErr}
          />
        ) : eventType === 'tacto' ? (
          <TactoForm
            status={pregnancyStatus}
            onStatus={(s) => {
              setPregnancyStatus(s);
              if (tactoStatusErr) setTactoStatusErr(null);
            }}
            statusErr={tactoStatusErr}
            date={tactoDate}
            onDate={(t) => {
              setTactoDate(maskDateInput(t));
              if (tactoDateErr) setTactoDateErr(null);
            }}
            dateErr={tactoDateErr}
          />
        ) : eventType === 'service' ? (
          <ServiceForm
            type={serviceType}
            onType={(t) => {
              setServiceType(t);
              if (serviceTypeErr) setServiceTypeErr(null);
            }}
            typeErr={serviceTypeErr}
            date={serviceDate}
            onDate={(t) => {
              setServiceDate(maskDateInput(t));
              if (serviceDateErr) setServiceDateErr(null);
            }}
            dateErr={serviceDateErr}
            notes={serviceNotes}
            onNotes={(t) => {
              setServiceNotes(sanitizeObservationInput(t));
              if (serviceNotesErr) setServiceNotesErr(null);
            }}
            notesErr={serviceNotesErr}
          />
        ) : eventType === 'birth' ? (
          <PartoForm
            date={birthDate}
            onDate={(t) => {
              setBirthDate(maskDateInput(t));
              if (birthDateErr) setBirthDateErr(null);
            }}
            dateErr={birthDateErr}
            calves={calves}
            onAddCalf={addCalf}
            onRemoveCalf={removeCalf}
            onUpdateCalf={updateCalf}
            onOpenCalfScan={(localId) => setScanCalfLocalId(localId)}
            calvesErr={calvesErr}
            rodeoName={effectiveRodeoName}
            isSameRodeoAsMother={isSameRodeoAsMother}
            canEditRodeo={canEditRodeo}
            eligibleRodeos={eligibleRodeos}
            selectedRodeoId={effectiveCalfRodeoId}
            rodeoPickerOpen={rodeoPickerOpen}
            onToggleRodeoPicker={() => setRodeoPickerOpen((v) => !v)}
            onSelectRodeo={(id) => {
              setCalfRodeoId(id);
              setRodeoPickerOpen(false);
            }}
            muted={muted}
          />
        ) : eventType === 'abortion' ? (
          <AbortionForm
            date={abortionDate}
            onDate={(t) => {
              setAbortionDate(maskDateInput(t));
              if (abortionDateErr) setAbortionDateErr(null);
            }}
            dateErr={abortionDateErr}
            notes={abortionNotes}
            onNotes={(t) => {
              setAbortionNotes(sanitizeObservationInput(t));
              if (abortionNotesErr) setAbortionNotesErr(null);
            }}
            notesErr={abortionNotesErr}
          />
        ) : (
          <ObservationForm
            value={observation}
            onChange={(t) => {
              setObservation(sanitizeObservationInput(t));
              if (observationErr) setObservationErr(null);
            }}
            error={observationErr}
          />
        )}
      </ScrollView>

      {/* CTA fijo abajo (thumb-zone). Solo en el paso 2. */}
      {!missingParams && step === 2 ? (
        <YStack
          width="100%"
          paddingHorizontal="$4"
          paddingTop="$3"
          paddingBottom={insets.bottom + 12}
          gap="$2"
          borderTopWidth={1}
          borderTopColor="$divider"
          backgroundColor="$bg"
        >
          <FormError message={formError} />
          <Button variant="primary" fullWidth disabled={submitting} onPress={() => void onSubmit()}>
            {submitting ? 'Guardando…' : 'Guardar evento'}
          </Button>
          <Button variant="secondary" fullWidth onPress={goBack}>
            Cambiar de tipo
          </Button>
        </YStack>
      ) : null}

      {/* Sheet de BASTONEO de la caravana electrónica POR TERNERO (RCF.6 generalizado, modo CAPTURA). Montado
          al ROOT (cubre la pantalla con su scrim). Solo UNO a la vez (scanCalfLocalId). El scoped scanner del
          sheet toma la propiedad EXCLUSIVA del bastón mientras está abierto → la lectura entra acá (no al
          FindOrCreateOverlay global) aunque el parto tenga busyMode prendido; al cerrar/desmontar se libera →
          el listener global vuelve a estar suspendido. En captura el onSubmit solo escribe `tagRaw` en ESE
          ternero (sin RPC — el ternero no existe todavía) y devuelve ok=true. */}
      {scanCalfLocalId != null ? (
        <TagScanSheet
          onClose={() => setScanCalfLocalId(null)}
          onSubmit={async (eid) => {
            updateCalf(scanCalfLocalId, { tagRaw: eid });
            return { ok: true };
          }}
          confirmLabel="Usar caravana"
          confirmSublabel="Usar esta caravana para este ternero."
        />
      ) : null}
    </YStack>
  );
}

// ─── Paso 1: elegí el tipo de evento (3 cards grandes) ────────────────────────────────────

function Step1ChooseType({
  onChoose,
  isFemale,
}: {
  onChoose: (t: EventType) => void;
  isFemale: boolean;
}) {
  // Agrupado en secciones (Gestalt proximidad/similitud; escala a C3.3 sin re-acomodar): "General"
  // (peso/condición/observación) y "Reproductivo" (tacto/servicio/parto). Subtítulo de grupo
  // $textMuted/600. La sección "Reproductivo" se muestra SOLO para hembras (isFemale): tacto, servicio
  // y parto no aplican a machos — para un macho el operario solo ve "General".
  return (
    <YStack gap="$4">
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
        ¿Qué querés cargar?
      </Text>

      <YStack gap="$2">
        <SectionLabel>General</SectionLabel>
        <YStack gap="$3">
          <TypeCard
            icon={Weight}
            title="Pesaje"
            subtitle="El peso del animal en kilos"
            onPress={() => onChoose('weight')}
          />
          <TypeCard
            icon={Activity}
            title="Condición corporal"
            subtitle="Escala de 1 a 5"
            onPress={() => onChoose('condition_score')}
          />
          <TypeCard
            icon={StickyNote}
            title="Observación"
            subtitle="Una nota libre sobre el animal"
            onPress={() => onChoose('observation')}
          />
        </YStack>
      </YStack>

      {/* Reproductivo SOLO para hembras: tacto/servicio/parto no aplican a machos. */}
      {isFemale ? (
        <YStack gap="$2">
          <SectionLabel>Reproductivo</SectionLabel>
          <YStack gap="$3">
            <TypeCard
              icon={Stethoscope}
              title="Tacto"
              subtitle="Diagnóstico de preñez"
              onPress={() => onChoose('tacto')}
            />
            <TypeCard
              icon={HeartHandshake}
              title="Servicio"
              subtitle="Inseminación o TE"
              onPress={() => onChoose('service')}
            />
            <TypeCard
              icon={Baby}
              title="Parto"
              subtitle="Nacimiento de uno o más terneros"
              onPress={() => onChoose('birth')}
            />
            <TypeCard
              icon={HeartCrack}
              title="Aborto"
              subtitle="Pérdida de la preñez"
              onPress={() => onChoose('abortion')}
            />
          </YStack>
        </YStack>
      ) : null}
    </YStack>
  );
}

/** Subtítulo de grupo del paso 1 ($textMuted, chico, semibold) — separador de secciones (Gestalt). */
function SectionLabel({ children }: { children: string }) {
  return (
    <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
      {children}
    </Text>
  );
}

function TypeCard({
  icon: Icon,
  title,
  subtitle,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  const faint = getTokenValue('$textFaint', 'color');
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: title })}>
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor="$divider"
        backgroundColor="$white"
        paddingHorizontal="$4"
        paddingVertical="$3"
        pressStyle={{ backgroundColor: '$surface' }}
      >
        <View
          width="$icon"
          height="$icon"
          borderRadius="$pill"
          backgroundColor="$greenLight"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Icon size={22} color={primary} strokeWidth={2.5} />
        </View>
        <YStack flex={1} minWidth={0} gap="$1">
          <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary" numberOfLines={1}>
            {title}
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        </YStack>
        <ChevronRight size={22} color={faint} strokeWidth={2} />
      </XStack>
    </Pressable>
  );
}

// ─── Form: Pesaje ──────────────────────────────────────────────────────────────────────────

function WeightForm({
  weightKg,
  onWeightKg,
  weightErr,
  date,
  onDate,
  dateErr,
}: {
  weightKg: string;
  onWeightKg: (t: string) => void;
  weightErr: string | null;
  date: string;
  onDate: (t: string) => void;
  dateErr: string | null;
}) {
  return (
    <YStack gap="$3">
      <FormField
        label="Peso en kilos"
        value={weightKg}
        onChangeText={onWeightKg}
        keyboardType="decimal-pad"
        placeholder="Ej. 320"
        error={weightErr}
      />
      <FormField
        label="Fecha (AAAA-MM-DD)"
        value={date}
        onChangeText={onDate}
        keyboardType="number-pad"
        placeholder="AAAA-MM-DD"
        error={dateErr}
      />
    </YStack>
  );
}

// ─── Form: Condición corporal (selector CERRADO de los 17 scores) ─────────────────────────

function ConditionForm({
  score,
  onScore,
  scoreErr,
  date,
  onDate,
  dateErr,
}: {
  score: number | null;
  onScore: (s: number) => void;
  scoreErr: string | null;
  date: string;
  onDate: (t: string) => void;
  dateErr: string | null;
}) {
  return (
    <YStack gap="$3">
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Condición corporal (1 a 5)
        </Text>
        <ScoreSelector value={score} onChange={onScore} />
        {scoreErr ? (
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
            {scoreErr}
          </Text>
        ) : null}
      </YStack>
      <FormField
        label="Fecha (AAAA-MM-DD)"
        value={date}
        onChangeText={onDate}
        keyboardType="number-pad"
        placeholder="AAAA-MM-DD"
        error={dateErr}
      />
    </YStack>
  );
}

/**
 * Selector CERRADO de los 17 scores válidos (1.00→5.00 paso 0.25) — chips grandes en grilla. NUNCA
 * texto libre (garantiza el CHECK del DB 0028). El chip seleccionado se marca con la firma de color.
 */
function ScoreSelector({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (s: number) => void;
}) {
  return (
    <XStack width="100%" flexWrap="wrap" gap="$2">
      {CONDITION_SCORES.map((s) => {
        const selected = value != null && Math.abs(value - s) < 1e-9;
        const label = formatConditionScore(s);
        return (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            {...buttonA11y(Platform.OS, { label: `Condición ${label}`, selected })}
          >
            <View
              minWidth="$chipMin"
              minHeight="$chipMin"
              alignItems="center"
              justifyContent="center"
              borderRadius="$pill"
              borderWidth={2}
              borderColor={selected ? '$primary' : '$divider'}
              backgroundColor={selected ? '$primary' : '$white'}
              paddingHorizontal="$3"
              pressStyle={{ opacity: 0.85 }}
            >
              <Text
                fontFamily="$body"
                fontSize="$5"
                fontWeight="600"
                color={selected ? '$white' : '$textPrimary'}
              >
                {label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </XStack>
  );
}

// ─── Selector vertical full-width (opción única) ──────────────────────────────────────────
//
// Cada opción es una FILA ancha (no chip): labels largos como "Transferencia embrionaria (TE)"
// entran cómodos (mejor Fitts que un chip apretado). Patrón consistente con el
// ScoreSelector (borde 2px, radio, selected = relleno+texto $primary) pero en formato fila. a11y por
// buttonA11y (web=ARIA, native=accessibility*). Cero hardcode: tokens + getTokenValue para el ícono.
function OptionSelector<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  const white = getTokenValue('$white', 'color');
  return (
    <YStack width="100%" gap="$2">
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            {...buttonA11y(Platform.OS, { label: opt.label, selected })}
          >
            <XStack
              width="100%"
              alignItems="center"
              gap="$2"
              minHeight="$touchMin"
              borderRadius="$card"
              borderWidth={2}
              borderColor={selected ? '$primary' : '$divider'}
              backgroundColor={selected ? '$primary' : '$white'}
              paddingHorizontal="$4"
              paddingVertical="$3"
              pressStyle={{ opacity: 0.85 }}
            >
              <Text
                flex={1}
                minWidth={0}
                fontFamily="$body"
                fontSize="$5"
                fontWeight="600"
                color={selected ? '$white' : '$textPrimary'}
              >
                {opt.label}
              </Text>
              {selected ? <Check size={20} color={white} strokeWidth={2.5} /> : null}
            </XStack>
          </Pressable>
        );
      })}
    </YStack>
  );
}

// ─── Form: Tacto (selector cerrado de pregnancy_status + fecha) ────────────────────────────

function TactoForm({
  status,
  onStatus,
  statusErr,
  date,
  onDate,
  dateErr,
}: {
  status: PregnancyStatus | null;
  onStatus: (s: PregnancyStatus) => void;
  statusErr: string | null;
  date: string;
  onDate: (t: string) => void;
  dateErr: string | null;
}) {
  return (
    <YStack gap="$3">
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Resultado del tacto
        </Text>
        <OptionSelector options={PREGNANCY_OPTIONS} value={status} onChange={onStatus} />
        {statusErr ? (
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
            {statusErr}
          </Text>
        ) : null}
      </YStack>
      <FormField
        label="Fecha (AAAA-MM-DD)"
        value={date}
        onChangeText={onDate}
        keyboardType="number-pad"
        placeholder="AAAA-MM-DD"
        error={dateErr}
      />
    </YStack>
  );
}

// ─── Form: Servicio (selector cerrado IA/TE + fecha + notas OPCIONALES) ────────────────────
// B3 (RPSC.6.1): el selector ofrece SOLO IA y TE (SERVICE_TYPE_INPUT_OPTIONS). La monta natural se
// deprecó de la carga manual (servicio natural = nivel-rodeo). Los `natural` históricos siguen en el timeline.

function ServiceForm({
  type,
  onType,
  typeErr,
  date,
  onDate,
  dateErr,
  notes,
  onNotes,
  notesErr,
}: {
  type: ManualServiceType | null;
  onType: (t: ManualServiceType) => void;
  typeErr: string | null;
  date: string;
  onDate: (t: string) => void;
  dateErr: string | null;
  notes: string;
  onNotes: (t: string) => void;
  notesErr: string | null;
}) {
  return (
    <YStack gap="$3">
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Tipo de servicio
        </Text>
        <OptionSelector options={SERVICE_TYPE_INPUT_OPTIONS} value={type} onChange={onType} />
        {typeErr ? (
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
            {typeErr}
          </Text>
        ) : null}
      </YStack>
      <FormField
        label="Fecha (AAAA-MM-DD)"
        value={date}
        onChangeText={onDate}
        keyboardType="number-pad"
        placeholder="AAAA-MM-DD"
        error={dateErr}
      />
      <NotesField
        label="Notas (opcional)"
        value={notes}
        onChange={onNotes}
        error={notesErr}
        placeholder="Ej. toro Aberdeen Angus N° 12"
        a11yLabel="Notas del servicio"
      />
    </YStack>
  );
}

// ─── Form: Aborto (fecha + notas OPCIONALES) ───────────────────────────────────────────────
//
// El aborto es la pérdida de la preñez: solo necesita la FECHA (prefill hoy) + notas opcionales (ej.
// causa observada). No lleva selector (no hay "tipo de aborto" en el modelo). Mismo lenguaje que el
// resto: FormField de fecha + NotesField reusado (label/placeholder/a11y configurables).
function AbortionForm({
  date,
  onDate,
  dateErr,
  notes,
  onNotes,
  notesErr,
}: {
  date: string;
  onDate: (t: string) => void;
  dateErr: string | null;
  notes: string;
  onNotes: (t: string) => void;
  notesErr: string | null;
}) {
  return (
    <YStack gap="$3">
      <FormField
        label="Fecha del aborto (AAAA-MM-DD)"
        value={date}
        onChangeText={onDate}
        keyboardType="number-pad"
        placeholder="AAAA-MM-DD"
        error={dateErr}
      />
      <NotesField
        label="Notas (opcional)"
        value={notes}
        onChange={onNotes}
        error={notesErr}
        placeholder="Ej. causa observada, semana de gestación"
        a11yLabel="Notas del aborto"
      />
    </YStack>
  );
}

// ─── Form: Parto (fecha + rodeo a nivel parto + terneros con sus 2 caravanas) ────────
//
// La fecha del parto + el RODEO del parto (a nivel camada, delta parto-rodeo-caravana RPRC.1) + una o más
// cards "Ternero N". Cada card: sexo (REQUERIDO, OptionSelector Macho/Hembra) + peso al nacer (opcional, kg)
// + caravana VISUAL (idv, opcional, POR CRÍA — delta parto-caravana-visual-por-ternero PCV.1) + caravana
// ELECTRÓNICA (opcional, FDX-B 15 díg, bastoneo por-ternero RPRC.2.5). Las DOS caravanas son SIEMPRE
// opcionales (PCV.2) y viven DENTRO de cada card → simetría "cada ternero, sus dos caravanas". El botón
// "+ Agregar otro ternero" suma una card (mellizos); cada card (salvo cuando hay una sola) tiene "Quitar".
// El estado vive en el screen como array con id local estable (key de React), idv incluido POR CRÍA.
function PartoForm({
  date,
  onDate,
  dateErr,
  calves,
  onAddCalf,
  onRemoveCalf,
  onUpdateCalf,
  onOpenCalfScan,
  calvesErr,
  rodeoName,
  isSameRodeoAsMother,
  canEditRodeo,
  eligibleRodeos,
  selectedRodeoId,
  rodeoPickerOpen,
  onToggleRodeoPicker,
  onSelectRodeo,
  muted,
}: {
  date: string;
  onDate: (t: string) => void;
  dateErr: string | null;
  calves: CalfRow[];
  onAddCalf: () => void;
  onRemoveCalf: (localId: string) => void;
  onUpdateCalf: (localId: string, patch: Partial<Omit<CalfRow, 'localId'>>) => void;
  /** Abre el TagScanSheet (modo captura) para bastonear/tipear la caravana electrónica de ESE ternero. */
  onOpenCalfScan: (localId: string) => void;
  calvesErr: string | null;
  /** Nombre del rodeo efectivo del parto (a mostrar en el trigger). */
  rodeoName: string;
  /** ¿El rodeo elegido coincide con el de la madre? → leyenda "(Mismo rodeo que la madre)" (RPRC.1.3). */
  isSameRodeoAsMother: boolean;
  /** ¿El picker es editable? false → fallback no-editable (RPRC.1.8). */
  canEditRodeo: boolean;
  /** Rodeos elegibles (mismo sistema que la madre, campo activo). */
  eligibleRodeos: Rodeo[];
  selectedRodeoId: string | null;
  rodeoPickerOpen: boolean;
  onToggleRodeoPicker: () => void;
  onSelectRodeo: (id: string) => void;
  muted: string;
}) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <YStack gap="$4">
      <FormField
        label="Fecha del parto (AAAA-MM-DD)"
        value={date}
        onChangeText={onDate}
        keyboardType="number-pad"
        placeholder="AAAA-MM-DD"
        error={dateErr}
      />

      {/* ── Rodeo del PARTO (RPRC.1): a nivel camada (entre la fecha y los terneros, design §3). Patrón
          calcado del picker de rodeo de #15 (LinkCalfPrompt CreateCalfForm): trigger + ChevronDown + lista
          expandible + ComboOptionRow + leyenda "(Mismo rodeo que la madre)". ── */}
      <CalfRodeoPicker
        rodeoName={rodeoName}
        isSameRodeoAsMother={isSameRodeoAsMother}
        canEdit={canEditRodeo}
        eligibleRodeos={eligibleRodeos}
        selectedRodeoId={selectedRodeoId}
        pickerOpen={rodeoPickerOpen}
        onTogglePicker={onToggleRodeoPicker}
        onSelectRodeo={onSelectRodeo}
        muted={muted}
      />

      {/* La caravana VISUAL del ternero (idv) ya NO vive acá a nivel camada: pasó a ser POR CRÍA (delta
          parto-caravana-visual-por-ternero, PCV.1.5) → cada CalfBlock tiene SU campo idv, junto a la
          electrónica. Se eliminó el FormField single-calf + la nota de mellizos. */}

      <YStack gap="$3">
        {calves.map((calf, i) => (
          <CalfBlock
            key={calf.localId}
            index={i}
            calf={calf}
            canRemove={calves.length > 1}
            onRemove={() => onRemoveCalf(calf.localId)}
            onUpdate={(patch) => onUpdateCalf(calf.localId, patch)}
            onOpenScan={() => onOpenCalfScan(calf.localId)}
          />
        ))}
      </YStack>

      {/* Error general del set de terneros (ej. "Elegí el sexo de cada ternero."). */}
      {calvesErr ? (
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
          {calvesErr}
        </Text>
      ) : null}

      {/* Agregar otro ternero (mellizos, R9.5). Pressable estilado al lenguaje (borde discontinuo no
          existe en tokens → borde sólido $primary + texto $primary), a11y por helper. */}
      <Pressable
        style={{ width: '100%' }}
        onPress={onAddCalf}
        {...buttonA11y(Platform.OS, { label: 'Agregar otro ternero' })}
      >
        <XStack
          width="100%"
          minHeight="$touchMin"
          alignItems="center"
          justifyContent="center"
          gap="$2"
          borderRadius="$card"
          borderWidth={2}
          borderColor="$primary"
          backgroundColor="$greenLight"
          paddingHorizontal="$4"
          pressStyle={{ opacity: 0.85 }}
        >
          <Plus size={20} color={primary} strokeWidth={2.5} />
          <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$primary">
            Agregar otro ternero
          </Text>
        </XStack>
      </Pressable>
    </YStack>
  );
}

// ─── Picker de rodeo del PARTO (a nivel camada) — patrón de #15 (LinkCalfPrompt CreateCalfForm) ─────
//
// Trigger (nombre del rodeo efectivo + ChevronDown) + leyenda "(Mismo rodeo que la madre)" condicional +
// lista expandible de rodeos del MISMO sistema. `canEdit=false` (fallback RPRC.1.8: madre de un campo
// distinto del activo / sistema irresoluble) → trigger ESTÁTICO sin chevron ni lista (preseleccionado al
// de la madre, sin ofrecer opciones; el RPC re-valida con 23514). Cero hardcode: tokens + getTokenValue.
function CalfRodeoPicker({
  rodeoName,
  isSameRodeoAsMother,
  canEdit,
  eligibleRodeos,
  selectedRodeoId,
  pickerOpen,
  onTogglePicker,
  onSelectRodeo,
  muted,
}: {
  rodeoName: string;
  isSameRodeoAsMother: boolean;
  canEdit: boolean;
  eligibleRodeos: Rodeo[];
  selectedRodeoId: string | null;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onSelectRodeo: (id: string) => void;
  muted: string;
}) {
  // Leyenda "(Mismo rodeo que la madre)" (RPRC.1.3/1.4): lineHeight="$2" matcheado (anti-recorte; "madre"
  // no tiene descendente pero conservamos la regla). Un solo Text reusable arriba y abajo del trigger.
  const legend = isSameRodeoAsMother ? (
    <Text
      fontFamily="$body"
      fontSize="$2"
      lineHeight="$2"
      fontWeight="500"
      color="$textFaint"
      numberOfLines={1}
    >
      (Mismo rodeo que la madre)
    </Text>
  ) : null;

  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        Rodeo del parto
      </Text>
      {canEdit ? (
        <Pressable
          onPress={onTogglePicker}
          {...buttonA11y(Platform.OS, { label: 'Elegir rodeo del parto', selected: pickerOpen })}
        >
          <XStack
            width="100%"
            minHeight="$touchMin"
            alignItems="center"
            gap="$3"
            backgroundColor="$white"
            borderRadius="$card"
            borderWidth={1}
            borderColor="$divider"
            paddingHorizontal="$4"
            pressStyle={{ backgroundColor: '$surface' }}
          >
            <Text
              flex={1}
              minWidth={0}
              numberOfLines={1}
              fontFamily="$body"
              fontSize="$5"
              lineHeight="$5"
              fontWeight="600"
              color="$textPrimary"
            >
              {rodeoName}
            </Text>
            <ChevronDown size={22} color={muted} strokeWidth={2} />
          </XStack>
        </Pressable>
      ) : (
        // Fallback no-editable (RPRC.1.8): trigger estático (sin chevron, sin lista), preseleccionado al de
        // la madre. Fondo $surface (no $white) para comunicar "no editable" sin un disabled agresivo.
        <XStack
          width="100%"
          minHeight="$touchMin"
          alignItems="center"
          backgroundColor="$surface"
          borderRadius="$card"
          borderWidth={1}
          borderColor="$divider"
          paddingHorizontal="$4"
        >
          <Text
            flex={1}
            minWidth={0}
            numberOfLines={1}
            fontFamily="$body"
            fontSize="$5"
            lineHeight="$5"
            fontWeight="600"
            color="$textPrimary"
          >
            {rodeoName}
          </Text>
        </XStack>
      )}
      {legend}
      {canEdit && pickerOpen && eligibleRodeos.length > 0 ? (
        <YStack
          gap="$1"
          borderRadius="$card"
          borderWidth={1}
          borderColor="$divider"
          backgroundColor="$bg"
          paddingVertical="$2"
          paddingHorizontal="$2"
        >
          {eligibleRodeos.map((r) => (
            <ComboOptionRow
              key={r.id}
              a11yLabel={`Rodeo ${r.name}`}
              label={r.name}
              selected={r.id === selectedRodeoId}
              onPress={() => onSelectRodeo(r.id)}
            />
          ))}
        </YStack>
      ) : null}
    </YStack>
  );
}

/** Una card "Ternero N": sexo (requerido) + peso (opcional) + caravana (opcional) + quitar. */
function CalfBlock({
  index,
  calf,
  canRemove,
  onRemove,
  onUpdate,
  onOpenScan,
}: {
  index: number;
  calf: CalfRow;
  canRemove: boolean;
  onRemove: () => void;
  onUpdate: (patch: Partial<Omit<CalfRow, 'localId'>>) => void;
  /** Abre el TagScanSheet (modo captura) para bastonear/tipear la caravana electrónica de ESTE ternero. */
  onOpenScan: () => void;
}) {
  const terracota = getTokenValue('$terracota', 'color');
  return (
    <Card gap="$3">
      <XStack width="100%" alignItems="center" gap="$2">
        <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary">
          {`Ternero ${index + 1}`}
        </Text>
        {canRemove ? (
          <Pressable
            hitSlop={8}
            onPress={onRemove}
            {...buttonA11y(Platform.OS, { label: `Quitar ternero ${index + 1}` })}
          >
            <Trash2 size={20} color={terracota} strokeWidth={2} />
          </Pressable>
        ) : null}
      </XStack>

      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Sexo
        </Text>
        <OptionSelector
          options={SEX_OPTIONS}
          value={calf.sex}
          onChange={(s) => onUpdate({ sex: s })}
        />
      </YStack>

      <FormField
        label="Peso al nacer en kg (opcional)"
        value={calf.weightRaw}
        onChangeText={(t) => onUpdate({ weightRaw: sanitizeWeightInput(t) })}
        keyboardType="decimal-pad"
        placeholder="Ej. 35"
      />

      {/* Caravana VISUAL del ternero (idv) POR CRÍA (delta parto-caravana-visual-por-ternero, PCV.1): un
          campo por CalfBlock (single Y mellizos), OPCIONAL (PCV.2 — sin validación que la fuerce), junto a la
          electrónica → simetría "cada ternero, sus dos caravanas". sanitizeIdvInput en vivo (solo dígitos, sin
          clamp que oculte un error de tipeo). testID indexado para desambiguar mellizos en E2E (paralelo a
          tag-scan-open-${index}). */}
      <FormField
        label="Caravana visual del ternero (opcional)"
        value={calf.idvRaw}
        onChangeText={(t) => onUpdate({ idvRaw: sanitizeIdvInput(t) })}
        keyboardType="number-pad"
        placeholder="Ej. 0234"
        testID={`calf-idv-${index}`}
      />

      {/* Caravana electrónica → BASTONEAR (RCF.6 generalizado al parto): en vez de un campo tipeable suelto,
          el CTA "Bastonear la caravana (opcional)" abre el TagScanSheet en modo captura PARA ESTE ternero (la
          carga manual del EID vive DENTRO del sheet). Capturado → CapturedTagRow read-only con "Cambiar" (un
          mis-scan se corrige antes de guardar el parto) → vuelve al CTA. Cada ternero su afordancia independiente
          (mellizos, RPRC.2.5); el testID lleva el índice para distinguirlos en e2e. */}
      {calf.tagRaw ? (
        <CapturedTagRow
          eid={calf.tagRaw}
          onClear={() => onUpdate({ tagRaw: '' })}
          testID={`tag-captured-${index}`}
          clearTestID={`tag-captured-clear-${index}`}
        />
      ) : (
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Caravana electrónica
          </Text>
          <TagScanCta
            label="Bastonear la caravana (opcional)"
            testID={`tag-scan-open-${index}`}
            onPress={onOpenScan}
          />
        </YStack>
      )}
    </Card>
  );
}

// ─── NotesField: textarea con tope (reusable: observación libre Y notas de servicio) ──────
//
// Textarea estilado al lenguaje de FormField (input pill blanco, redondeado, sin el borde default del
// browser). Los valores cruzan a la API de estilo no-Tamagui del <TextInput> de RN → getTokenValue
// (no literales, ADR-023 §4). Reusable: la observación libre (C3.1) y las notas opcionales del
// servicio (C3.2a) usan el mismo componente — label/placeholder/a11yLabel configurables.
function NotesField({
  label,
  value,
  onChange,
  error,
  placeholder,
  a11yLabel,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
  error: string | null;
  placeholder: string;
  /** Nombre accesible del <input>. NUNCA accessibilityLabel crudo al <input> de RN-web (lección C1). */
  a11yLabel: string;
}) {
  const placeholderColor = getTokenValue('$textMuted', 'color'); // mismo placeholder que FormField
  const textPrimary = getTokenValue('$textPrimary', 'color');
  const surface = getTokenValue('$white', 'color'); // input blanco sobre $bg (como FormField)
  const borderColor = getTokenValue(error ? '$terracota' : '$divider', 'color');
  // En web (<textarea>) sacamos el focus-ring cuadrado del browser: el estado de foco lo da el borde
  // redondeado del input; el outline default rompe el lenguaje de FormField. RN-web traduce
  // outlineWidth:0 a `outline: none` en el DOM (tipado en TextStyle, sin cast).
  const webOutlineReset: TextStyle = Platform.OS === 'web' ? { outlineWidth: 0 } : {};
  // a11y ramificada por plataforma (label DOM-válido en web, accessibilityLabel en native).
  const a11y =
    Platform.OS === 'web' ? { 'aria-label': a11yLabel } : { accessibilityLabel: a11yLabel };
  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        multiline
        maxLength={OBSERVATION_MAX_LENGTH}
        textAlignVertical="top"
        style={{
          minHeight: getTokenValue('$10', 'size'),
          borderRadius: getTokenValue('$card', 'radius'),
          borderWidth: 1,
          borderColor,
          backgroundColor: surface,
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingVertical: getTokenValue('$3', 'space'),
          fontFamily: 'Inter',
          fontSize: getTokenValue('$inputText', 'size'),
          color: textPrimary,
          ...webOutlineReset,
        }}
        {...a11y}
      />
      <XStack width="100%" justifyContent="flex-end">
        <Text fontFamily="$body" fontSize="$2" fontWeight="400" color="$textFaint">
          {value.length} / {OBSERVATION_MAX_LENGTH}
        </Text>
      </XStack>
      {error ? (
        <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
          {error}
        </Text>
      ) : null}
    </YStack>
  );
}

// ─── Form: Observación libre (NotesField requerido) ───────────────────────────────────────

function ObservationForm({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (t: string) => void;
  error: string | null;
}) {
  return (
    <NotesField
      label="Observación"
      value={value}
      onChange={onChange}
      error={error}
      placeholder="Ej. Renguea de la pata derecha; revisar en la próxima."
      a11yLabel="Observación"
    />
  );
}
