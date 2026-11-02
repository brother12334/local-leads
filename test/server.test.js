import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateIp, server } from '../server.js';

test('private address guard', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.1', '172.20.0.5', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111']) assert.ok(!isPrivateIp(ip), ip);
});

test('server serves the app and refuses internal targets', async () => {
  await new Promise(r => server.listen(0, r));
  after(() => server.close());
  const base = `http://localhost:${server.address().port}`;
  assert.equal((await (await fetch(base + '/api/health')).json()).localLeads, true);
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Local Leads/);
  assert.equal((await fetch(base + '/../server.js')).status, 404);
  const blocked = await fetch(base + '/api/fetch?url=' + encodeURIComponent('http://127.0.0.1:8080/'));
  assert.equal(blocked.status, 502);
  const meta = await fetch(base + '/api/fetch?url=' + encodeURIComponent('http://169.254.169.254/latest'));
  assert.equal((await meta.json()).code, 'BLOCKED');
  assert.equal((await fetch(base + '/api/fetch?url=file:///etc/passwd')).status, 502);
});
