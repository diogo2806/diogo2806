import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OWNER = 'diogo2806';
const TTL_MS = 60 * 60 * 1000;
const TZ = 'America/Sao_Paulo';
const colors = { bg: '#101B27', card: '#172637', line: '#30465C', text: '#F4F8FC', muted: '#C0CFDE', accent: '#72E0CB' };
const widths = JSON.parse(readFileSync(path.join(HERE, 'font-widths.json'), 'utf8'));
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const number = value => new Intl.NumberFormat('pt-BR').format(value);
const date = value => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ }).format(new Date(value));
const clock = value => new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function measure(value, size, bold = false) {
  const table = widths[bold ? 'bold' : 'regular'];
  return [...value].reduce((sum, c) => sum + (table[c] ?? 1), 0) * size;
}

function wrap(value, size, limit) {
  const lines = [];
  let current = '';
  for (const word of value.split(/\s+/)) {
    const next = current ? current + ' ' + word : word;
    if (current && measure(next, size) > limit) { lines.push(current); current = word; }
    else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

function text(x, y, value, size = 24, color = colors.text, weight = 400) {
  return `<text x="${x}" y="${y}" font-family="DejaVu Sans, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(value)}</text>`;
}

function rect(x, y, width, height, fill, radius = 0, stroke = '') {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}/>`;
}

export function loadProjects() {
  const data = JSON.parse(readFileSync(path.join(ROOT, 'portfolio.json'), 'utf8'));
  if (!Array.isArray(data.projects) || data.projects.length !== 16) throw new Error('portfolio_invalid');
  const projects = data.projects;
  if (new Set(projects.map(p => p.repo)).size !== 16) throw new Error('portfolio_duplicate');
  for (const [index, p] of projects.entries()) {
    if (p.rank !== index + 1 || !/^[A-Za-z0-9_.-]+$/.test(p.repo)) throw new Error('portfolio_invalid');
    if (wrap(p.desc, 25, 560).length > 3 || wrap(p.desc, 33, 560).length > 4) throw new Error('description_overflow');
    if (wrap(p.focus, 24, 560).length > 2) throw new Error('focus_overflow');
  }
  return projects;
}

export function buildQuery(projects) {
  const repos = projects.map((p, index) => `r${index}: repository(owner: ${JSON.stringify(OWNER)}, name: ${JSON.stringify(p.repo)}) {
    ref(qualifiedName: "refs/heads/main") { target { ... on Commit {
      committedDate
      all: history(first: 1) { totalCount }
      recent: history(first: 1, since: $since, until: $until) { totalCount }
    } } }
  }`).join('\n');
  return `query ProfileCards($since: GitTimestamp!, $until: GitTimestamp!) { ${repos} }`;
}

export function parseMetrics(payload, projects, now) {
  const result = new Map();
  const errored = new Set((payload.errors ?? []).map(e => e.path?.[0]).filter(Boolean));
  if (payload.errors?.some(e => !e.path?.length)) return result;
  for (const [index, project] of projects.entries()) {
    if (errored.has(`r${index}`)) continue;
    const target = payload.data?.[`r${index}`]?.ref?.target;
    const total = target?.all?.totalCount;
    const recent = target?.recent?.totalCount;
    const stamp = Date.parse(target?.committedDate);
    if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(recent) || recent < 0 || recent > total || !Number.isFinite(stamp)) continue;
    result.set(project.repo, { total, recent, lastCommit: new Date(stamp).toISOString(), fetchedAt: now });
  }
  return result;
}

export class MetricsCache {
  constructor(projects, token, fetcher = fetch, now = () => Date.now()) {
    this.projects = projects; this.token = token; this.fetcher = fetcher; this.now = now;
    this.entries = new Map(); this.inFlight = null;
    this.failure = token ? 'awaiting_first_fetch' : 'credential_missing';
  }
  snapshot() {
    const now = this.now();
    return new Map([...this.entries].filter(([, value]) => now - value.fetchedAt < TTL_MS));
  }
  refresh() {
    if (!this.token) return Promise.resolve(false);
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchOnce().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }
  async fetchOnce() {
    const now = this.now();
    try {
      const response = await this.fetcher('https://api.github.com/graphql', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': 'diogo2806-profile-cards' },
        body: JSON.stringify({ query: buildQuery(this.projects), variables: { since: new Date(now - 30 * 86400000).toISOString(), until: new Date(now).toISOString() } })
      });
      if (!response.ok) {
        this.failure = `github_http_${response.status}`;
        if (response.status === 401 || response.status === 403) this.entries.clear();
        return false;
      }
      const body = await response.text();
      if (body.length > 1000000) throw new Error('response_too_large');
      const entries = parseMetrics(JSON.parse(body), this.projects, now);
      this.entries = entries;
      this.failure = entries.size === this.projects.length ? null : 'repository_access_incomplete';
      return this.failure === null;
    } catch {
      this.failure = 'github_unavailable';
      return false;
    }
  }
  start() {
    let stopped = false;
    let timer;
    const poll = async () => {
      const ok = await this.refresh();
      if (!stopped) timer = setTimeout(poll, ok ? TTL_MS / 2 : 60000);
    };
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }
}

function card(project, metric, x, y, mobile) {
  const accent = project.rank <= 5 ? colors.accent : '#A4C8EC';
  let body = `<g transform="translate(${x} ${y})">` + rect(0, 0, 624, mobile ? 604 : 448, colors.card, 18, colors.line);
  body += rect(0, 25, 4, 54, accent, 2);
  body += text(28, 40, `${String(project.rank).padStart(2, '0')} / ${project.sector}`, 17, accent, 700);
  body += text(28, mobile ? 100 : 92, project.name, mobile ? 44 : 39, colors.text, 700);
  const size = mobile ? 33 : 25;
  wrap(project.desc, size, 560).forEach((line, i) => { body += text(28, (mobile ? 156 : 139) + i * (mobile ? 40 : 33), line, size, colors.muted); });
  const top = mobile ? 300 : 228;
  if (metric) {
    for (const [sx, value, label] of [[28, metric.total, 'Commits na main'], [318, metric.recent, 'Commits em 30 dias']]) {
      body += rect(sx, top, 278, mobile ? 94 : 80, colors.bg, 10);
      body += text(sx + 18, top + (mobile ? 42 : 36), number(value), mobile ? 40 : 33, accent, 700);
      body += text(sx + 18, top + (mobile ? 75 : 63), label, mobile ? 22 : 18, colors.muted);
    }
  } else {
    body += rect(28, top, 568, mobile ? 94 : 80, colors.bg, 10);
    body += text(46, top + (mobile ? 56 : 47), 'Estatísticas indisponíveis', mobile ? 27 : 23, colors.muted);
  }
  let px = 28;
  for (const tech of project.tech) {
    const fs = mobile ? 22 : 18;
    const tw = Math.ceil(measure(tech, fs, true)) + 26;
    body += rect(px, mobile ? 418 : 332, tw, mobile ? 36 : 30, '#203A4C', 7);
    body += text(px + 13, mobile ? 444 : 353, tech, fs, '#BBE4F1', 700);
    px += tw + 10;
  }
  if (mobile) wrap(project.focus, 24, 560).forEach((line, i) => { body += text(28, 500 + i * 29, line, 24, '#B3C3D4'); });
  else body += text(28, 403, project.focus, 18, '#B3C3D4');
  if (metric) {
    if (mobile) {
      body += text(28, 565, `Último commit: ${date(metric.lastCommit)}`, 18, '#8FA5BA');
      body += text(28, 590, `Dados: ${date(metric.fetchedAt)} ${clock(metric.fetchedAt)}`, 18, '#8FA5BA');
    } else {
      const footer = `Último commit: ${date(metric.lastCommit)} · Dados: ${date(metric.fetchedAt)} ${clock(metric.fetchedAt)}`;
      body += text(28, 429, footer, 13, '#8FA5BA');
    }
  }
  return body + '</g>';
}

export function renderRow(projects, snapshot, row, mobile = false) {
  const pair = projects.slice((row - 1) * 2, row * 2);
  if (pair.length !== 2) throw new Error('row_invalid');
  const width = mobile ? 624 : 1280;
  const height = mobile ? 1228 : 456;
  const title = pair.map(p => `${p.rank}. ${p.name}`).join(' | ');
  const desc = pair.map(p => {
    const m = snapshot.get(p.repo);
    return `${p.name}: ${p.desc} ${m ? `${m.total} commits na main; ${m.recent} nos últimos 30 dias. Último commit ${date(m.lastCommit)}. Consulta ${date(m.fetchedAt)} ${clock(m.fetchedAt)}.` : 'Estatísticas indisponíveis.'}`;
  }).join(' ');
  const body = pair.map((p, index) => card(p, snapshot.get(p.repo), mobile ? 0 : index * 656, mobile ? index * 624 : 0, mobile)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">${esc(desc)}</desc>${body}</svg>`;
}

export function createApp(projects, cache) {
  return http.createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 8192 }, (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return; }
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { res.writeHead(400); res.end(); return; }
    const snapshot = cache.snapshot();
    if (url.pathname === '/healthz' || url.pathname === '/readyz') {
      const ready = snapshot.size === projects.length;
      res.writeHead(url.pathname === '/healthz' || ready ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? '' : JSON.stringify({ ready, available: snapshot.size, projects: projects.length, configured: Boolean(cache.token) }));
      return;
    }
    const route = /^\/rows\/(0[1-8])(-mobile)?\.svg$/.exec(url.pathname);
    if (!route) { res.writeHead(404); res.end(); return; }
    const row = Number(route[1]);
    const pair = projects.slice((row - 1) * 2, row * 2);
    const ready = pair.every(p => snapshot.has(p.repo));
    const svg = renderRow(projects, snapshot, row, Boolean(route[2]));
    const etag = `"${createHash('sha256').update(svg).digest('hex')}"`;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.setHeader('Cache-Control', ready ? 'public, max-age=900, s-maxage=900, must-revalidate' : 'no-store');
    res.setHeader('ETag', etag);
    if (ready && req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
    // A imagem continua legível durante uma falha; prontidão usa /readyz.
    res.writeHead(200);
    res.end(req.method === 'HEAD' ? '' : svg);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projects = loadProjects();
  const cache = new MetricsCache(projects, process.env.GITHUB_TOKEN?.trim() ?? '');
  const stop = cache.start();
  const app = createApp(projects, cache);
  app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => console.log('profile-cards listening'));
  process.on('SIGTERM', () => { stop(); app.close(); });
  process.on('SIGINT', () => { stop(); app.close(); });
}
