from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(r'D:\微信小程序开发\ui设计稿\赛事详情-v3')
with sync_playwright() as p:
 b=p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe',headless=True)
 page=b.new_page(viewport={'width':390,'height':844}); errs=[]; page.on('pageerror',lambda e:errs.append(str(e))); page.goto((root/'index.html').as_uri(),wait_until='load')
 assert page.locator('#groups .group-name').count()==12
 assert page.locator('#groups .stage-grid button:visible').count()==36
 page.locator('#groups [data-action=toggle-group]').first.click(); assert page.locator('#groups .stage-grid button:visible').count()==43
 assert page.locator('#groups [data-action=toggle-group]').first.get_attribute('aria-expanded')=='true'
 page.locator('#groups [data-action=toggle-group]').first.click(); assert page.locator('#groups .stage-grid button:visible').count()==36
 for gi in range(12):
  button=page.locator('#groups [data-action=toggle-group]').nth(gi); button.click(); section=page.locator('#groups .group-section').nth(gi)
  assert section.locator('.stage-grid button:visible').count()==10
  section.locator('[data-stage="9"]').click(); assert page.locator('#groups .result-page').count()==1
  assert page.locator('#groups .result-page h2').inner_text()==page.locator('#groups .group-name').nth(gi).inner_text()
  page.locator('#groups .result-page [data-action=back-groups]').first.click(); page.locator('#groups [data-action=toggle-group]').nth(gi).click()
 assert not errs,errs
 page.screenshot(path=str(root/'成绩分组-折叠.png'))
 for w in [390,320]: page.set_viewport_size({'width':w,'height':844}); assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 b.close()
print('COLLAPSE_VERIFY_OK')
