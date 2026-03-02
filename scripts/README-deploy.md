# 部署脚本说明

## 1. 访问 /publishBook 时执行部署：Node 服务

`publishBook-server.js` 是一个简易 HTTP 服务：收到对 `/publishBook` 的请求时，在服务器上执行 `deploy-pd_bible-on-server.sh`（拉取 pd_bible 分支并 `pm2 restart pd_bible`，pd=product）。

### 在服务器上运行

1. **用 pm2 常驻运行**（推荐）

   在仓库根目录执行：

   ```bash
   # 可选：项目不在当前目录时指定
   export PROJECT_DIR=/实际/项目/路径

   # 可选：防止被随意触发，设置 token 后请求需带 ?token=xxx 或 Header x-publish-token: xxx
   export PUBLISH_TOKEN=你的随机密钥

   pm2 start scripts/publishBook-server.js --name publishBook
   pm2 save
   ```

   默认监听 **3999** 端口，可通过 `PORT=4000 pm2 start ...` 修改。

2. **临时测试**

   ```bash
   node scripts/publishBook-server.js
   # 另开终端：curl http://localhost:3999/publishBook
   ```

### 让 http://www.quanyuan.live/publishBook 指向该服务

在 **Nginx** 或 **Caddy** 里为 `www.quanyuan.live` 增加对 `/publishBook` 的反向代理，把请求转到本机 3999 端口。

**Nginx 示例**（在对应 `server` 块内）：

```nginx
location = /publishBook {
    proxy_pass http://127.0.0.1:3999;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

**Caddy 示例**：

```caddy
www.quanyuan.live {
    handle /publishBook {
        reverse_proxy 127.0.0.1:3999
    }
    handle {
        # 你的其它站点配置...
    }
}
```

改完重载 Nginx/Caddy 后，访问 `http://www.quanyuan.live/publishBook` 就会触发部署脚本。

---

## 2. 部署脚本本身：deploy-pd_bible-on-server.sh

在**服务器**上由上述服务调用（或手动执行）：拉取 `pd_bible` 分支并执行 `pm2 restart pd_bible`（pd=product）。

- **服务器准备**：
  1. 确保 `scripts/deploy-pd_bible-on-server.sh` 可执行：`chmod +x scripts/deploy-pd_bible-on-server.sh`
  2. 若项目不在脚本所在仓库根目录，运行服务或脚本前设置：`export PROJECT_DIR=/实际/项目/路径`

- **可选鉴权**：在运行 `publishBook-server.js` 时设置 `PUBLISH_TOKEN`，GitHub Actions 需在请求中带上该 token（见下方）。

### 在 GitHub Actions 中带 token 调用

若设置了 `PUBLISH_TOKEN`，可在仓库 Settings → Secrets 里添加 `PUBLISH_BOOK_TOKEN`，并在 workflow 中这样调用：

```yaml
- name: Trigger pd_bible publish
  run: |
    curl -sf --max-time 60 "http://www.quanyuan.live/publishBook?token=${{ secrets.PUBLISH_BOOK_TOKEN }}"
```

或使用 Header：

```yaml
run: |
  curl -sf --max-time 60 -H "x-publish-token: ${{ secrets.PUBLISH_BOOK_TOKEN }}" "http://www.quanyuan.live/publishBook"
```


