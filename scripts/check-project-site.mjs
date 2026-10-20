import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const index = await readFile(resolve(root, 'site/index.html'), 'utf8');
for (const value of [
  'lang="id"',
  'data-lang="id"',
  'data-lang="en"',
  'application/ld+json',
  'https://yanstd888.github.io/threads-auto-poster/assets/dashboard-preview.png',
  'og:url',
  'twitter:title',
]) assert.ok(index.includes(value), `missing ${value}`);
assert.ok(!index.includes('hreflang="en" href="https://yanstd888.github.io/threads-auto-poster/?lang=en"'), 'hreflang must use the static English URL');
const schemaMatch = index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert.ok(schemaMatch, 'missing JSON-LD');
const schema = JSON.parse(schemaMatch[1]);
assert.equal(schema['@context'], 'https://schema.org');
assert.ok(schema['@graph'].some(item => item['@type'] === 'WebSite'));
assert.ok(schema['@graph'].some(item => item['@type'] === 'SoftwareApplication'));
for (const file of ['site/styles.css', 'site/app.js', 'site/robots.txt', 'site/sitemap.xml', 'site/assets/dashboard-preview.png']) await access(resolve(root, file), constants.R_OK);
const sitemap = await readFile(resolve(root, 'site/sitemap.xml'), 'utf8');
assert.ok(sitemap.includes('xmlns:xhtml='), 'sitemap must declare hreflang namespace');
assert.equal((sitemap.match(/<loc>/g) ?? []).length, 2, 'sitemap must contain ID and EN URLs');
const en = await readFile(resolve(root, '.pages/en/index.html'), 'utf8');
for (const value of [
  'lang="en"',
  'content="Threads Auto Poster is a self-hosted Threads scheduler',
  'href="https://yanstd888.github.io/threads-auto-poster/en/"',
  'hreflang="id" href="https://yanstd888.github.io/threads-auto-poster/"',
  '../styles.css',
  '../assets/dashboard-preview.png',
  '../app.js',
]) assert.ok(en.includes(value), `missing English SEO/path value ${value}`);
assert.ok(!en.includes('src="./assets/dashboard-preview.png"'), 'English page must not point at a nonexistent nested asset');
const enSchemaMatch = en.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
assert.ok(enSchemaMatch, 'missing English JSON-LD');
const enSchema = JSON.parse(enSchemaMatch[1]);
assert.equal(enSchema['@graph'].find(item => item['@type'] === 'WebSite').inLanguage, 'en');
console.log('PASS project site assets, bilingual SEO metadata, hreflang, sitemap, and JSON-LD');
