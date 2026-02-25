# 在服务器上运行 pj_finance / pj_bible

构建产物发布到单一分支 **pd_tama**（包含两个应用的构建）。在另一台服务器上克隆该分支即可同时跑两个 Next 应用。

## 环境要求

- Node.js >= 18
- npm（与仓库 lockfile 一致）

## 克隆并运行（一个目录跑两个应用）

### 1. 克隆 pd_tama 分支

```bash
git clone --branch pd_tama --single-branch https://github.com/Grace1China/tama.git tama
cd tama
```

### 2. 安装依赖

```bash
npm ci
```

### 3. 挂载 pj_finance 数据目录（生产环境）

若需 TuShare 等数据，将 `apps/pj_finance/temp` 指向实际数据路径后再启动：

```bash
ln -snf /data/tuShare apps/pj_finance/temp
```

### 4. 启动两个应用

两个应用端口不同，可同机运行：pj_bible **3000**，pj_finance **3002**。

**方式 A：开两个终端分别启动**

```bash
# 终端 1 - 圣经
npm run start -w pj_bible
# 访问 http://服务器IP:3000

# 终端 2 - 金融
npm run start -w pj_finance
# 访问 http://服务器IP:3002/finance
```

**方式 B：后台运行（pm2）**

```bash
pm2 start "npm run start -w pj_bible" --name pj_bible --cwd "$(pwd)"
pm2 start "npm run start -w pj_finance" --name pj_finance --cwd "$(pwd)"
```

**方式 C：nohup**

```bash
nohup npm run start -w pj_bible > bible.log 2>&1 &
nohup npm run start -w pj_finance > finance.log 2>&1 &
```

---

## 更新到最新构建

```bash
cd tama
git fetch origin pd_tama
git reset --hard origin/pd_tama
npm ci
# 再重启两个进程（pm2 restart 或重新执行 start）
```

---

## 端口与访问路径

| 应用        | 端口 | 访问路径（根路径） |
|-------------|------|---------------------|
| pj_bible    | 3000 | `/`                 |
| pj_finance  | 3002 | `/finance`          |

若用 Nginx 反代：

- pj_bible:   `proxy_pass http://127.0.0.1:3000;`
- pj_finance: `proxy_pass http://127.0.0.1:3002;`（前端路由需带 `/finance`）
