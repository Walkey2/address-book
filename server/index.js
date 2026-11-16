'use strict';

/**
 * 应用入口：组装中间件、静态资源与 API 路由，并启动 HTTP 服务。
 * 本地运行：npm start   →  http://localhost:3000
 * 云端运行：PORT=80 npm start（建议前面再挂一层 Nginx）
 */

const path = require('node:path');
const express = require('express');
const apiRouter = require('./routes/contacts');
const repo = require('./repository');
const { autoSeedIfEmpty } = require('./demo-data');
const { DB_PATH } = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// 导入接口用原始二进制接收上传的 xlsx，避免引入 multipart 解析依赖
app.use('/api/import', express.raw({ type: () => true, limit: '10mb' }));
// 其余接口使用 JSON
app.use(express.json({ limit: '2mb' }));

// 关闭 x-powered-by，减少无谓的信息暴露
app.disable('x-powered-by');

// 静态资源（前端单页）
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h' }));

// API
app.use('/api', apiRouter);

// 未匹配的 API 统一返回 JSON 404
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, message: `接口不存在: ${req.method} ${req.originalUrl}` });
});

// 单页应用兜底：非 API 的 GET 请求都返回首页
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) {
    console.error('[server error]', err);
  }
  res.status(status).json({
    success: false,
    message: status >= 500 ? '服务器内部错误，请稍后重试' : err.message,
  });
});

// 云端（如 Render 免费实例）重启后磁盘会重置，数据库为空时自动灌入演示数据
if (process.env.AUTO_SEED === '1') {
  const result = autoSeedIfEmpty(repo);
  if (result.seeded) {
    console.log(`[auto-seed] 数据库为空，已写入 ${result.inserted} 条演示数据`);
  } else {
    console.log(`[auto-seed] 已存在 ${result.existing} 条数据，跳过`);
  }
}

const server = app.listen(PORT, HOST, () => {
  console.log('----------------------------------------------');
  console.log(' 通讯录服务已启动');
  console.log(` 本地访问: http://localhost:${PORT}`);
  console.log(` 数据库  : ${DB_PATH}`);
  console.log('----------------------------------------------');
});
// 优雅退出：先停止接收新请求，再关闭数据库连接
function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭服务...`);
  server.close(() => {
    try {
      require('./db').db.close();
    } catch (e) {
      /* 忽略关闭异常 */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
