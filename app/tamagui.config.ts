// tamagui.config.ts — RAFAQ design tokens (FUENTE ÚNICA CANÓNICA)
//
// Este archivo ES la fuente única canónica de tokens del frontend (ADR-023 §1):
// color, spacing, tipografía, radios, touch-targets y elevación. Su LECTURA
// HUMANA es docs/design-system.md (design system v4 canónico) — si hay conflicto
// entre ese doc y este archivo, gana el código.
//
// Los valores de acá SON el v4 canónico: se derivaron de construir la home + el
// bottom-nav a mano (las pantallas que Raf firmó), no en abstracto (ADR-023 §5).
// Crece JIT: cuando una pantalla nueva necesite un token que no existe, se agrega
// entonces — no se inventa por adelantado.
//
// Regla dura (ADR-023 §4): las PANTALLAS no hardcodean color/spacing. Todo valor
// visual referencia un token de acá (ej. backgroundColor="$primary",
// padding="$4", borderRadius="$card"); los valores que cruzan a APIs no-Tamagui
// se leen con getTokenValue('$token', grupo). Este archivo es la ÚNICA fuente
// literal de hex/px del frontend — lo garantiza el lint scripts/check-hardcode.mjs.
//
// Stack: ADR-013 (Tamagui v2). Base = defaultConfig de @tamagui/config/v4
// (scales space/size/zIndex/radius + themes default de componentes), sobre la
// que montamos el color brand + la tipografía Inter + tokens semánticos.

import { createFont, createTamagui, createTokens } from '@tamagui/core';
import { defaultConfig } from '@tamagui/config/v4';

// ─── Paleta canónica (design system v4) ───────────────────────────────────────
// Único lugar del frontend donde viven los hex literales.
const palette = {
  // Fondos base: blanco neutro, sin tinte frío ni cálido.
  white: '#FFFFFF',
  bg: '#faf9f9', // fondo base de la app (neutro)
  // Brand.
  primary: '#1e5a3e', // verde botella — brand primary + FAB + item activo
  primaryPress: '#184a33', // estado pressed del primary (derivado)
  // Verde botella CLARO (derivado, +luminosidad sobre primary): tono superior del
  // gradiente del banner de EstablishmentCard. Mismo hue brand, no el greenLight
  // desaturado (ese es para halos/contenedores). Da un degradé visible, no un bloque
  // plano. JIT: lo necesitó el banner-strip de "Mis campos".
  primaryLight: '#2e8259',
  // Surfaces.
  surface: '#F8F6F1', // bone — surface de cards (cálido, solo para cards)
  // Acentos.
  terracota: '#C0451F', // alertas / tertiary (contraste AA 4.86 sobre $bg; fix WCAG)
  // Ámbar de "espera/pausa" — bloque DIFERIDA del tacto vaquillona (spec 03 M3.2a, 🔴 manga). JIT,
  // provisional (a canonizar al aprobar la dirección, mismo patrón que heroScan/StickIcon de M2.1).
  // El tacto vaquillona tiene 3 resultados (apta/no_apta/diferida) que necesitan 3 colores INEQUÍVOCOS a
  // pleno sol con guante: verde botella ($primary) = APTA, terracota ($terracota) = NO APTA, y este ÁMBAR
  // = DIFERIDA (semántica universal de "pausa/espera/posponer", distinto de verde/rojo). Tono oscuro y
  // saturado (no pastel) para que el bloque LLENE con peso visual igual que los otros dos y el texto
  // BLANCO encima contraste bien (#9A6206 sobre blanco = 5.0:1, AA). NO se usa "neutro/gris" porque sobre
  // los 2 bloques vivos se leería como "deshabilitado" — ambigüedad fatal en manga.
  amber: '#9A6206', // DIFERIDA — ámbar oscuro (texto blanco encima ≈ 5.0:1 AA)
  amberPress: '#7E5005', // estado pressed del amber (derivado, más oscuro)
  // Par AMBER de la marca de DESCARTE CUT (delta spec 02, RCUT.6 / ADR-023 §4). Espejo del par del badge
  // verde ($primary texto / $greenLight fondo): el badge CUT se pinta amarillo para que el descarte se lea
  // de un vistazo (no verde como el resto). NO se reusa $amber (semántica DIFERIDA + texto blanco encima, y
  // su #9A6206 da <4.5:1 sobre un amber pálido). Contraste MEDIDO (WCAG 2.1 relative-luminance):
  //   cutText #855300 sobre cutBg #FBE6AE = 5.27:1 (≥4.5 ✅) — supera la referencia verde (4.55:1).
  //   cutText #855300 sobre blanco #FFFFFF = 6.49:1 (≥4.5 ✅).
  cutText: '#855300', // amber oscuro — TEXTO del badge CUT (y del ícono/afordancia de la ficha)
  cutBg: '#FBE6AE', // amber pálido — FONDO del badge CUT (inequívoco vs el $greenLight #93cfac)
  greenLight: '#93cfac', // verde claro — icon containers + halo del FAB
  // Halo del FAB (ADR-018): greenLight (#93cfac = rgb(147,207,172)) al 45% de alpha.
  // Es el MISMO verde claro translúcido — se expone como token de color propio para
  // que el bottom-nav lo referencie ($fabHalo) en vez de hardcodear la rgba (ADR-023
  // §4). RN/Tamagui no derivan alpha de un token de color, así que el rgba se escribe
  // acá (única fuente literal) atado por comentario a greenLight.
  fabHalo: 'rgba(147, 207, 172, 0.45)',
  // Scrim de modales/bottom-sheets (spec 10, sheet de confirmación de la selección masiva): el negro de
  // marca textPrimary (#0F0E0C = rgb(15,14,12)) al 45% de alpha. Es el MISMO negro translúcido — se expone
  // como token de color propio para que el sheet lo referencie ($scrim) en vez de hardcodear la rgba
  // (ADR-023 §4). RN/Tamagui no derivan alpha de un token de color, así que la rgba se escribe acá (única
  // fuente literal) atada por comentario a textPrimary. JIT: lo necesitó el bottom-sheet de spec 10.
  scrim: 'rgba(15, 14, 12, 0.45)',
  // Texto.
  textPrimary: '#0F0E0C', // negro
  textMuted: '#5C655F', // gris (labels secundarios, items inactivos del nav) — AA 5.74 sobre $bg (fix WCAG)
  textFaint: '#807A74', // gris terciario — AA-large 4.03 sobre $bg (fix WCAG)
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
    primaryLight: palette.primaryLight,
    surface: palette.surface,
    terracota: palette.terracota,
    amber: palette.amber, // DIFERIDA del tacto vaquillona (spec 03 M3.2a) — ámbar de "espera/pausa"
    amberPress: palette.amberPress,
    cutText: palette.cutText, // delta spec 02 (RCUT.6): TEXTO del badge CUT (descarte) — amber oscuro, 5.27:1
    cutBg: palette.cutBg, // delta spec 02 (RCUT.6): FONDO del badge CUT — amber pálido (espejo $greenLight)
    greenLight: palette.greenLight,
    fabHalo: palette.fabHalo, // verde claro translúcido del halo del FAB (= greenLight @ 45%)
    scrim: palette.scrim, // negro translúcido del scrim de modales/sheets (= textPrimary @ 45%)
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
    fabHalo: FAB_SIZE + 16, // = 80: diámetro efectivo del anillo (referencia del inset)
    // Inset (magnitud positiva) del anillo del halo respecto al círculo del FAB.
    // DERIVADO de la geometría: (fabHalo - fab) / 2 = (80 - 64) / 2 = 8 → el anillo
    // se monta como hijo absoluto con top/left/right/bottom = -fabHaloInset (asoma 8px
    // de verde claro alrededor del círculo de 64). La pantalla lo lee con getTokenValue
    // y aplica el signo negativo, así NO hardcodea el -8 (ADR-023 §4).
    fabHaloInset: (FAB_SIZE + 16 - FAB_SIZE) / 2, // = 8
    // Tamaño de los íconos del bottom-nav (lucide Home/PawPrint/BarChart3/Menu). Cruza
    // a una API no-Tamagui (prop `size` de lucide-react-native), se lee con getTokenValue.
    navIcon: 24,
    // Tamaño del ícono ⚡ (Zap) dentro del FAB central.
    fabIcon: 28,
    // Padding superior de cada item del bottom-nav (separa ícono del borde de la barra).
    navItemTop: 2,
    // Tamaño de fuente del label de los 4 items planos del nav (= font.size.$1 = 11px;
    // micro-label bajo el ícono). Cruza a la API no-Tamagui tabBarLabelStyle de React
    // Navigation (que pide un número), por eso vive como token de size leído con
    // getTokenValue, no como literal en la pantalla.
    navLabel: 11,
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
    // ── EstablishmentCard ("Mis campos", R6.6.2) — JIT, derivados al construir la card.
    // Banner-strip slim de arriba: ni full-screen ni thumbnail chico (~72-80px). 72 da
    // aire para la inicial grande ($10) sin robarle protagonismo al nombre hero, y
    // aprieta la densidad a ~4-5 cards por pantalla (densidad media) — bajado de 76 → 72
    // en el pulido (re-vet iter-4): banner un toque más slim sin perder el gradiente.
    bannerStrip: 72,
    // Punto del indicador "● activo" del campo activo.
    dot: 8,
    // Tamaño de fuente del input del searchbar de "Mis campos" (R6.6.1). Espeja el
    // font.size.$5 (16px, "body grande / inputs" del design system v4), pero vive como
    // token de `size` porque cruza a una API no-Tamagui (el `style.fontSize` del
    // <TextInput> de RN, que pide un número) y se lee con getTokenValue — mismo patrón
    // que `navLabel` (font size del nav que cruza a tabBarLabelStyle). No es literal en
    // la pantalla. JIT: lo necesitó el searchbar.
    inputText: 16,
    // Ancho de la card del dropdown del switch de establecimiento (R6.8.1). Menú anclado
    // arriba-izquierda bajo el header: ancho cómodo para nombres de campo + "Ver todos
    // mis campos" sin truncar, sin invadir todo el viewport (maxWidth:100% lo recorta en
    // pantallas angostas). JIT: lo necesitó el dropdown del switch.
    dropdownWidth: 280,
    // ── Tab "Animales" (BUSCAR ANIMAL, spec 09 R1) — JIT, derivados al construir la
    // pantalla 🔴 manga-crítica. Alto mínimo de la fila de un animal (AnimalRow): 72px
    // da un target cómodo con guante (Fitts) para el avatar 48 + dos líneas de texto +
    // chevron/chip, más alto que la fila web típica (uso en manga, manga-friendly).
    animalRow: 72,
    // Alto del buscador permanente de Animales (R1.2). Por ser 🔴 manga-crítico es más
    // grande que el de "Mis campos" (que usa el patrón pill estándar): pill XL ≥56px
    // (= touchMin) para tipear con una mano a pleno sol. Mismo valor que touchMin pero
    // token propio semántico (es un buscador, no un botón) → JIT lo necesitó la pantalla.
    searchBarLg: 56,
    // Alto mínimo de los chips de filtro (R1.5: Rodeo/Estado/Sin caravana). ≥40px para
    // target tappable cómodo sin robarle altura a la lista (un escalón bajo touchMin).
    chipMin: 40,
    // ── Modo `assign_or_create` del bottom-sheet (spec 09 chunk dedup, RD3.3) — JIT, 🔴 manga-crítico.
    // Tope de alto del scroll de candidatos sin caravana DENTRO del sheet (que ya tiene maxHeight 85% del
    // viewport): acota la lista a ~3-4 candidatos visibles para que el buscador (arriba) y el CTA "es nuevo"
    // (abajo, ≥touchMin, Fitts) queden SIEMPRE a la vista — una decisión por pantalla, operable con una
    // mano a pleno sol. El resto de candidatos se scrollea / se filtra con el buscador. JIT lo necesitó
    // el AssignOrCreateBody.
    candidateListMax: 300,
    // ── Toggle de la plantilla de datos del rodeo (spec 02 C1, ADR-021) — JIT.
    // Control propio (no hay primitivo Switch en la base v4). Pista pill + thumb circular blanco.
    // toggleTrack = ancho de la pista; toggleThumb = alto de la pista (= diámetro visual); knob =
    // diámetro del thumb interno (un toque menor que la pista para que asome el padding $1=2px).
    // El TAP target real lo da la fila completa (≥touchMin), así que la pista puede ser compacta.
    toggleTrack: 48,
    toggleThumb: 28,
    toggleKnob: 24,
    // Alto de cada segmento de la barra de progreso del wizard "Crear rodeo" (spec 02 C1). Barra
    // fina (estilo onboarding) — JIT lo necesitó el wizard.
    progressTrack: 6,
    // ── HERO de escaneo de MODO MANIOBRAS (spec 03 M2.1, identificación del animal) — JIT, 🔴 manga-crítico.
    // El escaneo del bastón es el 95% del flujo (manos ocupadas, no hay que tocar nada): el hero es el
    // elemento DOMINANTE de la pantalla y tiene que leerse a metros, a pleno sol. Es un "target" pasivo
    // (no se toca: el target real es el animal), así que NO sigue la escala de touch-targets — sigue la
    // escala de figura-fondo (Gestalt). Tres tokens derivados del disco del pulso:
    //   heroScan  = diámetro del disco/anillo de escaneo (el contenedor del pulso). 200 da una figura
    //               grande y calma que domina el tercio central sin tocar el header ni la zona del pulgar.
    //   heroRing  = grosor del anillo de "escuchando" (el borde que pulsa). Derivado para que el anillo
    //               se lea como onda, no como un borde fino.
    //   heroIcon  = tamaño del ícono del bastón (StickIcon) dentro del disco. ~40% del disco → el glifo
    //               se reconoce de un vistazo sin llenar el círculo (deja aire para el pulso).
    heroScan: 200,
    heroRing: 8,
    heroIcon: 80,
    // ── STEPPER de CONDICIÓN CORPORAL (spec 03 M3.2a, R6.6) — JIT, 🔴 manga-crítico. Los botones − / +
    // del stepper se tocan con guante a velocidad de manga → target GIGANTE, muy por encima del piso de
    // 56px (touchMin) y del ≥80px que pide la dirección del leader. 88 da un cuadrado cómodo que el pulgar
    // no erra, deja el VALOR hero ($11=64px) dominando el centro, y entra holgado a los lados en 412px de
    // ancho. Cuadrado (width=height=stepperBtn) para que − y + se lean simétricos. Es un touch-target, no
    // sigue la escala de figura-fondo del heroScan.
    stepperBtn: 88,
    // ── NÚMERO DE TUBO de lab (spec 03 M3.2b, R6.4/R6.11 sangrado/raspado) — JIT, 🔴 manga-crítico. El
    // tube_number se tipea en un input de texto (alfanumérico, no keypad — la columna es `text`) pero se
    // muestra GRANDE para leerlo de un vistazo al rotular el tubo en la mano: ~24px (un escalón sobre el
    // $inputText=16 estándar) sin llegar al hero numérico del peso ($11=64) — es un código corto, no un
    // valor de medición. Cruza al style.fontSize del <TextInput> de RN (pide número) → token de size leído
    // con getTokenValue, mismo patrón que inputText/navLabel. NO se le aplica formato es-AR (código de máquina).
    tubeText: 24,
    // Indicador de progreso de jornada en el header SLIM ("12 hoy"): el punto/dot del chip de contador.
    // Reusa $dot=8 para la marca; no necesita token propio.
  },
});

// ─── Elevación / sombra (canónico) ────────────────────────────────────────────
// Tamagui v4 NO expone tokens de sombra (shadowColor/Offset/etc. son props de
// estilo, no un token escalar), así que la elevación se centraliza como OBJETOS
// de estilo exportados en vez de tokens `$`. Siguen siendo la única fuente del
// valor: las pantallas/componentes los importan (Card → shadows.card; el FAB del
// bottom-nav → shadows.fab), NO hardcodean los valores. Hay dos niveles porque la
// home + el nav los necesitaron; si hace falta más elevación se agrega JIT
// (eventual sistema elevation.1/2/3).
export const shadows = {
  // Sombra suave de cards (card de fondo bone sobre bg neutro).
  card: {
    shadowColor: palette.textPrimary, // negro de marca, no #000 puro
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2, // Android
  },
  // Sombra del FAB central elevado (ADR-018): más marcada y teñida de verde para
  // que el botón "flote" sobre la barra blanca. shadowColor = $primary (verde
  // botella de marca, no #000 puro).
  fab: {
    shadowColor: palette.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6, // Android
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
    // Hero number GIGANTE (monto dominante estilo Cash App). JIT: lo necesitó el display de PESO de
    // paso.tsx (spec 03 M2.0) — el valor que el operario carga y verifica (R12.4) tiene que ser el
    // elemento MÁS grande de la pantalla, dominante sobre las teclas del teclado ($10=38px). 64px lo
    // separa claramente del resto de la escala (no es un "headline más", es EL número).
    11: 64, // hero number / monto dominante
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
    11: 72, // matching del hero number $11 (64px) — evita recorte de descendentes
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
