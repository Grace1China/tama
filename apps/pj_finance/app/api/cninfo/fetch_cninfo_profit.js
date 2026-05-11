#!/usr/bin/env node
/**
 * Download CNINFO income statement and export parquet.
 *
 * Usage:
 *   node fetch_cninfo_profit.js --scode 000426 --rdate 20250930 --type 071001
 *   node fetch_cninfo_profit.js --scode 000426 --rdate 20250930 --type 071001 --header-mode tushare
 *
 * Defaults:
 *   scode=000426
 *   rdate=20250930
 *   type=071001
 *   header-mode=cninfo
 *   out=apps/pj_finance/temp/cninfo/income_cninfo.parquet
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const duckdb = require("duckdb");

const BASE_URL = "https://webapi.cninfo.com.cn";
const SLATKEY_URL = `${BASE_URL}/api/mcode/slatkey`;
const PJ_FINANCE_ROOT = path.resolve(__dirname, "../../..");
const MAP_CSV_PATH = path.join(PJ_FINANCE_ROOT, "temp", "tuShare", "_meta", "cninfo_tushare_income.csv");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith("--")) {
      args[key] = val;
      i += 1;
    } else {
      args[key] = "true";
    }
  }
  return args;
}

function buildAcceptEnckey(slatkey) {
  const key = Buffer.from(slatkey, "utf8");
  const iv = Buffer.from(slatkey, "utf8");
  const payload = Math.floor(Date.now() / 1000).toString();
  const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
  let encrypted = cipher.update(payload, "utf8", "base64");
  encrypted += cipher.final("base64");
  return encrypted;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function loadFieldMap(csvPath) {
  const text = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = parseCsvLine(lines[0]);
  const idx = {
    cninfoCode: header.indexOf("cninfo_code"),
    cninfoName: header.indexOf("cninfo_name"),
    tushareName: header.indexOf("tushare_name"),
  };
  if (idx.cninfoCode === -1 || idx.cninfoName === -1 || idx.tushareName === -1) {
    throw new Error(`Invalid mapping CSV header in ${csvPath}`);
  }

  const map = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const cninfoCode = cols[idx.cninfoCode];
    const cninfoName = cols[idx.cninfoName];
    const tushareName = cols[idx.tushareName];
    if (!cninfoCode) continue;
    map.push({ cninfoCode, cninfoName, tushareName });
  }
  return map;
}

function transformRows(rows, fieldMap, headerMode) {
  const useTushare = headerMode === "tushare";
  return rows.map((row) => {
    const out = {};
    fieldMap.forEach(({ cninfoCode, cninfoName, tushareName }) => {
      const targetKey = useTushare ? tushareName : cninfoName;
      if (!targetKey) return;
      out[targetKey] = Object.prototype.hasOwnProperty.call(row, cninfoCode) ? row[cninfoCode] : null;
    });
    return out;
  });
}

function toParquet(rows, outPath) {
  if (!rows.length) {
    throw new Error("No rows to export");
  }
  const tmpJsonPath = path.join(os.tmpdir(), `cninfo_income_${Date.now()}.json`);
  fs.writeFileSync(tmpJsonPath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");

  return new Promise((resolve, reject) => {
    const db = new duckdb.Database(":memory:");
    const conn = db.connect();
    const src = tmpJsonPath.replace(/'/g, "''");
    const dest = outPath.replace(/'/g, "''");

    conn.run(`CREATE TABLE t AS SELECT * FROM read_json_auto('${src}')`, (createErr) => {
      if (createErr) {
        conn.close();
        db.close();
        fs.rmSync(tmpJsonPath, { force: true });
        reject(createErr);
        return;
      }
      conn.run(`COPY t TO '${dest}' (FORMAT PARQUET)`, (copyErr) => {
        conn.close();
        db.close();
        fs.rmSync(tmpJsonPath, { force: true });
        if (copyErr) {
          reject(copyErr);
          return;
        }
        resolve();
      });
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  const scode = args.scode || "000426";
  const rdate = args.rdate || "20250930";
  const type = args.type || "071001";
  const headerMode = args["header-mode"] === "tushare" ? "tushare" : "cninfo";
  const defaultOut = path.join(PJ_FINANCE_ROOT, "temp", "cninfo", "income_cninfo.parquet");
  const out = args.out || defaultOut;

  const slatkeyResp = await fetch(SLATKEY_URL);
  if (!slatkeyResp.ok) {
    throw new Error(`Failed to get slatkey: HTTP ${slatkeyResp.status}`);
  }
  const slatkey = (await slatkeyResp.text()).trim();
  if (!slatkey) {
    throw new Error("Empty slatkey from /api/mcode/slatkey");
  }

  const acceptEnckey = buildAcceptEnckey(slatkey);
  const endpoint = `${BASE_URL}/api/stock/p_stock2301?scode=${encodeURIComponent(scode)}&rdate=${encodeURIComponent(rdate)}&type=${encodeURIComponent(type)}`;

  const resp = await fetch(endpoint, {
    headers: {
      "Accept-Enckey": acceptEnckey,
      Referer: `${BASE_URL}/#/dataBrowse`,
      Origin: BASE_URL,
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0",
    },
  });

  const bodyText = await resp.text();
  if (!resp.ok) {
    throw new Error(`API request failed: HTTP ${resp.status}, body=${bodyText}`);
  }

  const json = JSON.parse(bodyText);
  if (json.resultcode !== 200) {
    throw new Error(`API returned resultcode=${json.resultcode}, resultmsg=${json.resultmsg}`);
  }

  if (!Array.isArray(json.records)) {
    throw new Error("Unexpected API response: records is not an array");
  }

  const fieldMap = loadFieldMap(MAP_CSV_PATH);
  const transformedRows = transformRows(json.records, fieldMap, headerMode);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  await toParquet(transformedRows, out);
  console.log(`Saved ${transformedRows.length} record(s) to ${out} with ${headerMode} headers`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

