// app/reportes-spike.tsx — DESIGN SPIKE (spec 07 Stream C — FRONTEND): pantalla REPORTES con datos MOCK.
//
// ⚠️ SPIKE VISUAL, 100% MOCK. NO hay servicios, RPC, sesión ni persistencia: los datos son fixtures locales.
// El objetivo es el VETO del leader (design-review) ANTES de mostrar a Raf — la pantalla REAL
// (`(tabs)/reportes.tsx`) consume las 9 RPC ya gateadas contra el remoto, que necesitaría seed+login para
// capturar. Este spike usa los MISMOS componentes reutilizables (`KpiCard`/`CclBars`/`AlertList`/
// `ReportStates`) que la pantalla real → lo que se vetea acá ES lo que se ve en producción.
//
// Paridad con los otros spikes (tacto/rueda-ce/service-months): alcanzable directo en web sin auth
// (DEV_WEB_ROUTES) para la captura e2e a 360/412 en web táctil. Una VARIANTE por `?variant=`:
//   - 'kpis'    → KPIs del rodeo poblados (preñez/parición + CCL + cruce con nacimientos + peso).
//   - 'sesion'  → resumen de una sesión (conteo por tipo de evento + marco temporal).
//   - 'alertas' → las 2 alertas (dosis vencida + sin pesar) con ítems.
//   - 'vacio'   → estado vacío (rodeo sin datos aún) + alertas resueltas (empty positivo).
//   - 'offline' → estado online-only sin conexión.
//   - 'config'  → rodeo sin estación de servicio configurada (invita a configurar).
//   - 'comparar'→ comparativa de 2 sesiones (delta por tipo de evento + peso por categoría).
//
// Cero hardcode (ADR-023 §4): tokens + componentes. Light-only (MVP). Voseo argentino.

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, XStack, YStack, getTokenValue } from 'tamagui';

import { Button, Card, InfoNote } from '@/components';
import {
  KpiCard,
  KpiRow,
  ReportSectionHeader,
  ReportDivider,
  CclBars,
  AlertList,
  ReportOffline,
  ReportEmpty,
  type AlertItem,
} from '@/components/reports';
import {
  safePercent,
  formatPercentAR,
  formatKgAR,
  formatKgDeltaAR,
  formatCountDelta,
  cclBarsForMonths,
  calvingCardView,
  eventKindLabel,
  compareSessions,
  compareWeights,
  type CalvingStatus,
} from '@/utils/reports-format';

type SpikeVariant =
  | 'kpis'
  | 'sesion'
  | 'alertas'
  | 'vacio'
  | 'offline'
  | 'config'
  | 'comparar'
  // delta #8/RPF.7 — los 5 estados de la card de Parición (mock, para el capture del Gate 2.5).
  | 'paricion-ok'
  | 'paricion-leyenda'
  | 'paricion-fuera-ventana'
  | 'paricion-sin-meses'
  | 'paricion-12m';

export default function ReportesSpikeScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ variant?: string }>();
  const variant = (typeof params.variant === 'string' ? params.variant : 'kpis') as SpikeVariant;

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
        <MockRodeoSelector />
        {variant === 'kpis' ? <KpisVariant /> : null}
        {variant === 'sesion' ? <SesionVariant /> : null}
        {variant === 'alertas' ? <AlertasVariant /> : null}
        {variant === 'vacio' ? <VacioVariant /> : null}
        {variant === 'offline' ? <OfflineVariant /> : null}
        {variant === 'config' ? <ConfigVariant /> : null}
        {variant === 'comparar' ? <CompararVariant /> : null}
        {variant === 'paricion-ok' ? (
          <ParicionVariant status="ok" calved={38} serviced={46} pendingPregnant={0} />
        ) : null}
        {variant === 'paricion-leyenda' ? (
          <ParicionVariant status="ok" calved={30} serviced={46} pendingPregnant={8} />
        ) : null}
        {variant === 'paricion-fuera-ventana' ? (
          <ParicionVariant status="not_calving_season" calved={0} serviced={46} pendingPregnant={0} />
        ) : null}
        {variant === 'paricion-sin-meses' ? (
          <ParicionVariant status="no_service_months" calved={0} serviced={0} pendingPregnant={0} />
        ) : null}
        {variant === 'paricion-12m' ? (
          <ParicionVariant status="not_applicable_12m" calved={0} serviced={46} pendingPregnant={0} />
        ) : null}
      </ScrollView>
    </YStack>
  );
}

// ─── Selector mock (sólo el chrome — no funcional en el spike) ───────────────────────────────────────

function MockRodeoSelector() {
  return (
    <YStack gap="$3">
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
          Rodeo
        </Text>
        <XStack
          width="100%"
          alignItems="center"
          minHeight="$chipMin"
          paddingHorizontal="$3"
          paddingVertical="$2"
          borderRadius="$pill"
          backgroundColor="$greenLight"
          borderWidth={1}
          borderColor="$greenLight"
        >
          <Text flex={1} fontFamily="$body" fontSize="$4" fontWeight="600" color="$primary">
            Vacas de cría
          </Text>
        </XStack>
      </YStack>
      <XStack alignItems="center" justifyContent="space-between">
        <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
          Campaña
        </Text>
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
          {String(new Date().getFullYear() - 1)}
        </Text>
      </XStack>
    </YStack>
  );
}

// ─── Variante KPIs ───────────────────────────────────────────────────────────────────────────────────

function KpisVariant() {
  // Rodeo de 3 meses de servicio. 41 preñadas / 46 servidas; 38 paridas.
  const serviced = 46;
  const pregnant = 41;
  const calved = 38;
  const empty = 5;
  const ccl = { head: 18, body: 14, tail: 9, total: 41 };
  const born = { head: 16, body: 13, tail: 9, total: 38 };
  const bars = cclBarsForMonths(3, ccl);
  const bornBars = cclBarsForMonths(3, born);

  const weights = [
    { id: 'c1', name: 'Vacas', avg: 432.5, n: 28 },
    { id: 'c2', name: 'Vaquillonas', avg: 318, n: 12 },
    { id: 'c3', name: 'Terneros', avg: 182.4, n: 9 },
  ];

  return (
    <>
      <ReportSectionHeader title="Reproductivo" hint={`Campaña ${new Date().getFullYear() - 1} · base servidas`} />
      <KpiRow>
        <KpiCard
          label="Preñez"
          value={formatPercentAR(safePercent(pregnant, serviced))}
          detail={`${pregnant} preñadas / ${serviced} servidas`}
          footnote={`${empty} vacías`}
        />
        <KpiCard
          label="Parición"
          value={formatPercentAR(safePercent(calved, serviced))}
          detail={`${calved} paridas / ${serviced} servidas`}
        />
      </KpiRow>
      <Card gap="$3">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
          Distribución de preñez
        </Text>
        <CclBars bars={bars} total={ccl.total} bornBars={bornBars} bornTotal={born.total} />
      </Card>

      <ReportSectionHeader title="Peso por categoría" />
      <Card gap="$3">
        {weights.map((w, i) => (
          <YStack key={w.id} gap="$3">
            {i > 0 ? <ReportDivider /> : null}
            <XStack alignItems="center" justifyContent="space-between" gap="$3">
              <YStack flex={1} minWidth={0}>
                <Text numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
                  {w.name}
                </Text>
                <Text fontFamily="$body" fontSize="$2" color="$textMuted">
                  {w.n === 1 ? '1 animal' : `${w.n} animales`}
                </Text>
              </YStack>
              <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary">
                {formatKgAR(w.avg)}
              </Text>
            </XStack>
          </YStack>
        ))}
      </Card>
    </>
  );
}

// ─── Variante resumen de sesión ──────────────────────────────────────────────────────────────────────

function SesionVariant() {
  const rows = [
    { kind: 'weight', eventCount: 42, animals: 42 },
    { kind: 'sanitary', eventCount: 38, animals: 38 },
    { kind: 'reproductive', eventCount: 41, animals: 41 },
    { kind: 'condition', eventCount: 12, animals: 12 },
  ];
  const total = rows.reduce((a, r) => a + r.eventCount, 0);
  return (
    <>
      <ReportSectionHeader title="Jornada" hint="Vacas de cría" />
      <Card gap="$2">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
          12 de marzo de 2025
        </Text>
        <Text fontFamily="$body" fontSize="$3" color="$textMuted">
          46 animales intervenidos
        </Text>
      </Card>
      <Card gap="$3">
        <Text fontFamily="$body" fontSize="$3" fontWeight="600" color="$textMuted">
          {total} eventos
        </Text>
        {rows.map((r, i) => (
          <YStack key={r.kind} gap="$3">
            {i > 0 ? <ReportDivider /> : null}
            <XStack alignItems="center" justifyContent="space-between" gap="$3">
              <YStack flex={1} minWidth={0}>
                <Text numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
                  {eventKindLabel(r.kind)}
                </Text>
                <Text fontFamily="$body" fontSize="$2" color="$textMuted">
                  {r.animals} animales
                </Text>
              </YStack>
              <Text fontFamily="$body" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary">
                {r.eventCount}
              </Text>
            </XStack>
          </YStack>
        ))}
      </Card>
    </>
  );
}

// ─── Variante alertas (con ítems) ────────────────────────────────────────────────────────────────────

function AlertasVariant() {
  const overdue: AlertItem[] = [
    { key: 'o1', animal: 'ARG 0421', primary: 'Aftosa', secondary: 'venció el 2 de mar 2026' },
    { key: 'o2', animal: 'ARG 0588', primary: 'Mancha y gangrena', secondary: 'venció el 18 de feb 2026' },
    { key: 'o3', animal: 'V-1207', primary: 'Aftosa', secondary: 'venció el 10 de feb 2026' },
  ];
  const unweighed: AlertItem[] = [
    { key: 'u1', animal: 'ARG 0734', primary: 'Vaquillona', secondary: 'hace 210 días' },
    { key: 'u2', animal: 'ARG 0810', primary: 'Ternero', secondary: 'Nunca pesado' },
  ];
  return (
    <>
      <ReportSectionHeader title="Alertas" hint="Todo el campo" />
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
          Dosis vencidas
        </Text>
        <AlertList icon="dose" items={overdue} />
      </YStack>
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
          Animales sin pesar
        </Text>
        <AlertList icon="weight" items={unweighed} />
      </YStack>
    </>
  );
}

// ─── Variante vacío ──────────────────────────────────────────────────────────────────────────────────

function VacioVariant() {
  return (
    <>
      <ReportSectionHeader title="Reproductivo" hint={`Campaña ${new Date().getFullYear() - 1} · base servidas`} />
      <ReportEmpty
        title="Sin datos de esta campaña"
        body="Todavía no hay hembras servidas registradas para esta campaña en este rodeo."
      />
      <ReportSectionHeader title="Peso por categoría" />
      <ReportEmpty
        title="Sin pesajes"
        body="Todavía no hay animales pesados en este rodeo. Cargá un pesaje para ver el promedio por categoría."
      />
      <ReportSectionHeader title="Alertas" hint="Todo el campo" />
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
          Dosis vencidas
        </Text>
        <ReportEmpty title="No hay dosis vencidas" tone="positive" />
      </YStack>
      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
          Animales sin pesar
        </Text>
        <ReportEmpty title="Todos al día" body="No hay animales pendientes de pesaje." tone="positive" />
      </YStack>
    </>
  );
}

// ─── Variante offline ────────────────────────────────────────────────────────────────────────────────

function OfflineVariant() {
  return (
    <>
      <ReportSectionHeader title="Reproductivo" hint={`Campaña ${new Date().getFullYear() - 1} · base servidas`} />
      <ReportOffline onRetry={() => {}} />
    </>
  );
}

// ─── Variante configurar servicio ────────────────────────────────────────────────────────────────────

function ConfigVariant() {
  return (
    <>
      <ReportSectionHeader title="Reproductivo" hint="Campaña 2025 · base servidas" />
      <Card gap="$3">
        <Text fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
          Configurá la estación de servicio
        </Text>
        <Text fontFamily="$body" fontSize="$3" color="$textMuted">
          Sin los meses de servicio de este rodeo no podemos calcular la campaña ni los KPIs reproductivos.
        </Text>
        <Button variant="primary" fullWidth onPress={() => {}}>
          Configurar servicio
        </Button>
      </Card>
    </>
  );
}

// ─── Variante comparar (delta por tipo de evento + peso por categoría) ───────────────────────────────
// Espeja el layout de las tablas de comparar.tsx (EventsCompare/WeightCompare) con datos mock + los mismos
// helpers (compareSessions/compareWeights + deltas con signo y color). Es para que el leader vete los delta
// pills (verde sube / terracota baja) sin necesitar 2 sesiones reales.

function CompararVariant() {
  const eventRows = compareSessions(
    [
      { kind: 'weight', eventCount: 40 },
      { kind: 'sanitary', eventCount: 38 },
      { kind: 'condition', eventCount: 15 },
    ],
    [
      { kind: 'weight', eventCount: 46 },
      { kind: 'reproductive', eventCount: 44 },
    ],
  );
  const weightRows = compareWeights(
    [
      { categoryId: 'c1', categoryName: 'Vacas', avgWeight: 410 },
      { categoryId: 'c2', categoryName: 'Vaquillonas', avgWeight: 305 },
    ],
    [
      { categoryId: 'c1', categoryName: 'Vacas', avgWeight: 432.5 },
      { categoryId: 'c3', categoryName: 'Terneros', avgWeight: 182.4 },
    ],
  );

  return (
    <>
      <ReportSectionHeader title="Comparar" hint="Vacas de cría" />
      {/* Cabecera A vs B */}
      <XStack gap="$2">
        {['12 de mar 2025', '24 de jun 2025'].map((d, i) => (
          <YStack
            key={d}
            flex={1}
            minWidth={0}
            backgroundColor="$surface"
            borderRadius="$card"
            borderWidth={1}
            borderColor="$divider"
            paddingHorizontal="$3"
            paddingVertical="$2"
          >
            <Text fontFamily="$body" fontSize="$2" fontWeight="600" color="$textMuted">
              {i === 0 ? 'A' : 'B'}
            </Text>
            <Text numberOfLines={2} fontFamily="$body" fontSize="$3" fontWeight="600" color="$textPrimary">
              {d}
            </Text>
          </YStack>
        ))}
      </XStack>

      <Card gap="$3">
        <Text fontFamily="$body" fontSize="$4" fontWeight="700" color="$textPrimary">
          Eventos por tipo
        </Text>
        {eventRows.map((r, i) => (
          <YStack key={r.kind} gap="$3">
            {i > 0 ? <ReportDivider /> : null}
            <XStack alignItems="center" gap="$2">
              <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
                {r.label}
              </Text>
              <Text width={44} textAlign="right" fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
                {r.a}
              </Text>
              <Text width={44} textAlign="right" fontFamily="$body" fontSize="$4" fontWeight="600" color="$textPrimary">
                {r.b}
              </Text>
              <Text
                width={56}
                textAlign="right"
                fontFamily="$body"
                fontSize="$3"
                fontWeight="700"
                color={r.delta === 0 ? '$textMuted' : r.delta > 0 ? '$primary' : '$terracota'}
              >
                {formatCountDelta(r.delta)}
              </Text>
            </XStack>
          </YStack>
        ))}
      </Card>

      <Card gap="$3">
        <Text fontFamily="$body" fontSize="$4" fontWeight="700" color="$textPrimary">
          Peso por categoría
        </Text>
        {weightRows.map((r, i) => (
          <YStack key={r.categoryId} gap="$3">
            {i > 0 ? <ReportDivider /> : null}
            <XStack alignItems="center" gap="$2">
              <Text flex={1} minWidth={0} numberOfLines={1} fontFamily="$body" fontSize="$4" fontWeight="500" color="$textPrimary">
                {r.categoryName}
              </Text>
              <Text width={64} textAlign="right" numberOfLines={1} fontFamily="$body" fontSize="$3" fontWeight="600" color="$textPrimary">
                {formatKgAR(r.a)}
              </Text>
              <Text width={64} textAlign="right" numberOfLines={1} fontFamily="$body" fontSize="$3" fontWeight="600" color="$textPrimary">
                {formatKgAR(r.b)}
              </Text>
              <Text
                width={64}
                textAlign="right"
                fontFamily="$body"
                fontSize="$3"
                fontWeight="700"
                color={r.delta === null || r.delta === 0 ? '$textMuted' : r.delta > 0 ? '$primary' : '$terracota'}
              >
                {formatKgDeltaAR(r.delta)}
              </Text>
            </XStack>
          </YStack>
        ))}
      </Card>
    </>
  );
}

// ─── Variantes de PARICIÓN (delta #8/RPF.7) — los 5 estados de la card de Parición ───────────────────
// MOCK que reusa los MISMOS componentes que producción (calvingCardView + KpiCard + InfoNote) para que el
// leader vete lo REAL en el Gate 2.5: el % (ok), "todavía no es época de parición" (fuera de ventana, D2),
// "sin meses de servicio configurados" (D3), "no aplica (servicio todo el año)" (D5), y la leyenda D4.
// La card va en fila de DOS (Preñez | Parición) como en la tab real → se vetea el layout verdadero.

function ParicionVariant({
  status,
  calved,
  serviced,
  pendingPregnant,
}: {
  status: CalvingStatus;
  calved: number;
  serviced: number;
  pendingPregnant: number;
}) {
  const cv = calvingCardView({ status, calved, serviced, pendingPregnant });
  const pregnant = 41;
  const pregServiced = 46;
  return (
    <>
      <ReportSectionHeader title="Reproductivo" hint={`Campaña ${new Date().getFullYear()} · base servidas`} />
      <KpiRow>
        <KpiCard
          label="Preñez"
          value={formatPercentAR(safePercent(pregnant, pregServiced))}
          detail={`${pregnant} preñadas / ${pregServiced} servidas`}
        />
        <KpiCard label="Parición" value={cv.value} detail={cv.detail ?? cv.note} muted={cv.muted} />
      </KpiRow>
      {cv.legend ? <InfoNote>{cv.legend}</InfoNote> : null}
    </>
  );
}
