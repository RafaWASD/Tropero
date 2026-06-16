// app/maniobra/jornada.tsx — WIZARD de configuración de jornada (spec 03 M1.4, US-1).
//
// Tres etapas, UNA DECISIÓN POR PANTALLA (R1.2):
//   Etapa 1 — RODEO (R1.3): filas grandes de rodeos ACTIVOS del establecimiento. Elegir uno.
//   Etapa 2 — MANIOBRAS (R1.4/R1.5/R1.7/R1.8/R1.12/R1.13): lista gateada por el rodeo (toggle on/off);
//             las elegidas forman una lista REORDENABLE por drag (handles visibles); preconfig de tanda
//             (texto libre + autocompletar de valores usados antes) por maniobra.
//   Etapa 3 — RESUMEN (R1.9): las maniobras EN EL ORDEN elegido + "Arrancar jornada" → createSession con
//             config { maniobras:[orden], preconfig } → navega a la carga (stub M2 por ahora).
//
// Servicios consumidos (M1-SERVICIOS, NO se tocan): useManeuverGating (gating capa 1), loadPreset (filtra
// maniobras gateadas OFF + lista omitidas), createSession (CRUD-plano offline, IDs cliente), fetchPresets
// (para sembrar el autocompletar de preconfig, R1.8). Rodeos desde RodeoContext (active=true ya filtrado
// por fetchRodeos). Establishment activo SIEMPRE del contexto (NUNCA hardcodeado, CLAUDE.md ppio 6).
//
// 🟡 mixto (setup de jornada, momento calmo): manga-friendly (targets ≥$touchMin, CTAs en zona del pulgar)
// pero permite densidad de lista/toggles/handles. No necesita los botones gigantes de la carga (M2/M3).
//
// RECORTE DE DESCENDENTES (memoria, regla dura): todo heading ≥$6 y todo Text con numberOfLines lleva
// lineHeight matching (labels con g/j/p: "Vacunación", "Inseminación", "Raspado de toros", nombres de rodeo).
//
// Cero hardcode (ADR-023 §4): tokens; lucide vía getTokenValue. Íconos de ENTIDAD (rodeo) vienen del
// registro central `@/theme/icons` (RodeoIcon = Boxes) → single source of truth, no glifos sueltos.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View as RNView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getTokenValue, Text, View, XStack, YStack } from 'tamagui';
import Animated, { useAnimatedRef, useScrollOffset, useSharedValue } from 'react-native-reanimated';
import { ChevronLeft, Play } from 'lucide-react-native';

import { Button, Card, FormError, InfoNote } from '@/components';
import { labelA11y } from '@/utils/a11y';
import { RodeoIcon } from '@/theme/icons';
import { useEstablishment, useRodeo } from '@/contexts';
import type { Rodeo } from '@/services/rodeos';
import { createSession } from '@/services/sessions';
import { createPreset, fetchPresets, loadPreset } from '@/services/maneuver-presets';
import { useManeuverGating } from '@/hooks/useManeuverGating';
import { ALL_MANEUVERS, type ManeuverKind } from '@/utils/maneuver-gating';
import {
  buildJornadaConfig,
  maneuverDetail,
  maneuverLabel,
  moveManeuver,
  toggleManeuver,
  type ManeuverPreconfig,
} from '@/utils/maneuver-wizard';
import { ManeuverReorderList, type ReorderScrollContext } from './_components/ManeuverReorderList';
import { ManeuverConfigSheet, type ManeuverConfigKind } from './_components/ManeuverConfigSheet';
import { SavePresetSheet } from './_components/SavePresetSheet';

// Maniobras con preconfig de tanda de TEXTO LIBRE (R1.7/R1.8): la(s) vacuna(s) y la pajuela. Para cada
// una: el título del sheet, el placeholder del input grande, el hint inline cuando no está cargada, y si
// admite VARIAS (vacunación, multi) o UNA (inseminación, single). El preconfig ya NO vive al fondo: se
// carga desde un bottom sheet enfocado (ManeuverConfigSheet) y se ve INLINE en la fila (UX 3, Raf).
const FREE_TEXT_PRECONFIG: Partial<
  Record<ManeuverKind, { title: string; placeholder: string; hint: string; kind: ManeuverConfigKind }>
> = {
  vacunacion: {
    title: 'Vacunación',
    placeholder: 'Ej.: Brucelosis',
    hint: 'Tocá para elegir vacuna',
    kind: 'multi',
  },
  inseminacion: {
    title: 'Inseminación',
    placeholder: 'Ej.: Toro 123',
    hint: 'Tocá para elegir pajuela',
    kind: 'single',
  },
};

type Stage = 1 | 2 | 3;

export default function JornadaWizardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ presetId?: string; dragFreeze?: string }>();

  const { state: estState } = useEstablishment();
  const { state: rodeoState } = useRodeo();
  const establishmentId = estState.status === 'active' ? estState.current.id : null;

  // TEST HOOK (solo captura del leader): ?dragFreeze=<i> congela la fila i de la lista de seleccionadas
  // en estado "burbuja" (levantada) para fotografiar el lift/sombra. -1 (default) = sin congelar (runtime).
  const frozenDragIndex = (() => {
    const v = params.dragFreeze;
    if (typeof v !== 'string') return -1;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : -1;
  })();

  const [stage, setStage] = useState<Stage>(1);
  const [rodeo, setRodeo] = useState<Rodeo | null>(null);
  const [chosen, setChosen] = useState<ManeuverKind[]>([]);
  const [preconfig, setPreconfig] = useState<ManeuverPreconfig>({});
  // Autocompletar (R1.8): valores de preconfig ya usados en los presets del campo, por maniobra.
  const [history, setHistory] = useState<Partial<Record<ManeuverKind, string[]>>>({});
  // Aviso de maniobras omitidas por gating del rodeo al cargar un preset (R2.3).
  const [presetOmitted, setPresetOmitted] = useState<ManeuverKind[]>([]);
  // Maniobra cuyo bottom sheet de preconfig está abierto (null = ninguno). Solo configurables (R1.7).
  const [configManeuver, setConfigManeuver] = useState<ManeuverKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ¿Está abierto el sheet de "Guardar como rutina" (R2.1)? Independiente de arrancar.
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  // Feedback breve tras guardar la rutina ("Rutina guardada"): se muestra unos segundos y se va.
  const [presetSaved, setPresetSaved] = useState(false);

  const rodeoId = rodeo?.id ?? null;
  const gating = useManeuverGating(rodeoId);

  const activeRodeos = rodeoState.status === 'active' ? rodeoState.available : [];

  // ── SCROLL + AUTO-SCROLL ──────────────────────────────────────────────────────────────────
  // El contenido de cada etapa va dentro de un Animated.ScrollView (reanimated): un swipe vertical
  // SCROLLEA (la 9na maniobra + pool + preconfig + CTA son alcanzables). Su ref animado + offset alimentan
  // el auto-scroll del drag de la etapa 2 (scrollContext). El viewport (top/alto en window) se mide con
  // measureInWindow al montar/cambiar de layout para detectar las zonas de borde del auto-scroll.
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const scrollOffset = useScrollOffset(scrollRef);
  const viewportTop = useSharedValue(0);
  const viewportHeight = useSharedValue(0);
  const scrollHostRef = useRef<RNView>(null);

  const measureViewport = useCallback(() => {
    const node = scrollHostRef.current;
    if (!node || typeof node.measureInWindow !== 'function') return;
    node.measureInWindow((_x, y, _w, h) => {
      if (Number.isFinite(y)) viewportTop.value = y;
      if (Number.isFinite(h) && h > 0) viewportHeight.value = h;
    });
  }, [viewportTop, viewportHeight]);

  const scrollContext = useMemo<ReorderScrollContext>(
    () => ({ scrollRef, scrollOffset, viewportTop, viewportHeight }),
    [scrollRef, scrollOffset, viewportTop, viewportHeight],
  );

  // Maniobras OFRECIDAS en la etapa 2 = solo las habilitadas (capa 1) en el rodeo elegido (R1.4/R1.5).
  // Dep en gating.config (el mapa real): recomputa solo cuando cambia la config del rodeo, no cada render.
  const gatingFilter = gating.filter;
  const offered = useMemo(() => {
    if (!gating.config) return [];
    return gatingFilter(ALL_MANEUVERS).applicable;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gating.config]);

  // Sembramos el autocompletar (R1.8) de los presets del campo: cada preset trae preconfig con valores
  // (vacuna/pajuela) usados antes. El `history` se pasa al bottom sheet (ManeuverConfigSheet), que filtra
  // las sugerencias contra lo tipeado con `filterAutocomplete` (helper puro).
  useEffect(() => {
    if (!establishmentId) return;
    let active = true;
    void (async () => {
      const r = await fetchPresets(establishmentId);
      if (!active || !r.ok) return;
      const acc: Partial<Record<ManeuverKind, string[]>> = {};
      for (const p of r.value) {
        const pre = (p.config.preconfig ?? {}) as Record<string, unknown>;
        for (const key of Object.keys(FREE_TEXT_PRECONFIG) as ManeuverKind[]) {
          const v = pre[key];
          const text = typeof v === 'string' ? v : undefined;
          if (text && text.trim().length > 0) {
            (acc[key] ??= []).push(text.trim());
          }
        }
      }
      setHistory(acc);
    })();
    return () => {
      active = false;
    };
  }, [establishmentId]);

  // Si vino con presetId (arrancar desde un preset, R2.2/R2.3): al elegir el rodeo cargamos el preset y
  // pre-seleccionamos sus maniobras aplicables + el aviso de omitidas. Se dispara una vez que hay rodeo.
  const presetId = params.presetId ?? null;
  useEffect(() => {
    if (!presetId || !rodeoId) return;
    let active = true;
    void (async () => {
      const r = await loadPreset(presetId, rodeoId);
      if (!active || !r.ok) return;
      setChosen(r.value.maniobras);
      setPresetOmitted(r.value.omitted);
      // Sembramos la preconfig del preset (R1.7) para las maniobras aplicables.
      const pre = (r.value.preset.config.preconfig ?? {}) as ManeuverPreconfig;
      setPreconfig(pre);
    })();
    return () => {
      active = false;
    };
  }, [presetId, rodeoId]);

  const onPickRodeo = useCallback((r: Rodeo) => {
    setRodeo(r);
    setError(null);
    setStage(2);
  }, []);

  const onToggle = useCallback((m: ManeuverKind) => {
    setChosen((prev) => toggleManeuver(prev, m));
  }, []);

  const onReorder = useCallback((from: number, to: number) => {
    setChosen((prev) => moveManeuver(prev, from, to));
  }, []);

  // Abrir el bottom sheet de preconfig de una maniobra configurable (R1.7). Tocar el cuerpo de la fila.
  const onOpenConfig = useCallback((m: ManeuverKind) => {
    if (FREE_TEXT_PRECONFIG[m]) setConfigManeuver(m);
  }, []);

  // Guardar el preconfig desde el sheet → persiste en config.preconfig[<maniobra>] (R1.7); vacío = limpia.
  const onConfigSave = useCallback((m: ManeuverKind, value: string) => {
    setPreconfig((prev) => {
      const next = { ...prev };
      if (value.trim().length === 0) delete next[m];
      else next[m] = value.trim();
      return next;
    });
    setConfigManeuver(null);
  }, []);

  const onBack = useCallback(() => {
    setError(null);
    if (stage === 1) {
      router.back();
      return;
    }
    setStage((s) => (s - 1) as Stage);
  }, [stage, router]);

  // Config snapshot ACTUAL de la jornada (R1.13, shape §2.1.1): maniobras EN SU ORDEN + preconfig (solo de
  // las maniobras que siguen elegidas, no ensuciamos el jsonb). Es la MISMA config que se persiste al
  // ARRANCAR (createSession) y al GUARDAR COMO RUTINA (createPreset) — un solo lugar, mismo shape (no se
  // re-deriva un shape distinto entre las dos acciones).
  const buildCurrentConfig = useCallback(() => {
    const cleanPre: ManeuverPreconfig = {};
    for (const m of chosen) {
      if (preconfig[m] != null) cleanPre[m] = preconfig[m];
    }
    return buildJornadaConfig(chosen, cleanPre);
  }, [chosen, preconfig]);

  const onArrancar = useCallback(async () => {
    if (!establishmentId || !rodeo) {
      setError('No pudimos resolver el campo o el rodeo. Volvé a intentar.');
      return;
    }
    if (chosen.length === 0) {
      setError('Elegí al menos una maniobra para la jornada.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const config = buildCurrentConfig();
    const r = await createSession({ establishmentId, rodeoId: rodeo.id, config });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    // Navega a la IDENTIFICACIÓN del primer animal (M2.1-core): scan-first BLE + manual. La sesión ya está
    // local (offline). Identify resuelve el animal → auto-avance a la carga rápida (M2.2 cablea el frame real).
    router.replace({ pathname: '/maniobra/identificar', params: { sessionId: r.value.id } });
  }, [establishmentId, rodeo, chosen, buildCurrentConfig, router]);

  // Guardar como rutina (R2.1): crea un maneuver_preset con la config ACTUAL de la jornada (mismo
  // buildCurrentConfig que arranca la sesión — las maniobras en orden + la preconfig). INDEPENDIENTE de
  // arrancar: podés guardar sin arrancar (quedás en etapa 3) o arrancar sin guardar. `establishmentId`
  // del contexto activo (NUNCA hardcodeado, R2.4). Devuelve null al OK, o un mensaje es-AR al fallo
  // (fail-closed: el sheet lo superficia y NO se cierra). El name lo re-trimea createPreset (CHECK no-vacío).
  const onSavePreset = useCallback(
    async (name: string): Promise<string | null> => {
      if (!establishmentId) {
        return 'No pudimos resolver el campo. Volvé a intentar.';
      }
      const config = buildCurrentConfig();
      const r = await createPreset({ establishmentId, name, config });
      if (!r.ok) {
        return r.error.message;
      }
      // OK: cerramos el sheet y mostramos un feedback breve. La rutina aparece en el landing la próxima
      // vez (fetchPresets en focus, ya cableado en maniobra.tsx).
      setSavePresetOpen(false);
      setPresetSaved(true);
      return null;
    },
    [establishmentId, buildCurrentConfig],
  );

  // El toast "Rutina guardada" se desvanece solo tras unos segundos (no tapa el flujo de la etapa 3).
  useEffect(() => {
    if (!presetSaved) return;
    const t = setTimeout(() => setPresetSaved(false), 2500);
    return () => clearTimeout(t);
  }, [presetSaved]);

  const PRIMARY = getTokenValue('$primary', 'color');
  const bottomPad = Math.max(insets.bottom, getTokenValue('$navBottomMin', 'size'));

  return (
    <YStack flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      {/* ── HEADER: volver + título de etapa + indicador "Paso N de 3" ── */}
      <XStack paddingHorizontal="$3" paddingVertical="$3" alignItems="center" gap="$2">
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          hitSlop={12}
        >
          <ChevronLeft size={28} color={PRIMARY} />
        </Pressable>
        <YStack flex={1} minWidth={0}>
          <Text fontFamily="$heading" fontSize="$7" lineHeight="$7" fontWeight="700" color="$textPrimary" numberOfLines={1}>
            {stage === 1 ? 'Elegí el rodeo' : stage === 2 ? 'Elegí las maniobras' : 'Revisá la jornada'}
          </Text>
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
            Paso {stage} de 3
          </Text>
        </YStack>
      </XStack>

      {/* Host que MIDE el viewport del scroll (measureInWindow) para las zonas de borde del auto-scroll.
          El Animated.ScrollView de adentro hace el scroll real (todas las etapas) + alimenta el auto-scroll
          del drag de la etapa 2. flex=1 → ocupa el alto entre el header y el CTA pinneado. */}
      <RNView style={{ flex: 1 }} ref={scrollHostRef} onLayout={measureViewport}>
        <Animated.ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: getTokenValue('$4', 'space'),
            paddingBottom: getTokenValue('$6', 'space'),
          }}
          showsVerticalScrollIndicator={false}
        >
          {error ? <View marginBottom="$3"><FormError message={error} /></View> : null}

          {stage === 1 ? (
            <StageRodeo rodeos={activeRodeos} onPick={onPickRodeo} />
          ) : stage === 2 ? (
            <StageManeuvers
              offered={offered}
              chosen={chosen}
              preconfig={preconfig}
              loading={gating.loading}
              gatingError={gating.error}
              presetOmitted={presetOmitted}
              onToggle={onToggle}
              onReorder={onReorder}
              onOpenConfig={onOpenConfig}
              scrollContext={scrollContext}
              frozenDragIndex={frozenDragIndex}
            />
          ) : (
            <StageSummary rodeo={rodeo} chosen={chosen} preconfig={preconfig} />
          )}
        </Animated.ScrollView>
      </RNView>

      {/* ── CTA inferior (zona del pulgar). Etapa 1 no tiene CTA (tocar el rodeo avanza). ── */}
      {stage === 2 ? (
        <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad}>
          <Button
            fullWidth
            disabled={chosen.length === 0}
            onPress={() => {
              setError(null);
              setStage(3);
            }}
          >
            {chosen.length === 0 ? 'Elegí maniobras' : `Continuar (${chosen.length})`}
          </Button>
        </YStack>
      ) : stage === 3 ? (
        <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$2">
          {/* Feedback breve tras guardar la rutina (se desvanece solo). Verde de confirmación. */}
          {presetSaved ? (
            <View
              testID="preset-saved-toast"
              backgroundColor="$greenLight"
              borderRadius="$card"
              paddingHorizontal="$4"
              paddingVertical="$3"
              alignItems="center"
              {...labelA11y(Platform.OS, 'Rutina guardada')}
            >
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$primary" numberOfLines={1}>
                Rutina guardada
              </Text>
            </View>
          ) : null}

          {/* PRIMARIO: arrancar la jornada (acción dominante, NO se degrada). */}
          <ArrancarCTA submitting={submitting} onPress={onArrancar} />

          {/* SECUNDARIO (outline): guardar como rutina. Acción INDEPENDIENTE de arrancar (R2.1): no
              compite con el primario (va debajo, outline). Deshabilitada mientras se arranca (no abrir el
              sheet en medio del createSession). */}
          <Button
            variant="secondary"
            fullWidth
            disabled={submitting}
            onPress={() => {
              setPresetSaved(false);
              setSavePresetOpen(true);
            }}
          >
            Guardar como rutina
          </Button>
        </YStack>
      ) : null}

      {/* BOTTOM SHEET de preconfig de tanda (R1.7/R1.8): abierto al tocar el cuerpo de una maniobra
          configurable (vacunación/inseminación). Input grande + autocompletar de usadas antes. */}
      {configManeuver && FREE_TEXT_PRECONFIG[configManeuver] ? (
        <ManeuverConfigSheet
          title={FREE_TEXT_PRECONFIG[configManeuver]!.title}
          kind={FREE_TEXT_PRECONFIG[configManeuver]!.kind}
          placeholder={FREE_TEXT_PRECONFIG[configManeuver]!.placeholder}
          value={typeof preconfig[configManeuver] === 'string' ? (preconfig[configManeuver] as string) : ''}
          history={history[configManeuver] ?? []}
          onSave={(value) => onConfigSave(configManeuver, value)}
          onClose={() => setConfigManeuver(null)}
        />
      ) : null}

      {/* BOTTOM SHEET de "Guardar como rutina" (R2.1): nombre + Guardar → createPreset con la config
          ACTUAL de la jornada. Independiente de arrancar. Fail-closed (no cierra ni pierde lo tipeado). */}
      {savePresetOpen ? (
        <SavePresetSheet onSave={onSavePreset} onClose={() => setSavePresetOpen(false)} />
      ) : null}
    </YStack>
  );
}

// ─── Etapa 1 — Rodeo (R1.3) ───────────────────────────────────────────────────────────

function StageRodeo({ rodeos, onPick }: { rodeos: Rodeo[]; onPick: (r: Rodeo) => void }) {
  const PRIMARY = getTokenValue('$primary', 'color');
  if (rodeos.length === 0) {
    return <InfoNote>No hay rodeos activos en este campo. Creá un rodeo antes de arrancar una jornada.</InfoNote>;
  }
  return (
    <YStack gap="$3">
      {rodeos.map((r) => (
        <Pressable
          key={r.id}
          onPress={() => onPick(r)}
          accessibilityRole="button"
          accessibilityLabel={`Elegir rodeo ${r.name}`}
        >
          <Card>
            <XStack alignItems="center" gap="$3">
              <View backgroundColor="$greenLight" borderRadius="$pill" width={44} height={44} alignItems="center" justifyContent="center">
                <RodeoIcon size={22} color={PRIMARY} />
              </View>
              {/* lineHeight matching → el nombre del rodeo (puede traer g/j) no se recorta. */}
              <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="600" color="$textPrimary" numberOfLines={1} flexShrink={1}>
                {r.name}
              </Text>
            </XStack>
          </Card>
        </Pressable>
      ))}
    </YStack>
  );
}

// ─── Etapa 2 — Maniobras (gateadas) + drag-reorder + preconfig ────────────────────────────

function StageManeuvers({
  offered,
  chosen,
  preconfig,
  loading,
  gatingError,
  presetOmitted,
  onToggle,
  onReorder,
  onOpenConfig,
  scrollContext,
  frozenDragIndex,
}: {
  offered: ManeuverKind[];
  chosen: ManeuverKind[];
  preconfig: ManeuverPreconfig;
  loading: boolean;
  gatingError: string | null;
  presetOmitted: ManeuverKind[];
  onToggle: (m: ManeuverKind) => void;
  onReorder: (from: number, to: number) => void;
  onOpenConfig: (m: ManeuverKind) => void;
  scrollContext: ReorderScrollContext;
  frozenDragIndex: number;
}) {
  if (loading) {
    return <InfoNote>Cargando las maniobras del rodeo…</InfoNote>;
  }
  if (gatingError) {
    return <InfoNote>{gatingError}</InfoNote>;
  }
  if (offered.length === 0) {
    return <InfoNote>Este rodeo no tiene maniobras habilitadas en su plantilla de datos.</InfoNote>;
  }

  // Resuelve el preconfig INLINE de una maniobra (R1.7): valor cargado (string) o el hint si no hay nada.
  // Solo las configurables (vacunación/inseminación) muestran segunda línea — el resto devuelve null.
  const inlineConfig = (m: ManeuverKind): { value: string | null; hint: string } | null => {
    const cfg = FREE_TEXT_PRECONFIG[m];
    if (!cfg) return null;
    const value = maneuverDetail(preconfig, m);
    return { value, hint: cfg.hint };
  };

  return (
    <YStack gap="$4">
      {/* Aviso de maniobras del preset omitidas por la config del rodeo (R2.3). */}
      {presetOmitted.length > 0 ? (
        <InfoNote>
          {`Se omitieron por la configuración del rodeo: ${presetOmitted.map(maneuverLabel).join(', ')}.`}
        </InfoNote>
      ) : null}

      {/* LISTA UNIFICADA (R1.4/R1.5/R1.7/R1.12): seleccionadas-arriba (reordenables por drag burbuja) +
          pool-abajo (tap para sumar). Zonas de toque en la fila seleccionada: el badge ✓/número = QUITAR;
          el CUERPO = abrir el sheet de preconfig si es configurable; el grip = drag. El preconfig se ve
          INLINE como segunda línea (valor cargado o hint "Tocá para elegir …"). */}
      <ManeuverReorderList
        offered={offered}
        chosen={chosen}
        onToggle={onToggle}
        onReorder={onReorder}
        onOpenConfig={onOpenConfig}
        inlineConfig={inlineConfig}
        scrollContext={scrollContext}
        frozenDragIndex={frozenDragIndex}
      />
    </YStack>
  );
}

// ─── Etapa 3 — Resumen (R1.9) ─────────────────────────────────────────────────────────

function StageSummary({
  rodeo,
  chosen,
  preconfig,
}: {
  rodeo: Rodeo | null;
  chosen: ManeuverKind[];
  preconfig: ManeuverPreconfig;
}) {
  const PRIMARY = getTokenValue('$primary', 'color');
  return (
    <YStack gap="$4">
      <Card>
        <XStack alignItems="center" gap="$3">
          <View backgroundColor="$greenLight" borderRadius="$pill" width={40} height={40} alignItems="center" justifyContent="center">
            <RodeoIcon size={20} color={PRIMARY} />
          </View>
          {/* Label arriba (mudo) + nombre del rodeo abajo (grande): el nombre no compite con el label
              en la misma fila → un nombre largo no recorta el rótulo "Rodeo". */}
          <YStack flex={1} minWidth={0}>
            <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
              Rodeo
            </Text>
            <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$textPrimary" numberOfLines={1}>
              {rodeo?.name ?? '—'}
            </Text>
          </YStack>
        </XStack>
      </Card>

      <YStack gap="$2">
        <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textMuted" numberOfLines={1}>
          {`Maniobras (${chosen.length}) — en este orden`}
        </Text>
        {chosen.map((m, i) => {
          // Detalle cargado desde config.preconfig (R1.9): "Brucelosis" bajo "Vacunación", la pajuela
          // bajo "Inseminación", etc. Resuelto TOLERANTE por el helper puro (string o objeto → texto).
          const detail = maneuverDetail(preconfig, m);
          return (
            <XStack
              key={m}
              backgroundColor="$surface"
              borderRadius="$card"
              borderWidth={1}
              borderColor="$divider"
              paddingHorizontal="$3"
              minHeight="$touchMin"
              alignItems="center"
              gap="$3"
            >
              <View width={28} height={28} borderRadius="$pill" alignItems="center" justifyContent="center" backgroundColor="$primary">
                <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="700" color="$white" numberOfLines={1}>
                  {i + 1}
                </Text>
              </View>
              <YStack flex={1} minWidth={0}>
                {/* Nombre · detalle (ej. "Vacunación · Brucelosis"). El nombre y el detalle van en
                    líneas distintas para no truncar: detalle largo no recorta el nombre. */}
                <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                  {maneuverLabel(m)}
                </Text>
                {detail ? (
                  <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
                    {detail}
                  </Text>
                ) : null}
              </YStack>
            </XStack>
          );
        })}
      </YStack>
    </YStack>
  );
}

// ─── CTA "Arrancar jornada" (etapa 3) — emphasis CONFIADO pero no gigante ──────────────────────
//
// Esta pantalla es de VERIFICACIÓN (no de carga rápida), así que el CTA no usa los botones gigantes de
// la manga. Confiado: un toque MÁS ALTO que el Button canónico ($touchMin=56 → 64) + un ícono ▶ leading
// + el verde botella de marca. Copy claro ("Arrancar jornada"). No es el primitivo Button (que es
// solo-texto y de alto fijo) — es un CTA propio de esta pantalla. Manga-friendly (≥$touchMin).
function ArrancarCTA({ submitting, onPress }: { submitting: boolean; onPress: () => void }) {
  const WHITE = getTokenValue('$white', 'color');
  const a11y =
    Platform.OS === 'web'
      ? { role: 'button' as const, 'aria-disabled': submitting }
      : { accessibilityRole: 'button' as const, accessibilityState: { disabled: submitting } };
  return (
    <Pressable onPress={submitting ? undefined : onPress} accessibilityLabel="Arrancar jornada" {...a11y}>
      <XStack
        backgroundColor="$primary"
        borderRadius="$pill"
        height={64}
        alignItems="center"
        justifyContent="center"
        gap="$2"
        opacity={submitting ? 0.5 : 1}
        pressStyle={{ backgroundColor: '$primaryPress' }}
      >
        <Play size={22} color={WHITE} fill={WHITE} />
        {/* lineHeight matching aunque "Arrancar jornada" trae 'j' descendente. */}
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          {submitting ? 'Arrancando…' : 'Arrancar jornada'}
        </Text>
      </XStack>
    </Pressable>
  );
}
