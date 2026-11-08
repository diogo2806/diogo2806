import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = new URL(process.argv[2] ?? 'https://invalid.local');
if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/' || base.hostname === 'invalid.local') {
  throw new Error('Informe somente a origem HTTPS pública do serviço, sem credenciais ou parâmetros.');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'README.md');
const readiness = await fetch(new URL('/readyz', base), { signal: AbortSignal.timeout(15000), redirect: 'error' });
if (!readiness.ok) throw new Error('O serviço ainda não tem acesso aos 16 projetos. README preservado.');
const status = await readiness.json();
if (status.ready !== true || status.available !== 16 || status.projects !== 16) throw new Error('Dados incompletos. README preservado.');

for (let row = 1; row <= 8; row++) {
  for (const suffix of ['', '-mobile']) {
    const url = new URL(`/rows/${String(row).padStart(2, '0')}${suffix}.svg`, base);
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/svg+xml')) throw new Error('Cartão indisponível. README preservado.');
    const svg = await response.text();
    if (!svg.includes('Commits na main') || !svg.includes('Commits em 30 dias') || svg.includes('Estatísticas indisponíveis')) throw new Error('Estatísticas incompletas. README preservado.');
  }
}

let readme = readFileSync(file, 'utf8');
const pattern = /(?:\.\/assets\/projects-(0[1-8])(-mobile)?(?:-[0-9a-f]{12})?\.svg|https:\/\/[^\s"<>]+\/rows\/(0[1-8])(-mobile)?\.svg)/g;
let count = 0;
readme = readme.replace(pattern, (_, a, b, c, d) => { count++; return new URL(`/rows/${a ?? c}${b ?? d ?? ''}.svg`, base).href; });
if (count !== 16) throw new Error(`Esperadas 16 imagens. Encontradas ${count}. README preservado.`);
const note = 'Os cartões consultam automaticamente os commits da main e a atividade dos últimos 30 dias. Os totais incluem todos os autores e automações. A atualização pode aparecer com atraso por cache; cada cartão informa a data da consulta.';
const oldNote = /Os cartões consultam automaticamente os commits da main[^\n]+\n\n/;
readme = readme.replace(oldNote, '');
readme = readme.replace(/(Os produtos estão em diferentes estágios de evolução\.\n)/, `$1\n${note}\n`);
writeFileSync(file, readme);
console.log('README atualizado após validar os 16 cartões e os dados reais dos 16 repositórios.');
