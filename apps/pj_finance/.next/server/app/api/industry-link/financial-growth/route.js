"use strict";(()=>{var e={};e.id=180,e.ids=[180],e.modules={82563:e=>{e.exports=require("duckdb")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},57147:e=>{e.exports=require("fs")},71017:e=>{e.exports=require("path")},3804:(e,r,t)=>{t.r(r),t.d(r,{originalPathname:()=>g,patchFetch:()=>O,requestAsyncStorage:()=>y,routeModule:()=>f,serverHooks:()=>T,staticGenerationAsyncStorage:()=>m});var a={};t.r(a),t.d(a,{GET:()=>E,dynamic:()=>A});var n=t(49303),o=t(88716),s=t(60670),i=t(57147),p=t.n(i),_=t(71017),u=t.n(_),c=t(87070),d=t(82563);let A="force-dynamic",S=u().join(process.cwd(),"temp/tuShare/income_vip_ss.parquet");function l(e){let r=Number(e);return Number.isFinite(r)?r:null}function R(e){let r=Number(e);return Number.isInteger(r)?r:null}async function E(e){try{let r=function(e){let r=new Set,t=[];for(let a of e.split(",")){let e=a.trim().toUpperCase();if(/^\d{6}\.(SZ|SH|BJ)$/.test(e)&&!r.has(e)&&(r.add(e),t.push(e),t.length>=240))break}return t}(String(e.nextUrl.searchParams.get("ts_codes")??""));if(0===r.length)return c.NextResponse.json({rows:[]});if(!p().existsSync(S))return c.NextResponse.json({error:"Parquet file not found",message:`File not found: ${S}`},{status:404});let t=u().resolve(S).replace(/\\/g,"/").replace(/'/g,"''"),a=r.map(e=>`'${e.replace(/'/g,"''")}'`).join(", "),n=`
      WITH annual_raw AS (
        SELECT
          ts_code,
          CAST(end_date AS VARCHAR) AS end_date,
          TRY_CAST(total_revenue AS DOUBLE) AS total_revenue,
          TRY_CAST(n_income_attr_p AS DOUBLE) AS n_income_attr_p,
          ROW_NUMBER() OVER (
            PARTITION BY ts_code, CAST(end_date AS VARCHAR)
            ORDER BY
              CASE WHEN CAST(report_type AS VARCHAR) = '1' AND CAST(comp_type AS VARCHAR) = '1' THEN 0 ELSE 1 END,
              CAST(ann_date AS VARCHAR) DESC NULLS LAST
          ) AS rn
        FROM read_parquet('${t}')
        WHERE ts_code IN (${a})
          AND RIGHT(CAST(end_date AS VARCHAR), 4) = '1231'
      ),
      annual AS (
        SELECT
          ts_code,
          end_date,
          CAST(LEFT(end_date, 4) AS INTEGER) AS report_year,
          total_revenue,
          n_income_attr_p
        FROM annual_raw
        WHERE rn = 1
      ),
      anchor AS (
        SELECT *
        FROM annual
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY ts_code
          ORDER BY report_year DESC
        ) = 1
      ),
      candidates AS (
        SELECT
          a.ts_code,
          a.end_date AS report_date,
          p.report_year,
          a.report_year - p.report_year AS years,
          a.total_revenue AS cur_revenue,
          p.total_revenue AS past_revenue,
          a.n_income_attr_p AS cur_profit,
          p.n_income_attr_p AS past_profit
        FROM anchor a
        JOIN annual p ON p.ts_code = a.ts_code
        WHERE a.report_year - p.report_year BETWEEN 1 AND 5
      ),
      revenue_pick AS (
        SELECT
          ts_code,
          report_date,
          years AS revenue_years,
          (POWER(cur_revenue / past_revenue, 1.0 / years) - 1.0) * 100.0 AS revenue_cagr
        FROM candidates
        WHERE cur_revenue > 0 AND past_revenue > 0
        QUALIFY ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY years DESC) = 1
      ),
      profit_pick AS (
        SELECT
          ts_code,
          report_date,
          years AS profit_years,
          (POWER(cur_profit / past_profit, 1.0 / years) - 1.0) * 100.0 AS profit_cagr
        FROM candidates
        WHERE cur_profit > 0 AND past_profit > 0
        QUALIFY ROW_NUMBER() OVER (PARTITION BY ts_code ORDER BY years DESC) = 1
      )
      SELECT
        a.ts_code,
        a.end_date AS report_date,
        r.revenue_cagr,
        r.revenue_years,
        p.profit_cagr,
        p.profit_years
      FROM anchor a
      LEFT JOIN revenue_pick r ON r.ts_code = a.ts_code
      LEFT JOIN profit_pick p ON p.ts_code = a.ts_code
      ORDER BY a.ts_code ASC
    `,o=await new Promise((e,r)=>{let t=new d.Database(":memory:"),a=t.connect();a.all(n,(n,o)=>{if(a.close(),t.close(),n){r(n);return}e(Array.isArray(o)?o:[])})});return c.NextResponse.json({rows:o.map(e=>({ts_code:String(e.ts_code??"").toUpperCase(),report_date:String(e.report_date??""),revenue_cagr:l(e.revenue_cagr),revenue_years:R(e.revenue_years),profit_cagr:l(e.profit_cagr),profit_years:R(e.profit_years)}))})}catch(e){return console.error("[industry-link/financial-growth] failed:",e),c.NextResponse.json({error:"Failed to query financial growth",message:e instanceof Error?e.message:String(e)},{status:500})}}let f=new n.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/industry-link/financial-growth/route",pathname:"/api/industry-link/financial-growth",filename:"route",bundlePath:"app/api/industry-link/financial-growth/route"},resolvedPagePath:"/home/runner/work/tama/tama/apps/pj_finance/app/api/industry-link/financial-growth/route.ts",nextConfigOutput:"",userland:a}),{requestAsyncStorage:y,staticGenerationAsyncStorage:m,serverHooks:T}=f,g="/api/industry-link/financial-growth/route";function O(){return(0,s.patchFetch)({serverHooks:T,staticGenerationAsyncStorage:m})}}};var r=require("../../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),a=r.X(0,[8948,5972],()=>t(3804));module.exports=a})();