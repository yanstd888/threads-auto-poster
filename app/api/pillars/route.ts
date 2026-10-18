import { NextRequest, NextResponse } from 'next/server';
import { getDb, initDB, logAudit } from '@/lib/db';
import { requireAuth, requireSameOrigin } from '@/lib/auth';
import { isValidPillarSlug, isValidPillarSourcePolicy, getContentPillars, normalizeContentPillarWeights } from '@/lib/content-pillars';

export async function GET(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  initDB();
  return NextResponse.json({ pillars: getContentPillars(getDb()) });
}

export async function POST(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();

  const body = await req.json();
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!isValidPillarSlug(slug) || !name || name.length > 160) {
    return NextResponse.json({ error: 'Slug atau nama pillar tidak valid' }, { status: 400 });
  }
  const existing = getDb().prepare('SELECT 1 FROM content_pillars WHERE slug = ?').get(slug);
  if (existing) return NextResponse.json({ error: 'Slug pillar sudah digunakan' }, { status: 409 });

  const pillars = getContentPillars(getDb());
  const position = pillars.length;
  getDb().prepare(`
    INSERT INTO content_pillars
      (slug, name, enabled, weight, locale, source_policy, promo_eligible, position)
    VALUES (?, ?, 1, 1, 'id', 'any', 0, ?)
  `).run(slug, name, position);
  normalizeContentPillarWeights(getDb());
  logAudit('content_pillar_added', `${slug} position=${position}`);
  return NextResponse.json({ success: true, pillar: getContentPillars(getDb()).find(pillar => pillar.slug === slug) }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const session = requireAuth(req);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!requireSameOrigin(req)) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 403 });
  initDB();

  const body = await req.json();
  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!isValidPillarSlug(slug)) return NextResponse.json({ error: 'Slug pillar tidak valid' }, { status: 400 });
  const current = getContentPillars(getDb()).find(pillar => pillar.slug === slug);
  if (!current) return NextResponse.json({ error: 'Pillar tidak ditemukan' }, { status: 404 });

  const name = body.name === undefined ? current.name : typeof body.name === 'string' ? body.name.trim() : '';
  const enabled = body.enabled === undefined ? current.enabled : body.enabled;
  const weight = body.weight === undefined ? current.weight : body.weight;
  const locale = body.locale === undefined ? current.locale : body.locale;
  const sourcePolicy = body.source_policy === undefined ? current.source_policy : body.source_policy;
  const promoEligible = body.promo_eligible === undefined ? current.promo_eligible : body.promo_eligible;
  const position = body.position === undefined ? current.position : body.position;

  if (!name || name.length > 160 || typeof enabled !== 'boolean' || !Number.isInteger(weight) || weight < 0 || weight > 1000 || (locale !== 'id' && locale !== 'en') || !isValidPillarSourcePolicy(sourcePolicy) || typeof promoEligible !== 'boolean' || !Number.isInteger(position) || position < 0) {
    return NextResponse.json({ error: 'Konfigurasi pillar tidak valid' }, { status: 400 });
  }
  if (!enabled && current.enabled && getContentPillars(getDb(), true).length <= 1) {
    return NextResponse.json({ error: 'Minimal satu pillar harus tetap aktif' }, { status: 400 });
  }

  getDb().prepare(`
    UPDATE content_pillars
    SET name = ?, enabled = ?, weight = ?, locale = ?, source_policy = ?, promo_eligible = ?, position = ?
    WHERE slug = ?
  `).run(name, enabled ? 1 : 0, weight, locale, sourcePolicy, promoEligible ? 1 : 0, position, slug);
  normalizeContentPillarWeights(getDb());
  logAudit('content_pillar_updated', `${slug} enabled=${enabled} weight=${weight} position=${position}`);
  return NextResponse.json({ success: true, pillar: getContentPillars(getDb()).find(pillar => pillar.slug === slug) });
}
