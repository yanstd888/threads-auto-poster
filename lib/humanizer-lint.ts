import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { invokeHermesHumanizerRewrite, type HumanizerRewriteRequest } from './hermes';

export type HumanizerLintStatus = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR';

export interface HumanizerLintReport {
  status: HumanizerLintStatus;
  score: number | null;
  language: string | null;
  violations: string[];
  suppressed: number;
  version: string;
  error?: string;
}

const ANALYZER_TIMEOUT_MS = 15_000;

export function resolveHumanizerLintDir(): string {
  return process.env.HUMANIZER_LINT_DIR || path.join(os.homedir(), '.hermes', 'skills', 'creative', 'humanizer-lint');
}

export function resolveHumanizerLintScript(): string {
  return path.join(resolveHumanizerLintDir(), 'scripts', 'analyze.mjs');
}

export function resolveHumanizerLintVersion(): string {
  try {
    const packagePath = path.join(resolveHumanizerLintDir(), 'package.json');
    const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string') return parsed.version;
  } catch {}
  return 'unknown';
}

export function humanizerLintInput(text: string, replies: string[]): string {
  return [text, ...replies].map(value => value.trim()).filter(Boolean).join('\n\n');
}

export function runHumanizerLint(text: string, replies: string[], language: 'id' | 'en'): Promise<HumanizerLintReport> {
  const script = resolveHumanizerLintScript();
  const version = resolveHumanizerLintVersion();
  if (!fs.existsSync(script)) {
    return Promise.resolve({
      status: 'ERROR', score: null, language: null, violations: [], suppressed: 0, version,
      error: `humanizer-lint analyzer tidak ditemukan: ${script}`,
    });
  }

  return new Promise(resolve => {
    const child = spawn(process.execPath, [
      script,
      '--stdin',
      '--stdin-filename', 'threads-post.txt',
      '--lang', language,
      '--domain', 'prose',
      '--no-ignore',
      '--json',
    ], {
      cwd: resolveHumanizerLintDir(),
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (report: HumanizerLintReport) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(report);
    };
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ status: 'ERROR', score: null, language: null, violations: [], suppressed: 0, version, error: 'humanizer-lint timeout' });
    }, ANALYZER_TIMEOUT_MS);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => finish({
      status: 'ERROR', score: null, language: null, violations: [], suppressed: 0, version,
      error: `humanizer-lint process error: ${error.message}`,
    }));
    child.on('close', code => {
      if (settled) return;
      try {
        const start = stdout.indexOf('{');
        const end = stdout.lastIndexOf('}');
        if (start < 0 || end <= start) throw new Error('JSON report tidak ditemukan');
        const parsed: unknown = JSON.parse(stdout.slice(start, end + 1));
        if (!isRecord(parsed)) throw new Error('format report tidak valid');
        const rawStatus = String(parsed.status || '');
        if (!['PASS', 'FAIL', 'SKIP'].includes(rawStatus)) throw new Error('status report tidak valid');
        const rawViolations = Array.isArray(parsed.violations) ? parsed.violations : [];
        const violations = rawViolations.map(formatViolation).filter(Boolean).slice(0, 12);
        const suppressed = Array.isArray(parsed.suppressed)
          ? parsed.suppressed.length
          : typeof parsed.suppressed === 'number' ? parsed.suppressed : 0;
        finish({
          status: rawStatus as Exclude<HumanizerLintStatus, 'ERROR'>,
          score: typeof parsed.score === 'number' ? parsed.score : null,
          language: typeof parsed.language === 'string' ? parsed.language : null,
          violations,
          suppressed,
          version,
        });
      } catch (error: unknown) {
        finish({
          status: 'ERROR', score: null, language: null, violations: [], suppressed: 0, version,
          error: `humanizer-lint ${code === 0 ? 'report' : `exit ${code ?? 'unknown'}`}: ${error instanceof Error ? error.message : String(error)}${stderr.trim() ? `: ${stderr.trim().slice(0, 300)}` : ''}`,
        });
      }
    });
    child.stdin.end(humanizerLintInput(text, replies));
  });
}

export function humanizerLintPassed(report: HumanizerLintReport): boolean {
  // ponytail: trust the analyzer's own verdict. It emits PASS with advisory findings
  // still listed in `violations` (diagnostics/prioritized fixes, not failures), so
  // requiring an empty list here would block every post forever.
  return report.status === 'PASS';
}

export interface HumanizerPost {
  text: string;
  replies: string[];
}

export interface HumanizePostResult extends HumanizerPost {
  report: HumanizerLintReport;
  rewrites: number;
  error?: string;
}

type NormalizeHumanizerPost = (post: HumanizerPost) => HumanizerPost;

export async function rewriteUntilHuman(
  request: HumanizerRewriteRequest,
  normalize: NormalizeHumanizerPost = post => post,
): Promise<HumanizePostResult> {
  const requiredUrls = extractHttpsUrls(humanizerLintInput(request.text, request.replies));
  let current = normalize({ text: request.text, replies: request.replies });
  let lastReport: HumanizerLintReport = {
    status: 'ERROR', score: null, language: null, violations: [], suppressed: 0,
    version: resolveHumanizerLintVersion(), error: 'humanizer-lint belum dijalankan',
  };

  for (let pass = 0; pass < 3; pass += 1) {
    const report = await runHumanizerLint(current.text, current.replies, request.language);
    lastReport = report;
    if (report.status === 'ERROR') return { ...current, report, rewrites: pass, error: report.error || 'humanizer-lint gagal' };
    if (humanizerLintPassed(report)) return { ...current, report, rewrites: pass };
    if (pass === 2) {
      return { ...current, report, rewrites: pass, error: `humanizer-lint tetap FAIL setelah ${pass} rewrite` };
    }

    const rewritten = await invokeHermesHumanizerRewrite({
      ...request,
      text: current.text,
      replies: current.replies,
      findings: report.violations,
    });
    if (rewritten.error || !rewritten.text.trim()) {
      return { ...current, report, rewrites: pass, error: rewritten.error || 'humanizer rewrite menghasilkan teks kosong' };
    }
    const next = normalize({ text: rewritten.text, replies: rewritten.replies });
    if (!next.text.trim()) return { ...current, report, rewrites: pass, error: 'humanizer rewrite menghasilkan post kosong' };
    if (!requiredUrls.every(url => extractHttpsUrls(humanizerLintInput(next.text, next.replies)).includes(url))) {
      return { ...current, report, rewrites: pass, error: 'humanizer rewrite menghapus URL sumber dari draft' };
    }
    current = next;
  }

  return { ...current, report: lastReport, rewrites: 3, error: 'humanizer rewrite tidak selesai' };
}

function extractHttpsUrls(value: string): string[] {
  return [...new Set((value.match(/https:\/\/[^\\s<>()]+/gi) || []).map(url => url.replace(/[.,!?]+$/g, '')))];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatViolation(value: unknown): string {
  if (!isRecord(value)) return typeof value === 'string' ? value : '';
  const type = typeof value.type === 'string' ? value.type : 'finding';
  const location = typeof value.location === 'string' ? ` @ ${value.location}` : '';
  const instruction = typeof value.fixInstruction === 'string'
    ? value.fixInstruction
    : typeof value.suggestedReplacement === 'string' ? `ganti dengan: ${value.suggestedReplacement}` : 'revisi temuan ini secara natural';
  return `${type}${location}: ${instruction}`.slice(0, 400);
}
