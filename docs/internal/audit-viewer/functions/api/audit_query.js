// docs/internal/audit-viewer/functions/api/audit_query.js
// Cloudflare Pages Function — proxy same-origin del visor de auditoría interno (staff miTropero).
//
// Rol: reenviar a la Edge Function `audit_query` (Supabase) el JWT de Cloudflare Access (que Access
// inyecta server-side) + el body crudo del POST. La autorización REAL la hace la EF verificando ese JWT
// criptográficamente (RCFA.2.x). Esta Function NO tiene lógica de negocio ni valida filtros.
//
// Por qué existe (design §0): la cookie de Access (`CF_Authorization`) es HttpOnly → el JS del browser no
// la lee, y la EF vive en otro dominio (`*.supabase.co`) → el browser no reenvía el token cross-dominio.
// Esta Function corre en el MISMO dominio del visor, detrás del MISMO Access, así que recibe el
// `Cf-Access-Jwt-Assertion` inyectado y lo reenvía. La web nunca ve el JWT.
//
// Secretos: SOLO `MITROPERO_AUDIT_PROXY_SECRET` (§6-bis, Gate 1 M-1) — secreto compartido Function↔EF que
// la EF exige ANTES de verificar el JWT (belt-and-suspenders si un bug futuro rompe la verificación +
// rechazo barato del flood no autenticado / Denial-of-Wallet). `MITROPERO_AUDIT_EF_URL` es un binding
// público (la URL de la EF), no un secreto.
//
// Ruteo por método: exportar SOLO `onRequestPost` ⇒ cualquier otro método lo responde Pages con 405 sin
// invocar este handler (RCFA.1.1).
export async function onRequestPost(context) {
  const { request, env } = context;

  // Access inyecta este header server-side en TODO request que pasa por su policy; un cliente no puede
  // spoofearlo (Access lo sobreescribe). Ausente ⇒ alguien pegó sin pasar Access → 401 sin llamar a la EF.
  // (RCFA.1.2)
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!assertion) {
    return new Response(
      JSON.stringify({ error: { code: 'unauthorized', message: 'Sin acceso.' } }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Body crudo: se reenvía sin parsear ni confiar en él (la EF valida los filtros server-side). (RCFA.1.3)
  const body = await request.text();

  const efUrl = env.MITROPERO_AUDIT_EF_URL; // binding público de Pages: URL de la EF audit_query

  // Los ÚNICOS headers que se mandan a la EF: Content-Type + el JWT de Access (única entrada de confianza,
  // RCFA.1.6) + el proxy secret. NINGÚN otro header del cliente se propaga.
  const headers = {
    'Content-Type': 'application/json',
    'Cf-Access-Jwt-Assertion': assertion,
  };

  // Secreto compartido Function↔EF (§6-bis). Fail-closed: si no está seteado en el env de Pages, no se
  // manda → la EF (que lo exige) responde 401; nunca abre el acceso por omisión.
  const proxySecret = env.MITROPERO_AUDIT_PROXY_SECRET;
  if (proxySecret) {
    headers['X-Mitropero-Proxy-Secret'] = proxySecret;
  }

  const upstream = await fetch(efUrl, { method: 'POST', headers, body });

  // Respuesta de la EF tal cual: status + body, sin transformar. (RCFA.1.4)
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
