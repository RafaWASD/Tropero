/*
 * Consola de auditoría interna de miTropero (staff).
 *
 * Auth (delta cloudflare-access): la web NO autentica. Cloudflare Access gatea en el borde (One-time PIN
 * + allowlist de mails) y la consulta va same-origin a /api/audit_query. La Pages Function reenvía el JWT
 * de Access (Cf-Access-Jwt-Assertion, que Cloudflare inyecta server-side) a la EF, que lo verifica. La web
 * no maneja tokens ni la anon key; la cookie de Access es HttpOnly y viaja sola por ser same-origin.
 *
 * Seguridad (design §8, preservada):
 *   - TODOS los valores de record / old_record / actor se pintan con textContent (o vía DOM APIs),
 *     JAMÁS con innerHTML → sin XSS almacenado en la consola de staff (LOW-3).
 *   - Filtros SIEMPRE en el body del POST, nunca en la URL (RCFA.3.4 / R2.1).
 */
(function () {
  'use strict';

  // --- Config -------------------------------------------------------------------------------------
  // Ruta same-origin a la Pages Function (que reenvía el JWT de Access a la EF). Sin URL de Supabase ni
  // anon key: la web ya no habla directo con Supabase.
  var EF_URL = '/api/audit_query';

  // --- Estado (todo en memoria) ------------------------------------------------------------------
  var state = {
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
    unauthorized: 'Tu sesión expiró, recargá la página.',
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
  // Filtros + fetch a la EF (vía la Pages Function same-origin)
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

  // POST same-origin a la Pages Function. Filtros en el body (NUNCA en la URL). Sin Authorization ni
  // apikey: la cookie de Access viaja sola (same-origin) y la Function reenvía el JWT a la EF.
  function callEf(body) {
    return fetch(EF_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
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
      // Sesión de Access expirada (o request que no pasó por Access). Recargar re-autentica en el borde.
      // No pintamos ningún dato del audit.
      setNotice(ERROR_COPY.unauthorized);
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
    // Sin wiring de login/logout: Access gatea en el borde y "Salir" es un link a /cdn-cgi/access/logout.
    // La consola es la única vista y arranca montada; nada que "mostrar" tras un login.
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
