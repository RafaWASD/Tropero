// Lógica PURA de los EDGE CASES diferidos de la IDENTIFICACIÓN en MODO MANIOBRAS (spec 03 M2.1-edge).
// Sin RN, sin red, sin supabase-js, sin PowerSync: testeable con node:test (mismo patrón que
// maniobra-identify.ts / maneuver-gating.ts). Acá viven las decisiones de los 3 edge cases que
// M2.1-core dejó diferidos (estado seguro, sin UI):
//
//   - R4.2 — desambiguación MANUAL multi-candidato (caravana visual duplicada): el operario elige UN
//            candidato de la lista (no se auto-elige). La SELECCIÓN del candidato es trivial (lo elige
//            el operario tocando una fila), pero la INFO que distingue a cada candidato la prepara este
//            módulo (`candidateDistinguisher`) para que la UI no improvise jerarquía.
//   - R4.4 — animal de OTRO RODEO del MISMO establecimiento (mismo sistema): tras un `found`, si el
//            rodeo REAL del animal difiere del rodeo de la sesión, NO se carga directo (el tenant-check
//            del DB rechazaría el evento con 23514: "una sesión = un rodeo"). Se decide acá si hay
//            mismatch (`isOtherRodeo`) y si el cambio de rodeo de jornada es ofrecible (mismo sistema,
//            `canChangeSessionRodeo`).
//   - R4.7 — heurística "rodeo de jornada mal elegido": si los primeros N animales CONSECUTIVOS de la
//            jornada pertenecen todos a un MISMO rodeo distinto al de la sesión, se sugiere cambiar el
//            rodeo de la jornada en vez de mover los animales uno por uno (prevención de error, Nielsen
//            #5). El tracker (`pushSeenRodeo` / `shouldWarnMisconfiguredRodeo`) es un reducer PURO.

// ─── R4.7 — umbral configurable (default 3 consecutivos) ───────────────────────────────────────
//
// Constante, NO mágica: el leader pidió dejarlo configurable. 3 = "casi todos los primeros animales son
// de otro rodeo" sin frenar la fila por un único bastoneo accidental de un animal de otro rodeo.
export const MISCONFIGURED_RODEO_THRESHOLD = 3;

// ─── R4.4 — animal de otro rodeo del mismo establecimiento ─────────────────────────────────────

/** El rodeo REAL de un animal identificado (lo que la carga rápida resuelve por `animal_profiles.rodeo_id`). */
export type AnimalRodeo = {
  /** rodeo_id del perfil activo. */
  rodeoId: string;
  /** name legible del rodeo (para el aviso "vas a sacarlo de <rodeo origen>"). */
  rodeoName: string;
  /** system_id del rodeo del animal (para validar el mismo-sistema del cambio de rodeo, spec 02 R4.5.1). */
  systemId: string;
};

/** El rodeo de la SESIÓN (la jornada). */
export type SessionRodeo = {
  rodeoId: string;
  systemId: string;
};

/**
 * ¿El animal identificado está en OTRO rodeo del mismo establecimiento que el de la sesión? (PURA, R4.4).
 * Compara el rodeo REAL del animal contra el de la sesión. Si coinciden → camino feliz (carga directa).
 * Si difieren → R4.4: hay que avisar + ofrecer cambiar el rodeo de la jornada / saltar (el tenant-check
 * del DB rechazaría el evento, "una sesión = un rodeo", §4 design).
 *
 * NOTA: tanto el animal como la sesión son del MISMO establecimiento acá — el "otro establecimiento" lo
 * resuelve M2.1-core ANTES (outcome `other_establishment`, R4.5), nunca llega un `found` cross-tenant.
 */
export function isOtherRodeo(animal: AnimalRodeo, session: SessionRodeo): boolean {
  return animal.rodeoId !== session.rodeoId;
}

/**
 * ¿Se puede ofrecer cambiar el rodeo de la JORNADA al rodeo del animal? (PURA, R4.4). Solo si es del MISMO
 * sistema productivo que el de la sesión (el move-de-rodeo de spec 02 R4.5.1 exige mismo sistema; cambiar
 * la jornada a un rodeo de OTRO sistema rompería el gating de las maniobras ya elegidas). Si los sistemas
 * difieren, la UI ofrece SOLO "saltar" (no el cambio de rodeo) — el animal no se puede cargar en esta
 * jornada sin un wizard de otro sistema, fuera de alcance del MVP.
 */
export function canChangeSessionRodeo(animal: AnimalRodeo, session: SessionRodeo): boolean {
  return isOtherRodeo(animal, session) && animal.systemId === session.systemId;
}

// ─── R4.7 — heurística de rodeo de jornada mal elegido (tracker PURO) ──────────────────────────
//
// Lleva la racha de rodeos de los animales identificados, para detectar "los primeros ~3 consecutivos son
// de OTRO rodeo distinto al de la sesión". Es un reducer PURO: la pantalla guarda el estado y lo va
// empujando con cada animal identificado (found). NO cuenta los animales del rodeo correcto (esos rompen
// la racha → resetean), ni los saltados de otro establecimiento (no entran a esta heurística).

/** Estado del tracker de la racha de otro-rodeo (R4.7). Se persiste en el state de la pantalla. */
export type SeenRodeoStreak = {
  /** El rodeo de la racha en curso (todos los consecutivos vistos fueron de ESTE rodeo distinto al de la sesión). */
  streakRodeoId: string | null;
  /** name del rodeo de la racha (para el copy del aviso). */
  streakRodeoName: string | null;
  /** Cantidad de animales consecutivos vistos de `streakRodeoId` (distinto al de la sesión). */
  streakCount: number;
  /** ¿Ya se mostró (y descartó) el aviso para esta racha? Para no re-abrirlo en cada bastoneo. */
  dismissed: boolean;
};

/** Estado inicial del tracker (sin animales vistos aún). */
export function emptyStreak(): SeenRodeoStreak {
  return { streakRodeoId: null, streakRodeoName: null, streakCount: 0, dismissed: false };
}

/**
 * Empuja el rodeo de un animal identificado a la racha (PURA, R4.7). Reglas:
 *   - rodeo del animal == rodeo de la SESIÓN → ROMPE la racha (el operario está cargando bien) → reset.
 *   - rodeo del animal == el de la racha en curso → incrementa la racha.
 *   - rodeo del animal != el de la racha → ARRANCA una racha nueva con ese rodeo (count=1).
 * Cambiar el rodeo de la racha resetea `dismissed` (es una racha nueva → el aviso puede volver a ofrecerse).
 *
 * @param prev          la racha previa.
 * @param animalRodeoId rodeo real del animal recién identificado.
 * @param animalRodeoName name del rodeo (para el copy).
 * @param sessionRodeoId rodeo de la sesión.
 */
export function pushSeenRodeo(
  prev: SeenRodeoStreak,
  animalRodeoId: string,
  animalRodeoName: string,
  sessionRodeoId: string,
): SeenRodeoStreak {
  // El animal está en el rodeo correcto de la jornada → la racha de "otro rodeo" se corta.
  if (animalRodeoId === sessionRodeoId) {
    return emptyStreak();
  }
  // Mismo rodeo que la racha en curso → +1 (preserva dismissed: ya se decidió sobre esta racha).
  if (prev.streakRodeoId === animalRodeoId) {
    return { ...prev, streakRodeoName: animalRodeoName, streakCount: prev.streakCount + 1 };
  }
  // Otro rodeo (distinto al de la sesión y al de la racha) → arranca racha nueva (dismissed reseteado).
  return {
    streakRodeoId: animalRodeoId,
    streakRodeoName: animalRodeoName,
    streakCount: 1,
    dismissed: false,
  };
}

/** Marca la racha en curso como descartada (el operario cerró el aviso R4.7). PURA. */
export function dismissStreak(prev: SeenRodeoStreak): SeenRodeoStreak {
  return { ...prev, dismissed: true };
}

/**
 * ¿Hay que MOSTRAR el aviso de "rodeo de jornada mal elegido"? (PURA, R4.7). True sii la racha alcanzó el
 * umbral, hay un rodeo de racha, y no fue descartada. El aviso es NO-bloqueante: la pantalla lo muestra
 * como banner/sheet dismissable; no frena la identificación.
 *
 * @param streak   la racha en curso.
 * @param threshold umbral (default MISCONFIGURED_RODEO_THRESHOLD = 3).
 */
export function shouldWarnMisconfiguredRodeo(
  streak: SeenRodeoStreak,
  threshold: number = MISCONFIGURED_RODEO_THRESHOLD,
): boolean {
  return (
    streak.streakRodeoId !== null &&
    !streak.dismissed &&
    streak.streakCount >= threshold
  );
}

// ─── R4.2 — info que distingue a cada candidato del picker ─────────────────────────────────────
//
// Cuando la búsqueda manual por visual devuelve >1 candidato, el operario elige UNO de la lista. La
// selección es trivial (toca la fila), pero la INFO que distingue a cada candidato (qué los hace
// diferentes a simple vista) la prepara este helper para que la UI presente una jerarquía consistente
// con el header de identidad de la carga (visual > electrónico): la caravana visual DOMINA, rodeo +
// categoría son el secundario distintivo, el tag electrónico es la confirmación fina (si lo tiene).

/** Un candidato del picker de desambiguación (R4.2): lo que distingue a un animal de otro a la vista. */
export type DisambiguationCandidate = {
  profileId: string;
  /** Nombre/Apodo (delta IDU: reemplaza visual_id_alt). El identificador humano DOMINANTE (lo que lee). */
  apodo: string | null;
  /** idv (caravana visual alfanumérica) — fallback de identidad si no hay apodo. */
  idv: string | null;
  /** Caravana electrónica (tag) — la confirmación fina; única global → desempata sin ambigüedad. */
  tagElectronic: string | null;
  /** Rodeo del animal — distintivo secundario (dos "0385" pueden estar en rodeos distintos). */
  rodeoName: string;
  /** Categoría del animal — distintivo secundario (vaquillona vs multípara). */
  categoryName: string;
};

/**
 * Texto DOMINANTE de un candidato (PURA, R4.2): el nombre humano que el operario LEE (apodo > idv, lo deja
 * crudo el caller), consistente con `displayIdentity` de la carga (apodo > idv > tag). Acá NO formateamos el
 * EID (eso lo hace la UI con formatEidReadable si cae al tag); devolvemos el apodo o el idv, o null si no hay
 * ninguno de los dos (caso raro: el caller mostrará el tag).
 */
export function candidateDominantId(c: DisambiguationCandidate): string | null {
  if (c.apodo) return c.apodo;
  if (c.idv) return c.idv;
  return null;
}

/**
 * Línea secundaria DISTINTIVA de un candidato (PURA, R4.2): lo que diferencia dos animales con la MISMA
 * caravana visual (el caso exacto de R4.2 — el visual está duplicado por definición). Incluye:
 *   - el N° interno (idv) cuando existe Y no es ya el dominante (si el visual domina, el idv los desempata
 *     aunque compartan rodeo y categoría — es el dato único por establecimiento);
 *   - el rodeo y la categoría (un "0385" puede estar en rodeos/categorías distintos).
 * Omite las partes vacías y las une con " · " (es-AR, mismo idiom que la cola de maniobras del header).
 * Devuelve '' si no hay nada que mostrar (el caller decide el copy).
 *
 * Por qué el idv acá y no como dominante: el dominante es la caravana visual HUMANA (lo que el operario
 * lee en la oreja, displayIdentity); cuando ESA está duplicada (R4.2), el idv interno es el desempate fino.
 */
export function candidateDistinguisher(c: DisambiguationCandidate): string {
  const dominant = candidateDominantId(c);
  const parts: string[] = [];
  // El idv solo aporta si existe y NO es ya el dominante (si el visual está vacío, el idv ya domina).
  if (c.idv && c.idv !== dominant) parts.push(`N° ${c.idv}`);
  parts.push(c.rodeoName, c.categoryName);
  return parts.filter((p) => p && p.trim().length > 0).join(' · ');
}
