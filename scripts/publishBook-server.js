#!/usr/bin/env node
/**
 * 简易 HTTP 服务：收到 /publishBook 请求时执行 deploy-pd_bible-on-server.sh
 * 用法：在项目根目录执行 node scripts/publishBook-server.js
 * 或：PROJECT_DIR=/path/to/repo node scripts/publishBook-server.js
 *
 * 环境变量：
 *   PORT          - 监听端口，默认 3999
 *   PROJECT_DIR   - 仓库根目录（脚本所在目录的上级）
 *   PUBLISH_TOKEN - 可选，若设置则请求需带 ?token=xxx 或 Header: x-publish-token: xxx
 */

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = parseInt(process.env.PORT || '3999', 10);
const PROJECT_DIR = process.env.PROJECT_DIR || path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(PROJECT_DIR, 'gabriel', 'deploy-pj_bible-on-server.sh');
const PUBLISH_TOKEN = process.env.PUBLISH_TOKEN || '';

function runDeployScript() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SCRIPT_PATH)) {
      reject(new Error(`Script not found: ${SCRIPT_PATH}`));
      return;
    }
    const child = spawn('bash', [SCRIPT_PATH], {
      cwd: PROJECT_DIR,
      env: { ...process.env, PROJECT_DIR },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Script exited ${code}\n${stderr || stdout}`));
    });
  });
}

function parseUrl(url) {
  const [pathname, qs] = url.split('?');
  const params = {};
  if (qs) qs.split('&').forEach((p) => { const [k, v] = p.split('='); params[decodeURIComponent(k)] = v && decodeURIComponent(v); });
  return { pathname, params };
}

const server = http.createServer((req, res) => {
  const { pathname, params } = parseUrl(req.url || '');
  console.log(`visit publishBook server: ${req.url}`);

  if (pathname !== '/publishBook') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  if (PUBLISH_TOKEN) {
    const token = params.token || (req.headers['x-publish-token'] || '').trim();
    if (token !== PUBLISH_TOKEN) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
  }

  runDeployScript()
    .then(({ stdout, stderr }) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`OK\n\n${stdout}${stderr ? '\n' + stderr : ''}`);
    })
    .catch((err) => {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Error: ${err.message}`);
    });
});

server.listen(PORT, () => {
  console.log(`publishBook server listening on http://0.0.0.0:${PORT}/publishBook`);
  if (PUBLISH_TOKEN) console.log('Token auth enabled (query ?token= or header x-publish-token)');
});
