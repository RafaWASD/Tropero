// app/import-rodeo.tsx — wizard "Importar rodeo" (spec 12 / Fase 4, T4.2–T4.5).
//
// Carga inicial del padrón en LOTE: el usuario nuevo con un rodeo entero (el caso del beta de
// Chascomús). Sube UN archivo (planilla CSV/Excel con mapeo de columnas, o TXT de SIGSA fijo), el
// sistema parsea LOCAL (R12.1), valida por fila, muestra un PREVIEW (válidos/errores/duplicados) y al
// confirmar escribe en lote vía el RPC `import_rodeo_bulk` (online por diseño, R12.2).
//
// 4 pasos internos (1 ruta), una decisión por pantalla (CLAUDE.md ppio 4 — aunque el import es
// operación de oficina, mantenemos el lenguaje del resto de los wizards: crear-rodeo / crear-animal):
//   1. FUENTE + DESTINO : 2 cards de fuente (Planilla | SIGSA) + rodeo destino (1 fijo / ≥2 selector) +
//                          "Elegir archivo" (R1.3, R2). pickFile valida tamaño ANTES de leer (R3.1).
//   2. MAPEO (solo CSV/Excel): cada campo del censo → un header del archivo (auto-detectado, ajustable,
//                          R4.1/R4.2). ≥1 identificador + sexo habilita "Continuar".
//   3. PREVIEW          : 3 conteos grandes (Válidos/Con error/Duplicados) + lista capeada con motivo
//                          LEGIBLE por fila (nunca sqlerrm crudo) + confirmación (R5.3–R5.6).
//   4. RESULTADO        : conteos finales + qué corregir (legible) + CTAs (R8.3).
//
// GATES de la pantalla (notas de seguridad carry-forward de security_code_12-service.md §Fase 4):
//   - field_operator NO ve el flujo (R2.4 — el RPC ya lo bloquea a nivel DB; esto es defensa UX).
//   - sin rodeo activo → bloqueo con CTA al wizard de crear rodeo (R1.4).
//   - los motivos de error SIEMPRE pasan por copy legible (el hook/import-ui los traduce); jamás el
//     error.message/sqlerrm crudo de la DB.
//
// Cero hardcode (ADR-023 §4): tokens + componentes de la librería; lo que cruza a API no-Tamagui
// (íconos lucide) se lee con getTokenValue. a11y por helper (buttonA11y/labelA11y, nunca crudo). Voseo.

import { useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  FileSpreadsheet,
  FileText,
} from 'lucide-react-native';

import { Button, Card, CategoryBadge, FormError, InfoNote } from '@/components';
import { useEstablishment, useRodeo } from '@/contexts';
import type { Rodeo } from '@/services/rodeos';
import {
  useImportRodeo,
  type ImportSource,
  type ImportStep,
} from '@/hooks/useImportRodeo';
import type { ColumnMapping, CensusField } from '@/utils/import/column-mapping';
import { columnIndexFor } from '@/utils/import/column-mapping';
import {
  CENSUS_FIELDS,
  IDENTIFIER_FIELDS,
  censusFieldLabel,
  writeErrorCopy,
  type PreviewItem,
} from '@/utils/import/import-ui';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';

const TOTAL_STEPS = 4;

/** Tope visual de filas-de-error renderizadas en el resultado (perf con miles de errores). */
const WRITE_ERRORS_CAP = 50;

/** Mapea el paso de la máquina al número visible (1..4) para la barra de progreso. */
function stepNumber(step: ImportStep): number {
  switch (step) {
    case 'source':
      return 1;
    case 'mapping':
      return 2;
    case 'preview':
      return 3;
    case 'result':
      return 4;
  }
}

export default function ImportRodeoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();

  const role = estState.status === 'active' ? estState.role : null;
  const isFieldOperator = role === 'field_operator';
  const noRodeo = rodeoState.status !== 'active';

  const { state, setSource, setRodeo, pickFile, setColumnMapping, buildPreview, confirm, goBack, reset } =
    useImportRodeo();

  const muted = getTokenValue('$textMuted', 'color');

  // ── Gate de rol: field_operator NO ve el wizard (R2.4, nota de seguridad #3). ──
  if (isFieldOperator) {
    return (
      <BlockShell insets={insets} muted={muted} onBack={() => backOr(router, '/rodeos')}>
        <InfoNote>Solo el dueño o el veterinario pueden importar un rodeo.</InfoNote>
        <Button variant="secondary" fullWidth onPress={() => backOr(router, '/rodeos')}>
          Volver
        </Button>
      </BlockShell>
    );
  }

  // ── Gate de rodeo: sin rodeo activo → bloqueo con CTA al wizard de crear rodeo (R1.4). ──
  if (noRodeo) {
    return (
      <BlockShell insets={insets} muted={muted} onBack={() => backOr(router, '/(tabs)')}>
        <InfoNote>
          Para importar un rodeo necesitás tener al menos un rodeo creado. Creá uno y volvé a importar.
        </InfoNote>
        <Button variant="primary" fullWidth onPress={() => router.push('/crear-rodeo')}>
          Crear un rodeo
        </Button>
      </BlockShell>
    );
  }

  const current = stepNumber(state.step);

  function onHeaderBack() {
    if (state.step === 'source') {
      backOr(router, '/rodeos');
      return;
    }
    goBack();
  }

  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      {/* Header común: back-arrow + barra de progreso (4 pasos). */}
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4" gap="$3">
        <XStack width="100%" alignItems="center" gap="$2" paddingTop="$3">
          <Pressable hitSlop={8} onPress={onHeaderBack} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
            Importar rodeo
          </Text>
        </XStack>
        <ProgressBar step={current} total={TOTAL_STEPS} />
      </YStack>

      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingTop: getTokenValue('$3', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$4', 'space'),
        }}
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
      >
        {state.step === 'source' ? (
          <StepSource
            source={state.source}
            rodeos={state.rodeos}
            rodeoId={state.rodeoId}
            onSelectSource={setSource}
            onSelectRodeo={setRodeo}
          />
        ) : state.step === 'mapping' ? (
          <StepMapping
            headers={state.headers}
            mapping={state.mapping}
            onSetColumn={setColumnMapping}
            muted={muted}
          />
        ) : state.step === 'preview' && state.preview ? (
          <StepPreview preview={state.preview} />
        ) : state.step === 'result' && state.result ? (
          <StepResult result={state.result} />
        ) : (
          <InfoNote>Preparando…</InfoNote>
        )}
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
        <FormError message={state.error?.message ?? null} />

        {state.step === 'source' ? (
          <Button
            variant="primary"
            fullWidth
            disabled={!state.source || !state.rodeoId || state.loading}
            onPress={() => void pickFile()}
          >
            {state.loading ? 'Leyendo archivo…' : 'Elegir archivo'}
          </Button>
        ) : state.step === 'mapping' ? (
          <Button
            variant="primary"
            fullWidth
            disabled={!state.mappingComplete || state.loading}
            onPress={() => void buildPreview()}
          >
            {state.loading ? 'Revisando…' : 'Continuar'}
          </Button>
        ) : state.step === 'preview' && state.preview ? (
          <Button
            variant="primary"
            fullWidth
            disabled={state.preview.validCount === 0 || state.loading}
            onPress={() => void confirm()}
          >
            {state.loading
              ? 'Importando…'
              : `Importar ${state.preview.validCount} ${state.preview.validCount === 1 ? 'animal' : 'animales'}`}
          </Button>
        ) : state.step === 'result' ? (
          <YStack gap="$2">
            <Button variant="primary" fullWidth onPress={() => router.replace('/rodeos')}>
              Volver a Rodeos
            </Button>
            <Button variant="secondary" fullWidth onPress={reset}>
              Importar otro archivo
            </Button>
          </YStack>
        ) : null}
      </YStack>
    </YStack>
  );
}

// ─── Shell de bloqueo (rol / sin rodeo) — header con back + contenido centrado ──────────────

function BlockShell({
  insets,
  muted,
  onBack,
  children,
}: {
  insets: { top: number; bottom: number };
  muted: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={onBack} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
            Importar rodeo
          </Text>
        </XStack>
      </YStack>
      <YStack flex={1} width="100%" paddingHorizontal="$4" paddingTop="$4" gap="$3">
        {children}
      </YStack>
    </YStack>
  );
}

// ─── Barra de progreso (4 segmentos) — patrón de crear-rodeo ────────────────────────────────

function ProgressBar({ step, total }: { step: number; total: number }) {
  const segments = Array.from({ length: total }, (_, i) => i + 1);
  const label = `Paso ${step} de ${total}`;
  const a11y =
    Platform.OS === 'web'
      ? { role: 'progressbar' as const, 'aria-label': label }
      : { accessibilityLabel: label };
  return (
    <XStack width="100%" gap="$2" marginTop="$2" {...a11y}>
      {segments.map((n) => (
        <View
          key={n}
          flex={1}
          height="$progressTrack"
          borderRadius="$pill"
          backgroundColor={n <= step ? '$primary' : '$divider'}
        />
      ))}
    </XStack>
  );
}

// ─── Paso 1: Fuente + destino ───────────────────────────────────────────────────────────────

function StepSource({
  source,
  rodeos,
  rodeoId,
  onSelectSource,
  onSelectRodeo,
}: {
  source: ImportSource | null;
  rodeos: Rodeo[];
  rodeoId: string | null;
  onSelectSource: (s: ImportSource) => void;
  onSelectRodeo: (id: string) => void;
}) {
  const hasMultiple = rodeos.length >= 2;
  const singleName = rodeos[0]?.name ?? '—';
  return (
    <YStack gap="$4">
      <YStack gap="$1">
        <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
          Importar rodeo
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
          Cargá tu padrón existente desde una planilla o un archivo de SIGSA.
        </Text>
      </YStack>

      {/* Rodeo destino (R2.2/R2.3). */}
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
          Los animales entran al rodeo
        </Text>
        {hasMultiple ? (
          <RodeoSelector rodeos={rodeos} selectedId={rodeoId} onSelect={onSelectRodeo} />
        ) : (
          <Card paddingVertical="$3">
            <Text fontFamily="$body" fontSize="$5" fontWeight="600" color="$textPrimary">
              {singleName}
            </Text>
          </Card>
        )}
      </YStack>

      {/* Fuente (2 cards grandes). */}
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
          ¿De dónde viene el padrón?
        </Text>
        <SourceCard
          icon="spreadsheet"
          title="Planilla (CSV/Excel)"
          subtitle="Tu archivo de animales. Vas a asignar las columnas."
          selected={source === 'spreadsheet'}
          onPress={() => onSelectSource('spreadsheet')}
        />
        <SourceCard
          icon="sigsa"
          title="Archivo de SIGSA (.txt)"
          subtitle="El TXT de identificaciones. Se importa sin mapear."
          selected={source === 'sigsa'}
          onPress={() => onSelectSource('sigsa')}
        />
      </YStack>
    </YStack>
  );
}

function SourceCard({
  icon,
  title,
  subtitle,
  selected,
  onPress,
}: {
  icon: 'spreadsheet' | 'sigsa';
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  const Icon = icon === 'spreadsheet' ? FileSpreadsheet : FileText;
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label: title, selected })}>
      <XStack
        width="100%"
        alignItems="center"
        gap="$3"
        minHeight="$touchMin"
        borderRadius="$card"
        borderWidth={2}
        borderColor={selected ? '$primary' : '$divider'}
        backgroundColor={selected ? '$surface' : '$white'}
        paddingHorizontal="$4"
        paddingVertical="$3"
        pressStyle={{ opacity: 0.85 }}
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
          <Text fontFamily="$body" fontSize="$6" fontWeight="600" color="$textPrimary">
            {title}
          </Text>
          <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textMuted">
            {subtitle}
          </Text>
        </YStack>
        {selected ? <Check size={22} color={primary} strokeWidth={2.5} /> : null}
      </XStack>
    </Pressable>
  );
}

function RodeoSelector({
  rodeos,
  selectedId,
  onSelect,
}: {
  rodeos: Rodeo[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  return (
    <YStack width="100%" gap="$2">
      {rodeos.map((r) => {
        const selected = r.id === selectedId;
        return (
          <Pressable
            key={r.id}
            onPress={() => onSelect(r.id)}
            {...buttonA11y(Platform.OS, { label: `Rodeo ${r.name}`, selected })}
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
                numberOfLines={1}
                fontFamily="$body"
                fontSize="$5"
                fontWeight="600"
                color={selected ? '$white' : '$textPrimary'}
              >
                {r.name}
              </Text>
              {selected ? <Check size={20} color={getTokenValue('$white', 'color')} strokeWidth={2.5} /> : null}
            </XStack>
          </Pressable>
        );
      })}
    </YStack>
  );
}

// ─── Paso 2: Mapeo de columnas (solo CSV/Excel) ──────────────────────────────────────────────

function StepMapping({
  headers,
  mapping,
  onSetColumn,
  muted,
}: {
  headers: string[];
  mapping: ColumnMapping;
  onSetColumn: (columnIndex: number, field: CensusField | null) => void;
  muted: string;
}) {
  // Estado local: qué campo tiene el picker abierto (uno a la vez).
  const [openField, setOpenField] = useState<CensusField | null>(null);

  return (
    <YStack gap="$3">
      <YStack gap="$1">
        <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
          Asigná las columnas
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
          Decinos qué columna de tu planilla es cada dato. Marcamos con * los obligatorios.
        </Text>
      </YStack>

      <YStack gap="$2">
        {CENSUS_FIELDS.map((field) => (
          <FieldMappingRow
            key={field}
            field={field}
            headers={headers}
            mapping={mapping}
            open={openField === field}
            onToggle={() => setOpenField((f) => (f === field ? null : field))}
            onPick={(columnIndex) => {
              onSetColumn(columnIndex, field);
              setOpenField(null);
            }}
            onClear={() => {
              const col = columnIndexFor(mapping, field);
              if (col >= 0) onSetColumn(col, null);
              setOpenField(null);
            }}
            muted={muted}
          />
        ))}
      </YStack>

      <InfoNote>
        Necesitás asignar al menos un identificador (caravana electrónica, IDV u otro ID visual) y el
        sexo para poder continuar.
      </InfoNote>
    </YStack>
  );
}

/** ¿El campo es obligatorio para habilitar el preview? (≥1 identificador colectivo + sexo). */
function isRequiredField(field: CensusField): boolean {
  return field === 'sex' || (IDENTIFIER_FIELDS as readonly CensusField[]).includes(field);
}

function FieldMappingRow({
  field,
  headers,
  mapping,
  open,
  onToggle,
  onPick,
  onClear,
  muted,
}: {
  field: CensusField;
  headers: string[];
  mapping: ColumnMapping;
  open: boolean;
  onToggle: () => void;
  onPick: (columnIndex: number) => void;
  onClear: () => void;
  muted: string;
}) {
  const col = columnIndexFor(mapping, field);
  const assignedHeader = col >= 0 ? headers[col] : null;
  const required = isRequiredField(field);
  const label = `${censusFieldLabel(field)}${required ? ' *' : ''}`;

  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
      <Pressable onPress={onToggle} {...buttonA11y(Platform.OS, { label: `Elegir columna para ${censusFieldLabel(field)}`, selected: open })}>
        <XStack
          width="100%"
          minHeight="$touchMin"
          alignItems="center"
          gap="$3"
          backgroundColor="$white"
          borderRadius="$card"
          borderWidth={1}
          borderColor={assignedHeader ? '$primary' : '$divider'}
          paddingHorizontal="$4"
          pressStyle={{ backgroundColor: '$surface' }}
        >
          <Text
            flex={1}
            minWidth={0}
            numberOfLines={1}
            fontFamily="$body"
            fontSize="$5"
            fontWeight={assignedHeader ? '600' : '400'}
            color={assignedHeader ? '$textPrimary' : '$textMuted'}
          >
            {assignedHeader ?? 'Sin asignar'}
          </Text>
          <ChevronDown size={22} color={muted} strokeWidth={2} />
        </XStack>
      </Pressable>

      {open ? (
        <Card gap="$1" paddingVertical="$2">
          <PickerOption label="Sin asignar" selected={col < 0} onPress={onClear} />
          {headers.map((h, i) => (
            <PickerOption
              key={`${h}-${i}`}
              label={h.trim().length > 0 ? h : `Columna ${i + 1}`}
              selected={i === col}
              onPress={() => onPick(i)}
            />
          ))}
        </Card>
      ) : null}
    </YStack>
  );
}

function PickerOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} {...buttonA11y(Platform.OS, { label, selected })}>
      <XStack alignItems="center" gap="$2" minHeight="$chipMin" paddingHorizontal="$2" pressStyle={{ opacity: 0.6 }}>
        <Text
          flex={1}
          minWidth={0}
          numberOfLines={1}
          fontFamily="$body"
          fontSize="$4"
          fontWeight="500"
          color="$textPrimary"
        >
          {label}
        </Text>
        {selected ? <Check size={20} color={getTokenValue('$primary', 'color')} strokeWidth={2.5} /> : null}
      </XStack>
    </Pressable>
  );
}

// ─── Paso 3: Preview ─────────────────────────────────────────────────────────────────────────

function StepPreview({
  preview,
}: {
  preview: {
    validCount: number;
    errorCount: number;
    duplicateCount: number;
    items: PreviewItem[];
    hiddenCount: number;
  };
}) {
  return (
    <YStack gap="$4">
      <YStack gap="$1">
        <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
          Revisá antes de importar
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
          Estos son los animales que vamos a cargar. Las filas con error o repetidas se saltan.
        </Text>
      </YStack>

      {/* Card de resumen con los 3 conteos grandes (jerarquía visual). */}
      <Card>
        <XStack width="100%" alignItems="flex-start">
          <CountColumn n={preview.validCount} label="Válidos" tone="primary" />
          <View width={1} backgroundColor="$divider" alignSelf="stretch" />
          <CountColumn n={preview.errorCount} label="Con error" tone="terracota" />
          <View width={1} backgroundColor="$divider" alignSelf="stretch" />
          <CountColumn n={preview.duplicateCount} label="Duplicados" tone="muted" />
        </XStack>
      </Card>

      {preview.validCount === 0 ? (
        <InfoNote>
          Ninguna fila se puede importar tal cual. Corregí el archivo (revisá identificadores y sexo) y
          volvé a subirlo.
        </InfoNote>
      ) : null}

      {/* Lista por fila (capeada para perf). */}
      <YStack gap="$2">
        {preview.items.map((item) => (
          <PreviewRow key={`${item.status}-${item.index}`} item={item} />
        ))}
        {preview.hiddenCount > 0 ? (
          <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted" paddingHorizontal="$2">
            {`y ${preview.hiddenCount} más…`}
          </Text>
        ) : null}
      </YStack>
    </YStack>
  );
}

function CountColumn({
  n,
  label,
  tone,
}: {
  n: number;
  label: string;
  tone: 'primary' | 'terracota' | 'muted';
}) {
  const color = tone === 'primary' ? '$primary' : tone === 'terracota' ? '$terracota' : '$textMuted';
  return (
    <YStack flex={1} alignItems="center" gap="$1" {...labelA11y(Platform.OS, `${n} ${label}`)}>
      <Text fontFamily="$body" fontSize="$9" fontWeight="700" color={color}>
        {n}
      </Text>
      <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted">
        {label}
      </Text>
    </YStack>
  );
}

function PreviewRow({ item }: { item: PreviewItem }) {
  const borderColor =
    item.status === 'valid' ? '$primary' : item.status === 'error' ? '$terracota' : '$divider';
  return (
    <XStack
      width="100%"
      alignItems="center"
      gap="$3"
      borderRadius="$card"
      borderWidth={1}
      borderColor={borderColor}
      backgroundColor="$white"
      paddingHorizontal="$4"
      paddingVertical="$3"
    >
      <YStack flex={1} minWidth={0} gap="$1">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary" numberOfLines={1}>
          {item.label}
        </Text>
        {item.status !== 'valid' ? (
          <Text
            fontFamily="$body"
            fontSize="$3"
            fontWeight="400"
            color={item.status === 'error' ? '$terracota' : '$textMuted'}
          >
            {item.reason}
          </Text>
        ) : null}
      </YStack>
      {item.status === 'valid' && item.categoryLabel ? (
        <CategoryBadge label={item.categoryLabel} />
      ) : null}
    </XStack>
  );
}

// ─── Paso 4: Resultado ───────────────────────────────────────────────────────────────────────

function StepResult({
  result,
}: {
  result: {
    totalRecords: number;
    importedOk: number;
    importedErrors: number;
    skippedExisting: { index: number }[];
    writeErrors: { index: number; reason: string }[];
  };
}) {
  const skippedCount = result.skippedExisting.length;
  const hadIssues = result.importedErrors > 0 || skippedCount > 0;
  return (
    <YStack gap="$4">
      <YStack gap="$1">
        <Text fontFamily="$body" fontSize="$8" fontWeight="700" color="$textPrimary">
          {hadIssues ? 'Importación con observaciones' : 'Importación lista'}
        </Text>
        <Text fontFamily="$body" fontSize="$4" fontWeight="400" color="$textMuted">
          {result.importedOk > 0
            ? `Cargamos ${result.importedOk} ${result.importedOk === 1 ? 'animal' : 'animales'} en el rodeo.`
            : 'No se cargó ningún animal en esta corrida.'}
        </Text>
      </YStack>

      <Card gap="$3">
        <ResultLine label="Importados" value={result.importedOk} tone="primary" />
        {result.importedErrors > 0 ? (
          <ResultLine label="Con error" value={result.importedErrors} tone="terracota" />
        ) : null}
        {skippedCount > 0 ? (
          <ResultLine label="Duplicados (saltados)" value={skippedCount} tone="muted" />
        ) : null}
      </Card>

      {result.writeErrors.length > 0 ? (
        <YStack gap="$2">
          <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
            Qué corregir
          </Text>
          {/* Las filas que no se pudieron escribir (carrera/unique server-side, R8.4). El motivo
              pasa SIEMPRE por writeErrorCopy → copy legible, NUNCA el sqlerrm crudo de la DB. */}
          {result.writeErrors.slice(0, WRITE_ERRORS_CAP).map((e) => (
            <XStack
              key={e.index}
              width="100%"
              alignItems="flex-start"
              gap="$3"
              borderRadius="$card"
              borderWidth={1}
              borderColor="$terracota"
              backgroundColor="$white"
              paddingHorizontal="$4"
              paddingVertical="$3"
            >
              <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$3" fontWeight="400" color="$terracota">
                {`Fila ${e.index + 1}: ${writeErrorCopy(e.reason)}`}
              </Text>
            </XStack>
          ))}
          {result.writeErrors.length > WRITE_ERRORS_CAP ? (
            <Text fontFamily="$body" fontSize="$3" fontWeight="500" color="$textMuted" paddingHorizontal="$2">
              {`y ${result.writeErrors.length - WRITE_ERRORS_CAP} más…`}
            </Text>
          ) : null}
        </YStack>
      ) : null}
    </YStack>
  );
}

function ResultLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'primary' | 'terracota' | 'muted';
}) {
  const color = tone === 'primary' ? '$primary' : tone === 'terracota' ? '$terracota' : '$textMuted';
  return (
    <XStack width="100%" alignItems="center" gap="$3">
      <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
        {label}
      </Text>
      <Text fontFamily="$body" fontSize="$7" fontWeight="700" color={color}>
        {value}
      </Text>
    </XStack>
  );
}
