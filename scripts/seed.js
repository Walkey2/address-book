'use strict';

/**
 * 演示数据脚本：在本地生成一批带多联系方式的联系人，便于查看效果与截图。
 * 执行：npm run seed
 * 脚本可重复执行，按姓名判断是否已存在，避免重复插入。
 */

const repo = require('../server/repository');
const { db } = require('../server/db');
const { samples } = require('../server/demo-data');

function main() {
  const exists = db.prepare('SELECT 1 FROM contacts WHERE name = ?');
  let inserted = 0;
  let skipped = 0;

  for (const item of samples) {
    if (exists.get(item.name)) {
      skipped += 1;
      continue;
    }
    repo.createContact(item);
    inserted += 1;
  }

  const total = db.prepare('SELECT COUNT(*) AS n FROM contacts').get().n;
  console.log(`演示数据写入完成：新增 ${inserted} 条，跳过已存在 ${skipped} 条，当前共 ${total} 条联系人。`);
  db.close();
}

main();
