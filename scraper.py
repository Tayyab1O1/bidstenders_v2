import asyncio
import json
import os
import pandas as pd
from playwright.async_api import async_playwright
import datetime
import re
import gspread
from oauth2client.service_account import ServiceAccountCredentials

try:
    import firebase_admin
    from firebase_admin import credentials as fb_creds, firestore as fb_firestore
    FIREBASE_AVAILABLE = True
except ImportError:
    FIREBASE_AVAILABLE = False

URL = "https://bidsandtenders.com/bid-opportunities/"
LOG_FILE = "scraper_log.txt"

CONCURRENCY = 8
MAX_PAGES = 100

COLUMNS = [
    "Title", "Bid Number (List)", "Bid Name (List)", "Status (List)",
    "Posted Date", "Closing Date (List)", "Bid Classification", "Bid Type",
    "Bid Number", "Bid Name", "Bid Status", "Bid Closing Date (Detail)",
    "Submission Type", "Submission Address", "Public Opening",
    "Description", "Categories"
]


# ---------------- LOGGING ----------------
def log(message):
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    msg = f"[{timestamp}] {message}"
    print(msg)
    with open(LOG_FILE, "a") as f:
        f.write(msg + "\n")


# ---------------- CLEAN TEXT ----------------
def clean_text(text):
    if not text:
        return ""
    return re.sub(r'[\x00-\x1F\x7F]', '', text)


# ---------------- FIRESTORE ----------------
FIREBASE_SERVICE_ACCOUNT = "firebase-service-account.json"

def connect_firestore():
    if not FIREBASE_AVAILABLE:
        log("⚠️  firebase-admin not installed — skipping Firestore upload")
        return None
    if not os.path.exists(FIREBASE_SERVICE_ACCOUNT):
        log(f"⚠️  {FIREBASE_SERVICE_ACCOUNT} not found — skipping Firestore upload")
        return None
    if not firebase_admin._apps:
        cred = fb_creds.Certificate(FIREBASE_SERVICE_ACCOUNT)
        firebase_admin.initialize_app(cred)
    return fb_firestore.client()


def upload_to_firestore(db_client, df):
    if db_client is None:
        return
    col = db_client.collection("bids")
    added = 0
    for _, row in df.iterrows():
        bid_number = str(row.get("Bid Number", "")).strip()
        if not bid_number:
            continue
        ref = col.document(bid_number)
        if ref.get().exists:
            continue
        now = datetime.datetime.now(datetime.timezone.utc).isoformat()
        ref.set({
            "title":           str(row.get("Title", "")),
            "bidNumberList":   str(row.get("Bid Number (List)", "")),
            "bidNameList":     str(row.get("Bid Name (List)", "")),
            "statusList":      str(row.get("Status (List)", "")),
            "postedDate":      str(row.get("Posted Date", "")),
            "closingDateList": str(row.get("Closing Date (List)", "")),
            "bidClassification": str(row.get("Bid Classification", "")),
            "bidType":         str(row.get("Bid Type", "")),
            "bidNumber":       bid_number,
            "bidName":         str(row.get("Bid Name", "")),
            "bidStatus":       str(row.get("Bid Status", "")),
            "bidClosingDate":  str(row.get("Bid Closing Date (Detail)", "")),
            "submissionType":  str(row.get("Submission Type", "")),
            "submissionAddress": str(row.get("Submission Address", "")),
            "publicOpening":   str(row.get("Public Opening", "")),
            "description":     str(row.get("Description", "")),
            "categories":      str(row.get("Categories", "")),
            "reviewStatus":    "pending",
            "aiScore":         None,
            "aiScoreReason":   None,
            "aiScoreHighlights": None,
            "aiScoreConcerns": None,
            "aiScoredAt":      None,
            "createdAt":       now,
            "updatedAt":       now,
        })
        added += 1
    log(f"✅ Added {added} new bids to Firestore")


# ---------------- GOOGLE SHEETS ----------------
def connect_gsheet():
    scope = [
        "https://spreadsheets.google.com/feeds",
        "https://www.googleapis.com/auth/drive"
    ]
    creds = ServiceAccountCredentials.from_json_keyfile_name(
        "credentials.json", scope
    )
    client = gspread.authorize(creds)
    sheet = client.open_by_key("1E91ZyuPWuUQYXdWrVMwlofGM8eLlNYCeBfrJj439mBE").worksheet("bidsandtenders")
    return sheet


def upload_to_gsheet(sheet, df):
    existing_values = sheet.get_all_values()

    if not existing_values or existing_values[0] != COLUMNS:
        # Sheet is empty or has wrong/old headers — write correct headers in row 1
        sheet.clear()
        sheet.append_row(COLUMNS)
        existing_ids = set()
        log("ℹ️ Sheet headers reset to correct column order")
    else:
        try:
            bid_col = COLUMNS.index("Bid Number")
            existing_ids = set(
                row[bid_col] for row in existing_values[1:]
                if len(row) > bid_col and row[bid_col]
            )
        except ValueError:
            existing_ids = set()

    new_rows = []
    for _, row in df.iterrows():
        bid_id = str(row.get("Bid Number", ""))
        if bid_id and bid_id not in existing_ids:
            aligned = [str(row.get(h, "")) for h in COLUMNS]
            new_rows.append(aligned)

    if new_rows:
        sheet.append_rows(new_rows)
        log(f"✅ Added {len(new_rows)} rows to Google Sheets")
    else:
        log("No new bids found")


# ---------------- DETAIL SCRAPER ----------------
async def extract_detail(context, link, base_data):
    try:
        page = await context.new_page()

        for attempt in range(2):
            try:
                await page.goto(link, timeout=60000)
                break
            except:
                if attempt == 1:
                    raise
                log(f"Retrying: {link}")

        await page.wait_for_selector("table[aria-label='Bid Details']", timeout=10000)

        details = {}
        description_text = ""

        rows = await page.locator("table[aria-label='Bid Details'] tr").all()

        for row in rows:
            try:
                ths = await row.locator("th").all()
                tds = await row.locator("td").all()

                if len(ths) == 1 and len(tds) == 1:
                    key = (await ths[0].inner_text()).strip().replace(":", "")
                    val = (await tds[0].inner_text()).strip()
                    details[key] = val

                elif len(ths) == 1 and "Description" in (await ths[0].inner_text()):
                    description_text = await row.locator("td").inner_text()

                elif len(tds) > 1:
                    combined = " ".join([await td.inner_text() for td in tds])
                    if "Description" in combined and not description_text:
                        description_text = combined

            except:
                continue

        categories = ""
        try:
            await page.evaluate("""
                const el = document.querySelector('#divCat');
                if (el) el.style.display = 'block';
            """)
            if await page.locator("#divCat").count() > 0:
                categories = await page.locator("#divCat").inner_text()
        except:
            pass

        await page.close()

        return {
            **base_data,
            "Bid Classification": clean_text(details.get("Bid Classification", "")),
            "Bid Type": clean_text(details.get("Bid Type", "")),
            "Bid Number": clean_text(details.get("Bid Number", "")),
            "Bid Name": clean_text(details.get("Bid Name", "")),
            "Bid Status": clean_text(details.get("Bid Status", "")),
            "Bid Closing Date (Detail)": clean_text(details.get("Bid Closing Date", "")),
            "Submission Type": clean_text(details.get("Submission Type", "")),
            "Submission Address": clean_text(details.get("Submission Address", "")),
            "Public Opening": clean_text(details.get("Public Opening", "")),
            "Description": clean_text(description_text or details.get("Description", "")),
            "Categories": clean_text(categories)
        }

    except Exception as e:
        log(f"❌ Detail error: {e}")
        return None


# ---------------- SET LIMIT ----------------
async def set_limit_to_200(frame, page):
    try:
        await frame.locator("select").first.wait_for(timeout=10000)
        dropdowns = await frame.locator("select").all()
        log(f"Dropdowns found: {len(dropdowns)}")
        for i, dd in enumerate(dropdowns):
            options = await dd.locator("option").all_text_contents()
            log(f"  dropdown[{i}] options: {options}")
            # Pick the highest available option
            numeric_opts = [o.strip() for o in options if o.strip().isdigit()]
            if numeric_opts:
                highest = str(max(int(o) for o in numeric_opts))
                await dd.select_option(label=highest)
                await page.wait_for_timeout(4000)
                await frame.locator("table tbody tr").first.wait_for(timeout=15000)
                log(f"✅ Limit set to {highest}")
                return
        log("⚠️ Could not find rows-per-page dropdown")
    except Exception as e:
        log(f"❌ Limit error: {e}")


# ---------------- MAIN SCRAPER ----------------
async def scrape():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        )
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        )
        page = await context.new_page()

        log("Opening page...")
        await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(8000)

        title = await page.title()
        log(f"Page title: {title}")

        await page.screenshot(path="debug_screenshot.png", full_page=True)

        await page.wait_for_selector('iframe[src*="opportunities.bidsandtenders.com"]', timeout=30000)
        await page.wait_for_timeout(5000)

        frame = page.frame_locator('iframe[src*="opportunities.bidsandtenders.com"]')
        await frame.locator("table tbody tr").first.wait_for(timeout=30000)

        await set_limit_to_200(frame, page)

        all_data = []
        page_number = 1

        while True:
            log(f"\n--- Page {page_number} ---")

            rows = await frame.locator("table tbody tr").all()
            log(f"Rows on this page: {len(rows)}")

            semaphore = asyncio.Semaphore(CONCURRENCY)

            async def bounded(link, base):
                async with semaphore:
                    return await extract_detail(context, link, base)

            tasks = []

            for row in rows:
                try:
                    cols = await row.locator("td").all()
                    if len(cols) < 5:
                        continue

                    title_full = await cols[0].inner_text()
                    status = await cols[1].inner_text()
                    posted_date = await cols[2].inner_text()
                    closing_date = await cols[3].inner_text()

                    if " - " in title_full:
                        bid_num_list, bid_name_list = title_full.split(" - ", 1)
                    else:
                        bid_num_list = ""
                        bid_name_list = title_full

                    base = {
                        "Title": title_full,
                        "Bid Number (List)": bid_num_list,
                        "Bid Name (List)": bid_name_list,
                        "Status (List)": status,
                        "Posted Date": posted_date,
                        "Closing Date (List)": closing_date
                    }

                    link = await cols[-1].locator("a").get_attribute("href")
                    if link:
                        tasks.append(bounded(link, base))

                except:
                    continue

            results = await asyncio.gather(*tasks)
            all_data.extend([r for r in results if r])
            log(f"Total collected so far: {len(all_data)}")

            if page_number >= MAX_PAGES:
                log("Reached MAX_PAGES limit")
                break

            try:
                next_btn = frame.locator('[aria-label="Next page"], button:has-text("›"), a:has-text("›")')
                count = await next_btn.count()
                log(f"Next button count: {count}")

                if count == 0:
                    log("No next button — reached last page")
                    break

                await next_btn.first.click()
                await page.wait_for_timeout(3000)
                await frame.locator("table tbody tr").first.wait_for(timeout=15000)

                page_number += 1

            except Exception as e:
                log(f"❌ Pagination error on page {page_number}: {e}")
                break

        await browser.close()

        log(f"Total scraped before filter: {len(all_data)}")

        df = pd.DataFrame(all_data, columns=COLUMNS)
        df = df[df["Bid Classification"].str.contains("Services", case=False, na=False)]
        log(f"Filtered rows (Services): {len(df)}")

        # Save JSON file
        records = df.to_dict(orient="records")
        with open("bids.json", "w", encoding="utf-8") as f:
            json.dump(records, f, ensure_ascii=False, indent=2)
        log(f"💾 JSON saved: bids.json ({len(records)} records)")

        try:
            sheet = connect_gsheet()
            upload_to_gsheet(sheet, df)
        except Exception as e:
            log(f"❌ Google Sheets upload failed: {e}")

        try:
            fs_client = connect_firestore()
            upload_to_firestore(fs_client, df)
        except Exception as e:
            log(f"❌ Firestore upload failed: {e}")


asyncio.run(scrape())
