export interface Verse {
  id: number;
  text: string;
}

export interface Chapter {
  id: number;
  verses: Verse[];
}

export interface Book {
  id: string;
  title: string;
  chapters: Chapter[];
}

export interface Bible {
  version?: string;
  books: Book[];
}
