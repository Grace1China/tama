"use strict";(()=>{var e={};e.id=1595,e.ids=[1595],e.modules={82563:e=>{e.exports=require("duckdb")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},57147:e=>{e.exports=require("fs")},71017:e=>{e.exports=require("path")},42018:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>H,patchFetch:()=>T,requestAsyncStorage:()=>h,routeModule:()=>A,serverHooks:()=>g,staticGenerationAsyncStorage:()=>m});var s={};r.r(s),r.d(s,{GET:()=>_,dynamic:()=>u});var a=r(49303),o=r(88716),n=r(60670),c=r(57147),d=r.n(c),p=r(71017),i=r.n(p),l=r(87070),E=r(82563);let u="force-dynamic",N=i().join(process.cwd(),"temp/tuShare/sw_daily.parquet");function S(e){let t=Number(e);return Number.isFinite(t)?t:null}async function _(e){try{if(!d().existsSync(N))return l.NextResponse.json({error:"Parquet file not found",message:`File not found: ${N}`},{status:404});let t=function(e){let t=new Set,r=[];for(let s of e.split(",")){let e=s.trim().toUpperCase();if(/^\d+\.SI$/.test(e)&&!t.has(e)&&(t.add(e),r.push(e),r.length>=800))break}return r}(String(e.nextUrl.searchParams.get("ts_codes")??"")),r=i().resolve(N).replace(/\\/g,"/").replace(/'/g,"''"),s=t.length>0?`AND ts_code IN (${t.map(e=>`'${e.replace(/'/g,"''")}'`).join(", ")})`:"",a=`
      WITH ranked AS (
        SELECT
          ts_code,
          trade_date,
          close,
          pct_change,
          ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY trade_date DESC) AS rn
        FROM read_parquet('${r}')
        WHERE close IS NOT NULL
          ${s}
      ),
      pivoted AS (
        SELECT
          ts_code,
          MAX(CASE WHEN rn = 1 THEN trade_date END) AS trade_date,
          MAX(CASE WHEN rn = 1 THEN close END) AS latest_close,
          MAX(CASE WHEN rn = 1 THEN pct_change END) AS pct_change,
          MAX(CASE WHEN rn = 2 THEN close END) AS close_1d,
          MAX(CASE WHEN rn = 6 THEN close END) AS close_5d,
          MAX(CASE WHEN rn = 21 THEN close END) AS close_20d
        FROM ranked
        WHERE rn <= 21
        GROUP BY ts_code
      )
      SELECT
        ts_code,
        trade_date,
        latest_close AS close,
        CASE
          WHEN pct_change IS NOT NULL THEN pct_change
          WHEN close_1d IS NOT NULL AND close_1d != 0 THEN (latest_close / close_1d - 1) * 100.0
          ELSE NULL
        END AS d1,
        CASE WHEN close_5d IS NOT NULL AND close_5d != 0 THEN (latest_close / close_5d - 1) * 100.0 ELSE NULL END AS d5,
        CASE WHEN close_20d IS NOT NULL AND close_20d != 0 THEN (latest_close / close_20d - 1) * 100.0 ELSE NULL END AS d20
      FROM pivoted
      ORDER BY ts_code ASC
    `,o=await new Promise((e,t)=>{let r=new E.Database(":memory:"),s=r.connect();s.all(a,(a,o)=>{if(s.close(),r.close(),a){t(a);return}e(Array.isArray(o)?o:[])})});return l.NextResponse.json({rows:o.map(e=>({ts_code:String(e.ts_code??"").toUpperCase(),trade_date:String(e.trade_date??""),close:S(e.close),returns:{d1:S(e.d1),d5:S(e.d5),d20:S(e.d20)}}))})}catch(e){return console.error("[sw2021/price-snapshots] failed:",e),l.NextResponse.json({error:"Failed to query sw index price snapshots",message:e instanceof Error?e.message:String(e)},{status:500})}}let A=new a.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/parq/sw2021/price-snapshots/route",pathname:"/api/parq/sw2021/price-snapshots",filename:"route",bundlePath:"app/api/parq/sw2021/price-snapshots/route"},resolvedPagePath:"/home/runner/work/tama/tama/apps/pj_finance/app/api/parq/sw2021/price-snapshots/route.ts",nextConfigOutput:"",userland:s}),{requestAsyncStorage:h,staticGenerationAsyncStorage:m,serverHooks:g}=A,H="/api/parq/sw2021/price-snapshots/route";function T(){return(0,n.patchFetch)({serverHooks:g,staticGenerationAsyncStorage:m})}}};var t=require("../../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),s=t.X(0,[8948,5972],()=>r(42018));module.exports=s})();