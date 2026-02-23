import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import readLastLines from 'read-last-lines';
import { cache } from './cache';
// @ts-ignore - DuckDB may not have TypeScript definitions
import * as duckdb from 'duckdb';

/**
 * 从CSV文件中提取最新一行数据
 * 使用 read-last-lines 包高效读取文件末尾数据
 * @param filePath 文件路径
 * @param headers CSV文件的列头（从外部传入，因为最后一行不包含header）
 */
async function getLatestRowFromFile(
  filePath: string,
  headers: string[]
): Promise<Record<string, any> | null> {
  try {
    // 读取最后一行（不包含header）
    const lastLine = await readLastLines.read(filePath, 1);
    
    // 使用传入的headers解析最后一行数据
    const parsed = Papa.parse(lastLine, {
      header: false,
      skipEmptyLines: true,
    });

    if (parsed.data.length === 0) {
      return null;
    }

    // 将数据行与headers组合成对象
    const rowData = parsed.data[0] as unknown[];
    if (!Array.isArray(rowData) || rowData.length === 0) {
      return null;
    }

    const result: Record<string, any> = {};
    
    headers.forEach((header, index) => {
      result[header] = rowData[index] !== undefined ? rowData[index] : null;
    });

    return result;
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error);
    return null;
  }
}

/**
 * 批量处理文件（控制并发数）
 * @param files 文件路径数组
 * @param headers CSV文件的列头
 * @param batchSize 每批处理的文件数量
 */
async function processBatch(
  files: string[],
  headers: string[],
  batchSize: number = 50
): Promise<Array<{ filename: string; data: Record<string, any> | null }>> {
  const results: Array<{ filename: string; data: Record<string, any> | null }> = [];
  
  // 分批处理
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    
    // 并行处理当前批次
    const batchPromises = batch.map(async (file) => {
      const data = await getLatestRowFromFile(file, headers);
      return {
        filename: path.basename(file),
        data,
      };
    });

    // 使用allSettled确保即使有文件失败也不影响其他文件
    const batchResults = await Promise.allSettled(batchPromises);
    
    batchResults.forEach((result) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error('Batch processing error:', result.reason);
      }
    });

    // 每处理一批后短暂休息，避免内存压力过大
    if (i + batchSize < files.length) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  return results;
}



/**
 * 使用DuckDB查询parquet文件中的财务指标数据
 * @param query 查询字符串，格式: ?ts_code=000001.SZ&begin_ann_date=20121030&end_ann_date=20251231
 * @param param 分页参数，包含page和size
 */
export async function processIndicatorFilesDuckDb(
  query: string,
  pageCfg: { page: number; size: number }
): Promise<{
  headers: string[];
  originalHeaders: string[];
  data: Record<string, any>[];
  totalRows: number;
}> {
  // 解析查询参数
  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  const tsCode = params.get('ts_code');
  const beginAnnDate = params.get('begin_ann_date');
  const endAnnDate = params.get('end_ann_date');

  // 获取参数
  const sortField = params.get('sortField');
  const sortDir = params.get('sortDir'); // 'asc' 或 'desc'
  const filtersStr = params.get('filters');

  

  // 构建parquet文件路径（相对于项目根目录）
  const parquetPath = path.join(process.cwd(), 'temp/tuShare/finance_indicators.parquet');
  
  // 检查文件是否存在
  if (!fs.existsSync(parquetPath)) {
    throw new Error(`Parquet file not found: ${parquetPath}`);
  }

  // 将路径转换为绝对路径，并处理Windows路径分隔符
  const absolutePath = path.resolve(parquetPath).replace(/\\/g, '/');

  return new Promise((resolve, reject) => {
    try {
      // 创建DuckDB连接
      const db = new duckdb.Database(':memory:');
      const conn = db.connect();

      // 构建SQL查询，使用参数化查询避免SQL注入
      const page = Number.isFinite(pageCfg?.page) ? pageCfg.page : 1;
      const size = Number.isFinite(pageCfg?.size) ? pageCfg.size : 50;
      const safePage = Math.max(1, Math.floor(page));
      const safeSize = Math.max(1, Math.floor(size));
      const offset = (safePage - 1) * safeSize;

      const fromClause = `FROM read_parquet('${absolutePath.replace(/'/g, "''")}')`;
      let whereClause = 'WHERE 1=1';
      const conditions: string[] = [];

      if (tsCode) {
        // 转义单引号防止SQL注入
        const escapedTsCode = tsCode.replace(/'/g, "''");
        conditions.push(`ts_code = '${escapedTsCode}'`);
      }

      if (filtersStr) {
        const filters = JSON.parse(filtersStr);
        // 遍历 filters 对象生成 SQL
        // 例如: filters['eps'] -> "AND eps > 10"
        // 注意：这里需要防止 SQL 注入，且转换逻辑比较繁琐，
        // 简单实现：只支持 "包含" 或 "数字比较"
        Object.keys(filters).forEach(key => {
           const f = filters[key];
           if (f.filterType === 'text') {
             whereClause += ` AND ${key} LIKE '%${f.filter}%'`;
           } else if (f.filterType === 'number') {
             // 简化处理，只处理等于/大于
             if (f.type === 'equals') whereClause += ` AND ${key} = ${f.filter}`;
             // ... 其他类型
           }
        });
      }
      
      

      if (conditions.length > 0) {
        whereClause += ' AND ' + conditions.join(' AND ');
      }

      let orderByClause = 'ORDER BY ann_date DESC';
      // 2. 构建 ORDER BY 子句 (处理排序)
      // let orderByClause = "";
      if (sortField && sortDir) {
        // 必须验证 sortField 是合法的列名，防止 SQL 注入
        // 简单验证：只允许字母下划线
        if (/^[a-zA-Z0-9_]+$/.test(sortField)) {
          orderByClause = `ORDER BY ${sortField} ${sortDir.toUpperCase()}`;
        }
      }
      const limitOffsetClause = `LIMIT ${safeSize} OFFSET ${offset}`;

      const countSql = `SELECT COUNT(*) AS cnt ${fromClause} ${whereClause}`;
      const dataSql = `SELECT * ${fromClause} ${whereClause} ${orderByClause} ${limitOffsetClause}`;

      console.log(`[DuckDB] 执行count查询: ${countSql}`);
      console.log(`[DuckDB] 执行分页查询(page=${safePage}, size=${safeSize}): ${dataSql}`);

      // 先查总数（不受分页影响）
      conn.all(countSql, (countErr: Error | null, countRows: any[]) => {
        if (countErr) {
          conn.close();
          db.close();
          reject(new Error(`DuckDB count query error: ${countErr.message}`));
          return;
        }

        const totalRows = Number(countRows?.[0]?.cnt ?? 0);

        // 再查分页数据
        conn.all(dataSql, (err: Error | null, rows: any[]) => {
          if (err) {
            conn.close();
            db.close();
            reject(new Error(`DuckDB query error: ${err.message}`));
            return;
          }

          if (!rows || rows.length === 0) {
            conn.close();
            db.close();
            resolve({
              headers: [],
              originalHeaders: [],
              data: [],
              totalRows,
            });
            return;
          }

          // 获取列名（从第一行数据中提取）
          const originalHeaders = Object.keys(rows[0]);
          const headers = originalHeaders; // 可以根据需要映射为中文

          // 转换数据格式
          const data = rows.map(row => {
            const record: Record<string, any> = {};
            originalHeaders.forEach(header => {
              record[header] = row[header];
            });
            return record;
          });

          conn.close();
          db.close();

          console.log(`[DuckDB] 查询完成，返回 ${data.length} 条记录（总数: ${totalRows}）`);

          resolve({
            headers,
            originalHeaders,
            data,
            totalRows,
          });
        });
      });
    } catch (error) {
      reject(new Error(`Failed to initialize DuckDB: ${error instanceof Error ? error.message : String(error)}`));
    }
  });
}

/**
 * 处理indicator目录下的所有CSV文件，提取最新一行数据
 * 使用缓存机制，1小时更新一次
 */
export async function processIndicatorFiles(indicatorDir: string): Promise<{
  headers: string[];
  originalHeaders: string[];
  data: Record<string, any>[];
  totalRows: number;
  processedFiles: number;
  failedFiles: number;
  fromCache: boolean;
  cacheTTL: number;
}> {
  const cacheKey = `indicator_${indicatorDir}`;
  const CACHE_TTL = 3600; // 1小时 = 3600秒

  // 检查缓存
  const cachedData = cache.get<{
    headers: string[];
    originalHeaders: string[];
    data: Record<string, any>[];
    totalRows: number;
    processedFiles: number;
    failedFiles: number;
  }>(cacheKey);

  if (cachedData) {
    const cacheTTL = cache.getTTL(cacheKey);
    console.log(`[Indicator] 使用缓存数据，剩余有效时间: ${cacheTTL}秒`);
    return {
      ...cachedData,
      fromCache: true,
      cacheTTL,
    };
  }

  // 缓存未命中，处理文件
  const startTime = performance.now();
  
  // 1. 获取所有CSV文件
  const getAllFilesStartTime = performance.now();
  const allFiles = fs.readdirSync(indicatorDir)
    .filter(file => file.endsWith('.csv'))
    .map(file => path.join(indicatorDir, file));
  const getAllFilesEndTime = performance.now();
  console.log(`[Indicator] 找到 ${allFiles.length} 个CSV文件，耗时: ${(getAllFilesEndTime - getAllFilesStartTime).toFixed(2)}ms`);

  if (allFiles.length === 0) {
    throw new Error('No CSV files found in indicator directory');
  }

  // 2. 读取第一个文件获取headers（所有文件应该有相同的结构）
  const sampleFile = allFiles[0];
  const sampleContent = fs.readFileSync(sampleFile, 'utf-8');
  const sampleParsed = Papa.parse(sampleContent.split('\n').slice(0, 2).join('\n'), {
    header: true,
    skipEmptyLines: true,
  });
  const headers = sampleParsed.meta.fields || [];
  const originalHeaders = [...headers];

  // 3. 批量处理所有文件（根据文件数量动态调整批次大小）
  const processStartTime = performance.now();
  // 对于大量文件，使用较小的批次大小以避免内存压力
  // 对于少量文件，可以使用较大的批次大小以提高速度
  const batchSize = allFiles.length > 1000 ? 30 : 50;
  const results = await processBatch(allFiles, headers, batchSize);
  const processEndTime = performance.now();
  const avgTimePerFile = (processEndTime - processStartTime) / allFiles.length;
  console.log(`[Indicator] 处理 ${allFiles.length} 个文件耗时: ${(processEndTime - processStartTime).toFixed(2)}ms`);
  console.log(`[Indicator] 平均每个文件: ${avgTimePerFile.toFixed(2)}ms`);

  // 4. 过滤掉失败的文件，提取有效数据
  const validResults = results.filter(r => r.data !== null);
  const failedCount = results.length - validResults.length;
  
  const data = validResults.map(r => r.data!);

  const totalEndTime = performance.now();
  const totalDuration = totalEndTime - startTime;
  console.log(`[Indicator] 总耗时: ${totalDuration.toFixed(2)}ms`);
  console.log(`[Indicator] 成功处理: ${validResults.length} 个文件，失败: ${failedCount} 个文件`);

  const result = {
    headers,
    originalHeaders,
    data,
    totalRows: data.length,
    processedFiles: validResults.length,
    failedFiles: failedCount,
  };

  // 保存到缓存（1小时有效期）
  cache.set(cacheKey, result, CACHE_TTL);
  console.log(`[Indicator] 数据已缓存，有效期: ${CACHE_TTL}秒`);

  return {
    ...result,
    fromCache: false,
    cacheTTL: CACHE_TTL,
  };
}

