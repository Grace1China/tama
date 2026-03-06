"use strict";
/**
 * 爬取 Bible Gateway 经文页，解析 URL 中的章节，并分析页面中的分段（小标题 + 段落）。
 * 输出 CSV 格式，每条记录包含：book, chapter, paragraph, title, startVerseNo, endVerseNo
 *
 * 用法: npm run crawl-passage -- "https://www.biblegateway.com/passage/?search=箴言%202&version=CCB&interface=print"
 * 或:   tsx scripts/crawl-biblegateway.ts "https://..."
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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.crawlPassage = crawlPassage;
var cheerio = require("cheerio");
var fs = require("fs");
var path = require("path");
var DEFAULT_URL = 'https://www.biblegateway.com/passage/?search=%E7%AE%B4%20%E8%A8%80%202&version=CCB&interface=print';
/**
 * 从 URL 解析出 search 参数（书名+章节）和 version。
 * 例如: search=箴言%202&version=CCB => book=箴言, chapter=2, version=CCB
 * 返回的 book 需要转换为小写英文（如 romans, isa）
 */
function parseUrl(url) {
    var u = new URL(url);
    var search = u.searchParams.get('search') || '';
    var version = u.searchParams.get('version') || '';
    var decoded = decodeURIComponent(search).trim();
    var lastSpace = decoded.lastIndexOf(' ');
    var bookName = lastSpace >= 0 ? decoded.slice(0, lastSpace).trim() : decoded;
    var chapterStr = lastSpace >= 0 ? decoded.slice(lastSpace + 1).trim() : '1';
    var chapter = parseInt(chapterStr, 10) || 1;
    // 将中文书名转换为英文小写（简化版，可以扩展映射表）
    var bookMap = {
        罗马书: 'romans',
        箴言: 'proverbs',
        以赛亚书: 'isa',
        创世纪: 'genesis',
        // 可以继续添加更多映射
    };
    var book = bookMap[bookName] || bookName.toLowerCase().replace(/\s+/g, '');
    return { book: book, chapter: chapter, version: version };
}
/**
 * 从 span.text 类名中解析节号
 * 例如: "Isa-4-1" => { book: "isa", chapter: 4, verse: 1 }
 */
function parseVerseId(classAttr) {
    var match = classAttr.match(/(\w+)-(\d+)-(\d+)/);
    if (!match)
        return null;
    return {
        book: match[1].toLowerCase(),
        chapter: parseInt(match[2], 10),
        verse: parseInt(match[3], 10),
    };
}
/**
 * 抓取页面 HTML 并解析出章节与分段，输出 CSV 格式记录。
 * @param url Bible Gateway URL
 * @param bookId 可选的 book ID（如 "ROM", "GEN"），如果提供则覆盖从 URL 解析出的 book
 */
function crawlPassage(url, bookId) {
    return __awaiter(this, void 0, void 0, function () {
        var res, html, $, _a, parsedBook, chapter, version, book, $textHtml, records, currentTitle, paragraphIndex, currentParagraphVerses, processParagraph;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0: return [4 /*yield*/, fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        },
                    })];
                case 1:
                    res = _b.sent();
                    if (!res.ok) {
                        throw new Error("HTTP ".concat(res.status, ": ").concat(res.statusText));
                    }
                    return [4 /*yield*/, res.text()];
                case 2:
                    html = _b.sent();
                    $ = cheerio.load(html);
                    _a = parseUrl(url), parsedBook = _a.book, chapter = _a.chapter, version = _a.version;
                    book = bookId ? bookId.toLowerCase() : parsedBook;
                    $textHtml = $('.text-html .std-text').first();
                    if (!$textHtml.length) {
                        throw new Error('找不到 .text-html 元素');
                    }
                    records = [];
                    currentTitle = '(无小标题)';
                    paragraphIndex = 0;
                    currentParagraphVerses = [];
                    processParagraph = function () {
                        if (currentParagraphVerses.length > 0) {
                            paragraphIndex++;
                            var startVerseNo = Math.min.apply(Math, currentParagraphVerses);
                            var endVerseNo = Math.max.apply(Math, currentParagraphVerses);
                            records.push({
                                book: book,
                                chapter: chapter,
                                paragraph: paragraphIndex,
                                title: currentTitle,
                                startVerseNo: startVerseNo,
                                endVerseNo: endVerseNo,
                            });
                            currentParagraphVerses = [];
                        }
                    };
                    // 遍历 .text-html 下所有相关元素（按文档顺序）：
                    // - h3 / h4：小标题
                    // - p：段落
                    // - div.poetry / div.list：诗歌或列表段落
                    $textHtml.find('h3, h4, p, div.poetry, div.list').each(function (_, el) {
                        var _a;
                        var $el = $(el);
                        var tag = (_a = el.tagName) === null || _a === void 0 ? void 0 : _a.toLowerCase();
                        // h3 / h4 是小标题（可能同时出现作为一段标题）
                        if (tag === 'h3' || tag === 'h4') {
                            processParagraph();
                            currentTitle = $el.text().trim() || '(无小标题)';
                            return;
                        }
                        // p 标签或 div.poetry / div.list 是段落
                        if (tag === 'p' || (tag === 'div' && ($el.hasClass('poetry') || $el.hasClass('list')))) {
                            // 先处理之前的段落
                            processParagraph();
                            // 在当前段落中查找所有 span.text 元素，提取节号
                            // span.text 的 class 属性可能包含类似 "text Isa-4-1" 或 "Isa-4-1" 的格式
                            $el.find('span.text, span[class*="-"]').each(function (_, span) {
                                var $span = $(span);
                                var spanClass = $span.attr('class') || '';
                                // 尝试从 class 中提取节号（格式：Book-Chapter-Verse）
                                var verseInfo = parseVerseId(spanClass);
                                if (verseInfo && verseInfo.chapter === chapter) {
                                    currentParagraphVerses.push(verseInfo.verse);
                                }
                            });
                            // 如果没有找到 span.text，尝试从文本中提取节号（备用方案）
                            // 经文通常以数字开头，如 "2 孩子啊，"
                            if (currentParagraphVerses.length === 0) {
                                var text = $el.text().trim();
                                // 匹配段落开头的节号，如 "2 孩子啊，" 或 "16 智慧要救你"
                                var verseMatch = text.match(/^(\d+)\s/);
                                if (verseMatch) {
                                    var verseNum = parseInt(verseMatch[1], 10);
                                    if (!isNaN(verseNum) && verseNum > 0 && verseNum < 200) {
                                        currentParagraphVerses.push(verseNum);
                                    }
                                }
                            }
                        }
                    });
                    // 处理最后一个段落
                    processParagraph();
                    return [2 /*return*/, records];
            }
        });
    });
}
/**
 * 将记录数组转换为 CSV 格式字符串
 */
function recordsToCSV(records) {
    var header = 'book,chapter,paragraph,title,startVerseNo,endVerseNo';
    var rows = records.map(function (r) {
        return "".concat(r.book, ",").concat(r.chapter, ",").concat(r.paragraph, ",\"").concat(r.title, "\",").concat(r.startVerseNo, ",").concat(r.endVerseNo);
    });
    return __spreadArray([header], rows, true).join('\n');
}
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var url, outputPath, records, csv, fullPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    url = process.argv[2] || DEFAULT_URL;
                    outputPath = process.argv[3];
                    console.log('Fetching:', url);
                    return [4 /*yield*/, crawlPassage(url)];
                case 1:
                    records = _a.sent();
                    if (records.length === 0) {
                        console.warn('警告: 没有解析到任何记录');
                        return [2 /*return*/];
                    }
                    csv = recordsToCSV(records);
                    if (outputPath) {
                        fullPath = path.resolve(outputPath);
                        fs.writeFileSync(fullPath, csv, 'utf-8');
                        console.log("\u5DF2\u4FDD\u5B58\u5230: ".concat(fullPath));
                        console.log("\u5171 ".concat(records.length, " \u6761\u8BB0\u5F55"));
                    }
                    else {
                        // 输出到控制台
                        console.log(csv);
                    }
                    return [2 /*return*/];
            }
        });
    });
}
// main().catch((err) => {
//   console.error(err);
//   process.exit(1);
// });
