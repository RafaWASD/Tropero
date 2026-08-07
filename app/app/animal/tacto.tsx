// app/animal/tacto.tsx — TACTO REPRODUCTIVO desde la ficha, animal por animal (delta spec 02
// `ficha-categoria-tacto`, RTF.4 / RTF.5 / RTF.6).
//
// POR QUÉ EXISTE (palabras de Raf): para no obligar a armar una maniobra entera por UN animal. Es la
// contraparte "de a uno" del paso de tacto de la manga, con el MISMO criterio de gating (lo resuelve
// `resolveFichaTactoOffer`) y los MISMOS componentes de captura.
//
// ── POR QUÉ UNA RUTA FULL-SCREEN Y NO UN BOTTOM SHEET (design §3.2) ─────────────────────────────────
// `TactoStep` / `TactoVaquillonaStep` son bloques `flex: 1` calibrados para REPARTIRSE el alto del viewport
// (densidad ≥ 60%, lenguaje de manga aprobado en el spike M2.0). Dentro de un sheet con `maxHeight: 85%`,
// header y footer fijos, quedarían botones chicos — exactamente lo que la manga no tolera. Y rediseñarlos en
// versión "chica" crearía una segunda variante del mismo control (drift entre la manga y la ficha).
// Precedente en la misma ficha: `app/animal/baja.tsx`.
//
// ── LO QUE ESTA PANTALLA NO HACE ────────────────────────────────────────────────────────────────────
// NO crea, abre ni cierra ninguna `sessions` (RTF.5.3 / C2.3: el evento va SUELTO, sin jornada). El write es
// el servicio que YA existe (`addTacto` / `addTactoVaquillona`): un INSERT local plano en
// `reproductive_events` con `session_id` NULL, que viaja por el MISMO camino server-side que el de la manga
// (misma policy de INSERT, mismo trigger de gating `0054`, mismos triggers de `created_by`/`establishment_id`
// de `0077`). Cero RPC, cero Edge, cero migración. Y **sí entra en los reportes**: ninguna función de reporte
// reproductivo mira `session_id` (verificado con tests en `supabase/tests/reports/run.cjs`).
//
// ── FECHA (RTF.6, P3 resuelto por Raf en la Puerta 1) ───────────────────────────────────────────────
// Por default el tacto se fecha HOY (`todayIsoLocal()`, la FUENTE ÚNICA del día calendario local: sin eso, a
// partir de las 21:00 en Argentina el evento entraría fechado MAÑANA en una columna `date`). Sin campo de
// fecha a la vista: manga = una mano, guante, cero teclado. Y detrás de un link secundario **"Fue otro día"**
// se despliega el campo, para no perder la capacidad de cargar un tacto atrasado que hoy sí existe en la
// card "Tacto" de "Agregar evento" (que este mismo delta retira, RTF.9).
//
// OFFLINE (RTF.10.2): todo el flujo —ofrecer, capturar, persistir, volver, ver el estado nuevo— es SQLite
// local. Multi-tenant (RTF.10.3): todo sale del PERFIL (`detail.*`), nunca del establishment activo.
//
// Cero hardcode (ADR-023 §4): tokens; lo que cruza a lucide, vía `getTokenValue`. a11y por los helpers.
// `lineHeight` matcheado en todo `Text`. es-AR voseo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { getTokenValue, Spinner, Text, View, XStack, YStack } from 'tamagui';
import { CalendarDays, ChevronLeft } from 'lucide-react-native';

import { CategoryBadge, FormError, FormField, InfoNote } from '@/components';
import { KeyboardAvoidingShell } from '@/components/KeyboardAvoidingShell';
import { useKeyboardAwareBottomInset } from '@/hooks/useSafeBottomInset';
import { useBusyWhileMounted } from '@/services/ble/stick';
import { fetchAnimalDetail, type AnimalDetail } from '@/services/animals';
import { addTacto, addTactoVaquillona } from '@/services/events';
import { fetchRodeoGating } from '@/services/rodeo-config';
import { fetchRodeoServiceMonths } from '@/services/rodeos';
import { effectiveSizeBuckets, type SizeBucket } from '@/utils/pregnancy-buckets';
import { fichaTactoCtaLabel, resolveFichaTactoOffer, type FichaTactoKind } from '@/utils/ficha-tacto-offer';
import type { RodeoDataKeyMap } from '@/utils/maneuver-gating';
import type { HeiferFitness, PregnancyStatus } from '@/utils/maneuver-sequence';
import { pickHeroIdentifier } from '@/utils/animal-identifier';
import { maskDateInput } from '@/utils/animal-input';
import { validateEventDate } from '@/utils/event-input';
import { buttonA11y } from '@/utils/a11y';
import { backOr } from '@/utils/nav';
import { todayIsoLocal } from '@/utils/today-iso';

// Estilo del `KeyboardAvoidingShell` (API no-Tamagui). `flex` no es spacing/color → no aplica el lint
// anti-hardcode (ADR-023 §4).
const fillStyle = { flex: 1 } as const;

import { TactoStep } from '../maniobra/_components/TactoStep';
import { TactoVaquillonaStep } from '../maniobra/_components/TactoVaquillonaStep';

/** Estado de la resolución inicial: hasta que no cierra, no se muestra ningún paso. */
type Resolution =
  | { kind: 'loading' }
  | { kind: 'ready'; detail: AnimalDetail; offer: FichaTactoKind; buckets: SizeBucket[] }
  | { kind: 'unavailable'; message: string };

export default function TactoFichaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Reserva inferior canónica del repo (hook compartido: inset del sistema + piso de web + aire de Android),
  // que ENCOGE con el teclado abierto (el campo de "Fue otro día" lo levanta).
  const bottomPad = useKeyboardAwareBottomInset();

  // Anti-stacking del bastón (RTF.4.6 / RB2.2): mientras esta pantalla está montada, un bastonazo NO abre el
  // overlay find-or-create encima del tacto.
  useBusyWhileMounted();

  const params = useLocalSearchParams<{ profileId?: string; kind?: string }>();
  const profileId = typeof params.profileId === 'string' ? params.profileId : null;

  const [resolution, setResolution] = useState<Resolution>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  // Fecha del evento: HOY por default (RTF.6.1). `dateOpen` = el operario desplegó "Fue otro día" (P3).
  const [dateOpen, setDateOpen] = useState(false);
  const [eventDate, setEventDate] = useState(todayIsoLocal());
  const [dateErr, setDateErr] = useState<string | null>(null);
  // Re-entrancy guard (RTF.4.7): se toma ANTES de cualquier await → un doble-tap no escribe dos eventos.
  const busyRef = useRef(false);
  const [saving, setSaving] = useState(false);

  /** Destino de "Volver" ROBUSTO (RTF.4.5): la ficha del animal; sin params, la lista. */
  const backFallback: Href = useMemo(
    () => (profileId ? { pathname: '/animal/[id]', params: { id: profileId } } : '/(tabs)/animales'),
    [profileId],
  );
  const goBack = useCallback(() => backOr(router, backFallback), [router, backFallback]);

  // ── RE-VALIDACIÓN AL MONTAR (RTF.4.4): la pantalla NO confía en el param `kind`. ────────────────
  // Re-lee el perfil + el gating del rodeo y vuelve a resolver el ofrecimiento con los MISMOS predicados. Si
  // ya no aplica (dato cambiado entre el tap y el montaje, deep-link, cold-start), muestra un estado
  // explicativo + salida, SIN escribir nada. Es también la barrera contra un deep-link con `kind` inventado.
  useEffect(() => {
    if (!profileId) {
      setResolution({ kind: 'unavailable', message: 'No pudimos cargar el animal. Volvé a la ficha y probá de nuevo.' });
      return;
    }
    let active = true;
    setResolution({ kind: 'loading' });
    void (async () => {
      const detailR = await fetchAnimalDetail(profileId);
      if (!active) return;
      if (!detailR.ok) {
        setResolution({
          kind: 'unavailable',
          message:
            detailR.error.kind === 'network'
              ? 'Sin conexión: no pudimos cargar el animal.'
              : detailR.error.message,
        });
        return;
      }
      const detail = detailR.value;
      // Capa RODEO del gating: del rodeo REAL del animal (multi-tenant). Fail-safe conservador: si no
      // resuelve → mapa vacío → el ofrecimiento da null → estado explicativo, nunca un tacto que el trigger
      // `0054` rechazaría con 23514 al subir.
      const gatingR = await fetchRodeoGating(detail.rodeoId);
      if (!active) return;
      const rodeoConfig: RodeoDataKeyMap = gatingR.ok ? gatingR.value : {};
      const offer = resolveFichaTactoOffer({
        status: detail.status,
        sex: detail.sex,
        categoryCode: detail.categoryCode,
        isCastrated: detail.isCastrated,
        reproStatus: detail.reproStatus,
        rodeoConfig,
      });
      if (offer == null) {
        setResolution({
          kind: 'unavailable',
          message: 'Este animal ya no necesita un tacto, o su rodeo no lo tiene habilitado.',
        });
        return;
      }
      // BUCKETS de tamaño (RTF.4.3): del rodeo del animal, con la FUENTE ÚNICA `effectiveSizeBuckets`. El
      // segundo argumento es `undefined` A PROPÓSITO: el override de "¿medir tamaño?" vive en `sessions.config`
      // y acá NO hay jornada → rige el default del rodeo. Rodeo sin `service_months` → [] → PREÑADA persiste
      // 'large' directo, sin sub-paso (convención DD-PSC-2, ya vigente en la manga).
      let buckets: SizeBucket[] = [];
      if (offer === 'prenez') {
        const monthsR = await fetchRodeoServiceMonths(detail.rodeoId);
        if (!active) return;
        const nMonths = monthsR.ok && monthsR.value ? monthsR.value.length : null;
        buckets = effectiveSizeBuckets(nMonths, undefined);
      }
      setResolution({ kind: 'ready', detail, offer, buckets });
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  /**
   * Persiste el resultado y vuelve a la ficha (RTF.5). Un solo INSERT local plano, sin `session_id`. El
   * guard de re-entrancy se toma ANTES del primer await; si el write LOCAL falla, NO se navega (RTF.5.6): se
   * muestra el error accionable en la misma pantalla y se libera el guard para reintentar.
   */
  const persist = useCallback(
    async (write: (eventDate: string) => Promise<{ ok: boolean; error?: { kind: string; message: string } }>) => {
      if (busyRef.current) return;
      // Fecha: HOY, salvo que el operario haya desplegado "Fue otro día" y tipeado otra (RTF.6.1/P3). La
      // validación (formato + no futura) es la misma del resto de los eventos.
      let resolvedDate = todayIsoLocal();
      if (dateOpen) {
        const d = validateEventDate(eventDate);
        if (!d.ok) {
          setDateErr(d.error);
          return;
        }
        setDateErr(null);
        resolvedDate = d.value;
      }
      busyRef.current = true;
      setSaving(true);
      setError(null);
      const r = await write(resolvedDate);
      if (!r.ok) {
        busyRef.current = false;
        setSaving(false);
        setError(
          r.error?.kind === 'network'
            ? 'Sin conexión: no pudimos guardar el tacto. Conectate y volvé a intentar.'
            : (r.error?.message ?? 'No pudimos guardar el tacto. Probá de nuevo.'),
        );
        return;
      }
      goBack();
    },
    [dateOpen, eventDate, goBack],
  );

  const onConfirmPrenez = useCallback(
    (pregnancyStatus: PregnancyStatus) => {
      if (!profileId) return;
      void persist((date) => addTacto({ profileId, pregnancyStatus, eventDate: date }));
    },
    [profileId, persist],
  );

  const onConfirmAptitud = useCallback(
    (fitness: HeiferFitness) => {
      if (!profileId) return;
      void persist((date) => addTactoVaquillona({ profileId, fitness, eventDate: date }));
    },
    [profileId, persist],
  );

  const muted = getTokenValue('$textMuted', 'color');

  const header = (
    <YStack width="100%" paddingTop={insets.top} paddingHorizontal="$4">
      <XStack width="100%" alignItems="center" paddingVertical="$3">
        <Pressable hitSlop={8} onPress={goBack} {...buttonA11y(Platform.OS, { label: 'Volver' })}>
          <ChevronLeft size={28} color={muted} strokeWidth={2} />
        </Pressable>
      </XStack>
    </YStack>
  );

  if (resolution.kind === 'loading') {
    return (
      <YStack flex={1} backgroundColor="$bg">
        {header}
        <YStack flex={1} alignItems="center" justifyContent="center" gap="$3">
          <Spinner size="large" color="$primary" />
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="500" color="$textMuted">
            Abriendo el animal…
          </Text>
        </YStack>
      </YStack>
    );
  }

  if (resolution.kind === 'unavailable') {
    return (
      <YStack flex={1} backgroundColor="$bg">
        {header}
        <YStack flex={1} paddingHorizontal="$4" gap="$4" testID="tacto-no-aplica">
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary">
            No hay tacto para cargar
          </Text>
          <InfoNote>{resolution.message}</InfoNote>
          <XStack
            width="100%"
            minHeight="$touchMin"
            alignItems="center"
            justifyContent="center"
            borderRadius="$pill"
            borderWidth={2}
            borderColor="$primary"
            paddingHorizontal="$5"
            pressStyle={{ backgroundColor: '$greenLight' }}
            onPress={goBack}
            {...buttonA11y(Platform.OS, { label: 'Volver a la ficha' })}
          >
            <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="700" color="$primary" numberOfLines={1}>
              Volver a la ficha
            </Text>
          </XStack>
        </YStack>
      </YStack>
    );
  }

  const { detail, offer, buckets } = resolution;
  const hero = pickHeroIdentifier({
    apodo: detail.apodo,
    rodeoUsesApodo: detail.rodeoUsesApodo,
    idv: detail.idv,
    tag: detail.tagElectronic,
  });

  return (
    <YStack flex={1} backgroundColor="$bg">
      <KeyboardAvoidingShell style={fillStyle}>
        {header}

        {/* IDENTIDAD (RTF.4.2): a quién estoy tactando. El identificador hero grande + la categoría. */}
        <YStack paddingHorizontal="$4" paddingBottom="$2" gap="$2">
          <Text
            testID="tacto-hero"
            fontFamily="$heading"
            fontSize="$8"
            lineHeight="$8"
            fontWeight="700"
            color="$textPrimary"
            numberOfLines={1}
          >
            {hero.value ?? 'Animal sin caravana'}
          </Text>
          <XStack alignItems="center" gap="$2">
            <CategoryBadge label={detail.categoryName} code={detail.categoryCode} manual={detail.categoryOverride} size="md" />
          </XStack>
          <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textMuted" numberOfLines={1}>
            {fichaTactoCtaLabel(offer)}
          </Text>
        </YStack>

        {/* Error del write LOCAL (RTF.5.6): se muestra ACÁ y NO se navega — el operario reintenta tocando de
            nuevo el bloque. Va sobre el paso para no robarle área de acción a los botones gigantes. */}
        {error ? (
          <YStack paddingHorizontal="$4" paddingBottom="$2">
            <FormError message={error} />
          </YStack>
        ) : null}

        {/* EL PASO — los MISMOS componentes de la manga, sin rediseñar y sin props nuevas (RTF.4.1).
            `bottomPad` es 0 acá: el aire inferior lo pone la zona de la fecha, abajo. */}
        {offer === 'prenez' ? (
          <TactoStep bottomPad={0} buckets={buckets} onConfirm={onConfirmPrenez} />
        ) : (
          <TactoVaquillonaStep bottomPad={0} onConfirm={onConfirmAptitud} />
        )}

        {/* FECHA (RTF.6 / P3): por default el tacto es de HOY y no hay campo. El link secundario despliega el
            campo para cargar un tacto atrasado — la capacidad que la card "Tacto" de "Agregar evento" tenía
            y que RTF.9 retira. Discreto a propósito: el 99% de los tactos se cargan en el momento. */}
        <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$2">
          {dateOpen ? (
            <FormField
              label="Fecha del tacto (AAAA-MM-DD)"
              value={eventDate}
              onChangeText={(t) => {
                setEventDate(maskDateInput(t));
                if (dateErr) setDateErr(null);
              }}
              keyboardType="number-pad"
              placeholder="AAAA-MM-DD"
              error={dateErr}
              testID="tacto-fecha"
            />
          ) : (
            <XStack
              testID="tacto-fue-otro-dia"
              minHeight="$touchMin"
              alignItems="center"
              justifyContent="center"
              gap="$2"
              pressStyle={{ opacity: 0.6 }}
              onPress={() => setDateOpen(true)}
              {...buttonA11y(Platform.OS, { label: 'Fue otro día' })}
            >
              <CalendarDays size={getTokenValue('$navIcon', 'size')} color={muted} strokeWidth={2} />
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textMuted" numberOfLines={1}>
                Fue otro día
              </Text>
            </XStack>
          )}
          {saving ? (
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="500" color="$textMuted" numberOfLines={1}>
              Guardando…
            </Text>
          ) : null}
        </YStack>
      </KeyboardAvoidingShell>
    </YStack>
  );
}
