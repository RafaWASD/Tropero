// app/(tabs)/reportes.tsx — pantalla REPORTES (spec 07 Stream C — FRONTEND, R7.1). Reemplaza el stub.
//
// ONLINE-ONLY (R7.2): los KPIs/alertas se computan server-side (RPC) y se leen con conexión; offline → un
// estado claro "necesitás conexión" por sección (R7.2.2). Multi-tenant (R7.1.2/R7.1.3): scope por el
// establecimiento activo (EstablishmentContext) + el rodeo elegido; al cambiar de campo, el RodeoContext
// recarga el set de rodeos → los reportes se recomputan y nunca muestran datos del campo anterior.
//
// Estructura (design §6, 🟡 densidad mixta — oficina + campo, legible):
//   - Selector de RODEO (Select) + selector de CAMPAÑA (año, stepper; default = última campaña con datos,
//     R7.5.7; el wrap de fin de año lo resuelve el server por set-membership, R7.5.8).
//   - REPRODUCTIVO: %preñez + %parición (número grande + absolutos; base única servidas, sin toggle) +
//     distribución CCL (barras) + cruce con nacimientos. "configurá la estación" si el rodeo no tiene
//     service_months (R7.5.6/R7.6.6/R7.7.3).
//   - PESO por categoría (AVG + nº animales, es-AR; "sin pesar" para las sin peso).
//   - ALERTAS: dosis vencida + sin pesar (listas accionables + empty positivos).
//   - Acceso a "Resumen de sesión" (lista de sesiones del rodeo) y a "Comparar sesiones".
//
// Cero hardcode (ADR-023 §4): tokens + componentes. El % / formato es-AR vienen de reports-format.ts.

import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { ScrollView, Text, View, XStack, YStack, getTokenValue } from 'tamagui';
import { ChevronLeft, ChevronRight, CalendarRange, FileText, GitCompare } from 'lucide-react-native';

import { Button, Card, InfoNote, Select } from '@/components';
import {
  KpiCard,
  KpiRow,
  ReportSectionHeader,
  ReportDivider,
  CclBars,
  AlertList,
  ReportLoading,
  ReportOffline,
  ReportError,
  ReportEmpty,
  type AlertItem,
} from '@/components/reports';
import { useEstablishment, useRodeo } from '@/contexts';
import {
  useRodeoKpis,
  useEstablishmentAlerts,
  useRodeoSessions,
  reportView,
  type ReportPhase,
} from '@/hooks/use-reports';
import {
  safePercent,
  formatPercentAR,
  formatKgAR,
  cclBarsForMonths,
  calvingCardView,
  weaningCardView,
  defaultCampaignYear,
  animalLabel,
  daysSinceLabel,
  sessionDateLabel,
} from '@/utils/reports-format';
import { describeServicePeriod } from '@/utils/service-months';
import { buttonA11y } from '@/utils/a11y';

export default function ReportesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();
  const muted = getTokenValue('$textMuted', 'color');

  const establishmentId = estState.status === 'active' ? estState.current.id : null;
  const rodeos = rodeoState.status === 'active' ? rodeoState.available : [];
  const activeRodeoId = rodeoState.status === 'active' ? rodeoState.current.id : null;

  // Rodeo elegido PARA REPORTES (local — no cambia el rodeo activo global). Default = el activo.
  const [selectedRodeoId, setSelectedRodeoId] = useState<string | null>(null);
  const rodeoId = selectedRodeoId ?? activeRodeoId;
  const selectedRodeo = rodeos.find((r) => r.id === rodeoId) ?? null;

  const [rodeoPickerOpen, setRodeoPickerOpen] = useState(false);

  // Campaña (año) elegida. null = aún sin fijar → se deriva de las sesiones (default última con datos).
  const [pickedYear, setPickedYear] = useState<number | null>(null);

  // Lista de sesiones del rodeo (para el default de campaña + el acceso a "Resumen de sesión").
  const sessions = useRodeoSessions(rodeoId);
  const defaultYear = useMemo(() => {
    const isos = (sessions.data ?? []).map((s) => s.startedAt);
    return defaultCampaignYear(isos, new Date().getFullYear());
  }, [sessions.data]);
  const year = pickedYear ?? defaultYear;

  // Reportes del rodeo+campaña + alertas del establecimiento.
  const kpis = useRodeoKpis(rodeoId, year);
  const alerts = useEstablishmentAlerts(establishmentId);

  // Recargar al ENFOCAR (volver de la ficha / resumen) — refresh silencioso de las secciones.
  useFocusEffect(
    useCallback(() => {
      kpis.pregnancy.reload();
      kpis.calving.reload();
      kpis.weaning.reload();
      kpis.ccl.reload();
      kpis.calvingByStage.reload();
      kpis.weight.reload();
      alerts.overdue.reload();
      alerts.unweighed.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rodeoId, year, establishmentId]),
  );

  const goToAnimal = useCallback(
    (id: string) => router.push({ pathname: '/animal/[id]', params: { id } }),
    [router],
  );

  // ── Estados de pantalla completa (sin establecimiento / sin rodeos) ──
  if (estState.status !== 'active') {
    return (
      <Shell insets={insets}>
        <InfoNote>Elegí un campo para ver sus reportes.</InfoNote>
      </Shell>
    );
  }
  if (rodeoState.status === 'loading') {
    return (
      <Shell insets={insets}>
        <ReportLoading label="Cargando rodeos…" />
      </Shell>
    );
  }
  if (rodeos.length === 0) {
    return (
      <Shell insets={insets}>
        <ReportEmpty
          title="Todavía no hay rodeos"
          body="Creá un rodeo y cargá animales para ver tus reportes acá."
        />
      </Shell>
    );
  }

  const rodeoOptions = rodeos.map((r) => ({ value: r.id, label: r.name }));

  return (
    <Shell insets={insets}>
      {/* Selector de RODEO. */}
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
          Rodeo
        </Text>
        <Select
          value={rodeoId}
          options={rodeoOptions}
          placeholder="Elegí un rodeo"
          open={rodeoPickerOpen}
          onToggle={() => setRodeoPickerOpen((v) => !v)}
          onChange={(v) => {
            setSelectedRodeoId(v);
            setPickedYear(null); // al cambiar de rodeo, recalcular el default de campaña.
            setRodeoPickerOpen(false);
          }}
          a11yLabel="Elegir el rodeo a reportar"
        />
      </YStack>

      {/* Selector de CAMPAÑA (año). */}
      <YearStepper year={year} onChange={(y) => setPickedYear(y)} />

      {/* REPRODUCTIVO */}
      <ReportSectionHeader title="Reproductivo" hint={`Campaña ${year} · base servidas`} />
      <ReproSection
        rodeoId={rodeoId}
        year={year}
        serviceMonths={selectedRodeo?.serviceMonths ?? null}
        kpis={kpis}
        onConfigure={() =>
          selectedRodeo
            ? router.push({
                pathname: '/editar-servicio',
                params: { rodeoId: selectedRodeo.id, name: selectedRodeo.name },
              })
            : undefined
        }
      />

      {/* PESO por categoría */}
      <ReportSectionHeader title="Peso por categoría" />
      <WeightSection phase={kpis.weight} />

      {/* ALERTAS */}
      <ReportSectionHeader title="Alertas" hint="Todo el campo" />
      <OverdueSection phase={alerts.overdue} onAnimal={goToAnimal} />
      <UnweighedSection phase={alerts.unweighed} onAnimal={goToAnimal} />

      {/* SESIONES (resumen + comparativa) */}
      <ReportSectionHeader title="Sesiones" hint={selectedRodeo?.name} />
      <SessionsNav
        rodeoId={rodeoId}
        rodeoName={selectedRodeo?.name ?? ''}
        sessionCount={sessions.data?.length ?? 0}
        loading={sessions.loading && sessions.data === null}
        onResumen={() => {
          if (rodeoId) {
            router.push({
              pathname: '/reportes/sesiones',
              params: { rodeoId, name: selectedRodeo?.name ?? '' },
            });
          }
        }}
        onComparar={() => {
          if (rodeoId) {
            router.push({
              pathname: '/reportes/comparar',
              params: { rodeoId, name: selectedRodeo?.name ?? '' },
            });
          }
        }}
      />

      <View height={getTokenValue('$6', 'space')} />
    </Shell>
  );
}

// ─── Shell (header de tab + scroll) ──────────────────────────────────────────────────────────────────

function Shell({ insets, children }: { insets: { top: number; bottom: number }; children: React.ReactNode }) {
  return (
    <YStack flex={1} width="100%" maxWidth="100%" overflow="hidden" backgroundColor="$bg">
      <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
        <XStack width="100%" alignItems="center" paddingVertical="$3">
          <Text fontFamily="$body" fontSize="$8" lineHeight="$8" fontWeight="700" color="$textPrimary">
            Reportes
          </Text>
        </XStack>
      </YStack>
      <ScrollView
        flex={1}
        width="100%"
        maxWidth="100%"
        contentContainerStyle={{
          paddingHorizontal: getTokenValue('$4', 'space'),
          paddingBottom: insets.bottom + getTokenValue('$6', 'space'),
          width: '100%',
          maxWidth: '100%',
          gap: getTokenValue('$3', 'space'),
        }}
        showsHorizontalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </YStack>
  );
}

// ─── Selector de campaña (año) — stepper ← año → (R7.5.7) ────────────────────────────────────────────

function YearStepper({ year, onChange }: { year: number; onChange: (y: number) => void }) {
  const primary = getTokenValue('$primary', 'color');
  const nextYearCap = new Date().getFullYear() + 1; // no permitimos campañas futuras (cota server p_year).
  return (
    <XStack alignItems="center" justifyContent="space-between" gap="$2">
      <XStack alignItems="center" gap="$2">
        <CalendarRange size={18} color={getTokenValue('$textMuted', 'color')} strokeWidth={2} />
        <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
          Campaña
        </Text>
      </XStack>
      <XStack alignItems="center" gap="$3">
        <Pressable
          onPress={() => onChange(year - 1)}
          {...buttonA11y(Platform.OS, { label: 'Campaña anterior' })}
        >
          <View
            width={36}
            height={36}
            borderRadius="$pill"
            borderWidth={2}
            borderColor="$primary"
            alignItems="center"
            justifyContent="center"
            pressStyle={{ backgroundColor: '$surface' }}
          >
            <ChevronLeft size={20} color={primary} strokeWidth={2.5} />
          </View>
        </Pressable>
        <Text
          fontFamily="$body"
          fontSize="$6"
          lineHeight="$6"
          fontWeight="700"
          color="$textPrimary"
          minWidth={64}
          textAlign="center"
        >
          {year}
        </Text>
        <Pressable
          disabled={year >= nextYearCap}
          onPress={() => onChange(year + 1)}
          {...buttonA11y(Platform.OS, { label: 'Campaña siguiente', disabled: year >= nextYearCap })}
        >
          <View
            width={36}
            height={36}
            borderRadius="$pill"
            borderWidth={2}
            borderColor="$primary"
            opacity={year >= nextYearCap ? 0.4 : 1}
            alignItems="center"
            justifyContent="center"
            pressStyle={{ backgroundColor: '$surface' }}
          >
            <ChevronRight size={20} color={primary} strokeWidth={2.5} />
          </View>
        </Pressable>
      </XStack>
    </XStack>
  );
}

// ─── Sección REPRODUCTIVO (preñez + parición + CCL + cruce) ──────────────────────────────────────────

function ReproSection({
  rodeoId,
  year,
  serviceMonths,
  kpis,
  onConfigure,
}: {
  rodeoId: string | null;
  year: number;
  serviceMonths: number[] | null;
  kpis: ReturnType<typeof useRodeoKpis>;
  onConfigure: () => void;
}) {
  const { pregnancy, calving, weaning, ccl, calvingByStage } = kpis;

  // Estado del bloque: usamos %preñez como reporte "líder" (los 4 comparten guard/cota). Si está cargando
  // por primera vez / offline / error → un solo estado para todo el bloque (no 4 spinners).
  const pv = reportView(pregnancy);
  if (pv.showSpinner) return <ReportLoading label="Calculando los datos…" />;
  if (pv.showOffline) return <ReportOffline onRetry={() => reloadRepro(kpis)} />;
  if (pv.showError) return <ReportError message={pregnancy.error?.message} onRetry={() => reloadRepro(kpis)} />;

  const preg = pregnancy.data;
  const calv = calving.data;

  // Rodeo sin estación de servicio configurada → invita a configurarla (R7.5.6/R7.6.6/R7.7.3).
  if (preg && preg.isConfigured === false) {
    return (
      <Card gap="$3">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
          Configurá la estación de servicio
        </Text>
        <Text fontFamily="$body" fontSize="$3" color="$textMuted">
          Sin los meses de servicio de este rodeo no podemos calcular la campaña ni los datos reproductivos.
        </Text>
        <Button variant="primary" fullWidth onPress={onConfigure}>
          Configurar servicio
        </Button>
      </Card>
    );
  }

  const pregPct = preg ? safePercent(preg.pregnant, preg.serviced) : null;
  // La card de Parición NO arma el % a mano: deriva su presentación del `status` de la RPC (delta #8/RPF.6.2)
  // — fix del "0 %" engañoso (D2/D3/D5) + leyenda D4. `calv` es CalvingKpi | null.
  const cv = calvingCardView(calv);
  // La card de Destete deriva su presentación del `status` de la RPC (delta #10/RWK.7.2) — %destete (puede
  // >100% con mellizos), o el mensaje accionable fuera de estado 'ok', + leyenda D4. `weaning.data` es
  // WeaningKpi | null.
  const wv = weaningCardView(weaning.data);
  const noData = (preg?.serviced ?? 0) === 0;

  return (
    <YStack gap="$3">
      <KpiRow>
        <KpiCard
          label="Preñez"
          value={formatPercentAR(pregPct)}
          detail={
            preg ? `${preg.pregnant} preñadas / ${preg.serviced} servidas` : undefined
          }
          footnote={preg && preg.empty > 0 ? `${preg.empty} vacías` : undefined}
          muted={pregPct === null}
        />
        <KpiCard
          label="Parición"
          value={cv.value}
          detail={cv.detail ?? cv.note}
          muted={cv.muted}
        />
      </KpiRow>

      {/* Leyenda D4 (RPF.4.2): solo con status='ok' + preñadas sin parir → cartel de aviso informativo. */}
      {cv.legend ? <InfoNote>{cv.legend}</InfoNote> : null}

      {/* Card de DESTETE (delta #10/RWK.7.3, layout CD-3): segundo KpiRow a ancho completo debajo de Preñez |
          Parición → cierra el funnel del ciclo (servida → preñada → parida → DESTETADA). Full-width evita el
          recorte del número a 412px (el 3-across trunca "84,6 %" a $9). */}
      <KpiRow>
        <KpiCard
          label="Destete"
          value={wv.value}
          detail={wv.detail ?? wv.note}
          muted={wv.muted}
        />
      </KpiRow>

      {/* Leyenda D4 destete (RWK.4.1): solo con status='ok' + crías al pie sin destetar. */}
      {wv.legend ? <InfoNote>{wv.legend}</InfoNote> : null}

      {noData ? (
        <ReportEmpty
          title="Sin datos de esta campaña"
          body="Todavía no hay hembras servidas registradas para esta campaña en este rodeo."
        />
      ) : (
        <CclBlock
          serviceMonths={serviceMonths}
          ccl={ccl}
          calvingByStage={calvingByStage}
        />
      )}
    </YStack>
  );
}

function reloadRepro(kpis: ReturnType<typeof useRodeoKpis>) {
  kpis.pregnancy.reload();
  kpis.calving.reload();
  kpis.weaning.reload();
  kpis.ccl.reload();
  kpis.calvingByStage.reload();
}

// ─── Bloque CCL (barras del tacto + cruce con nacimientos) ───────────────────────────────────────────

function CclBlock({
  serviceMonths,
  ccl,
  calvingByStage,
}: {
  serviceMonths: number[] | null;
  ccl: ReportPhase<import('@/services/reports').CclDistribution | null>;
  calvingByStage: ReportPhase<import('@/services/reports').CalvingByStage | null>;
}) {
  const data = ccl.data;
  const nMonths = data?.nMonths ?? (serviceMonths ? serviceMonths.length : null);

  // El nº de barras lo decide la FUENTE ÚNICA (cclBarsForMonths → sizeBucketsForServiceMonths).
  const bars = data ? cclBarsForMonths(nMonths, data) : [];

  // Rodeo que no distingue etapas (1/12/sin config) → ocultamos CCL con una nota (R7.7.3).
  if (data && bars.length === 0) {
    const period = describeServicePeriod(serviceMonths);
    return (
      <Card gap="$2">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
          Distribución de preñez
        </Text>
        <Text fontFamily="$body" fontSize="$3" color="$textMuted">
          Este rodeo no distingue etapas de preñez ({period.text.toLowerCase()}), así que la distribución
          cabeza/cuerpo/cola no aplica.
        </Text>
      </Card>
    );
  }

  // Sin preñeces con tamaño en la campaña → empty (R7.7.4).
  if (data && data.total === 0) {
    return (
      <ReportEmpty
        title="Sin tactos con tamaño"
        body="Todavía no hay tactos con tamaño de preñez (cabeza/cuerpo/cola) en esta campaña."
      />
    );
  }

  if (!data) return null;

  // Cruce con nacimientos (R7.8): barras de la distribución real, si el rodeo distingue etapas.
  const stage = calvingByStage.data;
  const bornBars =
    stage !== null
      ? cclBarsForMonths(stage.nMonths, {
          head: stage.headBorn,
          body: stage.bodyBorn,
          tail: stage.tailBorn,
          total: stage.totalBorn,
        })
      : undefined;

  return (
    <Card gap="$3">
      <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
        Distribución de preñez
      </Text>
      <CclBars
        bars={bars}
        total={data.total}
        bornBars={bornBars}
        bornTotal={stage?.totalBorn}
      />
    </Card>
  );
}

// ─── Sección PESO por categoría (R7.9) ───────────────────────────────────────────────────────────────

function WeightSection({ phase }: { phase: ReturnType<typeof useRodeoKpis>['weight'] }) {
  const v = reportView(phase);
  if (v.showSpinner) return <ReportLoading label="Cargando pesos…" />;
  if (v.showOffline) return <ReportOffline onRetry={phase.reload} />;
  if (v.showError) return <ReportError message={phase.error?.message} onRetry={phase.reload} />;

  const rows = phase.data ?? [];
  if (rows.length === 0) {
    return (
      <ReportEmpty
        title="Sin pesajes"
        body="Todavía no hay animales pesados en este rodeo. Cargá un pesaje para ver el promedio por categoría."
      />
    );
  }

  return (
    <Card gap="$3">
      {rows.map((r, i) => (
        <YStack key={r.categoryId} gap="$3">
          {i > 0 ? <ReportDivider /> : null}
          <XStack alignItems="center" justifyContent="space-between" gap="$3">
            <YStack flex={1} minWidth={0}>
              <Text
                numberOfLines={1}
                fontFamily="$body"
                fontSize="$4"
                fontWeight="600"
                color="$textPrimary"
              >
                {r.categoryName}
              </Text>
              <Text fontFamily="$body" fontSize="$2" color="$textMuted">
                {r.nAnimals === 1 ? '1 animal' : `${r.nAnimals} animales`}
              </Text>
            </YStack>
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
              {formatKgAR(r.avgWeight)}
            </Text>
          </XStack>
        </YStack>
      ))}
    </Card>
  );
}

// ─── Alertas ─────────────────────────────────────────────────────────────────────────────────────────

function OverdueSection({
  phase,
  onAnimal,
}: {
  phase: ReturnType<typeof useEstablishmentAlerts>['overdue'];
  onAnimal: (id: string) => void;
}) {
  const v = reportView(phase);
  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
        Dosis vencidas
      </Text>
      {v.showSpinner ? (
        <ReportLoading />
      ) : v.showOffline ? (
        <ReportOffline onRetry={phase.reload} />
      ) : v.showError ? (
        <ReportError message={phase.error?.message} onRetry={phase.reload} />
      ) : (phase.data ?? []).length === 0 ? (
        <ReportEmpty title="No hay dosis vencidas" tone="positive" />
      ) : (
        <AlertList
          icon="dose"
          items={(phase.data ?? []).map<AlertItem>((d) => ({
            key: `${d.animalProfileId}:${d.productName}`,
            animal: animalLabel(d.idv, d.visualIdAlt),
            primary: d.productName,
            secondary: `venció el ${sessionDateLabel(d.nextDoseDate)}`,
            onPress: () => onAnimal(d.animalProfileId),
          }))}
        />
      )}
    </YStack>
  );
}

function UnweighedSection({
  phase,
  onAnimal,
}: {
  phase: ReturnType<typeof useEstablishmentAlerts>['unweighed'];
  onAnimal: (id: string) => void;
}) {
  const v = reportView(phase);
  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
        Animales sin pesar
      </Text>
      {v.showSpinner ? (
        <ReportLoading />
      ) : v.showOffline ? (
        <ReportOffline onRetry={phase.reload} />
      ) : v.showError ? (
        <ReportError message={phase.error?.message} onRetry={phase.reload} />
      ) : (phase.data ?? []).length === 0 ? (
        <ReportEmpty title="Todos al día" body="No hay animales pendientes de pesaje." tone="positive" />
      ) : (
        <AlertList
          icon="weight"
          items={(phase.data ?? []).map<AlertItem>((a) => ({
            key: a.animalProfileId,
            animal: animalLabel(a.idv, a.visualIdAlt),
            primary: a.categoryName,
            secondary: daysSinceLabel(a.daysSince),
            onPress: () => onAnimal(a.animalProfileId),
          }))}
        />
      )}
    </YStack>
  );
}

// ─── Navegación a resumen / comparativa de sesión ────────────────────────────────────────────────────

function SessionsNav({
  rodeoId,
  rodeoName,
  sessionCount,
  loading,
  onResumen,
  onComparar,
}: {
  rodeoId: string | null;
  rodeoName: string;
  sessionCount: number;
  loading: boolean;
  onResumen: () => void;
  onComparar: () => void;
}) {
  const muted = getTokenValue('$textMuted', 'color');
  const primary = getTokenValue('$primary', 'color');
  const disabled = !rodeoId || sessionCount === 0;

  return (
    <Card gap="$1">
      <NavRow
        icon={<FileText size={20} color={primary} strokeWidth={2} />}
        label="Resumen de sesión"
        hint={loading ? 'Cargando…' : `${sessionCount} sesiones`}
        muted={muted}
        disabled={disabled}
        onPress={onResumen}
      />
      <ReportDivider />
      <NavRow
        icon={<GitCompare size={20} color={primary} strokeWidth={2} />}
        label="Comparar sesiones"
        hint={rodeoName}
        muted={muted}
        disabled={disabled || sessionCount < 2}
        onPress={onComparar}
      />
    </Card>
  );
}

function NavRow({
  icon,
  label,
  hint,
  muted,
  disabled,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  muted: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      {...buttonA11y(Platform.OS, { label, disabled })}
    >
      <XStack alignItems="center" gap="$3" minHeight="$chipMin" opacity={disabled ? 0.4 : 1} pressStyle={{ opacity: 0.6 }}>
        {icon}
        <YStack flex={1} minWidth={0}>
          <Text numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
            {label}
          </Text>
          {hint ? (
            <Text numberOfLines={1} fontFamily="$body" fontSize="$2" color="$textMuted">
              {hint}
            </Text>
          ) : null}
        </YStack>
        <ChevronRight size={20} color={muted} strokeWidth={2} />
      </XStack>
    </Pressable>
  );
}
