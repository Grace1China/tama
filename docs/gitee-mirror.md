# Gitee 镜像：同步到国内 + 从 Gitee 克隆

把项目同步到 Gitee，在国内服务器或本机用 `git clone` 从 Gitee 拉取，可避免直连 GitHub 慢或被墙。

**推荐做法**：本地只推送到 GitHub，不配置 Gitee 远程。在 GitHub 仓库里配好 Gitee 的 Token 和仓库路径（见第四节），每次部署完成后 Actions 会自动把 main、pj_bible、pj_finance 同步到 Gitee，国内直接从 Gitee clone 即可。

---

## 一、在 Gitee 建好仓库（首次）

1. 登录 [Gitee](https://gitee.com)，点击「新建仓库」。
2. 仓库名可填与 GitHub 一致（如 `tama_pd`），选「私有」或「公开」，**不要**勾选「使用 Readme 初始化」。
3. 建好后记下仓库地址，例如：`https://gitee.com/你的用户名/tama_pd.git`。

---

## 二、本地添加 Gitee 远程并推送（可选）

若你希望本地也直接推送到 Gitee，可在项目根目录执行（把 `你的用户名/tama_pd` 换成你的 Gitee 仓库路径）：

```bash
# 添加 Gitee 为第二个远程，命名为 gitee
git remote add gitee https://gitee.com/你的用户名/tama_pd.git

# 推送当前分支（如 main）
git push -u gitee main

# 若有 pj_bible、pj_finance 等分支也要镜像，一并推送
git push gitee pj_bible
git push gitee pj_finance
```

之后每次在 GitHub 合并或推送后，可手动同步到 Gitee：

```bash
git fetch origin
git push gitee main
git push gitee pj_bible
git push gitee pj_finance
```

若 Gitee 仓库已存在且与本地历史不一致，首次推送可能需加强制（谨慎使用）：`git push gitee main --force`。

---

## 三、从 Gitee 克隆项目

在国内服务器或本机直接：

```bash
# 克隆默认分支（一般为 main）
git clone https://gitee.com/你的用户名/tama_pd.git
cd tama_pd

# 若需要某一分支（如 pj_bible）
git clone -b pj_bible https://gitee.com/你的用户名/tama_pd.git
cd tama_pd
```

如需账号密码，Gitee 支持在 URL 里填用户名，密码用**个人令牌**（设置 → 私人令牌）更安全：

```bash
git clone https://你的用户名:你的私人令牌@gitee.com/你的用户名/tama_pd.git
```

---

## 四、用 GitHub Actions 自动同步到 Gitee（可选）

希望每次推送到 GitHub 的 main 并完成部署后，自动把 main、pj_bible、pj_finance 推到 Gitee，可使用仓库里已配置的 workflow。

### 1. 在 Gitee 创建私人令牌

- Gitee → 设置 → 私人令牌 → 生成新令牌，勾选 `projects` 权限。
- 复制令牌（只显示一次），后面填到 GitHub Secrets。

### 2. 在 GitHub 仓库配置 Secrets 和 Variables

- 打开：仓库 → **Settings** → **Secrets and variables** → **Actions**。
- **Secrets** 页：点 **New repository secret**，新建：
  - 名称填 `GITEE_TOKEN`，值填上面复制的 Gitee 私人令牌。
- **Variables** 页：点 **New repository variable**，新建两个变量：
  - `GITEE_REPO`：Gitee 仓库路径，例如 `你的用户名/tama_pd`（不要带 `https://gitee.com/` 和 `.git`）。
  - `GITEE_USER`：你的 Gitee 登录用户名（Gitee 要求 HTTPS 推送到时用「用户名:令牌」认证，只填令牌会报错）。

### 3. 启用同步 workflow

仓库里已有 `.github/workflows/sync-gitee.yml` 时，推送 main 并完成部署后会自动执行「同步到 Gitee」任务；也可在 Actions 页手动 Run workflow。

未配置 `GITEE_TOKEN`、`GITEE_REPO` 或 `GITEE_USER` 时，该 job 会跳过，不影响部署。
