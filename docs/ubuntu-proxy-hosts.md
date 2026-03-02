# Ubuntu 服务器：代理与 Hosts 优化连接

在国内或网络受限的 Ubuntu 服务器上，可通过**代理**或**Hosts 优化**加速访问 GitHub、npm 等。

---

## 个人用 + 便宜：香港 VPS 自建 Shadowsocks（服务器 + 本机共用）

一台香港 VPS 跑 SS 服务端，**服务器**和**本机**都作为客户端连上去，只付一份 VPS 钱，最省钱。

### 1. 买一台香港 VPS（便宜即可）

- **Vultr**、**Linode**、**RackNerd** 等选 **Hong Kong** 节点，月付约 $5–6 的 1 核 1G 即可。
- 系统选 **Ubuntu 22.04**，创建后记下 **公网 IP** 和 root 密码。

### 2. 在 VPS 上装 Shadowsocks 服务端（一键）

SSH 登录到香港 VPS 后执行（任选一种）：

**方式 A：shadowsocks-libev（常用一键脚本）**

```bash
wget -qO- https://raw.githubusercontent.com/teddysun/shadowsocks_install/master/shadowsocks-libev-debian.sh | bash
# 按提示设置端口（如 8388）和密码，记下
```

**方式 B：若上面脚本不可用，手动安装**

```bash
sudo apt update && sudo apt install -y shadowsocks-libev
sudo nano /etc/shadowsocks-libev/config.json
```

`config.json` 示例（端口、密码自己改）：

```json
{
  "server": "0.0.0.0",
  "server_port": 8388,
  "password": "你设的密码",
  "timeout": 300,
  "method": "aes-256-gcm"
}
```

```bash
sudo systemctl enable shadowsocks-libev@config
sudo systemctl start shadowsocks-libev@config
```

记下：**香港 VPS 公网 IP**、**端口**（如 8388）、**密码**、**加密 method**（如 aes-256-gcm）。

### 3. 本机使用（Windows / Mac）

- **Windows**：装 [Shadowsocks-Windows](https://github.com/shadowsocks/shadowsocks-windows/releases)，填服务器 IP、端口、密码、加密方式，启用「系统代理」或「PAC」即可浏览器/部分软件走代理。
- **Mac**：装 [ShadowsocksX-NG](https://github.com/shadowsocks/ShadowsocksX-NG/releases) 或 [V2rayU](https://github.com/yanue/V2rayU)，同样填 IP/端口/密码/加密，开启系统代理。

本机需要终端走代理时：在 SS 客户端里勾选「代理模式」或「全局」，或本机再跑一个「把 SOCKS5 转成 HTTP 代理」的小工具（如 privoxy），然后 `export https_proxy=http://127.0.0.1:8118`。

### 4. 服务器（Ubuntu）使用

服务器上不装图形客户端，可以装 **ss-local**（Shadowsocks 本地客户端），把 SS 转成本地 SOCKS5，再让 git/npm 走 SOCKS5 或再转成 HTTP。

**安装 ss-local（Ubuntu）**

```bash
sudo apt update && sudo apt install -y shadowsocks-libev
```

写一个本地 SOCKS5 配置（只做客户端，不暴露端口可把 server 填 127.0.0.1 的不用管，实际用下面的）：

```bash
# 新建配置文件，填你的香港 VPS IP、端口、密码、加密
cat << 'EOF' | sudo tee /etc/shadowsocks-libev/local.json
{
  "server": "你的香港VPS的IP",
  "server_port": 8388,
  "local_address": "127.0.0.1",
  "local_port": 1080,
  "password": "你设的密码",
  "timeout": 300,
  "method": "aes-256-gcm"
}
EOF

# 前台试跑一次（看能否连上）
ss-local -c /etc/shadowsocks-libev/local.json
# 另开终端测试：curl -x socks5://127.0.0.1:1080 https://www.google.com -I
# 能通则 Ctrl+C 停掉，改用 systemd 常驻
```

**用 systemd 常驻（开机自启）**

若包内自带 `shadowsocks-libev-local@.service`，且配置在 `/etc/shadowsocks-libev/local.json`，可：

```bash
sudo systemctl enable shadowsocks-libev-local@local
sudo systemctl start shadowsocks-libev-local@local
```

若没有该 service，可自建一个（把下面的 `你的香港VPS的IP`、端口、密码、加密改成实际值）：

```bash
sudo tee /etc/systemd/system/ss-local.service << 'EOF'
[Unit]
Description=Shadowsocks local client
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/ss-local -c /etc/shadowsocks-libev/local.json
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now ss-local
```

**让 git / npm 走代理**

此时本机 SOCKS5 是 `127.0.0.1:1080`，git 可直接用 SOCKS5：

```bash
export all_proxy="socks5://127.0.0.1:1080"
# 或只给 git
git config --global http.proxy "socks5://127.0.0.1:1080"
git config --global https.proxy "socks5://127.0.0.1:1080"
```

npm 部分版本对 SOCKS5 支持一般，可二选一：

- 本机再装 **privoxy**，把 `127.0.0.1:1080` 转成 HTTP 代理（如 `127.0.0.1:8118`），然后 `export http_proxy=http://127.0.0.1:8118 https_proxy=http://127.0.0.1:8118`，再 `npm install`。
- 或本机用 **proxychains**：`proxychains npm install`。

（若你希望文档里把 privoxy 的安装和配置也写完整，我可以补一段。）

### 5. 安全与防火墙

- 在 VPS 安全组/防火墙里只放行 **SS 端口**（如 8388）和 **SSH 22**，其余关闭。
- 密码用随机字符串，别用简单密码；有需要可再上 **BBR**（`sudo bash -c 'echo "net.core.default_qdisc=fq" >> /etc/sysctl.conf && echo "net.ipv4.tcp_congestion_control=bbr" >> /etc/sysctl.conf' && sudo sysctl -p`）加速。

这样 **服务器**和**本机**都走同一台香港 VPS，月付约 $5 左右，个人用足够且便宜。

---

## 方案一：配置代理（如香港代理）

适用于：整机或指定程序走代理，适合有香港/海外代理的情况。

### 1. 安装并配置代理客户端（以 HTTP/SOCKS5 为例）

若代理提供的是 **HTTP 代理**（如 `http://proxy.example.com:8080`）或 **SOCKS5**（如 `socks5://127.0.0.1:1080`），可任选一种方式让终端/服务走代理。

**方式 A：仅当前会话生效**

```bash
export http_proxy="http://代理IP:端口"
export https_proxy="http://代理IP:端口"
# 若有 SOCKS5：export https_proxy="socks5://代理IP:端口"
export no_proxy="localhost,127.0.0.1"
```

然后在该终端执行 `git clone`、`npm install` 等测试。

**方式 B：对当前用户长期生效**

在 `~/.bashrc` 或 `~/.profile` 末尾添加：

```bash
export http_proxy="http://代理IP:端口"
export https_proxy="http://代理IP:端口"
export no_proxy="localhost,127.0.0.1"
```

执行 `source ~/.bashrc` 后，新开终端都会带代理。

**方式 C：只对 git 设置代理**

```bash
git config --global http.proxy "http://代理IP:端口"
git config --global https.proxy "http://代理IP:端口"
# 取消：git config --global --unset http.proxy https.proxy
```

**方式 D：只对 npm 设置代理**

```bash
npm config set proxy "http://代理IP:端口"
npm config set https-proxy "http://代理IP:端口"
```

### 2. 拉取数据测试

```bash
# 测试 git
git clone https://github.com/你的用户名/tama_pd.git --depth 1

# 测试 npm（若项目用 npm）
cd tama_pd && npm ci
```

若代理需账号密码，格式为：`http://用户:密码@代理IP:端口`（注意特殊字符需 URL 编码）。

---

## 方案二：Hosts 优化（选延迟最低的 IP）

适用于：无代理时，通过把域名解析到延迟更低的 IP 加速访问。

### 1. 查目标域名的全球解析 IP

- 打开 [DNS Checker](https://dnschecker.org/)（或类似工具）。
- 输入域名（如 `github.com`、`registry.npmmirror.com`），选择 A 记录，查看全球各地返回的 IP。

### 2. 在你自己的网络里测延迟（可选）

- 在 **Windows** 上可用 [PingInfoView](https://www.nirsoft.net/utils/multi_ping_tool.html) 批量 ping 这些 IP，选延迟最低的。
- 在 **Ubuntu 服务器**上可直接用 `ping` 或 `curl -w "%{time_total}\n" -o /dev/null -s https://IP` 测一批 IP，选最快的。

### 3. 在 Ubuntu 上改 Hosts

编辑 hosts 文件（需 sudo）：

```bash
sudo nano /etc/hosts
```

在文件末尾按「一行一个 IP + 域名」添加，例如：

```
54.192.141.147 github.com
140.82.121.4 github.com
199.96.54.73 api.github.com
```

保存后生效无需重启，新开的连接会直接用这些解析。

### 4. 验证

```bash
ping -c 3 github.com
curl -I https://github.com
```

若需恢复系统默认解析，删除刚才在 `/etc/hosts` 里加的那几行即可。

---

## 建议

| 场景           | 建议                     |
|----------------|--------------------------|
| 有香港/海外代理 | 用方案一，整机或 git/npm 走代理 |
| 无代理、能改 Hosts | 用方案二，对关键域名做 Hosts 优化 |
| 两者都有       | 可先 Hosts 优化，再对仍慢的流量开代理 |

**注意**：GitHub 等 CDN IP 会变，若一段时间后变慢，可重新用 DNS Checker 查一批新 IP 再测延迟、更新 hosts。
