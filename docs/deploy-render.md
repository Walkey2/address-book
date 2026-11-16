# 部署到 Render（免费云平台）

> Render 是一个支持 Node.js 的云托管平台，绑定 GitHub 仓库后自动构建部署，免费额度足够课程演示使用。
> 本文覆盖：一次性建服务、环境变量、免费实例的两个坑、以及付费持久化磁盘的配置。

---

## 0. 与阿里云 / 华为云的区别

| 项 | 阿里云 ECS / 华为云 | Render |
|---|---|---|
| 形态 | 一台你能 ssh 登录的虚拟机 | 托管平台，只管推代码 |
| 操作系统维护 | 自己装 Node、配 PM2、配 Nginx | 平台负责，你只提供构建与启动命令 |
| 访问地址 | `http://公网IP` | `https://<服务名>.onrender.com`（自带 HTTPS） |
| 磁盘 | 持久 | **免费实例临时**，重启后文件重置 |
| 休眠 | 不休眠 | 免费实例 15 分钟无访问即挂起 |
| 国内访问 | 稳定 | 一般，选 Singapore 区域会好一些 |

> 结论：Render 上手快、自带 HTTPS，适合"交一个能点的链接"；代价是免费实例会休眠、磁盘不持久。

---

## 1. 前置准备

- [ ] 代码已推送到 GitHub（本项目即 `https://github.com/Walkey2/address-book`）
- [ ] 仓库里有 `render.yaml`（已在仓库根目录提供，用于一键创建服务）
- [ ] 仓库里有 `package-lock.json`（构建用 `npm ci`，缺了会失败）

---

## 2. 创建服务（图形界面，约 5 分钟）

1. 打开 https://dashboard.render.com/ ，点 **Sign in with GitHub**（用 GitHub 授权登录，免注册）
2. 首次登录会要求授权 Render 读取仓库，点 **Authorize**，可选择只授权 `address-book` 这一个仓库
3. 点右上角 **New +** → 选择 **Blueprint**
4. 选中 `address-book` 仓库 → Render 会读到根目录的 `render.yaml`，直接显示服务预览
5. 点 **Apply** / **Create**，等待构建

若不走 Blueprint，也可以手动 **New + → Web Service**，按下面填：

| 字段 | 值 |
|---|---|
| Name | `address-book`（决定最终域名 `<name>.onrender.com`） |
| Region | **Singapore**（国内访问相对快） |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `npm ci` |
| Start Command | `node server/index.js` |
| Instance Type | `Free` |
| Health Check Path | `/api/health` |

环境变量（Environment → Add Environment Variable）：

| Key | Value | 作用 |
|---|---|---|
| `NODE_VERSION` | `20.18.0` | 锁定 Node 版本，避免默认版本变化导致原生模块不匹配 |
| `AUTO_SEED` | `1` | 数据库为空时自动灌入 12 条演示数据（免费实例重启后不会白屏） |

> 应用已适配平台注入的 `PORT` 环境变量，无需手动指定端口。

---

## 3. 验证部署

构建日志出现下面这段即启动成功：

```
 通讯录服务已启动
 本地访问: http://localhost:10000
 数据库  : /opt/render/project/src/data/addressbook.db
[auto-seed] 数据库为空，已写入 12 条演示数据
```

1. 浏览器打开 `https://<服务名>.onrender.com/api/health`，应返回 `{"success":true,"status":"ok"}`
2. 打开首页，应该能看到 12 位演示联系人
3. 新建一个联系人 → 点导出，确认能下载 Excel
4. **关掉 WiFi，用手机流量再打开一次**，能开才算真正公网可达

---

## 4. 免费实例的两个坑（必须知道）

### 4.1 冷启动：首次访问要等 30–60 秒

免费实例 15 分钟无访问就挂起，下一次访问时平台要重新拉起容器。表现是**浏览器转圈几十秒，甚至先返回 502**。

处理办法：
- 博客里写明"首次访问需等待约 30–60 秒冷启动"，避免老师以为打不开就放弃；
- 交作业前一小时自己先访问一次热起来；
- 有条件的话用免费监控（如 UptimeRobot）每 10 分钟 ping 一次 `/api/health`，保持实例常驻。

### 4.2 磁盘不持久：重启后数据重置

免费实例的文件系统是临时的，重新部署或长时间休眠后会回到初始状态。本项目通过 `AUTO_SEED=1` 在空库时写入演示数据，所以页面不会空，但**你手动添加的联系人会消失**。

如果要真正持久（推荐给正式演示）：

1. 把实例类型升到 **Starter（约 $7/月）**；
2. 在服务页面 **Disks → Add Disk**：Name `data`，Mount Path `/var/data`，Size `1 GB`；
3. 添加环境变量 `DB_PATH=/var/data/addressbook.db`；
4. 重新部署。此后 SQLite 文件落在持久磁盘上，重启不丢。

`render.yaml` 中已预留这段配置（默认注释掉），付费后取消注释即可。

---

## 5. 常见构建失败

| 日志关键字 | 原因 | 处理 |
|---|---|---|
| `npm ci can only install packages when your package.json and package-lock.json are in sync` | 本地改过依赖但没提交锁文件 | 本地 `npm install` 后提交 `package-lock.json` |
| `gyp ERR!` / `node-gyp` 报错 | better-sqlite3 缺少预编译包，需要现场编译 | 确认 `NODE_VERSION` 为 `20.18.0`；Render 自带编译工具链，一般锁版本即可解决 |
| `Error: Cannot find module '/opt/render/project/src/server/index.js'` | Start Command 路径写错 | 必须是 `node server/index.js`，注意区分大小写 |
| 部署成功但访问 502 | 应用没监听平台给的端口 | 代码已用 `process.env.PORT`，检查是否手动写死了 3000 |
| 上传 Excel 返回 413 | 平台或代理的请求体限制 | 本项目限制 10MB，正常 Excel 远小于此；超限请拆分文件 |

---

## 6. 写进博客的表述

部署成功后，博客 3.5 节建议这样写（含冷启动说明，显得专业且避免误解）：

> 部署环境：Render 免费实例，Singapore 区域，Node.js 20.18.0，绑定 GitHub `main` 分支自动构建部署，自带 HTTPS。
> 技术要点：应用监听平台注入的 `PORT`；SQLite 数据文件存放于实例临时磁盘，通过 `AUTO_SEED=1` 在空库时自动写入演示数据，保证实例重启后仍可演示；健康检查路径 `/api/health`。
> 访问地址：https://<服务名>.onrender.com （免费实例 15 分钟无访问会休眠，首次打开需等待 30–60 秒冷启动）
