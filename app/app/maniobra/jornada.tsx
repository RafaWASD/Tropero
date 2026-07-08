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
import { Check, ChevronLeft, Play, Plus } from 'lucide-react-native';

import { Button, Card, FormError, InfoNote } from '@/components';
import { buttonA11y, labelA11y } from '@/utils/a11y';
import { RodeoIcon } from '@/theme/icons';
import { useEstablishment, useRodeo } from '@/contexts';
import type { Rodeo } from '@/services/rodeos';
import { createSession } from '@/services/sessions';
import { createPreset, fetchPresets, loadPreset, updatePreset } from '@/services/maneuver-presets';
import {
  createCustomField,
  enableCustomFieldInRodeo,
  fetchEnabledCustomManeuvers,
  type EnabledCustomManeuver,
} from '@/services/custom-fields';
import type { CustomFieldDraft } from '@/utils/custom-field';
import { useManeuverGating } from '@/hooks/useManeuverGating';
import { ALL_MANEUVERS, type ManeuverKind } from '@/utils/maneuver-gating';
import { extractCustomManiobras, tactoMeasureSizeFromConfig } from '@/utils/maneuver-config';
import { defaultMeasureSize } from '@/utils/pregnancy-buckets';
import {
  buildJornadaConfig,
  maneuverDetail,
  maneuverLabel,
  moveManeuver,
  toggleManeuver,
  toggleCustomManiobra,
  type ManeuverPreconfig,
} from '@/utils/maneuver-wizard';
import { ManeuverReorderList, type ReorderScrollContext } from './_components/ManeuverReorderList';
import { ManeuverConfigSheet, type ManeuverConfigKind } from './_components/ManeuverConfigSheet';
import { TactoConfigSheet } from './_components/TactoConfigSheet';
import { SavePresetSheet } from './_components/SavePresetSheet';
import { CustomFieldSheet } from './_components/CustomFieldSheet';

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
  const params = useLocalSearchParams<{ presetId?: string; editPresetId?: string; dragFreeze?: string }>();

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
  // M5-C.3 (R13.8): maniobras CUSTOM elegidas para la jornada (por field_definition_id) → config.customManiobras.
  const [chosenCustom, setChosenCustom] = useState<string[]>([]);
  const [preconfig, setPreconfig] = useState<ManeuverPreconfig>({});
  // Autocompletar (R1.8): valores de preconfig ya usados en los presets del campo, por maniobra.
  const [history, setHistory] = useState<Partial<Record<ManeuverKind, string[]>>>({});
  // Aviso de maniobras omitidas por gating del rodeo al cargar un preset (R2.3).
  const [presetOmitted, setPresetOmitted] = useState<ManeuverKind[]>([]);
  // Maniobra cuyo bottom sheet de preconfig está abierto (null = ninguno). Solo configurables (R1.7).
  const [configManeuver, setConfigManeuver] = useState<ManeuverKind | null>(null);
  // ¿Está abierto el sheet "¿medir tamaño?" del TACTO (spec 03 Stream B / B2, RPSC.4.1)? El tacto tiene su
  // propia preconfig BINARIA (no texto libre) → sheet aparte (TactoConfigSheet), no el ManeuverConfigSheet.
  const [tactoConfigOpen, setTactoConfigOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // ¿Está abierto el sheet de "Guardar como rutina" (R2.1)? Independiente de arrancar.
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  // Feedback breve tras guardar la rutina ("Rutina guardada"): se muestra unos segundos y se va.
  const [presetSaved, setPresetSaved] = useState(false);
  // M5-C.2 (R13.7): maniobras CUSTOM enabled en el rodeo elegido (tweak M1, §11.7) + el `+` para crear una.
  const [customManeuvers, setCustomManeuvers] = useState<EnabledCustomManeuver[]>([]);
  const [customSheetOpen, setCustomSheetOpen] = useState(false);

  // El `+` de crear maniobra custom es OWNER-only (R13.2): el non-owner ve las custom enabled pero no el `+`.
  const isOwner = estState.status === 'active' && estState.role === 'owner';

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

  // Maniobras CUSTOM enabled en el rodeo (tweak M1, §11.7): se muestran en etapa 2 junto a las de fábrica.
  // La selección/secuencia + el render per-animal de una maniobra custom es del chunk M5-C.3 (renderer
  // genérico desde ui_component); acá la lista las EXHIBE (la fuente de maniobras incluye las custom enabled)
  // y el `+` crea una nueva. Se recargan al cambiar de rodeo y tras crear una (refreshCustom).
  const refreshCustom = useCallback(async () => {
    if (!rodeoId) {
      setCustomManeuvers([]);
      return;
    }
    const r = await fetchEnabledCustomManeuvers(rodeoId);
    setCustomManeuvers(r.ok ? r.value : []);
  }, [rodeoId]);

  useEffect(() => {
    void refreshCustom();
  }, [refreshCustom]);

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

  // MODO del wizard (M7-A.2, R2.8): si vino `editPresetId` → EDITAR ese preset (el CTA terminal es "Guardar
  // cambios" = updatePreset, NO arranca jornada, NO crea nada). Si vino `presetId` → ARRANCAR desde ese
  // preset (CTA "Arrancar jornada" = createSession). Sin ninguno → jornada desde cero. `presetId` (arrancar)
  // y `editPresetId` (editar) son EXCLUYENTES; el caller manda uno u otro.
  const presetId = params.presetId ?? null;
  const editPresetId = params.editPresetId ?? null;
  const isEditingPreset = editPresetId != null;
  // El id del preset a CARGAR (en ambos modos se precarga loadPreset sobre el rodeo elegido).
  const loadFromPresetId = editPresetId ?? presetId;
  // Nombre del preset que se está editando (para persistirlo intacto en updatePreset — solo la config cambia).
  const [editPresetName, setEditPresetName] = useState<string>('');

  // Al elegir el rodeo, cargamos el preset (arrancar o editar) y pre-seleccionamos sus maniobras aplicables
  // + el aviso de omitidas (R2.2/R2.3/R2.8). Se dispara una vez que hay rodeo.
  useEffect(() => {
    if (!loadFromPresetId || !rodeoId) return;
    let active = true;
    void (async () => {
      const r = await loadPreset(loadFromPresetId, rodeoId);
      if (!active || !r.ok) return;
      setChosen(r.value.maniobras);
      setPresetOmitted(r.value.omitted);
      // Sembramos la preconfig del preset (R1.7) para las maniobras aplicables.
      const pre = (r.value.preset.config.preconfig ?? {}) as ManeuverPreconfig;
      setPreconfig(pre);
      // Restaurar las maniobras CUSTOM del preset (R13.8): el config jsonb del preset lleva customManiobras
      // (namespace paralelo). buildCurrentConfig las filtra luego a las que SIGUEN enabled en este rodeo.
      const customIds = extractCustomManiobras(r.value.preset.config);
      setChosenCustom(customIds);
      // En modo edición guardamos el nombre actual del preset (updatePreset lo persiste intacto).
      setEditPresetName(r.value.preset.name);
    })();
    return () => {
      active = false;
    };
  }, [loadFromPresetId, rodeoId]);

  const onPickRodeo = useCallback((r: Rodeo) => {
    setRodeo((prev) => {
      // Cambiar de rodeo → las maniobras custom elegidas (por id de OTRO rodeo) ya no aplican: limpiar.
      if (prev && prev.id !== r.id) setChosenCustom([]);
      return r;
    });
    setError(null);
    setStage(2);
  }, []);

  const onToggle = useCallback((m: ManeuverKind) => {
    setChosen((prev) => toggleManeuver(prev, m));
  }, []);

  // Toggle de una maniobra CUSTOM (por field_definition_id) en la jornada (R13.8): entra/sale de chosenCustom.
  const onToggleCustom = useCallback((fieldDefinitionId: string) => {
    setChosenCustom((prev) => toggleCustomManiobra(prev, fieldDefinitionId));
  }, []);

  const onReorder = useCallback((from: number, to: number) => {
    setChosen((prev) => moveManeuver(prev, from, to));
  }, []);

  // nº de meses de servicio del rodeo elegido (para el default + el copy del sugerido del tacto, B2 RPSC.4.2).
  // `serviceMonths === null` ("sin configurar") → null (defaultMeasureSize → NO); `[]` ("no hace servicio")
  // → 0 (→ NO). NUNCA hardcodeado: sale del rodeo elegido (multi-tenant). undefined hasta elegir rodeo.
  const serviceMonthsCount = rodeo?.serviceMonths == null ? null : rodeo.serviceMonths.length;

  // Abrir el bottom sheet de preconfig de una maniobra configurable. TACTO (B2, RPSC.4.1) → su sheet binario
  // (¿medir tamaño?); vacunación/inseminación (R1.7) → el de texto libre. Tocar el cuerpo de la fila.
  const onOpenConfig = useCallback((m: ManeuverKind) => {
    if (m === 'tacto') setTactoConfigOpen(true);
    else if (FREE_TEXT_PRECONFIG[m]) setConfigManeuver(m);
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

  // Guardar "¿medir tamaño?" del TACTO desde el TactoConfigSheet (B2, RPSC.4.1/4.3) → persiste el OBJETO
  // `{ measureSize }` en config.preconfig.tacto (shape que tactoMeasureSizeFromConfig lee; lo consume la
  // carga rápida vía effectiveSizeBuckets). Siempre se guarda explícito (true o false) — el operario decidió.
  const onTactoConfigSave = useCallback((measureSize: boolean) => {
    setPreconfig((prev) => ({ ...prev, tacto: { measureSize } }));
    setTactoConfigOpen(false);
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
    // Solo las custom elegidas que SIGUEN enabled en el rodeo (defensivo: una deshabilitada/borrada no entra
    // al config — el gating de la carga rápida igual la omitiría, pero no la guardamos de gusto).
    const enabledIds = new Set(customManeuvers.map((c) => c.fieldDefinitionId));
    const customIds = chosenCustom.filter((id) => enabledIds.has(id));
    return buildJornadaConfig(chosen, cleanPre, customIds);
  }, [chosen, preconfig, chosenCustom, customManeuvers]);

  const onArrancar = useCallback(async () => {
    if (!establishmentId || !rodeo) {
      setError('No pudimos resolver el campo o el rodeo. Volvé a intentar.');
      return;
    }
    if (chosen.length === 0 && chosenCustom.length === 0) {
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
  }, [establishmentId, rodeo, chosen, chosenCustom, buildCurrentConfig, router]);

  // GUARDAR CAMBIOS de un preset en modo edición (M7-A.2, R2.8): llama updatePreset(editPresetId, name,
  // config) con la config ACTUAL de la jornada (mismo buildCurrentConfig que arranca/crea — un solo shape).
  // NO llama createSession ni createPreset → NO arranca jornada, NO crea nada nuevo (R2.8). El name se
  // persiste INTACTO (la edición de maniobras NO renombra; renombrar es otra acción, R2.7). Al OK → vuelve al
  // landing. Fail-closed: si updatePreset falla, NO navegamos, se superficia el error y se deja reintentar.
  const onGuardarCambios = useCallback(async () => {
    if (!editPresetId) {
      setError('No pudimos resolver la rutina. Volvé a intentar.');
      return;
    }
    if (chosen.length === 0 && chosenCustom.length === 0) {
      setError('Elegí al menos una maniobra para la rutina.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const config = buildCurrentConfig();
    const r = await updatePreset(editPresetId, editPresetName, config);
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error.message);
      return;
    }
    // OK: volvemos al landing del que vinimos (el wizard se abrió PUSHEADO sobre él). El preset actualizado
    // se ve al re-enfocar (fetchPresets en focus). router.back() (no replace) → no apila un landing nuevo.
    router.back();
  }, [editPresetId, editPresetName, chosen, chosenCustom, buildCurrentConfig, router]);

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

  // Crear una maniobra CUSTOM desde el `+` de la lista (R13.7): data_type='maniobra' fijo (sin pregunta de
  // clasificación, por construcción) + se HABILITA en el rodeo en el mismo paso (R13.5b). createCustomField
  // es CRUD-plano offline (el server fuerza owner + valida); enableCustomFieldInRodeo encola el toggle vía
  // la RPC set_rodeo_config (owner-only). Al OK: cerramos el sheet + recargamos la lista de custom. Devuelve
  // un mensaje es-AR al fallo (el sheet lo superficia y no se cierra).
  const onCreateCustomManeuver = useCallback(
    async (draft: CustomFieldDraft): Promise<string | null> => {
      if (!establishmentId || !rodeoId) return 'No pudimos resolver el campo o el rodeo. Volvé a intentar.';
      // mode='maniobra' del sheet ya fija data_type='maniobra'; lo reforzamos por las dudas (R13.7).
      const r = await createCustomField({ establishmentId, draft: { ...draft, dataType: 'maniobra' } });
      if (!r.ok) return r.error.message;
      // Habilitarla en el rodeo de una (R13.5b). Si el enable fallara (DB local), el dato YA se creó; lo
      // reportamos pero no perdemos la creación (el owner la puede prender luego desde la plantilla).
      const en = await enableCustomFieldInRodeo({ rodeoId, fieldDefinitionId: r.value.fieldDefinitionId });
      setCustomSheetOpen(false);
      await refreshCustom();
      if (!en.ok) return null; // creada pero no habilitada: cerramos igual (no es un fallo de creación).
      return null;
    },
    [establishmentId, rodeoId, refreshCustom],
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
            {stage === 1
              ? 'Elegí el rodeo'
              : stage === 2
                ? 'Elegí las maniobras'
                : isEditingPreset
                  ? 'Revisá la rutina'
                  : 'Revisá la jornada'}
          </Text>
          <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
            {isEditingPreset ? `Editando ${editPresetName || 'la rutina'} · paso ${stage} de 3` : `Paso ${stage} de 3`}
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
              serviceMonthsCount={serviceMonthsCount}
              loading={gating.loading}
              gatingError={gating.error}
              presetOmitted={presetOmitted}
              customManeuvers={customManeuvers}
              chosenCustom={chosenCustom}
              canCreateCustom={isOwner}
              onCreateCustom={() => setCustomSheetOpen(true)}
              onToggle={onToggle}
              onToggleCustom={onToggleCustom}
              onReorder={onReorder}
              onOpenConfig={onOpenConfig}
              scrollContext={scrollContext}
              frozenDragIndex={frozenDragIndex}
            />
          ) : (
            <StageSummary
              rodeo={rodeo}
              chosen={chosen}
              preconfig={preconfig}
              serviceMonthsCount={serviceMonthsCount}
              customChosen={customManeuvers.filter((c) => chosenCustom.includes(c.fieldDefinitionId))}
            />
          )}
        </Animated.ScrollView>
      </RNView>

      {/* ── CTA inferior (zona del pulgar). Etapa 1 no tiene CTA (tocar el rodeo avanza). ── */}
      {stage === 2 ? (
        <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad}>
          {(() => {
            // Total elegido = maniobras de fábrica + maniobras custom (R13.8). Cualquiera de las dos habilita.
            const totalChosen = chosen.length + chosenCustom.length;
            return (
              <Button
                fullWidth
                disabled={totalChosen === 0}
                onPress={() => {
                  setError(null);
                  setStage(3);
                }}
              >
                {totalChosen === 0 ? 'Elegí maniobras' : `Continuar (${totalChosen})`}
              </Button>
            );
          })()}
        </YStack>
      ) : stage === 3 ? (
        <YStack paddingHorizontal="$4" paddingTop="$2" paddingBottom={bottomPad} gap="$2">
          {/* Feedback breve tras guardar la rutina (se desvanece solo). Verde de confirmación. */}
          {presetSaved ? (
            <View
              testID="preset-saved-toast"
              backgroundColor="$primary"
              borderRadius="$card"
              paddingHorizontal="$4"
              paddingVertical="$3"
              alignItems="center"
              {...labelA11y(Platform.OS, 'Rutina guardada')}
            >
              <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$white" numberOfLines={1}>
                Rutina guardada
              </Text>
            </View>
          ) : null}

          {isEditingPreset ? (
            // MODO EDICIÓN (M7-A.2, R2.8): el CTA terminal GUARDA los cambios sobre el MISMO preset (updatePreset)
            // — NO arranca jornada. Se SUPRIME el secundario "Guardar como rutina" (redundante: ya estás editando
            // una rutina existente).
            <ArrancarCTA submitting={submitting} onPress={onGuardarCambios} label="Guardar cambios" />
          ) : (
            <>
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
            </>
          )}
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

      {/* BOTTOM SHEET "¿medir tamaño?" del TACTO (B2, RPSC.4.1): segmentado Sí/No, default DERIVADO del rodeo
          elegido (defaultMeasureSize(serviceMonthsCount)) visible + override de un toque. Persiste el OBJETO
          { measureSize } en config.preconfig.tacto. value = el override previo (si ya se configuró). */}
      {tactoConfigOpen ? (
        <TactoConfigSheet
          suggested={defaultMeasureSize(serviceMonthsCount)}
          serviceMonthsCount={serviceMonthsCount}
          value={tactoMeasureSizeFromConfig({ preconfig })}
          onSave={onTactoConfigSave}
          onClose={() => setTactoConfigOpen(false)}
        />
      ) : null}

      {/* BOTTOM SHEET de "Guardar como rutina" (R2.1): nombre + Guardar → createPreset con la config
          ACTUAL de la jornada. Independiente de arrancar. Fail-closed (no cierra ni pierde lo tipeado). */}
      {savePresetOpen ? (
        <SavePresetSheet onSave={onSavePreset} onClose={() => setSavePresetOpen(false)} />
      ) : null}

      {/* SHEET de creación de MANIOBRA custom (R13.7): modo 'maniobra' (data_type fijo, SIN pregunta de
          clasificación). Owner-only (el `+` ya está gateado a isOwner en StageManeuvers). */}
      {isOwner && customSheetOpen ? (
        <CustomFieldSheet
          mode="maniobra"
          onCreate={onCreateCustomManeuver}
          onClose={() => setCustomSheetOpen(false)}
        />
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
  serviceMonthsCount,
  loading,
  gatingError,
  presetOmitted,
  customManeuvers,
  chosenCustom,
  canCreateCustom,
  onCreateCustom,
  onToggle,
  onToggleCustom,
  onReorder,
  onOpenConfig,
  scrollContext,
  frozenDragIndex,
}: {
  offered: ManeuverKind[];
  chosen: ManeuverKind[];
  preconfig: ManeuverPreconfig;
  /** nº de meses de servicio del rodeo elegido (B2): el inline del tacto muestra el sugerido derivado. */
  serviceMonthsCount: number | null;
  loading: boolean;
  gatingError: string | null;
  presetOmitted: ManeuverKind[];
  customManeuvers: EnabledCustomManeuver[];
  chosenCustom: string[];
  canCreateCustom: boolean;
  onCreateCustom: () => void;
  onToggle: (m: ManeuverKind) => void;
  onToggleCustom: (fieldDefinitionId: string) => void;
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
  // La pantalla puede no tener maniobras de fábrica habilitadas pero SÍ ofrecer crear una custom (owner).
  if (offered.length === 0 && customManeuvers.length === 0 && !canCreateCustom) {
    return <InfoNote>Este rodeo no tiene maniobras habilitadas en su plantilla de datos.</InfoNote>;
  }

  // Resuelve el preconfig INLINE de una maniobra (R1.7 / B2): valor cargado o el hint si no hay nada. Las
  // configurables muestran segunda línea + chevron (tocá el cuerpo → su sheet). Las demás devuelven null.
  //  - TACTO (B2, RPSC.4.1/4.2): "¿medir tamaño?". Si el operario lo CONFIGURÓ → "Medí tamaño: Sí/No"
  //    (valor cargado, énfasis); si NO → hint con el SUGERIDO derivado del rodeo ("Sugerido: Sí — tocá para
  //    elegir"), para que no haya que abrir el sheet a ciegas. El default real (al no abrirlo) lo aplica la
  //    carga rápida igual (effectiveSizeBuckets cae al defaultMeasureSize) → el inline es informativo, no
  //    obligatorio.
  //  - vacunación/inseminación (R1.7): texto libre (vacuna/pajuela).
  const inlineConfig = (m: ManeuverKind): { value: string | null; hint: string } | null => {
    if (m === 'tacto') {
      const explicit = tactoMeasureSizeFromConfig({ preconfig });
      const suggested = defaultMeasureSize(serviceMonthsCount);
      const value = explicit === undefined ? null : `Medí tamaño: ${explicit ? 'Sí' : 'No'}`;
      const hint = `Sugerido: ${suggested ? 'Sí' : 'No'} — tocá para elegir`;
      return { value, hint };
    }
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
      {offered.length > 0 ? (
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
      ) : null}

      {/* MANIOBRAS PERSONALIZADAS del rodeo (tweak M1, §11.7) + el `+` para crear una (R13.7). La lista de
          maniobras del rodeo = 10 de fábrica gateadas + estas custom enabled. La carga per-animal de una
          maniobra custom se cablea en M5-C.3 (renderer genérico desde ui_component); acá se EXHIBEN para que
          el owner las vea creadas/habilitadas y para crear nuevas. El `+` es OWNER-only (R13.2). */}
      <CustomManeuverSection
        customManeuvers={customManeuvers}
        chosenCustom={chosenCustom}
        canCreateCustom={canCreateCustom}
        onCreateCustom={onCreateCustom}
        onToggleCustom={onToggleCustom}
      />
    </YStack>
  );
}

// ─── Sección de maniobras personalizadas (tweak M1, §11.7) + `+` crear (R13.7) ─────────────────────────

function CustomManeuverSection({
  customManeuvers,
  chosenCustom,
  canCreateCustom,
  onCreateCustom,
  onToggleCustom,
}: {
  customManeuvers: EnabledCustomManeuver[];
  chosenCustom: string[];
  canCreateCustom: boolean;
  onCreateCustom: () => void;
  onToggleCustom: (fieldDefinitionId: string) => void;
}) {
  const WHITE = getTokenValue('$white', 'color');
  const chosenSet = new Set(chosenCustom);
  if (customManeuvers.length === 0 && !canCreateCustom) return null;
  return (
    <YStack gap="$2">
      <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="600" color="$textMuted" numberOfLines={1}>
        Maniobras personalizadas
      </Text>

      {/* Cada maniobra custom es SELECCIONABLE (R13.8): tocarla la agrega/saca de la jornada (toggle). El badge
          pasa a ✓ verde cuando está elegida (entra a config.customManiobras → la carga rápida la secuencia). */}
      {customManeuvers.map((c) => {
        const selected = chosenSet.has(c.fieldDefinitionId);
        return (
          <XStack
            key={c.fieldDefinitionId}
            backgroundColor={selected ? '$greenLight' : '$surface'}
            borderRadius="$card"
            borderWidth={selected ? 2 : 1}
            borderColor={selected ? '$primary' : '$divider'}
            paddingHorizontal="$3"
            minHeight="$touchMin"
            alignItems="center"
            gap="$3"
            pressStyle={{ backgroundColor: '$greenLight' }}
            onPress={() => onToggleCustom(c.fieldDefinitionId)}
            testID={`custom-maneuver-${c.fieldDefinitionId}`}
            {...buttonA11y(Platform.OS, { label: `${c.label}`, selected })}
          >
            <View width={28} height={28} borderRadius="$pill" alignItems="center" justifyContent="center" backgroundColor={selected ? '$primary' : '$greenLight'}>
              {selected ? (
                <Check size={16} color={WHITE} strokeWidth={3} />
              ) : (
                <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="700" color="$primary" numberOfLines={1}>
                  ★
                </Text>
              )}
            </View>
            {/* lineHeight matching → un label custom con g/j/p no se recorta. */}
            <Text flex={1} minWidth={0} fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
              {c.label}
            </Text>
          </XStack>
        );
      })}

      {/* `+` crear maniobra personalizada (R13.7). Owner-only. */}
      {canCreateCustom ? (
        <Pressable
          onPress={onCreateCustom}
          testID="maneuver-add-custom"
          {...buttonA11y(Platform.OS, { label: 'Crear maniobra personalizada' })}
        >
          <XStack
            alignItems="center"
            gap="$2"
            minHeight="$touchMin"
            paddingHorizontal="$3"
            borderRadius="$card"
            borderWidth={1}
            borderColor="$primary"
            borderStyle="dashed"
            backgroundColor="$surface"
            pressStyle={{ backgroundColor: '$greenLight' }}
          >
            <View width={28} height={28} borderRadius="$pill" alignItems="center" justifyContent="center" backgroundColor="$primary">
              <Plus size={18} color={WHITE} strokeWidth={3} />
            </View>
            <Text fontFamily="$body" fontSize="$4" lineHeight="$4" fontWeight="700" color="$primary" numberOfLines={1}>
              Crear maniobra personalizada
            </Text>
          </XStack>
        </Pressable>
      ) : null}
    </YStack>
  );
}

// ─── Etapa 3 — Resumen (R1.9) ─────────────────────────────────────────────────────────

function StageSummary({
  rodeo,
  chosen,
  preconfig,
  serviceMonthsCount,
  customChosen,
}: {
  rodeo: Rodeo | null;
  chosen: ManeuverKind[];
  preconfig: ManeuverPreconfig;
  /** nº de meses de servicio del rodeo (B2): el detalle del tacto muestra el efectivo (override o sugerido). */
  serviceMonthsCount: number | null;
  /** Maniobras custom elegidas para la jornada (R13.8), en el orden de selección. */
  customChosen: EnabledCustomManeuver[];
}) {
  const PRIMARY = getTokenValue('$primary', 'color');
  const total = chosen.length + customChosen.length;
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
          {`Maniobras (${total}) — en este orden`}
        </Text>
        {chosen.map((m, i) => {
          // Detalle cargado desde config.preconfig (R1.9): "Brucelosis" bajo "Vacunación", la pajuela
          // bajo "Inseminación", etc. Resuelto TOLERANTE por el helper puro (string o objeto → texto).
          // TACTO (B2): muestra "Medí tamaño: Sí/No" — el override del operario o, si no configuró, el
          // SUGERIDO derivado del rodeo (lo que la carga rápida aplicará por default).
          const detail =
            m === 'tacto'
              ? `Medí tamaño: ${(tactoMeasureSizeFromConfig({ preconfig }) ?? defaultMeasureSize(serviceMonthsCount)) ? 'Sí' : 'No'}`
              : maneuverDetail(preconfig, m);
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
        {/* Maniobras CUSTOM de la jornada (R13.8) — DESPUÉS de las de fábrica (mismo orden que la secuencia de
            carga). La numeración continúa la de fábrica (chosen.length + i + 1). Badge ★ para distinguirlas. */}
        {customChosen.map((c, i) => (
          <XStack
            key={c.fieldDefinitionId}
            backgroundColor="$surface"
            borderRadius="$card"
            borderWidth={1}
            borderColor="$divider"
            paddingHorizontal="$3"
            minHeight="$touchMin"
            alignItems="center"
            gap="$3"
            testID={`summary-custom-${c.fieldDefinitionId}`}
          >
            <View width={28} height={28} borderRadius="$pill" alignItems="center" justifyContent="center" backgroundColor="$primary">
              <Text fontFamily="$body" fontSize="$3" lineHeight="$3" fontWeight="700" color="$white" numberOfLines={1}>
                {chosen.length + i + 1}
              </Text>
            </View>
            <YStack flex={1} minWidth={0}>
              <Text fontFamily="$body" fontSize="$5" lineHeight="$5" fontWeight="600" color="$textPrimary" numberOfLines={1}>
                {c.label}
              </Text>
              <Text fontFamily="$body" fontSize="$3" lineHeight="$3" color="$textMuted" numberOfLines={1}>
                Personalizada
              </Text>
            </YStack>
          </XStack>
        ))}
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
function ArrancarCTA({
  submitting,
  onPress,
  label = 'Arrancar jornada',
}: {
  submitting: boolean;
  onPress: () => void;
  /** Texto del CTA. Default "Arrancar jornada"; en modo edición de preset = "Guardar cambios" (M7-A.2). */
  label?: string;
}) {
  const WHITE = getTokenValue('$white', 'color');
  // En modo "guardar cambios" (edición de preset) el ícono ▶ de arrancar no aplica → ✓ Check; arrancar = ▶.
  const isSave = label === 'Guardar cambios';
  const busyLabel = isSave ? 'Guardando…' : 'Arrancando…';
  const a11y =
    Platform.OS === 'web'
      ? { role: 'button' as const, 'aria-disabled': submitting }
      : { accessibilityRole: 'button' as const, accessibilityState: { disabled: submitting } };
  return (
    <Pressable onPress={submitting ? undefined : onPress} accessibilityLabel={label} {...a11y}>
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
        {isSave ? <Check size={24} color={WHITE} strokeWidth={3} /> : <Play size={22} color={WHITE} fill={WHITE} />}
        {/* lineHeight matching aunque las copys traen 'j'/'g' descendentes. */}
        <Text fontFamily="$body" fontSize="$6" lineHeight="$6" fontWeight="700" color="$white" numberOfLines={1}>
          {submitting ? busyLabel : label}
        </Text>
      </XStack>
    </Pressable>
  );
}
