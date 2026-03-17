"use strict";(()=>{var e={};e.id=406,e.ids=[406],e.modules={82563:e=>{e.exports=require("duckdb")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},39491:e=>{e.exports=require("assert")},22057:e=>{e.exports=require("constants")},57147:e=>{e.exports=require("fs")},71017:e=>{e.exports=require("path")},12781:e=>{e.exports=require("stream")},73837:e=>{e.exports=require("util")},59796:e=>{e.exports=require("zlib")},37151:(e,t,r)=>{r.r(t),r.d(t,{originalPathname:()=>$,patchFetch:()=>O,requestAsyncStorage:()=>f,routeModule:()=>m,serverHooks:()=>h,staticGenerationAsyncStorage:()=>N});var a={};r.r(a),r.d(a,{GET:()=>g,dynamic:()=>_});var n=r(49303),o=r(88716),s=r(60670),A=r(87070),i=r(57147),l=r.n(i),p=r(71017),d=r.n(p),R=r(59796),c=r.n(R),u=r(73837),S=r(82563),T=r(38290);let _="force-dynamic";BigInt.prototype.toJSON=function(){return Number(this)};let E=(0,u.promisify)(c().gzip);async function C(e,t,r){if(!l().existsSync(e))throw Error(`Parquet file not found: ${e}`);let a=d().resolve(e).replace(/\\/g,"/");console.log("absolutePath",a);let n=new URLSearchParams(t.startsWith("?")?t.slice(1):t),o=n.get("ts_code"),s=n.get("sortField"),A=n.get("sortDir"),i=n.get("filters");return new Promise((e,t)=>{try{let n=new S.Database(":memory:"),l=n.connect(),p=Number.isFinite(r?.page)?r.page:1,d=Number.isFinite(r?.size)?r.size:50,R=Math.max(1,Math.floor(p)),c=Math.max(1,Math.floor(d));console.log(`[Parquet API] 执行分页查询(page=${R}, size=${c}): ${a}`);let u=`FROM read_parquet('${a.replace(/'/g,"''")}')`,_="WHERE 1=1",E=[];if(o){let e=o.replace(/'/g,"''");E.push(`ts_code = '${e}'`)}if(i)try{let e=JSON.parse(i);Object.keys(e).forEach(t=>{let r=e[t];if(/^[a-zA-Z0-9_]+$/.test(t)){if("text"===r.filterType){let e=String(r.filter).replace(/'/g,"''");_+=` AND ${t} LIKE '%${e}%'`}else if("number"===r.filterType){let e=Number(r.filter);if(isNaN(e))return;"equals"===r.type?_+=` AND ${t} = ${e}`:"greaterThan"===r.type?_+=` AND ${t} > ${e}`:"lessThan"===r.type?_+=` AND ${t} < ${e}`:"greaterThanOrEqual"===r.type?_+=` AND ${t} >= ${e}`:"lessThanOrEqual"===r.type&&(_+=` AND ${t} <= ${e}`)}}})}catch(e){console.error("Error parsing filters:",e)}E.length>0&&(_?_+=" AND "+E.join(" AND "):_="WHERE "+E.join(" AND "));let C="ORDER BY end_date DESC";if(s&&A&&/^[a-zA-Z0-9_]+$/.test(s)){let e="ASC"===A.toUpperCase()?"ASC":"DESC";C=`ORDER BY ${s} ${e}`}let g=`LIMIT ${c} OFFSET ${(R-1)*c}`,m=`FROM (
        SELECT *
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY ts_code, end_date, report_type
              ORDER BY COALESCE(CAST(update_flag AS INTEGER), 0) DESC
            ) AS __rn
          ${u} ${_}
        )
        WHERE __rn = 1
      ) AS t`,f=`SELECT COUNT(*) AS cnt ${m}`,N=`FROM (
        SELECT
          *,
         CASE
            -- 1季度(0331)：第一季度累计即单季
            WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0331' 
              THEN TRY_CAST(total_revenue AS DOUBLE)
            
            -- 2季度(0630)：必须确保上一条是本年的 0331，才安全相减
            WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0630' 
             AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0331' 
              THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              
            -- 3季度(0930)：必须确保上一条是本年的 0630
            WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '0930' 
             AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0630' 
              THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              
            -- 4季度(1231)：必须确保上一条是本年的 0930
            WHEN RIGHT(CAST(end_date AS VARCHAR), 4) = '1231' 
             AND LAG(RIGHT(CAST(end_date AS VARCHAR), 4)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR)) = '0930' 
              THEN TRY_CAST(total_revenue AS DOUBLE) - LAG(TRY_CAST(total_revenue AS DOUBLE)) OVER (PARTITION BY ts_code, report_type, comp_type, LEFT(CAST(end_date AS VARCHAR), 4) ORDER BY CAST(end_date AS VARCHAR))
              
            -- 兜底：如果缺失紧邻的上一个季度数据，强行减会得出错误数值，此时返回 NULL 更为严谨
            ELSE NULL 
          END AS q_total_revenue
        ${m}
      ) AS calc`,h=`SELECT * REPLACE (
        CAST(ann_date AS VARCHAR) AS ann_date,
        CAST(end_date AS VARCHAR) AS end_date,
        CAST(f_ann_date AS VARCHAR) AS f_ann_date
      ) ${N} ${C} ${g}`;console.log(`[Parquet API] 执行count查询: ${f}`),console.log(`[Parquet API] 执行分页查询(page=${R}, size=${c}): ${h}`),l.all(f,(r,a)=>{if(r){l.close(),n.close(),t(Error(`DuckDB count query error: ${r.message}`));return}let o=Number(a?.[0]?.cnt??0);l.all(h,(r,a)=>{if(r){l.close(),n.close(),t(Error(`DuckDB query error: ${r.message}`));return}if(!a||0===a.length){l.close(),n.close(),e({headers:[],originalHeaders:[],data:[],totalRows:o});return}let s=Object.keys(a[0]),A=(0,T.mapHeadersToChinese)(s,"income1")||s,i=a.map(e=>{let t={};return s.forEach(r=>{"end_date"===r||"ann_date"===r||"f_ann_date"===r?t[r]=function(e){if(null==e)return"";let t=String(e).trim();if(!t)return"";let r=t.match(/^(\d{4})(\d{2})(\d{2})$/),a=r?`${r[1]}-${r[2]}-${r[3]}`:t;try{let e=new Date(a.replace(/-/g,"/"));if(Number.isNaN(e.getTime()))return t;return Intl.DateTimeFormat("zh-CN").format(e)}catch{return t}}(e[r]):t[r]=e[r]}),t});l.close(),n.close(),console.log(`[Parquet API] 查询完成，返回 ${i.length} 条记录（总数: ${o}）`),e({headers:A,originalHeaders:s,data:i,totalRows:o})})})}catch(e){t(Error(`Failed to initialize DuckDB: ${e instanceof Error?e.message:String(e)}`))}})}async function g(e){try{let t=(e.headers.get("accept-encoding")||"").includes("gzip"),r=new URL(e.url),a=d().join(process.cwd(),"temp/tuShare/income_vip_ss.parquet"),n=Number(r.searchParams.get("page")??"1"),o=Number(r.searchParams.get("size")??"50"),s=new URLSearchParams(r.searchParams);s.delete("page"),s.delete("size"),s.delete("file");let i=s.toString()?`?${s.toString()}`:"",l=await C(a,i,{page:n,size:o}),p={category:"income1",filename:"income_vip",headers:l.headers,originalHeaders:l.originalHeaders,data:l.data,totalRows:l.totalRows},R=JSON.stringify(p),c=Buffer.byteLength(R,"utf8");if(!t||!(c>1024))return A.NextResponse.json(p);{let e=await E(R),t=e.length,r=((1-t/c)*100).toFixed(1);return console.log(`[Parquet API] 原始大小: ${(c/1024).toFixed(2)}KB, 压缩后: ${(t/1024).toFixed(2)}KB, 压缩率: ${r}%`),new A.NextResponse(e,{status:200,headers:{"Content-Type":"application/json","Content-Encoding":"gzip","Content-Length":t.toString()}})}}catch(e){return console.error("Error querying parquet file:",e),A.NextResponse.json({error:"Failed to query parquet file",message:e instanceof Error?e.message:String(e)},{status:500})}}let m=new n.AppRouteRouteModule({definition:{kind:o.x.APP_ROUTE,page:"/api/parq/income1/route",pathname:"/api/parq/income1",filename:"route",bundlePath:"app/api/parq/income1/route"},resolvedPagePath:"/home/runner/work/tama/tama/apps/pj_finance/app/api/parq/income1/route.ts",nextConfigOutput:"",userland:a}),{requestAsyncStorage:f,staticGenerationAsyncStorage:N,serverHooks:h}=m,$="/api/parq/income1/route";function O(){return(0,s.patchFetch)({serverHooks:h,staticGenerationAsyncStorage:N})}}};var t=require("../../../../webpack-runtime.js");t.C(e);var r=e=>t(t.s=e),a=t.X(0,[948,972,377,578,875],()=>r(37151));module.exports=a})();