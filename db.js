const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');

const DB_PATH = path.join(__dirname, 'finanzas.db');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('ahorro','monetaria')),
  saldo_inicial REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS account_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('deposito','retiro')),
  monto REAL NOT NULL,
  descripcion TEXT,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  banco TEXT,
  limite REAL NOT NULL DEFAULT 0,
  dia_corte INTEGER,
  dia_pago INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS card_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK(tipo IN ('compra','pago')),
  monto REAL NOT NULL,
  descripcion TEXT,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS extrafinanciamientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  descripcion TEXT NOT NULL,
  monto_total REAL NOT NULL,
  cuotas_totales INTEGER NOT NULL DEFAULT 1,
  cuota_mensual REAL NOT NULL DEFAULT 0,
  fecha_inicio TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS extra_pagos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extra_id INTEGER NOT NULL REFERENCES extrafinanciamientos(id) ON DELETE CASCADE,
  monto REAL NOT NULL,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS efectivo_movimientos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('ingreso','egreso')),
  monto REAL NOT NULL,
  descripcion TEXT,
  fecha TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
`);

module.exports = db;
