import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB, logAudit } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { getContentCompositions, isValidCompositionSlug } from '@/lib/content-compositions';

const MAX_TEXT = 4000;

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initDB();
  return NextResponse.json({ compositions: getContentCompositions(getDb()) });
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const body = await req.json();
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!isValidCompositionSlug(slug) || !name || name.length > 160) return NextResponse.json({ error: 'Slug atau nama composition tidak valid' }, { status: 400 });
  if (getDb().prepare('SELECT 1 FROM content_compositions WHERE slug = ?').get(slug)) return NextResponse.json({ error: 'Slug composition sudah digunakan' }, { status: 409 });
  const position = getContentCompositions(getDb()).length;
  getDb().prepare(`
    INSERT INTO content_compositions
      (slug, name, enabled, locale, post_type, hook_rule, structure_rule, cta_rule, max_length, mode, hashtag_policy, source_link_policy, prompt_text, position)
    VALUES (?, ?, 1, 'id', 'any', ?, ?, ?, 500, 'standalone', ?, ?, ?, ?)
  `).run(
    slug,
    name,
    text(body.hook_rule),
    text(body.structure_rule),
    text(body.cta_rule),
    text(body.hashtag_policy),
    text(body.source_link_policy),
    text(body.prompt_text),
    position,
  );
  logAudit('content_composition_added', `${slug} position=${position}`);
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();
  const body = await req.json();
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const current = getContentCompositions(getDb()).find(composition => composition.slug === slug);
  if (!isValidCompositionSlug(slug)) return NextResponse.json({ error: 'Slug composition tidak valid' }, { status: 400 });
  if (!current) return NextResponse.json({ error: 'Composition tidak ditemukan' }, { status: 404 });

  const next = {
    name: body.name === undefined ? current.name : text(body.name),
    enabled: body.enabled === undefined ? current.enabled : body.enabled,
    locale: body.locale === undefined ? current.locale : body.locale,
    post_type: body.post_type === undefined ? current.post_type : body.post_type,
    hook_rule: body.hook_rule === undefined ? current.hook_rule : text(body.hook_rule),
    structure_rule: body.structure_rule === undefined ? current.structure_rule : text(body.structure_rule),
    cta_rule: body.cta_rule === undefined ? current.cta_rule : text(body.cta_rule),
    max_length: body.max_length === undefined ? current.max_length : body.max_length,
    mode: body.mode === undefined ? current.mode : body.mode,
    hashtag_policy: body.hashtag_policy === undefined ? current.hashtag_policy : text(body.hashtag_policy),
    source_link_policy: body.source_link_policy === undefined ? current.source_link_policy : text(body.source_link_policy),
    prompt_text: body.prompt_text === undefined ? current.prompt_text : text(body.prompt_text),
    position: body.position === undefined ? current.position : body.position,
  };
  if (!next.name || next.name.length > 160 || typeof next.enabled !== 'boolean' || (next.locale !== 'id' && next.locale !== 'en') || !['any', 'education', 'promotion'].includes(next.post_type) || !Number.isInteger(next.max_length) || next.max_length < 1 || next.max_length > 500 || !['standalone', 'thread'].includes(next.mode) || !Number.isInteger(next.position) || next.position < 0 || [next.hook_rule, next.structure_rule, next.cta_rule, next.hashtag_policy, next.source_link_policy, next.prompt_text].some(value => value.length > MAX_TEXT)) {
    return NextResponse.json({ error: 'Konfigurasi composition tidak valid' }, { status: 400 });
  }
  getDb().prepare(`
    UPDATE content_compositions
    SET name = ?, enabled = ?, locale = ?, post_type = ?, hook_rule = ?, structure_rule = ?, cta_rule = ?, max_length = ?, mode = ?, hashtag_policy = ?, source_link_policy = ?, prompt_text = ?, position = ?
    WHERE slug = ?
  `).run(next.name, next.enabled ? 1 : 0, next.locale, next.post_type, next.hook_rule, next.structure_rule, next.cta_rule, next.max_length, next.mode, next.hashtag_policy, next.source_link_policy, next.prompt_text, next.position, slug);
  logAudit('content_composition_updated', `${slug} enabled=${next.enabled} position=${next.position}`);
  return NextResponse.json({ success: true });
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
