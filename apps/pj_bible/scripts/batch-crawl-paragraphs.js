"use strict";
/**
 * 批量爬取所有书籍的段落信息
 * 从 bible.json 读取所有书籍，遍历每本书的所有章节，爬取段落信息并保存到 data/biblePara/
 *
 * 用法（在 apps/pj_bible 下）: pnpm run crawl-paragraphs -- <bookId>
 * 例:   pnpm run crawl-paragraphs -- PSA
 * 根目录: pnpm run crawl-paragraphs -- PSA -w pj_bible
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBible = loadBible;
var fs = require("fs");
var path = require("path");
var crawl_biblegateway_1 = require("./crawl-biblegateway");
/**
 * 将中文书名转换为 URL 编码格式
 */
function encodeBookTitle(title) {
    return encodeURIComponent(title);
}
/**
 * 构建 Bible Gateway URL
 */
function buildUrl(bookTitle, chapter, version) {
    if (version === void 0) { version = 'niv'; }
    var encodedTitle = encodeBookTitle("".concat(bookTitle, " ").concat(chapter));
    return "https://www.biblegateway.com/passage/?search=".concat(encodedTitle, "&version=").concat(version, "&interface=print");
}
/**
 * 随机延迟（防止反爬虫）
 */
function randomDelay(minSeconds, maxSeconds) {
    if (minSeconds === void 0) { minSeconds = 1; }
    if (maxSeconds === void 0) { maxSeconds = 3; }
    var delayMs = Math.floor(Math.random() * (maxSeconds - minSeconds + 1) * 1000) + minSeconds * 1000;
    return new Promise(function (resolve) { return setTimeout(resolve, delayMs); });
}
/**
 * 读取 bible.json
 */
function loadBible() {
    var filePath = path.join(__dirname, '..', 'data', 'bible-niv.json');
    var content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
}
/**
 * 保存记录到 CSV 文件（追加模式）
 */
function appendRecordsToCSV(filePath, records) {
    var dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    var header = 'book,chapter,paragraph,title,startVerseNo,endVerseNo';
    var rows = records.map(function (r) {
        return "".concat(r.book, ",").concat(r.chapter, ",").concat(r.paragraph, ",\"").concat(r.title, "\",").concat(r.startVerseNo, ",").concat(r.endVerseNo);
    });
    var csvContent = rows.join('\n') + '\n';
    // 如果文件不存在，先写入 header
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, header + '\n', 'utf-8');
    }
    // 追加记录
    fs.appendFileSync(filePath, csvContent, 'utf-8');
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var bookIdArg, bible, outputDir, booksToCrawl, totalBooks, totalChapters, totalRecords, errors, header, _i, booksToCrawl_1, book, bookCsvPath, _a, _b, chapter, url, records, outputFile, err_1, errorMsg, errorLogPath;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    bookIdArg = process.argv[2];
                    if (!bookIdArg) {
                        console.error('请传入书籍 ID，例如: tsx scripts/batch-crawl-paragraphs.ts PSA');
                        process.exit(1);
                    }
                    bible = loadBible();
                    outputDir = path.join(__dirname, '..', 'data', 'biblePara', 'niv');
                    booksToCrawl = bible.books.filter(function (book) { return book.id === bookIdArg; });
                    if (booksToCrawl.length === 0) {
                        console.error("\u672A\u627E\u5230\u4E66\u7C4D ID: ".concat(bookIdArg));
                        process.exit(1);
                    }
                    console.log("\u5F00\u59CB\u6279\u91CF\u722C\u53D6 ".concat(bookIdArg, "\uFF0C\u5171 ").concat(bible.books.length, " \u672C\u4E66\uFF08\u672C\u6B21\u5904\u7406 1 \u672C\uFF09"));
                    totalBooks = 0;
                    totalChapters = 0;
                    totalRecords = 0;
                    errors = [];
                    header = 'book,chapter,paragraph,title,startVerseNo,endVerseNo';
                    _i = 0, booksToCrawl_1 = booksToCrawl;
                    _c.label = 1;
                case 1:
                    if (!(_i < booksToCrawl_1.length)) return [3 /*break*/, 10];
                    book = booksToCrawl_1[_i];
                    console.log("\n\u5904\u7406: ".concat(book.title, " (").concat(book.id, ") - ").concat(book.chapters.length, " \u7AE0"));
                    totalBooks++;
                    bookCsvPath = path.join(outputDir, "".concat(book.id.toLowerCase(), ".csv"));
                    if (!fs.existsSync(outputDir)) {
                        fs.mkdirSync(outputDir, { recursive: true });
                    }
                    fs.writeFileSync(bookCsvPath, header + '\n', 'utf-8');
                    _a = 0, _b = book.chapters;
                    _c.label = 2;
                case 2:
                    if (!(_a < _b.length)) return [3 /*break*/, 9];
                    chapter = _b[_a];
                    totalChapters++;
                    url = buildUrl(book.fullname || book.id, chapter.id);
                    _c.label = 3;
                case 3:
                    _c.trys.push([3, 6, , 8]);
                    console.log("  \u722C\u53D6\u7B2C ".concat(chapter.id, " \u7AE0..."));
                    console.log('url:', url);
                    return [4 /*yield*/, (0, crawl_biblegateway_1.crawlPassage)(url, book.id)];
                case 4:
                    records = _c.sent();
                    if (records.length > 0) {
                        outputFile = path.join(outputDir, "".concat(book.id.toLowerCase(), ".csv"));
                        appendRecordsToCSV(outputFile, records);
                        totalRecords += records.length;
                        console.log("    \u2713 \u6210\u529F\uFF0C\u83B7\u5F97 ".concat(records.length, " \u6761\u8BB0\u5F55"));
                    }
                    else {
                        console.log("    \u26A0 \u8B66\u544A\uFF1A\u6CA1\u6709\u89E3\u6790\u5230\u8BB0\u5F55");
                    }
                    // 随机延迟（1-3秒）
                    return [4 /*yield*/, randomDelay(1, 3)];
                case 5:
                    // 随机延迟（1-3秒）
                    _c.sent();
                    return [3 /*break*/, 8];
                case 6:
                    err_1 = _c.sent();
                    errorMsg = err_1 instanceof Error ? err_1.message : String(err_1);
                    console.error("    \u2717 \u9519\u8BEF: ".concat(errorMsg));
                    errors.push({ book: book.title, chapter: chapter.id, error: errorMsg });
                    // 出错后也延迟一下
                    return [4 /*yield*/, randomDelay(2, 4)];
                case 7:
                    // 出错后也延迟一下
                    _c.sent();
                    return [3 /*break*/, 8];
                case 8:
                    _a++;
                    return [3 /*break*/, 2];
                case 9:
                    _i++;
                    return [3 /*break*/, 1];
                case 10:
                    console.log("\n\u5B8C\u6210\uFF01");
                    console.log("  \u5904\u7406\u4E86 ".concat(totalBooks, " \u672C\u4E66\uFF0C").concat(totalChapters, " \u7AE0"));
                    console.log("  \u5171\u83B7\u5F97 ".concat(totalRecords, " \u6761\u8BB0\u5F55"));
                    console.log("  \u9519\u8BEF: ".concat(errors.length, " \u4E2A"));
                    if (errors.length > 0) {
                        console.log("\n\u9519\u8BEF\u8BE6\u60C5:");
                        errors.forEach(function (e) {
                            console.log("  ".concat(e.book, " \u7B2C ").concat(e.chapter, " \u7AE0: ").concat(e.error));
                        });
                        errorLogPath = path.join(outputDir, 'errors.json');
                        fs.writeFileSync(errorLogPath, JSON.stringify(errors, null, 2), 'utf-8');
                        console.log("\n\u9519\u8BEF\u65E5\u5FD7\u5DF2\u4FDD\u5B58\u5230: ".concat(errorLogPath));
                    }
                    return [2 /*return*/];
            }
        });
    });
}
main().catch(function (err) {
    console.error('致命错误:', err);
    process.exit(1);
});
// const bible = loadBible();
// let bookMap = bible.books.map(book => ({ [book.id]: book.title as string }));
// console.log(bookMap);
