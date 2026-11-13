import type { CatalogBook } from "./data";
import { isValidIsbn, normalizeIsbn } from "./openbd";

const NDL_OPENSEARCH_ENDPOINT = "https://ndlsearch.ndl.go.jp/api/opensearch";
const NDL_SEARCH_LIMIT = 50;
const NDL_TIMEOUT_MS = 10_000;
const AUTHOR_ROLE_PATTERN = /[\s　]*[\[［(（]?(?:共著|編著|著者|原著|原作|監修|監訳|翻訳|撮影|写真|解説|著|作|訳|編|絵|画|文)[\]］)）]?$/;

function childTexts(item: Element, localName: string, prefix = ""): string[] {
  return [...item.children]
    .filter(child => child.localName === localName && (child.prefix || "") === prefix)
    .map(child => (child.textContent || "").trim())
    .filter(Boolean);
}

function identifiers(item: Element, type: string): string[] {
  return [...item.children]
    .filter(child => child.localName === "identifier" && (child.getAttribute("xsi:type") || "").toUpperCase().endsWith(type))
    .map(child => (child.textContent || "").trim())
    .filter(Boolean);
}

function firstValidIsbn(values: string[]): string {
  const normalized = values.map(normalizeIsbn);
  return normalized.find(value => value.length === 13 && isValidIsbn(value))
    || normalized.find(isValidIsbn)
    || "";
}

function cleanAuthor(value: string): string {
  let author = value.trim();
  // "村田沙耶香 著" や "夏目漱石 [著]" の役割表示を外す。
  for (let index = 0; index < 3 && AUTHOR_ROLE_PATTERN.test(author); index += 1) {
    author = author.replace(AUTHOR_ROLE_PATTERN, "").replace(/[\s　,，・]+$/, "");
  }
  return author;
}

function creatorName(value: string): string {
  // "夏目, 漱石, 1867-1916" → "夏目 漱石"
  return value
    .split(/[,，]/)
    .map(part => part.trim())
    .filter(part => part && !/^\d{3,4}\s*-?\s*\d{0,4}$/.test(part))
    .join(" ");
}

function authorText(item: Element): string {
  const authors = childTexts(item, "author")
    .flatMap(value => value.split(/[,，]/))
    .map(cleanAuthor)
    .filter(Boolean);
  const names = authors.length ? authors : childTexts(item, "creator", "dc").map(creatorName).filter(Boolean);
  return [...new Set(names)].join("、") || "著者不明";
}

function pageCount(item: Element): number {
  const match = childTexts(item, "extent", "dc").join(" ").match(/(\d+)\s*(?:p|ｐ|頁|ページ)/i);
  return match ? Number(match[1]) : 0;
}

function coverIndex(seed: string): number {
  return Math.abs([...seed].reduce((total, char) => total + char.charCodeAt(0), 0)) % 6;
}

function toCatalogBook(item: Element): CatalogBook | null {
  const baseTitle = childTexts(item, "title")[0] || childTexts(item, "title", "dc")[0] || "";
  if (!baseTitle) return null;
  const isbn = firstValidIsbn(identifiers(item, "ISBN"));
  // 雑誌・新聞などISSNだけを持つ逐次刊行物は書籍候補から外す。
  if (!isbn && identifiers(item, "ISSN").length) return null;
  const volume = childTexts(item, "volume", "dcndl")[0] || "";
  const title = volume && !baseTitle.includes(volume) ? `${baseTitle} ${volume}` : baseTitle;
  const author = authorText(item);

  return {
    title,
    author,
    isbn,
    genre: "その他",
    pages: pageCount(item),
    publisher: childTexts(item, "publisher", "dc")[0] || "",
    coverUrl: "",
    source: "catalog",
    cover: coverIndex(isbn || `${title}-${author}`),
  };
}

export async function searchNdlBooks(searchTerm: string, signal?: AbortSignal): Promise<CatalogBook[]> {
  const term = searchTerm.trim();
  if (!term) return [];

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), NDL_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const url = new URL(NDL_OPENSEARCH_ENDPOINT);
    if (isValidIsbn(term)) url.searchParams.set("isbn", normalizeIsbn(term));
    else url.searchParams.set("any", term);
    url.searchParams.set("cnt", String(NDL_SEARCH_LIMIT));
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`国立国会図書館サーチへの接続に失敗しました（${response.status}）`);

    const feed = new DOMParser().parseFromString(await response.text(), "application/xml");
    if (feed.querySelector("parsererror")) throw new Error("国立国会図書館サーチの応答を読み取れませんでした");
    return [...feed.getElementsByTagName("item")]
      .map(toCatalogBook)
      .filter((book): book is CatalogBook => book !== null);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("国立国会図書館サーチがタイムアウトしました");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
