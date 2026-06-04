// app/crear-animal.tsx — AnimalCreateScreen (spec 09 R4, find-or-create puerta MANUAL / C2).
//
// Alta interactiva de un animal nuevo tras un no-match en la tab Animales (R1.4 → R4). Recibe el
// identificador tipeado precargado (idv si parecía numérico, visual_id_alt si texto libre — la
// heurística R1.4 la decide animales.tsx con classifyIdentifier). En esta pantalla:
//   - el identificador precargado va READ-ONLY (R4.2) — no se modifica durante el alta.
//   - los otros 2 identificadores van vacíos, "recomendados, no obligatorios" (R4.3).
//   - selector de rodeo (R4.4): 1 rodeo activo → fijo read-only; ≥2 → combo con default
//     lastRodeoSelected (R6), siempre cambiable. Al cambiarlo se persiste (R4.9/R6.5).
//   - sexo: segmented control grande M/H, REQUERIDO (R4.5).
//   - nacimiento (date, no futuro), raza/pelaje/peso-entrada (cría, opcionales), lote opcional.
//   - validación con validadores PUROS (utils/animal-form). Submit → createAnimal → ficha (R4.7).
//   - error accionable (unique de TAG/IDV, sin red) que mantiene el form cargado (R4.8).
//
// Criticidad 🟡 (alta = oficina/manga progresiva). Targets grandes, una decisión clara por bloque,
// voseo es-AR. Cero hardcode (ADR-023 §4): tokens + componentes de la librería; lo que cruza a API
// no-Tamagui (íconos lucide, style del TextInput) se lee con getTokenValue. a11y por helper (utils/a11y).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { Check, ChevronDown, ChevronLeft } from 'lucide-react-native';

import { Button, Card, FormField, FormError, InfoNote } from '@/components';
import { useAuth, useEstablishment, useRodeo } from '@/contexts';
import { createAnimal } from '@/services/animals';
import { fetchManagementGroups, type ManagementGroup } from '@/services/management-groups';
import {
  readLastRodeo,
  writeLastRodeo,
  queryLastUsedRodeoFromDb,
  resolveDefaultRodeoId,
} from '@/services/last-rodeo';
import type { Rodeo } from '@/services/rodeos';
import { validateAnimalCreate, parseWeight, type AnimalCreateErrors } from '@/utils/animal-form';
import {
  sanitizeTagInput,
  sanitizeIdvInput,
  sanitizeVisualInput,
  maskDateInput,
  sanitizeWeightInput,
  isValidTagElectronic,
  TAG_ELECTRONIC_LENGTH,
  VISUAL_MAX_LENGTH,
} from '@/utils/animal-input';
import type { AnimalSex } from '@/utils/animal-category';
import { buttonA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

const OFFLINE_COPY =
  'Necesitás conexión para dar de alta un animal. Conectate a internet y volvé a intentar.';

// Topes de texto libre (raza / pelaje): acotados para que no se vuelvan campos de párrafo.
const BREED_MAX_LENGTH = 40;
const COAT_MAX_LENGTH = 40;

// Qué identificador vino precargado y en qué campo. 'idv' | 'visual' (la puerta manual nunca trae
// 'tag': eso es BLE, spec 04). Sin params → alta "en blanco" (CTA "Dar de alta tu primer animal").
type PrefillKind = 'idv' | 'visual' | null;

export default function CrearAnimalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ idv?: string; visual?: string }>();
  const { state: authState } = useAuth();
  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();

  const userId = authState.status === 'authenticated' ? authState.user.id : null;
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  // El identificador precargado (R4.2): viene por params. idv tiene prioridad sobre visual si
  // (por error) llegaran ambos. read-only durante el alta.
  const prefilledIdv = typeof params.idv === 'string' ? params.idv : '';
  const prefilledVisual = typeof params.visual === 'string' ? params.visual : '';
  const prefillKind: PrefillKind = prefilledIdv ? 'idv' : prefilledVisual ? 'visual' : null;

  // ── Identificadores editables (los 2 "recomendados", R4.3). El precargado NO está acá. ──
  // tag siempre editable acá (la puerta manual no precarga TAG); idv/visual editables salvo el
  // que vino precargado.
  const [tag, setTag] = useState('');
  const [idv, setIdv] = useState(prefillKind === 'idv' ? prefilledIdv : '');
  const [visual, setVisual] = useState(prefillKind === 'visual' ? prefilledVisual : '');

  // ── Rodeo (R4.4 / R6). available viene del RodeoContext (ya scopeado al campo activo). ──
  const rodeos: Rodeo[] = rodeoState.status === 'active' ? rodeoState.available : [];
  const [selectedRodeoId, setSelectedRodeoId] = useState<string | null>(null);
  const [rodeoPickerOpen, setRodeoPickerOpen] = useState(false);
  // Guard one-shot para no re-resolver el default cada render (deps primitivas, sin loop).
  const defaultResolvedRef = useRef(false);

  // ── Atributos del form de alta de cría (R4.5). ──
  const [sex, setSex] = useState<AnimalSex | null>(null);
  const [birthDate, setBirthDate] = useState('');
  const [entryDate, setEntryDate] = useState('');
  const [entryWeight, setEntryWeight] = useState('');
  const [breed, setBreed] = useState('');
  const [coatColor, setCoatColor] = useState('');

  // ── Lote (opcional, ADR-020). ──
  const [groups, setGroups] = useState<ManagementGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);

  const [errors, setErrors] = useState<AnimalCreateErrors | null>(null);
  // Error del TAG aparte (su validación no vive en animal-form: es "vacío o 15 díg exactos").
  const [tagError, setTagError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);

  // Rodeo elegido + sus datos (system_id para resolver la categoría inicial).
  //
  // ⚠️ FIX (carrera del rodeo-default, C3.2b T0): con EXACTAMENTE 1 rodeo el default se resuelve
  // ASYNC (readLastRodeo + queryLastUsedRodeoFromDb), así que `selectedRodeoId` queda null hasta que
  // resuelve. Si el operario submitea antes de que resuelva, daba "Elegí un rodeo" espurio (el único
  // rodeo posible es obvio). Fallback determinista: con 1 rodeo, `selectedRodeo` cae a ese único rodeo
  // aunque `selectedRodeoId` aún no resolvió → el submit nunca queda sin rodeo en el caso 1-rodeo.
  // El caso ≥2 rodeos NO cambia (combo + default async, R4.4): el fallback solo aplica a length===1.
  const selectedRodeo = useMemo(
    () => rodeos.find((r) => r.id === selectedRodeoId) ?? (rodeos.length === 1 ? rodeos[0] : null),
    [rodeos, selectedRodeoId],
  );

  // ── Resolver el rodeo default (R6.2→R6.3→R6.4) una vez que hay set + user + campo. ──
  // Dep PRIMITIVA: una key string del set de ids (no el array de objetos, que se recrea cada
  // render → lección RodeoContext/miembros.tsx, evita el loop de fetch). Reconstruimos los ids
  // DENTRO del efecto desde la key, así el array no entra en las deps.
  const rodeoIdsKey = useMemo(() => rodeos.map((r) => r.id).join(','), [rodeos]);
  useEffect(() => {
    if (defaultResolvedRef.current) return;
    const ids = rodeoIdsKey.length > 0 ? rodeoIdsKey.split(',') : [];
    if (!userId || !establishmentId || ids.length === 0) return;
    let active = true;
    (async () => {
      const persisted = await readLastRodeo(userId, establishmentId);
      if (!active) return;
      // Fallback DB solo si el persistido no resuelve (evita un round-trip innecesario).
      let dbLastUsed: string | null = null;
      if (!persisted || !ids.includes(persisted)) {
        const r = await queryLastUsedRodeoFromDb(establishmentId);
        if (!active) return;
        if (r.ok) dbLastUsed = r.value;
      }
      const def = resolveDefaultRodeoId(ids, persisted, dbLastUsed);
      if (!active) return;
      defaultResolvedRef.current = true;
      setSelectedRodeoId(def);
    })();
    return () => {
      active = false;
    };
  }, [userId, establishmentId, rodeoIdsKey]);

  // ── Cargar los lotes del campo (selector opcional). ──
  useEffect(() => {
    if (!establishmentId) return;
    let active = true;
    (async () => {
      const r = await fetchManagementGroups(establishmentId);
      if (!active) return;
      if (r.ok) setGroups(r.value);
    })();
    return () => {
      active = false;
    };
  }, [establishmentId]);

  const onSelectRodeo = useCallback(
    (rodeoId: string) => {
      setSelectedRodeoId(rodeoId);
      setRodeoPickerOpen(false);
      // Persistir el cambio manual (R4.9 / R6.5) en memoria + storage. Best-effort.
      if (userId && establishmentId) void writeLastRodeo(userId, establishmentId, rodeoId);
    },
    [userId, establishmentId],
  );

  const onSubmit = useCallback(async () => {
    if (busyRef.current) return;
    setFormError(null);
    const result = validateAnimalCreate(
      { sex, birthDate, entryDate, entryWeight, breed, coatColor },
      new Date(),
    );
    setErrors(result);
    // Caravana electrónica: vacía OK (recomendada, R4.3) o exactamente 15 díg (FDX-B). El
    // sanitizador ya impide tipear no-dígitos / >15; acá cerramos el caso "tipeó 8 y dejó".
    const tagOk = isValidTagElectronic(tag);
    setTagError(tagOk ? null : `La caravana electrónica tiene que tener ${TAG_ELECTRONIC_LENGTH} dígitos.`);
    if (!result.valid || !tagOk) return;
    if (!establishmentId || !selectedRodeo) {
      setFormError('Elegí un rodeo para el animal.');
      return;
    }

    busyRef.current = true;
    setSubmitting(true);
    const created = await createAnimal({
      establishmentId,
      rodeoId: selectedRodeo.id,
      systemId: selectedRodeo.systemId,
      sex: sex as AnimalSex,
      birthDate: birthDate.trim() || null,
      tagElectronic: tag.trim() || null,
      idv: idv.trim() || null,
      visualIdAlt: visual.trim() || null,
      breed: breed.trim() || null,
      coatColor: coatColor.trim() || null,
      entryDate: entryDate.trim() || null,
      entryWeight: parseWeight(entryWeight),
      managementGroupId: selectedGroupId,
    });
    setSubmitting(false);
    busyRef.current = false;

    if (!created.ok) {
      // R4.8: mantener el form cargado + mensaje accionable. Mapeamos los errores conocidos.
      setFormError(created.error.kind === 'network' ? OFFLINE_COPY : created.error.message);
      return;
    }
    // R4.7: a la ficha del animal recién creado. replace para no dejar el form en el back-stack.
    router.replace({ pathname: '/animal/[id]', params: { id: created.value.profileId } });
  }, [
    sex,
    birthDate,
    entryDate,
    entryWeight,
    breed,
    coatColor,
    tag,
    idv,
    visual,
    establishmentId,
    selectedRodeo,
    selectedGroupId,
    router,
  ]); // isValidTagElectronic/TAG_ELECTRONIC_LENGTH son constantes de módulo, no deps

  const muted = getTokenValue('$textMuted', 'color');
  const hasMultipleRodeos = rodeos.length >= 2;
  const noRodeo = rodeos.length === 0;

  const selectedGroupName =
    groups.find((g) => g.id === selectedGroupId)?.name ?? 'Sin lote';

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header con back. */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          {/* "Volver" ROBUSTO (backOr): si el stack está vacío (web-refresh / hot-reload / deep-link
              / cold-start directo en el alta) router.back() fallaría y dejaría al usuario trabado →
              caemos a la lista de animales (de donde se llega al alta por no-match, R1.4). El
              router.replace post-create de onSubmit NO se toca (ya es robusto). */}
          <Pressable
            hitSlop={8}
            onPress={() => backOr(router, '/(tabs)/animales')}
            {...buttonA11y(Platform.OS, { label: 'Volver' })}
          >
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            Dar de alta
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
        {noRodeo ? (
          <InfoNote>
            Creá un rodeo antes de cargar animales. Sin rodeo no hay dónde darlos de alta.
          </InfoNote>
        ) : null}

        {/* ── Identificadores (R4.2 precargado read-only + R4.3 recomendados). ── */}
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
            Identificación
          </Text>
          {prefillKind === 'idv' ? (
            <FormField
              label="Caravana / IDV (no editable)"
              value={idv}
              onChangeText={() => {}}
              editable={false}
            />
          ) : prefillKind === 'visual' ? (
            <FormField
              label="Identificación visual (no editable)"
              value={visual}
              onChangeText={() => {}}
              editable={false}
            />
          ) : null}

          {/* Los OTROS dos identificadores, recomendados pero no obligatorios (R4.3). El que vino
              precargado no se repite (su campo de arriba es read-only). Sanitizan en vivo: el IDV
              filtra a dígitos (numérico), el visual acota el largo (texto libre). */}
          {prefillKind !== 'idv' ? (
            <FormField
              label="Caravana / IDV (recomendado)"
              value={idv}
              onChangeText={(t) => setIdv(sanitizeIdvInput(t))}
              keyboardType="number-pad"
              placeholder="Número de caravana oficial"
            />
          ) : null}
          {prefillKind !== 'visual' ? (
            <FormField
              label="Identificación visual (recomendado)"
              value={visual}
              onChangeText={(t) => setVisual(sanitizeVisualInput(t))}
              autoCapitalize="sentences"
              maxLength={VISUAL_MAX_LENGTH}
              placeholder="Ej. 112 o una seña"
            />
          ) : null}
          {/* Caravana electrónica: 15 dígitos numéricos (FDX-B / ISO 11784/11785). Solo dígitos,
              máx 15, en vivo. El error de submit es el último recurso (vacío OK = recomendada). */}
          <FormField
            label={`Caravana electrónica (recomendado, ${TAG_ELECTRONIC_LENGTH} dígitos)`}
            value={tag}
            onChangeText={(t) => {
              setTag(sanitizeTagInput(t));
              if (tagError) setTagError(null); // limpia el error al corregir
            }}
            keyboardType="number-pad"
            placeholder="982 0001 2345 6789"
            error={tagError}
          />
        </YStack>

        {/* ── Rodeo (R4.4 / R6). ── */}
        {!noRodeo ? (
          <YStack gap="$2">
            <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
              Rodeo
            </Text>
            {hasMultipleRodeos ? (
              <RodeoCombo
                rodeos={rodeos}
                selectedId={selectedRodeoId}
                open={rodeoPickerOpen}
                onToggle={() => setRodeoPickerOpen((v) => !v)}
                onSelect={onSelectRodeo}
                muted={muted}
              />
            ) : (
              // Un solo rodeo activo → fijo, read-only (R4.4).
              <Card paddingVertical="$3">
                <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
                  {selectedRodeo?.name ?? rodeos[0]?.name ?? '—'}
                </Text>
              </Card>
            )}
          </YStack>
        ) : null}

        {/* ── Sexo (R4.5, REQUERIDO) — segmented control grande M/H. ── */}
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
            Sexo
          </Text>
          <SexSegmented value={sex} onChange={setSex} />
          {errors?.sex ? (
            <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
              {errors.sex}
            </Text>
          ) : null}
        </YStack>

        {/* ── Datos opcionales de cría (R4.5). Fechas con máscara numérica AAAA-MM-DD (no se puede
            tipear basura); peso filtrado a número decimal. ── */}
        <YStack gap="$3">
          <FormField
            label="Fecha de nacimiento (opcional, AAAA-MM-DD)"
            value={birthDate}
            onChangeText={(t) => setBirthDate(maskDateInput(t))}
            placeholder="AAAA-MM-DD"
            keyboardType="number-pad"
            error={errors?.birthDate}
          />
          <FormField
            label="Raza (opcional)"
            value={breed}
            onChangeText={(t) => setBreed(t.slice(0, BREED_MAX_LENGTH))}
            autoCapitalize="sentences"
            maxLength={BREED_MAX_LENGTH}
            placeholder="Ej. Angus"
          />
          <FormField
            label="Pelaje (opcional)"
            value={coatColor}
            onChangeText={(t) => setCoatColor(t.slice(0, COAT_MAX_LENGTH))}
            autoCapitalize="sentences"
            maxLength={COAT_MAX_LENGTH}
            placeholder="Ej. Colorado"
          />
          <FormField
            label="Fecha de ingreso (opcional, AAAA-MM-DD)"
            value={entryDate}
            onChangeText={(t) => setEntryDate(maskDateInput(t))}
            placeholder="AAAA-MM-DD"
            keyboardType="number-pad"
            error={errors?.entryDate}
          />
          <FormField
            label="Peso de entrada en kg (opcional)"
            value={entryWeight}
            onChangeText={(t) => setEntryWeight(sanitizeWeightInput(t))}
            keyboardType="decimal-pad"
            placeholder="Ej. 180"
            error={errors?.entryWeight}
          />
        </YStack>

        {/* ── Lote (opcional, ADR-020). Solo si el campo tiene lotes. ── */}
        {groups.length > 0 ? (
          <YStack gap="$2">
            <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
              Lote (opcional)
            </Text>
            <GroupCombo
              groups={groups}
              selectedId={selectedGroupId}
              selectedName={selectedGroupName}
              open={groupPickerOpen}
              onToggle={() => setGroupPickerOpen((v) => !v)}
              onSelect={(id) => {
                setSelectedGroupId(id);
                setGroupPickerOpen(false);
              }}
              muted={muted}
            />
          </YStack>
        ) : null}
      </ScrollView>

      {/* CTA fijo abajo (thumb-zone). */}
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
        <Button
          variant="primary"
          fullWidth
          disabled={submitting || noRodeo || !selectedRodeo}
          onPress={() => void onSubmit()}
        >
          {submitting ? 'Creando…' : 'Crear animal'}
        </Button>
      </YStack>
    </YStack>
  );
}

// ─── Segmented control de sexo (R4.5, grande, manga-friendly) ─────────────────────────

function SexSegmented({
  value,
  onChange,
}: {
  value: AnimalSex | null;
  onChange: (s: AnimalSex) => void;
}) {
  return (
    <XStack
      width="100%"
      gap="$2"
      backgroundColor="$surface"
      borderRadius="$pill"
      borderWidth={1}
      borderColor="$divider"
      padding="$1"
    >
      <SexOption label="Macho" selected={value === 'male'} onPress={() => onChange('male')} />
      <SexOption label="Hembra" selected={value === 'female'} onPress={() => onChange('female')} />
    </XStack>
  );
}

function SexOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  // a11y por helper (web=ARIA, native=accessibility*) — NO spreadear accessibilityLabel crudo en
  // el Pressable de RN-web (BUG del LogBox que tapa la pantalla, lección C1).
  const a11y = buttonA11y(Platform.OS, { label: `Sexo ${label}`, selected });
  return (
    <Pressable style={{ flex: 1 }} onPress={onPress} {...a11y}>
      <View
        flex={1}
        minHeight="$touchMin"
        alignItems="center"
        justifyContent="center"
        borderRadius="$pill"
        backgroundColor={selected ? '$primary' : 'transparent'}
        pressStyle={{ opacity: 0.85 }}
      >
        <Text
          fontFamily="$body"
          fontSize="$5"
          fontWeight="600"
          color={selected ? '$white' : '$textMuted'}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Combo de rodeo (≥2 rodeos, R4.4) ─────────────────────────────────────────────────

function RodeoCombo({
  rodeos,
  selectedId,
  open,
  onToggle,
  onSelect,
  muted,
}: {
  rodeos: Rodeo[];
  selectedId: string | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  muted: string;
}) {
  const selected = rodeos.find((r) => r.id === selectedId);
  return (
    <YStack gap="$2">
      <Pressable
        onPress={onToggle}
        {...buttonA11y(Platform.OS, { label: 'Elegir rodeo', selected: open })}
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
          <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
            {selected?.name ?? 'Elegí un rodeo'}
          </Text>
          <ChevronDown size={22} color={muted} strokeWidth={2} />
        </XStack>
      </Pressable>
      {open ? (
        <Card gap="$1" paddingVertical="$2">
          {rodeos.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => onSelect(r.id)}
              {...buttonA11y(Platform.OS, { label: `Rodeo ${r.name}`, selected: r.id === selectedId })}
            >
              <XStack
                alignItems="center"
                gap="$2"
                minHeight="$chipMin"
                paddingHorizontal="$2"
                pressStyle={{ opacity: 0.6 }}
              >
                <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
                  {r.name}
                </Text>
                {r.id === selectedId ? <Check size={20} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} /> : null}
              </XStack>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </YStack>
  );
}

// ─── Combo de lote (opcional, ADR-020) — incluye "Sin lote" ──────────────────────────

function GroupCombo({
  groups,
  selectedId,
  selectedName,
  open,
  onToggle,
  onSelect,
  muted,
}: {
  groups: ManagementGroup[];
  selectedId: string | null;
  selectedName: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (id: string | null) => void;
  muted: string;
}) {
  return (
    <YStack gap="$2">
      <Pressable onPress={onToggle} {...buttonA11y(Platform.OS, { label: 'Elegir lote', selected: open })}>
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
          <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
            {selectedName}
          </Text>
          <ChevronDown size={22} color={muted} strokeWidth={2} />
        </XStack>
      </Pressable>
      {open ? (
        <Card gap="$1" paddingVertical="$2">
          <GroupOption label="Sin lote" selected={selectedId === null} onPress={() => onSelect(null)} />
          {groups.map((g) => (
            <GroupOption
              key={g.id}
              label={g.name}
              selected={g.id === selectedId}
              onPress={() => onSelect(g.id)}
            />
          ))}
        </Card>
      ) : null}
    </YStack>
  );
}

function GroupOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: `Lote ${label}`, selected })}>
      <XStack alignItems="center" gap="$2" minHeight="$chipMin" paddingHorizontal="$2" pressStyle={{ opacity: 0.6 }}>
        <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
          {label}
        </Text>
        {selected ? <Check size={20} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} /> : null}
      </XStack>
    </Pressable>
  );
}
