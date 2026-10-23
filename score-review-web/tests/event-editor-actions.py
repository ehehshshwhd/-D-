"""Exercise the five event editor actions in the real page with a mock cloud."""
import base64
import json
import sys
import unittest
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
for base in [ROOT, ROOT.parent]:
    sys.path.insert(0, str(base / '.racing-tools' / 'python'))
from playwright.sync_api import sync_playwright

SOURCE = (ROOT / 'full-system/index.html').read_text(encoding='utf-8')
EVENT = dict(id='actions-test', title='按钮测试赛事', type='拉力赛',
             dateStart='2026-10-31', dateEnd='2026-11-02',
             registrationDeadline='2026-10-22', status='报名中',
             location='资兴市', contactPhone='13269191919', published=True,
             coverFileId='cloud://original-cover',
             detailPageHtml='<p>上次保存的正文</p>')
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGK0AAAAASUVORK5CYII=')


class EditorActions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch(channel='msedge', headless=True)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        self.event = dict(EVENT)
        self.requests = []
        self.errors = []
        self.fail_next = False
        self.page = self.browser.new_page(viewport=dict(width=1280, height=800))
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.route('http://race-actions.test/**', self.mock_cloud)
        self.page.add_init_script('''
            window.RACE_API_SAME_ORIGIN=true;
            window.alerts=[];window.alert=message=>window.alerts.push(message);
            window.allowConfirm=true;window.confirm=()=>window.allowConfirm;
            window.returnedHome=0;window.mutationsStarted=0;
            const originalFetch=window.fetch;
            window.fetch=async(url,options)=>{
                if(String(url).endsWith('/api/events')&&['POST','DELETE'].includes(options?.method)){
                    window.mutationsStarted++;
                    if(window.holdMutation)await new Promise((resolve,reject)=>{
                        window.releaseMutation=resolve;
                        options?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
                    });
                }
                return originalFetch(url,options);
            };
        ''')
        self.page.goto('http://race-actions.test/', wait_until='networkidle', timeout=60000)
        self.page.get_by_placeholder('请输入赛事标题').wait_for(timeout=30000)

    def tearDown(self):
        errors = self.errors[:]
        self.page.close()
        self.assertEqual(errors, [])

    def mock_cloud(self, route):
        path = urlparse(route.request.url).path
        if path == '/':
            render = 'EVENTS=[cloudEventToEditorEvent(' + json.dumps(self.event, ensure_ascii=False) + ''')];
                ReactDOM.createRoot(document.getElementById("root")).render(
                  <div className="admin-app min-w-[1280px] bg-white">
                    <Header user={{name:'测试管理员'}} activeModule="赛事管理" onHome={()=>{}} />
                    <DetailPage ev={EVENTS[0]} onHome={()=>{window.returnedHome++}} />
                  </div>);'''
            return route.fulfill(content_type='text/html; charset=utf-8', body=SOURCE.replace(
                'ReactDOM.createRoot(document.getElementById("root")).render(<App />);', render))
        if path in ['/full-system/score-review-cloud.js', '/full-system/score-review-export.js']:
            return route.fulfill(content_type='text/javascript', body=(ROOT / path.lstrip('/')).read_bytes())
        if path == '/api/event-covers':
            if route.request.method == 'POST':
                return route.fulfill(json=dict(ok=True, coverFileId='cloud://new-cover'))
            return route.fulfill(content_type='image/png', body=PNG)
        if path == '/api/events':
            if route.request.method in ['POST', 'DELETE']:
                payload = route.request.post_data_json
                self.requests.append((route.request.method, payload))
                if self.fail_next:
                    self.fail_next = False
                    return route.fulfill(status=503, json=dict(ok=False, message='测试云端暂不可用'))
                self.event = {**self.event, **payload, 'id': payload.get('id') or 'saved-event', 'isNew': False}
                return route.fulfill(json=dict(ok=True, event=self.event))
            return route.fulfill(json=dict(ok=True, events=[self.event]))
        if path == '/api/event-data':
            return route.fulfill(json=dict(ok=True, items={}, storage='cloudbase'))
        if path == '/api/health':
            return route.fulfill(json=dict(ok=True, cloudEnabled=True, cloudDatabaseConnected=True))
        if path == '/api/session':
            return route.fulfill(json=dict(ok=True))
        return route.fulfill(status=404, body='not found')

    def button(self, name):
        return self.page.get_by_role('button', name=name, exact=name != '手机预览')

    def save(self, publish=False):
        self.button('发布到小程序' if publish else '提交并返回').click()
        self.page.wait_for_function('window.returnedHome===1')
        return self.requests[-1][1]

    def test_footer_and_phone_preview(self):
        for name in ['删除赛事', '手机预览', '提交并返回', '重置', '发布到小程序']:
            button = self.button(name)
            box = button.bounding_box()
            self.assertGreaterEqual(box['y'], 0)
            self.assertLessEqual(box['y'] + box['height'], 800)
            button.click(trial=True)
        self.button('手机预览').click()
        dialog = self.page.get_by_role('dialog', name='赛事手机预览')
        dialog.wait_for()
        self.assertEqual(dialog.locator('.race-phone-title').inner_text(), EVENT['title'])
        self.assertIn('上次保存的正文', dialog.inner_text())
        self.page.keyboard.press('Escape')
        self.assertFalse(dialog.is_visible())

    def test_reset_restores_saved_content_for_preview_and_submit(self):
        self.page.get_by_placeholder('请输入赛事标题').fill('改过的标题')
        self.page.locator('[data-date="start"]').fill('2026-10-30')
        self.page.locator('[data-editor]').fill('不应保留的正文')
        self.button('重置').click()
        self.assertEqual(self.page.get_by_placeholder('请输入赛事标题').input_value(), EVENT['title'])
        self.assertEqual(self.page.locator('[data-date="start"]').input_value(), EVENT['dateStart'])
        self.assertEqual(self.page.locator('[data-editor]').inner_html(), EVENT['detailPageHtml'])
        self.button('手机预览').click()
        dialog = self.page.get_by_role('dialog', name='赛事手机预览')
        self.assertEqual(dialog.locator('.race-phone-content').inner_html(), EVENT['detailPageHtml'])
        self.page.keyboard.press('Escape')
        saved = self.save()
        self.assertEqual(saved['detailPageHtml'], EVENT['detailPageHtml'])
        self.assertNotIn('content', self.requests[-1][1])
        self.assertNotIn('form', self.requests[-1][1])
        self.assertNotIn('dates', self.requests[-1][1])
        self.assertNotIn('img', self.requests[-1][1])

    def test_new_event_save_removes_temporary_local_draft(self):
        temporary_id = 'temporary-draft-1'
        self.event = {**EVENT, 'id': temporary_id, 'isNew': True, 'title': ''}
        self.page.reload(wait_until='networkidle')
        self.page.get_by_placeholder('请输入赛事标题').wait_for(timeout=30000)
        self.page.get_by_placeholder('请输入赛事标题').fill('新赛事')
        self.page.locator('[data-date="start"]').fill('2026-10-31')
        self.page.locator('[data-date="end"]').fill('2026-11-02')
        self.page.locator('[data-date="deadline"]').fill('2026-10-22')
        self.button('提交并返回').click()
        self.page.wait_for_function('window.returnedHome===1')
        drafts = self.page.evaluate("JSON.parse(localStorage.getItem('race-events') || '[]')")
        self.assertEqual([item['id'] for item in drafts], ['saved-event'])

    def test_save_from_source_mode_saves_html_instead_of_escaped_code(self):
        self.page.locator('[role="toolbar"] button').filter(has_text='HTML').click()
        self.page.locator('[data-editor]').fill('<p style="text-align:center">新的居中正文</p>')
        saved = self.save()
        self.assertIn('新的居中正文', saved['detailPageHtml'])
        self.assertIn('<p style="text-align:center">', saved['detailPageHtml'])
        self.assertNotIn('&lt;p', saved['detailPageHtml'])

    def test_legacy_paragraphs_align_to_editor_and_survive_save_and_preview(self):
        # Migrated phone-preview paragraphs retain their old measured pixel width.
        self.event['detailPageHtml'] = '''
            <div class="mini-preview-copy mini-preview-generic-copy content-align-left"
                 style="width:1023px;max-width:100%;text-align:center;white-space:pre-wrap"><b>勘路</b></div>
            <div class="mini-preview-copy mini-preview-generic-copy"
                 style="width:1023px;max-width:100%;text-align:center">媒介试车</div>
            <h4 style="text-align:center">赛车巡游</h4>
            <h4 style="text-align:center">开幕式</h4>
            <p style="width:240px">独立定宽内容</p>
            <table><tbody><tr><td>表格单元格</td><td>另一列</td></tr></tbody></table>'''
        self.page.set_viewport_size(dict(width=1920, height=1080))
        self.page.reload(wait_until='networkidle')
        editor = self.page.locator('[data-editor]')

        def alignment_offsets(container):
            return container.evaluate('''root=>{
                const box=root.getBoundingClientRect(),css=getComputedStyle(root);
                const left=box.left+parseFloat(css.borderLeftWidth)+parseFloat(css.paddingLeft);
                const right=box.right-parseFloat(css.borderRightWidth)-parseFloat(css.paddingRight);
                return [...root.querySelectorAll('.mini-preview-copy,h4')].map(el=>{
                    const range=document.createRange();range.selectNodeContents(el);
                    const rect=range.getBoundingClientRect();
                    return Math.abs((rect.left+rect.right-left-right)/2);
                });
            }''')

        self.assertLess(max(alignment_offsets(editor)), 2,
                        '旧文字块和标题应使用同一个中心，不能按旧的 1023px 宽度居中')
        for label, expected in [('左对齐', 'left'), ('居中', 'center'), ('右对齐', 'right'), ('居中', 'center')]:
            editor.evaluate('''root=>{
                const range=document.createRange();
                range.setStart(root.querySelector('.mini-preview-copy').firstChild,0);
                const last=root.querySelectorAll('h4')[1].lastChild;
                range.setEnd(last,last.textContent.length);
                const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
                root.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
            }''')
            self.button(label).click()
            self.assertEqual(editor.locator('.mini-preview-copy,h4').evaluate_all(
                'nodes=>nodes.map(el=>getComputedStyle(el).textAlign)'), [expected] * 4)
        self.assertLess(max(alignment_offsets(editor)), 2)
        self.assertEqual(editor.locator('p').evaluate('el=>el.style.width'), '240px')
        self.assertEqual(editor.locator('td').all_text_contents(), ['表格单元格', '另一列'])
        self.assertEqual(editor.locator('b').inner_text(), '勘路')
        self.button('手机预览').click()
        content = self.page.get_by_role('dialog', name='赛事手机预览').locator('.race-phone-content')
        self.assertLess(max(alignment_offsets(content)), 2)
        self.page.keyboard.press('Escape')
        saved = self.save()['detailPageHtml']
        self.assertNotIn('1023px', saved)
        self.page.reload(wait_until='networkidle')
        self.assertLess(max(alignment_offsets(editor)), 2)

    def test_reset_restores_cover_and_editor_mode(self):
        self.page.locator('input[type=file][accept="image/*"]').set_input_files(
            dict(name='new-cover.png', mimeType='image/png', buffer=PNG))
        self.page.wait_for_function("document.querySelector('img[alt=赛事封面]').src.includes('new-cover')")
        self.page.get_by_role('button', name='HTML', exact=True).click()
        self.page.locator('[data-editor]').fill('<p>源码修改</p>')
        self.button('重置').click()
        self.assertTrue(self.page.get_by_role('button', name='加粗', exact=True).is_enabled())
        self.assertIn('original-cover', self.page.get_by_alt_text('赛事封面').get_attribute('src'))
        saved = self.save()
        self.assertEqual(saved['coverFileId'], EVENT['coverFileId'])
        self.assertEqual(saved['detailPageHtml'], EVENT['detailPageHtml'])

    def test_save_publish_show_progress_and_prevent_duplicate_requests(self):
        self.page.evaluate('window.holdMutation=true')
        self.button('发布到小程序').click()
        self.page.wait_for_function('window.mutationsStarted===1')
        pending = self.page.get_by_role('button', name='正在发布…', exact=True)
        self.assertEqual(pending.count(), 1, '发布请求等待时应显示进度')
        self.assertFalse(pending.is_enabled())
        self.assertFalse(self.button('提交并返回').is_enabled())
        self.assertFalse(self.button('删除赛事').is_enabled())
        self.assertFalse(self.button('重置').is_enabled())
        self.page.evaluate('window.releaseMutation()')
        self.page.wait_for_function('window.returnedHome===1')
        self.assertEqual(len(self.requests), 1)
        self.assertTrue(self.requests[0][1]['published'])

    def test_save_timeout_restores_buttons_and_allows_retry(self):
        self.page.evaluate('window.RACE_EDITOR_REQUEST_TIMEOUT_MS=50;window.holdMutation=true')
        self.button('提交并返回').click()
        self.page.wait_for_function('window.alerts.at(-1)?.includes("保存超时")', timeout=3000)
        self.assertEqual(self.page.evaluate('window.returnedHome'), 0)
        self.assertTrue(self.button('提交并返回').is_enabled())
        self.assertTrue(self.button('发布到小程序').is_enabled())
        self.page.evaluate('window.holdMutation=false')
        self.assertFalse(self.save()['published'])

    def test_validation_and_save_failure_allow_retry(self):
        title = self.page.get_by_placeholder('请输入赛事标题')
        title.fill('')
        self.button('提交并返回').click()
        self.assertEqual(self.page.evaluate('window.alerts.at(-1)'), '请输入赛事标题')
        self.assertEqual(self.requests, [])
        title.fill(EVENT['title'])
        self.fail_next = True
        self.button('提交并返回').click()
        self.page.wait_for_function('window.alerts.at(-1).includes("测试云端暂不可用")')
        self.assertEqual(self.page.evaluate('window.returnedHome'), 0)
        self.assertTrue(self.button('提交并返回').is_enabled())
        self.assertFalse(self.save()['published'])

    def test_delete_cancel_failure_and_retry(self):
        self.page.evaluate('window.allowConfirm=false')
        self.button('删除赛事').click()
        self.assertEqual(self.requests, [])
        self.page.evaluate('window.allowConfirm=true')
        self.fail_next = True
        self.button('删除赛事').click()
        self.page.wait_for_function('window.alerts.at(-1)?.includes("删除赛事失败")')
        self.assertEqual(self.page.evaluate('window.returnedHome'), 0)
        self.button('删除赛事').click()
        self.page.wait_for_function('window.returnedHome===1')
        self.assertEqual(self.requests[-1], ('DELETE', dict(eventId=EVENT['id'])))

    def test_registration_checkbox_position_size_reset_and_cloud_round_trip(self):
        checkbox = self.page.get_by_role('checkbox', name='开启报名', exact=True)
        checkbox.wait_for(timeout=5000)
        self.assertFalse(checkbox.is_checked())
        city_field = self.page.get_by_text('举办城市', exact=True).locator('..')
        city_control = city_field.locator(':scope > div > div').first.bounding_box()
        box = checkbox.bounding_box()
        self.assertGreaterEqual(box['y'], city_control['y'] + city_control['height'])
        hidden_box = self.page.get_by_role('checkbox', name='隐藏报名人数').bounding_box()
        self.assertEqual(box['width'], hidden_box['width'])
        self.assertEqual(box['height'], hidden_box['height'])
        self.assertLessEqual(box['height'], 20)
        checkbox.check()
        self.button('重置').click()
        self.assertFalse(checkbox.is_checked())
        checkbox.check()
        saved = self.save()
        self.assertIs(saved['registrationEnabled'], True)
        self.page.reload(wait_until='networkidle')
        self.assertTrue(checkbox.is_checked())
        checkbox.uncheck()
        saved = self.save(publish=True)
        self.assertIs(saved['registrationEnabled'], False)
        self.page.reload(wait_until='networkidle')
        self.assertFalse(checkbox.is_checked())

    def test_group_save_preserves_event_registration_switch(self):
        self.event['groups'] = ['四驱组']
        self.event['signupOptions'] = [dict(name='四驱组', fee='3000', unit='车')]
        for enabled in [False, True]:
            self.event['registrationEnabled'] = enabled
            self.page.reload(wait_until='networkidle')
            self.page.get_by_text('组别管理', exact=True).click()
            self.button('编辑').click()
            self.button('提交并返回').click()
            self.page.wait_for_function("document.body.innerText.includes('已同步到云端，小程序将显示')")
            self.assertIs(self.requests[-1][1]['registrationEnabled'], enabled)


if __name__ == '__main__':
    unittest.main(verbosity=2)
