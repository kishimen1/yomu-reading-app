from pathlib import Path
from time import sleep
from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts"
BASE_URL = "http://127.0.0.1:8056"


def run() -> None:
    errors = []
    with sync_playwright() as playwright:
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

        page.locator(".bottom-nav [data-nav=analytics]").click()
        assert page.locator("#analytics-total").inner_text() == "13"
        assert page.locator("#genre-legend .legend-row").count() >= 6
        assert page.evaluate("[...document.querySelectorAll('dialog')].every(dialog => !dialog.open)")
        page.wait_for_function("!document.querySelector('#toast').classList.contains('is-visible')")
        page.wait_for_timeout(450)
        page.screenshot(path=str(ARTIFACTS / "mobile-analytics.png"), full_page=True)

        page.locator(".bottom-nav [data-nav=settings]").click()
        with page.expect_download() as csv_download:
            page.locator("#export-csv").click()
        csv_download.value.save_as(str(ARTIFACTS / "test-export.csv"))
        with page.expect_download() as json_download:
            page.locator("#export-json").click()
        json_download.value.save_as(str(ARTIFACTS / "test-backup.json"))

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
        assert manifest.json()["display"] == "standalone"
        assert not errors, f"Browser errors: {errors}"
        context.close()

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
