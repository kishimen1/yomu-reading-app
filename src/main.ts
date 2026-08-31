import "./styles.css";
import {
  createBackup,
  isBookStatus,
  isThemePreference,
  loadBooks,
  loadSettings,
  normalizeBook,
  parseBackup,
  saveBooks,
  saveSettings,
  todayIso,
  type Book,
  type BookStatus,
  type CatalogBook,
  type ThemePreference,
} from "./data";
import { hasDuplicateBook, mergeImportedBooks, parseBooksCsv } from "./csv";
import { fetchOpenBdBook, isValidIsbn, normalizeIsbn } from "./openbd";
import { searchOpenLibraryBooks } from "./book-search";
import { coverLookupKey, resolveBookCover, shouldLookupBookCover } from "./book-covers";

type ShelfView = "grid" | "list";
type ScreenName = "shelf" | "analytics" | "settings";
type AddMode = "search" | "manual";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorInstance {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new(options?: { formats?: string[] }): BarcodeDetectorInstance;
}

declare global {
  interface Window {
    lucide?: {
      createIcons(options?: { attrs?: Record<string, string | number> }): void;
    };
    BarcodeDetector?: BarcodeDetectorConstructor;
  }
}

const COVER_POSITIONS = ["0% 0%", "50% 0%", "100% 0%", "0% 100%", "50% 100%", "100% 100%"]; 
const GENRE_COLORS = ["#256b54", "#e4513b", "#456a82", "#c3912f", "#7b657f", "#88908b"];
const COVER_LOOKUP_SESSION_LIMIT = 50;
const COVER_LOOKUP_DELAY_MS = 650;
let visibleCatalogBooks: CatalogBook[] = [];
let visibleManualSearchBooks: CatalogBook[] = [];
let selectedManualCatalogBook: CatalogBook | null = null;
let books = loadBooks();
let settings = loadSettings();
let activeFilter: BookStatus = "read";
let activeView: ShelfView = "grid";
let query = "";
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let catalogSearchTimer: ReturnType<typeof setTimeout> | null = null;
let catalogRequest: AbortController | null = null;
let manualSearchRequest: AbortController | null = null;
let scannerStream: MediaStream | null = null;
let scannerTimer: ReturnType<typeof setInterval> | null = null;
let scannerDetectionBusy = false;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let installCompletedThisSession = false;
let coverLookupTimer: ReturnType<typeof setTimeout> | null = null;
let coverLookupRunning = false;
let coverLookupSessionAttempts = 0;
const coverLookupAttempted = new Set<string>();
const priorityCoverLookups = new Set<string>();

function $<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Required element not found: ${selector}`);
  return element;
}

function $$<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}

function persist() {
  saveBooks(books);
  saveSettings(settings);
}

function escapeHtml(value: unknown = ""): string {
  const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" };
  return String(value).replace(/[&<>'"]/g, char => entities[char] ?? char);
}

function formatDate(dateString: string): string {
  if (!dateString) return "日付なし";
  const date = new Date(`${dateString}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function statusLabel(status: BookStatus): string {
  return { read: "読了", reading: "読書中", wishlist: "読みたい" }[status];
}

function iconize() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function showToast(message: string) {
  const toast = $("#toast");
  $("span", toast).textContent = message;
  toast.classList.add("is-visible");
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function coverImageMarkup(book: Pick<Book, "id" | "title" | "coverUrl">, lazy = false): string {
  if (!book.coverUrl) return "";
  return `<img class="real-cover-image" src="${escapeHtml(book.coverUrl)}" alt="${escapeHtml(`『${book.title}』の表紙`)}" ${lazy ? 'loading="lazy"' : ""} decoding="async" referrerpolicy="no-referrer" data-cover-image data-cover-book-id="${escapeHtml(book.id)}">`;
}

function catalogCoverImageMarkup(book: CatalogBook): string {
  if (!book.coverUrl) return "";
  return `<img class="real-cover-image" src="${escapeHtml(book.coverUrl)}" alt="${escapeHtml(`『${book.title}』の表紙`)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-cover-image>`;
}

function coverAttemptKey(book: Book): string {
  return `${book.id}\u0000${coverLookupKey(book)}`;
}

function hasRenderableCover(book: Pick<Book, "coverUrl">): boolean {
  return Boolean(book.coverUrl);
}

function coverSourceMarkup(book: Book): string {
  if (book.coverSource === "openbd") return '<span>書影: <a href="https://openbd.jp/" target="_blank" rel="noopener noreferrer">openBD</a></span>';
  if (book.coverSource === "openlibrary") {
    const link = isValidIsbn(book.isbn) ? `https://openlibrary.org/isbn/${normalizeIsbn(book.isbn)}` : "https://openlibrary.org/";
    return `<span>書影: <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">Open Library</a></span>`;
  }
  return "<span>表紙画像なし</span>";
}

function updateDetailCover(book: Book) {
  const form = document.querySelector<HTMLFormElement>(`#detail-form[data-book-id="${CSS.escape(book.id)}"]`);
  if (!form) return;
  const visual = form.querySelector<HTMLElement>("#detail-cover-visual");
  const source = form.querySelector<HTMLElement>("#detail-cover-source");
  if (visual) {
    visual.classList.toggle("has-real-cover", hasRenderableCover(book));
    visual.innerHTML = coverImageMarkup(book);
  }
  if (source) source.innerHTML = coverSourceMarkup(book);
}

function applyCoverResult(book: Book, result: Awaited<ReturnType<typeof resolveBookCover>>): boolean {
  book.coverLookupKey = result.lookupKey;
  book.coverCheckedAt = result.checkedAt;
  if (!result.coverUrl) return false;
  book.coverUrl = result.coverUrl;
  book.coverSource = result.coverSource;
  return true;
}

async function lookupBookCover(bookId: string, force = false): Promise<"found" | "missing" | "error"> {
  const book = books.find(item => item.id === bookId);
  if (!book || (!force && !shouldLookupBookCover(book)) || !navigator.onLine) return "missing";
  const lookupKey = coverLookupKey(book);
  const attemptKey = coverAttemptKey(book);
  coverLookupAttempted.add(attemptKey);

  try {
    const result = await resolveBookCover(book);
    const current = books.find(item => item.id === bookId);
    if (!current || coverLookupKey(current) !== lookupKey) return "missing";
    const found = applyCoverResult(current, result);
    persist();
    if (found) {
      renderBooks();
      updateDetailCover(current);
      return "found";
    }
    return "missing";
  } catch {
    return "error";
  }
}

function scheduleCoverBackfill(delay = 0) {
  if (coverLookupTimer !== null) return;
  coverLookupTimer = setTimeout(() => {
    coverLookupTimer = null;
    void runCoverBackfill();
  }, delay);
}

function queuePriorityCoverLookup(bookId: string) {
  const book = books.find(item => item.id === bookId);
  if (!book || book.coverUrl) return;
  priorityCoverLookups.add(bookId);
  coverLookupAttempted.delete(coverAttemptKey(book));
  scheduleCoverBackfill();
}

async function runCoverBackfill() {
  if (coverLookupRunning || !navigator.onLine) return;
  coverLookupRunning = true;
  try {
    while (navigator.onLine) {
      const priorityId = priorityCoverLookups.values().next().value as string | undefined;
      const candidate = priorityId
        ? books.find(book => book.id === priorityId)
        : books.find(book => shouldLookupBookCover(book) && !coverLookupAttempted.has(coverAttemptKey(book)));
      if (priorityId && !candidate) {
        priorityCoverLookups.delete(priorityId);
        continue;
      }
      if (!candidate) break;
      if (!priorityId && coverLookupSessionAttempts >= COVER_LOOKUP_SESSION_LIMIT) break;
      priorityCoverLookups.delete(candidate.id);
      coverLookupSessionAttempts += 1;
      await lookupBookCover(candidate.id);
      await new Promise(resolve => window.setTimeout(resolve, COVER_LOOKUP_DELAY_MS));
    }
  } finally {
    coverLookupRunning = false;
    if (priorityCoverLookups.size > 0 && navigator.onLine) scheduleCoverBackfill();
  }
}

async function refreshBookCover(bookId: string, button: HTMLButtonElement) {
  if (!navigator.onLine) {
    showToast("通信できるときに表紙を再取得できます");
    return;
  }
  const book = books.find(item => item.id === bookId);
  if (!book) return;
  button.disabled = true;
  button.classList.add("is-loading");
  const result = await lookupBookCover(bookId, true);
  button.disabled = false;
  button.classList.remove("is-loading");
  iconize();
  showToast(result === "found" ? "表紙画像を更新しました" : result === "missing" ? "一致する表紙画像が見つかりませんでした" : "表紙画像を取得できませんでした");
}

function handleCoverImageError(image: HTMLImageElement) {
  image.hidden = true;
  image.closest(".has-real-cover")?.classList.remove("has-real-cover");
  const bookId = image.dataset.coverBookId;
  const form = bookId ? document.querySelector<HTMLFormElement>(`#detail-form[data-book-id="${CSS.escape(bookId)}"]`) : null;
  const source = form?.querySelector<HTMLElement>("#detail-cover-source");
  if (source) source.textContent = "表紙画像を読み込めませんでした";
}

function isInstalled(): boolean {
  return installCompletedThisSession || window.matchMedia("(display-mode: standalone)").matches;
}

function updateInstallUI() {
  const button = $<HTMLButtonElement>("#install-app");
  const title = $("#install-title");
  const status = $("#install-status");
  if (isInstalled()) {
    title.textContent = "インストール済みです";
    status.textContent = "ホーム画面またはアプリ一覧からYOMUを起動できます。";
    button.disabled = true;
    button.innerHTML = '<i data-lucide="check"></i><span>インストール済み</span>';
  } else if (deferredInstallPrompt) {
    title.textContent = "YOMUをインストール";
    status.textContent = "このブラウザーからすぐにインストールできます。";
    button.disabled = false;
  } else {
    title.textContent = "YOMUをホーム画面へ";
    status.textContent = "Android版Chromeのメニューから「ホーム画面に追加」も選べます。";
    button.disabled = false;
  }
  iconize();
}

function initializeInstallExperience() {
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    updateInstallUI();
  });
  window.addEventListener("appinstalled", () => {
    installCompletedThisSession = true;
    deferredInstallPrompt = null;
    updateInstallUI();
    showToast("YOMUをインストールしました");
  });
  $("#install-app").addEventListener("click", async () => {
    if (isInstalled()) return;
    if (!deferredInstallPrompt) {
      showToast("Chromeのメニューから「ホーム画面に追加」を選んでください");
      return;
    }
    const prompt = deferredInstallPrompt;
    deferredInstallPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") showToast("インストールを開始しました");
    } catch {
      showToast("ブラウザーのメニューからインストールしてください");
    }
    updateInstallUI();
  });
  updateInstallUI();
}

function renderBooks() {
  const sort = $<HTMLSelectElement>("#sort-books").value;
  const normalizedTerms = query.toLocaleLowerCase("ja").trim().split(/\s+/).filter(Boolean);
  const filtered = books
    .filter(book => book.status === activeFilter)
    .filter(book => normalizedTerms.every(term => `${book.title} ${book.author} ${book.isbn} ${book.genre}`.toLocaleLowerCase("ja").includes(term)))
    .sort((a, b) => {
      if (sort === "date-asc") return (a.finishedAt || a.createdAt).localeCompare(b.finishedAt || b.createdAt);
      if (sort === "rating-desc") return b.rating - a.rating;
      if (sort === "title-asc") return a.title.localeCompare(b.title, "ja");
      return (b.finishedAt || b.createdAt).localeCompare(a.finishedAt || a.createdAt);
    });

  const grid = $("#book-grid");
  grid.classList.toggle("is-list", activeView === "list");
  grid.innerHTML = filtered.map((book, index) => `
    <article class="book-card" style="animation-delay:${Math.min(index * 35, 210)}ms">
      <button class="book-cover${hasRenderableCover(book) ? " has-real-cover" : ""}" type="button" data-book-id="${escapeHtml(book.id)}" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}" aria-label="${escapeHtml(book.title)}の詳細を開く">
        ${coverImageMarkup(book, true)}
        <span class="cover-copy"><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}</small></span>
      </button>
      <div class="book-meta">
        <div><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.author)}</p><span class="status-badge">${statusLabel(book.status)}</span></div>
        <div class="book-meta-footer"><span>${book.status === "read" ? formatDate(book.finishedAt) : escapeHtml(book.genre)}</span><span class="rating">${book.rating ? `★ ${book.rating}.0` : "未評価"}</span></div>
      </div>
    </article>`).join("");

  renderEmptyState(filtered.length);
  grid.hidden = filtered.length === 0;
  $("#read-count").textContent = String(books.filter(book => book.status === "read").length);
  $("#reading-count").textContent = String(books.filter(book => book.status === "reading").length);
  $("#wishlist-count").textContent = String(books.filter(book => book.status === "wishlist").length);
}

function renderEmptyState(resultCount: number) {
  const empty = $("#empty-state");
  empty.hidden = resultCount > 0;
  if (resultCount > 0) return;

  const hasQuery = query.trim().length > 0;
  const isFirstBook = books.length === 0;
  const title = $("#empty-title");
  const copy = $("#empty-copy");
  const clearButton = $("#empty-clear-search");
  clearButton.hidden = !hasQuery;

  if (isFirstBook) {
    empty.classList.add("is-first-book");
    title.textContent = "最初の一冊から、あなたの本棚へ";
    copy.textContent = "バーコードをカメラで読むか、書名・著者から探して読書記録を始められます。記録はこの端末だけに保存されます。";
    return;
  }

  empty.classList.remove("is-first-book");
  if (hasQuery) {
    title.textContent = "検索結果がありません";
    copy.textContent = "検索語を変えるか、条件をクリアしてください。";
    return;
  }
  title.textContent = `${statusLabel(activeFilter)}の本はまだありません`;
  copy.textContent = "別の本棚へ切り替えるか、新しい本を追加してください。";
}

function syncAnalyticsYearOptions() {
  const select = $<HTMLSelectElement>("#analytics-year");
  const currentYear = new Date().getFullYear();
  const previousValue = select.value || String(currentYear);
  const years = new Set<number>([currentYear]);
  books.forEach(book => {
    const year = Number(book.finishedAt.slice(0, 4));
    if (book.status === "read" && Number.isInteger(year) && year >= 1000) years.add(year);
  });
  const sortedYears = [...years].sort((a, b) => b - a);
  select.innerHTML = `${sortedYears.map(year => `<option value="${year}">${year}年</option>`).join("")}<option value="all">すべて</option>`;
  select.value = previousValue === "all" || years.has(Number(previousValue)) ? previousValue : String(currentYear);
}

function renderReadingPulse(allReadBooks: Book[], now: Date) {
  const points = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const count = allReadBooks.filter(book => Number(book.finishedAt.slice(0, 4)) === year && Number(book.finishedAt.slice(5, 7)) === month).length;
    return { year, month, count };
  });
  const max = Math.max(...points.map(point => point.count), 1);
  $$(".mini-bars > span").forEach((bar, index) => {
    const point = points[index];
    if (!point) return;
    bar.setAttribute("style", `--bar:${Math.max(point.count / max * 88, point.count ? 20 : 4)}%`);
    bar.classList.toggle("current", index === points.length - 1);
    $("small", bar).textContent = `${point.month}月`;
    bar.setAttribute("title", `${point.year}年${point.month}月 ${point.count}冊`);
  });
  const current = points.at(-1)?.count ?? 0;
  const previous = points.at(-2)?.count ?? 0;
  $("#month-count").textContent = `${current}冊`;
  $("#pace-copy").textContent = allReadBooks.length === 0
    ? "最初の読了記録を追加してみましょう。"
    : current === previous
    ? "先月と同じペースです。"
    : `先月より${Math.abs(current - previous)}冊${current > previous ? "多い" : "少ない"}ペースです。`;
}

function renderAnalytics() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const selectedValue = $<HTMLSelectElement>("#analytics-year").value;
  const selectedYear = selectedValue === "all" ? null : Number(selectedValue);
  const allReadBooks = books.filter(book => book.status === "read" && /^\d{4}-\d{2}-\d{2}$/.test(book.finishedAt));
  const readBooks = selectedYear === null
    ? allReadBooks
    : allReadBooks.filter(book => Number(book.finishedAt.slice(0, 4)) === selectedYear);
  const totalPages = readBooks.reduce((sum, book) => sum + Number(book.pages || 0), 0);
  const rated = readBooks.filter(book => book.rating > 0);
  const averageRating = rated.length ? rated.reduce((sum, book) => sum + book.rating, 0) / rated.length : 0;
  const uniqueAuthors = new Set(readBooks.map(book => book.author)).size;
  const earliest = [...readBooks].sort((a, b) => a.finishedAt.localeCompare(b.finishedAt))[0]?.finishedAt;
  const allYearsMonths = earliest
    ? Math.max(1, (now.getFullYear() - Number(earliest.slice(0, 4))) * 12 + now.getMonth() - (Number(earliest.slice(5, 7)) - 1) + 1)
    : 1;
  const monthsElapsed = selectedYear === null ? allYearsMonths : selectedYear === currentYear ? currentMonth : 12;
  const monthly = Array.from({ length: 12 }, (_, month) => readBooks.filter(book => Number(book.finishedAt.slice(5, 7)) === month + 1).length);
  const currentYearBooks = allReadBooks.filter(book => Number(book.finishedAt.slice(0, 4)) === currentYear);

  $("#analytics-total").textContent = String(readBooks.length);
  $("#sidebar-year-label").textContent = `${currentYear}年の記録`;
  $("#sidebar-year-count").textContent = `${currentYearBooks.length}冊`;
  $("#kpi-pages").textContent = totalPages.toLocaleString("ja-JP");
  $("#kpi-rating").textContent = averageRating.toFixed(1);
  $("#kpi-monthly").textContent = (readBooks.length / monthsElapsed).toFixed(1);
  $("#kpi-authors").textContent = String(uniqueAuthors);
  renderReadingPulse(allReadBooks, now);

  const comparison = $("#analytics-comparison");
  if (selectedYear === null) {
    comparison.innerHTML = `<i data-lucide="library-big"></i> 全期間の読了記録`;
  } else if (!readBooks.length) {
    comparison.innerHTML = `<i data-lucide="book-open"></i> 読了日を入れた本が集計されます`;
  } else {
    const throughMonth = selectedYear === currentYear ? currentMonth : 12;
    const previousYearCount = allReadBooks.filter(book => Number(book.finishedAt.slice(0, 4)) === selectedYear - 1 && Number(book.finishedAt.slice(5, 7)) <= throughMonth).length;
    const difference = readBooks.length - previousYearCount;
    const icon = difference > 0 ? "trending-up" : difference < 0 ? "trending-down" : "minus";
    comparison.innerHTML = previousYearCount
      ? `<i data-lucide="${icon}"></i> 前年同期より <strong>${Math.abs(difference)}冊</strong> ${difference > 0 ? "多い" : difference < 0 ? "少ない" : "同じ"}`
      : `<i data-lucide="bookmark-check"></i> ${selectedYear}年の読了記録`;
  }

  const genreCounts = readBooks.reduce<Record<string, number>>((acc, book) => {
    acc[book.genre] = (acc[book.genre] || 0) + 1;
    return acc;
  }, {});
  const genres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
  let cursor = 0;
  const stops = genres.map(([_, count], index) => {
    const start = cursor;
    cursor += readBooks.length ? count / readBooks.length * 100 : 0;
    return `${GENRE_COLORS[index % GENRE_COLORS.length]} ${start}% ${cursor}%`;
  }).join(", ");
  $("#genre-donut").style.background = `conic-gradient(${stops || "#d7ddd8 0 100%"})`;
  $("#genre-donut").innerHTML = `<div><strong>${genres.length}</strong><span>ジャンル</span></div>`;
  $("#genre-legend").innerHTML = genres.length
    ? genres.map(([genre, count], index) => `
      <div class="legend-row"><i style="background:${GENRE_COLORS[index % GENRE_COLORS.length]}"></i><span>${escapeHtml(genre)}</span><strong>${Math.round(count / readBooks.length * 100)}%</strong></div>`).join("")
    : `<p class="analytics-empty">読了記録が増えると、ジャンルの割合が表示されます。</p>`;

  $("#analytics-summary").textContent = !readBooks.length
    ? "本を読み終えたら、読了日を記録してみましょう。"
    : genres.length === 1
      ? `「${genres[0][0]}」が、この期間の読書を形づくっています。`
      : `「${genres[0][0]}」と「${genres[1][0]}」が、この期間の読書を形づくっています。`;

  const maxMonth = Math.max(...monthly, 1);
  $("#month-chart").setAttribute("aria-label", `${selectedYear ?? "全期間"}の月別読了冊数`);
  $("#month-chart").innerHTML = monthly.map((count, index) => `
    <div class="month-bar ${selectedYear === currentYear && index === currentMonth - 1 ? "current" : ""}"><strong>${count || ""}</strong><i style="--height:${Math.max(count / maxMonth * 82, count ? 20 : 3)}%"></i><span>${index + 1}月</span></div>`).join("");
  $("#trend-signal").innerHTML = readBooks.length
    ? `<i data-lucide="activity"></i> ${readBooks.length}冊を集計`
    : `<i data-lucide="minus"></i> 記録なし`;

  const ratingCounts = [5, 4, 3, 2, 1].map(rating => ({ rating, count: rated.filter(book => book.rating === rating).length }));
  const maxRating = Math.max(...ratingCounts.map(item => item.count), 1);
  $("#rating-bars").innerHTML = ratingCounts.map(item => `
    <div class="rating-row"><strong>${item.rating}.0</strong><div class="rating-track"><i style="width:${item.count / maxRating * 100}%"></i></div><span>${item.count}</span></div>`).join("");

  const insightTitle = $("#insight-title");
  const insightCopy = $("#insight-copy");
  const insightButton = $("#show-insight-books");
  if (!readBooks.length) {
    insightTitle.textContent = "記録から見えてくること";
    insightCopy.textContent = "読了記録が増えると、よく読むジャンルや満足度の高い領域が見えてきます。";
    insightButton.dataset.insightGenre = "";
    insightButton.innerHTML = `最初の本を追加する <i data-lucide="arrow-right"></i>`;
  } else {
    const ratedByGenre = new Map<string, number[]>();
    rated.forEach(book => ratedByGenre.set(book.genre, [...(ratedByGenre.get(book.genre) || []), book.rating]));
    const highestRated = [...ratedByGenre.entries()]
      .map(([genre, ratings]) => ({ genre, average: ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length }))
      .sort((a, b) => b.average - a.average)[0];
    const insightGenre = highestRated?.genre || genres[0]?.[0] || "その他";
    insightTitle.textContent = highestRated ? "満足度の高いジャンル" : "よく読むジャンル";
    insightCopy.innerHTML = highestRated
      ? `「${escapeHtml(insightGenre)}」の平均評価は <strong>${highestRated.average.toFixed(1)}</strong>。この期間で満足度の高い領域です。`
      : `「${escapeHtml(insightGenre)}」を最も多く読んでいます。評価を付けると、満足度も比較できます。`;
    insightButton.dataset.insightGenre = insightGenre;
    insightButton.innerHTML = `該当する本を見る <i data-lucide="arrow-right"></i>`;
  }
  iconize();
}

function renderAll() {
  renderBooks();
  syncAnalyticsYearOptions();
  renderAnalytics();
  updateGoalUI();
  iconize();
}

function navigate(screen: ScreenName) {
  $$(".screen").forEach(section => section.classList.toggle("is-active", section.id === `screen-${screen}`));
  $$('[data-nav]').forEach(button => button.classList.toggle("is-active", button.dataset.nav === screen));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setFilter(filter: BookStatus) {
  activeFilter = filter;
  $$(".shelf-tab").forEach(tab => {
    const isActive = tab.dataset.filter === filter;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  renderBooks();
}

function openAddDialog(mode: AddMode = "search") {
  setAddMode(mode);
  $<HTMLDialogElement>("#add-dialog").showModal();
  if (mode === "search") window.setTimeout(() => $<HTMLInputElement>("#catalog-search").focus(), 50);
  if (mode === "manual") window.setTimeout(() => $<HTMLInputElement>("#manual-form [name=title]").focus(), 50);
}

function closeDialog(id: string) {
  const dialog = document.getElementById(id) as HTMLDialogElement | null;
  if (id === "add-dialog") {
    stopBarcodeScanner();
    catalogRequest?.abort();
    catalogRequest = null;
    manualSearchRequest?.abort();
    manualSearchRequest = null;
  }
  if (dialog?.open) dialog.close();
}

function setAddMode(mode: AddMode) {
  if (mode !== "search") stopBarcodeScanner();
  $$('[data-add-mode]').forEach(button => button.classList.toggle("is-active", button.dataset.addMode === mode));
  $$('[data-add-view]').forEach(view => view.classList.toggle("is-active", view.dataset.addView === mode));
  if (mode === "search" && !$<HTMLInputElement>("#catalog-search").value) {
    visibleCatalogBooks = [];
    renderCatalogResults([], "ISBNを入力すると、openBDから書誌情報を取得します。");
  }
}

function renderCatalogResults(results: CatalogBook[], emptyMessage = "書誌情報が見つかりませんでした。手入力で登録できます。") {
  $("#catalog-results").innerHTML = results.map(book => `
    <article class="catalog-result">
      <div class="result-cover${hasRenderableCover(book) ? " has-real-cover" : ""}" style="--cover-position:${COVER_POSITIONS[book.cover]}">${catalogCoverImageMarkup(book)}</div>
      <span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}${book.publisher ? ` · ${escapeHtml(book.publisher)}` : ""}<br>ISBN ${escapeHtml(book.isbn)}</small></span>
      <button type="button" data-catalog-isbn="${book.isbn}" aria-label="${escapeHtml(book.title)}を追加"><i data-lucide="plus"></i></button>
    </article>`).join("") || `<p class="catalog-empty">${escapeHtml(emptyMessage)}</p>`;
  iconize();
}

async function searchCatalog(searchTerm: string) {
  const term = searchTerm.trim();
  catalogRequest?.abort();
  catalogRequest = null;

  if (!isValidIsbn(term)) {
    visibleCatalogBooks = [];
    renderCatalogResults([], term ? "ISBN-10またはISBN-13の数字を確認してください。" : "ISBNを入力すると、openBDから書誌情報を取得します。");
    $("#catalog-source").textContent = term
      ? "ハイフンは入っていても構いません。ISBNのチェック数字まで入力してください。"
      : "ISBN検索はopenBDを利用します。未収録の場合は手入力で登録できます。";
    return;
  }

  const request = new AbortController();
  catalogRequest = request;
  $("#catalog-source").textContent = "openBDから書誌情報を取得しています…";
  $("#catalog-results").innerHTML = `<p class="catalog-empty">書誌情報を検索中です。</p>`;

  try {
    const result = await fetchOpenBdBook(term, request.signal);
    if (request.signal.aborted) return;
    visibleCatalogBooks = [result];
    renderCatalogResults(visibleCatalogBooks);
    $("#catalog-source").textContent = "openBDの書誌情報です。書影や収録項目がない書籍もあります。";
  } catch (error) {
    if (request.signal.aborted) return;
    visibleCatalogBooks = [];
    renderCatalogResults([], "書誌情報を取得できませんでした。手入力で登録できます。");
    $("#catalog-source").textContent = error instanceof Error ? error.message : "openBDの書誌情報を取得できませんでした。";
  } finally {
    if (catalogRequest === request) catalogRequest = null;
  }
}

function scheduleCatalogSearch(searchTerm: string) {
  if (catalogSearchTimer !== null) clearTimeout(catalogSearchTimer);
  catalogSearchTimer = setTimeout(() => searchCatalog(searchTerm), 350);
}

function renderManualSearchResults(results: CatalogBook[], emptyMessage = "タイトルや著者を入力して検索してください。", selectedIndex = -1) {
  $("#manual-search-results").innerHTML = results.map((book, index) => {
    const metadata = [book.publisher, book.pages ? `${book.pages.toLocaleString("ja-JP")}ページ` : "", book.isbn ? `ISBN ${book.isbn}` : "ISBNなし"].filter(Boolean).join(" · ");
    return `
      <article class="manual-search-result ${index === selectedIndex ? "is-selected" : ""}">
        <div class="result-cover${hasRenderableCover(book) ? " has-real-cover" : ""}" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}">${catalogCoverImageMarkup(book)}</div>
        <span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}<br>${escapeHtml(metadata)}</small></span>
        <button type="button" data-manual-result-index="${index}" aria-label="${escapeHtml(book.title)}を入力欄に反映">${index === selectedIndex ? '<i data-lucide="check"></i><span>選択済み</span>' : '<i data-lucide="arrow-down-to-line"></i><span>選択</span>'}</button>
      </article>`;
  }).join("") || `<p class="catalog-empty">${escapeHtml(emptyMessage)}</p>`;
  iconize();
}

async function searchManualBooks(searchTerm: string) {
  const term = searchTerm.trim();
  manualSearchRequest?.abort();
  manualSearchRequest = null;

  if (!term) {
    visibleManualSearchBooks = [];
    renderManualSearchResults([], "タイトル、著者、出版社、ISBNのいずれかを入力してください。");
    $("#manual-search-source").textContent = "検索語を入力すると、Open Libraryから候補を探します。";
    return;
  }

  const request = new AbortController();
  manualSearchRequest = request;
  $("#manual-search-source").textContent = "本の候補を検索しています…";
  $("#manual-search-results").innerHTML = '<p class="catalog-empty">Open Libraryを検索中です。</p>';

  try {
    const results = await searchOpenLibraryBooks(term, request.signal);
    if (request.signal.aborted) return;
    visibleManualSearchBooks = results;
    renderManualSearchResults(results, "候補が見つかりませんでした。入力欄へ直接記入できます。");
    $("#manual-search-source").textContent = results.length
      ? `${results.length}件の候補です。選ぶと下の入力欄へ反映します。`
      : "候補が見つかりませんでした。検索語を変えるか、下の入力欄へ直接記入してください。";
  } catch (error) {
    if (request.signal.aborted) return;
    visibleManualSearchBooks = [];
    renderManualSearchResults([], "検索できませんでした。入力欄へ直接記入できます。");
    $("#manual-search-source").textContent = error instanceof Error ? error.message : "書籍検索へ接続できませんでした。";
  } finally {
    if (manualSearchRequest === request) manualSearchRequest = null;
  }
}

function selectManualSearchBook(index: number) {
  const book = visibleManualSearchBooks[index];
  if (!book) return;
  selectedManualCatalogBook = book;
  const form = $<HTMLFormElement>("#manual-form");
  $<HTMLInputElement>('[name="title"]', form).value = book.title;
  $<HTMLInputElement>('[name="author"]', form).value = book.author;
  $<HTMLInputElement>('[name="publisher"]', form).value = book.publisher || "";
  $<HTMLInputElement>('[name="isbn"]', form).value = book.isbn;
  $<HTMLInputElement>('[name="genre"]', form).value = book.genre || "その他";
  $<HTMLInputElement>('[name="pages"]', form).value = book.pages ? String(book.pages) : "";
  renderManualSearchResults(visibleManualSearchBooks, undefined, index);
  $("#manual-search-source").textContent = `「${book.title}」を入力欄へ反映しました。内容を確認してから追加してください。`;
  showToast("書誌情報を入力欄へ反映しました");
}

function stopBarcodeScanner() {
  if (scannerTimer !== null) {
    clearInterval(scannerTimer);
    scannerTimer = null;
  }
  scannerStream?.getTracks().forEach(track => track.stop());
  scannerStream = null;
  scannerDetectionBusy = false;
  const video = document.getElementById("barcode-video") as HTMLVideoElement | null;
  if (video) video.srcObject = null;
  const scanner = document.getElementById("barcode-scanner");
  if (scanner) scanner.hidden = true;
  const button = document.getElementById("start-barcode-scan") as HTMLButtonElement | null;
  if (button) button.disabled = false;
}

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) return "カメラの使用が許可されていません。ブラウザーの権限を確認するか、ISBNを入力してください。";
  if (error instanceof DOMException && error.name === "NotFoundError") return "利用できるカメラが見つかりません。ISBNを入力してください。";
  return "カメラを開始できませんでした。ISBNを入力して検索できます。";
}

async function startBarcodeScanner() {
  stopBarcodeScanner();
  const button = $<HTMLButtonElement>("#start-barcode-scan");
  const scanner = $("#barcode-scanner");
  const status = $("#barcode-status");
  const video = $<HTMLVideoElement>("#barcode-video");
  button.disabled = true;

  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("camera-unsupported");
    if (!window.BarcodeDetector) throw new Error("barcode-unsupported");

    scanner.hidden = false;
    status.textContent = "カメラを起動しています…";
    scannerStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = scannerStream;
    await video.play();
    status.textContent = "本の裏表紙にあるISBNバーコードを枠に合わせてください。";

    const detector = new window.BarcodeDetector({ formats: ["ean_13"] });
    scannerTimer = setInterval(() => {
      if (scannerDetectionBusy) return;
      scannerDetectionBusy = true;
      void detector.detect(video).then(codes => {
        const isbn = codes.map(code => normalizeIsbn(code.rawValue)).find(value => value.length === 13 && /^(978|979)/.test(value) && isValidIsbn(value));
        if (!isbn) {
          if (codes.length) status.textContent = "ISBNバーコードではありません。978または979で始まるバーコードを写してください。";
          return;
        }
        $<HTMLInputElement>("#catalog-search").value = isbn;
        stopBarcodeScanner();
        showToast("ISBNを読み取りました");
        void searchCatalog(isbn);
      }).catch(() => {
        // A frame can be unreadable while the camera is moving. Keep scanning.
      }).finally(() => {
        scannerDetectionBusy = false;
      });
    }, 350);
  } catch (error) {
    const message = error instanceof Error && error.message === "barcode-unsupported"
      ? "このブラウザーはバーコード読み取りに対応していません。ISBNを入力して検索してください。"
      : error instanceof Error && error.message === "camera-unsupported"
        ? "この環境ではカメラを利用できません。HTTPSの公開版で開くか、ISBNを入力してください。"
        : cameraErrorMessage(error);
    stopBarcodeScanner();
    $("#catalog-source").textContent = message;
    showToast(message);
  }
}

function addCatalogBook(catalogBook: CatalogBook, source = "検索") {
  const now = todayIso();
  const selectedStatus = $<HTMLSelectElement>("#catalog-status").value;
  const status: BookStatus = isBookStatus(selectedStatus) ? selectedStatus : "read";
  const candidate: Book = { ...catalogBook, id: crypto.randomUUID(), status, rating: 0, finishedAt: status === "read" ? now : "", createdAt: now, notes: settings.synopsis ? catalogBook.synopsis || "" : "", review: "" };
  if (candidate.coverUrl) {
    candidate.coverLookupKey = coverLookupKey(candidate);
    candidate.coverCheckedAt = new Date().toISOString();
  }
  if (hasDuplicateBook(books, candidate)) {
    showToast(`「${catalogBook.title}」はすでに本棚にあります`);
    return;
  }
  books.unshift(candidate);
  persist();
  renderAll();
  closeDialog("add-dialog");
  showToast(`${source}から「${catalogBook.title}」を${statusLabel(status)}の本に追加しました`);
  queuePriorityCoverLookup(candidate.id);
}

function openBookDetail(id: string) {
  const book = books.find(item => item.id === id);
  if (!book) return;
  $("#detail-content").innerHTML = `
    <form class="detail-layout" id="detail-form" data-book-id="${escapeHtml(book.id)}" data-rating="${book.rating}">
      <div class="detail-cover-panel">
        <div class="detail-cover${hasRenderableCover(book) ? " has-real-cover" : ""}" id="detail-cover-visual" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}">${coverImageMarkup(book)}</div>
        <div class="detail-cover-meta" id="detail-cover-source">${coverSourceMarkup(book)}</div>
        <button class="cover-refresh-button" type="button" data-detail-action="refresh-cover"><i data-lucide="refresh-cw"></i><span>表紙を再取得</span></button>
      </div>
      <div class="detail-form">
        <span class="section-kicker">BOOK RECORD</span>
        <h2>${escapeHtml(book.title)}</h2>
        <p class="detail-author">${escapeHtml(book.author)}</p>
        <div class="detail-stats"><span>${escapeHtml(book.genre)}</span>${book.publisher ? `<span>${escapeHtml(book.publisher)}</span>` : ""}<span>${Number(book.pages || 0).toLocaleString()}ページ</span><span>ISBN ${escapeHtml(book.isbn || "未登録")}</span></div>
        <span class="section-kicker">RATING</span>
        <div class="rating-control" role="group" aria-label="評価">
          ${[1,2,3,4,5].map(value => `<button class="${value <= book.rating ? "is-active" : ""}" type="button" data-rating="${value}" aria-label="評価${value}"><i data-lucide="star"></i></button>`).join("")}
        </div>
        <div class="detail-fields">
          <label class="field"><span>タイトル</span><input name="title" value="${escapeHtml(book.title)}" required maxlength="500"></label>
          <label class="field"><span>著者</span><input name="author" value="${escapeHtml(book.author)}" required maxlength="300"></label>
          <div class="detail-metadata-grid">
            <label class="field"><span>ISBN</span><input name="isbn" value="${escapeHtml(book.isbn)}" maxlength="30" inputmode="text" placeholder="ISBN-10 / ISBN-13"></label>
            <label class="field"><span>ジャンル</span><input name="genre" value="${escapeHtml(book.genre)}" list="genre-options" maxlength="100"></label>
            <label class="field"><span>ページ数</span><input name="pages" type="number" min="0" max="100000" inputmode="numeric" value="${book.pages || ""}"></label>
            <label class="field"><span>出版社</span><input name="publisher" value="${escapeHtml(book.publisher || "")}" maxlength="300"></label>
          </div>
          <label class="field"><span>本棚</span><select name="status"><option value="read" ${book.status === "read" ? "selected" : ""}>読んだ</option><option value="reading" ${book.status === "reading" ? "selected" : ""}>読書中</option><option value="wishlist" ${book.status === "wishlist" ? "selected" : ""}>読みたい</option></select></label>
          <label class="field"><span>読了日</span><input name="finishedAt" type="date" value="${escapeHtml(book.finishedAt || "")}"></label>
          <label class="field"><span>メモ</span><textarea name="notes" maxlength="50000" placeholder="引用やページ番号、気づきを記録">${escapeHtml(book.notes || "")}</textarea></label>
          <label class="field"><span>感想</span><textarea name="review" maxlength="50000" placeholder="読後の感想を記録">${escapeHtml(book.review || "")}</textarea></label>
        </div>
        <div class="detail-actions"><button class="primary-button" type="button" id="save-book" data-detail-action="save"><i data-lucide="save"></i><span>変更を保存</span></button><button class="icon-button" type="button" id="share-book" data-detail-action="share" aria-label="本を共有" title="本を共有"><i data-lucide="share-2"></i></button><button class="icon-button danger-button" type="button" id="delete-book" data-detail-action="delete" aria-label="本を削除" title="本を削除"><i data-lucide="trash-2"></i></button></div>
      </div>
    </form>`;
  $<HTMLDialogElement>("#detail-dialog").showModal();
  iconize();
}

function saveBookDetail(form: HTMLFormElement) {
  const book = books.find(item => item.id === form.dataset.bookId);
  if (!book) return;
  const previousLookupKey = coverLookupKey(book);
  const formData = new FormData(form);
  const isbnInput = $<HTMLInputElement>('[name="isbn"]', form);
  const rawIsbn = String(formData.get("isbn") || "").trim();
  isbnInput.setCustomValidity(rawIsbn && !isValidIsbn(rawIsbn) ? "ISBN-10またはISBN-13を確認してください" : "");
  if (!form.reportValidity()) return;
  const status = String(formData.get("status"));
  const nextStatus: BookStatus = isBookStatus(status) ? status : "read";
  const candidate = normalizeBook({
    ...book,
    title: formData.get("title"),
    author: formData.get("author"),
    isbn: rawIsbn ? normalizeIsbn(rawIsbn) : "",
    genre: formData.get("genre"),
    pages: formData.get("pages"),
    publisher: formData.get("publisher"),
    status: nextStatus,
    rating: Number(form.dataset.rating || 0),
    finishedAt: nextStatus === "read" ? String(formData.get("finishedAt") || todayIso()) : "",
    notes: formData.get("notes"),
    review: formData.get("review"),
  });
  if (!candidate) return;
  if (hasDuplicateBook(books.filter(item => item.id !== book.id), candidate)) {
    showToast("同じISBN、または同じ書名と著者の本がすでにあります");
    return;
  }
  const coverIdentityChanged = coverLookupKey(candidate) !== previousLookupKey;
  if (coverIdentityChanged) {
    candidate.coverUrl = "";
    candidate.coverSource = undefined;
    candidate.coverLookupKey = undefined;
    candidate.coverCheckedAt = undefined;
  }
  Object.assign(book, candidate, { id: book.id, createdAt: book.createdAt });
  persist();
  renderAll();
  closeDialog("detail-dialog");
  showToast("読書記録を更新しました");
  if (coverIdentityChanged) queuePriorityCoverLookup(book.id);
}

function shareBook(id: string) {
  const book = books.find(item => item.id === id);
  if (!book) return;
  const text = `『${book.title}』${book.author ? `（${book.author}）` : ""}\n評価: ${book.rating || "未評価"}/5\n${book.review || book.notes || "YOMUで読書記録を管理中"}`;
  if (navigator.share) {
    navigator.share({ title: book.title, text }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text);
    showToast("共有用テキストをコピーしました");
  }
}

function deleteBook(id: string) {
  const book = books.find(item => item.id === id);
  if (!book || !window.confirm(`「${book.title}」を本棚から削除しますか？`)) return;
  books = books.filter(item => item.id !== id);
  persist();
  renderAll();
  closeDialog("detail-dialog");
  showToast("本棚から削除しました");
}

function downloadFile(filename: string, contents: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function exportCsv() {
  const columns = ["id", "title", "author", "isbn", "genre", "status", "rating", "pages", "finished_at", "created_at", "notes", "review"];
  const rows = books.map(book => [book.id, book.title, book.author, book.isbn, book.genre, book.status, book.rating, book.pages, book.finishedAt, book.createdAt, book.notes, book.review]);
  const quote = (value: string | number) => {
    const plain = String(value ?? "");
    const spreadsheetSafe = /^[=+\-@\t\r]/.test(plain) ? `'${plain}` : plain;
    return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
  };
  const csv = `\uFEFF${columns.join(",")}\r\n${rows.map(row => row.map(quote).join(",")).join("\r\n")}`;
  downloadFile(`yomu-books-${todayIso()}.csv`, csv, "text/csv;charset=utf-8");
  showToast(`${books.length}件をCSVに書き出しました`);
}

function exportJson() {
  const backup = createBackup(books, settings);
  downloadFile(`yomu-backup-${todayIso()}.json`, JSON.stringify(backup, null, 2), "application/json");
  showToast("完全バックアップを書き出しました");
}

async function importJson(file: File) {
  try {
    const imported = parseBackup(JSON.parse(await file.text()) as unknown);
    books = imported.books;
    if (imported.settings) settings = imported.settings;
    persist();
    applyTheme(settings.theme);
    renderAll();
    showToast(`${books.length}件の読書記録を復元しました`);
    coverLookupAttempted.clear();
    coverLookupSessionAttempts = 0;
    scheduleCoverBackfill(300);
  } catch {
    showToast("バックアップ形式を確認できませんでした");
  }
}

async function importCsv(file: File) {
  const summary = $("#import-summary");
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error("CSVは10MB以下にしてください");
    const parsed = parseBooksCsv(await file.text());
    const merged = mergeImportedBooks(books, parsed.books);
    books = merged.books;
    persist();
    renderAll();

    const formatLabel = parsed.format === "biblia" ? "ビブリア形式" : "YOMU形式";
    summary.innerHTML = `<strong>${formatLabel}を取り込みました。</strong> 追加 ${merged.added}件・重複スキップ ${merged.duplicates}件・無効行 ${parsed.invalidRows}件`;
    summary.hidden = false;
    showToast(`${merged.added}件を追加し、重複${merged.duplicates}件をスキップしました`);
    coverLookupAttempted.clear();
    coverLookupSessionAttempts = 0;
    scheduleCoverBackfill(300);
  } catch (error) {
    const message = error instanceof Error ? error.message : "CSV形式を確認できませんでした";
    summary.innerHTML = `<strong>取り込みできませんでした。</strong> ${escapeHtml(message)}`;
    summary.hidden = false;
    showToast("CSV形式を確認できませんでした");
  }
}

function applyTheme(theme: ThemePreference) {
  settings.theme = theme;
  const resolved = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.body.dataset.theme = resolved;
  $$('[data-theme]').forEach(button => button.classList.toggle("is-active", button.dataset.theme === theme));
  persist();
}

function updateGoalUI() {
  $("#goal-value").textContent = `${settings.goal}冊`;
  const currentYear = String(new Date().getFullYear());
  const total = books.filter(book => book.status === "read" && book.finishedAt?.startsWith(currentYear)).length;
  $(".progress-track span").style.width = `${Math.min(total / settings.goal * 100, 100)}%`;
  $(".side-summary small").textContent = `年間目標 ${settings.goal}冊`;
  $<HTMLInputElement>("#synopsis-toggle").checked = settings.synopsis;
}

function initializeEvents() {
  document.addEventListener("error", event => {
    if (event.target instanceof HTMLImageElement && event.target.matches("[data-cover-image]")) handleCoverImageError(event.target);
  }, true);

  document.addEventListener("click", event => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const navButton = target.closest<HTMLElement>("[data-nav]");
    if (navButton?.dataset.nav) navigate(navButton.dataset.nav as ScreenName);

    const closeButton = target.closest<HTMLElement>("[data-close]");
    if (closeButton?.dataset.close) closeDialog(closeButton.dataset.close);

    const tab = target.closest<HTMLElement>(".shelf-tab");
    if (isBookStatus(tab?.dataset.filter)) setFilter(tab.dataset.filter);

    const viewButton = target.closest<HTMLElement>("[data-view]");
    if (viewButton) {
      activeView = viewButton.dataset.view === "list" ? "list" : "grid";
      $$('[data-view]').forEach(button => button.classList.toggle("is-active", button === viewButton));
      renderBooks();
    }

    const bookButton = target.closest<HTMLButtonElement>("button[data-book-id]");
    if (bookButton?.dataset.bookId) openBookDetail(bookButton.dataset.bookId);

    const addMode = target.closest<HTMLElement>("[data-add-mode]");
    if (addMode?.dataset.addMode) setAddMode(addMode.dataset.addMode as AddMode);

    const catalogButton = target.closest<HTMLElement>("[data-catalog-isbn]");
    if (catalogButton) {
      const book = visibleCatalogBooks.find(item => item.isbn === catalogButton.dataset.catalogIsbn);
      if (book) addCatalogBook(book, book.source === "openbd" ? "openBD" : "検索");
    }

    const manualResultButton = target.closest<HTMLElement>("[data-manual-result-index]");
    if (manualResultButton?.dataset.manualResultIndex) selectManualSearchBook(Number(manualResultButton.dataset.manualResultIndex));

    const ratingButton = target.closest<HTMLElement>(".rating-control [data-rating]");
    if (ratingButton) {
      const rating = Number(ratingButton.dataset.rating);
      const form = ratingButton.closest<HTMLFormElement>("#detail-form");
      if (!form) return;
      const nextRating = Number(form.dataset.rating || 0) === rating ? 0 : rating;
      form.dataset.rating = String(nextRating);
      $$(".rating-control [data-rating]", form).forEach(button => button.classList.toggle("is-active", Number(button.dataset.rating) <= nextRating));
    }

    const themeButton = target.closest<HTMLElement>("[data-theme]");
    if (isThemePreference(themeButton?.dataset.theme)) applyTheme(themeButton.dataset.theme);

    const detailAction = target.closest<HTMLButtonElement>("[data-detail-action]");
    if (detailAction) {
      const form = detailAction.closest<HTMLFormElement>("#detail-form");
      const bookId = form?.dataset.bookId;
      if (!form || !bookId) return;
      if (detailAction.dataset.detailAction === "refresh-cover") {
        void refreshBookCover(bookId, detailAction);
        return;
      }
      if (detailAction.dataset.detailAction === "save") saveBookDetail(form);
      if (detailAction.dataset.detailAction === "share") shareBook(bookId);
      if (detailAction.dataset.detailAction === "delete") deleteBook(bookId);
    }
  });

  $("#open-add").addEventListener("click", () => openAddDialog());
  $("#bottom-add").addEventListener("click", () => openAddDialog());
  $("#search-toggle").addEventListener("click", () => { $("#search-panel").hidden = false; $<HTMLInputElement>("#library-search").focus(); });
  $("#close-search").addEventListener("click", () => { query = ""; $<HTMLInputElement>("#library-search").value = ""; $("#search-panel").hidden = true; renderBooks(); });
  $<HTMLInputElement>("#library-search").addEventListener("input", event => { query = (event.currentTarget as HTMLInputElement).value; renderBooks(); });
  $("#sort-books").addEventListener("change", renderBooks);
  $<HTMLSelectElement>("#analytics-year").addEventListener("change", renderAnalytics);
  $<HTMLInputElement>("#catalog-search").addEventListener("input", event => scheduleCatalogSearch((event.currentTarget as HTMLInputElement).value));
  $("#start-barcode-scan").addEventListener("click", () => { void startBarcodeScanner(); });
  $("#stop-barcode-scan").addEventListener("click", stopBarcodeScanner);
  $("#manual-book-search").addEventListener("click", () => { void searchManualBooks($<HTMLInputElement>("#manual-book-query").value); });
  $<HTMLInputElement>("#manual-book-query").addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void searchManualBooks((event.currentTarget as HTMLInputElement).value);
  });
  $("#empty-add-isbn").addEventListener("click", () => openAddDialog("search"));
  $("#empty-add-manual").addEventListener("click", () => openAddDialog("manual"));
  $("#empty-clear-search").addEventListener("click", () => {
    query = "";
    $<HTMLInputElement>("#library-search").value = "";
    $("#search-panel").hidden = true;
    renderBooks();
  });

  const syncManualFinishedAt = () => {
    const status = $<HTMLSelectElement>('#manual-form [name="status"]').value;
    const finishedAt = $<HTMLInputElement>("#manual-finished-at");
    finishedAt.disabled = status !== "read";
    if (status === "read" && !finishedAt.value) finishedAt.value = todayIso();
  };
  $<HTMLSelectElement>('#manual-form [name="status"]').addEventListener("change", syncManualFinishedAt);
  syncManualFinishedAt();

  $<HTMLFormElement>("#manual-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const requestedStatus = String(data.get("status"));
    const status: BookStatus = isBookStatus(requestedStatus) ? requestedStatus : "read";
    const isbnInput = $<HTMLInputElement>('[name="isbn"]', form);
    const rawIsbn = String(data.get("isbn") || "").trim();
    isbnInput.setCustomValidity(rawIsbn && !isValidIsbn(rawIsbn) ? "ISBN-10またはISBN-13を確認してください" : "");
    if (!form.reportValidity()) return;
    const title = String(data.get("title") || "").trim();
    const author = String(data.get("author") || "").trim();
    const normalizedInputIsbn = rawIsbn ? normalizeIsbn(rawIsbn) : "";
    const selected = selectedManualCatalogBook;
    const selectedMatches = Boolean(selected && (
      (normalizedInputIsbn && selected.isbn && normalizedInputIsbn === normalizeIsbn(selected.isbn))
      || (title.toLocaleLowerCase("ja") === selected.title.toLocaleLowerCase("ja") && author.toLocaleLowerCase("ja") === selected.author.toLocaleLowerCase("ja"))
    ));
    const notes = String(data.get("notes") || "");
    const candidate = normalizeBook({
      id: crypto.randomUUID(),
      title,
      author,
      isbn: normalizedInputIsbn,
      genre: data.get("genre"),
      pages: data.get("pages"),
      publisher: data.get("publisher"),
      status,
      rating: data.get("rating"),
      finishedAt: status === "read" ? data.get("finishedAt") || todayIso() : "",
      createdAt: todayIso(),
      notes: notes || (selectedMatches && settings.synopsis ? selected?.synopsis || "" : ""),
      review: data.get("review"),
      cover: selectedMatches && selected ? selected.cover : books.length % 6,
      coverUrl: selectedMatches ? selected?.coverUrl || "" : "",
      coverSource: selectedMatches ? selected?.coverSource : undefined,
      source: selectedMatches ? "catalog" : "manual",
    });
    if (!candidate) return;
    if (hasDuplicateBook(books, candidate)) {
      showToast(`「${candidate.title}」はすでに本棚にあります`);
      return;
    }
    if (candidate.coverUrl) {
      candidate.coverLookupKey = coverLookupKey(candidate);
      candidate.coverCheckedAt = new Date().toISOString();
    }
    books.unshift(candidate);
    persist();
    renderAll();
    form.reset();
    selectedManualCatalogBook = null;
    visibleManualSearchBooks = [];
    $<HTMLInputElement>("#manual-book-query").value = "";
    $("#manual-search-source").textContent = "候補を選ぶと、下の入力欄へ書誌情報を反映します。";
    renderManualSearchResults([]);
    $<HTMLInputElement>("#manual-finished-at").value = todayIso();
    syncManualFinishedAt();
    closeDialog("add-dialog");
    showToast("新しい本を追加しました");
    queuePriorityCoverLookup(candidate.id);
  });

  $("#export-csv").addEventListener("click", exportCsv);
  $("#export-json").addEventListener("click", exportJson);
  $("#import-csv").addEventListener("click", () => $<HTMLInputElement>("#import-csv-file").click());
  $<HTMLInputElement>("#import-csv-file").addEventListener("change", event => {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.[0]) importCsv(input.files[0]);
    input.value = "";
  });
  $("#import-json").addEventListener("click", () => $<HTMLInputElement>("#import-file").click());
  $<HTMLInputElement>("#import-file").addEventListener("change", event => {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.[0]) importJson(input.files[0]);
    input.value = "";
  });
  $("#goal-minus").addEventListener("click", () => { settings.goal = Math.max(1, settings.goal - 1); persist(); updateGoalUI(); });
  $("#goal-plus").addEventListener("click", () => { settings.goal = Math.min(999, settings.goal + 1); persist(); updateGoalUI(); });
  $<HTMLInputElement>("#synopsis-toggle").addEventListener("change", event => { settings.synopsis = (event.currentTarget as HTMLInputElement).checked; persist(); showToast("設定を保存しました"); });
  $("#show-insight-books").addEventListener("click", event => {
    const genre = (event.currentTarget as HTMLElement).dataset.insightGenre || "";
    if (!genre) {
      openAddDialog("search");
      return;
    }
    navigate("shelf");
    setFilter("read");
    query = genre;
    $("#search-panel").hidden = false;
    $<HTMLInputElement>("#library-search").value = query;
    renderBooks();
  });

  $$<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener("click", event => {
    if (event.target === dialog) closeDialog(dialog.id);
  }));
  $<HTMLDialogElement>("#add-dialog").addEventListener("close", stopBarcodeScanner);
  window.addEventListener("online", () => {
    coverLookupSessionAttempts = 0;
    scheduleCoverBackfill(300);
  });
}

function initialize() {
  const now = new Date();
  const localToday = todayIso(now);
  $("#today-label").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now).toUpperCase();
  $<HTMLInputElement>("#manual-finished-at").value = localToday;
  applyTheme(settings.theme);
  initializeEvents();
  initializeInstallExperience();
  renderCatalogResults([], "ISBNを入力すると、openBDから書誌情報を取得します。");
  renderManualSearchResults([]);
  renderAll();
  setTimeout(iconize, 150);
  scheduleCoverBackfill(900);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", initialize);
