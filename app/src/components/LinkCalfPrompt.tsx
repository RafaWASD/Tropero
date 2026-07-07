// LinkCalfPrompt — prompt SALTABLE post-alta para vincular la cría al pie de una vaca recién creada
// (spec 02 delta #15 "VINCULAR LA CRÍA AL PIE", RCAP.1–RCAP.5 / RCAP.9). Lo dispara crear-animal.tsx
// cuando el alta de una vaca con cría al pie (nursing=true) salió OK (happy path, sin soft-fails).
//
// FLUJO (design §5):
//   [¿Vincular su cría al pie?]
//     ├─ "Ahora no" ───────────────────────→ cerrar + navegar (la vaca queda nursing=true, RCAP.1.3/1.4)
//     ├─ [Bastonear la caravana del ternero] → TagScanSheet (modo captura, hideManualEntry) → el EID leído
//     │                                        LLENA el campo de búsqueda y AVANZA el find-or-create (scan-para-
//     │                                        llenar): classifyCalfQuery lo ve como `eid` → lookupByTag → …
//     └─ caravana del ternero (EID|IDV) → classifyCalfQuery
//           ├─ EID  → lookupByTag(tag, est) ── edit → ternero del campo activo
//           │                               ├─ transfer → aviso "está en otro campo" (RCAP.3.4)
//           │                               └─ create → camino NO ENCONTRADO
//           └─ IDV  → searchAnimals(est, idv) ── 1 → encontrado · 0 → NO encontrado · >1 → aviso "varios"
//           ENCONTRADO → fetchMother(calf) ── tiene madre → aviso "ya tiene madre" (RCAP.3.3, no re-vincular)
//                                          └─ sin madre   → confirmar → linkCalfToMother (RCAP.3.5)
//           NO ENCONTRADO → mini-form [sexo* | fecha opc. es-AR | rodeo] → registerBirth (crea+vincula)
//                 rodeo = preseleccionado al de la madre + leyenda "(Mismo rodeo que la madre)",
//                         editable a otro rodeo del MISMO SISTEMA del campo (RCAP.5.x).
//
// BASTONEO (scan-para-llenar, delta bastoneo-cría-al-pie): el CTA "Bastonear la caravana del ternero" abre el
// TagScanSheet en modo CAPTURA con `hideManualEntry` (el sheet NO carga la electrónica adentro — este buscador
// acepta EID **o** IDV y ya tiene su propio campo). Al leer un EID, el sheet llama `onScanSubmit(eid)` que SETEA
// el query del buscador al EID y dispara el MISMO find-or-create (`runSearch(eid)`). La lógica de clasificación y
// el camino IDV (tipear) quedan INTACTOS — el bastón solo agrega el camino de llenar-por-scan. Ownership: el
// prompt vive sobre crear-animal, que suspende el listener global (useBusyWhileMounted); el TagScanSheet toma el
// SCOPED SCANNER exclusivo mientras está abierto → la lectura entra al sheet y el FindOrCreateOverlay global la
// ignora (flag scopedScannerActive); al cerrarse, la escucha se re-suspende. NO se usa el listener global crudo.
//
// OFFLINE-FIRST (RCAP.1.5): la captura, el find-or-create (lectura LOCAL PowerSync) y el encolado del
// vínculo/creación (outbox) funcionan SIN red; el rechazo real lo resuelve uploadData al subir.
//
// PATRÓN de sheet (skill design-review, molde BreedPickerSheet): backdrop $scrim tappable CON guard
// anti tap-through web (doble-rAF) + sheet anclado abajo con grip + maxHeight → HEADER FIJO (título que
// NUNCA se recorta al crecer el body, anti-recorte lineHeight matcheado) + BODY SCROLLEABLE + FOOTER FIJO.
// Cero hardcode (ADR-023 §4): tokens; lo que cruza a APIs no-Tamagui (lucide) vía getTokenValue. Validación
// INLINE (borde rojo + error junto al campo, sin banner global que tape el título, RCAP.9.3). es-AR voseo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check, ChevronDown, Mars, Venus } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';

import { Button } from './Button';
import { FormField } from './FormField';
import { InfoNote } from './AuthBits';
import { TagScanCta } from './TagScanCta';
import { TagScanSheet } from './TagScanSheet';
import { buttonA11y } from '../utils/a11y';
import { lookupByTag, searchAnimals, type AnimalListItem } from '../services/animals';
import { fetchMother, linkCalfToMother, registerBirth } from '../services/events';
import type { Rodeo } from '../services/rodeos';
import type { AnimalSex } from '../utils/animal-category';
import { classifyCalfQuery, resolveLinkEventDate, todayIsoLocal } from '../utils/link-calf-query';
import { sanitizeIdvInput } from '../utils/animal-input';
import {
  sanitizeBirthYearInput,
  sanitizeDayMonthInput,
  validateBirthDate,
} from '../utils/animal-birth-year';

const OFFLINE_LOOKUP_COPY =
  'No pudimos buscar el ternero. Probá de nuevo en un momento.';

/** Un ternero ENCONTRADO por el find-or-create (campo activo), listo para vincular. */
type FoundCalf = { profileId: string; label: string; birthDate: string | null };

/** Identificador tipeado que fluye al ternero en el camino CREATE (EID → tag; IDV numérico → idv). */
type CreateIdentifier = { tag: string | null; idv: string | null };

type Phase =
  | { kind: 'ask' }
  | { kind: 'found'; calf: FoundCalf }
  | { kind: 'create'; identifier: CreateIdentifier };

export type LinkCalfPromptProps = {
  /** ¿El prompt está abierto? (montaje controlado por crear-animal tras el alta con cría al pie). */
  open: boolean;
  /** profileId de la MADRE recién creada (id de cliente, disponible offline). */
  motherProfileId: string | null;
  /** Establishment ACTIVO (find-or-create scopeado, multi-tenant — nunca hardcodeado). */
  establishmentId: string | null;
  /** Rodeo de la madre (preseleccionado en el camino CREATE) + su sistema (filtra el picker, RCAP.5.4). */
  motherRodeoId: string | null;
  motherRodeoName: string | null;
  motherSystemId: string | null;
  /** Rodeos del campo activo (RodeoContext.available). El picker filtra por `motherSystemId`. */
  rodeos: Rodeo[];
  /** "Ahora no" o backdrop: cerrar SIN vincular y navegar a la ficha (la vaca queda nursing=true). */
  onSkip: () => void;
  /** Tras un vínculo / creación con éxito: cerrar y navegar (reflejo optimista, RCAP.3.5/4.5). */
  onLinked: () => void;
};

export function LinkCalfPrompt({
  open,
  motherProfileId,
  establishmentId,
  motherRodeoId,
  motherRodeoName,
  motherSystemId,
  rodeos,
  onSkip,
  onLinked,
}: LinkCalfPromptProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));
  const muted = getTokenValue('$textMuted', 'color');

  // ── Estado del prompt ──
  const [phase, setPhase] = useState<Phase>({ kind: 'ask' });
  const [query, setQuery] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  // Aviso accionable (NO error de campo): "ya tiene madre" (RCAP.3.3) / "otro campo" (RCAP.3.4) / "varios".
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // Sheet de BASTONEO de la caravana del ternero (scan-para-llenar): montado SOBRE el prompt (sobre crear-animal,
  // que ya suspende el listener global) → el TagScanSheet toma el scoped scanner exclusivo mientras está abierto.
  const [scanOpen, setScanOpen] = useState(false);

  // ── Mini-form del camino CREATE (RCAP.4 / RCAP.5) ──
  const [sex, setSex] = useState<AnimalSex | null>(null);
  const [sexError, setSexError] = useState<string | null>(null);
  const [birthYear, setBirthYear] = useState('');
  const [birthYearError, setBirthYearError] = useState<string | null>(null);
  const [birthDayMonth, setBirthDayMonth] = useState('');
  const [dayMonthError, setDayMonthError] = useState<string | null>(null);
  const [selectedCalfRodeoId, setSelectedCalfRodeoId] = useState<string | null>(null);
  const [rodeoPickerOpen, setRodeoPickerOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Rodeos elegibles para el ternero (RCAP.5.3/5.4): del campo activo + del MISMO SISTEMA que el de la
  // madre (la categoría ternero/ternera se resuelve por el sistema del rodeo; otro sistema rompería la
  // resolución). El rodeo de la madre queda incluido (mismo sistema) y preseleccionado (RCAP.5.1).
  const calfRodeoOptions = useMemo(
    () => rodeos.filter((r) => motherSystemId != null && r.systemId === motherSystemId),
    [rodeos, motherSystemId],
  );
  const effectiveCalfRodeoId = selectedCalfRodeoId ?? motherRodeoId;
  const isSameRodeoAsMother = effectiveCalfRodeoId === motherRodeoId;
  const selectedCalfRodeoName =
    calfRodeoOptions.find((r) => r.id === effectiveCalfRodeoId)?.name ?? motherRodeoName ?? '—';

  // ── GUARD del backdrop contra el "click huérfano" del tap que abrió el sheet (BUG web táctil),
  //    idéntico a BreedPickerSheet (doble rAF). + RESET de todo el estado cada vez que se ABRE. ──
  const readyToDismissRef = useRef(false);
  useEffect(() => {
    if (!open) {
      readyToDismissRef.current = false;
      return;
    }
    // Reset "fresco" en cada apertura (el prompt se reabre por cada alta con cría al pie).
    setPhase({ kind: 'ask' });
    setQuery('');
    setFieldError(null);
    setInfo(null);
    setBusy(false);
    busyRef.current = false;
    setSex(null);
    setSexError(null);
    setBirthYear('');
    setBirthYearError(null);
    setBirthDayMonth('');
    setDayMonthError(null);
    setSelectedCalfRodeoId(null);
    setRodeoPickerOpen(false);
    setActionError(null);
    setScanOpen(false);

    let raf1 = 0;
    let raf2 = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      readyToDismissRef.current = true;
    };
    if (typeof requestAnimationFrame === 'function') {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(arm);
      });
    } else {
      timer = setTimeout(arm, 0);
    }
    return () => {
      if (raf1) cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      if (timer) clearTimeout(timer);
    };
  }, [open]);

  const onBackdropPress = useCallback(() => {
    if (!readyToDismissRef.current) return;
    if (busyRef.current) return; // no descartar a mitad de un encolado
    onSkip();
  }, [onSkip]);

  // "← Cambiar caravana" (control & freedom, Nielsen #3): desde 'found'/'create' volver a la captura para
  // re-tipear (un mistype en la manga es común y un typo que cayó en CREATE no debe forzar un ternero bogus).
  // CONSERVA `query` (se corrige sobre lo tipeado, no desde cero); limpia los errores/aviso de las otras fases.
  // El reset COMPLETO sigue siendo solo al abrir (effect `open`). Respeta el busy guard.
  const backToAsk = useCallback(() => {
    if (busyRef.current) return;
    setPhase({ kind: 'ask' });
    setActionError(null);
    setSexError(null);
    setBirthYearError(null);
    setDayMonthError(null);
    setInfo(null);
  }, []);

  // ── Find-or-create del ternero por una caravana (RCAP.2 / RCAP.3). PARAMETRIZADO por `rawQuery` (no lee
  //    `query` del closure) para que el bastoneo pueda dispararlo con el EID recién leído SIN esperar al
  //    re-render del setState (scan-para-llenar): el path tipeado pasa `query`, el path scan pasa el EID. ──
  const runSearch = useCallback(async (rawQuery: string) => {
    if (busyRef.current) return;
    setFieldError(null);
    setInfo(null);

    const c = classifyCalfQuery(rawQuery);
    if (c.kind === 'empty') {
      setFieldError('Ingresá la caravana del ternero.');
      return;
    }
    if (c.kind === 'too-short') {
      setFieldError('Revisá la caravana: es muy corta.');
      return;
    }
    if (!establishmentId || !motherProfileId) {
      setFieldError('No pudimos identificar el campo. Reintentá.');
      return;
    }

    busyRef.current = true;
    setBusy(true);

    let found: FoundCalf | null = null;

    if (c.kind === 'eid') {
      const r = await lookupByTag(c.value, establishmentId);
      if (!r.ok) {
        busyRef.current = false;
        setBusy(false);
        setFieldError(OFFLINE_LOOKUP_COPY);
        return;
      }
      const res = r.value;
      if (res.mode === 'transfer') {
        // RCAP.3.4: el ternero existe pero está activo en OTRO campo → no se vincula (cross-tenant).
        busyRef.current = false;
        setBusy(false);
        setInfo('Ese ternero está activo en otro campo. No se puede vincular a una madre de este campo.');
        return;
      }
      if (res.mode === 'create') {
        // No existe en ningún campo → camino NO ENCONTRADO; el EID tipeado fluye al ternero creado.
        busyRef.current = false;
        setBusy(false);
        setActionError(null);
        setPhase({ kind: 'create', identifier: { tag: c.value, idv: null } });
        return;
      }
      // res.mode === 'edit' → ternero activo en el campo. Traemos label + birth_date (LOCAL) para el
      // confirm + la fecha del vínculo. searchAnimals(est, eid) hace match exacto por tag → 1 item.
      const s = await searchAnimals(establishmentId, c.value);
      if (!s.ok) {
        busyRef.current = false;
        setBusy(false);
        setFieldError(OFFLINE_LOOKUP_COPY);
        return;
      }
      const item = s.value.find((it) => it.profileId === res.profileId) ?? s.value[0];
      found = {
        profileId: res.profileId,
        label: item ? calfLabel(item) : c.value,
        birthDate: item?.animalBirthDate ?? null,
      };
    } else {
      // c.kind === 'idv' → searchAnimals (idv exacto + substring + visual fuzzy, campo activo).
      const s = await searchAnimals(establishmentId, c.value);
      if (!s.ok) {
        busyRef.current = false;
        setBusy(false);
        setFieldError(OFFLINE_LOOKUP_COPY);
        return;
      }
      if (s.value.length === 0) {
        // No encontrado → camino CREATE; el IDV numérico tipeado fluye a p_calf_idv (RCAP.7.6).
        busyRef.current = false;
        setBusy(false);
        setActionError(null);
        setPhase({ kind: 'create', identifier: { tag: null, idv: c.value } });
        return;
      }
      if (s.value.length > 1) {
        // Ambiguo: varios animales matchean esa caravana → no adivinamos cuál vincular (RCAP.2.3 exige UNO).
        busyRef.current = false;
        setBusy(false);
        setInfo('Encontramos varios animales con esa caravana. Revisá el número e ingresalo completo.');
        return;
      }
      const item = s.value[0];
      found = { profileId: item.profileId, label: calfLabel(item), birthDate: item.animalBirthDate };
    }

    // ENCONTRADO → ¿ya tiene madre? (RCAP.3.3). fetchMother resuelve ternero→madre por birth_calves (LOCAL).
    const m = await fetchMother(found.profileId);
    busyRef.current = false;
    setBusy(false);
    if (!m.ok) {
      setFieldError(OFFLINE_LOOKUP_COPY);
      return;
    }
    if (m.value != null) {
      // Un ternero tiene una sola madre biológica → avisamos y NO re-vinculamos (RCAP.3.3).
      setInfo('Ese ternero ya tiene una madre registrada. No se puede vincular a otra.');
      return;
    }
    setActionError(null);
    setPhase({ kind: 'found', calf: found });
  }, [establishmentId, motherProfileId]);

  // Path TIPEADO: "Buscar ternero" / Enter en el campo → busca lo que hay en `query`.
  const onSearch = useCallback(() => {
    void runSearch(query);
  }, [runSearch, query]);

  // ── BASTONEO (scan-para-llenar). El CTA abre el sheet; el sheet toma el scoped scanner exclusivo (ownership).
  const openScan = useCallback(() => {
    if (busyRef.current) return;
    setScanOpen(true);
  }, []);
  const closeScan = useCallback(() => setScanOpen(false), []);
  // onSubmit del sheet en modo captura: el EID leído (15 díg, ya validado+dedupeado por el contrato) LLENA el
  // campo de búsqueda y AVANZA el find-or-create existente (classifyCalfQuery lo verá como `eid` → lookupByTag).
  // Devolvemos ok:true → el sheet se cierra. Awaiteamos runSearch para que la fase (found|create) ya esté
  // resuelta cuando el sheet se cierra (sin flash de la fase ask). Un fallo del lookup deja el error en `ask`.
  const onScanSubmit = useCallback(
    async (eid: string): Promise<{ ok: boolean; error?: string }> => {
      setQuery(eid);
      await runSearch(eid);
      return { ok: true };
    },
    [runSearch],
  );

  // ── Confirmar el vínculo de un ternero EXISTENTE (RCAP.3.1/3.5). ──
  const onConfirmLink = useCallback(
    async (calf: FoundCalf) => {
      if (busyRef.current) return;
      if (!motherProfileId) return;
      setActionError(null);
      busyRef.current = true;
      setBusy(true);
      // RCAP.3.2: fecha del evento de parto = nacimiento del ternero si lo conoce, si no hoy.
      const eventDate = resolveLinkEventDate(calf.birthDate);
      const r = await linkCalfToMother(motherProfileId, calf.profileId, eventDate);
      busyRef.current = false;
      setBusy(false);
      if (!r.ok) {
        setActionError('No pudimos vincular el ternero. Probá de nuevo.');
        return;
      }
      onLinked();
    },
    [motherProfileId, onLinked],
  );

  // ── Crear + vincular un ternero NUEVO (RCAP.4.3 / RCAP.5). ──
  const onConfirmCreate = useCallback(
    async (identifier: CreateIdentifier) => {
      if (busyRef.current) return;
      if (!motherProfileId) return;
      setActionError(null);

      // Sexo REQUERIDO (RCAP.4.2): error inline, sin crear ni vincular.
      if (!sex) {
        setSexError('Elegí el sexo del ternero.');
        return;
      }
      setSexError(null);

      // Fecha OPCIONAL es-AR (RCAP.9.4), reusando la util del alta (año + DD/MM → exacta o midpoint o null).
      const dateV = validateBirthDate(birthYear, birthDayMonth, new Date());
      setBirthYearError(!dateV.ok && dateV.field === 'year' ? dateV.error : null);
      setDayMonthError(!dateV.ok && dateV.field === 'dayMonth' ? dateV.error : null);
      if (!dateV.ok) return;

      // RCAP.5: rodeo efectivo (preseleccionado = el de la madre; editable a otro del mismo sistema). La RPC
      // re-valida server-side (activo, tenant de la madre, mismo sistema → 23514 si no).
      const calfRodeoId = effectiveCalfRodeoId;
      // event_date del parto = la fecha del ternero (exacta/midpoint) o hoy si no se cargó.
      const eventDate = dateV.date ?? todayIsoLocal();

      busyRef.current = true;
      setBusy(true);
      const r = await registerBirth({
        motherProfileId,
        eventDate,
        calves: [{ sex, tag: identifier.tag }],
        calfRodeoId,
        calfIdv: identifier.idv,
      });
      busyRef.current = false;
      setBusy(false);
      if (!r.ok) {
        setActionError(r.error.message || 'No pudimos crear el ternero. Probá de nuevo.');
        return;
      }
      onLinked();
    },
    [motherProfileId, sex, birthYear, birthDayMonth, effectiveCalfRodeoId, onLinked],
  );

  if (!open) return null;

  return (
    <View
      position="absolute"
      top="$0"
      left="$0"
      right="$0"
      bottom="$0"
      backgroundColor="$scrim"
      justifyContent="flex-end"
    >
      <Pressable
        style={{ flex: 1, width: '100%' }}
        onPress={onBackdropPress}
        testID="link-calf-scrim"
        {...buttonA11y(Platform.OS, { label: 'Cerrar' })}
      />

      <YStack
        width="100%"
        maxHeight="88%"
        backgroundColor="$bg"
        borderTopLeftRadius="$card"
        borderTopRightRadius="$card"
        paddingHorizontal="$4"
        paddingTop="$4"
        paddingBottom={bottomPad}
        gap="$4"
        testID="link-calf-sheet"
      >
        {/* ── HEADER FIJO (grip + título). flexShrink:0 → el título NUNCA se recorta al crecer el body. ── */}
        <YStack flexShrink={0} gap="$3">
          <View
            alignSelf="center"
            width={getTokenValue('$icon', 'size')}
            height={getTokenValue('$progressTrack', 'size')}
            borderRadius="$pill"
            backgroundColor="$divider"
          />
          <YStack gap="$1">
            {/* Título $7 con lineHeight matcheado (anti-recorte: "pie" tiene descendente). */}
            <Text
              fontFamily="$heading"
              fontSize="$7"
              lineHeight="$7"
              fontWeight="700"
              color="$textPrimary"
              numberOfLines={1}
            >
              ¿Vincular su cría al pie?
            </Text>
            <Text
              fontFamily="$body"
              fontSize="$3"
              lineHeight="$3"
              fontWeight="500"
              color="$textMuted"
              numberOfLines={2}
            >
              {phase.kind === 'create'
                ? 'No encontramos ese ternero. Cargá sus datos para crearlo y vincularlo.'
                : phase.kind === 'found'
                  ? 'Encontramos el ternero. Confirmá para vincularlo como cría al pie.'
                  : 'Ingresá la caravana del ternero al pie para vincularlo a esta vaca.'}
            </Text>
          </YStack>
        </YStack>

        {/* ── BODY SCROLLEABLE (flex:1 + minHeight:0 web) → crece adentro, no tapa el header. ── */}
        <ScrollView
          flex={1}
          style={{ minHeight: 0 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: getTokenValue('$4', 'space') }}
        >
          {phase.kind === 'ask' ? (
            <YStack gap="$3">
              {/* BASTONEO (scan-para-llenar): el bastón es el 95% del flujo en manga. El CTA llena el campo de
                  abajo con el EID leído y avanza el find-or-create. El campo de texto QUEDA como fallback y como
                  el camino para tipear un IDV (que el bastón no lee). */}
              <TagScanCta
                onPress={openScan}
                label="Bastonear la caravana del ternero"
                testID="link-calf-scan-open"
              />
              <FormField
                label="Caravana del ternero"
                value={query}
                onChangeText={(t) => {
                  setQuery(sanitizeIdvInput(t));
                  if (fieldError) setFieldError(null);
                  if (info) setInfo(null);
                }}
                error={fieldError}
                placeholder="Caravana electrónica o visual"
                keyboardType="number-pad"
                autoCapitalize="none"
                returnKeyType="search"
                onSubmitEditing={() => void onSearch()}
              />
              {/* Aviso accionable (ya tiene madre / otro campo / varios). InfoNote NO tapa el título (header fijo). */}
              {info ? <InfoNote>{info}</InfoNote> : null}
            </YStack>
          ) : phase.kind === 'found' ? (
            <FoundCalfCard calf={phase.calf} />
          ) : (
            <CreateCalfForm
              sex={sex}
              sexError={sexError}
              onSex={(s) => {
                setSex(s);
                if (sexError) setSexError(null);
              }}
              birthYear={birthYear}
              birthYearError={birthYearError}
              onBirthYear={(t) => {
                setBirthYear(sanitizeBirthYearInput(t));
                if (birthYearError) setBirthYearError(null);
              }}
              birthDayMonth={birthDayMonth}
              dayMonthError={dayMonthError}
              onBirthDayMonth={(t) => {
                setBirthDayMonth(sanitizeDayMonthInput(t));
                if (dayMonthError) setDayMonthError(null);
              }}
              rodeoName={selectedCalfRodeoName}
              isSameRodeoAsMother={isSameRodeoAsMother}
              rodeoOptions={calfRodeoOptions}
              selectedRodeoId={effectiveCalfRodeoId}
              pickerOpen={rodeoPickerOpen}
              onTogglePicker={() => setRodeoPickerOpen((v) => !v)}
              onSelectRodeo={(id) => {
                setSelectedCalfRodeoId(id);
                setRodeoPickerOpen(false);
              }}
              muted={muted}
            />
          )}
        </ScrollView>

        {/* ── FOOTER FIJO (acción del fase + "Ahora no"). flexShrink:0 → siempre abajo. ── */}
        <YStack flexShrink={0} gap="$2">
          {actionError ? (
            <Text
              fontFamily="$body"
              fontSize="$3"
              lineHeight="$3"
              fontWeight="500"
              color="$terracota"
              numberOfLines={3}
            >
              {actionError}
            </Text>
          ) : null}

          {phase.kind === 'ask' ? (
            <Button
              testID="link-calf-search"
              variant="primary"
              fullWidth
              disabled={busy}
              onPress={() => void onSearch()}
            >
              {busy ? 'Buscando…' : 'Buscar ternero'}
            </Button>
          ) : phase.kind === 'found' ? (
            <Button
              testID="link-calf-confirm"
              variant="primary"
              fullWidth
              disabled={busy}
              onPress={() => void onConfirmLink(phase.calf)}
            >
              {busy ? 'Vinculando…' : 'Vincular como cría al pie'}
            </Button>
          ) : (
            <Button
              testID="link-calf-create"
              variant="primary"
              fullWidth
              disabled={busy}
              onPress={() => void onConfirmCreate(phase.identifier)}
            >
              {busy ? 'Creando…' : 'Crear y vincular'}
            </Button>
          )}

          {/* "← Cambiar caravana": desde 'found'/'create', volver a la captura conservando lo tipeado. Arriba
              de "Ahora no" (no compite con el CTA primario). Mismo patrón visual que "Ahora no" (muted, $5). */}
          {phase.kind !== 'ask' ? (
            <View
              testID="link-calf-back"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              pressStyle={{ opacity: 0.6 }}
              onPress={backToAsk}
              {...buttonA11y(Platform.OS, { label: 'Cambiar caravana' })}
            >
              <Text
                fontFamily="$body"
                fontSize="$5"
                lineHeight="$5"
                fontWeight="600"
                color="$textMuted"
                numberOfLines={1}
              >
                ← Cambiar caravana
              </Text>
            </View>
          ) : null}

          {/* "Ahora no" (RCAP.1.3): cierra sin vincular y navega (la vaca queda nursing=true). */}
          <View
            testID="link-calf-skip"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ opacity: 0.6 }}
            onPress={() => {
              if (busyRef.current) return;
              onSkip();
            }}
            {...buttonA11y(Platform.OS, { label: 'Ahora no' })}
          >
            <Text
              fontFamily="$body"
              fontSize="$5"
              lineHeight="$5"
              fontWeight="600"
              color="$textMuted"
              numberOfLines={1}
            >
              Ahora no
            </Text>
          </View>
        </YStack>
      </YStack>

      {/* Sheet de BASTONEO (scan-para-llenar), ÚLTIMO hijo → su scrim se pinta SOBRE el prompt. hideManualEntry:
          este buscador ya tiene su campo (EID **o** IDV) → el sheet ofrece "Cerrá y escribí la caravana" en vez
          del manual EID-only. onScanSubmit llena el query + avanza el find-or-create. El scoped scanner exclusivo
          se adquiere al montar / libera al desmontar (incl. cierre del prompt) → ownership limpio (ver cabecera). */}
      {scanOpen ? (
        <TagScanSheet
          onClose={closeScan}
          onSubmit={onScanSubmit}
          hideManualEntry
          title="Bastonear la caravana"
          confirmLabel="Usar caravana"
          confirmSublabel="Usar esta caravana para buscar el ternero al pie."
        />
      ) : null}
    </View>
  );
}

/** Etiqueta legible del ternero encontrado: idv ?? visual ?? caravana electrónica ?? "el ternero". */
function calfLabel(item: AnimalListItem): string {
  return (
    cleanLabel(item.idv) ??
    cleanLabel(item.visualIdAlt) ??
    cleanLabel(item.tagElectronic) ??
    'el ternero'
  );
}

function cleanLabel(v: string | null): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

// ─── Card del ternero ENCONTRADO (confirmación de vínculo) ────────────────────────────────────

function FoundCalfCard({ calf }: { calf: FoundCalf }) {
  return (
    <YStack
      gap="$1"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$divider"
      backgroundColor="$surface"
      paddingHorizontal="$4"
      paddingVertical="$3"
    >
      <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={1}>
        Ternero encontrado
      </Text>
      {/* lineHeight matcheado (la caravana/seña puede traer descendentes: "g"/"y"/"p"). */}
      <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={1}>
        {calf.label}
      </Text>
    </YStack>
  );
}

// ─── Mini-form del camino CREATE: sexo* / fecha opc. es-AR / rodeo (preseleccionado + editable) ─────

function CreateCalfForm({
  sex,
  sexError,
  onSex,
  birthYear,
  birthYearError,
  onBirthYear,
  birthDayMonth,
  dayMonthError,
  onBirthDayMonth,
  rodeoName,
  isSameRodeoAsMother,
  rodeoOptions,
  selectedRodeoId,
  pickerOpen,
  onTogglePicker,
  onSelectRodeo,
  muted,
}: {
  sex: AnimalSex | null;
  sexError: string | null;
  onSex: (s: AnimalSex) => void;
  birthYear: string;
  birthYearError: string | null;
  onBirthYear: (t: string) => void;
  birthDayMonth: string;
  dayMonthError: string | null;
  onBirthDayMonth: (t: string) => void;
  rodeoName: string;
  isSameRodeoAsMother: boolean;
  rodeoOptions: Rodeo[];
  selectedRodeoId: string | null;
  pickerOpen: boolean;
  onTogglePicker: () => void;
  onSelectRodeo: (id: string) => void;
  muted: string;
}) {
  return (
    <YStack gap="$4">
      {/* ── Sexo (REQUERIDO, RCAP.4.2) ── */}
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Sexo del ternero
        </Text>
        <XStack gap="$2">
          <SexOption icon={Mars} label="Macho" selected={sex === 'male'} onPress={() => onSex('male')} />
          <SexOption icon={Venus} label="Hembra" selected={sex === 'female'} onPress={() => onSex('female')} />
        </XStack>
        {sexError ? (
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$terracota" numberOfLines={2}>
            {sexError}
          </Text>
        ) : null}
      </YStack>

      {/* ── Fecha de nacimiento OPCIONAL es-AR (año AAAA + día/mes DD/MM), reusa la util del alta. ── */}
      <FormField
        label="Año de nacimiento (opcional, AAAA)"
        value={birthYear}
        onChangeText={onBirthYear}
        placeholder="Ej. 2026"
        keyboardType="number-pad"
        error={birthYearError}
      />
      <FormField
        label="Día y mes (opcional, DD/MM)"
        value={birthDayMonth}
        onChangeText={onBirthDayMonth}
        placeholder="Ej. 15/03"
        keyboardType="number-pad"
        error={dayMonthError}
      />

      {/* ── Rodeo del ternero (RCAP.5): preseleccionado al de la madre + leyenda; editable al mismo sistema. ── */}
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Rodeo del ternero
        </Text>
        <Pressable onPress={onTogglePicker} {...buttonA11y(Platform.OS, { label: 'Elegir rodeo del ternero', selected: pickerOpen })}>
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
            <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary">
              {rodeoName}
            </Text>
            <ChevronDown size={22} color={muted} strokeWidth={2} />
          </XStack>
        </Pressable>
        {/* Leyenda "(Mismo rodeo que la madre)" mientras la selección coincida (RCAP.5.2). */}
        {isSameRodeoAsMother ? (
          <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="500" color="$textFaint" numberOfLines={1}>
            (Mismo rodeo que la madre)
          </Text>
        ) : null}
        {pickerOpen && rodeoOptions.length > 0 ? (
          <YStack
            gap="$1"
            borderRadius="$card"
            borderWidth={1}
            borderColor="$divider"
            backgroundColor="$bg"
            paddingVertical="$2"
            paddingHorizontal="$2"
          >
            {rodeoOptions.map((r) => (
              <RodeoOptionRow
                key={r.id}
                label={r.name}
                selected={r.id === selectedRodeoId}
                onPress={() => onSelectRodeo(r.id)}
              />
            ))}
          </YStack>
        ) : null}
      </YStack>
    </YStack>
  );
}

/** Opción de sexo del ternero (card compacta con ícono, target ≥$touchMin → Fitts). */
function SexOption({
  icon: Icon,
  label,
  selected,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  const white = getTokenValue('$white', 'color');
  return (
    <Pressable style={{ flex: 1 }} onPress={onPress} {...buttonA11y(Platform.OS, { label: `Sexo ${label}`, selected })}>
      <XStack
        width="100%"
        alignItems="center"
        justifyContent="center"
        gap="$2"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor={selected ? '$primary' : '$divider'}
        backgroundColor={selected ? '$primary' : '$white'}
        paddingHorizontal="$3"
        paddingVertical="$3"
        pressStyle={{ opacity: 0.85 }}
      >
        <Icon size={20} color={selected ? white : primary} strokeWidth={2.5} />
        <Text
          fontFamily="$body"
          fontSize="$5"
          lineHeight="$5"
          fontWeight="600"
          color={selected ? '$white' : '$textPrimary'}
          numberOfLines={1}
        >
          {label}
        </Text>
      </XStack>
    </Pressable>
  );
}

/** Fila de un rodeo elegible para el ternero (lista expandible del picker). */
function RodeoOptionRow({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: `Rodeo ${label}`, selected })}>
      <XStack alignItems="center" gap="$2" minHeight="$chipMin" paddingHorizontal="$2" paddingVertical="$2" pressStyle={{ opacity: 0.6 }}>
        <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textPrimary">
          {label}
        </Text>
        {selected ? <Check size={20} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} /> : null}
      </XStack>
    </Pressable>
  );
}
