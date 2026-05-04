#!/usr/bin/env python3
import asyncio
from playwright.async_api import async_playwright

BASE_URL = "http://127.0.0.1:31081"
LOGIN_URL = f"{BASE_URL}/login"
CUSTOMER_URL = f"{BASE_URL}/crm/customers/demo-customer-01"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 375, "height": 812})
        page = await context.new_page()

        # 1. Login
        await page.goto(LOGIN_URL)
        await page.fill('input[name="email"]', "solarise_@live.com")
        await page.fill('input[name="password"]', "WZwz19940203")
        await page.click('button[type="submit"]')
        await page.wait_for_url(f"{BASE_URL}/dashboard", timeout=10000)
        print("Logged in")

        # 2. Go to customer detail
        await page.goto(CUSTOMER_URL)
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(1)

        # 3. Switch to "跟进任务" tab
        # Mobile: click the Select trigger, then click the option
        await page.click('button[role="combobox"]')
        await asyncio.sleep(0.3)
        await page.click('text=跟进任务')
        await asyncio.sleep(1)
        await page.screenshot(path="/home/solarise/project-manage/scripts/screenshot-follow-ups.png", full_page=False)
        print("Screenshot: screenshot-follow-ups.png")

        # 4. Switch to "关系网络" tab
        await page.click('button[role="combobox"]')
        await asyncio.sleep(0.3)
        await page.click('text=关系网络')
        await asyncio.sleep(1)
        await page.screenshot(path="/home/solarise/project-manage/scripts/screenshot-relations.png", full_page=False)
        print("Screenshot: screenshot-relations.png")

        await browser.close()

asyncio.run(main())
