"use strict";(()=>{var e={};e.id=3754,e.ids=[3754],e.modules={82563:e=>{e.exports=require("duckdb")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},57147:e=>{e.exports=require("fs")},71017:e=>{e.exports=require("path")},37621:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>N,patchFetch:()=>S,requestAsyncStorage:()=>_,routeModule:()=>u,serverHooks:()=>E,staticGenerationAsyncStorage:()=>p});var s={};r.r(s),r.d(s,{GET:()=>i,dynamic:()=>l});var a=r(49303),o=r(88716),n=r(60670),d=r(87070),c=r(7388);let l="force-dynamic";async function i(e){try{var t;let r=(t=String(e.nextUrl.searchParams.get("ts_codes")??""),(0,c.U)(t.split(","),240));if(0===r.length)return d.NextResponse.json({rows:[]});let s=await (0,c.F)(r);return d.NextResponse.json({rows:s.map(e=>({ts_code:e.ts_code,trade_date:e.trade_date,close:e.close,returns:{d1:e.d1,d5:e.d5,d20:e.d20,d60:e.d60}}))})}catch(e){return console.error("[industry-link/price-snapshots] failed:",e),d.NextResponse.json({error:"Failed to query price snapshots",message:e instanceof Error?e.message:String(e)},{status:500})}}let u=new a.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/industry-link/price-snapshots/route",pathname:"/api/industry-link/price-snapshots",filename:"route",bundlePath:"app/api/industry-link/price-snapshots/route"},resolvedPagePath:"/home/runner/work/tama/tama/apps/pj_finance/app/api/industry-link/price-snapshots/route.ts",nextConfigOutput:"",userland:s}),{requestAsyncStorage:_,staticGenerationAsyncStorage:p,serverHooks:E}=u,N="/api/industry-link/price-snapshots/route";function S(){return(0,n.patchFetch)({serverHooks:E,staticGenerationAsyncStorage:p})}},7388:(e,t,r)=>{r.d(t,{F:()=>d,U:()=>o});var s=r(82563),a=r(51305);function o(e,t){let r=new Set,s=[];for(let a of e){let e=String(a).trim().toUpperCase();if(!(!/^\d{6}\.(SZ|SH|BJ)$/.test(e)||r.has(e))&&(r.add(e),s.push(e),null!=t&&s.length>=t))break}return s}function n(e){let t=Number(e);return Number.isFinite(t)?t:null}async function d(e){let t=o(e);if(0===t.length)return[];let{bfq:r,adj:d}=(0,a.EZ)(),c=t.map(e=>`'${e.replace(/'/g,"''")}'`).join(", "),l=`
    WITH ${(0,a.fL)(d,t)},
    ranked AS (
      SELECT
        b.ts_code,
        b.trade_date,
        b.close * a.adj_factor / l.latest_adj AS close,
        b.pre_close * a.adj_factor / l.latest_adj AS pre_close,
        b.pct_chg,
        ROW_NUMBER() OVER (PARTITION BY b.ts_code ORDER BY b.trade_date DESC) AS rn
      FROM read_parquet('${r}') b
      INNER JOIN read_parquet('${d}') a
        ON b.ts_code = a.ts_code AND b.trade_date = a.trade_date
      INNER JOIN latest_adj l ON b.ts_code = l.ts_code
      WHERE b.ts_code IN (${c})
        AND b.close IS NOT NULL
    ),
    pivoted AS (
      SELECT
        ts_code,
        MAX(CASE WHEN rn = 1 THEN strftime(trade_date, '%Y%m%d') END) AS trade_date,
        MAX(CASE WHEN rn = 1 THEN close END) AS latest_close,
        MAX(CASE WHEN rn = 1 THEN pre_close END) AS pre_close,
        MAX(CASE WHEN rn = 1 THEN pct_chg END) AS pct_chg,
        MAX(CASE WHEN rn = 2 THEN close END) AS close_1d,
        MAX(CASE WHEN rn = 6 THEN close END) AS close_5d,
        MAX(CASE WHEN rn = 21 THEN close END) AS close_20d,
        MAX(CASE WHEN rn = 61 THEN close END) AS close_60d
      FROM ranked
      WHERE rn <= 61
      GROUP BY ts_code
    )
    SELECT
      ts_code,
      trade_date,
      latest_close AS close,
      CASE
        WHEN pct_chg IS NOT NULL THEN pct_chg
        WHEN pre_close IS NOT NULL AND pre_close != 0 THEN (latest_close / pre_close - 1) * 100.0
        WHEN close_1d IS NOT NULL AND close_1d != 0 THEN (latest_close / close_1d - 1) * 100.0
        ELSE NULL
      END AS d1,
      CASE WHEN close_5d IS NOT NULL AND close_5d != 0 THEN (latest_close / close_5d - 1) * 100.0 ELSE NULL END AS d5,
      CASE WHEN close_20d IS NOT NULL AND close_20d != 0 THEN (latest_close / close_20d - 1) * 100.0 ELSE NULL END AS d20,
      CASE WHEN close_60d IS NOT NULL AND close_60d != 0 THEN (latest_close / close_60d - 1) * 100.0 ELSE NULL END AS d60
    FROM pivoted
    ORDER BY ts_code ASC
  `;return(await new Promise((e,t)=>{let r=new s.Database(":memory:"),a=r.connect();a.all(l,(s,o)=>{if(a.close(),r.close(),s){t(s);return}e(Array.isArray(o)?o:[])})})).map(e=>({ts_code:String(e.ts_code??"").toUpperCase(),trade_date:String(e.trade_date??""),close:n(e.close),d1:n(e.d1),d5:n(e.d5),d20:n(e.d20),d60:n(e.d60)}))}},51305:(e,t,r)=>{r.d(t,{EZ:()=>d,LW:()=>E,fL:()=>u,un:()=>p});var s=r(71017),a=r.n(s),o=r(65523);function n(e){return a().resolve(e).replace(/\\/g,"/").replace(/'/g,"''")}function d(){return{bfq:n((0,o.dc)()),adj:n((0,o.Q8)())}}function c(e){return e.replace(/'/g,"''")}function l(e){let t=e.trim();return/^\d{8}$/.test(t)?`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}`:/^\d{4}-\d{2}-\d{2}$/.test(t)?t:null}function i(e){return`${e} * a.adj_factor / l.latest_adj`}function u(e,t){let r=t&&t.length>0?`WHERE ts_code IN (${t.map(e=>`'${c(e)}'`).join(", ")})`:"";return`
    latest_adj AS (
      SELECT ts_code, adj_factor AS latest_adj
      FROM (
        SELECT
          ts_code,
          adj_factor,
          ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn
        FROM read_parquet('${e}')
        ${r}
      ) t
      WHERE rn = 1
    )`}function _(e){let{bfqPath:t,adjPath:r}=e,s=function(e){let t=[];if(e.tsCode?t.push(`b.ts_code = '${c(e.tsCode)}'`):e.tsCodes&&e.tsCodes.length>0&&t.push(`b.ts_code IN (${e.tsCodes.map(e=>`'${c(e)}'`).join(", ")})`),e.startDate){let r=l(e.startDate);r&&t.push(`b.trade_date >= DATE '${r.replace(/'/g,"''")}'`)}if(e.endDate){let r=l(e.endDate);r&&t.push(`b.trade_date <= DATE '${r.replace(/'/g,"''")}'`)}return t.length>0?`WHERE ${t.join(" AND ")}`:""}(e),a=e.tsCode?[e.tsCode]:e.tsCodes;return`
    ${u(r,a)},
    qfq AS (
      SELECT
        b.ts_code,
        b.trade_date,
        ${i("b.open")} AS open,
        ${i("b.high")} AS high,
        ${i("b.low")} AS low,
        ${i("b.close")} AS close,
        ${i("b.pre_close")} AS pre_close,
        ${i("b.change")} AS change,
        b.pct_chg,
        b.vol,
        b.amount
      FROM read_parquet('${t}') b
      INNER JOIN read_parquet('${r}') a
        ON b.ts_code = a.ts_code AND b.trade_date = a.trade_date
      INNER JOIN latest_adj l ON b.ts_code = l.ts_code
      ${s}
    )`}function p(e){return`WITH ${_(e)} SELECT COUNT(*) AS cnt FROM qfq`}function E(e){let t=e.sortCol&&/^[a-zA-Z0-9_]+$/.test(e.sortCol)?e.sortCol:"trade_date",r="ASC"===e.sortDir?"ASC":"DESC",s=Math.max(1,Math.floor(e.limit??50)),a=Math.max(0,Math.floor(e.offset??0));return`WITH ${_(e)} SELECT * FROM qfq ORDER BY ${t} ${r} LIMIT ${s} OFFSET ${a}`}},65523:(e,t,r)=>{r.d(t,{JW:()=>i,Q8:()=>_,dc:()=>u,eh:()=>c,iR:()=>l});var s=r(57147),a=r.n(s),o=r(71017),n=r.n(o);let d=n().join(process.cwd(),"temp/tuShare");function c(...e){let t=[];for(let r of e){let e=n().join(d,r);if(t.push(e),a().existsSync(e))return e}throw Error(`Parquet file not found: ${t.join(" | ")}`)}function l(e){return"full"===e?c("daily_basic.parquet"):c("daily_basic_ss.parquet","daily_basic.parquet")}function i(){return c("balancesheet_vip_ss.parquet","balanceSheet_vip.parquet")}function u(){return c("bfqDir.parquet")}function _(){return c("adjFactor.parquet","adjFactor_ss.parquet")}}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[8948,5972],()=>r(37621));module.exports=s})();