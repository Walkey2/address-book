'use strict';

/**
 * 数据访问层：负责 SQLite 连接、建表与索引。
 *
 * 设计说明：
 *   联系人（contacts）与联系方式（contact_methods）是一对多关系，
 *   把联系方式拆成独立表，才能支持"一个联系人挂任意多个电话/邮箱/社交账号"，
 *   同时便于按类别排序、统计与后续扩展（比如再加"传真"只需加一种 type，无需改表结构）。
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// 允许通过环境变量指定数据库位置，便于在云服务器上把数据放到独立数据盘
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'addressbook.db');

const db = new Database(DB_PATH);

// WAL 模式：读写并发更好，写操作不会阻塞读
db.pragma('journal_mode = WAL');
// 开启外键约束，删除联系人时级联删除其联系方式
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    company    TEXT    NOT NULL DEFAULT '',
    note       TEXT    NOT NULL DEFAULT '',
    favorite   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  );

  CREATE TABLE IF NOT EXISTS contact_methods (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id INTEGER NOT NULL,
    type       TEXT    NOT NULL,
    label      TEXT    NOT NULL DEFAULT '',
    value      TEXT    NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (contact_id) REFERENCES contacts (id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_methods_contact ON contact_methods (contact_id);
  CREATE INDEX IF NOT EXISTS idx_contacts_name   ON contacts (name);
  CREATE INDEX IF NOT EXISTS idx_contacts_fav    ON contacts (favorite);
`);

/** 允许的联系方式类型，前端下拉框与后端校验共用同一份定义 */
const METHOD_TYPES = [
  { value: 'phone', label: '电话' },
  { value: 'email', label: '邮箱' },
  { value: 'wechat', label: '微信' },
  { value: 'qq', label: 'QQ' },
  { value: 'address', label: '地址' },
  { value: 'other', label: '其他' },
];
const METHOD_TYPE_VALUES = METHOD_TYPES.map((t) => t.value);

module.exports = { db, DB_PATH, ROOT_DIR, METHOD_TYPES, METHOD_TYPE_VALUES };
