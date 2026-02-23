import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import * as path from 'path';
import { Bible, Book, Chapter, Verse } from '../types/bible';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true,
});

function parseXmlToBible(xmlPath: string): Omit<Bible, 'version'> {
  const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  
  const json = parser.parse(xmlContent);
  const usfx = json.usfx;
  const books: Book[] = [];

  // Handle both single book and array of books
  const bookElements = Array.isArray(usfx.book) ? usfx.book : [usfx.book];

  for (const bookElement of bookElements) {
    if (!bookElement) continue;

    const bookId = bookElement['@_id'];
    const bookTitle = bookElement.h?.['#text'] || bookElement.h || '';
    
    const chapters: Chapter[] = [];
    let currentChapter: Chapter | null = null;
    let currentVerses: Verse[] = [];

    // Process all child elements
    const processElement = (element: any) => {
      if (!element) return;

      // Handle chapter marker
      if (element.c) {
        const chapterId = element.c['@_id'] || element.c;
        const chapterNum = typeof chapterId === 'number' ? chapterId : parseInt(chapterId, 10);
        
        // Save previous chapter if exists
        if (currentChapter) {
          currentChapter.verses = currentVerses;
          chapters.push(currentChapter);
        }
        
        // Start new chapter
        currentChapter = { id: chapterNum, verses: [] };
        currentVerses = [];
      }

      // Handle verse
      if (element.v) {
        const verseId = element.v['@_id'] || element.v;
        const verseNum = typeof verseId === 'number' ? verseId : parseInt(verseId, 10);
        const verseText = element.v['#text'] || element.v || '';
        
        if (verseText && currentChapter) {
          currentVerses.push({ id: verseNum, text: verseText.trim() });
        }
      }

      // Handle verse end tag (ve) - this might appear as a separate element
      if (element.ve) {
        // Verse end marker, no action needed
      }
    };

    // Process all elements in the book
    const processBookContent = (content: any) => {
      if (!content) return;

      if (Array.isArray(content)) {
        content.forEach(processElement);
      } else if (typeof content === 'object') {
        // Check if it's a chapter or verse element
        if (content.c !== undefined) {
          processElement({ c: content.c });
        }
        if (content.v !== undefined) {
          processElement({ v: content.v });
        }
        if (content.ve !== undefined) {
          processElement({ ve: content.ve });
        }
        
        // Recursively process object properties
        Object.values(content).forEach(val => {
          if (val && typeof val === 'object' && !Array.isArray(val)) {
            processBookContent(val);
          }
        });
      }
    };

    // Extract book content (everything except the h tag)
    const bookContent = { ...bookElement };
    delete bookContent.h;
    delete bookContent['@_id'];

    // Process all child nodes
    Object.keys(bookContent).forEach(key => {
      const value = bookContent[key];
      
      if (key === 'c') {
        // Handle chapters
        const chaptersArray = Array.isArray(value) ? value : [value];
        chaptersArray.forEach((c: any) => {
          const chapterId = c['@_id'] || c;
          const chapterNum = typeof chapterId === 'number' ? chapterId : parseInt(chapterId, 10);
          
          if (currentChapter) {
            currentChapter.verses = currentVerses;
            chapters.push(currentChapter);
          }
          
          currentChapter = { id: chapterNum, verses: [] };
          currentVerses = [];
        });
      } else if (key === 'v') {
        // Handle verses
        const versesArray = Array.isArray(value) ? value : [value];
        versesArray.forEach((v: any) => {
          const verseId = v['@_id'] || v;
          const verseNum = typeof verseId === 'number' ? verseId : parseInt(verseId, 10);
          const verseText = v['#text'] || (typeof v === 'string' ? v : '');
          
          if (verseText && currentChapter) {
            currentVerses.push({ id: verseNum, text: verseText.trim() });
          }
        });
      } else if (typeof value === 'object' && value !== null) {
        // Recursively process nested objects
        processBookContent(value);
      }
    });

    // Save the last chapter
    if (currentChapter && typeof currentChapter === 'object' && 'verses' in currentChapter) {
      (currentChapter as any).verses = currentVerses;
      chapters.push(currentChapter);
    }

    if (bookId && bookTitle) {
      books.push({
        id: bookId,
        title: bookTitle,
        chapters: chapters.filter(ch => ch.verses.length > 0),
      });
    }
  }

  return { books };
}

// Alternative parsing approach - parse XML as text (more reliable for usfx)
function parseBibleText(xmlPath: string): Omit<Bible, 'version'> {
  const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
  
  const books: Book[] = [];
  let currentBook: Book | null = null;
  let currentChapter: Chapter | null = null;
  let currentVerses: Verse[] = [];

  // Use regex to parse the XML structure
  const bookRegex = /<book id="([^"]+)">\s*<h>([^<]+)<\/h>/g;
  const chapterRegex = /<c id="(\d+)"\s*\/>/g;
  const verseRegex = /<v id="(\d+)"\s*\/>([^<]*)<ve\/>/g;

  // Split by books first
  const bookMatches = [...xmlContent.matchAll(/<book id="([^"]+)">/g)];
  
  for (let i = 0; i < bookMatches.length; i++) {
    const bookMatch = bookMatches[i];
    const bookStart = bookMatch.index!;
    const bookEnd = i < bookMatches.length - 1 ? bookMatches[i + 1].index! : xmlContent.length;
    const bookSection = xmlContent.substring(bookStart, bookEnd);
    
    // Extract book ID and title
    const bookIdMatch = bookSection.match(/<book id="([^"]+)">/);
    const titleMatch = bookSection.match(/<h>([^<]+)<\/h>/);
    
    if (!bookIdMatch) continue;
    
    const bookId = bookIdMatch[1];
    const bookTitle = titleMatch ? titleMatch[1] : '';
    
    const chapters: Chapter[] = [];
    let chapterId = 0;
    let verses: Verse[] = [];
    
    // Extract chapters
    const chapterMatches = [...bookSection.matchAll(/<c id="(\d+)"\s*\/>/g)];
    
    for (let j = 0; j < chapterMatches.length; j++) {
      const chapterMatch = chapterMatches[j];
      const chapterStart = chapterMatch.index!;
      const chapterEnd = j < chapterMatches.length - 1 ? chapterMatches[j + 1].index! : bookSection.length;
      const chapterSection = bookSection.substring(chapterStart, chapterEnd);
      
      chapterId = parseInt(chapterMatch[1], 10);
      verses = [];
      
      // Extract verses in this chapter
      const verseMatches = [...chapterSection.matchAll(/<v id="(\d+)"\s*\/>([^<]*)<ve\/>/g)];
      
      for (const verseMatch of verseMatches) {
        const verseId = parseInt(verseMatch[1], 10);
        const verseText = verseMatch[2].trim();
        
        if (verseText) {
          verses.push({ id: verseId, text: verseText });
        }
      }
      
      if (verses.length > 0) {
        chapters.push({ id: chapterId, verses });
      }
    }
    
    if (chapters.length > 0) {
      books.push({
        id: bookId,
        title: bookTitle,
        chapters,
      });
    }
  }

  return { books };
}

// Main execution
const projectRoot = path.join(__dirname, '..');
const outputs: { xml: string; json: string; version: string }[] = [
  { xml: 'chi-cuv.usfx.xml', json: 'bible-cuv.json', version: '和合本' },
  { xml: 'chi-cuv-simp.usfx.xml', json: 'bible-cuv-simple.json', version: '和合本简体' },
];

try {
  const dataDir = path.join(projectRoot, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  for (const { xml, json, version } of outputs) {
    const xmlPath = path.join(projectRoot, xml);
    if (!fs.existsSync(xmlPath)) {
      console.warn(`Skipping ${xml}: file not found`);
      continue;
    }

    console.log(`Parsing ${xml}...`);
    const parsed = parseBibleText(xmlPath);
    const bible: Bible = { version, ...parsed };

    console.log(`  Parsed ${bible.books.length} books`);
    bible.books.slice(0, 3).forEach((book) => {
      console.log(`    - ${book.id}: ${book.title} (${book.chapters.length} chapters)`);
    });
    if (bible.books.length > 3) {
      console.log(`    ... and ${bible.books.length - 3} more`);
    }

    const outputPath = path.join(dataDir, json);
    fs.writeFileSync(outputPath, JSON.stringify(bible, null, 2), 'utf-8');
    console.log(`  Written to ${outputPath}\n`);
  }

  console.log('Parsing complete!');
} catch (error) {
  console.error('Error parsing Bible:', error);
  process.exit(1);
}
