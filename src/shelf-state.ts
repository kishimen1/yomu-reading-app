import { isBookStatus, type Book, type BookStatus } from "./data";

export type ShelfFilter = BookStatus | "all";
export type ShelfView = "grid" | "list";
export type ShelfSort = "date-desc" | "date-asc" | "rating-desc" | "title-asc";
export interface ShelfPreferences {
  filter: ShelfFilter;
  view: ShelfView;
  sort: ShelfSort;
}
export interface ShelfCriteria {
  genre: string;
  rating: string;
  finishedPeriod: string;
}
export interface ShelfState extends ShelfPreferences {
  query: string;
  criteria: ShelfCriteria;
}

const STORAGE_KEY = "yomu-shelf-preferences:v1";
const DEFAULTS: ShelfPreferences = { filter: "all", view: "grid", sort: "date-desc" };

export function isShelfFilter(value: unknown): value is ShelfFilter {
  return value === "all" || isBookStatus(value);
}

export function loadShelfPreferences(storage: Storage = localStorage): ShelfPreferences {
  try {
    const value = JSON.parse(storage.getItem(STORAGE_KEY) || "null") as Partial<ShelfPreferences> | null;
    return {
      filter: isShelfFilter(value?.filter) ? value.filter : DEFAULTS.filter,
      view: value?.view === "list" ? "list" : "grid",
      sort: ["date-desc", "date-asc", "rating-desc", "title-asc"].includes(value?.sort || "") ? value!.sort! : DEFAULTS.sort,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveShelfPreferences(value: ShelfPreferences, storage: Storage = localStorage): void {
  // A display preference must never prevent someone from reading their records.
  try { storage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Keep the session preference. */ }
}

function normalizeSearch(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("ja");
}

export function selectShelfBooks(books: Book[], state: ShelfState): Book[] {
  const terms = normalizeSearch(state.query).trim().split(/\s+/).filter(Boolean);
  const { genre, rating, finishedPeriod } = state.criteria;
  return books.filter(book => {
    if (state.filter !== "all" && book.status !== state.filter) return false;
    if (genre && book.genre !== genre) return false;
    if (rating !== "" && book.rating !== Number(rating)) return false;
    if (finishedPeriod) {
      if (book.status !== "read") return false;
      if (finishedPeriod.startsWith("*-")) {
        if (book.finishedAt.slice(5, 7) !== finishedPeriod.slice(2)) return false;
      } else if (!book.finishedAt.startsWith(finishedPeriod)) return false;
    }
    const text = normalizeSearch([book.title, book.author, book.isbn, book.publisher, book.genre, book.review, book.notes].join(" "));
    return terms.every(term => text.includes(term));
  }).sort((a, b) => {
    if (state.sort === "title-asc") return a.title.localeCompare(b.title, "ja");
    if (state.sort === "rating-desc" && a.rating !== b.rating) return b.rating - a.rating;
    const difference = (a.finishedAt || a.createdAt).localeCompare(b.finishedAt || b.createdAt);
    return state.sort === "date-asc" ? difference : -difference;
  });
}
