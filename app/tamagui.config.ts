// tamagui.config.ts — RAFAQ design tokens
//
// PROVISIONAL — se endurece al construir la home (A.1, ADR-023).
//
// Esta config siembra los tokens VALIDADOS del design system v4 (Stitch) que
// están en design/FRONTEND-STATUS.md. NO es el design system canónico: ese se
// DERIVA de construir la home a mano en Tamagui/Expo (ADR-023 §5). Hasta
// entonces estos valores son la base de trabajo, no el contrato final.
//
// Regla dura (ADR-023 §4): las PANTALLAS no hardcodean color/spacing. Todo valor
// visual referencia un token de acá (ej. backgroundColor="$primary",
// padding="$4", borderRadius="$card"). Este archivo es la ÚNICA fuente literal
// de hex/px del frontend.
//
// Stack: ADR-013 (Tamagui v2). Base = defaultConfig de @tamagui/config/v4
// (scales space/size/zIndex/radius + themes default de componentes), sobre la
// que montamos el color brand + la tipografía Inter + tokens semánticos.

import { createFont, createTamagui, createTokens } from '@tamagui/core';
import { defaultConfig } from '@tamagui/config/v4';

// ─── Paleta canónica (design system v4, FRONTEND-STATUS.md) ───────────────────
// Único lugar del frontend donde viven los hex literales.
const palette = {
  // Fondos base: blanco neutro, sin tinte frío ni cálido.
  white: '#FFFFFF',
  bg: '#faf9f9', // fondo base de la app (neutro)
  // Brand.
  primary: '#1e5a3e', // verde botella — brand primary + FAB + item activo
  primaryPress: '#184a33', // estado pressed del primary (derivado, provisional)
  // Surfaces.
  surface: '#F8F6F1', // bone — surface de cards (cálido, solo para cards)
  // Acentos.
  terracota: '#c84a2c', // alertas / tertiary
  greenLight: '#93cfac', // verde claro — icon containers
  // Texto.
  textPrimary: '#0F0E0C', // negro
  textMuted: '#707972', // gris (labels secundarios, items inactivos del nav)
  textFaint: '#A8A29D', // gris muted
  // Líneas.
  divider: '#E5E5E3',
} as const;

// ─── Constantes derivadas (única fuente, no literales sueltos) ────────────────
// El FAB central del bottom-nav (ADR-018) FLOTA sobre la barra. A 0.33 quedaba
// "cortado a la mitad" (medio enterrado en la barra, el borde superior la cruzaba
// casi por el centro). Subido a 0.55 → el FAB se ve FLOTANDO: la mayor parte del
// círculo (~55%) queda POR ENCIMA de la línea superior del navbar y ~45% solapado
// dentro, así el borde superior de la barra cruza el FAB a ~45% desde arriba.
// Claramente flotante (NO bisecado ni enterrado), pero sin exagerar (no excesivamente
// despegado). Beneficio lateral: el halo sube con el FAB y deja de tocar el label
// "Maniobra" → ya no hace falta el knockout blanco detrás del texto. El offset
// negativo se DERIVA del diámetro del FAB (no es un literal): fab * 0.55. Se expone
// como token `size.fabRaise` para que la pantalla lo lea con getTokenValue en vez de
// hardcodearlo.
const FAB_SIZE = 64; // = size.fab (mismo valor, fuente única abajo)
const FAB_RAISE_RATIO = 0.55; // fracción del FAB por encima de la barra (flotante, no cortado)

// ─── Tokens ───────────────────────────────────────────────────────────────────
// Spreadeamos las escalas probadas del default (space/size/zIndex/radius) y
// agregamos: grupo `color` con el brand, radios semánticos y touch-targets.
const tokens = createTokens({
  ...defaultConfig.tokens,
  color: {
    // Nombres semánticos consumibles como $primary, $surface, $bg, etc.
    white: palette.white,
    bg: palette.bg,
    primary: palette.primary,
    primaryPress: palette.primaryPress,
    surface: palette.surface,
    terracota: palette.terracota,
    greenLight: palette.greenLight,
    textPrimary: palette.textPrimary,
    textMuted: palette.textMuted,
    textFaint: palette.textFaint,
    divider: palette.divider,
  },
  radius: {
    ...defaultConfig.tokens.radius,
    card: 16, // radio de cards (design system v4)
    pill: 9999, // botones pill (CTA primarios)
  },
  size: {
    ...defaultConfig.tokens.size,
    // Touch targets manga-friendly (CLAUDE.md principio 4): mínimo cómodo 56px.
    touchMin: 56, // alto mínimo de botones primarios
    // Alto de CONTENIDO del bottom-nav (excluye insets.bottom, que se suma aparte).
    // 56px (touchMin) quedaba apretado para icono + label; bajado de 64 → 60 hacia
    // un nav "intermedio" (más compacto que el 64 previo, pero con targets más
    // grandes que Mercado Pago por uso en campo con guante: Fitts + manga-friendly).
    navBar: 60, // alto de contenido del bottom-nav
    // Margen inferior mínimo del nav cuando NO hay safe-area inset (insets.bottom=0:
    // Android viejo con botones físicos, o el preview web). Sin esto el nav queda al
    // ras del borde inferior, sin respiro. Se aplica como max(insets.bottom, navBottomMin).
    navBottomMin: 12,
    fab: FAB_SIZE, // diámetro del FAB central (ADR-018)
    // Diámetro del HALO del FAB (ADR-018): anillo verde pálido DECORATIVO detrás del
    // FAB, estilo Mercado Pago (crea figura-fondo, integra el botón a la barra blanca).
    // REFERENCIA de geometría: fab + 16 → el anillo se monta como hijo absoluto del
    // FAB con inset -8px en los 4 lados (no ocupa layout, no empuja FAB ni label) →
    // asoma ~8px de verde claro alrededor del círculo dark-green de 64 (diámetro ≈80).
    // No se consume como tamaño de wrapper (eso causaba el bug del halo que tomaba el
    // marginTop y tapaba el label); el inset -8 vive en _layout.tsx.
    fabHalo: FAB_SIZE + 16, // = 80: diámetro efectivo del anillo (referencia del inset -8)
    // Cuánto sube el FAB sobre la barra (offset negativo del marginTop). Derivado
    // de fab * 0.55 → ~55% del botón por encima de la barra: el FAB FLOTA (la mayor
    // parte del círculo arriba de la línea del navbar, ~45% solapado dentro). No
    // cortado/enterrado (eso era el 0.33). Es un token escalar (no literal en la pantalla).
    fabRaise: Math.round(FAB_SIZE * FAB_RAISE_RATIO), // = round(64*0.55) = 35
    // Avatares circulares. Derivado al construir la home (A.1): el avatar del
    // header. icon = contenedores de ícono cuadrados/circulares (ej. el check
    // del banner "establecimiento listo").
    avatar: 40, // diámetro del avatar de usuario en el header
    icon: 48, // diámetro de contenedores de ícono circulares (banner, etc.)
  },
});

// ─── Elevación / sombra ───────────────────────────────────────────────────────
// Derivado al construir la home (A.1, ADR-023 §5): los cards necesitan una sombra
// suave. Tamagui v4 NO expone tokens de sombra (shadowColor/Offset/etc. son props
// de estilo, no un token escalar), así que la centralizamos como un OBJETO de
// estilo exportado en vez de un token `$`. Sigue siendo la única fuente del valor
// (las pantallas no lo hardcodean: importan `shadows.card`). PROVISIONAL: cuando se
// canonice el design system se evalúa promover esto a un sistema de elevación.
export const shadows = {
  card: {
    shadowColor: palette.textPrimary, // negro de marca, no #000 puro
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, // sombra suave (card de fondo bone sobre bg neutro)
    shadowRadius: 12,
    elevation: 2, // Android
  },
} as const;

// ─── Tipografía: Inter ──────────────────────────────────────────────────────────
// Las fuentes Inter reales se cargan en app/_layout.tsx (useFonts de expo-font,
// A.1), registrando los pesos 400/500/600/700 bajo los nombres de familia que el
// `face` de abajo espera (`Inter`, `Inter-Medium`, `Inter-SemiBold`, `Inter-Bold`).
//
// `family` = familia base (peso 400). En native RN el fontFamily debe ser un
// nombre de familia REAL (no una lista CSS con comas, que se interpretaría literal),
// por eso es solo 'Inter'. Por peso, el `face` pisa esta base con la familia exacta.
const interFont = createFont({
  family: 'Inter',
  size: {
    1: 11,
    2: 12,
    3: 13,
    4: 14, // body base
    true: 14,
    5: 16,
    6: 18,
    7: 20,
    8: 23,
    9: 30,
    10: 38, // display / headlines
  },
  lineHeight: {
    1: 16,
    2: 17,
    3: 18,
    4: 20,
    true: 20,
    5: 22,
    6: 25,
    7: 28,
    8: 31,
    9: 38,
    10: 46,
  },
  weight: {
    1: '400', // body
    4: '400',
    5: '500', // labels
    6: '600', // subheadings / card titles
    7: '700', // display / headlines
  },
  face: {
    // Mapeo de peso → nombre de familia, para cuando se carguen las fuentes Inter.
    400: { normal: 'Inter' },
    500: { normal: 'Inter-Medium' },
    600: { normal: 'Inter-SemiBold' },
    700: { normal: 'Inter-Bold' },
  },
});

export const config = createTamagui({
  ...defaultConfig,
  tokens,
  fonts: {
    ...defaultConfig.fonts,
    heading: interFont,
    body: interFont,
  },
  settings: {
    ...defaultConfig.settings,
    // Permitimos props largas (backgroundColor, marginTop, alignItems…) además de
    // las shorthands. Las pantallas hand-crafted (ADR-023) son más legibles con la
    // forma larga; el default v4 las prohibía (onlyAllowShorthands: true).
    onlyAllowShorthands: false,
  },
});

export type AppConfig = typeof config;

// Habilita el tipado fuerte de tokens en toda la app (props como $primary, $4...).
declare module '@tamagui/core' {
  interface TamaguiCustomConfig extends AppConfig {}
}

export default config;
