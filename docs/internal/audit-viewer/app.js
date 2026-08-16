/*
 * Consola de auditoría interna de miTropero (staff).
 *
 * Seguridad (design §8):
 *   - JWT en memoria (variable JS), NUNCA en localStorage: el cliente supabase-js se crea con
 *     persistSession:false + autoRefreshToken:false.
 *   - TODOS los valores de record / old_record / actor se pintan con textContent (o vía DOM APIs),
 *     JAMÁS con innerHTML → sin XSS almacenado en la consola de staff (LOW-3).
 *   - Filtros SIEMPRE en el body del POST, nunca en la URL (R6.4 / R2.1).
 *   - supabase-js se carga pineado a versión exacta + SRI desde el <script> de index.html (M1).
 */
(function () {
  'use strict';

  // --- Config (público por diseño: URL del proyecto DEV + anon/publishable key) -------------------
  var SUPABASE_URL = 'https://xrhlxxdnfzvdnztacofj.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_iCiWUjiUycJJlHT0XSKs4w_HJ6bdktb';
  var EF_URL = SUPABASE_URL + '/functions/v1/audit_query';

  // Cliente supabase-js SOLO para el login. persistSession:false → el token no toca el storage.
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  // --- Estado (todo en memoria) ------------------------------------------------------------------
  var state = {
    accessToken: null, // JWT en memoria, no persistido
    email: null,
    filters: null,     // filtros de la búsqueda vigente (para "Ver más")
    nextCursor: null,
    displayed: 0,
    busy: false
  };

  // --- Mapas es-AR -------------------------------------------------------------------------------
  var TABLE_LABELS = { user_roles: 'Roles de miembro' };
  var OP_LABELS = { INSERT: 'Alta', UPDATE: 'Cambio', DELETE: 'Baja' };
  var FIELD_LABELS = {
    role: 'Rol',
    active: 'Activo',
    establishment_id: 'Campo',
    user_id: 'Usuario',
    id: 'ID',
    created_by: 'Creado por',
    created_at: 'Creado',
    updated_at: 'Modificado',
    invited_by: 'Invitado por',
    accepted_at: 'Aceptado'
  };
  var ERROR_COPY = {
    method_not_allowed: 'Método no permitido.',
    unauthorized: 'Tu sesión expiró. Ingresá de nuevo.',
    not_staff: 'No tenés acceso a esta herramienta.',
    rate_limited: 'Demasiadas consultas seguidas. Esperá un momento y volvé a intentar.',
    invalid_filter: 'Alguno de los filtros es inválido. Revisá los campos.',
    db_error: 'Ocurrió un error del servidor. Volvé a intentar.',
    unexpected: 'Ocurrió un error inesperado. Volvé a intentar.',
    server_error: 'Ocurrió un error del servidor. Volvé a intentar.'
  };

  // --- Formato de fecha es-AR (dd/mm/aaaa hh:mm, zona Argentina) ----------------------------------
  var DATE_FMT = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  });

  // ===============================================================================================
  // Helpers de DOM
  // ===============================================================================================
  function $(id) { return document.getElementById(id); }

  function el(tag, className) {
    var e = document.createElement(tag);
    if (className) { e.className = className; }
    return e;
  }

  function txtEl(tag, className, text) {
    var e = el(tag, className);
    e.textContent = text;
    return e;
  }

  function clearChildren(node) {
    if (node.replaceChildren) { node.replaceChildren(); return; }
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  // ===============================================================================================
  // Formateo de valores
  // ===============================================================================================
  function formatDate(iso) {
    if (!iso) { return '—'; }
    var d = new Date(iso); // ts es un instante ISO completo (con tz) → new Date es correcto
    if (isNaN(d.getTime())) { return '—'; }
    return DATE_FMT.format(d).replace(', ', ' ');
  }

  function formatValue(v) {
    if (v === null || v === undefined) { return '—'; }
    if (typeof v === 'boolean') { return v ? 'Sí' : 'No'; }
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch (e) { return String(v); }
    }
    return String(v);
  }

  function fieldLabel(key) {
    return Object.prototype.hasOwnProperty.call(FIELD_LABELS, key) ? FIELD_LABELS[key] : key;
  }

  function valuesEqual(a, b) {
    if (a === b) { return true; }
    if (a === null || a === undefined || b === null || b === undefined) { return false; }
    if (typeof a === 'object' || typeof b === 'object') {
      try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
    }
    return false;
  }

  // Convierte un <input type="date"> (yyyy-mm-dd) a ISO usando bordes de día de Argentina (-03:00).
  function dateToIso(dateStr, endOfDay) {
    if (typeof dateStr !== 'string' || dateStr === '') { return null; }
    var suffix = endOfDay ? 'T23:59:59.999-03:00' : 'T00:00:00-03:00';
    var d = new Date(dateStr + suffix);
    if (isNaN(d.getTime())) { return null; }
    return d.toISOString();
  }

  // ===============================================================================================
  // Vistas
  // ===============================================================================================
  function showLogin(message) {
    $('view-console').hidden = true;
    $('view-login').hidden = false;
    if (message) { setLoginError(message); } else { setLoginError(''); }
    var email = $('login-email');
    if (email) { email.focus(); }
  }

  function showConsole() {
    $('view-login').hidden = true;
    $('view-console').hidden = false;
    var who = $('whoami');
    who.textContent = state.email || '';
    setNotice('');
  }

  function setLoginError(msg) {
    var e = $('login-error');
    if (msg) { e.textContent = msg; e.hidden = false; }
    else { e.textContent = ''; e.hidden = true; }
  }

  function setNotice(msg) {
    var n = $('console-notice');
    if (msg) { n.textContent = msg; n.hidden = false; }
    else { n.textContent = ''; n.hidden = true; }
  }

  function setLoading(on) {
    $('loading').hidden = !on;
    $('search').disabled = on;
    $('load-more').disabled = on;
  }

  // ===============================================================================================
  // Auth
  // ===============================================================================================
  function doLogin(email, password) {
    setLoginError('');
    var submit = $('login-submit');
    submit.disabled = true;
    submit.textContent = 'Entrando…';

    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      submit.disabled = false;
      submit.textContent = 'Entrar';
      if (res.error || !res.data || !res.data.session) {
        setLoginError('Email o contraseña incorrectos.');
        return;
      }
      state.accessToken = res.data.session.access_token;
      state.email = (res.data.session.user && res.data.session.user.email) || email;
      // No dejar la contraseña colgando en el DOM.
      $('login-password').value = '';
      showConsole();
    }, function () {
      submit.disabled = false;
      submit.textContent = 'Entrar';
      setLoginError('No se pudo conectar. Revisá tu conexión e intentá de nuevo.');
    });
  }

  function doLogout(message) {
    try { sb.auth.signOut(); } catch (e) { /* best-effort */ }
    state.accessToken = null;
    state.email = null;
    state.filters = null;
    state.nextCursor = null;
    state.displayed = 0;
    clearResults();
    showLogin(message);
  }

  // ===============================================================================================
  // Filtros + fetch a la EF
  // ===============================================================================================
  function val(id) {
    var e = $(id);
    return e ? e.value.trim() : '';
  }

  function collectFilters() {
    var f = {};
    var from = dateToIso(val('f-from'), false); if (from) { f.from = from; }
    var to = dateToIso(val('f-to'), true); if (to) { f.to = to; }
    var uid = val('f-uid'); if (uid) { f.auth_uid = uid; }
    var est = val('f-est'); if (est) { f.establishment_id = est; }
    var req = val('f-req'); if (req) { f.request_id = req; }
    var table = val('f-table'); if (table) { f.table_name = table; }
    var op = val('f-op'); if (op) { f.op = op; }
    return f;
  }

  // POST a la EF. Filtros en el body (NUNCA en la URL). JWT en Authorization, apikey anon.
  function callEf(body) {
    return fetch(EF_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.accessToken,
        'apikey': SUPABASE_ANON_KEY
      },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().then(
        function (data) { return { status: res.status, data: data }; },
        function () { return { status: res.status, data: null }; }
      );
    });
  }

  function runSearch() {
    if (state.busy) { return; }
    state.filters = collectFilters();
    state.nextCursor = null;
    state.displayed = 0;
    clearResults();
    setNotice('');
    fetchPage(false);
  }

  function loadMore() {
    if (state.busy || !state.nextCursor) { return; }
    fetchPage(true);
  }

  function fetchPage(append) {
    state.busy = true;
    setLoading(true);
    $('load-more').hidden = true;

    var body = {};
    var filters = state.filters || {};
    for (var k in filters) {
      if (Object.prototype.hasOwnProperty.call(filters, k)) { body[k] = filters[k]; }
    }
    if (append && state.nextCursor) { body.before = state.nextCursor; }

    callEf(body).then(function (resp) {
      state.busy = false;
      setLoading(false);

      if (resp.status === 200 && resp.data && Array.isArray(resp.data.rows)) {
        setNotice('');
        renderRows(resp.data.rows, append);
        state.nextCursor = resp.data.next_cursor != null ? resp.data.next_cursor : null;
        updateMore();
        updateEmpty();
        return;
      }
      handleError(resp);
    }, function () {
      state.busy = false;
      setLoading(false);
      setNotice('No se pudo conectar con el servidor. Revisá tu conexión.');
    });
  }

  function handleError(resp) {
    var code = resp.data && resp.data.error && resp.data.error.code;
    var msg = (code && ERROR_COPY[code]) || 'Ocurrió un error. Volvé a intentar.';

    if (resp.status === 401) {
      // Sesión inválida/expirada → volver al login.
      doLogout(ERROR_COPY.unauthorized);
      return;
    }
    if (resp.status === 403 && code === 'not_staff') {
      // Sin acceso: no pintar ningún dato del audit.
      clearResults();
      $('load-more').hidden = true;
      $('empty-state').hidden = true;
      setNotice(ERROR_COPY.not_staff);
      return;
    }
    setNotice(msg);
  }

  // ===============================================================================================
  // Render de resultados
  // ===============================================================================================
  function clearResults() {
    clearChildren($('results-body'));
    $('empty-state').hidden = true;
    $('load-more').hidden = true;
    state.displayed = 0;
  }

  function updateMore() {
    $('load-more').hidden = !state.nextCursor;
  }

  function updateEmpty() {
    $('empty-state').hidden = state.displayed > 0;
  }

  function renderRows(rows, append) {
    if (!append) { clearChildren($('results-body')); state.displayed = 0; }
    var body = $('results-body');
    var i;
    for (i = 0; i < rows.length; i++) {
      body.appendChild(renderRow(rows[i]));
      state.displayed++;
    }
  }

  function actorNode(row) {
    var wrap = el('div', 'actor');
    if (row.actor) {
      wrap.appendChild(txtEl('span', 'actor-name', row.actor.name || '(sin nombre)'));
      if (row.actor.email) { wrap.appendChild(txtEl('span', 'actor-email', row.actor.email)); }
    } else {
      wrap.appendChild(txtEl('span', 'actor-uid', row.auth_uid || '—'));
    }
    return wrap;
  }

  function opBadge(op) {
    var cls = 'badge badge-' + String(op || '').toLowerCase();
    var b = txtEl('span', cls, OP_LABELS[op] || op || '—');
    if (op) { b.title = op; }
    return b;
  }

  function reqIdNode(row) {
    var wrap = el('div', 'reqid');
    var rid = row.request_id;
    var code = txtEl('code', 'reqid-text', rid || '—');
    if (rid) { code.title = rid; }
    wrap.appendChild(code);
    if (rid) {
      var btn = txtEl('button', 'copy-btn', 'Copiar');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Copiar operationId');
      btn.addEventListener('click', function (ev) { ev.stopPropagation(); copyText(rid, btn); });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function copyText(text, btn) {
    var restore = function () { btn.textContent = 'Copiar'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = 'Copiado';
        setTimeout(restore, 1500);
      }, function () {
        btn.textContent = 'Error';
        setTimeout(restore, 1500);
      });
    }
  }

  function makeVal(v, cls) {
    var s = el('span', 'diff-val ' + cls);
    s.textContent = formatValue(v); // textContent: sin XSS (LOW-3)
    return s;
  }

  // Diff antes → después. INSERT: solo nuevos. DELETE: solo eliminados. UPDATE: cambiados (colapsa iguales).
  function renderDiff(row) {
    var container = el('div', 'diff');
    var op = row.op;
    var rec = row.record || {};
    var old = row.old_record || {};

    // Unión de claves de record ∪ old_record.
    var keys = {};
    var k;
    for (k in rec) { if (Object.prototype.hasOwnProperty.call(rec, k)) { keys[k] = true; } }
    for (k in old) { if (Object.prototype.hasOwnProperty.call(old, k)) { keys[k] = true; } }
    var keyList = Object.keys(keys).sort();

    var anyChange = false;
    var i;
    for (i = 0; i < keyList.length; i++) {
      var key = keyList[i];
      var before = old[key];
      var after = rec[key];

      if (op === 'UPDATE' && valuesEqual(before, after)) { continue; }
      anyChange = true;

      var line = el('div', 'diff-line');
      line.appendChild(txtEl('span', 'diff-label', fieldLabel(key)));

      if (op === 'INSERT') {
        line.appendChild(makeVal(after, 'val-new'));
      } else if (op === 'DELETE') {
        line.appendChild(makeVal(before, 'val-old'));
      } else { // UPDATE (o cualquier otro: mostramos antes → después)
        line.appendChild(makeVal(before, 'val-old'));
        line.appendChild(txtEl('span', 'diff-arrow', '→'));
        line.appendChild(makeVal(after, 'val-new'));
      }
      container.appendChild(line);
    }

    if (!anyChange) {
      container.appendChild(txtEl('div', 'diff-empty', 'Sin cambios de campos.'));
    }
    return container;
  }

  function renderRow(row) {
    var frag = document.createDocumentFragment();

    var tr = el('tr', 'row');
    tr.appendChild(txtEl('td', 'cell cell-date', formatDate(row.ts)));

    var tdActor = el('td', 'cell cell-actor');
    tdActor.appendChild(actorNode(row));
    tr.appendChild(tdActor);

    tr.appendChild(txtEl('td', 'cell cell-table', row.table_label || row.table_name || '—'));

    var tdOp = el('td', 'cell cell-op');
    tdOp.appendChild(opBadge(row.op));
    tr.appendChild(tdOp);

    var tdReq = el('td', 'cell cell-reqid');
    tdReq.appendChild(reqIdNode(row));
    tr.appendChild(tdReq);

    var tdTog = el('td', 'cell cell-toggle');
    var toggle = txtEl('button', 'toggle-btn', 'Ver');
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', 'false');
    tdTog.appendChild(toggle);
    tr.appendChild(tdTog);

    var detail = el('tr', 'detail-row');
    detail.hidden = true;
    var detailTd = el('td', 'detail-cell');
    detailTd.colSpan = 6;
    detailTd.appendChild(renderDiff(row));
    detail.appendChild(detailTd);

    function toggleFn() {
      var opening = detail.hidden;
      detail.hidden = !opening;
      toggle.setAttribute('aria-expanded', String(opening));
      toggle.textContent = opening ? 'Ocultar' : 'Ver';
      tr.classList.toggle('open', opening);
    }
    toggle.addEventListener('click', toggleFn);

    frag.appendChild(tr);
    frag.appendChild(detail);
    return frag;
  }

  // ===============================================================================================
  // Wiring
  // ===============================================================================================
  function init() {
    $('login-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var email = $('login-email').value.trim();
      var password = $('login-password').value;
      if (!email || !password) {
        setLoginError('Completá email y contraseña.');
        return;
      }
      doLogin(email, password);
    });

    $('logout').addEventListener('click', function () { doLogout(''); });

    $('filters').addEventListener('submit', function (ev) {
      ev.preventDefault();
      runSearch();
    });

    $('clear').addEventListener('click', function () {
      $('filters').reset();
      state.filters = null;
      state.nextCursor = null;
      clearResults();
      setNotice('');
    });

    $('load-more').addEventListener('click', loadMore);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
