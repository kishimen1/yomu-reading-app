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
import { fetchOpenBdBook, isValidIsbn } from "./openbd";

type ShelfView = "grid" | "list";
type ScreenName = "shelf" | "analytics" | "settings";
type AddMode = "scan" | "search" | "manual";

declare global {
  interface Window {
    lucide?: {
      createIcons(options?: { attrs?: Record<string, string | number> }): void;
    };
  }
}

const COVER_POSITIONS = ["0% 0%", "50% 0%", "100% 0%", "0% 100%", "50% 100%", "100% 100%"]; 
const GENRE_COLORS = ["#256b54", "#e4513b", "#456a82", "#c3912f", "#7b657f", "#88908b"];

const seedBooks: Book[] = [
  { id: "b01", title: "灯りのない窓辺", author: "水原 澄", isbn: "9784000000001", genre: "文学・小説", pages: 288, status: "read", rating: 5, finishedAt: "2026-01-18", createdAt: "2026-01-18", notes: "静かな文章の間に、家族の時間が折り重なる。", review: "余白まで味わいたくなる作品だった。", cover: 0 },
  { id: "b02", title: "葉脈から読む世界", author: "朝倉 透", isbn: "9784000000002", genre: "自然科学", pages: 336, status: "read", rating: 5, finishedAt: "2026-02-09", createdAt: "2026-02-09", notes: "植物の形は環境への応答の蓄積。", review: "図版と説明のバランスがよく、再読したい。", cover: 1 },
  { id: "b03", title: "小さな組織の設計図", author: "高城 真", isbn: "9784000000003", genre: "ビジネス", pages: 254, status: "read", rating: 4, finishedAt: "2026-03-22", createdAt: "2026-03-22", notes: "意思決定の速度は権限の置き方で変わる。", review: "実務に持ち帰れる論点が多い。", cover: 2 },
  { id: "b04", title: "青の列島史", author: "相川 遼", isbn: "9784000000004", genre: "歴史", pages: 412, status: "read", rating: 4, finishedAt: "2026-04-06", createdAt: "2026-04-06", notes: "海上交通から列島のつながりを捉え直す。", review: "視点が新鮮。地図を見ながら読むと楽しい。", cover: 3 },
  { id: "b05", title: "他者を想像する", author: "柊木 直", isbn: "9784000000005", genre: "心理・思想", pages: 320, status: "read", rating: 4, finishedAt: "2026-04-27", createdAt: "2026-04-27", notes: "理解とは一致することではない。", review: "対話について考え直すきっかけになった。", cover: 4 },
  { id: "b06", title: "海岸線をゆく列車", author: "宮沢 碧", isbn: "9784000000006", genre: "紀行・エッセイ", pages: 224, status: "read", rating: 3, finishedAt: "2026-05-15", createdAt: "2026-05-15", notes: "土地の記憶を車窓の速度でたどる。", review: "短い章ごとに旅の温度が変わる。", cover: 5 },
  { id: "b07", title: "夜の標本室", author: "水原 澄", isbn: "9784000000007", genre: "文学・小説", pages: 301, status: "read", rating: 5, finishedAt: "2026-06-03", createdAt: "2026-06-03", notes: "記憶を保存することと忘れること。", review: "今年いちばん印象に残った小説。", cover: 0 },
  { id: "b08", title: "森のネットワーク", author: "芦田 葵", isbn: "9784000000008", genre: "自然科学", pages: 376, status: "read", rating: 5, finishedAt: "2026-06-20", createdAt: "2026-06-20", notes: "菌根菌を介した資源交換の仕組み。", review: "複雑な生態系を丁寧にほどいている。", cover: 1 },
  { id: "b09", title: "余白の経営", author: "三崎 修", isbn: "9784000000009", genre: "ビジネス", pages: 272, status: "read", rating: 3, finishedAt: "2026-07-07", createdAt: "2026-07-07", notes: "計画に余白を組み込む。", review: "後半の事例が特に参考になった。", cover: 2 },
  { id: "b10", title: "水路と都市の記憶", author: "相川 遼", isbn: "9784000000010", genre: "歴史", pages: 348, status: "read", rating: 4, finishedAt: "2026-08-02", createdAt: "2026-08-02", notes: "都市の骨格は見えない水路に残る。", review: "身近な街の見え方が変わった。", cover: 3 },
  { id: "b11", title: "静かな対話の技術", author: "柊木 直", isbn: "9784000000011", genre: "心理・思想", pages: 264, status: "read", rating: 4, finishedAt: "2026-08-14", createdAt: "2026-08-14", notes: "問いを急いで閉じない。", review: "会議や面談でも応用できそう。", cover: 4 },
  { id: "b12", title: "島々の朝食", author: "宮沢 碧", isbn: "9784000000012", genre: "紀行・エッセイ", pages: 246, status: "read", rating: 4, finishedAt: "2026-08-26", createdAt: "2026-08-26", notes: "食卓から気候と産業が見えてくる。", review: "旅に出たくなる、軽やかな読後感。", cover: 5 },
  { id: "b13", title: "透明な時間", author: "遠野 翠", isbn: "9784000000013", genre: "文学・小説", pages: 390, status: "reading", rating: 0, finishedAt: "", createdAt: "2026-08-21", notes: "p.84 時間の感覚について", review: "", cover: 0 },
  { id: "b14", title: "都市の昆虫地図", author: "芦田 葵", isbn: "9784000000014", genre: "自然科学", pages: 298, status: "reading", rating: 0, finishedAt: "", createdAt: "2026-08-24", notes: "", review: "", cover: 1 },
  { id: "b15", title: "文化をつくる会議", author: "高城 真", isbn: "9784000000015", genre: "ビジネス", pages: 230, status: "wishlist", rating: 0, finishedAt: "", createdAt: "2026-07-02", notes: "", review: "", cover: 2 },
  { id: "b16", title: "近代港湾の歩き方", author: "相川 遼", isbn: "9784000000016", genre: "歴史", pages: 310, status: "wishlist", rating: 0, finishedAt: "", createdAt: "2026-07-18", notes: "", review: "", cover: 3 },
  { id: "b17", title: "選択の心理学", author: "柊木 直", isbn: "9784000000017", genre: "心理・思想", pages: 286, status: "wishlist", rating: 0, finishedAt: "", createdAt: "2026-08-05", notes: "", review: "", cover: 4 },
  { id: "b18", title: "北緯35度の旅", author: "宮沢 碧", isbn: "9784000000018", genre: "紀行・エッセイ", pages: 208, status: "wishlist", rating: 0, finishedAt: "", createdAt: "2026-08-19", notes: "", review: "", cover: 5 }
];

const catalogBooks: CatalogBook[] = [
  { title: "風を集める図書館", author: "遠野 翠", isbn: "9784100000201", genre: "文学・小説", pages: 312, cover: 0, source: "catalog" },
  { title: "土と微生物の教科書", author: "芦田 葵", isbn: "9784100000202", genre: "自然科学", pages: 344, cover: 1, source: "catalog" },
  { title: "問いから始める戦略", author: "三崎 修", isbn: "9784100000203", genre: "ビジネス", pages: 268, cover: 2, source: "catalog" }
];

let visibleCatalogBooks = catalogBooks;
let books = loadBooks(seedBooks);
let settings = loadSettings();
let activeFilter: BookStatus = "read";
let activeView: ShelfView = "grid";
let query = "";
let cameraStream: MediaStream | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let catalogSearchTimer: ReturnType<typeof setTimeout> | null = null;
let catalogRequest: AbortController | null = null;

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
      <button class="book-cover" type="button" data-book-id="${escapeHtml(book.id)}" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}" aria-label="${escapeHtml(book.title)}の詳細を開く">
        ${book.coverUrl ? `<img src="${escapeHtml(book.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
        <span class="cover-copy"><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}</small></span>
      </button>
      <div class="book-meta">
        <div><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.author)}</p><span class="status-badge">${statusLabel(book.status)}</span></div>
        <div class="book-meta-footer"><span>${book.status === "read" ? formatDate(book.finishedAt) : escapeHtml(book.genre)}</span><span class="rating">${book.rating ? `★ ${book.rating}.0` : "未評価"}</span></div>
      </div>
    </article>`).join("");

  $("#empty-state").hidden = filtered.length > 0;
  grid.hidden = filtered.length === 0;
  $("#read-count").textContent = String(books.filter(book => book.status === "read").length);
  $("#reading-count").textContent = String(books.filter(book => book.status === "reading").length);
  $("#wishlist-count").textContent = String(books.filter(book => book.status === "wishlist").length);
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
  $("#pace-copy").textContent = current === previous
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
  $("#genre-legend").innerHTML = genres.map(([genre, count], index) => `
    <div class="legend-row"><i style="background:${GENRE_COLORS[index % GENRE_COLORS.length]}"></i><span>${escapeHtml(genre)}</span><strong>${Math.round(count / readBooks.length * 100)}%</strong></div>`).join("");

  const maxMonth = Math.max(...monthly, 1);
  $("#month-chart").setAttribute("aria-label", `${selectedYear ?? "全期間"}の月別読了冊数`);
  $("#month-chart").innerHTML = monthly.map((count, index) => `
    <div class="month-bar ${selectedYear === currentYear && index === currentMonth - 1 ? "current" : ""}"><strong>${count || ""}</strong><i style="--height:${Math.max(count / maxMonth * 82, count ? 20 : 3)}%"></i><span>${index + 1}月</span></div>`).join("");

  const ratingCounts = [5, 4, 3, 2, 1].map(rating => ({ rating, count: rated.filter(book => book.rating === rating).length }));
  const maxRating = Math.max(...ratingCounts.map(item => item.count), 1);
  $("#rating-bars").innerHTML = ratingCounts.map(item => `
    <div class="rating-row"><strong>${item.rating}.0</strong><div class="rating-track"><i style="width:${item.count / maxRating * 100}%"></i></div><span>${item.count}</span></div>`).join("");
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

function openAddDialog(mode: AddMode = "scan") {
  setAddMode(mode);
  $<HTMLDialogElement>("#add-dialog").showModal();
}

function closeDialog(id: string) {
  const dialog = document.getElementById(id) as HTMLDialogElement | null;
  if (dialog?.open) dialog.close();
  if (id === "add-dialog") stopCamera();
}

function setAddMode(mode: AddMode) {
  $$('[data-add-mode]').forEach(button => button.classList.toggle("is-active", button.dataset.addMode === mode));
  $$('[data-add-view]').forEach(view => view.classList.toggle("is-active", view.dataset.addView === mode));
  if (mode === "search") renderCatalog("");
}

function renderCatalog(searchTerm: string) {
  const term = searchTerm.trim().toLocaleLowerCase("ja");
  visibleCatalogBooks = catalogBooks.filter(book => `${book.title} ${book.author} ${book.isbn}`.toLocaleLowerCase("ja").includes(term));
  renderCatalogResults(visibleCatalogBooks);
}

function renderCatalogResults(results: CatalogBook[]) {
  $("#catalog-results").innerHTML = results.map(book => `
    <article class="catalog-result">
      <div class="result-cover" style="--cover-position:${COVER_POSITIONS[book.cover]}">${book.coverUrl ? `<img src="${escapeHtml(book.coverUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</div>
      <span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}${book.publisher ? ` · ${escapeHtml(book.publisher)}` : ""}<br>ISBN ${escapeHtml(book.isbn)}</small></span>
      <button type="button" data-catalog-isbn="${book.isbn}" aria-label="${escapeHtml(book.title)}を追加"><i data-lucide="plus"></i></button>
    </article>`).join("") || `<p class="empty-state">候補が見つかりませんでした。</p>`;
  iconize();
}

async function searchCatalog(searchTerm: string) {
  const term = searchTerm.trim();
  catalogRequest?.abort();
  catalogRequest = null;

  if (!isValidIsbn(term)) {
    renderCatalog(term);
    $("#catalog-source").textContent = term
      ? "書名・著者は端末内のデモ候補を検索しています。実書誌はISBNで検索できます。"
      : "ISBN-10／ISBN-13はopenBD、書名・著者は端末内のデモ候補を検索します。";
    return;
  }

  const request = new AbortController();
  catalogRequest = request;
  $("#catalog-source").textContent = "openBDから書誌情報を取得しています…";
  $("#catalog-results").innerHTML = `<p class="empty-state">書誌情報を検索中です。</p>`;

  try {
    const result = await fetchOpenBdBook(term, request.signal);
    if (request.signal.aborted) return;
    visibleCatalogBooks = [result];
    renderCatalogResults(visibleCatalogBooks);
    $("#catalog-source").textContent = "openBDの書誌情報です。書影や収録項目がない書籍もあります。";
  } catch (error) {
    if (request.signal.aborted) return;
    visibleCatalogBooks = [];
    renderCatalogResults([]);
    $("#catalog-source").textContent = error instanceof Error ? error.message : "openBDの書誌情報を取得できませんでした。";
  } finally {
    if (catalogRequest === request) catalogRequest = null;
  }
}

function scheduleCatalogSearch(searchTerm: string) {
  if (catalogSearchTimer !== null) clearTimeout(catalogSearchTimer);
  catalogSearchTimer = setTimeout(() => searchCatalog(searchTerm), 350);
}

function addCatalogBook(catalogBook: CatalogBook, source = "検索") {
  const now = todayIso();
  const candidate: Book = { ...catalogBook, id: crypto.randomUUID(), status: "wishlist", rating: 0, finishedAt: "", createdAt: now, notes: settings.synopsis ? catalogBook.synopsis || (catalogBook.source === "catalog" ? "書誌情報から取得したあらすじ（モック）" : "") : "", review: "" };
  if (hasDuplicateBook(books, candidate)) {
    showToast(`「${catalogBook.title}」はすでに本棚にあります`);
    return;
  }
  books.unshift(candidate);
  persist();
  renderAll();
  showToast(`${source}から「${catalogBook.title}」を読みたい本に追加しました`);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast("このブラウザーではカメラを利用できません");
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    const video = $<HTMLVideoElement>("#camera-preview");
    video.srcObject = cameraStream;
    video.hidden = false;
    await video.play();
    showToast("カメラを起動しました。モックではサンプル読取で登録を試せます");
  } catch {
    showToast("カメラ権限がありません。サンプル読取は利用できます");
  }
}

function stopCamera() {
  cameraStream?.getTracks().forEach(track => track.stop());
  cameraStream = null;
  const video = $<HTMLVideoElement>("#camera-preview");
  video.srcObject = null;
  video.hidden = true;
}

function showScanResult() {
  const book = catalogBooks[1];
  const result = $("#scan-result");
  result.hidden = false;
  result.innerHTML = `<div class="result-cover" style="--cover-position:${COVER_POSITIONS[book.cover]}"></div><span><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)} · ${book.isbn}</small></span><button type="button" id="add-scan-result" aria-label="読み取った本を追加"><i data-lucide="plus"></i></button>`;
  iconize();
}

function openBookDetail(id: string) {
  const book = books.find(item => item.id === id);
  if (!book) return;
  $("#detail-content").innerHTML = `
    <form class="detail-layout" id="detail-form" data-book-id="${escapeHtml(book.id)}">
      <div class="detail-cover-panel"><div class="detail-cover" style="--cover-position:${COVER_POSITIONS[book.cover % 6]}">${book.coverUrl ? `<img src="${escapeHtml(book.coverUrl)}" alt="" referrerpolicy="no-referrer">` : ""}</div></div>
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
  if (!form.reportValidity()) return;
  const book = books.find(item => item.id === form.dataset.bookId);
  if (!book) return;
  const formData = new FormData(form);
  book.title = String(formData.get("title") || "").trim();
  book.author = String(formData.get("author") || "").trim();
  const status = String(formData.get("status"));
  book.status = isBookStatus(status) ? status : "read";
  book.finishedAt = String(formData.get("finishedAt") || "");
  book.notes = String(formData.get("notes") || "");
  book.review = String(formData.get("review") || "");
  if (book.status === "read" && !book.finishedAt) book.finishedAt = todayIso();
  persist();
  renderAll();
  closeDialog("detail-dialog");
  showToast("読書記録を更新しました");
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

    const bookButton = target.closest<HTMLElement>("[data-book-id]");
    if (bookButton?.dataset.bookId) openBookDetail(bookButton.dataset.bookId);

    const addMode = target.closest<HTMLElement>("[data-add-mode]");
    if (addMode?.dataset.addMode) setAddMode(addMode.dataset.addMode as AddMode);

    const catalogButton = target.closest<HTMLElement>("[data-catalog-isbn]");
    if (catalogButton) {
      const book = visibleCatalogBooks.find(item => item.isbn === catalogButton.dataset.catalogIsbn);
      if (book) addCatalogBook(book, book.source === "openbd" ? "openBD" : "検索");
    }

    const ratingButton = target.closest<HTMLElement>("[data-rating]");
    if (ratingButton) {
      const rating = Number(ratingButton.dataset.rating);
      const book = books.find(item => item.id === $("#detail-form").dataset.bookId);
      if (book) book.rating = book.rating === rating ? 0 : rating;
      $$("[data-rating]").forEach(button => button.classList.toggle("is-active", Number(button.dataset.rating) <= (book?.rating || 0)));
    }

    const themeButton = target.closest<HTMLElement>("[data-theme]");
    if (isThemePreference(themeButton?.dataset.theme)) applyTheme(themeButton.dataset.theme);

    const detailAction = target.closest<HTMLButtonElement>("[data-detail-action]");
    if (detailAction) {
      const form = detailAction.closest<HTMLFormElement>("#detail-form");
      const bookId = form?.dataset.bookId;
      if (!form || !bookId) return;
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
  $("#start-camera").addEventListener("click", startCamera);
  $("#demo-scan").addEventListener("click", showScanResult);
  $("#scan-result").addEventListener("click", event => {
    if (event.target instanceof Element && event.target.closest("#add-scan-result")) addCatalogBook(catalogBooks[1], "バーコード");
  });

  $<HTMLFormElement>("#manual-form").addEventListener("submit", event => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const requestedStatus = String(data.get("status"));
    const status: BookStatus = isBookStatus(requestedStatus) ? requestedStatus : "read";
    const candidate = normalizeBook({ id: crypto.randomUUID(), title: data.get("title"), author: data.get("author"), isbn: "", genre: data.get("genre"), pages: data.get("pages"), status, rating: data.get("rating"), finishedAt: status === "read" ? data.get("finishedAt") : "", createdAt: todayIso(), notes: "", review: "", cover: books.length % 6 });
    if (!candidate) return;
    if (hasDuplicateBook(books, candidate)) {
      showToast(`「${candidate.title}」はすでに本棚にあります`);
      return;
    }
    books.unshift(candidate);
    persist();
    renderAll();
    form.reset();
    closeDialog("add-dialog");
    showToast("新しい本を追加しました");
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
  $("#show-science-books").addEventListener("click", () => { navigate("shelf"); setFilter("read"); query = "自然科学"; $("#search-panel").hidden = false; $<HTMLInputElement>("#library-search").value = query; renderBooks(); });

  $$<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener("click", event => {
    if (event.target === dialog) closeDialog(dialog.id);
  }));
  $<HTMLDialogElement>("#add-dialog").addEventListener("close", stopCamera);
}

function initialize() {
  const now = new Date();
  const localToday = todayIso(now);
  $("#today-label").textContent = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now).toUpperCase();
  $<HTMLInputElement>("#manual-finished-at").value = localToday;
  applyTheme(settings.theme);
  initializeEvents();
  renderCatalog("");
  renderAll();
  setTimeout(iconize, 150);
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.addEventListener("DOMContentLoaded", initialize);
