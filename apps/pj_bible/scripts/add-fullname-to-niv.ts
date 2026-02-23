import * as fs from "fs";
import * as path from "path";

const dataDir = path.join(__dirname, "..", "data");
const booksCsvPath = path.join(dataDir, "books.csv");
const nivPath = path.join(dataDir, "bible-niv.json");

// Build english -> english-full map from books.csv
const csv = fs.readFileSync(booksCsvPath, "utf-8");
const lines = csv.trim().split("\n");
const header = lines[0].split(",");
const englishIdx = header.indexOf("english");
const fullnameIdx = header.indexOf("english-full");
const idToFullname: Record<string, string> = {};
for (let i = 1; i < lines.length; i++) {
  const row = lines[i].split(",");
  const eng = row[englishIdx];
  const full = row[fullnameIdx];
  if (eng && full) idToFullname[eng] = full;
}

const data = JSON.parse(fs.readFileSync(nivPath, "utf-8"));
for (const book of data.books) {
  const fullname = idToFullname[book.id];
  if (fullname) book.fullname = fullname;
}

fs.writeFileSync(nivPath, JSON.stringify(data, null, 2), "utf-8");
console.log("Added fullname to", data.books.length, "books in bible-niv.json");
