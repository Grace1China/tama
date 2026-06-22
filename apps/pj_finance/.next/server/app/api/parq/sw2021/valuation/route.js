"use strict";(()=>{var e={};e.id=8801,e.ids=[8801],e.modules={82563:e=>{e.exports=require("duckdb")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},71017:e=>{e.exports=require("path")},77850:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>g,patchFetch:()=>R,requestAsyncStorage:()=>b,routeModule:()=>E,serverHooks:()=>f,staticGenerationAsyncStorage:()=>S});var n={};r.r(n),r.d(n,{GET:()=>N,dynamic:()=>c});var a=r(49303),o=r(88716),i=r(60670),p=r(87070),s=r(71017),l=r.n(s),u=r(82563);let c="force-dynamic",d=l().join(process.cwd(),"temp/tuShare/sw_daily.parquet"),m=l().join(process.cwd(),"temp/tuShare/index_classify_SW2021.parquet");function _(e){return new Promise((t,r)=>{let n=new u.Database(":memory:"),a=n.connect();a.all(e,(e,o)=>{if(a.close(),n.close(),e){r(e);return}t(o??[])})})}async function N(e){try{let t;let r=e.nextUrl.searchParams,n=String(r.get("index_code")??"").trim().toUpperCase(),a=String(r.get("level")??"").trim().toUpperCase(),o=l().resolve(m).replace(/\\/g,"/").replace(/'/g,"''"),i=await _(`
      SELECT index_code, industry_name, parent_code, level, industry_code
      FROM read_parquet('${o}')
      WHERE src = 'SW2021'
      ORDER BY industry_code ASC
    `);if(n){let e=i.find(e=>String(e.index_code??"").toUpperCase()===n);if(!e)return p.NextResponse.json({error:`Classify node not found for index_code: ${n}`},{status:404});t=function(e,t){let r=new Map;for(let t of e){let e=String(t.parent_code??""),n=r.get(e)??[];n.push(t),r.set(e,n)}let n=[String(t.industry_code)],a=new Set(n);for(;n.length>0;){let e=n.shift();if(e)for(let t of r.get(e)??[]){let e=String(t.industry_code??"");!e||a.has(e)||(a.add(e),n.push(e))}}let o=new Set;for(let t of e){if(!a.has(String(t.industry_code??"")))continue;let e=String(t.index_code??"").toUpperCase();e&&o.add(e)}return[...o]}(i,e),0===t.length&&(t=[n])}else if("L1"===a||"L2"===a||"L3"===a)t=i.filter(e=>String(e.level??"").toUpperCase()===a).map(e=>String(e.index_code??"").toUpperCase()).filter(e=>e);else{if(n||a)return p.NextResponse.json({error:"index_code or valid level (L1/L2/L3) is required"},{status:400});t=i.filter(e=>"L1"===String(e.level??"").toUpperCase()).map(e=>String(e.index_code??"").toUpperCase()).filter(e=>e)}if(0===t.length)return p.NextResponse.json({rows:[]});let s=l().resolve(d).replace(/\\/g,"/").replace(/'/g,"''"),u=t.map(e=>`'${e.replace(/'/g,"''")}'`).join(", "),c=`
      WITH raw AS (
        SELECT ts_code, trade_date, name, close, pct_change, vol, amount, pe, pb, float_mv, total_mv
        FROM read_parquet('${s}')
        WHERE ts_code IN (${u})
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn,
          CASE WHEN pe IS NOT NULL
            THEN PERCENT_RANK() OVER (PARTITION BY ts_code ORDER BY pe)
            ELSE NULL
          END AS pe_pct,
          CASE WHEN pb IS NOT NULL
            THEN PERCENT_RANK() OVER (PARTITION BY ts_code ORDER BY pb)
            ELSE NULL
          END AS pb_pct
        FROM raw
      )
      SELECT ts_code, name, trade_date, close, pct_change, vol, amount, pe, pb, float_mv, total_mv,
             pe_pct * 100.0 AS pe_percentile,
             pb_pct * 100.0 AS pb_percentile
      FROM ranked
      WHERE rn = 1
      ORDER BY ts_code ASC
    `,N=(await _(c)).map(e=>({ts_code:e.ts_code,name:e.name,trade_date:String(e.trade_date??""),close:Number(e.close??0),pct_change:Number(e.pct_change??0),vol:Number(e.vol??0),amount:Number(e.amount??0),float_mv:Number(e.float_mv??0),total_mv:Number(e.total_mv??0),pe:null!=e.pe&&Number.isFinite(Number(e.pe))?Number(e.pe):null,pe_percentile:null!=e.pe&&Number.isFinite(Number(e.pe))&&Number.isFinite(Number(e.pe_percentile))?Number(e.pe_percentile):null,pb:null!=e.pb&&Number.isFinite(Number(e.pb))?Number(e.pb):null,pb_percentile:null!=e.pb&&Number.isFinite(Number(e.pb))&&Number.isFinite(Number(e.pb_percentile))?Number(e.pb_percentile):null}));return p.NextResponse.json({rows:N})}catch(e){return console.error("[sw2021/valuation] failed:",e),p.NextResponse.json({error:"Failed to compute industry valuation percentiles",message:e instanceof Error?e.message:String(e)},{status:500})}}let E=new a.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/parq/sw2021/valuation/route",pathname:"/api/parq/sw2021/valuation",filename:"route",bundlePath:"app/api/parq/sw2021/valuation/route"},resolvedPagePath:"/home/runner/work/tama/tama/apps/pj_finance/app/api/parq/sw2021/valuation/route.ts",nextConfigOutput:"",userland:n}),{requestAsyncStorage:b,staticGenerationAsyncStorage:S,serverHooks:f}=E,g="/api/parq/sw2021/valuation/route";function R(){return(0,i.patchFetch)({serverHooks:f,staticGenerationAsyncStorage:S})}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),n=t.X(0,[8948,5972],()=>r(77850));module.exports=n})();