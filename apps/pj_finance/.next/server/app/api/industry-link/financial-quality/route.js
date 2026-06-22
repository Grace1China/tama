"use strict";(()=>{var e={};e.id=9142,e.ids=[9142],e.modules={82563:e=>{e.exports=require("duckdb")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},57147:e=>{e.exports=require("fs")},71017:e=>{e.exports=require("path")},96302:(e,r,t)=>{t.r(r),t.d(r,{originalPathname:()=>C,patchFetch:()=>y,requestAsyncStorage:()=>R,routeModule:()=>m,serverHooks:()=>E,staticGenerationAsyncStorage:()=>f});var a={};t.r(a),t.d(a,{GET:()=>g,dynamic:()=>S});var n=t(49303),i=t(88716),s=t(60670),o=t(57147),u=t.n(o),l=t(71017),p=t.n(l),d=t(87070),c=t(82563);let S="force-dynamic",A=p().join(process.cwd(),"temp/tuShare/fina_indicator_vip_ss.parquet");function _(e){let r=Number(e);return Number.isFinite(r)?r:null}async function g(e){try{let r=function(e){let r=new Set,t=[];for(let a of e.split(",")){let e=a.trim().toUpperCase();if(/^\d{6}\.(SZ|SH|BJ)$/.test(e)&&!r.has(e)&&(r.add(e),t.push(e),t.length>=240))break}return t}(String(e.nextUrl.searchParams.get("ts_codes")??""));if(0===r.length)return d.NextResponse.json({rows:[]});if(!u().existsSync(A))return d.NextResponse.json({error:"Parquet file not found",message:`File not found: ${A}`},{status:404});let t=p().resolve(A).replace(/\\/g,"/").replace(/'/g,"''"),a=r.map(e=>`'${e.replace(/'/g,"''")}'`).join(", "),n=`
      WITH ranked AS (
        SELECT
          ts_code,
          CAST(end_date AS VARCHAR) AS report_date,
          COALESCE(TRY_CAST(roe AS DOUBLE), TRY_CAST(roe_waa AS DOUBLE), TRY_CAST(q_roe AS DOUBLE)) AS roe,
          TRY_CAST(assets_to_eqt AS DOUBLE) AS leverage,
          COALESCE(TRY_CAST(grossprofit_margin AS DOUBLE), TRY_CAST(q_gc_to_gr AS DOUBLE)) AS gross_margin,
          ROW_NUMBER() OVER (
            PARTITION BY ts_code
            ORDER BY CAST(end_date AS VARCHAR) DESC, CAST(ann_date AS VARCHAR) DESC NULLS LAST
          ) AS rn
        FROM read_parquet('${t}')
        WHERE ts_code IN (${a})
      )
      SELECT
        ts_code,
        report_date,
        roe,
        leverage,
        gross_margin
      FROM ranked
      WHERE rn = 1
      ORDER BY ts_code ASC
    `,i=await new Promise((e,r)=>{let t=new c.Database(":memory:"),a=t.connect();a.all(n,(n,i)=>{if(a.close(),t.close(),n){r(n);return}e(Array.isArray(i)?i:[])})});return d.NextResponse.json({rows:i.map(e=>({ts_code:String(e.ts_code??"").toUpperCase(),report_date:String(e.report_date??""),roe:_(e.roe),leverage:_(e.leverage),gross_margin:_(e.gross_margin)}))})}catch(e){return console.error("[industry-link/financial-quality] failed:",e),d.NextResponse.json({error:"Failed to query financial quality",message:e instanceof Error?e.message:String(e)},{status:500})}}let m=new n.AppRouteRouteModule({definition:{kind:i.x.APP_ROUTE,page:"/api/industry-link/financial-quality/route",pathname:"/api/industry-link/financial-quality",filename:"route",bundlePath:"app/api/industry-link/financial-quality/route"},resolvedPagePath:"/home/runner/work/tama/tama/apps/pj_finance/app/api/industry-link/financial-quality/route.ts",nextConfigOutput:"",userland:a}),{requestAsyncStorage:R,staticGenerationAsyncStorage:f,serverHooks:E}=m,C="/api/industry-link/financial-quality/route";function y(){return(0,s.patchFetch)({serverHooks:E,staticGenerationAsyncStorage:f})}}};var r=require("../../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),a=r.X(0,[8948,5972],()=>t(96302));module.exports=a})();