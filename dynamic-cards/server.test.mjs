import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { loadProjects, buildQuery, parseMetrics, MetricsCache, renderRow, createApp } from './server.mjs';

const projects = loadProjects();
const now = Date.parse('2026-11-08T01:00:00Z');
function payload(total = 20, recent = 0) {
  return { data: Object.fromEntries(projects.map((p, i) => [`r${i}`, { ref: { target: { committedDate: '2026-11-07T20:00:00Z', all: { totalCount: total }, recent: { totalCount: recent } } } }])) };
}
const response = value => ({ ok: true, status: 200, text: async () => JSON.stringify(value) });

test('consulta limita os dados aos 16 repositórios e à main, sem mensagens ou código', () => {
  const query = buildQuery(projects);
  assert.equal((query.match(/repository\(owner:/g) ?? []).length, 16);
  assert.equal((query.match(/refs\/heads\/main/g) ?? []).length, 16);
  assert.match(query, /since: \$since, until: \$until/);
  assert.doesNotMatch(query, /message|email|object\(|blob|author/);
});

test('zero commits recentes é um dado válido; ausência de acesso não vira zero', () => {
  const value = payload();
  value.data.r1 = null;
  const metrics = parseMetrics(value, projects, now);
  assert.equal(metrics.get(projects[0].repo).recent, 0);
  assert.equal(metrics.has(projects[1].repo), false);
  assert.equal(metrics.size, 15);
});

test('falhas parciais e contagens inconsistentes não produzem estatísticas falsas', () => {
  const value = payload();
  value.errors = [{ path: ['r0', 'ref'], message: 'restricted' }];
  value.data.r1.ref.target.recent.totalCount = 99;
  value.data.r2.ref.target.committedDate = 'invalid';
  value.data.r3.ref.target.all.totalCount = -1;
  const metrics = parseMetrics(value, projects, now);
  for (const i of [0, 1, 2, 3]) assert.equal(metrics.has(projects[i].repo), false);
  assert.equal(metrics.size, 12);
  assert.equal(parseMetrics({ errors: [{ message: 'bad query' }] }, projects, now).size, 0);
});

test('cache expira e autorização revogada remove imediatamente dados anteriores', async () => {
  let time = now;
  let unauthorized = false;
  const cache = new MetricsCache(projects, 'unit-test-credential', async (url, options) => {
    assert.equal(url, 'https://api.github.com/graphql');
    assert.equal(options.redirect, 'error');
    assert.equal(options.method, 'POST');
    const variables = JSON.parse(options.body).variables;
    assert.equal(Date.parse(variables.until) - Date.parse(variables.since), 30 * 86400000);
    return unauthorized ? { ok: false, status: 401 } : response(payload());
  }, () => time);
  assert.equal(await cache.refresh(), true);
  assert.equal(cache.snapshot().size, 16);
  time += 3600000;
  assert.equal(cache.snapshot().size, 0);
  time = now;
  unauthorized = true;
  assert.equal(await cache.refresh(), false);
  assert.equal(cache.snapshot().size, 0);
});

test('atualizações simultâneas compartilham uma única chamada upstream', async () => {
  let calls = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const cache = new MetricsCache(projects, 'unit-test-credential', async () => { calls++; await gate; return response(payload()); }, () => now);
  const first = cache.refresh();
  const second = cache.refresh();
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('sem credencial não há chamada GitHub nem dados simulados', async () => {
  const cache = new MetricsCache(projects, '', () => { throw new Error('must not call'); });
  assert.equal(await cache.refresh(), false);
  const svg = renderRow(projects, cache.snapshot(), 1);
  assert.match(svg, /Estatísticas indisponíveis/);
  assert.doesNotMatch(svg, /Commits na main/);
  assert.doesNotMatch(svg, /unit-test-credential/);
});

test('indisponibilidade HTTP não expõe detalhes internos ou segredo', async () => {
  const cache = new MetricsCache(projects, '', () => { throw new Error('must not call'); });
  const app = createApp(projects, cache);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    const health = await fetch(base + '/healthz');
    assert.equal(health.status, 200);
    assert.equal((await health.json()).configured, false);
    assert.equal((await fetch(base + '/readyz')).status, 503);
    const card = await fetch(base + '/rows/01.svg');
    assert.equal(card.status, 200);
    assert.equal(card.headers.get('cache-control'), 'no-store');
    assert.match(await card.text(), /Estatísticas indisponíveis/);
    assert.equal((await fetch(base + '/rows/09.svg')).status, 404);
    assert.equal((await fetch(base + '/rows/CloudPort.svg')).status, 404);
    assert.equal((await fetch(base + '/rows/01.svg', { method: 'POST' })).status, 405);
    assert.equal(await (await fetch(base + '/rows/01.svg', { method: 'HEAD' })).text(), '');
  } finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
});

test('cartões prontos respeitam cache condicional e variante mobile', async () => {
  const cache = new MetricsCache(projects, 'unit-test-credential', async () => response(payload()), () => now);
  await cache.refresh();
  const app = createApp(projects, cache);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const base = `http://127.0.0.1:${app.address().port}`;
  try {
    assert.equal((await fetch(base + '/readyz')).status, 200);
    const card = await fetch(base + '/rows/08.svg');
    assert.equal(card.status, 200);
    assert.match(await card.text(), /Lastro/);
    const unchanged = await fetch(base + '/rows/08.svg', { headers: { 'If-None-Match': card.headers.get('etag') } });
    assert.equal(unchanged.status, 304);
    const mobile = await (await fetch(base + '/rows/01-mobile.svg')).text();
    assert.match(mobile, /viewBox="0 0 624 1228"/);
    assert.match(mobile, /Commits em 30 dias/);
    assert.doesNotMatch(mobile, /<script|foreignObject/);
  } finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); }
});
