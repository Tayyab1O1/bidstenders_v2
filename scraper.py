import asyncio
import pandas as pd
from playwright.async_api import async_playwright
import datetime
import re
import gspread
from oauth2client.service_account import ServiceAccountCredentials

URL = "https://bidsandtenders.com/bid-opportunities/"
LOG_FILE = "scraper_log.txt"

CONCURRENCY = 8
MAX_PAGES = 10


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

    # 🔥 PUT YOUR REAL SHEET ID HERE
    sheet = client.open_by_key("1E91ZyuPWuUQYXdWrVMwlofGM8eLlNYCeBfrJj439mBE").bidsandtenders
    return sheet


def get_existing_ids(sheet):
    records = sheet.get_all_records()
    return set([str(r.get("Bid Number")) for r in records if r.get("Bid Number")])


# ---------------- DETAIL SCRAPER ----------------
async def extract_detail(context, link, base_data):
    try:
        page = await context.new_page()

        # 🔥 RETRY LOGIC
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
        dropdowns = await frame.locator("select").all()
        for dd in dropdowns:
            options = await dd.locator("option").all_text_contents()
            if any(opt.strip() == "200" for opt in options):
                await dd.select_option(label="200")
                await page.wait_for_timeout(3000)
                log("✅ Limit set to 200")
                return
    except Exception as e:
        log(f"❌ Limit error: {e}")


# ---------------- MAIN SCRAPER ----------------
async def scrape():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        log("Opening page...")
        await page.goto(URL)
        await page.wait_for_timeout(5000)

        frame = page.frame_locator('iframe[name="Bid Opportunities"]')
        await set_limit_to_200(frame, page)

        all_data = []
        page_number = 1

        while True:
            log(f"\n--- Page {page_number} ---")

            rows = await frame.locator("table tbody tr").all()
            log(f"Rows: {len(rows)}")

            # 🔥 DUPLICATE PAGE DETECTION
            prev_first_row = await rows[0].inner_text() if rows else ""

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

            if page_number >= MAX_PAGES:
                log("Reached MAX_PAGES")
                break

            try:
                next_btn = frame.locator("a[aria-label='Next']")
                if await next_btn.count() == 0:
                    break

                await next_btn.first.evaluate("el => el.click()")
                await page.wait_for_timeout(4000)

                new_rows = await frame.locator("table tbody tr").all()
                if new_rows:
                    new_first_row = await new_rows[0].inner_text()
                    if new_first_row == prev_first_row:
                        log("Detected duplicate page → stopping")
                        break

                page_number += 1

            except:
                break

        await browser.close()

        df = pd.DataFrame(all_data)
        df = df[df["Bid Classification"].str.contains("Services", case=False, na=False)]

        log(f"Filtered rows (Services): {len(df)}")

        # 🔥 ALWAYS SAVE LOCAL BACKUP
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M")
        filename = f"bids_backup_{timestamp}.xlsx"
        df.to_excel(filename, index=False)
        log(f"💾 Local backup saved: {filename}")

        # 🔥 GOOGLE SHEETS UPLOAD (SAFE)
        try:
            sheet = connect_gsheet()
            existing_ids = get_existing_ids(sheet)

            new_rows = []
            for _, row in df.iterrows():
                bid_id = str(row["Bid Number"])
                if bid_id not in existing_ids:
                    new_rows.append(row.values.tolist())

            if new_rows:
                sheet.append_rows(new_rows)
                log(f"✅ Added {len(new_rows)} rows to Google Sheets")
            else:
                log("No new bids found")

        except Exception as e:
            log(f"❌ Google Sheets upload failed: {e}")
            log("Data محفوظ locally — no data loss ✅")


asyncio.run(scrape())