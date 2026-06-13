// Formato LEGIBLE del EID bastoneado (spec 09 chunk BLE global, RB3.2). PURO (sin RN/I-O):
// testeable con node:test. La confirmación visual pre-commit (RB3.2) es la integridad de la
// declaración SENASA — el operario verifica de un vistazo que leyó la caravana correcta, con UNA
// mano y a pleno sol. Un string de 15 dígitos corridos es ilegible; lo agrupamos.
//
// EID FDX-B (ISO 11784/11785, 15 dígitos): 3 dígitos de prefijo (país/fabricante) + 12 de
// identificación nacional. Agrupamos como "PPP NNNN NNNN NNNN" (prefijo + 3 grupos de 4) para que
// el ojo pueda saltar grupo a grupo. Si el input NO son 15 dígitos (no debería pasar — el provider
// solo entrega EIDs validados por isValidTag), devolvemos el string tal cual (nunca rompe ni oculta
// el dato: defensa de borde para un deep-link/test malformado).

/**
 * Agrupa un EID de 15 dígitos como "PPP NNNN NNNN NNNN" (3 + 4 + 4 + 4) para lectura de manga.
 * Cualquier otro shape se devuelve sin tocar (defensivo: el provider ya valida 15 dígitos).
 */
export function formatEidReadable(eid: string): string {
  if (typeof eid !== 'string' || !/^\d{15}$/.test(eid)) return typeof eid === 'string' ? eid : '';
  const prefix = eid.slice(0, 3);
  const rest = eid.slice(3); // 12 dígitos
  return `${prefix} ${rest.slice(0, 4)} ${rest.slice(4, 8)} ${rest.slice(8, 12)}`;
}
