"use strict";(()=>{var e={};e.id=277,e.ids=[277],e.modules={82563:e=>{e.exports=require("duckdb")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},57147:e=>{e.exports=require("fs")},71017:e=>{e.exports=require("path")},73837:e=>{e.exports=require("util")},59796:e=>{e.exports=require("zlib")},26131:(e,t,A)=>{A.r(t),A.d(t,{originalPathname:()=>L,patchFetch:()=>I,requestAsyncStorage:()=>u,routeModule:()=>m,serverHooks:()=>H,staticGenerationAsyncStorage:()=>N});var _={};A.r(_),A.d(_,{GET:()=>O,dynamic:()=>i});var r=A(49303),o=A(88716),R=A(60670),a=A(87070),n=A(57147),d=A.n(n),T=A(71017),S=A.n(T),p=A(59796),E=A.n(p),c=A(73837),C=A(82563);let i="force-dynamic";BigInt.prototype.toJSON=function(){return Number(this)};let s=(0,c.promisify)(E().gzip);async function l(e,t,A,_){if(!d().existsSync(e))throw Error(`Income parquet file not found: ${e}`);if(!d().existsSync(t))throw Error(`Cashflow parquet file not found: ${t}`);let r=S().resolve(e).replace(/\\/g,"/"),o=S().resolve(t).replace(/\\/g,"/"),R=new URLSearchParams(A.startsWith("?")?A.slice(1):A),a=R.get("ts_code"),n=R.get("sortField"),T=R.get("sortDir");return new Promise((e,t)=>{try{let A=new C.Database(":memory:"),R=A.connect(),d=Number.isFinite(_?.page)?_.page:1,S=Number.isFinite(_?.size)?_.size:50,p=Math.max(1,Math.floor(S)),E="WHERE report_type = '1' AND comp_type = '1'",c="WHERE report_type = '1' AND comp_type = '1'";if(a){let e=a.replace(/'/g,"''");E+=` AND ts_code = '${e}'`,c+=` AND ts_code = '${e}'`}let i="ORDER BY end_date DESC";if(n&&T&&/^[a-zA-Z0-9_]+$/.test(n)){let e="ASC"===T.toUpperCase()?"ASC":"DESC";i=`ORDER BY ${n} ${e}`}let s=`LIMIT ${p} OFFSET ${(Math.max(1,Math.floor(d))-1)*p}`,l=`
        WITH income_dedup AS (
          SELECT *
          FROM (
            SELECT *,
              ROW_NUMBER() OVER (PARTITION BY ts_code, end_date, report_type ORDER BY COALESCE(CAST(update_flag AS INTEGER), 0) DESC) AS __rn
            FROM read_parquet('${r.replace(/'/g,"''")}')
            ${E}
          )
          WHERE __rn = 1
        ),
        income_single_quarter AS (
          SELECT
            ts_code,
            end_date,
            report_type,
            comp_type,
            CASE
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331' 
                THEN TRY_CAST(total_revenue AS DOUBLE)
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0331' 
                THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0630' 
                THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0930' 
                THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              ELSE NULL 
            END AS q_total_revenue,
            CASE
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331' 
                THEN TRY_CAST(n_income AS DOUBLE)
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0331' 
                THEN TRY_CAST(n_income AS DOUBLE) - LAG(TRY_CAST(n_income AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0630' 
                THEN TRY_CAST(n_income AS DOUBLE) - LAG(TRY_CAST(n_income AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0930' 
                THEN TRY_CAST(n_income AS DOUBLE) - LAG(TRY_CAST(n_income AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              ELSE NULL 
            END AS q_n_income
          FROM income_dedup
        ),
        cashflow_dedup AS (
          SELECT *
          FROM (
            SELECT *,
              ROW_NUMBER() OVER (PARTITION BY ts_code, end_date, report_type ORDER BY COALESCE(CAST(update_flag AS INTEGER), 0) DESC) AS __rn
            FROM read_parquet('${o.replace(/'/g,"''")}')
            ${c}
          )
          WHERE __rn = 1
        ),
        cashflow_single_quarter AS (
          SELECT
            ts_code,
            end_date,
            report_type,
            comp_type,
            CASE
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331' 
                THEN TRY_CAST(c_inf_fr_operate_a AS DOUBLE)
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0331' 
                THEN TRY_CAST(c_inf_fr_operate_a AS DOUBLE) - LAG(TRY_CAST(c_inf_fr_operate_a AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0630' 
                THEN TRY_CAST(c_inf_fr_operate_a AS DOUBLE) - LAG(TRY_CAST(c_inf_fr_operate_a AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0930' 
                THEN TRY_CAST(c_inf_fr_operate_a AS DOUBLE) - LAG(TRY_CAST(c_inf_fr_operate_a AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              ELSE NULL 
            END AS q_c_inf_fr_operate_a
          FROM cashflow_dedup
        ),
        combined AS (
          SELECT
            i.ts_code,
            i.end_date,
            i.report_type,
            i.comp_type,
            i.q_total_revenue,
            i.q_n_income,
            c.q_c_inf_fr_operate_a
          FROM income_single_quarter i
          LEFT JOIN cashflow_single_quarter c
            ON i.ts_code = c.ts_code
            AND i.end_date = c.end_date
            AND i.report_type = c.report_type
        ),
        ttm_calc AS (
          SELECT
            ts_code,
            end_date,
            report_type,
            comp_type,
            q_total_revenue,
            q_n_income,
            q_c_inf_fr_operate_a,
            SUM(q_total_revenue) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS ttm_total_revenue,
            SUM(q_n_income) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS ttm_n_income,
            SUM(q_c_inf_fr_operate_a) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS ttm_c_inf_fr_operate_a,
            COUNT(q_total_revenue) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS window_count
          FROM combined
        )
        SELECT
          ts_code,
          CAST(end_date AS VARCHAR) AS end_date,
          report_type,
          comp_type,
          q_total_revenue,
          q_n_income,
          q_c_inf_fr_operate_a,
          CASE WHEN window_count >= 4 THEN ttm_total_revenue ELSE NULL END AS ttm_total_revenue,
          CASE WHEN window_count >= 4 THEN ttm_n_income ELSE NULL END AS ttm_n_income,
          CASE WHEN window_count >= 4 THEN ttm_c_inf_fr_operate_a ELSE NULL END AS ttm_c_inf_fr_operate_a
        FROM ttm_calc
      `,O=`SELECT COUNT(*) AS cnt FROM (${l}) AS t`,m=`SELECT * FROM (${l}) AS t ${i} ${s}`;console.log("[CashflowIncome TTM API] Executing count query"),R.all(O,(_,r)=>{if(_){R.close(),A.close(),t(Error(`DuckDB count query error: ${_.message}`));return}let o=Number(r?.[0]?.cnt??0);R.all(m,(_,r)=>{if(_){R.close(),A.close(),t(Error(`DuckDB query error: ${_.message}`));return}if(!r||0===r.length){R.close(),A.close(),e({headers:[],originalHeaders:[],data:[],totalRows:o});return}let a=Object.keys(r[0]),n={ts_code:"股票代码",end_date:"报告期",report_type:"报告类型",comp_type:"公司类型",q_total_revenue:"单季营业总收入",q_n_income:"单季净利润",q_c_inf_fr_operate_a:"单季经营现金流入",ttm_total_revenue:"滚动总营收",ttm_n_income:"滚动净利润",ttm_c_inf_fr_operate_a:"滚动经营现金流入"},d=a.map(e=>n[e]||e),T=r.map(e=>{let t={};return a.forEach(A=>{"end_date"===A?t[A]=function(e){if(null==e)return"";let t=String(e).trim();if(!t)return"";let A=t.match(/^(\d{4})(\d{2})(\d{2})$/),_=A?`${A[1]}-${A[2]}-${A[3]}`:t;try{let e=new Date(_.replace(/-/g,"/"));if(Number.isNaN(e.getTime()))return t;return Intl.DateTimeFormat("zh-CN").format(e)}catch{return t}}(e[A]):t[A]=e[A]}),t});R.close(),A.close(),console.log(`[CashflowIncome TTM API] Query complete, returning ${T.length} records (total: ${o})`),e({headers:d,originalHeaders:a,data:T,totalRows:o})})})}catch(e){t(Error(`Failed to initialize DuckDB: ${e instanceof Error?e.message:String(e)}`))}})}async function O(e){try{let t=(e.headers.get("accept-encoding")||"").includes("gzip"),A=new URL(e.url),_=S().join(process.cwd(),"temp/tuShare/income_vip_ss.parquet"),r=S().join(process.cwd(),"temp/tuShare/cashflow_vip_ss.parquet"),o=Number(A.searchParams.get("page")??"1"),R=Number(A.searchParams.get("size")??"50"),n=new URLSearchParams(A.searchParams);n.delete("page"),n.delete("size");let d=n.toString()?`?${n.toString()}`:"",T=await l(_,r,d,{page:o,size:R}),p={category:"cashflowIncome",filename:"cashflow_income_ttm",headers:T.headers,originalHeaders:T.originalHeaders,data:T.data,totalRows:T.totalRows},E=JSON.stringify(p),c=Buffer.byteLength(E,"utf8");if(!t||!(c>1024))return a.NextResponse.json(p);{let e=await s(E),t=e.length,A=((1-t/c)*100).toFixed(1);return console.log(`[CashflowIncome TTM API] Original: ${(c/1024).toFixed(2)}KB, Compressed: ${(t/1024).toFixed(2)}KB, Ratio: ${A}%`),new a.NextResponse(e,{status:200,headers:{"Content-Type":"application/json","Content-Encoding":"gzip","Content-Length":t.toString()}})}}catch(e){return console.error("Error querying TTM data:",e),a.NextResponse.json({error:"Failed to query TTM data",message:e instanceof Error?e.message:String(e)},{status:500})}}let m=new r.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/parq/cashflowIncome/route",pathname:"/api/parq/cashflowIncome",filename:"route",bundlePath:"app/api/parq/cashflowIncome/route"},resolvedPagePath:"/home/runner/work/tama/tama/apps/pj_finance/app/api/parq/cashflowIncome/route.ts",nextConfigOutput:"",userland:_}),{requestAsyncStorage:u,staticGenerationAsyncStorage:N,serverHooks:H}=m,L="/api/parq/cashflowIncome/route";function I(){return(0,R.patchFetch)({serverHooks:H,staticGenerationAsyncStorage:N})}}};var t=require("../../../../webpack-runtime.js");t.C(e);var A=e=>t(t.s=e),_=t.X(0,[948,972],()=>A(26131));module.exports=_})();