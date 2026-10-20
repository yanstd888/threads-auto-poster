import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'site');
const output = resolve(root, '.pages');
const template = await readFile(resolve(source, 'index.html'), 'utf8');

const SITE_URL = 'https://yanstd888.github.io/threads-auto-poster/';

function page(language) {
  const other = language === 'id' ? 'en' : 'id';
  const pageUrl = language === 'id' ? SITE_URL : `${SITE_URL}en/`;
  const description = language === 'id'
    ? 'Threads Auto Poster adalah scheduler Threads self-hosted dengan riset sumber, draft berbantuan AI, quality gate, dan approval sebelum publikasi.'
    : 'Threads Auto Poster is a self-hosted Threads scheduler with source research, AI-assisted drafts, quality gates, and approval before publishing.';
  let html = template.replace(new RegExp(String.raw`<([a-z0-9]+)([^>]*\sdata-lang="${other}"[^>]*)>[\s\S]*?<\/\1>`, 'gi'), '');
  html = html.replace('lang="id"', `lang="${language}"`);
  html = html.replace('data-active="id"', `data-active="${language}"`);
  html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`);
  html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${pageUrl}$2`);
  html = html.replace(/(<meta property="og:locale" content=")[^"]*(")/, `$1${language === 'id' ? 'id_ID' : 'en_US'}$2`);
  html = html.replace(/(<meta property="og:locale:alternate" content=")[^"]*(")/, `$1${language === 'id' ? 'en_US' : 'id_ID'}$2`);
  html = html.replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${pageUrl}$2`);
  html = html.replace(/(<link rel="alternate" hreflang="en" href=")[^"]*(")/, `$1${SITE_URL}en/$2`);
  html = html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/, (_match, open, raw, close) => {
    const schema = JSON.parse(raw);
    for (const item of schema['@graph'] ?? []) {
      if (item['@id']) item['@id'] = item['@id'].replace(SITE_URL, pageUrl);
      if (item.url) item.url = item.url.replace(SITE_URL, pageUrl);
      if (item.inLanguage) item.inLanguage = language;
    }
    return `${open}${JSON.stringify(schema)}${close}`;
  });
  if (language === 'en') {
    // ponytail: keep one asset tree; only the generated page URL and relative paths differ.
    html = html.replaceAll('./styles.css', '../styles.css').replaceAll('./assets/', '../assets/').replaceAll('./app.js', '../app.js');
  }
  return html;
}

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
await mkdir(resolve(output, 'en'), { recursive: true });
await writeFile(resolve(output, 'index.html'), page('id'));
await writeFile(resolve(output, 'en', 'index.html'), page('en'));
console.log('PASS built static ID and EN project pages');
