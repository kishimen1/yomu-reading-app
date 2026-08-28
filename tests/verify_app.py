from contextlib import contextmanager
import csv
import io
import json
from pathlib import Path
import subprocess
from time import sleep
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
BASE_URL = "http://127.0.0.1:4173"


@contextmanager
def preview_server():
    process = subprocess.Popen(
        ["npm.cmd", "run", "preview", "--", "--host", "127.0.0.1", "--port", "4173", "--strictPort"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.STDOUT,
    )
    try:
        for _ in range(80):
            if process.poll() is not None:
                raise RuntimeError("Vite preview server stopped before becoming ready")
            try:
                with urlopen(BASE_URL, timeout=1) as response:
                    if response.status == 200:
                        break
            except Exception:
                sleep(0.25)
        else:
            raise RuntimeError("Timed out waiting for the Vite preview server")
        yield
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)


def run() -> None:
    ARTIFACTS.mkdir(exist_ok=True)
    errors = []
    with preview_server(), sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        )
        context = browser.new_context(
            viewport={"width": 360, "height": 800},
            accept_downloads=True,
            service_workers="block",
        )
        page = context.new_page()
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(str(error)))

        for attempt in range(3):
            try:
                page.goto(BASE_URL, wait_until="networkidle")
                break
            except Exception:
                if attempt == 2:
                    raise
                sleep(0.5)
        page.locator("#shelf-title").wait_for()
        assert page.locator("#book-grid .book-card").count() == 12
        assert page.locator("#read-count").inner_text() == "12"
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.wait_for_timeout(450)
        page.screenshot(path=str(ARTIFACTS / "mobile-shelf.png"), full_page=True)

        page.get_by_role("tab", name="読書中 2").click()
        assert page.locator("#book-grid .book-card").count() == 2

        page.locator("#bottom-add").click()
        page.get_by_role("tab", name="手入力").click()
        page.locator("#manual-form [name=title]").fill("境界を歩く")
        page.locator("#manual-form [name=author]").fill("佐伯 凛")
        page.locator("#manual-form [name=pages]").fill("180")
        page.locator("#manual-form [name=rating]").select_option("5")
        page.locator("#manual-form button[type=submit]").click()
        page.get_by_role("tab", name="読んだ 13").click()
        assert page.locator("#book-grid .book-card").count() == 13

        page.get_by_role("button", name="境界を歩くの詳細を開く").click()
        page.locator("#detail-form textarea[name=notes]").fill("検証用の読書メモ")
        assert page.locator("#detail-form").evaluate("form => form.checkValidity()")
        page.locator("#save-book").click()
        page.locator("#detail-dialog").wait_for(state="hidden")

        openbd_isbn = "9784873113364"
        page.route(
            f"https://api.openbd.jp/v1/get?isbn={openbd_isbn}",
            lambda route: route.fulfill(
                status=200,
                content_type="application/json",
                body=json.dumps([{
                    "summary": {
                        "title": "型で育てる読書記録",
                        "author": "OpenBD 著者",
                        "publisher": "検証出版社",
                        "isbn": openbd_isbn,
                        "cover": "",
                    },
                    "onix": {
                        "DescriptiveDetail": {"Extent": {"ExtentValue": "256"}},
                        "CollateralDetail": {"TextContent": {"Text": {"content": "検証用の内容紹介"}}},
                    },
                }], ensure_ascii=False),
            ),
        )
        page.locator("#bottom-add").click()
        page.get_by_role("tab", name="検索").click()
        page.locator("#catalog-search").fill(openbd_isbn)
        page.get_by_role("button", name="型で育てる読書記録を追加").wait_for()
        page.get_by_role("button", name="型で育てる読書記録を追加").click()
        page.get_by_role("button", name="型で育てる読書記録を追加").click()
        assert "すでに本棚にあります" in page.locator("#toast").inner_text()
        page.locator("#add-dialog [data-close=add-dialog]").click()
        page.get_by_role("tab", name="読みたい 5").click()
        assert page.locator("#book-grid .book-card").count() == 5
        page.get_by_role("tab", name="読んだ 13").click()

        page.locator(".bottom-nav [data-nav=analytics]").click()
        assert page.locator("#analytics-total").inner_text() == "13"
        assert page.locator("#genre-legend .legend-row").count() >= 6
        assert page.evaluate("[...document.querySelectorAll('dialog')].every(dialog => !dialog.open)")
        page.wait_for_function("!document.querySelector('#toast').classList.contains('is-visible')")
        page.wait_for_timeout(450)
        page.screenshot(path=str(ARTIFACTS / "mobile-analytics.png"), full_page=True)

        page.locator(".bottom-nav [data-nav=settings]").click()
        assert page.locator("#install-app").is_visible()
        assert "ホーム画面" in page.locator("#install-status").inner_text()
        page.locator("#install-app").click()
        assert "ホーム画面に追加" in page.locator("#toast").inner_text()
        page.wait_for_timeout(150)
        page.screenshot(path=str(ARTIFACTS / "mobile-settings-install.png"), full_page=True)
        csv_buffer = io.StringIO(newline="")
        csv_writer = csv.writer(csv_buffer)
        csv_writer.writerow(["灯りのない窓辺", "", "水原 澄", "", "架空出版社", "9784000000001", "2026/01/18", "重複", "", "", "", "2026/01/18", "0", "5"])
        csv_writer.writerow(["CSVから来た本", "", "取込 著者", "", "架空出版社", "9784999999999", "2026/08/27", "取込メモ", "感想の一行目\n二行目", "", "", "2026/08/28", "0", "4"])
        csv_writer.writerow(["列不足"])
        page.locator("#import-csv-file").set_input_files({
            "name": "biblia-books.csv",
            "mimeType": "text/csv",
            "buffer": csv_buffer.getvalue().encode("utf-8"),
        })
        page.locator("#import-summary").wait_for(state="visible")
        assert "ビブリア形式" in page.locator("#import-summary").inner_text()
        assert "追加 1件" in page.locator("#import-summary").inner_text()
        assert "重複スキップ 1件" in page.locator("#import-summary").inner_text()
        assert "無効行 1件" in page.locator("#import-summary").inner_text()

        with page.expect_download() as csv_download:
            page.locator("#export-csv").click()
        export_path = ARTIFACTS / "test-export.csv"
        csv_download.value.save_as(str(export_path))
        page.locator("#import-csv-file").set_input_files(str(export_path))
        page.wait_for_function("document.querySelector('#import-summary').textContent.includes('重複スキップ 21件')")
        assert "YOMU形式" in page.locator("#import-summary").inner_text()
        assert "追加 0件" in page.locator("#import-summary").inner_text()
        with page.expect_download() as json_download:
            page.locator("#export-json").click()
        backup_path = ARTIFACTS / "test-backup.json"
        json_download.value.save_as(str(backup_path))
        backup_data = json.loads(backup_path.read_text(encoding="utf-8"))
        assert backup_data["schemaVersion"] == 2
        assert len(backup_data["books"]) == 21

        page.set_viewport_size({"width": 1440, "height": 1000})
        page.locator(".side-nav [data-nav=analytics]").click()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.wait_for_function("!document.querySelector('#toast').classList.contains('is-visible')")
        page.wait_for_timeout(450)
        page.screenshot(path=str(ARTIFACTS / "desktop-analytics.png"), full_page=True)

        page.set_viewport_size({"width": 768, "height": 1024})
        page.locator(".side-nav [data-nav=shelf]").click()
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
        page.wait_for_timeout(450)
        page.screenshot(path=str(ARTIFACTS / "tablet-shelf.png"), full_page=True)

        manifest = page.request.get(f"{BASE_URL}/manifest.json")
        assert manifest.ok
        manifest_data = manifest.json()
        assert manifest_data["display"] == "standalone"
        assert manifest_data["id"] == "./"
        assert {icon["sizes"] for icon in manifest_data["icons"]} == {"192x192", "512x512"}
        assert page.evaluate(
            """async () => {
                const dimensions = await Promise.all([
                    ['assets/app-icon-192.png', 192],
                    ['assets/app-icon-512.png', 512],
                ].map(([src, expected]) => new Promise((resolve, reject) => {
                    const image = new Image();
                    image.onload = () => resolve(image.naturalWidth === expected && image.naturalHeight === expected);
                    image.onerror = reject;
                    image.src = src;
                })));
                return dimensions.every(Boolean);
            }"""
        )
        assert not errors, f"Browser errors: {errors}"
        context.close()

        migration_context = browser.new_context(
            viewport={"width": 360, "height": 800},
            service_workers="block",
        )
        migration_page = migration_context.new_page()
        migration_page.add_init_script(
            """(() => {
                localStorage.setItem('yomu-reading-archive:v1', JSON.stringify([{
                    id: 'legacy-1', title: '旧形式の本', author: '移行テスト', isbn: '978-4-00-000000-0',
                    genre: 'テスト', pages: -20, status: 'read', rating: 9,
                    finished_at: '2025-12-31', created_at: '2025-01-01', notes: '', review: '', cover: 12
                }]));
                localStorage.setItem('yomu-settings:v1', JSON.stringify({theme: 'dark', goal: 1200, synopsis: false}));
            })()"""
        )
        migration_page.goto(BASE_URL, wait_until="networkidle")
        migrated_count = migration_page.locator("#book-grid .book-card").count()
        assert migrated_count == 1, migration_page.evaluate(
            "({legacy: localStorage.getItem('yomu-reading-archive:v1'), current: localStorage.getItem('yomu-reading-archive:v2')})"
        )
        migrated_library = migration_page.evaluate("JSON.parse(localStorage.getItem('yomu-reading-archive:v2'))")
        migrated_settings = migration_page.evaluate("JSON.parse(localStorage.getItem('yomu-settings:v2'))")
        assert migrated_library["schemaVersion"] == 2
        assert migrated_library["books"][0]["rating"] == 5
        assert migrated_library["books"][0]["pages"] == 0
        assert migrated_library["books"][0]["cover"] == 5
        assert migrated_settings == {"theme": "dark", "goal": 999, "synopsis": False}
        assert migration_page.evaluate("localStorage.getItem('yomu-reading-archive:v1') !== null")
        migration_context.close()

        pwa_context = browser.new_context(viewport={"width": 360, "height": 800})
        pwa_page = pwa_context.new_page()
        pwa_page.goto(BASE_URL, wait_until="networkidle")
        pwa_page.evaluate("navigator.serviceWorker.ready")
        pwa_page.wait_for_function("navigator.serviceWorker.controller !== null")
        pwa_context.set_offline(True)
        pwa_page.reload(wait_until="domcontentloaded")
        assert pwa_page.locator("#shelf-title").inner_text() == "わたしの本棚"
        pwa_context.close()
        browser.close()

    print("PASS: shelf, add/edit, analytics, exports, offline PWA, and 360/768/1440 layouts")


if __name__ == "__main__":
    run()
