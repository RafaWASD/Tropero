// nav.ts — helpers de navegación robustos sobre Expo Router.
//
// POR QUÉ EXISTE (bug de navegación que Raf vio en `pnpm web`):
//   Un `router.back()` "pelado" asume que SIEMPRE hay una pantalla previa en el stack. No es así:
//   en WEB, recargar la página o un hot-reload de Metro RESETEAN el historial de navegación a la
//   ruta actual → el stack queda con UNA sola entrada y `router.back()` NO tiene a dónde ir; falla
//   silenciosamente y deja al usuario TRABADO (consola: "The action 'GO_BACK' was not handled by
//   any navigator. Is there any screen to go back to?"). NO es solo de DEV: el mismo stack-vacío
//   pasa con un deep-link o un cold-start que aterriza directo en una ruta profunda (las rutas de
//   RAFAQ son un Stack plano — `animal/[id]`, `agregar-evento`, `crear-animal` son hermanas en
//   `app/_layout.tsx` → sin pantalla previa no hay fallback automático).
//
// El patrón robusto: si se PUEDE volver (`router.canGoBack()`), `router.back()` (preserva la
// navegación natural, p. ej. el caso normal y el de la suite E2E); si NO, `router.replace(fallback)`
// hacia una ruta conocida y segura. Así "Volver"/"Guardar evento" nunca dejan al usuario varado.
//
// PURO respecto de React/RN (no usa hooks ni estado): recibe el `router` ya resuelto + el destino.
// `router` se tipa con `ImperativeRouter` (lo que devuelve `useRouter()` de expo-router) y `fallback`
// con `Href` (el tipo de ruta de expo-router) — sin `any`, así el destino se valida contra el typed
// routing del proyecto.

import type { Href, ImperativeRouter } from 'expo-router';

/**
 * Vuelve a la pantalla previa si el stack lo permite; si no (stack vacío por web-refresh / hot-reload
 * / deep-link / cold-start en ruta profunda), reemplaza por una ruta de `fallback` conocida.
 *
 * Usamos `replace` (no `push`) en el fallback: NO queremos APILAR el fallback sobre la ruta actual
 * (eso dejaría la pantalla de origen en el back-stack y volvería a confundir el "volver"); lo
 * correcto es REEMPLAZAR la ruta huérfana por el destino seguro.
 */
export function backOr(router: ImperativeRouter, fallback: Href): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}
