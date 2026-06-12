// Lógica PURA del wizard de "primeros pasos" (onboarding) de la home (spec 01 / spec 10). SIN I/O,
// SIN imports de RN/expo/supabase: testeable con node:test (mismo patrón que utils/management-group.ts,
// utils/establishment.ts). El estado real (rodeo / animales / equipo) lo computa la home (index.tsx)
// desde sus contextos + conteos; acá solo decidimos si el wizard ya cumplió su función.

/** Estado de los 3 pasos del wizard de arranque, tal como los conoce la home. */
export type OnboardingSteps = {
  /** El campo tiene ≥1 rodeo configurado. En la home SIEMPRE true (el RootGate lo garantiza). */
  rodeoDone: boolean;
  /**
   * El campo tiene ≥1 animal. `null` = "todavía no sabemos" (el count aún no resolvió): patrón
   * anti-parpadeo — NO afirmamos "hecho" con información incompleta.
   */
  hasAnimals: boolean | null;
  /**
   * El equipo está en marcha (≥1 otro miembro o ≥1 invitación pendiente, o el usuario es no-owner).
   * Ya viene resuelto a boolean por la home (su `null` interno se trata conservadoramente como false).
   */
  teamStarted: boolean;
};

/**
 * ¿Están los 3 pasos del onboarding CONFIRMADOS done? PURA.
 *
 * Criterio CONSERVADOR (anti-parpadeo): solo true cuando los tres están confirmados. `hasAnimals`
 * exige el valor `true` explícito — `null` ("todavía no sabemos") NO cuenta como hecho, para no
 * afirmar "completo" con información incompleta (un flash al cargar). La home usa esto para OCULTAR
 * el wizard: un usuario ya-onboardeado no lo ve; uno nuevo (o con un paso pendiente, o mientras el
 * count carga) sí.
 */
export function allOnboardingStepsDone(steps: OnboardingSteps): boolean {
  return steps.rodeoDone && steps.hasAnimals === true && steps.teamStarted;
}
