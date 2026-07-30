const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');
const db = require('./db.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- helpers ----------

function sum(rows, field) {
  return rows.reduce((acc, r) => acc + (r[field] || 0), 0);
}

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function accountWithSaldo(acc) {
  const movs = db.prepare('SELECT tipo, monto FROM account_movimientos WHERE account_id = ?').all(acc.id);
  const depositos = sum(movs.filter(m => m.tipo === 'deposito'), 'monto');
  const retiros = sum(movs.filter(m => m.tipo === 'retiro'), 'monto');
  const saldo = round2(acc.saldo_inicial + depositos - retiros);
  return { ...acc, depositos: round2(depositos), retiros: round2(retiros), saldo };
}

function extraWithSaldo(ex) {
  const pagos = db.prepare('SELECT monto FROM extra_pagos WHERE extra_id = ?').all(ex.id);
  const totalPagado = round2(sum(pagos, 'monto'));
  const saldoPendiente = round2(ex.monto_total - totalPagado);
  return { ...ex, total_pagado: totalPagado, saldo_pendiente: Math.max(saldoPendiente, 0) };
}

function cardWithDeuda(card) {
  const movs = db.prepare('SELECT tipo, monto FROM card_movimientos WHERE card_id = ?').all(card.id);
  const compras = round2(sum(movs.filter(m => m.tipo === 'compra'), 'monto'));
  const pagos = round2(sum(movs.filter(m => m.tipo === 'pago'), 'monto'));
  const deudaConsumo = round2(Math.max(compras - pagos, 0));

  const extras = db.prepare('SELECT * FROM extrafinanciamientos WHERE card_id = ?').all(card.id).map(extraWithSaldo);
  const totalExtraOriginal = round2(sum(extras, 'monto_total'));
  const totalExtraPagado = round2(sum(extras, 'total_pagado'));
  const deudaExtra = round2(sum(extras, 'saldo_pendiente'));

  const deudaTotal = round2(deudaConsumo + deudaExtra);
  const totalPagado = round2(pagos + totalExtraPagado);
  const disponible = round2(card.limite - deudaConsumo);

  return {
    ...card,
    compras, pagos_consumo: pagos, deuda_consumo: deudaConsumo,
    total_extra_original: totalExtraOriginal, total_extra_pagado: totalExtraPagado, deuda_extra: deudaExtra,
    deuda_total: deudaTotal, total_pagado: totalPagado, disponible,
    extras
  };
}

function cashSaldo() {
  const movs = db.prepare('SELECT tipo, monto FROM efectivo_movimientos').all();
  const ingresos = round2(sum(movs.filter(m => m.tipo === 'ingreso'), 'monto'));
  const egresos = round2(sum(movs.filter(m => m.tipo === 'egreso'), 'monto'));
  return { ingresos, egresos, saldo: round2(ingresos - egresos) };
}

// ---------- JSON body helper ----------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function notFound(res) { sendJSON(res, 404, { error: 'No encontrado' }); }
function badRequest(res, msg) { sendJSON(res, 400, { error: msg || 'Solicitud invalida' }); }

// ---------- static file serving ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return notFound(res);
  fs.readFile(filePath, (err, data) => {
    if (err) return notFound(res);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- route table ----------
// each entry: [method, regex, handler(match, req, res, body)]

const routes = [];
function route(method, pattern, handler) {
  const paramNames = [];
  const regexStr = pattern.replace(/:[a-zA-Z]+/g, (m) => { paramNames.push(m.slice(1)); return '([^/]+)'; });
  routes.push({ method, regex: new RegExp('^' + regexStr + '$'), paramNames, handler });
}

function getParams(route, match) {
  const params = {};
  route.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
  return params;
}

// ---- Dashboard ----
route('GET', '/api/dashboard', async (params, req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY id').all().map(accountWithSaldo);
  const cards = db.prepare('SELECT * FROM credit_cards ORDER BY id').all().map(cardWithDeuda);
  const cash = cashSaldo();

  const totalCuentas = round2(sum(accounts, 'saldo'));
  const totalDeudaConsumo = round2(sum(cards, 'deuda_consumo'));
  const totalDeudaExtra = round2(sum(cards, 'deuda_extra'));
  const totalDeuda = round2(totalDeudaConsumo + totalDeudaExtra);
  const liquido = round2(totalCuentas + cash.saldo);
  const patrimonioNeto = round2(liquido - totalDeuda);

  sendJSON(res, 200, {
    accounts, cards, cash,
    resumen: {
      total_cuentas: totalCuentas,
      total_efectivo: cash.saldo,
      total_liquido: liquido,
      total_deuda_consumo: totalDeudaConsumo,
      total_deuda_extra: totalDeudaExtra,
      total_deuda: totalDeuda,
      patrimonio_neto: patrimonioNeto
    }
  });
});

// ---- Accounts ----
route('GET', '/api/accounts', async (p, req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts ORDER BY id').all().map(accountWithSaldo);
  sendJSON(res, 200, accounts);
});

route('POST', '/api/accounts', async (p, req, res, body) => {
  const { nombre, tipo, saldo_inicial } = body;
  if (!nombre || !['ahorro', 'monetaria'].includes(tipo)) return badRequest(res, 'nombre y tipo (ahorro|monetaria) son requeridos');
  const stmt = db.prepare('INSERT INTO accounts (nombre, tipo, saldo_inicial) VALUES (?, ?, ?)');
  const info = stmt.run(nombre, tipo, Number(saldo_inicial) || 0);
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid);
  sendJSON(res, 201, accountWithSaldo(acc));
});

route('GET', '/api/accounts/:id', async (p, req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(p.id);
  if (!acc) return notFound(res);
  const movimientos = db.prepare('SELECT * FROM account_movimientos WHERE account_id = ? ORDER BY fecha DESC, id DESC').all(p.id);
  sendJSON(res, 200, { ...accountWithSaldo(acc), movimientos });
});

route('PUT', '/api/accounts/:id', async (p, req, res, body) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(p.id);
  if (!acc) return notFound(res);
  const nombre = body.nombre ?? acc.nombre;
  const tipo = ['ahorro', 'monetaria'].includes(body.tipo) ? body.tipo : acc.tipo;
  const saldo_inicial = body.saldo_inicial !== undefined ? Number(body.saldo_inicial) : acc.saldo_inicial;
  db.prepare('UPDATE accounts SET nombre = ?, tipo = ?, saldo_inicial = ? WHERE id = ?').run(nombre, tipo, saldo_inicial, p.id);
  const updated = db.prepare('SELECT * FROM accounts WHERE id = ?').get(p.id);
  sendJSON(res, 200, accountWithSaldo(updated));
});

route('DELETE', '/api/accounts/:id', async (p, req, res) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(p.id);
  if (!acc) return notFound(res);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(p.id);
  sendJSON(res, 200, { ok: true });
});

route('POST', '/api/accounts/:id/movimientos', async (p, req, res, body) => {
  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(p.id);
  if (!acc) return notFound(res);
  const { tipo, monto, descripcion, fecha } = body;
  if (!['deposito', 'retiro'].includes(tipo) || !(Number(monto) > 0)) return badRequest(res, 'tipo (deposito|retiro) y monto > 0 son requeridos');
  const stmt = db.prepare('INSERT INTO account_movimientos (account_id, tipo, monto, descripcion, fecha) VALUES (?, ?, ?, ?, COALESCE(?, date(\'now\')))');
  stmt.run(p.id, tipo, Number(monto), descripcion || null, fecha || null);
  const updated = db.prepare('SELECT * FROM accounts WHERE id = ?').get(p.id);
  const movimientos = db.prepare('SELECT * FROM account_movimientos WHERE account_id = ? ORDER BY fecha DESC, id DESC').all(p.id);
  sendJSON(res, 201, { ...accountWithSaldo(updated), movimientos });
});

route('DELETE', '/api/accounts/:accId/movimientos/:movId', async (p, req, res) => {
  db.prepare('DELETE FROM account_movimientos WHERE id = ? AND account_id = ?').run(p.movId, p.accId);
  sendJSON(res, 200, { ok: true });
});

// ---- Cash (efectivo) ----
route('GET', '/api/cash', async (p, req, res) => {
  const movimientos = db.prepare('SELECT * FROM efectivo_movimientos ORDER BY fecha DESC, id DESC').all();
  sendJSON(res, 200, { ...cashSaldo(), movimientos });
});

route('POST', '/api/cash', async (p, req, res, body) => {
  const { tipo, monto, descripcion, fecha } = body;
  if (!['ingreso', 'egreso'].includes(tipo) || !(Number(monto) > 0)) return badRequest(res, 'tipo (ingreso|egreso) y monto > 0 son requeridos');
  db.prepare('INSERT INTO efectivo_movimientos (tipo, monto, descripcion, fecha) VALUES (?, ?, ?, COALESCE(?, date(\'now\')))')
    .run(tipo, Number(monto), descripcion || null, fecha || null);
  const movimientos = db.prepare('SELECT * FROM efectivo_movimientos ORDER BY fecha DESC, id DESC').all();
  sendJSON(res, 201, { ...cashSaldo(), movimientos });
});

route('DELETE', '/api/cash/:id', async (p, req, res) => {
  db.prepare('DELETE FROM efectivo_movimientos WHERE id = ?').run(p.id);
  sendJSON(res, 200, { ok: true });
});

// ---- Credit cards ----
route('GET', '/api/cards', async (p, req, res) => {
  const cards = db.prepare('SELECT * FROM credit_cards ORDER BY id').all().map(cardWithDeuda);
  sendJSON(res, 200, cards);
});

route('POST', '/api/cards', async (p, req, res, body) => {
  const { nombre, banco, limite, dia_corte, dia_pago } = body;
  if (!nombre) return badRequest(res, 'nombre es requerido');
  const stmt = db.prepare('INSERT INTO credit_cards (nombre, banco, limite, dia_corte, dia_pago) VALUES (?, ?, ?, ?, ?)');
  const info = stmt.run(nombre, banco || null, Number(limite) || 0, dia_corte ? Number(dia_corte) : null, dia_pago ? Number(dia_pago) : null);
  const card = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(info.lastInsertRowid);
  sendJSON(res, 201, cardWithDeuda(card));
});

route('GET', '/api/cards/:id', async (p, req, res) => {
  const card = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(p.id);
  if (!card) return notFound(res);
  const movimientos = db.prepare('SELECT * FROM card_movimientos WHERE card_id = ? ORDER BY fecha DESC, id DESC').all(p.id);
  sendJSON(res, 200, { ...cardWithDeuda(card), movimientos });
});

route('PUT', '/api/cards/:id', async (p, req, res, body) => {
  const card = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(p.id);
  if (!card) return notFound(res);
  const nombre = body.nombre ?? card.nombre;
  const banco = body.banco ?? card.banco;
  const limite = body.limite !== undefined ? Number(body.limite) : card.limite;
  const dia_corte = body.dia_corte !== undefined ? Number(body.dia_corte) : card.dia_corte;
  const dia_pago = body.dia_pago !== undefined ? Number(body.dia_pago) : card.dia_pago;
  db.prepare('UPDATE credit_cards SET nombre=?, banco=?, limite=?, dia_corte=?, dia_pago=? WHERE id=?')
    .run(nombre, banco, limite, dia_corte, dia_pago, p.id);
  const updated = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(p.id);
  sendJSON(res, 200, cardWithDeuda(updated));
});

route('DELETE', '/api/cards/:id', async (p, req, res) => {
  const card = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(p.id);
  if (!card) return notFound(res);
  db.prepare('DELETE FROM credit_cards WHERE id = ?').run(p.id);
  sendJSON(res, 200, { ok: true });
});

route('POST', '/api/cards/:id/movimientos', async (p, req, res, body) => {
  const card = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(p.id);
  if (!card) return notFound(res);
  const { tipo, monto, descripcion, fecha } = body;
  if (!['compra', 'pago'].includes(tipo) || !(Number(monto) > 0)) return badRequest(res, 'tipo (compra|pago) y monto > 0 son requeridos');
  db.prepare('INSERT INTO card_movimientos (card_id, tipo, monto, descripcion, fecha) VALUES (?, ?, ?, ?, COALESCE(?, date(\'now\')))')
    .run(p.id, tipo, Number(monto), descripcion || null, fecha || null);
  const updated = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(p.id);
  const movimientos = db.prepare('SELECT * FROM card_movimientos WHERE card_id = ? ORDER BY fecha DESC, id DESC').all(p.id);
  sendJSON(res, 201, { ...cardWithDeuda(updated), movimientos });
});

route('DELETE', '/api/cards/:cardId/movimientos/:movId', async (p, req, res) => {
  db.prepare('DELETE FROM card_movimientos WHERE id = ? AND card_id = ?').run(p.movId, p.cardId);
  sendJSON(res, 200, { ok: true });
});

// ---- Extrafinanciamientos ----
route('POST', '/api/cards/:id/extras', async (p, req, res, body) => {
  const card = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(p.id);
  if (!card) return notFound(res);
  const { descripcion, monto_total, cuotas_totales, cuota_mensual, fecha_inicio } = body;
  if (!descripcion || !(Number(monto_total) > 0)) return badRequest(res, 'descripcion y monto_total > 0 son requeridos');
  db.prepare('INSERT INTO extrafinanciamientos (card_id, descripcion, monto_total, cuotas_totales, cuota_mensual, fecha_inicio) VALUES (?, ?, ?, ?, ?, COALESCE(?, date(\'now\')))')
    .run(p.id, descripcion, Number(monto_total), Number(cuotas_totales) || 1, Number(cuota_mensual) || 0, fecha_inicio || null);
  const updated = db.prepare('SELECT * FROM credit_cards WHERE id = ?').get(p.id);
  sendJSON(res, 201, cardWithDeuda(updated));
});

route('DELETE', '/api/extras/:id', async (p, req, res) => {
  db.prepare('DELETE FROM extrafinanciamientos WHERE id = ?').run(p.id);
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/extras/:id', async (p, req, res) => {
  const ex = db.prepare('SELECT * FROM extrafinanciamientos WHERE id = ?').get(p.id);
  if (!ex) return notFound(res);
  const pagos = db.prepare('SELECT * FROM extra_pagos WHERE extra_id = ? ORDER BY fecha DESC, id DESC').all(p.id);
  sendJSON(res, 200, { ...extraWithSaldo(ex), pagos });
});

route('POST', '/api/extras/:id/pagos', async (p, req, res, body) => {
  const ex = db.prepare('SELECT * FROM extrafinanciamientos WHERE id = ?').get(p.id);
  if (!ex) return notFound(res);
  const { monto, fecha } = body;
  if (!(Number(monto) > 0)) return badRequest(res, 'monto > 0 es requerido');
  db.prepare('INSERT INTO extra_pagos (extra_id, monto, fecha) VALUES (?, ?, COALESCE(?, date(\'now\')))')
    .run(p.id, Number(monto), fecha || null);
  const updated = db.prepare('SELECT * FROM extrafinanciamientos WHERE id = ?').get(p.id);
  const pagos = db.prepare('SELECT * FROM extra_pagos WHERE extra_id = ? ORDER BY fecha DESC, id DESC').all(p.id);
  sendJSON(res, 201, { ...extraWithSaldo(updated), pagos });
});

route('DELETE', '/api/extras/:extraId/pagos/:pagoId', async (p, req, res) => {
  db.prepare('DELETE FROM extra_pagos WHERE id = ? AND extra_id = ?').run(p.pagoId, p.extraId);
  sendJSON(res, 200, { ok: true });
});

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  if (pathname.startsWith('/api/')) {
    const match = routes.find(r => r.method === req.method && r.regex.test(pathname));
    if (!match) return notFound(res);
    const m = pathname.match(match.regex);
    const params = getParams(match, m);
    try {
      const body = (req.method === 'POST' || req.method === 'PUT') ? await readBody(req) : {};
      await match.handler(params, req, res, body);
    } catch (err) {
      console.error(err);
      sendJSON(res, 500, { error: err.message || 'Error interno' });
    }
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`\nFinanzas personales corriendo en http://localhost:${PORT}\n`);
});
