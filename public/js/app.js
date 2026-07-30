// ---------- utilities ----------

const fmtMoney = (n) => {
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return `${sign}Q${Math.abs(v).toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const fmtDate = (d) => {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(2)}`;
};

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Error' }));
    throw new Error(err.error || 'Error de solicitud');
  }
  return res.json();
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- modal ----------

const backdrop = document.getElementById('modalBackdrop');
const modalEl = document.getElementById('modal');

function openModal(html) {
  modalEl.innerHTML = html;
  backdrop.classList.add('open');
}
function closeModal() {
  backdrop.classList.remove('open');
  modalEl.innerHTML = '';
}
backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

// ---------- state / router ----------

const state = { view: 'dashboard', detail: null };

const views = {
  dashboard: document.getElementById('view-dashboard'),
  cuentas: document.getElementById('view-cuentas'),
  tarjetas: document.getElementById('view-tarjetas'),
  efectivo: document.getElementById('view-efectivo'),
};
const titles = { dashboard: 'Panorama general', cuentas: 'Cuentas', tarjetas: 'Tarjetas de credito', efectivo: 'Efectivo' };

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

function switchView(name) {
  state.view = name;
  state.detail = null;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  Object.entries(views).forEach(([k, v]) => v.hidden = k !== name);
  document.getElementById('viewTitle').textContent = titles[name];
  render();
}

async function render() {
  try {
    if (state.view === 'dashboard') await renderDashboard();
    if (state.view === 'cuentas') await (state.detail ? renderCuentaDetail(state.detail) : renderCuentas());
    if (state.view === 'tarjetas') {
      if (state.detail?.type === 'card') await renderTarjetaDetail(state.detail.id);
      else if (state.detail?.type === 'extra') await renderExtraDetail(state.detail.id, state.detail.cardId);
      else await renderTarjetas();
    }
    if (state.view === 'efectivo') await renderEfectivo();
  } catch (err) {
    console.error(err);
    showErrorBanner(views[state.view], err);
  }
}

function showErrorBanner(container, err) {
  if (!container) return;
  container.innerHTML = '';
  container.appendChild(el(`
    <div class="empty-state" style="border-color: var(--coral); color: var(--coral-soft); text-align:left">
      <strong style="display:block;margin-bottom:6px;color:var(--ink)">No se pudo cargar esta seccion</strong>
      ${err.message === 'Failed to fetch'
        ? 'La pagina no logra hablar con el servidor. Revisa que la hayas abierto desde <code>http://localhost:3000</code> (corriendo <code>node server.js</code>) y no abriendo el archivo index.html directamente.'
        : String(err.message || err)}
      <div style="margin-top:12px"><button class="btn btn-sm" id="retryBtn">Reintentar</button></div>
    </div>
  `));
  document.getElementById('retryBtn')?.addEventListener('click', render);
}

// ---------- date header ----------
(function initDate() {
  const d = new Date();
  document.getElementById('todayDate').textContent = d.toLocaleDateString('es-GT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
})();

// ================= DASHBOARD =================

async function renderDashboard() {
  const data = await api('GET', '/api/dashboard');
  const r = data.resumen;
  document.getElementById('sidebarNet').textContent = fmtMoney(r.patrimonio_neto);

  const pctPagado = r.total_deuda_consumo + r.total_deuda_extra > 0
    ? 0
    : 0;
  // progress = paid vs original owed across cards (compras+extra originales)
  const totalOriginal = data.cards.reduce((a, c) => a + c.compras + c.total_extra_original, 0);
  const totalPagadoCards = data.cards.reduce((a, c) => a + c.total_pagado, 0);
  const pct = totalOriginal > 0 ? Math.min(100, Math.round((totalPagadoCards / totalOriginal) * 100)) : 100;

  views.dashboard.innerHTML = `
    <div class="detail-actions" style="justify-content:flex-end">
      <button class="btn btn-sm" id="qAddAccount">+ Cuenta</button>
      <button class="btn btn-sm" id="qAddCard">+ Tarjeta</button>
      <button class="btn btn-sm" id="qAddCash">+ Efectivo</button>
    </div>
    <div class="runway">
      <div class="runway-top">
        <div>
          <div class="runway-label">Deuda total pendiente</div>
          <div class="runway-amount">${fmtMoney(r.total_deuda)}</div>
          <div class="runway-sub">Consumos ${fmtMoney(r.total_deuda_consumo)} &nbsp;·&nbsp; Extrafinanciamientos ${fmtMoney(r.total_deuda_extra)}</div>
        </div>
        <div class="runway-stat">
          <div class="n">${fmtMoney(totalPagadoCards)}</div>
          <div class="l">Pagado a la fecha</div>
        </div>
      </div>
      <div class="runway-track"><div class="runway-fill" style="width:${pct}%"></div></div>
      <div class="runway-marks"><span>0% pagado</span><span>${pct}% del camino recorrido</span><span>100% libre de deuda</span></div>
    </div>

    <div class="grid">
      <div class="stat-card"><div class="l">Total en cuentas</div><div class="v">${fmtMoney(r.total_cuentas)}</div></div>
      <div class="stat-card"><div class="l">Efectivo disponible</div><div class="v">${fmtMoney(r.total_efectivo)}</div></div>
      <div class="stat-card"><div class="l">Total liquido</div><div class="v pos">${fmtMoney(r.total_liquido)}</div></div>
      <div class="stat-card"><div class="l">Patrimonio neto</div><div class="v ${r.patrimonio_neto >= 0 ? 'pos' : 'neg'}">${fmtMoney(r.patrimonio_neto)}</div></div>
    </div>

    <div>
      <div class="section-head"><h2>Cuentas</h2><span class="eyebrow">${data.accounts.length} activas</span></div>
    </div>
    <div class="item-list" id="dashAccounts"></div>

    <div>
      <div class="section-head"><h2>Tarjetas de credito</h2><span class="eyebrow">${data.cards.length} activas</span></div>
    </div>
    <div class="item-list" id="dashCards"></div>
  `;

  document.getElementById('qAddAccount').addEventListener('click', openAccountModal);
  document.getElementById('qAddCard').addEventListener('click', openCardModal);
  document.getElementById('qAddCash').addEventListener('click', () => openCashModal('ingreso'));

  const accList = document.getElementById('dashAccounts');
  if (!data.accounts.length) accList.appendChild(el(`<div class="empty-state">Aun no has agregado cuentas. Ve a la seccion Cuentas para crear la primera.</div>`));
  data.accounts.forEach(acc => accList.appendChild(accountRow(acc)));

  const cardList = document.getElementById('dashCards');
  if (!data.cards.length) cardList.appendChild(el(`<div class="empty-state">Aun no has agregado tarjetas. Ve a la seccion Tarjetas para crear la primera.</div>`));
  data.cards.forEach(c => cardList.appendChild(cardRow(c)));
}

function accountRow(acc) {
  const row = el(`
    <div class="item-row">
      <div class="item-main">
        <div class="item-icon">${acc.tipo === 'ahorro' ? '🏦' : '💳'}</div>
        <div>
          <div class="item-name">${acc.nombre}</div>
          <div class="item-sub">${acc.tipo === 'ahorro' ? 'Cuenta de ahorro' : 'Cuenta monetaria'}</div>
        </div>
      </div>
      <div class="item-amount">${fmtMoney(acc.saldo)}<span class="tag">saldo</span></div>
    </div>
  `);
  row.addEventListener('click', () => { switchViewKeep('cuentas'); state.detail = acc.id; render(); });
  return row;
}

function cardRow(c) {
  const row = el(`
    <div class="item-row">
      <div class="item-main">
        <div class="item-icon">💼</div>
        <div>
          <div class="item-name">${c.nombre}${c.banco ? ' · ' + c.banco : ''}</div>
          <div class="item-sub">Limite ${fmtMoney(c.limite)} · Disponible ${fmtMoney(c.disponible)}</div>
        </div>
      </div>
      <div class="item-amount">${fmtMoney(c.deuda_total)}<span class="tag">deuda total</span></div>
    </div>
  `);
  row.addEventListener('click', () => { switchViewKeep('tarjetas'); state.detail = { type: 'card', id: c.id }; render(); });
  return row;
}

function switchViewKeep(name) {
  state.view = name;
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  Object.entries(views).forEach(([k, v]) => v.hidden = k !== name);
  document.getElementById('viewTitle').textContent = titles[name];
}

// ================= CUENTAS =================

async function renderCuentas() {
  const accounts = await api('GET', '/api/accounts');
  const totalAhorro = accounts.filter(a => a.tipo === 'ahorro').reduce((a, b) => a + b.saldo, 0);
  const totalMonetaria = accounts.filter(a => a.tipo === 'monetaria').reduce((a, b) => a + b.saldo, 0);

  views.cuentas.innerHTML = `
    <div class="grid">
      <div class="stat-card"><div class="l">Ahorro</div><div class="v">${fmtMoney(totalAhorro)}</div></div>
      <div class="stat-card"><div class="l">Monetaria</div><div class="v">${fmtMoney(totalMonetaria)}</div></div>
      <div class="stat-card"><div class="l">Total en cuentas</div><div class="v pos">${fmtMoney(totalAhorro + totalMonetaria)}</div></div>
    </div>
    <div class="section-head"><h2>Todas las cuentas</h2><button class="btn btn-primary btn-sm" id="btnAddAccount">+ Agregar cuenta</button></div>
    <div class="item-list" id="accList"></div>
  `;

  document.getElementById('btnAddAccount').addEventListener('click', openAccountModal);
  const list = document.getElementById('accList');
  if (!accounts.length) list.appendChild(el(`<div class="empty-state">No tienes cuentas registradas todavia.</div>`));
  accounts.forEach(acc => list.appendChild(accountRow(acc)));
}

function openAccountModal() {
  openModal(`
    <h3>Nueva cuenta</h3>
    <div class="form-row"><label>Nombre</label><input id="fNombre" placeholder="Ej. Cuenta BAM, Ahorros Banrural..."></div>
    <div class="form-row"><label>Tipo</label>
      <div class="type-toggle" id="tipoToggle">
        <button type="button" class="active" data-v="ahorro">Ahorro</button>
        <button type="button" data-v="monetaria">Monetaria</button>
      </div>
    </div>
    <div class="form-row"><label>Saldo inicial</label><input id="fSaldo" type="number" step="0.01" placeholder="0.00"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn btn-primary" id="saveBtn">Guardar cuenta</button>
    </div>
  `);
  let tipo = 'ahorro';
  document.querySelectorAll('#tipoToggle button').forEach(b => b.addEventListener('click', () => {
    tipo = b.dataset.v;
    document.querySelectorAll('#tipoToggle button').forEach(x => x.classList.toggle('active', x === b));
  }));
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const nombre = document.getElementById('fNombre').value.trim();
    const saldo_inicial = document.getElementById('fSaldo').value;
    if (!nombre) return toast('Escribe un nombre para la cuenta');
    await api('POST', '/api/accounts', { nombre, tipo, saldo_inicial });
    closeModal(); toast('Cuenta creada'); render();
  });
}

async function renderCuentaDetail(id) {
  const acc = await api('GET', `/api/accounts/${id}`);
  views.cuentas.innerHTML = `
    <div>
      <button class="back-link" id="backBtn">&larr; Volver a cuentas</button>
      <div class="detail-header">
        <div>
          <h2 style="font-family:var(--font-display);font-size:20px;margin:0 0 4px">${acc.nombre}</h2>
          <div class="item-sub">${acc.tipo === 'ahorro' ? 'Cuenta de ahorro' : 'Cuenta monetaria'}</div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-danger btn-sm" id="delAccBtn">Eliminar cuenta</button>
        </div>
      </div>
    </div>
    <div class="grid">
      <div class="stat-card"><div class="l">Saldo actual</div><div class="v pos">${fmtMoney(acc.saldo)}</div></div>
      <div class="stat-card"><div class="l">Total depositado</div><div class="v">${fmtMoney(acc.depositos)}</div></div>
      <div class="stat-card"><div class="l">Total retirado</div><div class="v">${fmtMoney(acc.retiros)}</div></div>
    </div>
    <div class="section-head"><h2>Movimientos</h2>
      <div class="detail-actions">
        <button class="btn btn-sm" id="addRetiro">− Retiro</button>
        <button class="btn btn-primary btn-sm" id="addDeposito">+ Deposito</button>
      </div>
    </div>
    <div id="movList"></div>
  `;

  document.getElementById('backBtn').addEventListener('click', () => { state.detail = null; render(); });
  document.getElementById('delAccBtn').addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta cuenta y todos sus movimientos?')) return;
    await api('DELETE', `/api/accounts/${id}`);
    state.detail = null; toast('Cuenta eliminada'); render();
  });
  document.getElementById('addDeposito').addEventListener('click', () => openAccountMovModal(id, 'deposito'));
  document.getElementById('addRetiro').addEventListener('click', () => openAccountMovModal(id, 'retiro'));

  const movList = document.getElementById('movList');
  if (!acc.movimientos.length) {
    movList.appendChild(el(`<div class="empty-state">No hay movimientos todavia. Registra un deposito o retiro.</div>`));
  } else {
    acc.movimientos.forEach(m => {
      const row = el(`
        <div class="mov-row">
          <span class="mov-date">${fmtDate(m.fecha)}</span>
          <div style="flex:1;margin-left:12px">
            <div>${m.tipo === 'deposito' ? 'Deposito' : 'Retiro'}</div>
            ${m.descripcion ? `<div class="mov-desc">${m.descripcion}</div>` : ''}
          </div>
          <span class="mov-amount ${m.tipo === 'deposito' ? 'in' : 'out'}">${m.tipo === 'deposito' ? '+' : '−'}${fmtMoney(m.monto)}</span>
          <button class="mov-del" title="Eliminar">✕</button>
        </div>
      `);
      row.querySelector('.mov-del').addEventListener('click', async () => {
        await api('DELETE', `/api/accounts/${id}/movimientos/${m.id}`);
        render();
      });
      movList.appendChild(row);
    });
  }
}

function openAccountMovModal(accId, tipo) {
  openModal(`
    <h3>${tipo === 'deposito' ? 'Registrar deposito' : 'Registrar retiro'}</h3>
    <div class="form-row"><label>Monto</label><input id="fMonto" type="number" step="0.01" placeholder="0.00" autofocus></div>
    <div class="form-row"><label>Descripcion (opcional)</label><input id="fDesc" placeholder="Ej. Pago de nomina, compra supermercado..."></div>
    <div class="form-row"><label>Fecha</label><input id="fFecha" type="date" value="${todayISO()}"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn btn-primary" id="saveBtn">Guardar</button>
    </div>
  `);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const monto = Number(document.getElementById('fMonto').value);
    if (!(monto > 0)) return toast('Ingresa un monto valido');
    const descripcion = document.getElementById('fDesc').value.trim();
    const fecha = document.getElementById('fFecha').value;
    await api('POST', `/api/accounts/${accId}/movimientos`, { tipo, monto, descripcion, fecha });
    closeModal(); toast('Movimiento registrado'); render();
  });
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

// ================= TARJETAS =================

async function renderTarjetas() {
  const cards = await api('GET', '/api/cards');
  const totalDeuda = cards.reduce((a, c) => a + c.deuda_total, 0);
  const totalDisponible = cards.reduce((a, c) => a + c.disponible, 0);

  views.tarjetas.innerHTML = `
    <div class="grid">
      <div class="stat-card"><div class="l">Deuda total en tarjetas</div><div class="v neg">${fmtMoney(totalDeuda)}</div></div>
      <div class="stat-card"><div class="l">Credito disponible</div><div class="v">${fmtMoney(totalDisponible)}</div></div>
      <div class="stat-card"><div class="l">Tarjetas activas</div><div class="v">${cards.length}</div></div>
    </div>
    <div class="section-head"><h2>Todas las tarjetas</h2><button class="btn btn-primary btn-sm" id="btnAddCard">+ Agregar tarjeta</button></div>
    <div class="item-list" id="cardList"></div>
  `;

  document.getElementById('btnAddCard').addEventListener('click', openCardModal);
  const list = document.getElementById('cardList');
  if (!cards.length) list.appendChild(el(`<div class="empty-state">No tienes tarjetas registradas todavia.</div>`));
  cards.forEach(c => list.appendChild(cardRow(c)));
}

function openCardModal() {
  openModal(`
    <h3>Nueva tarjeta de credito</h3>
    <div class="form-row"><label>Nombre</label><input id="fNombre" placeholder="Ej. Visa Oro, Mastercard Black..."></div>
    <div class="form-row"><label>Banco (opcional)</label><input id="fBanco" placeholder="Ej. BAM, Banrural, BI..."></div>
    <div class="form-row"><label>Limite de credito</label><input id="fLimite" type="number" step="0.01" placeholder="0.00"></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Dia de corte</label><input id="fCorte" type="number" min="1" max="31" placeholder="Ej. 15"></div>
      <div class="form-row"><label>Dia de pago</label><input id="fPago" type="number" min="1" max="31" placeholder="Ej. 5"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn btn-primary" id="saveBtn">Guardar tarjeta</button>
    </div>
  `);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const nombre = document.getElementById('fNombre').value.trim();
    if (!nombre) return toast('Escribe un nombre para la tarjeta');
    const banco = document.getElementById('fBanco').value.trim();
    const limite = document.getElementById('fLimite').value;
    const dia_corte = document.getElementById('fCorte').value;
    const dia_pago = document.getElementById('fPago').value;
    await api('POST', '/api/cards', { nombre, banco, limite, dia_corte, dia_pago });
    closeModal(); toast('Tarjeta creada'); render();
  });
}

async function renderTarjetaDetail(id) {
  const card = await api('GET', `/api/cards/${id}`);
  const pctDeuda = card.limite > 0 ? Math.min(100, Math.round((card.deuda_consumo / card.limite) * 100)) : 0;

  views.tarjetas.innerHTML = `
    <div>
      <button class="back-link" id="backBtn">&larr; Volver a tarjetas</button>
      <div class="detail-header">
        <div>
          <h2 style="font-family:var(--font-display);font-size:20px;margin:0 0 4px">${card.nombre}${card.banco ? ' · ' + card.banco : ''}</h2>
          <div class="item-sub">Limite ${fmtMoney(card.limite)}${card.dia_corte ? ` · Corte dia ${card.dia_corte}` : ''}${card.dia_pago ? ` · Pago dia ${card.dia_pago}` : ''}</div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-danger btn-sm" id="delCardBtn">Eliminar tarjeta</button>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="stat-card"><div class="l">Deuda total</div><div class="v neg">${fmtMoney(card.deuda_total)}</div></div>
      <div class="stat-card"><div class="l">Pagado a la fecha</div><div class="v pos">${fmtMoney(card.total_pagado)}</div></div>
      <div class="stat-card"><div class="l">Disponible</div><div class="v">${fmtMoney(card.disponible)}</div></div>
    </div>

    <div class="stat-card" style="padding:20px 22px">
      <div class="section-head" style="margin-bottom:6px"><h2 style="font-size:14px">Consumos de la tarjeta</h2></div>
      <div class="item-sub">Comprado ${fmtMoney(card.compras)} · Pagado ${fmtMoney(card.pagos_consumo)} · Debo ${fmtMoney(card.deuda_consumo)}</div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pctDeuda}%"></div></div>
    </div>

    <div class="section-head">
      <h2>Movimientos</h2>
      <div class="detail-actions">
        <button class="btn btn-sm" id="addPago">Registrar pago</button>
        <button class="btn btn-primary btn-sm" id="addCompra">+ Registrar compra</button>
      </div>
    </div>
    <div id="movList"></div>

    <div class="section-head">
      <h2>Extrafinanciamientos</h2>
      <button class="btn btn-primary btn-sm" id="addExtra">+ Agregar extrafinanciamiento</button>
    </div>
    <div class="item-list" id="extraList"></div>
  `;

  document.getElementById('backBtn').addEventListener('click', () => { state.detail = null; render(); });
  document.getElementById('delCardBtn').addEventListener('click', async () => {
    if (!confirm('¿Eliminar esta tarjeta, sus movimientos y extrafinanciamientos?')) return;
    await api('DELETE', `/api/cards/${id}`);
    state.detail = null; toast('Tarjeta eliminada'); render();
  });
  document.getElementById('addCompra').addEventListener('click', () => openCardMovModal(id, 'compra'));
  document.getElementById('addPago').addEventListener('click', () => openCardMovModal(id, 'pago'));
  document.getElementById('addExtra').addEventListener('click', () => openExtraModal(id));

  const movList = document.getElementById('movList');
  if (!card.movimientos.length) {
    movList.appendChild(el(`<div class="empty-state">No hay compras ni pagos registrados todavia.</div>`));
  } else {
    card.movimientos.forEach(m => {
      const row = el(`
        <div class="mov-row">
          <span class="mov-date">${fmtDate(m.fecha)}</span>
          <div style="flex:1;margin-left:12px">
            <div>${m.tipo === 'compra' ? 'Compra' : 'Pago'}</div>
            ${m.descripcion ? `<div class="mov-desc">${m.descripcion}</div>` : ''}
          </div>
          <span class="mov-amount ${m.tipo === 'pago' ? 'in' : 'out'}">${m.tipo === 'pago' ? '+' : '−'}${fmtMoney(m.monto)}</span>
          <button class="mov-del" title="Eliminar">✕</button>
        </div>
      `);
      row.querySelector('.mov-del').addEventListener('click', async () => {
        await api('DELETE', `/api/cards/${id}/movimientos/${m.id}`);
        render();
      });
      movList.appendChild(row);
    });
  }

  const extraList = document.getElementById('extraList');
  if (!card.extras.length) {
    extraList.appendChild(el(`<div class="empty-state">Sin extrafinanciamientos (prestamos de tarjeta) registrados.</div>`));
  } else {
    card.extras.forEach(ex => {
      const row = el(`
        <div class="item-row">
          <div class="item-main">
            <div class="item-icon">📄</div>
            <div>
              <div class="item-name">${ex.descripcion}</div>
              <div class="item-sub">Total ${fmtMoney(ex.monto_total)} · Pagado ${fmtMoney(ex.total_pagado)}</div>
            </div>
          </div>
          <div class="item-amount">${fmtMoney(ex.saldo_pendiente)}<span class="tag">pendiente</span></div>
        </div>
      `);
      row.addEventListener('click', () => { state.detail = { type: 'extra', id: ex.id, cardId: id }; render(); });
      extraList.appendChild(row);
    });
  }
}

function openCardMovModal(cardId, tipo) {
  openModal(`
    <h3>${tipo === 'compra' ? 'Registrar compra' : 'Registrar pago'}</h3>
    <div class="form-row"><label>Monto</label><input id="fMonto" type="number" step="0.01" placeholder="0.00" autofocus></div>
    <div class="form-row"><label>Descripcion (opcional)</label><input id="fDesc" placeholder="${tipo === 'compra' ? 'Ej. Supermercado, gasolina...' : 'Ej. Pago minimo, pago total...'}"></div>
    <div class="form-row"><label>Fecha</label><input id="fFecha" type="date" value="${todayISO()}"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn btn-primary" id="saveBtn">Guardar</button>
    </div>
  `);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const monto = Number(document.getElementById('fMonto').value);
    if (!(monto > 0)) return toast('Ingresa un monto valido');
    const descripcion = document.getElementById('fDesc').value.trim();
    const fecha = document.getElementById('fFecha').value;
    await api('POST', `/api/cards/${cardId}/movimientos`, { tipo, monto, descripcion, fecha });
    closeModal(); toast('Movimiento registrado'); render();
  });
}

function openExtraModal(cardId) {
  openModal(`
    <h3>Nuevo extrafinanciamiento</h3>
    <p style="color:var(--ink-faint);font-size:12px;margin-top:-10px">Un prestamo o disposicion de efectivo sobre la tarjeta, pagado en cuotas.</p>
    <div class="form-row"><label>Descripcion</label><input id="fDesc" placeholder="Ej. Extrafinanciamiento electrodomesticos"></div>
    <div class="form-row"><label>Monto total del prestamo</label><input id="fTotal" type="number" step="0.01" placeholder="0.00"></div>
    <div class="form-grid-2">
      <div class="form-row"><label>Numero de cuotas</label><input id="fCuotas" type="number" min="1" placeholder="Ej. 12"></div>
      <div class="form-row"><label>Cuota mensual</label><input id="fCuota" type="number" step="0.01" placeholder="0.00"></div>
    </div>
    <div class="form-row"><label>Fecha de inicio</label><input id="fFecha" type="date" value="${todayISO()}"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn btn-primary" id="saveBtn">Guardar</button>
    </div>
  `);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const descripcion = document.getElementById('fDesc').value.trim();
    const monto_total = Number(document.getElementById('fTotal').value);
    if (!descripcion || !(monto_total > 0)) return toast('Completa descripcion y monto total');
    const cuotas_totales = document.getElementById('fCuotas').value;
    const cuota_mensual = document.getElementById('fCuota').value;
    const fecha_inicio = document.getElementById('fFecha').value;
    await api('POST', `/api/cards/${cardId}/extras`, { descripcion, monto_total, cuotas_totales, cuota_mensual, fecha_inicio });
    closeModal(); toast('Extrafinanciamiento registrado'); render();
  });
}

async function renderExtraDetail(id, cardId) {
  const ex = await api('GET', `/api/extras/${id}`);
  const pct = ex.monto_total > 0 ? Math.min(100, Math.round((ex.total_pagado / ex.monto_total) * 100)) : 0;

  views.tarjetas.innerHTML = `
    <div>
      <button class="back-link" id="backBtn">&larr; Volver a la tarjeta</button>
      <div class="detail-header">
        <div>
          <h2 style="font-family:var(--font-display);font-size:20px;margin:0 0 4px">${ex.descripcion}</h2>
          <div class="item-sub">${ex.cuotas_totales} cuotas · Cuota mensual ${fmtMoney(ex.cuota_mensual)} · Inicio ${fmtDate(ex.fecha_inicio)}</div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-danger btn-sm" id="delExtraBtn">Eliminar</button>
        </div>
      </div>
    </div>

    <div class="grid">
      <div class="stat-card"><div class="l">Monto original</div><div class="v">${fmtMoney(ex.monto_total)}</div></div>
      <div class="stat-card"><div class="l">Pagado</div><div class="v pos">${fmtMoney(ex.total_pagado)}</div></div>
      <div class="stat-card"><div class="l">Pendiente</div><div class="v neg">${fmtMoney(ex.saldo_pendiente)}</div></div>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,var(--green),#7fe0bb)"></div></div>

    <div class="section-head"><h2>Pagos realizados</h2><button class="btn btn-primary btn-sm" id="addPago">+ Registrar pago</button></div>
    <div id="pagoList"></div>
  `;

  document.getElementById('backBtn').addEventListener('click', () => { state.detail = { type: 'card', id: cardId }; render(); });
  document.getElementById('delExtraBtn').addEventListener('click', async () => {
    if (!confirm('¿Eliminar este extrafinanciamiento y sus pagos?')) return;
    await api('DELETE', `/api/extras/${id}`);
    state.detail = { type: 'card', id: cardId }; toast('Extrafinanciamiento eliminado'); render();
  });
  document.getElementById('addPago').addEventListener('click', () => {
    openModal(`
      <h3>Registrar pago de cuota</h3>
      <div class="form-row"><label>Monto</label><input id="fMonto" type="number" step="0.01" value="${ex.cuota_mensual || ''}" autofocus></div>
      <div class="form-row"><label>Fecha</label><input id="fFecha" type="date" value="${todayISO()}"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="cancelBtn">Cancelar</button>
        <button class="btn btn-primary" id="saveBtn">Guardar</button>
      </div>
    `);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    document.getElementById('saveBtn').addEventListener('click', async () => {
      const monto = Number(document.getElementById('fMonto').value);
      if (!(monto > 0)) return toast('Ingresa un monto valido');
      const fecha = document.getElementById('fFecha').value;
      await api('POST', `/api/extras/${id}/pagos`, { monto, fecha });
      closeModal(); toast('Pago registrado'); render();
    });
  });

  const pagoList = document.getElementById('pagoList');
  if (!ex.pagos.length) {
    pagoList.appendChild(el(`<div class="empty-state">Sin pagos registrados todavia.</div>`));
  } else {
    ex.pagos.forEach(p => {
      const row = el(`
        <div class="mov-row">
          <span class="mov-date">${fmtDate(p.fecha)}</span>
          <div style="flex:1;margin-left:12px">Pago de cuota</div>
          <span class="mov-amount in">+${fmtMoney(p.monto)}</span>
          <button class="mov-del" title="Eliminar">✕</button>
        </div>
      `);
      row.querySelector('.mov-del').addEventListener('click', async () => {
        await api('DELETE', `/api/extras/${id}/pagos/${p.id}`).catch(() => {});
        render();
      });
      pagoList.appendChild(row);
    });
  }
}

// ================= EFECTIVO =================

async function renderEfectivo() {
  const data = await api('GET', '/api/cash');
  views.efectivo.innerHTML = `
    <div class="grid">
      <div class="stat-card"><div class="l">Efectivo disponible</div><div class="v pos">${fmtMoney(data.saldo)}</div></div>
      <div class="stat-card"><div class="l">Total ingresos</div><div class="v">${fmtMoney(data.ingresos)}</div></div>
      <div class="stat-card"><div class="l">Total egresos</div><div class="v">${fmtMoney(data.egresos)}</div></div>
    </div>
    <div class="section-head">
      <h2>Movimientos en efectivo</h2>
      <div class="detail-actions">
        <button class="btn btn-sm" id="addEgreso">− Egreso</button>
        <button class="btn btn-primary btn-sm" id="addIngreso">+ Ingreso</button>
      </div>
    </div>
    <div id="cashList"></div>
  `;

  document.getElementById('addIngreso').addEventListener('click', () => openCashModal('ingreso'));
  document.getElementById('addEgreso').addEventListener('click', () => openCashModal('egreso'));

  const list = document.getElementById('cashList');
  if (!data.movimientos.length) {
    list.appendChild(el(`<div class="empty-state">No hay movimientos de efectivo todavia.</div>`));
  } else {
    data.movimientos.forEach(m => {
      const row = el(`
        <div class="mov-row">
          <span class="mov-date">${fmtDate(m.fecha)}</span>
          <div style="flex:1;margin-left:12px">
            <div>${m.tipo === 'ingreso' ? 'Ingreso' : 'Egreso'}</div>
            ${m.descripcion ? `<div class="mov-desc">${m.descripcion}</div>` : ''}
          </div>
          <span class="mov-amount ${m.tipo === 'ingreso' ? 'in' : 'out'}">${m.tipo === 'ingreso' ? '+' : '−'}${fmtMoney(m.monto)}</span>
          <button class="mov-del" title="Eliminar">✕</button>
        </div>
      `);
      row.querySelector('.mov-del').addEventListener('click', async () => {
        await api('DELETE', `/api/cash/${m.id}`);
        render();
      });
      list.appendChild(row);
    });
  }
}

function openCashModal(tipo) {
  openModal(`
    <h3>${tipo === 'ingreso' ? 'Registrar ingreso en efectivo' : 'Registrar egreso en efectivo'}</h3>
    <div class="form-row"><label>Monto</label><input id="fMonto" type="number" step="0.01" placeholder="0.00" autofocus></div>
    <div class="form-row"><label>Descripcion (opcional)</label><input id="fDesc" placeholder="Ej. Propina, mercado, transporte..."></div>
    <div class="form-row"><label>Fecha</label><input id="fFecha" type="date" value="${todayISO()}"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cancelBtn">Cancelar</button>
      <button class="btn btn-primary" id="saveBtn">Guardar</button>
    </div>
  `);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const monto = Number(document.getElementById('fMonto').value);
    if (!(monto > 0)) return toast('Ingresa un monto valido');
    const descripcion = document.getElementById('fDesc').value.trim();
    const fecha = document.getElementById('fFecha').value;
    await api('POST', '/api/cash', { tipo, monto, descripcion, fecha });
    closeModal(); toast('Movimiento registrado'); render();
  });
}

// ---------- boot ----------
render();
