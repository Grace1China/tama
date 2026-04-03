import fs from 'fs/promises';
import path from 'path';
import { chromium, Locator, Page } from 'playwright';

type CliOptions = {
  baseUrl: string;
  stocks: string[];
  outDir: string;
  timeoutMs: number;
  headless: boolean;
  scale: number;
};

const TAB_LABELS = [
  '营收和市值',
  '营收和现金流',
  '成本与毛利率',
  '三费与营收',
  '综合增长率',
  '综合增长率趋势',
  '资产负债结构',
  '业务构成',
  '市销率估值',
  '滚动市盈率估值',
  '市净率估值',
] as const;

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseArgs(argv: string[]): CliOptions {
  const defaults: CliOptions = {
    baseUrl: 'http://localhost:3000/income1',
    stocks: ['603983.SH'],
    outDir: path.resolve(process.cwd(), 'output', 'income1-charts'),
    timeoutMs: 45000,
    headless: true,
    scale: 2,
  };

  const args = new Map<string, string>();
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const i = raw.indexOf('=');
    if (i === -1) {
      args.set(raw.slice(2), 'true');
    } else {
      args.set(raw.slice(2, i), raw.slice(i + 1));
    }
  }

  const stocks = args.get('stocks') ? parseList(args.get('stocks') as string) : defaults.stocks;
  const baseUrl = args.get('baseUrl') ?? defaults.baseUrl;
  const outDir = args.get('outDir') ? path.resolve(process.cwd(), args.get('outDir') as string) : defaults.outDir;
  const timeoutMs = args.get('timeoutMs') ? Number(args.get('timeoutMs')) : defaults.timeoutMs;
  const headless = args.get('headless') ? args.get('headless') !== 'false' : defaults.headless;
  const scale = args.get('scale') ? Number(args.get('scale')) : defaults.scale;

  if (!stocks.length) throw new Error('No stocks provided. Example: --stocks=603983.SH,600519.SH');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid --timeoutMs');
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Invalid --scale');

  return { baseUrl, stocks, outDir, timeoutMs, headless, scale };
}

function sanitizeName(v: string): string {
  return v
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

async function resolvePanelByTab(page: Page, tab: Locator): Promise<Locator> {
  const panelId = await tab.getAttribute('aria-controls');
  if (!panelId) {
    throw new Error('Tab does not have aria-controls; cannot resolve panel.');
  }
  // Radix 生成的 id 可能包含 ":"，不能直接用 #id（CSS 选择器会报错）
  return page.locator(`[id="${panelId}"]`);
}

async function waitForChartReady(page: Page, panel: Locator, timeoutMs: number): Promise<void> {
  await panel.waitFor({ state: 'visible', timeout: timeoutMs });

  const loadingText = panel.getByText('加载中...');
  const started = Date.now();
  while (await loadingText.isVisible().catch(() => false)) {
    if (Date.now() - started > timeoutMs) break;
    await page.waitForTimeout(250);
  }

  // 如果仍显示“请选择股票代码查看数据走势”，说明尚未成功选股
  const emptyHint = panel.getByText('请选择股票代码查看数据走势');
  const hintStart = Date.now();
  while (await emptyHint.isVisible().catch(() => false)) {
    if (Date.now() - hintStart > timeoutMs) {
      throw new Error('Stock data is not loaded yet (still showing empty hint).');
    }
    await page.waitForTimeout(250);
  }

  const chart = panel.locator('.recharts-responsive-container').first();
  if (await chart.isVisible().catch(() => false)) {
    await chart.waitFor({ state: 'visible', timeout: timeoutMs });
    return;
  }

  // 某些 tab 可能返回“暂无数据”，此时也视作可截图状态
  await page.waitForTimeout(300);
}

async function selectStock(page: Page, stockCode: string, timeoutMs: number, revMvPanel: Locator): Promise<void> {
  const input = page.locator('#tsCode');
  await input.waitFor({ state: 'visible', timeout: timeoutMs });
  await input.fill(stockCode);
  await input.press('Enter');

  // 等待第一个图表区域稳定
  await waitForChartReady(page, revMvPanel, timeoutMs);
}

async function screenshotCurrentTab(panel: Locator, outputPath: string, timeoutMs: number): Promise<void> {
  await panel.waitFor({ state: 'visible', timeout: timeoutMs });
  await panel.screenshot({ path: outputPath });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(options.outDir, { recursive: true });

  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({
    viewport: { width: 1720, height: 980 },
    deviceScaleFactor: options.scale,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(options.timeoutMs);

  try {
    for (const stock of options.stocks) {
      const code = stock.trim().toUpperCase();
      if (!code) continue;

      console.log(`\n[stock] ${code}`);
      await page.goto(options.baseUrl, { waitUntil: 'domcontentloaded' });

      const stockDir = path.join(options.outDir, sanitizeName(code));
      await fs.mkdir(stockDir, { recursive: true });

      const chartTabList = page
        .locator('[role="tablist"]')
        .filter({ has: page.getByRole('tab', { name: '营收和市值', exact: true }) })
        .first();
      const revMvTab = chartTabList.getByRole('tab', { name: '营收和市值', exact: true });
      await revMvTab.click();
      const revMvPanel = await resolvePanelByTab(page, revMvTab);
      await selectStock(page, code, options.timeoutMs, revMvPanel);
      for (const label of TAB_LABELS) {
        const tab = chartTabList.getByRole('tab', { name: label, exact: true });
        if (!(await tab.count())) {
          console.warn(`[skip] tab not found: ${label}`);
          continue;
        }

        await tab.click();
        const panel = await resolvePanelByTab(page, tab);
        await waitForChartReady(page, panel, options.timeoutMs);

        const out = path.join(stockDir, `${sanitizeName(label)}.png`);
        await screenshotCurrentTab(panel, out, options.timeoutMs);
        console.log(`[saved] ${path.relative(process.cwd(), out)}`);
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[export-income1-charts] failed:', err);
  process.exit(1);
});

