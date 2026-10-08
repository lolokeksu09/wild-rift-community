import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApp } from '../server/app.mjs';

const browser = await chromium.launch();
try {
  for (const width of [360, 390, 768, 1440]) {
    const app = await createApp({ moderatorIds: [1] });
    const contexts = [], errors = [];
    try {
      const origin = await app.listen();
      async function actor(handle) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        contexts.push(context);
        let csrf;
        async function api(path, data) {
          const response = await context.request.fetch(origin + path, {
            method: data === undefined ? 'GET' : 'POST',
            headers: { Origin: origin, 'X-Community-Request': '1', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
            ...(data === undefined ? {} : { data })
          });
          assert(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
          const body = await response.json();
          if (body.csrf) csrf = body.csrf;
          return body;
        }
        const registration = await api('/api/register', { handle, name: handle, password: 'Browser-community-only-12345' });
        const page = await context.newPage();
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin);
        await page.locator('#createClub').waitFor();
        return { page, api, id: registration.user.id };
      }
      async function layout(page, label, ready) {
        await page.locator(ready).first().waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px overflow: ${label}`);
        assert.equal(await page.locator('#main img, #main script').count(), 0, 'User HTML must stay text');
        assert.deepEqual(errors, []);
        console.log(`PASS ${width}px: ${label}`);
      }
      async function send(page, text) {
        await page.locator('[data-chat-form] textarea').fill(text);
        await page.locator('[data-chat-form] button').click();
        await page.locator('[data-message-id]').filter({ hasText: text }).waitFor();
      }
      const mod = await actor('moderator'), owner = await actor('owner'), member = await actor('member');
      assert.equal(mod.id, 1);
      const longText = '<img src=x> ' + 'ДлинноеСообщение'.repeat(30);

      // Club message crosses real browser contexts and disappears after a ban.
      const club = await owner.api('/api/clubs', { name: 'Тестовый клуб', description: '', access: 'request' });
      await member.api(`/api/clubs/${club.id}/join`, {});
      await owner.api(`/api/clubs/${club.id}/decision`, { userId: member.id, decision: 'approve' });
      for (const user of [owner, member]) {
        await user.page.locator('#home').click();
        await user.page.locator(`[data-open="${club.id}"]`).click();
        await user.page.locator('[data-chat-form]').waitFor();
      }
      await send(owner.page, longText);
      await member.page.locator('[data-message-id]').filter({ hasText: longText }).waitFor();
      await layout(member.page, 'club chat / long escaped message', '[data-message-id]');
      await owner.api(`/api/clubs/${club.id}/ban`, { userId: member.id });
      await member.page.waitForFunction(() => !document.querySelector('[data-message-id]'));

      // A report on an incoming request must not accept that request.
      const conversation = await owner.api('/api/direct', { handle: 'member', clientId: `browser-request-${width}`, body: longText });
      await member.page.locator('#direct').click();
      await layout(member.page, 'incoming direct request', '[data-request-report]');
      member.page.once('dialog', dialog => dialog.accept('Проверить сообщение ' + 'Причина'.repeat(30)));
      await member.page.locator('[data-request-report]').click();
      await member.page.getByText('Жалоба отправлена. Запрос не принят.', { exact: true }).waitFor();
      assert.equal((await member.api('/api/direct')).conversations.find(c => c.id === conversation.id).status, 'pending');
      await mod.page.locator('#reports').click();
      await layout(mod.page, 'moderator queue / escaped snapshot', '[data-report-decision]');
      await mod.page.locator('[data-report-decision] [name=note]').fill('Проверено <script>текст</script> ' + 'Объяснение'.repeat(30));
      await mod.page.locator('[data-report-decision] button').click();
      await mod.page.locator('[data-report-decision]').waitFor({ state: 'detached' });
      await member.page.locator('#reports').click();
      await layout(member.page, 'report result', '[data-report-read]');
      await member.page.locator('[data-report-read]').click();
      await member.page.locator('[data-report-read]').waitFor({ state: 'detached' });
      assert.equal((await member.api('/api/reports/summary')).unread, 0);
      await member.page.locator('#direct').click();
      await member.page.locator('[data-accept]').click();
      await member.page.locator('[data-conversation]').click();
      await send(member.page, 'Ответ в личной беседе');
      await layout(member.page, 'accepted direct chat', '[data-message-id]');

      // Two players create/apply/accept through UI, then lose send access on close.
      await owner.page.locator('#lfg').click();
      await owner.page.getByText('Создать группу', { exact: true }).click();
      const form = owner.page.locator('[data-lfg-create]');
      for (const [key, value] of Object.entries({ title: 'Команда браузерного теста', region: 'eu', language: 'ru', capacity: '2', description: longText })) {
        await form.locator(`[name=${key}]`).fill(value);
      }
      await form.locator('button').click();
      await owner.page.locator('[data-lfg-chat]').waitFor();
      await member.page.locator('#lfg').click();
      await member.page.locator('[data-lfg-list] [data-lfg-open]').click();
      await member.page.locator('[data-lfg-action=apply]').click();
      await member.page.locator('[data-lfg-action=leave]').waitFor();
      assert.equal(await member.page.locator('[data-lfg-chat]').count(), 0);
      await owner.page.locator('[data-lfg-refresh]').click();
      await owner.page.locator('[data-lfg-decision=accept]').click();
      await owner.page.locator('[data-lfg-decision=accept]').waitFor({ state: 'detached' });
      await member.page.locator('[data-lfg-refresh]').click();
      await send(member.page, longText);
      await layout(member.page, 'accepted group chat', '[data-message-id]');
      await owner.page.locator('[data-lfg-action=close]').click();
      await owner.page.getByText('Чат группы · только чтение', { exact: true }).waitFor();
      await member.page.locator('[data-lfg-refresh]').click();
      await member.page.waitForFunction(() => document.querySelector('[data-chat-form] textarea')?.disabled);
      await layout(member.page, 'closed group / read only', '[data-message-id]');
      await member.page.locator('[data-lfg-action=leave]').click();
      await member.page.locator('[data-lfg-chat]').waitFor({ state: 'detached' });
      await member.page.locator('[data-lfg-back]').click();
      await layout(member.page, 'group notifications after leaving', '[data-lfg-read]');
    } finally {
      for (const context of contexts) await context.close();
      await app.close();
    }
  }
} finally { await browser.close(); }
