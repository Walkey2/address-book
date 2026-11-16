'use strict';

/**
 * 仓储层：所有 SQL 集中在这里，路由层只关心 HTTP 语义。
 * 好处是接口逻辑与 SQL 解耦，后续换成 MySQL / PostgreSQL 只改这一个文件。
 */

const { db, METHOD_TYPE_VALUES } = require('./db');

/** 单条联系人 DTO */
function toContact(row, methods) {
  return {
    id: row.id,
    name: row.name,
    company: row.company,
    note: row.note,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    methods: methods.map((m) => ({
      id: m.id,
      type: m.type,
      label: m.label,
      value: m.value,
      sortOrder: m.sort_order,
    })),
  };
}

/** 按 id 批量取联系方式，避免 N+1 查询 */
function methodsOf(ids) {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT id, contact_id, type, label, value, sort_order
         FROM contact_methods
        WHERE contact_id IN (${placeholders})
        ORDER BY contact_id, sort_order, id`
    )
    .all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.contact_id)) map.set(row.contact_id, []);
    map.get(row.contact_id).push(row);
  }
  return map;
}

/**
 * 联系人列表，支持关键字（姓名 / 公司 / 备注 / 任意联系方式）与收藏筛选
 */
function listContacts({ keyword = '', favoriteOnly = false } = {}) {
  const where = [];
  const params = [];

  if (favoriteOnly) where.push('c.favorite = 1');
  if (keyword) {
    const like = `%${keyword}%`;
    where.push(`(
      c.name LIKE ? OR c.company LIKE ? OR c.note LIKE ?
      OR EXISTS (SELECT 1 FROM contact_methods m WHERE m.contact_id = c.id AND m.value LIKE ?)
    )`);
    params.push(like, like, like, like);
  }

  const sql = `
    SELECT c.*
      FROM contacts c
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY c.favorite DESC, c.name COLLATE NOCASE ASC, c.id ASC
  `;

  const rows = db.prepare(sql).all(...params);
  const methodMap = methodsOf(rows.map((r) => r.id));
  return rows.map((row) => toContact(row, methodMap.get(row.id) || []));
}

function getContact(id) {
  const row = db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
  if (!row) return null;
  return toContact(row, methodsOf([id]).get(id) || []);
}

/** 规范化前端传上来的联系方式 */
function normalizeMethods(input) {
  if (!Array.isArray(input)) return [];
  const cleaned = [];
  const seen = new Set();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const type = METHOD_TYPE_VALUES.includes(item.type) ? item.type : 'other';
    const value = String(item.value ?? '').trim();
    if (!value) continue;
    const label = String(item.label ?? '').trim().slice(0, 20);
    const dedupeKey = `${type}|${value}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    cleaned.push({ type, label, value: value.slice(0, 200) });
  }
  return cleaned;
}

function normalizeContact(payload) {
  const name = String(payload?.name ?? '').trim();
  return {
    name,
    company: String(payload?.company ?? '').trim().slice(0, 100),
    note: String(payload?.note ?? '').trim().slice(0, 500),
    favorite: payload?.favorite ? 1 : 0,
    methods: normalizeMethods(payload?.methods),
  };
}

const insertContactStmt = () =>
  db.prepare(
    `INSERT INTO contacts (name, company, note, favorite)
     VALUES (@name, @company, @note, @favorite)`
  );

const insertMethodStmt = () =>
  db.prepare(
    `INSERT INTO contact_methods (contact_id, type, label, value, sort_order)
     VALUES (?, ?, ?, ?, ?)`
  );

function writeMethods(contactId, methods) {
  const insert = insertMethodStmt();
  methods.forEach((m, i) => insert.run(contactId, m.type, m.label, m.value, i));
}

const createTx = db.transaction((data) => {
  const info = insertContactStmt().run({
    name: data.name,
    company: data.company,
    note: data.note,
    favorite: data.favorite,
  });
  const id = Number(info.lastInsertRowid);
  writeMethods(id, data.methods);
  return id;
});

const updateTx = db.transaction((id, data) => {
  db.prepare(
    `UPDATE contacts
        SET name = @name, company = @company, note = @note, favorite = @favorite,
            updated_at = datetime('now', 'localtime')
      WHERE id = @id`
  ).run({
    id,
    name: data.name,
    company: data.company,
    note: data.note,
    favorite: data.favorite,
  });
  db.prepare('DELETE FROM contact_methods WHERE contact_id = ?').run(id);
  writeMethods(id, data.methods);
});

function createContact(payload) {
  const data = normalizeContact(payload);
  if (!data.name) {
    const err = new Error('姓名不能为空');
    err.status = 400;
    throw err;
  }
  const id = createTx(data);
  return getContact(id);
}

function updateContact(id, payload) {
  const existing = db.prepare('SELECT id FROM contacts WHERE id = ?').get(id);
  if (!existing) return null;
  const data = normalizeContact(payload);
  if (!data.name) {
    const err = new Error('姓名不能为空');
    err.status = 400;
    throw err;
  }
  updateTx(id, data);
  return getContact(id);
}

function setFavorite(id, favorite) {
  const info = db
    .prepare(
      `UPDATE contacts SET favorite = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?`
    )
    .run(favorite ? 1 : 0, id);
  if (info.changes === 0) return null;
  return getContact(id);
}

function deleteContact(id) {
  const info = db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  return info.changes > 0;
}

function stats() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
  const favorites = db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE favorite = 1').get().n;
  const methods = db.prepare('SELECT COUNT(*) AS n FROM contact_methods').get().n;
  const byType = db
    .prepare('SELECT type, COUNT(*) AS n FROM contact_methods GROUP BY type')
    .all();
  return { total, favorites, methods, byType };
}

/**
 * 批量导入：以「姓名相同 + 至少一个联系方式相同」判定为同一人，执行合并更新，
 * 否则新增。整个导入放在一个事务里，任何异常都会回滚，保证数据一致性。
 */
const importTx = db.transaction((list) => {
  const result = { inserted: 0, merged: 0 };

  const findByName = db.prepare('SELECT id, favorite FROM contacts WHERE name = ? COLLATE NOCASE');
  const methodsOfContact = db.prepare(
    'SELECT type, label, value FROM contact_methods WHERE contact_id = ?'
  );

  for (const item of list) {
    const candidates = findByName.all(item.name);
    let target = null;

    if (candidates.length > 0) {
      const incomingValues = new Set(item.methods.map((m) => m.value));
      for (const cand of candidates) {
        const existing = methodsOfContact.all(cand.id);
        // 没有任何联系方式时，只要姓名相同就视为同一人
        const hit =
          existing.length === 0
            ? true
            : existing.some((m) => incomingValues.has(m.value));
        if (hit) {
          target = cand;
          break;
        }
      }
    }

    if (target) {
      const existing = methodsOfContact.all(target.id).map((m) => `${m.type}|${m.value}`);
      const added = item.methods.filter((m) => !existing.includes(`${m.type}|${m.value}`));
      const baseOrder = existing.length;
      const insert = insertMethodStmt();
      added.forEach((m, i) => insert.run(target.id, m.type, m.label, m.value, baseOrder + i));
      db.prepare(
        `UPDATE contacts
            SET company = CASE WHEN company = '' THEN ? ELSE company END,
                note    = CASE WHEN note = '' THEN ? ELSE note END,
                favorite = MAX(favorite, ?),
                updated_at = datetime('now', 'localtime')
          WHERE id = ?`
      ).run(item.company, item.note, item.favorite, target.id);
      result.merged += 1;
    } else {
      const info = insertContactStmt().run({
        name: item.name,
        company: item.company,
        note: item.note,
        favorite: item.favorite,
      });
      writeMethods(Number(info.lastInsertRowid), item.methods);
      result.inserted += 1;
    }
  }

  return result;
});

function importContacts(list) {
  return importTx(list);
}

module.exports = {
  listContacts,
  getContact,
  createContact,
  updateContact,
  setFavorite,
  deleteContact,
  stats,
  importContacts,
};
