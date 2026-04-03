"use strict";(()=>{var e={};e.id=406,e.ids=[406],e.modules={82563:e=>{e.exports=require("duckdb")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},57147:e=>{e.exports=require("fs")},71017:e=>{e.exports=require("path")},12781:e=>{e.exports=require("stream")},73837:e=>{e.exports=require("util")},59796:e=>{e.exports=require("zlib")},37151:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>L,patchFetch:()=>g,requestAsyncStorage:()=>O,routeModule:()=>N,serverHooks:()=>D,staticGenerationAsyncStorage:()=>H});var A={};r.r(A),r.d(A,{GET:()=>m,dynamic:()=>C});var a=r(49303),n=r(88716),o=r(60670),_=r(87070),R=r(57147),p=r.n(R),d=r(71017),S=r.n(d),T=r(59796),i=r.n(T),c=r(73837),E=r(82563),s=r(48858);let C="force-dynamic";BigInt.prototype.toJSON=function(){return Number(this)};let l=(0,c.promisify)(i().gzip);async function u(e,t,r){if(!p().existsSync(e))throw Error(`Parquet file not found: ${e}`);let A=S().resolve(e).replace(/\\/g,"/");console.log("absolutePath",A);let a=new URLSearchParams(t.startsWith("?")?t.slice(1):t),n=a.get("ts_code"),o=a.get("sortField"),_=a.get("sortDir"),R=a.get("filters");return new Promise((e,t)=>{try{let a=new E.Database(":memory:"),p=a.connect(),d=Number.isFinite(r?.page)?r.page:1,S=Number.isFinite(r?.size)?r.size:50,T=Math.max(1,Math.floor(d)),i=Math.max(1,Math.floor(S));console.log(`[Parquet API] 执行分页查询(page=${T}, size=${i}): ${A}`);let c=`FROM read_parquet('${A.replace(/'/g,"''")}')`,C="WHERE 1=1",l=[];if(n){let e=n.replace(/'/g,"''");l.push(`ts_code = '${e}'`)}if(R)try{let e=JSON.parse(R);Object.keys(e).forEach(t=>{let r=e[t];if(/^[a-zA-Z0-9_]+$/.test(t)){if("text"===r.filterType){let e=String(r.filter).replace(/'/g,"''");C+=` AND ${t} LIKE '%${e}%'`}else if("number"===r.filterType){let e=Number(r.filter);if(isNaN(e))return;"equals"===r.type?C+=` AND ${t} = ${e}`:"greaterThan"===r.type?C+=` AND ${t} > ${e}`:"lessThan"===r.type?C+=` AND ${t} < ${e}`:"greaterThanOrEqual"===r.type?C+=` AND ${t} >= ${e}`:"lessThanOrEqual"===r.type&&(C+=` AND ${t} <= ${e}`)}}})}catch(e){console.error("Error parsing filters:",e)}l.length>0&&(C?C+=" AND "+l.join(" AND "):C="WHERE "+l.join(" AND "));let u="ORDER BY end_date DESC";if(o&&_&&/^[a-zA-Z0-9_]+$/.test(o)){let e="ASC"===_.toUpperCase()?"ASC":"DESC";u=`ORDER BY ${o} ${e}`}let m=`LIMIT ${i} OFFSET ${(T-1)*i}`,N=`FROM (
        SELECT *
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY ts_code, end_date, report_type
              ORDER BY COALESCE(CAST(update_flag AS INTEGER), 0) DESC
            ) AS __rn
          ${c} ${C}
        )
        WHERE __rn = 1
      ) AS t`,O=`SELECT COUNT(*) AS cnt ${N}`,H=`FROM (
        WITH calc_base AS (
          SELECT
            *,
            CASE
              -- 1季度(0331)：第一季度累计即单季
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331'
                THEN TRY_CAST(total_revenue AS DOUBLE)

              -- 2季度(0630)：必须确保上一条是本年的 0331，才安全相减
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630'
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                ) = '0331'
                THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                )

              -- 3季度(0930)：必须确保上一条是本年的 0630
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930'
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                ) = '0630'
                THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                )

              -- 4季度(1231)：必须确保上一条是本年的 0930
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231'
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                ) = '0930'
                THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                )

              -- 兜底：如果缺失紧邻的上一个季度数据，强行减会得出错误数值，此时返回 NULL 更为严谨
              ELSE NULL
            END AS q_total_revenue
            ,
            CASE
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331'
                THEN TRY_CAST(compr_inc_attr_p AS DOUBLE)
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630'
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                ) = '0331'
                THEN TRY_CAST(compr_inc_attr_p AS DOUBLE) - LAG(TRY_CAST(compr_inc_attr_p AS DOUBLE)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                )
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930'
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                ) = '0630'
                THEN TRY_CAST(compr_inc_attr_p AS DOUBLE) - LAG(TRY_CAST(compr_inc_attr_p AS DOUBLE)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                )
              WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231'
                AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                ) = '0930'
                THEN TRY_CAST(compr_inc_attr_p AS DOUBLE) - LAG(TRY_CAST(compr_inc_attr_p AS DOUBLE)) OVER (
                  PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4)
                  ORDER BY CAST(end_date AS VARCHAR)
                )
              ELSE NULL
            END AS q_compr_inc_attr_p
          ${N}
        ),
        ttm_calc AS (
          SELECT
            *,
            SUM(q_total_revenue) OVER (
              PARTITION BY ts_code, report_type, comp_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS __ttm_total_revenue,
            SUM(q_compr_inc_attr_p) OVER (
              PARTITION BY ts_code, report_type, comp_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS __ttm_compr_inc_attr_p,
            COUNT(q_total_revenue) OVER (
              PARTITION BY ts_code, report_type, comp_type
              ORDER BY end_date
              ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
            ) AS __window_count
          FROM calc_base
        )
        SELECT
          * EXCLUDE (__ttm_total_revenue, __ttm_compr_inc_attr_p, __window_count),
          CASE WHEN __window_count >= 4 THEN __ttm_total_revenue ELSE NULL END AS ttm_total_revenue,
          CASE WHEN __window_count >= 4 THEN __ttm_compr_inc_attr_p ELSE NULL END AS ttm_compr_inc_attr_p
        FROM ttm_calc
      ) AS calc`,D=`SELECT * REPLACE (
        CAST(ann_date AS VARCHAR) AS ann_date,
        CAST(end_date AS VARCHAR) AS end_date,
        CAST(f_ann_date AS VARCHAR) AS f_ann_date
      ) ${H} ${u} ${m}`;p.all(O,(r,A)=>{if(r){p.close(),a.close(),t(Error(`DuckDB count query error: ${r.message}`));return}let n=Number(A?.[0]?.cnt??0);p.all(D,(r,A)=>{if(r){p.close(),a.close(),t(Error(`DuckDB query error: ${r.message}`));return}if(!A||0===A.length){p.close(),a.close(),e({headers:[],originalHeaders:[],data:[],totalRows:n});return}let o=Object.keys(A[0]),_=(0,s.mapHeadersToChinese)(o,"income1")||o,R=A.map(e=>{let t={};return o.forEach(r=>{"end_date"===r||"ann_date"===r||"f_ann_date"===r?t[r]=function(e){if(null==e)return"";let t=String(e).trim();if(!t)return"";let r=t.match(/^(\d{4})(\d{2})(\d{2})$/),A=r?`${r[1]}-${r[2]}-${r[3]}`:t;try{let e=new Date(A.replace(/-/g,"/"));if(Number.isNaN(e.getTime()))return t;return Intl.DateTimeFormat("zh-CN").format(e)}catch{return t}}(e[r]):t[r]=e[r]}),t});p.close(),a.close(),console.log(`[Parquet API] 查询完成，返回 ${R.length} 条记录（总数: ${n}）`),e({headers:_,originalHeaders:o,data:R,totalRows:n})})})}catch(e){t(Error(`Failed to initialize DuckDB: ${e instanceof Error?e.message:String(e)}`))}})}async function m(e){try{let t=(e.headers.get("accept-encoding")||"").includes("gzip"),r=new URL(e.url),A=S().join(process.cwd(),"temp/tuShare/income_vip_ss.parquet"),a=Number(r.searchParams.get("page")??"1"),n=Number(r.searchParams.get("size")??"50"),o=new URLSearchParams(r.searchParams);o.delete("page"),o.delete("size"),o.delete("file");let R=o.toString()?`?${o.toString()}`:"",p=await u(A,R,{page:a,size:n}),d={category:"income1",filename:"income_vip",headers:p.headers,originalHeaders:p.originalHeaders,data:p.data,totalRows:p.totalRows},T=JSON.stringify(d),i=Buffer.byteLength(T,"utf8");if(!t||!(i>1024))return _.NextResponse.json(d);{let e=await l(T),t=e.length,r=((1-t/i)*100).toFixed(1);return console.log(`[Parquet API] 原始大小: ${(i/1024).toFixed(2)}KB, 压缩后: ${(t/1024).toFixed(2)}KB, 压缩率: ${r}%`),new _.NextResponse(e,{status:200,headers:{"Content-Type":"application/json","Content-Encoding":"gzip","Content-Length":t.toString()}})}}catch(e){return console.error("Error querying parquet file:",e),_.NextResponse.json({error:"Failed to query parquet file",message:e instanceof Error?e.message:String(e)},{status:500})}}let N=new a.AppRouteRouteModule({definition:{kind:n.x.APP_ROUTE,page:"/api/parq/income1/route",pathname:"/api/parq/income1",filename:"route",bundlePath:"app/api/parq/income1/route"},resolvedPagePath:"/home/runner/work/tama/tama/apps/pj_finance/app/api/parq/income1/route.ts",nextConfigOutput:"",userland:A}),{requestAsyncStorage:O,staticGenerationAsyncStorage:H,serverHooks:D}=N,L="/api/parq/income1/route";function g(){return(0,o.patchFetch)({serverHooks:D,staticGenerationAsyncStorage:H})}}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),A=t.X(0,[948,972,377,858],()=>r(37151));module.exports=A})();