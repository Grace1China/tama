import fs from 'fs';
import Papa from 'papaparse';

export function readCSV(filePath: string) {
    const file2read = filePath.endsWith('.csv') ? filePath : `${filePath}.csv`;
    const content = fs.readFileSync(file2read, 'utf-8');
    const parsed = Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
    });
    return parsed.data;
}

export function readCSVFile(filePath: string) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = Papa.parse(content, {
      header: true,
      skipEmptyLines: true,
    });
    return parsed.data;
}