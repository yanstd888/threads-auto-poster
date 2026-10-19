import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const index = await readFile(resolve(root, 'site/index.html'), 'utf8');
for (const value of ['lang="id"', 'data-lang="id"', 'data-lang="en"', 'application/ld+json', 'dashboard-preview.png']) assert.ok(index.includes(value), `missing ${value}`);
for (const file of ['site/styles.css', 'site/app.js', 'site/robots.txt', 'site/sitemap.xml', 'site/assets/dashboard-preview.png']) await access(resolve(root, file), constants.R_OK);
console.log('PASS project site assets, bilingual copy, and SEO metadata');
