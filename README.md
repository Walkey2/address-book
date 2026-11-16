# 通讯录 Address Book

> 一个支持**收藏联系人**、**一个联系人挂多套联系方式**、**Excel 导入导出**、**可部署到云服务器**的通讯录系统。后端 Node.js + Express + SQLite，前端原生 HTML/CSS/JS，无构建步骤。

## 功能一览

| 功能 | 说明 |
|---|---|
| 收藏联系人 | 列表与详情均可一键星标，收藏项置顶，并可按收藏单独筛选 |
| 多联系方式 | 一个联系人可添加任意多条电话 / 邮箱 / 微信 / QQ / 地址 / 其他，支持自定义标签（工作、家庭…） |
| 导出 Excel | 一人一行、一类信息一列，同类别多值自动扩展列（电话、电话2…），带表头样式与填写说明页 |
| 导入 Excel | 识别中英文表头与序号后缀，逐行校验，重复联系人自动合并，导入结果可视化反馈 |
| 搜索 | 姓名 / 公司 / 备注 / 任意联系方式模糊搜索 |
| 部署 | 单进程 + 静态资源，可选 Nginx 反代，附完整部署文档 |

## 技术栈

- **后端**：Node.js 18+ / Express 4 / better-sqlite3（SQLite，WAL 模式）
- **前端**：原生 HTML + CSS + JavaScript，无构建步骤，零框架依赖
- **Excel**：ExcelJS（读写 .xlsx，导出带样式）
- **架构**：分层设计 —— 路由层（HTTP 语义）→ 仓储层（SQL）→ 数据层（连接与建表），Excel 解析独立成模块

## 目录结构

```
address-book/
├── server/
│   ├── index.js            # 应用入口：中间件、静态资源、错误处理、优雅退出
│   ├── db.js               # SQLite 连接、建表、索引、类型枚举
│   ├── repository.js       # 仓储层：全部 SQL 与导入合并事务
│   ├── excel.js            # Excel 导入导出（表头别名、样式、校验）
│   ├── demo-data.js        # 演示数据集与空库自动灌入逻辑
│   └── routes/contacts.js  # 路由层：REST 接口 + 导入导出端点
├── public/
│   ├── index.html          # 单页结构
│   ├── css/style.css       # 样式（卡片化、响应式、深浅两态按钮）
│   └── js/app.js           # 前端状态机与交互逻辑
├── scripts/seed.js         # 演示数据（12 位联系人 / 34 条联系方式）
├── docs/
│   ├── deploy-render.md    # 部署到 Render（免费云平台，含休眠与磁盘限制说明）
│   ├── deploy.md           # 阿里云 / 华为云 ECS 部署实操
│   ├── 代码规范.md          # 分层、命名、SQL、API、提交信息约定
│   ├── 导入示例.xlsx        # 标准导入模板（含示例数据）
│   ├── 作业博客.md          # 项目开发记录（功能实现思路、测试、问题复盘）
│   └── screenshots/        # 功能截图
├── data/                   # SQLite 数据文件（运行时生成，已 gitignore）
├── render.yaml             # Render 部署蓝图（构建/启动命令、环境变量）
└── package.json
```

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 写入演示数据（可选）
npm run seed

# 3. 启动
npm start
# 打开 http://localhost:3000
```

要求 Node.js ≥ 18。数据库文件位于 `data/addressbook.db`，首次启动自动创建，无需手动建表；删除该文件即可重置为空白通讯录。

## 数据模型

```
contacts                           contact_methods
--------                           ----------------
id          INTEGER PK             id          INTEGER PK
name        TEXT NOT NULL          contact_id  INTEGER FK → contacts.id (ON DELETE CASCADE)
company     TEXT                   type        TEXT  phone/email/wechat/qq/address/other
note        TEXT                   label       TEXT  自定义标签，如"工作""家庭"
favorite    INTEGER 0/1            value       TEXT
created_at  TEXT                   sort_order  INTEGER
updated_at  TEXT
```

联系方式独立成表而非塞进 JSON 字段，原因有三：可直接按值建索引做模糊搜索；新增类型无需改表；删除联系人时靠外键级联，不会留下孤儿数据。

## API 说明

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/contacts?keyword=&favorite=1` | 列表，支持关键字与收藏筛选 |
| GET | `/api/contacts/:id` | 单个联系人（含全部联系方式） |
| POST | `/api/contacts` | 新建，body: `{name, company, note, favorite, methods:[{type,label,value}]}` |
| PUT | `/api/contacts/:id` | 全量更新 |
| PATCH | `/api/contacts/:id/favorite` | 切换收藏，body: `{favorite: true}` |
| DELETE | `/api/contacts/:id` | 删除（级联删联系方式） |
| GET | `/api/export?keyword=&favorite=1` | 导出 xlsx，返回文件流 |
| POST | `/api/import` | 导入 xlsx，请求体为文件原始二进制 |
| GET | `/api/stats` | 总数 / 收藏数 / 联系方式分类统计 |
| GET | `/api/meta` | 联系方式类型枚举 |
| GET | `/api/health` | 健康检查（供部署探活） |

所有接口统一返回 `{ success, data, message }`。

导入接口采用 `application/octet-stream` 原始二进制上传，而不是 multipart 表单，因此不需要 multer 之类的解析中间件，少一个依赖、少一层出错可能。

## Excel 格式约定

| 姓名* | 公司 | 备注 | 收藏 | 电话 | 电话2 | 邮箱 | 微信 | QQ | 地址 | 其他 |

- 姓名为必填，为空的行会被跳过并在导入结果中列出具体行号；
- 表头支持别名与序号后缀：`手机号` / `手机号2` / `mobile` / `邮箱` / `email`；
- 无法识别的自定义列（如"飞书"）会保留为「其他」类型，标签沿用原表头，数据不丢；
- 「收藏」列填 是 / 否 / 1 / 0，留空视为否；
- 同类别最多导出 5 列；导入时的重复判定规则：**姓名相同 且 至少一个联系方式相同** → 合并，否则新增。

可直接用 `docs/导入示例.xlsx` 试导入，也可以先导出再原样导入（已验证幂等：12 条数据回灌结果为新增 0、合并 12）。

## 部署

| 方式 | 文档 | 适用 |
|---|---|---|
| Render（推荐，免费） | [docs/deploy-render.md](docs/deploy-render.md) | 绑定 GitHub 自动构建，自带 HTTPS，5 分钟上线 |
| 阿里云 / 华为云 ECS | [docs/deploy.md](docs/deploy.md) | 需要完整控制虚拟机时使用，含 Nginx 反代与宝塔面板两种做法 |

应用读取平台注入的 `PORT` 环境变量，并支持以下可选环境变量：

| 变量 | 说明 |
|---|---|
| `PORT` | 监听端口，默认 3000 |
| `HOST` | 监听地址，默认 0.0.0.0 |
| `DB_PATH` | SQLite 文件路径，默认 `data/addressbook.db` |
| `AUTO_SEED` | 设为 `1` 时，启动时若数据库为空则自动写入演示数据（用于磁盘不持久的托管平台） |

## 开发与提交

- **分支**：`main` 始终保持可运行状态；新增功能在 `feat/*` 分支开发，自测通过后合并回 `main`。
- **提交粒度**：一个提交只做一件事，按"工程骨架 → 数据层 → 文件处理 → 接口 → 前端 → 文档"的顺序推进，便于回溯与 review。
- **提交信息**：`类型: 摘要`，类型取 `feat` / `fix` / `docs` / `style` / `refactor` / `chore`，摘要不超过 50 字符。
- **代码约定**：服务端统一 `'use strict'`，SQL 只出现在 `repository.js`，路由层不写 SQL；前端不使用内联事件属性，统一事件委托，所有插入 HTML 的文本经 `esc()` 转义。详见 [docs/代码规范.md](docs/代码规范.md)。

```bash
# 典型的一次功能提交
git checkout -b feat/import-export
# ……开发与自测……
git add server/excel.js
git commit -m "feat: Excel 导入导出（表头别名、重复合并、样式）"
git checkout main && git merge --no-ff feat/import-export
```

> `node_modules/` 与 `data/*.db` 已被 `.gitignore` 排除；`package-lock.json` 保留在仓库中，保证依赖可复现。

## License

MIT
