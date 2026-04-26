import { NextRequest, NextResponse } from 'next/server';
import {
  getPortfolio,
  savePortfolio,
  getSuggestions,
  saveSuggestions,
  getExecutionLog,
  appendExecutionLog,
  type Suggestion,
  type ExecutionLog,
} from '@/lib/portfolio/store';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const resource = searchParams.get('resource');
  if (resource === 'suggestions') {
    return NextResponse.json({ data: getSuggestions() });
  }
  if (resource === 'log') {
    return NextResponse.json({ data: getExecutionLog() });
  }
  return NextResponse.json({ data: getPortfolio() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const action = body?.action as string;

  if (action === 'approve' || action === 'reject') {
    const sugId = body?.suggestion_id as string;
    if (!sugId) return NextResponse.json({ error: 'missing suggestion_id' }, { status: 400 });

    const suggestions = getSuggestions();
    const idx = suggestions.findIndex((s) => s.id === sugId);
    if (idx === -1) return NextResponse.json({ error: 'suggestion not found' }, { status: 404 });

    const sug = suggestions[idx];
    const logEntry: ExecutionLog = {
      id: `log_${Date.now()}`,
      suggestion_id: sug.id,
      action: action === 'approve' ? 'approved' : 'rejected',
      ts_code: sug.ts_code,
      name: sug.name,
      shares: sug.shares,
      type: sug.type === 'rebalance' ? '大类再平衡' : '内部优胜劣汰',
      reason: sug.reason,
      timestamp: new Date().toISOString(),
    };
    appendExecutionLog(logEntry);

    if (action === 'approve') {
      const portfolio = getPortfolio();
      const holding = portfolio.holdings.find((h) => h.ts_code === sug.ts_code);
      if (sug.action === 'buy') {
        if (holding) {
          holding.quantity += sug.shares;
        } else {
          portfolio.holdings.push({
            ts_code: sug.ts_code,
            name: sug.name,
            pool: 'growth',
            quantity: sug.shares,
            cost_price: 0,
          });
        }
      } else if (sug.action === 'sell' && holding) {
        holding.quantity = Math.max(0, holding.quantity - sug.shares);
        if (holding.quantity === 0) {
          portfolio.holdings = portfolio.holdings.filter((h) => h.ts_code !== sug.ts_code);
        }
      }
      savePortfolio(portfolio);
    }

    suggestions.splice(idx, 1);
    saveSuggestions(suggestions);
    return NextResponse.json({ ok: true, log: logEntry });
  }

  if (action === 'update_portfolio') {
    const portfolio = body?.portfolio;
    if (!portfolio) return NextResponse.json({ error: 'missing portfolio' }, { status: 400 });
    savePortfolio(portfolio);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 });
}
