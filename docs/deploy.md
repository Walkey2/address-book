# 云服务器部署实操（阿里云 / 华为云）

> 目标：让通讯录通过公网 IP 直接访问，拿到作业 1.4 的 **+15 分**加分。
> 本文以 **Ubuntu 22.04** 为例，阿里云 ECS 与华为云弹性云服务器（ECS）操作几乎一致，差异处会单独标注。

---

## 0. 准备清单

| 项目 | 说明 |
|---|---|
| 云服务器 | 1 核 2G 起，Ubuntu 22.04 64 位；学生认证可买轻量应用服务器，几十元/月 |
| 公网 IP | 购买时勾选"分配公网 IPv4" |
| 安全组 | 放行 22（SSH）、80（HTTP），如需 HTTPS 再放行 443 |
| 代码 | 已推送到 GitHub 仓库 |

**成本提示**：阿里云"学生机"/华为云"云耀云服务器"都支持按需或包月，做完作业可退订。若只想临时交作业，按量付费几小时即可。

---

## 1. 创建实例并放行端口

**阿里云**：控制台 → 云服务器 ECS → 创建实例 → 镜像选 Ubuntu 22.04 → 分配公网 IP → 创建后进入「安全组」→ 配置规则 → 入方向添加：

| 协议 | 端口 | 授权对象 |
|---|---|---|
| TCP | 22 | 0.0.0.0/0（或你本机 IP，更安全） |
| TCP | 80 | 0.0.0.0/0 |

**华为云**：控制台 → 弹性云服务器 ECS → 购买 → 网络配置里绑定弹性公网 IP → 进入「安全组」→ 入方向规则 → 添加上表两条。

> 安全组没放行是最常见的"部署完打不开"原因，先查这里。

---

## 2. 连接服务器

```bash
ssh root@<你的公网 IP>
# 首次连接输入 yes，再输入实例密码
```

非 root 用户（如 `ubuntu`）需在后续命令前加 `sudo`。

---

## 3. 安装 Node.js 20

```bash
# 更新软件源
apt update && apt install -y curl git

# 使用 NodeSource 源安装 Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# 验证
node -v   # v20.x
npm -v
```

> 国内服务器拉取 NodeSource 较慢时，可改用淘宝镜像：
> `curl -fsSL https://deb.nodesource.com/setup_20.x | bash -s -- --mirror https://npmmirror.com/mirrors/nodejs`

`better-sqlite3` 是原生模块，若安装时提示需要编译，补装构建工具：

```bash
apt install -y build-essential python3
```

---

## 4. 拉取代码并启动

```bash
cd /opt
git clone https://github.com/<你的用户名>/<仓库名>.git address-book
cd address-book

# 安装生产依赖
npm install --omit=dev

# 先手动跑一次，确认能启动
npm start
# 看到「通讯录服务已启动」后用 Ctrl+C 退出
```

**从本地上传**（不想用 Git 时）：

```bash
# 在你自己的电脑上执行
scp -r ./address-book root@<公网IP>:/opt/address-book
```

---

## 5. 用 PM2 常驻运行

`npm start` 关掉 SSH 就停了，需要进程守护：

```bash
npm install -g pm2

cd /opt/address-book
PORT=80 pm2 start server/index.js --name address-book

pm2 save          # 保存当前进程列表
pm2 startup       # 按提示复制执行它输出的一行命令，实现开机自启

pm2 status        # 查看运行状态
pm2 logs address-book   # 查看日志（排错第一站）
```

此时浏览器访问 `http://<公网IP>` 应能看到页面。

> 用 80 端口需要 root 权限，以 root 登录时无问题；普通用户请改用 `PORT=3000` 并配 Nginx（见下一节）。

---

## 6. 推荐：Nginx 反向代理（可选但更规范）

好处：绑定 80 端口、以后接域名和 HTTPS 都不用改应用代码，也避免 Node 直接监听特权端口。

```bash
apt install -y nginx

cat > /etc/nginx/sites-available/address-book <<'EOF'
server {
    listen 80;
    server_name _;              # 有域名时改成你的域名

    client_max_body_size 12m;   # 允许上传 10MB 以内的 xlsx

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/address-book /etc/nginx/sites-enabled/address-book
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

应用改为监听 3000：

```bash
cd /opt/address-book
pm2 delete address-book
PORT=3000 HOST=127.0.0.1 pm2 start server/index.js --name address-book
pm2 save
```

> 配 `HOST=127.0.0.1` 后应用只监听本地，外网必须经 Nginx 进入，更安全。

---

## 7. 验证部署

```bash
curl http://127.0.0.1:3000/api/health          # {"success":true,"status":"ok",...}
curl http://<公网IP>/api/stats                  # 返回统计数据
```

然后在浏览器打开 `http://<公网IP>`，新建一个联系人，刷新页面确认数据还在（证明写入了服务器上的 SQLite 文件）。

**截图留念**：把这个可访问的公网地址、以及页面上新建/导入数据的截图放进博客，作为 1.4 加分的证明材料。

---

## 8. 数据备份（顺手做一下，成本很低）

```bash
# 手动备份
cp /opt/address-book/data/addressbook.db ~/addressbook-$(date +%F).db

# 每天凌晨 3 点自动备份，保留 7 天
crontab -e
# 追加一行：
0 3 * * * cp /opt/address-book/data/addressbook.db /root/backup-$(date +\%F).db && find /root -name "backup-*.db" -mtime +7 -delete
```

> SQLite 开了 WAL，备份时最好先 `pm2 stop` 或使用 `sqlite3 addressbook.db ".backup"` 保证一致性。作业场景直接 cp 也够用。

---

## 9. 不想敲命令？用宝塔面板

适合不熟悉 Linux 的同学，可视化操作，20 分钟能上线：

1. 在服务器上执行宝塔安装脚本（官网提供，按系统版本复制一行命令）；
2. 登录面板（`http://<公网IP>:8888`），在安全页放行 80 端口；
3. 软件商店安装 **Nginx** 与 **PM2 管理器**；
4. 文件管理里把代码上传到 `/www/wwwroot/address-book`；
5. 终端进入目录执行 `npm install --omit=dev`；
6. PM2 管理器 → 添加项目 → 启动文件 `server/index.js`、端口 `3000`；
7. 网站 → 添加站点 → 设置反向代理到 `http://127.0.0.1:3000`。

---

## 10. 常见问题排查

| 现象 | 原因与处理 |
|---|---|
| 浏览器打不开，`curl` 本地却正常 | 安全组未放行 80 端口；或应用 `HOST` 被限制为 127.0.0.1 而 Nginx 没配 |
| `pm2 status` 显示 `errored` | `pm2 logs address-book` 看报错；多为端口被占用或依赖未装全 |
| 导入 Excel 报 413 | Nginx `client_max_body_size` 太小，调到 `12m` 后 `systemctl reload nginx` |
| 页面能开但接口 502 | Node 进程没起来，或 Nginx 代理端口与实际端口不一致 |
| `better-sqlite3` 安装报 `node-gyp` 错误 | `apt install -y build-essential python3` 后重新 `npm install` |
| 重启服务器后访问不了 | 没执行 `pm2 startup` + `pm2 save` |
| 数据库写不进去 | 检查 `data/` 目录属主与写权限：`chown -R root:root data && chmod -R 755 data` |
| 中文文件名下载乱码 | 本项目已在 `Content-Disposition` 里用 `filename*=UTF-8''` 编码，正常浏览器均无问题 |

---

## 11. 加分项材料清单

部署成功后，博客里建议给出：

1. 公网访问地址（`http://<公网IP>/` 或域名）；
2. 服务器上 `pm2 status` 的截图（证明进程常驻）；
3. 页面可用截图 + 导入后的数据截图；
4. 一句话说明部署环境：云厂商、地域、系统版本、Node 版本、进程管理方式。
