// app/export-sigsa.tsx — ExportSigsaScreen: pantalla FLAGSHIP de exportación a SENASA (spec 08, T16 /
// R7, R8, R9, R10, R12, R13).
//
// Genera el archivo .txt importable en SIGSA web para declarar los dispositivos de identificación
// electrónica (Res. 841/2025). El productor sube el archivo manualmente; RAFAQ lo produce + recuerda
// los 4 datos de pantalla (checklist post-export). Accesible desde "Más" (stack-pushed, hermana de
// /rodeos). OFFLINE-FIRST (R14): toda la generación es local (SQLite de PowerSync) — el hook lo orquesta.
//
// Estructura (design §"UX — Pantalla de exportación", 🟡 criticidad MIXTA — oficina, RAFAQ big-touch):
//   - Card-resumen: "{N} animales listos" + botón "Exportar {N} animales" (deshabilitado si N=0) +
//     sub-texto "{M} a completar".
//   - Filtros colapsables (rodeo + rango de fechas de nacimiento), SECUNDARIOS (no dominan).
//   - Tabs: "Listos ({N})" / "A completar ({M})" / "Historial". Bajo cada tab, la lista.
//       · Listos → ExportAnimalRow (tap → ficha del animal).
//       · A completar → ExportAnimalRow con motivos faltantes (R8.3) + tap → ficha para completar.
//       · Historial → entradas de export_log (fecha/cantidad) + re-descarga (R10.1).
//   - Post-export → SigsaChecklistReminder (los 4 datos SENASA + plazo 10 días hábiles).
//
// Roles (R7): field_operator NO puede exportar (el RLS lo rechaza al subir, pero la UI no lo ofrece —
// se muestra un aviso). owner/vet sí (R7.2).
//
// El hook useExportSigsa orquesta todo (validación/generación/share/persistencia/historial); la pantalla
// SOLO renderiza + dispara. Cero hardcode (ADR-023 §4): tokens + componentes; íconos lucide vía
// getTokenValue. es-AR voseo.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { getTokenValue, ScrollView, Text, View, XStack, YStack } from 'tamagui';
import { ChevronLeft, ChevronRight, Download, FileText, SlidersHorizontal } from 'lucide-react-native';

import { Button, Card, FormField, InfoNote, Select } from '@/components';
import { ReportEmpty, ReportError } from '@/components/reports';
import { ExportAnimalRow, MarkDeclaredSheet, SigsaChecklistReminder } from '@/components/sigsa';
import { useEstablishment, useRodeo } from '@/contexts';
import { useExportSigsa } from '@/hooks/useExportSigsa';
import { loadEstablishmentDetail } from '@/services/establishments';
import type { PendingAnimalInfo } from '@/services/sigsa/types';
import { animalCountLabel, exportLogDateLabel } from '@/utils/sigsa-display';
import { isValidBirthDateRange, normalizeFilterDate } from '@/utils/sigsa-filters';
import { maskDateInput } from '@/utils/animal-input';
import { buttonA11y } from '@/utils/a11y';

type TabKey = 'ready' | 'incomplete' | 'history';

export default function ExportSigsaScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();

  const establishmentId = estState.status === 'active' ? estState.current.id : null;
  // R7.1/R7.3: field_operator NO puede exportar (owner/vet only). La UI no ofrece el flujo (el RLS lo
  // rechaza al SUBIR igual). El rol sale del contexto del campo activo (nunca se asume).
  const role = estState.status === 'active' ? estState.role : null;
  const canExport = role === 'owner' || role === 'veterinarian';

  const {
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
  } = useExportSigsa();

  const [tab, setTab] = useState<TabKey>('ready');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [rodeoPickerOpen, setRodeoPickerOpen] = useState(false);
  // Action-sheet de markAsDeclared (R10.2): el animal "Listo" tocado, o null (cerrado).
  const [markTarget, setMarkTarget] = useState<{ id: string; rfid: string | null } | null>(null);
  // RENSPA del campo activo para prepoblar el checklist (R13.3). Se carga local (offline) al enfocar.
  const [renspa, setRenspa] = useState<string | null>(null);

  const incompleteCount = incompleteAnimals.length;

  // ── RENSPA del campo activo (R13.3): lo carga el checklist prepoblado. Lectura LOCAL (offline). ──
  useEffect(() => {
    if (!establishmentId) {
      setRenspa(null);
      return;
    }
    let active = true;
    (async () => {
      const r = await loadEstablishmentDetail(establishmentId);
      if (!active) return;
      setRenspa(r.ok ? r.establishment.renspa : null);
    })();
    return () => {
      active = false;
    };
  }, [establishmentId]);

  // Recargar al ENFOCAR (volver de la ficha tras completar un dato): el animal completado puede pasar de
  // "a completar" a "listo", o un alta nueva aparecer. La query local del hook NO es reactiva (one-shot
  // getAll), así que el refresh manual al re-enfocar es lo que la pone al día. `refresh` en deps → siempre
  // se llama la versión FRESCA (con los filtros actuales); el costo es un refresh idempotente extra al
  // cambiar un filtro (el hook ya recarga por su cuenta) — benigno (mismo patrón que rodeos.tsx).
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // ── Derivaciones para las listas ──
  // "Listos": los pendientes cuyo id NO está en incompleteAnimals (mismo criterio que el hook al generar).
  const incompleteIds = useMemo(
    () => new Set(incompleteAnimals.map((i) => i.animalProfileId)),
    [incompleteAnimals],
  );
  const readyAnimals = useMemo(
    () => pendingAnimals.filter((a) => !incompleteIds.has(a.animalProfileId)),
    [pendingAnimals, incompleteIds],
  );
  // "A completar": el id+reasons del hook JOINeado con el PendingAnimalInfo (para el rfid/sexo de la fila).
  const incompleteRows = useMemo(() => {
    const byId = new Map<string, PendingAnimalInfo>(pendingAnimals.map((a) => [a.animalProfileId, a]));
    return incompleteAnimals.map((i) => ({ info: byId.get(i.animalProfileId) ?? null, reasons: i.reasons, id: i.animalProfileId }));
  }, [pendingAnimals, incompleteAnimals]);

  const goToAnimal = useCallback(
    (id: string) => router.push({ pathname: '/animal/[id]', params: { id } }),
    [router],
  );

  const onExport = useCallback(() => {
    void generateExport();
  }, [generateExport]);

  // Confirmar "marcar como ya declarado por otro medio" (R10.2): marca + cierra el sheet. El hook refresca
  // (el animal desaparece de pendientes). El gating de rol (owner/vet) lo aplica el RLS al subir; la pantalla
  // ya solo se le muestra a owner/vet (canExport).
  const onConfirmMarkDeclared = useCallback(() => {
    if (!markTarget) return;
    const id = markTarget.id;
    setMarkTarget(null);
    void markDeclared(id);
  }, [markTarget, markDeclared]);

  // ── Estado de pantalla completa: sin campo activo ──
  if (estState.status !== 'active') {
    return (
      <Shell insets={insets} onBack={() => router.back()}>
        <InfoNote>Elegí un campo para exportar a SENASA.</InfoNote>
      </Shell>
    );
  }

  // ── Gate de rol: field_operator no exporta (R7.1/R7.3) ──
  if (!canExport) {
    return (
      <Shell insets={insets} onBack={() => router.back()}>
        <InfoNote>
          Solo el dueño o el veterinario del campo pueden generar la exportación a SENASA. Vos sos
          miembro de este campo.
        </InfoNote>
      </Shell>
    );
  }

  const rodeos = rodeoState.status === 'active' ? rodeoState.available : [];
  const rodeoOptions = rodeos.map((r) => ({ value: r.id, label: r.name }));

  return (
    <Shell
      insets={insets}
      onBack={() => router.back()}
      footer={
        <ExportStickyBar
          exportableCount={exportableCount}
          isGenerating={isGenerating}
          bottomInset={insets.bottom}
          onExport={onExport}
        />
      }
      overlay={
        // Action-sheet de markAsDeclared (R10.2): solo montado cuando hay una fila "Listo" tocada.
        <MarkDeclaredSheet
          open={markTarget != null}
          onClose={() => setMarkTarget(null)}
          rfid={markTarget?.rfid ?? null}
          busy={isGenerating}
          onConfirmMarkDeclared={onConfirmMarkDeclared}
          onViewAnimal={() => {
            const id = markTarget?.id;
            setMarkTarget(null);
            if (id) goToAnimal(id);
          }}
        />
      }
    >
      {/* Subtítulo de contexto. */}
      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="400" color="$textMuted">
        Generá el archivo para declarar las caravanas electrónicas en SIGSA web.
      </Text>

      {/* ── Card-resumen (solo el conteo; el CTA de export vive en la barra sticky de abajo, A2) ── */}
      <SummaryCard exportableCount={exportableCount} incompleteCount={incompleteCount} />

      {/* ── Error del último intento (legible, ya mapeado por el hook) ── */}
      {error ? <ReportError message={error.message} onRetry={() => void refresh()} /> : null}

      {/* ── Checklist post-export (R13): aparece cuando hay un export hecho en la sesión. RENSPA prepoblado
            (R13.3): se pasa el renspa del campo activo (null → el checklist muestra el aviso de completarlo). ── */}
      {lastExport ? (
        <SigsaChecklistReminder
          renspa={renspa}
          fileName={lastExport.fileName}
          animalCount={lastExport.animalCount}
        />
      ) : null}

      {/* ── Filtros colapsables (rodeo + rango de fechas de nacimiento), SECUNDARIOS ── */}
      <FiltersSection
        open={filtersOpen}
        onToggle={() => setFiltersOpen((v) => !v)}
        rodeoId={filters.rodeoId ?? null}
        rodeoOptions={rodeoOptions}
        rodeoPickerOpen={rodeoPickerOpen}
        onToggleRodeoPicker={() => setRodeoPickerOpen((v) => !v)}
        onChangeRodeo={(v) => {
          setFilters({ ...filters, rodeoId: v });
          setRodeoPickerOpen(false);
        }}
        dateFrom={filters.dateFrom ?? null}
        dateTo={filters.dateTo ?? null}
        onChangeDates={(from, to) => setFilters({ ...filters, dateFrom: from, dateTo: to })}
        hasActiveFilter={filters.rodeoId != null || filters.dateFrom != null || filters.dateTo != null}
        onClear={() => setFilters({})}
      />

      {/* ── Tabs: Listos / A completar / Historial ── */}
      <SegmentedTabs
        tab={tab}
        onTab={setTab}
        readyCount={exportableCount}
        incompleteCount={incompleteCount}
        historyCount={history.length}
      />

      {/* ── Contenido de la tab activa ── */}
      {tab === 'history' ? (
        <HistoryList
          history={history}
          isGenerating={isGenerating}
          onRedownload={(id) => void redownloadExport(id)}
        />
      ) : tab === 'incomplete' ? (
        incompleteRows.length === 0 ? (
          <ReportEmpty
            title="Nada que completar"
            body="Todos los animales con caravana tienen los datos para declarar."
            tone="positive"
          />
        ) : (
          <ListCard>
            {incompleteRows.map((row) => (
              // "A completar" → tap DIRECTO a la ficha para completar el dato (R8.3); SIN action-sheet.
              <ExportAnimalRow
                key={row.id}
                rfid={row.info?.rfid ?? null}
                sex={row.info?.sex ?? null}
                reasons={row.reasons}
                onPress={() => goToAnimal(row.id)}
              />
            ))}
          </ListCard>
        )
      ) : readyAnimals.length === 0 ? (
        <ReadyEmpty hasIncomplete={incompleteCount > 0} hasHistory={history.length > 0} onSeeHistory={() => setTab('history')} onSeeIncomplete={() => setTab('incomplete')} />
      ) : (
        <ListCard>
          {readyAnimals.map((a) => (
            // "Listos" → tap abre el action-sheet (R10.2: marcar declarado por otro medio | ver ficha).
            <ExportAnimalRow
              key={a.animalProfileId}
              rfid={a.rfid}
              sex={a.sex}
              onPress={() => setMarkTarget({ id: a.animalProfileId, rfid: a.rfid })}
            />
          ))}
        </ListCard>
      )}
    </Shell>
  );
}

// ─── Shell (header con back + scroll) ────────────────────────────────────────────────────────────────

function Shell({
  insets,
  onBack,
  children,
  footer,
  overlay,
}: {
  insets: { top: number; bottom: number };
  onBack: () => void;
  children: React.ReactNode;
  /** Barra STICKY-BOTTOM (CTA de export, A2). Se renderiza FUERA del ScrollView → siempre visible. */
  footer?: React.ReactNode;
  /** Sheets/overlays (markAsDeclared) montados al root (cubren con su scrim). */
  overlay?: React.ReactNode;
}) {
  const muted = getTokenValue('$textMuted', 'color');
  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" gap="$2" paddingVertical="$3">
          <Pressable hitSlop={8} onPress={onBack} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
            <ChevronLeft size={28} color={muted} strokeWidth={2} />
          </Pressable>
          {/* Título $8 con lineHeight matcheado (ojo descendentes: "Exportar"). */}
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            Exportar a SENASA
          </Text>
        </XStack>
      </YStack>
      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          // La lista scrollea POR DETRÁS del sticky CTA → padding inferior generoso para que la última fila no
          // quede tapada por la barra (cuando hay footer). Sin footer (estados de aviso), el padding base alcanza.
          paddingBottom: insets.bottom + getTokenValue(footer ? '$10' : '$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$3', 'space'),
        }}
        showsHorizontalScrollIndicator={false}
      >
        {children}
      </ScrollView>
      {footer ?? null}
      {overlay ?? null}
    </YStack>
  );
}

// ─── Card-resumen + CTA exportar ─────────────────────────────────────────────────────────────────────

// SummaryCard: SOLO el conteo (el CTA de export se movió a la barra STICKY-BOTTOM — refinación A2 del leader).
// A1 (leader): la línea "{N} a completar" usa $textMuted (NO terracota): es ESTADO NORMAL, no una alerta. El
// terracota se reserva para el flag POR-FILA "Falta la raza" del ExportAnimalRow (ahí sí es señal de "ojo").
function SummaryCard({
  exportableCount,
  incompleteCount,
}: {
  exportableCount: number;
  incompleteCount: number;
}) {
  return (
    <Card gap="$1">
      {/* Número GRANDE que manda (patrón KpiCard). lineHeight matcheado. */}
      <Text fontFamily="$body" fontSize="$9" lineHeight="$9" fontWeight="800" color={exportableCount === 0 ? '$textMuted' : '$textPrimary'}>
        {exportableCount}
      </Text>
      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="500" color="$textMuted">
        {exportableCount === 1 ? 'animal listo para declarar' : 'animales listos para declarar'}
      </Text>
      {incompleteCount > 0 ? (
        <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted">
          {incompleteCount === 1 ? '1 animal a completar' : `${incompleteCount} animales a completar`}
        </Text>
      ) : null}
    </Card>
  );
}

// Barra STICKY-BOTTOM con el CTA de export (refinación A2). Full-width, ≥$touchMin, fondo $white con divider/
// sombra superior, paddingBottom respetando el inset. Es pantalla stack-pushed (sin bottom-nav) → no colisiona.
function ExportStickyBar({
  exportableCount,
  isGenerating,
  bottomInset,
  onExport,
}: {
  exportableCount: number;
  isGenerating: boolean;
  bottomInset: number;
  onExport: () => void;
}) {
  const disabled = exportableCount === 0 || isGenerating;
  const bottomPad = Math.max(bottomInset, getTokenValue('$navBottomMin', 'size'));
  return (
    <YStack
      width="100%"
      paddingHorizontal="$4"
      paddingTop="$3"
      paddingBottom={bottomPad}
      backgroundColor="$white"
      borderTopWidth={1}
      borderTopColor="$divider"
    >
      <Button variant="primary" fullWidth disabled={disabled} onPress={onExport}>
        {isGenerating
          ? 'Generando…'
          : exportableCount === 0
            ? 'Sin animales para exportar'
            : `Exportar ${animalCountLabel(exportableCount)}`}
      </Button>
    </YStack>
  );
}

// ─── Filtros colapsables (rodeo + rango de fechas de nacimiento), secundarios ────────────────────────

function FiltersSection({
  open,
  onToggle,
  rodeoId,
  rodeoOptions,
  rodeoPickerOpen,
  onToggleRodeoPicker,
  onChangeRodeo,
  dateFrom,
  dateTo,
  onChangeDates,
  hasActiveFilter,
  onClear,
}: {
  open: boolean;
  onToggle: () => void;
  rodeoId: string | null;
  rodeoOptions: { value: string; label: string }[];
  rodeoPickerOpen: boolean;
  onToggleRodeoPicker: () => void;
  onChangeRodeo: (v: string | null) => void;
  /** Filtro de fecha aplicado (ISO completo o null). El estado local del input lo deriva de acá. */
  dateFrom: string | null;
  dateTo: string | null;
  /** Aplica el rango (R9.3): from/to NORMALIZADOS (ISO completo o null). El componente solo llama esto con
   *  fechas COMPLETAS y un rango coherente (parcial/incoherente → no se aplica, se muestra el error inline). */
  onChangeDates: (from: string | null, to: string | null) => void;
  /** ¿Hay algún filtro activo (rodeo o fechas)? Controla el label "N activo" + "Limpiar". */
  hasActiveFilter: boolean;
  onClear: () => void;
}) {
  const muted = getTokenValue('$textMuted', 'color');
  // Estado LOCAL del texto de cada fecha (permite tipeo parcial sin romper). Se siembra del filtro aplicado.
  const [fromText, setFromText] = useState(dateFrom ?? '');
  const [toText, setToText] = useState(dateTo ?? '');
  // Sincroniza el texto si el filtro cambia DESDE AFUERA (ej. "Limpiar filtros" resetea a {}).
  useEffect(() => {
    setFromText(dateFrom ?? '');
  }, [dateFrom]);
  useEffect(() => {
    setToText(dateTo ?? '');
  }, [dateTo]);

  // Validación del rango (R9.3): desde > hasta → error inline en el "hasta" (borde rojo + texto, NO banner).
  const rangeValidation = isValidBirthDateRange(fromText, toText);
  const toError = !rangeValidation.ok ? rangeValidation.error : null;

  // Aplica el filtro de fechas cuando cambian (normalizando a completo-o-null). Si el rango es incoherente,
  // NO aplica (deja el error visible) pero NO borra lo ya aplicado — el usuario corrige y vuelve a quedar válido.
  const applyDates = useCallback(
    (nextFrom: string, nextTo: string) => {
      const v = isValidBirthDateRange(nextFrom, nextTo);
      if (!v.ok) return; // rango imposible → no se aplica (el error inline guía)
      onChangeDates(normalizeFilterDate(nextFrom), normalizeFilterDate(nextTo));
    },
    [onChangeDates],
  );

  return (
    <YStack gap="$2">
      <Pressable onPress={onToggle} {...buttonA11y(Platform.OS, { label: 'Filtros', selected: open })}>
        <XStack alignItems="center" gap="$2" minHeight="$chipMin" pressStyle={{ opacity: 0.6 }}>
          <SlidersHorizontal size={18} color={muted} strokeWidth={2} />
          <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
            {hasActiveFilter ? 'Filtros · activos' : 'Filtros'}
          </Text>
          <ChevronRight
            size={18}
            color={muted}
            strokeWidth={2}
            style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
          />
        </XStack>
      </Pressable>

      {open ? (
        <Card gap="$3">
          <YStack gap="$2">
            <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
              Rodeo
            </Text>
            {rodeoOptions.length > 0 ? (
              <Select
                value={rodeoId}
                options={rodeoOptions}
                placeholder="Todos los rodeos"
                placeholderOptionLabel="Todos los rodeos"
                open={rodeoPickerOpen}
                onToggle={onToggleRodeoPicker}
                onChange={onChangeRodeo}
                a11yLabel="Filtrar los pendientes por rodeo"
              />
            ) : (
              <Text fontFamily="$body" fontSize="$3" fontWeight="400" color="$textFaint">
                Este campo todavía no tiene rodeos para filtrar.
              </Text>
            )}
          </YStack>

          {/* Rango de fecha de NACIMIENTO (R9.3). Dos inputs mascados AAAA-MM-DD. Validación inline (desde >
              hasta → borde rojo en "hasta" + error pegado al campo, NO banner). */}
          <YStack gap="$2">
            <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
              Fecha de nacimiento
            </Text>
            <FormField
              label="Desde (AAAA-MM-DD)"
              value={fromText}
              onChangeText={(t) => {
                const masked = maskDateInput(t);
                setFromText(masked);
                applyDates(masked, toText);
              }}
              placeholder="Ej. 2025-01-01"
              keyboardType="number-pad"
            />
            <FormField
              label="Hasta (AAAA-MM-DD)"
              value={toText}
              onChangeText={(t) => {
                const masked = maskDateInput(t);
                setToText(masked);
                applyDates(fromText, masked);
              }}
              placeholder="Ej. 2025-12-31"
              keyboardType="number-pad"
              error={toError}
            />
          </YStack>

          {hasActiveFilter ? (
            <Pressable onPress={onClear} {...buttonA11y(Platform.OS, { label: 'Limpiar filtros' })}>
              <XStack alignItems="center" justifyContent="center" minHeight="$chipMin" pressStyle={{ opacity: 0.6 }}>
                <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary">
                  Limpiar filtros
                </Text>
              </XStack>
            </Pressable>
          ) : null}
        </Card>
      ) : null}
    </YStack>
  );
}

// ─── Tabs segmentadas ────────────────────────────────────────────────────────────────────────────────

function SegmentedTabs({
  tab,
  onTab,
  readyCount,
  incompleteCount,
  historyCount,
}: {
  tab: TabKey;
  onTab: (t: TabKey) => void;
  readyCount: number;
  incompleteCount: number;
  historyCount: number;
}) {
  return (
    <XStack
      width="100%"
      backgroundColor="$surface"
      borderRadius="$pill"
      borderWidth={1}
      borderColor="$divider"
      padding="$1"
      gap="$1"
    >
      <TabButton label={`Listos (${readyCount})`} active={tab === 'ready'} onPress={() => onTab('ready')} />
      <TabButton label={`A completar (${incompleteCount})`} active={tab === 'incomplete'} onPress={() => onTab('incomplete')} />
      <TabButton label={`Historial (${historyCount})`} active={tab === 'history'} onPress={() => onTab('history')} />
    </XStack>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={{ flex: 1 }} onPress={onPress} {...buttonA11y(Platform.OS, { label, selected: active })}>
      <View
        flex={1}
        minHeight="$chipMin"
        alignItems="center"
        justifyContent="center"
        borderRadius="$pill"
        paddingHorizontal="$2"
        backgroundColor={active ? '$primary' : 'transparent'}
        pressStyle={{ opacity: 0.8 }}
      >
        <Text
          fontFamily="$body"
          fontSize="$3"
          lineHeight="$3"
          fontWeight={active ? '700' : '500'}
          color={active ? '$white' : '$textMuted'}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Card contenedora de una lista (filas con dividers internos) ─────────────────────────────────────

function ListCard({ children }: { children: React.ReactNode }) {
  return (
    <YStack
      width="100%"
      backgroundColor="$white"
      borderRadius="$card"
      borderWidth={1}
      borderColor="$divider"
      overflow="hidden"
    >
      {children}
    </YStack>
  );
}

// ─── Empty de "Listos" (contextual según haya incompletos / historial, R9.5) ─────────────────────────

function ReadyEmpty({
  hasIncomplete,
  hasHistory,
  onSeeHistory,
  onSeeIncomplete,
}: {
  hasIncomplete: boolean;
  hasHistory: boolean;
  onSeeHistory: () => void;
  onSeeIncomplete: () => void;
}) {
  // Caso 1: hay incompletos pero ninguno listo → guía a completarlos.
  if (hasIncomplete) {
    return (
      <YStack gap="$3">
        <ReportEmpty
          title="Nada listo para declarar todavía"
          body="Hay animales con datos faltantes. Completalos para poder exportarlos."
        />
        <Button variant="secondary" fullWidth onPress={onSeeIncomplete}>
          Ver los que faltan completar
        </Button>
      </YStack>
    );
  }
  // Caso 2: no hay pendientes (todo declarado o sin animales con caravana) → empty positivo + historial (R9.5).
  return (
    <YStack gap="$3">
      <ReportEmpty
        title="Todo al día"
        body="No hay caravanas pendientes de declarar en este campo."
        tone="positive"
      />
      {hasHistory ? (
        <Button variant="secondary" fullWidth onPress={onSeeHistory}>
          Ver el historial de exportaciones
        </Button>
      ) : null}
    </YStack>
  );
}

// ─── Historial de exportaciones (R10.1 / R12.2) ──────────────────────────────────────────────────────

function HistoryList({
  history,
  isGenerating,
  onRedownload,
}: {
  history: ReturnType<typeof useExportSigsa>['history'];
  isGenerating: boolean;
  onRedownload: (exportLogId: string) => void;
}) {
  const primary = getTokenValue('$primary', 'color');
  const muted = getTokenValue('$textMuted', 'color');

  if (history.length === 0) {
    return (
      <ReportEmpty
        title="Sin exportaciones todavía"
        body="Cuando generes tu primer archivo SIGSA, va a aparecer acá para re-descargarlo."
      />
    );
  }

  return (
    <ListCard>
      {history.map((entry) => (
        <XStack
          key={entry.id}
          width="100%"
          minHeight="$touchMin"
          alignItems="center"
          gap="$3"
          paddingHorizontal="$4"
          paddingVertical="$2"
          backgroundColor="$white"
          borderBottomWidth={1}
          borderBottomColor="$divider"
        >
          <View
            width="$icon"
            height="$icon"
            borderRadius="$pill"
            backgroundColor="$surface"
            borderWidth={1}
            borderColor="$divider"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
          >
            <FileText size={20} color={muted} strokeWidth={2} />
          </View>
          <YStack flex={1} minWidth={0} gap="$1">
            <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textPrimary" numberOfLines={1}>
              {animalCountLabel(entry.animalCount)}
            </Text>
            <Text fontFamily="$body" fontSize="$2" lineHeight="$2" fontWeight="500" color="$textMuted" numberOfLines={1}>
              {exportLogDateLabel(entry.generatedAt)}
            </Text>
          </YStack>
          <Pressable
            disabled={isGenerating}
            hitSlop={8}
            onPress={() => onRedownload(entry.id)}
            {...buttonA11y(Platform.OS, { label: `Re-descargar la exportación del ${exportLogDateLabel(entry.generatedAt)}`, disabled: isGenerating })}
          >
            <XStack
              flexShrink={0}
              alignItems="center"
              gap="$1"
              minHeight="$chipMin"
              paddingHorizontal="$2"
              opacity={isGenerating ? 0.5 : 1}
              pressStyle={{ opacity: 0.6 }}
            >
              <Download size={18} color={primary} strokeWidth={2} />
              <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$primary">
                Re-descargar
              </Text>
            </XStack>
          </Pressable>
        </XStack>
      ))}
    </ListCard>
  );
}
