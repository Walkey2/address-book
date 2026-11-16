'use strict';

/**
 * Excel 导入 / 导出模块
 *
 * 导出规则（与作业要求一致）：
 *   - 一个联系人占一行；
 *   - 每一类信息占一列（姓名、公司、备注、收藏、电话1..n、邮箱1..n、微信、QQ、地址、其他）；
 *   - 同一类别有多个值时自动向右扩展列（电话1、电话2 …），表头固定所以可被重新导入。
 *
 * 导入规则：
 *   - 表头按中文/英文别名识别，允许带序号后缀（电话2 / 手机号3 / Email2）；
 *   - 无法识别的表头若列内有值，则归入"其他"并保留原表头作为标签，避免数据丢失；
 *   - 姓名为空的行视为无效行，跳过并记录错误；
 *   - 完全空白的行静默跳过。
 */

const ExcelJS = require('exceljs');
const { METHOD_TYPES } = require('./db');

const METHOD_LABEL = Object.fromEntries(METHOD_TYPES.map((t) => [t.value, t.label]));

/** 字段别名表（全部小写、去掉空格后做精确匹配） */
const FIELD_ALIASES = {
  name: ['姓名', '名字', '名称', '联系人', '联系人姓名', 'name', 'fullname'],
  company: ['公司', '单位', '公司名称', '工作单位', '所属公司', 'company', 'organization', 'org'],
  note: ['备注', '说明', '备注信息', 'note', 'remark', 'remarks', 'memo'],
  favorite: ['收藏', '星标', '是否收藏', 'favorite', 'star', 'starred'],
};

const METHOD_ALIASES = {
  phone: ['电话', '手机', '手机号', '手机号码', '电话号码', '联系电话', '座机', 'phone', 'mobile', 'tel', 'telephone'],
  email: ['邮箱', '电子邮箱', '邮件', '电子邮件', 'email', 'mail'],
  wechat: ['微信', '微信号', 'wechat', 'weixin'],
  qq: ['qq', 'qq号'],
  address: ['地址', '住址', '通讯地址', '家庭地址', 'address'],
  other: ['其他', '其它', 'other'],
};

/** 导出时的列顺序，决定 Excel 中列的左右顺序 */
const EXPORT_ORDER = ['phone', 'email', 'wechat', 'qq', 'address', 'other'];

const MAX_SLOTS = 5; // 同一类别最多导出 5 列，防止异常数据把表格撑爆

/* ------------------------------------------------------------------ */
/* 导出                                                                */
/* ------------------------------------------------------------------ */

/**
 * 把联系人数组（含 methods）转换成 Excel 工作簿 Buffer
 * @param {Array} contacts
 * @returns {Promise<Buffer>}
 */
async function buildWorkbook(contacts) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Address Book (FZU-MU SE)';
  wb.created = new Date();

  // 1. 计算每类联系方式需要的列数
  const slots = {};
  for (const type of EXPORT_ORDER) {
    const maxUsed = contacts.reduce(
      (max, c) => Math.max(max, (c.methods || []).filter((m) => m.type === type).length),
      0
    );
    slots[type] = Math.min(MAX_SLOTS, Math.max(1, maxUsed));
  }

  // 2. 生成表头
  const columns = [
    { header: '姓名', key: 'name', width: 12 },
    { header: '公司', key: 'company', width: 18 },
    { header: '备注', key: 'note', width: 24 },
    { header: '收藏', key: 'favorite', width: 8 },
  ];
  for (const type of EXPORT_ORDER) {
    for (let i = 0; i < slots[type]; i += 1) {
      const header = i === 0 ? METHOD_LABEL[type] : `${METHOD_LABEL[type]}${i + 1}`;
      columns.push({ header, key: `${type}_${i + 1}`, width: Math.max(14, header.length * 2 + 4) });
    }
  }
  // 身份证/其他长文本列宽放宽
  for (const col of columns) {
    if (col.header.startsWith('地址') && col.width < 30) col.width = 30;
  }

  const ws = wb.addWorksheet('通讯录', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = columns;

  // 3. 表头样式
  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFBFD3F5' } },
      left: { style: 'thin', color: { argb: 'FFBFD3F5' } },
      bottom: { style: 'thin', color: { argb: 'FFBFD3F5' } },
      right: { style: 'thin', color: { argb: 'FFBFD3F5' } },
    };
  });

  // 4. 数据行
  contacts.forEach((c, idx) => {
    const rowData = {
      name: c.name || '',
      company: c.company || '',
      note: c.note || '',
      favorite: c.favorite ? '是' : '否',
    };
    const bucket = {};
    for (const type of EXPORT_ORDER) {
      bucket[type] = (c.methods || [])
        .filter((m) => m.type === type)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((m) => m.value);
      for (let i = 0; i < slots[type]; i += 1) {
        rowData[`${type}_${i + 1}`] = bucket[type][i] || '';
      }
    }
    const row = ws.addRow(rowData);
    row.height = 20;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.alignment = { vertical: 'middle', wrapText: colNumber === 3 };
      cell.border = {
        bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } },
      };
    });
    // 收藏列用金色标记，便于肉眼筛选
    if (c.favorite) {
      const favCell = row.getCell(4);
      favCell.font = { bold: true, color: { argb: 'FFB45309' } };
      favCell.alignment = { vertical: 'middle', horizontal: 'center' };
    } else {
      row.getCell(4).alignment = { vertical: 'middle', horizontal: 'center' };
    }
    // 斑马纹
    if (idx % 2 === 1) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      });
    }
  });

  // 5. 自动筛选
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, ws.rowCount), column: columns.length },
  };

  // 6. 附一张说明页（放在第 2 个 sheet，导入时只读第 1 个 sheet，不影响解析）
  const guide = wb.addWorksheet('填写说明');
  guide.columns = [{ width: 96 }];
  [
    '通讯录导入模板说明',
    '',
    '1. 第一行为表头，请勿删除或修改表头文字；数据从第二行开始。',
    '2. 一行代表一个联系人；姓名为必填项，姓名为空的行会被跳过。',
    '3. 一个联系人可以有多个电话/邮箱，请填写在“电话2”“邮箱2”等带序号的列中。',
    '4. “收藏”列填写 是 / 否（也可填 1 / 0），留空视为“否”。',
    '5. 同一类别最多支持 5 列，超出的信息请合并到“其他”列。',
    '6. 表头支持中文或英文（如 手机号 / mobile、邮箱 / email）。',
    '7. 联系方式的“标签”（如 工作、家庭）不参与导出，仅保存在系统中。',
  ].forEach((text, i) => {
    const row = guide.addRow([text]);
    row.getCell(1).alignment = { vertical: 'middle', wrapText: true };
    if (i === 0) row.font = { bold: true, size: 14, color: { argb: 'FF1E3A8A' } };
    row.height = i === 0 ? 26 : 18;
  });

  return wb.xlsx.writeBuffer();
}

/* ------------------------------------------------------------------ */
/* 导入                                                                */
/* ------------------------------------------------------------------ */

/** 把 exceljs 单元格的各种取值形态统一成字符串 */
function cellText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((r) => r.text).join('').trim();
    if (typeof value.text === 'string') return value.text.trim();
    if (value.result !== undefined) return cellText(value.result);
    if (value.hyperlink) return String(value.hyperlink).trim();
  }
  return String(value).trim();
}

/**
 * 解析表头，返回 { kind: 'field'|'method'|'unknown', field/type, index }
 */
function parseHeader(raw, knownHeaders) {
  const text = cellText(raw).replace(/\s+/g, '').toLowerCase();
  if (!text) return { kind: 'empty' };

  const matched = text.match(/^(.*?)(\d+)?$/);
  const base = matched ? matched[1] : text;
  const index = matched && matched[2] ? Number(matched[2]) : 1;

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    if (aliases.includes(base)) return { kind: 'field', field };
  }
  for (const [type, aliases] of Object.entries(METHOD_ALIASES)) {
    if (aliases.includes(base)) return { kind: 'method', type, index };
  }
  // 已登记过的自定义表头，后续行沿用同一处理方式
  if (knownHeaders && knownHeaders.has(text)) return { kind: 'method', type: 'other', label: knownHeaders.get(text) };
  return { kind: 'unknown' };
}

function parseFavorite(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return 0;
  if (['是', 'y', 'yes', 'true', '1', '★', '收藏'].includes(t)) return 1;
  return 0;
}

/**
 * 解析上传的 Excel 文件
 * @param {Buffer} buffer
 * @returns {Promise<{contacts: Array, errors: Array, totalRows: number}>}
 */
async function parseBuffer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Excel 中没有工作表');

  // 说明书里已经说明表头固定，这里仍做一次空表判断，给出更明确的提示
  if (!ws.rowCount || ws.rowCount < 2) {
    throw new Error('Excel 内容为空：至少需要 1 行表头和 1 行数据');
  }

  const headerRow = ws.getRow(1);
  const columnMap = [];
  const unknownHeaders = new Map();

  for (let col = 1; col <= ws.columnCount; col += 1) {
    const cell = headerRow.getCell(col);
    const spec = parseHeader(cell.value, null);
    if (spec.kind === 'unknown') {
      const label = cellText(cell.value);
      if (!label) {
        columnMap.push({ kind: 'empty' });
        continue;
      }
      unknownHeaders.set(label.replace(/\s+/g, '').toLowerCase(), label);
      columnMap.push({ kind: 'method', type: 'other', label, index: 1 });
      continue;
    }
    columnMap.push(spec);
  }

  const contacts = [];
  const errors = [];
  let totalRows = 0;

  for (let r = 2; r <= ws.rowCount; r += 1) {
    const row = ws.getRow(r);
    totalRows += 1;

    let name = '';
    let company = '';
    let note = '';
    let favorite = 0;
    /** @type {Map<string, {type:string, label:string, values:string[]}>} */
    const methodSlots = new Map();

    for (let col = 1; col <= ws.columnCount; col += 1) {
      const spec = columnMap[col - 1];
      if (!spec || spec.kind === 'empty') continue;
      const value = cellText(row.getCell(col).value);
      if (!value) continue;

      if (spec.kind === 'field') {
        if (spec.field === 'name') name = value;
        else if (spec.field === 'company') company = value;
        else if (spec.field === 'note') note = value;
        else if (spec.field === 'favorite') favorite = parseFavorite(value);
        continue;
      }

      if (spec.kind === 'method') {
        const key = `${spec.type}`;
        if (!methodSlots.has(key)) methodSlots.set(key, { type: spec.type, label: spec.label || '', values: [] });
        const slot = methodSlots.get(key);
        if (slot.values.includes(value)) continue; // 同一行内重复值去重
        slot.values.push(value);
      }
    }

    const methods = [];
    for (const slot of methodSlots.values()) {
      for (const v of slot.values) {
        methods.push({ type: slot.type, label: slot.label || '', value: v });
      }
    }

    // 整行空白，静默跳过
    if (!name && !company && !note && methods.length === 0) {
      totalRows -= 1;
      continue;
    }

    if (!name) {
      errors.push({ row: r, message: `第 ${r} 行缺少“姓名”，已跳过` });
      continue;
    }
    if (name.length > 50) {
      errors.push({ row: r, message: `第 ${r} 行姓名超过 50 个字符，已跳过` });
      continue;
    }

    contacts.push({ name, company, note, favorite, methods });
  }

  return { contacts, errors, totalRows };
}

module.exports = { buildWorkbook, parseBuffer, MAX_SLOTS, EXPORT_ORDER };
