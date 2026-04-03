"use strict";(()=>{var e={};e.id=277,e.ids=[277],e.modules={82563:e=>{e.exports=require("duckdb")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},57147:e=>{e.exports=require("fs")},71017:e=>{e.exports=require("path")},73837:e=>{e.exports=require("util")},59796:e=>{e.exports=require("zlib")},26131:(e,t,A)=>{A.r(t),A.d(t,{originalPathname:()=>L,patchFetch:()=>I,requestAsyncStorage:()=>N,routeModule:()=>l,serverHooks:()=>u,staticGenerationAsyncStorage:()=>m});var _={};A.r(_),A.d(_,{GET:()=>H,dynamic:()=>s});var r=A(49303),R=A(88716),o=A(60670),n=A(87070),a=A(57147),T=A.n(a),d=A(71017),S=A.n(d),E=A(59796),p=A.n(E),c=A(73837),C=A(82563);let s="force-dynamic";BigInt.prototype.toJSON=function(){return Number(this)};let i=(0,c.promisify)(p().gzip);async function O(e,t,A,_){if(!T().existsSync(e))throw Error(`Income parquet file not found: ${e}`);if(!T().existsSync(t))throw Error(`Cashflow parquet file not found: ${t}`);let r=S().resolve(e).replace(/\\/g,"/"),R=S().resolve(t).replace(/\\/g,"/"),o=new URLSearchParams(A.startsWith("?")?A.slice(1):A),n=o.get("ts_code"),a=o.get("sortField"),d=o.get("sortDir");return new Promise((e,t)=>{try{let A=new C.Database(":memory:"),o=A.connect(),T=Number.isFinite(_?.page)?_.page:1,S=Number.isFinite(_?.size)?_.size:50,E=Math.max(1,Math.floor(S)),p="WHERE report_type = '1' AND comp_type = '1'",c="WHERE report_type = '1' AND comp_type = '1'";if(n){let e=n.replace(/'/g,"''");p+=` AND ts_code = '${e}'`,c+=` AND ts_code = '${e}'`}let s="ORDER BY end_date DESC";if(a&&d&&/^[a-zA-Z0-9_]+$/.test(a)){let e="ASC"===d.toUpperCase()?"ASC":"DESC";s=`ORDER BY ${a} ${e}`}let i=`LIMIT ${E} OFFSET ${(Math.max(1,Math.floor(T))-1)*E}`,O=`DESCRIBE SELECT * FROM read_parquet('${r.replace(/'/g,"''")}')`;o.all(O,(_,n)=>{if(_){o.close(),A.close(),t(Error(`DuckDB schema query error: ${_.message}`));return}let a=(n||[]).some(e=>{let t=String(e?.column_name??e?.name??Object.values(e||{})[0]??"").toLowerCase();return"net_after_nr_lp_correct"===t})?"net_after_nr_lp_correct":"NULL",T=`
        WITH income_dedup AS (
          SELECT *
          FROM (
            SELECT *,
              ROW_NUMBER() OVER (PARTITION BY ts_code, end_date, report_type ORDER BY COALESCE(CAST(update_flag AS INTEGER), 0) DESC) AS __rn
            FROM read_parquet('${r.replace(/'/g,"''")}')
            ${p}
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
            END AS q_n_income,
            CASE
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331' 
                THEN TRY_CAST(${a} AS DOUBLE)
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0331' 
                THEN TRY_CAST(${a} AS DOUBLE) - LAG(TRY_CAST(${a} AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0630' 
                THEN TRY_CAST(${a} AS DOUBLE) - LAG(TRY_CAST(${a} AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231' 
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0930' 
                THEN TRY_CAST(${a} AS DOUBLE) - LAG(TRY_CAST(${a} AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              ELSE NULL 
            END AS q_net_after_nr_lp_correct
          FROM income_dedup
        ),
        cashflow_dedup AS (
          SELECT *
          FROM (
            SELECT *,
              ROW_NUMBER() OVER (PARTITION BY ts_code, end_date, report_type ORDER BY COALESCE(CAST(update_flag AS INTEGER), 0) DESC) AS __rn
            FROM read_parquet('${R.replace(/'/g,"''")}')
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
            i.q_net_after_nr_lp_correct,
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
            q_net_after_nr_lp_correct,
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
            SUM(q_net_after_nr_lp_correct) OVER (
              PARTITION BY ts_code, report_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS ttm_net_after_nr_lp_correct,
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
          q_net_after_nr_lp_correct,
          q_c_inf_fr_operate_a,
          CASE WHEN window_count >= 4 THEN ttm_total_revenue ELSE NULL END AS ttm_total_revenue,
          CASE WHEN window_count >= 4 THEN ttm_n_income ELSE NULL END AS ttm_n_income,
          CASE WHEN window_count >= 4 THEN ttm_net_after_nr_lp_correct ELSE NULL END AS ttm_net_after_nr_lp_correct,
          CASE WHEN window_count >= 4 THEN ttm_c_inf_fr_operate_a ELSE NULL END AS ttm_c_inf_fr_operate_a
        FROM ttm_calc
        `,d=`SELECT COUNT(*) AS cnt FROM (${T}) AS t`,S=`SELECT * FROM (${T}) AS t ${s} ${i}`;console.log("[CashflowIncome TTM API] Executing count query"),o.all(d,(_,r)=>{if(_){o.close(),A.close(),t(Error(`DuckDB count query error: ${_.message}`));return}let R=Number(r?.[0]?.cnt??0);o.all(S,(_,r)=>{if(_){o.close(),A.close(),t(Error(`DuckDB query error: ${_.message}`));return}if(!r||0===r.length){o.close(),A.close(),e({headers:[],originalHeaders:[],data:[],totalRows:R});return}let n=Object.keys(r[0]),a={ts_code:"股票代码",end_date:"报告期",report_type:"报告类型",comp_type:"公司类型",q_total_revenue:"单季营业总收入",q_n_income:"单季净利润",q_net_after_nr_lp_correct:"单季扣非后净利润",q_c_inf_fr_operate_a:"单季经营现金流入",ttm_total_revenue:"滚动总营收",ttm_n_income:"滚动净利润",ttm_net_after_nr_lp_correct:"滚动扣非后净利润",ttm_c_inf_fr_operate_a:"滚动经营现金流入"},T=n.map(e=>a[e]||e),d=r.map(e=>{let t={};return n.forEach(A=>{"end_date"===A?t[A]=function(e){if(null==e)return"";let t=String(e).trim();if(!t)return"";let A=t.match(/^(\d{4})(\d{2})(\d{2})$/),_=A?`${A[1]}-${A[2]}-${A[3]}`:t;try{let e=new Date(_.replace(/-/g,"/"));if(Number.isNaN(e.getTime()))return t;return Intl.DateTimeFormat("zh-CN").format(e)}catch{return t}}(e[A]):t[A]=e[A]}),t});o.close(),A.close(),console.log(`[CashflowIncome TTM API] Query complete, returning ${d.length} records (total: ${R})`),e({headers:T,originalHeaders:n,data:d,totalRows:R})})})})}catch(e){t(Error(`Failed to initialize DuckDB: ${e instanceof Error?e.message:String(e)}`))}})}async function H(e){try{let t=(e.headers.get("accept-encoding")||"").includes("gzip"),A=new URL(e.url),_=S().join(process.cwd(),"temp/tuShare/income_vip_ss.parquet"),r=S().join(process.cwd(),"temp/tuShare/cashflow_vip_ss.parquet"),R=Number(A.searchParams.get("page")??"1"),o=Number(A.searchParams.get("size")??"50"),a=new URLSearchParams(A.searchParams);a.delete("page"),a.delete("size");let T=a.toString()?`?${a.toString()}`:"",d=await O(_,r,T,{page:R,size:o}),E={category:"cashflowIncome",filename:"cashflow_income_ttm",headers:d.headers,originalHeaders:d.originalHeaders,data:d.data,totalRows:d.totalRows},p=JSON.stringify(E),c=Buffer.byteLength(p,"utf8");if(!t||!(c>1024))return n.NextResponse.json(E);{let e=await i(p),t=e.length,A=((1-t/c)*100).toFixed(1);return console.log(`[CashflowIncome TTM API] Original: ${(c/1024).toFixed(2)}KB, Compressed: ${(t/1024).toFixed(2)}KB, Ratio: ${A}%`),new n.NextResponse(e,{status:200,headers:{"Content-Type":"application/json","Content-Encoding":"gzip","Content-Length":t.toString()}})}}catch(e){return console.error("Error querying TTM data:",e),n.NextResponse.json({error:"Failed to query TTM data",message:e instanceof Error?e.message:String(e)},{status:500})}}let l=new r.AppRouteRouteModule({definition:{kind:R.x.APP_ROUTE,page:"/api/parq/cashflowIncome/route",pathname:"/api/parq/cashflowIncome",filename:"route",bundlePath:"app/api/parq/cashflowIncome/route"},resolvedPagePath:"/home/runner/work/tama/tama/apps/pj_finance/app/api/parq/cashflowIncome/route.ts",nextConfigOutput:"",userland:_}),{requestAsyncStorage:N,staticGenerationAsyncStorage:m,serverHooks:u}=l,L="/api/parq/cashflowIncome/route";function I(){return(0,o.patchFetch)({serverHooks:u,staticGenerationAsyncStorage:m})}}};var t=require("../../../../webpack-runtime.js");t.C(e);var A=e=>t(t.s=e),_=t.X(0,[948,972],()=>A(26131));module.exports=_})();