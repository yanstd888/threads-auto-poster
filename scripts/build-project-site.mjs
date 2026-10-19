import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'site');
const output = resolve(root, '.pages');
const template = await readFile(resolve(source, 'index.html'), 'utf8');

function page(language) {
  const other = language === 'id' ? 'en' : 'id';
  let html = template.replace(new RegExp(`<([a-z0-9]+)([^>]*\\sdata-lang="${other}"[^>]*)>[\\s\\S]*?<\\/\\1>`, 'gi'), '');
  html = html.replace('lang="id"', `lang="${language}"`);
  html = html.replace('data-active="id"', `data-active="${language}"`);
  if (language === 'en') {
    html = html.replace('Threads Auto Poster — Self-hosted Threads scheduler</title>', 'Threads Auto Poster — Self-hosted Threads scheduler</title>');
    html = html.replace('content="Threads Auto Poster adalah scheduler Threads self-hosted dengan riset sumber, draft berbantuan AI, quality gate, dan approval sebelum publikasi."', 'content="Threads Auto Poster is a self-hosted Threads scheduler with source research, AI-assisted drafts, quality gates, and approval before publishing."');
    html = html.replace('href="https://yanstd888.github.io/threads-auto-poster/"', 'href="https://yanstd888.github.io/threads-auto-poster/en/"');
  }
  return html;
}

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
await mkdir(resolve(output, 'en'), { recursive: true });
await writeFile(resolve(output, 'index.html'), page('id'));
await writeFile(resolve(output, 'en', 'index.html'), page('en'));
console.log('PASS built static ID and EN project pages');
