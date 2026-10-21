from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
 page=b.new_page(); page.set_default_timeout(5000)
 page.goto(Path(r'D:\微信小程序开发\ui设计稿\赛事详情页-第三版.html').as_uri(),wait_until='load',timeout=5000)
 print(page.evaluate('''() => {const p=document.getElementById('entry');p.querySelector('[data-action=open]').click();p.querySelectorAll('[data-action=score]')[119].click();return [p.querySelector('.result-page h2').textContent,p.querySelector('.result-nav span').textContent]}'''),flush=True)
 b.close()
