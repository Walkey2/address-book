'use strict';

/**
 * 路由层：只负责解析请求参数、调用仓储层、组织响应。
 */

const express = require('express');
const repo = require('../repository');
const { buildWorkbook, parseBuffer } = require('../excel');
const { METHOD_TYPES } = require('../db');

const router = express.Router();

/** 统一成功响应 */
const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });

/** 统一失败响应 */
function fail(res, status, message, extra = {}) {
  return res.status(status).json({ success: false, message, ...extra });
}

/** 业务异常统一处理（同步路由用） */
function handle(fn) {
  return (req, res, next) => {
    try {
      fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

/* ---------------------------- 元数据 ---------------------------- */

router.get('/meta', (req, res) => {
  ok(res, { methodTypes: METHOD_TYPES });
});

router.get('/health', (req, res) => {
  res.json({ success: true, status: 'ok', uptime: process.uptime() });
});

/* ---------------------------- 联系人 ---------------------------- */

router.get(
  '/contacts',
  handle((req, res) => {
    const keyword = String(req.query.keyword || '').trim();
    const favoriteOnly = req.query.favorite === '1' || req.query.favorite === 'true';
    const list = repo.listContacts({ keyword, favoriteOnly });
    ok(res, list, { count: list.length });
  })
);

router.get(
  '/contacts/:id',
  handle((req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return fail(res, 400, '非法的联系人 ID');
    const contact = repo.getContact(id);
    if (!contact) return fail(res, 404, '联系人不存在');
    return ok(res, contact);
  })
);

router.post(
  '/contacts',
  handle((req, res) => {
    const contact = repo.createContact(req.body || {});
    res.status(201).json({ success: true, data: contact });
  })
);

router.put(
  '/contacts/:id',
  handle((req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return fail(res, 400, '非法的联系人 ID');
    const contact = repo.updateContact(id, req.body || {});
    if (!contact) return fail(res, 404, '联系人不存在');
    return ok(res, contact);
  })
);

/** 收藏 / 取消收藏，单独抽一个接口，前端点星标时不用回传整条记录 */
router.patch(
  '/contacts/:id/favorite',
  handle((req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return fail(res, 400, '非法的联系人 ID');
    const contact = repo.setFavorite(id, Boolean(req.body?.favorite));
    if (!contact) return fail(res, 404, '联系人不存在');
    return ok(res, contact);
  })
);

router.delete(
  '/contacts/:id',
  handle((req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return fail(res, 400, '非法的联系人 ID');
    const removed = repo.deleteContact(id);
    if (!removed) return fail(res, 404, '联系人不存在');
    return ok(res, { id });
  })
);

router.get(
  '/stats',
  handle((req, res) => {
    ok(res, repo.stats());
  })
);

/* -------------------------- 导入 / 导出 -------------------------- */

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

router.get(
  '/export',
  async (req, res, next) => {
    try {
      const keyword = String(req.query.keyword || '').trim();
      const favoriteOnly = req.query.favorite === '1';
      const contacts = repo.listContacts({ keyword, favoriteOnly });
      const buffer = await buildWorkbook(contacts);
      const filename = `通讯录_${timestamp()}.xlsx`;
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="address-book_${timestamp()}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`
      );
      res.setHeader('X-Export-Count', String(contacts.length));
      res.send(Buffer.from(buffer));
    } catch (err) {
      next(err);
    }
  }
);

router.post('/import', async (req, res, next) => {
  try {
    const buffer = Buffer.isBuffer(req.body) ? req.body : null;
    if (!buffer || buffer.length === 0) {
      return fail(res, 400, '没有收到文件内容，请重新选择 Excel 文件');
    }
    // xlsx 是 zip 格式，魔数固定为 PK\x03\x04
    if (!(buffer[0] === 0x50 && buffer[1] === 0x4b)) {
      return fail(res, 400, '文件格式不正确，仅支持 .xlsx 文件');
    }

    const { contacts, errors, totalRows } = await parseBuffer(buffer);
    if (contacts.length === 0) {
      return fail(res, 400, '没有解析到有效数据，请检查表头与姓名列', {
        detail: { totalRows, errors, inserted: 0, merged: 0 },
      });
    }

    const result = repo.importContacts(contacts);
    return ok(res, {
      totalRows,
      parsed: contacts.length,
      inserted: result.inserted,
      merged: result.merged,
      errors,
    });
  } catch (err) {
    if (err && /zip|corrupt|end of data|Invalid/i.test(String(err.message))) {
      return fail(res, 400, 'Excel 文件已损坏或不是标准的 .xlsx 格式');
    }
    return next(err);
  }
});

module.exports = router;
