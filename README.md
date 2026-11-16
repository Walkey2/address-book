# 通讯录 Address Book

> 福州大学《软件工程》（FZU–MU）极限编程作业 —— 支持**收藏联系人**、**一个联系人挂多套联系方式**、**Excel 导入导出**、**可云部署**的通讯录系统。

## 功能一览

| 功能 | 说明 | 对应要求 |
|---|---|---|
| 收藏联系人 | 列表与详情均可一键星标，收藏项置顶并按收藏单独筛选 | 1.1（25 分） |
| 多联系方式 | 一个联系人可自由添加任意多条电话 / 邮箱 / 微信 / QQ / 地址 / 其他，带自定义标签 | 1.2（10 分） |
| 导出 Excel | 一人一行、一类信息一列，同类别多值自动扩展列（电话、电话2…），带表头样式与填写说明页 | 1.3（25 分） |
| 导入 Excel | 识别中英文表头与序号后缀，逐行校验，重复联系人自动合并，导入结果可视化反馈 | 1.3（25 分） |
| 搜索 | 姓名 / 公司 / 备注 / 任意联系方式模糊搜索 | 体验项 |
| 云部署 | 单进程 + 静态资源，可选 Nginx 反代，附完整部署文档 | 1.4（+15 分） |

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
│   └── routes/contacts.js  # 路由层：REST 接口 + 导入导出端点
├── public/
│   ├── index.html          # 单页结构
│   ├── css/style.css       # 样式（卡片化、响应式、深浅两态按钮）
│   └── js/app.js           # 前端状态机与交互逻辑
├── scripts/seed.js         # 演示数据（12 位联系人 / 34 条联系方式）
├── docs/
│   ├── 建仓与部署手册.md    # 从建 GitHub 仓库到云部署的完整操作清单（先看这个）
│   ├── deploy.md           # 阿里云 / 华为云部署实操（命令细节）
│   ├── 代码规范.md          # 分层、命名、SQL、API、提交信息约定
│   ├── 导入示例.xlsx        # 标准导入模板（含示例数据）
│   ├── 作业博客.md          # 作业博客草稿
│   └── screenshots/        # 功能截图
├── data/                   # SQLite 数据文件（运行时生成，已 gitignore）
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

要求 Node.js ≥ 18。数据库文件位于 `data/addressbook.db`，首次启动自动创建，无需手动建表。

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

见 [docs/deploy.md](docs/deploy.md)，涵盖阿里云 / 华为云 ECS 命令行部署与宝塔面板部署两种方式。

## 提交到 GitHub（commit 拆分建议）

作业要求 commit ≥ 3 次，且博客要展示每位贡献者的提交次数。**请先用你自己的 GitHub 身份配置并提交**，否则提交人统计会对不上。

逐条命令、网页上点哪里、报错怎么处理，见 **[docs/建仓与部署手册.md](docs/建仓与部署手册.md)**。速览版：

```bash
cd address-book
git init
git config user.name  "你的名字"
git config user.email "你的GitHub邮箱"

# 分 6 次提交，每个提交只做一件事（每条 add 后先 git status --short 核对清单）
git add package.json package-lock.json .gitignore .gitattributes && git commit -m "chore: 初始化项目结构与依赖"
git add server/db.js server/repository.js && git commit -m "feat: 联系人数据模型与仓储层（收藏、多联系方式）"
git add server/excel.js && git commit -m "feat: Excel 导入导出（表头别名、重复合并、样式）"
git add server/index.js server/routes && git commit -m "feat: REST 接口、收藏切换与静态资源服务"
git add public && git commit -m "feat: 前端页面、收藏筛选与动态联系方式编辑"
git add docs README.md scripts && git commit -m "docs: 补充部署文档、代码规范与作业博客"

# 关联远程仓库并推送
git branch -M main
git remote add origin https://github.com/<你的用户名>/address-book.git
git push -u origin main
```

> 建 GitHub 仓库时**不要勾** Add a README / .gitignore / license，否则远程已有提交，push 会报 `rejected: fetch first`。
> `node_modules/` 与 `data/*.db` 已被 `.gitignore` 排除，不会误提交；`package-lock.json` 必须提交，保证依赖可复现。

## 开发约定

- 分支：`main` 为可运行版本，功能开发走 `feat/*` 分支后合并；
- 提交信息遵循 `类型: 摘要`（`feat` / `fix` / `docs` / `style` / `refactor`）；
- 服务端统一 `'use strict'`，SQL 只出现在 `repository.js`，路由层不写 SQL；
- 前端不使用内联事件属性，统一事件委托，所有插入 HTML 的文本经 `esc()` 转义。

## License

MIT
