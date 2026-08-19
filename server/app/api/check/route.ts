import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

// LanguageTool's public API: free, no key required. Rate-limited to ~20
// requests/minute per IP and prefers modest text sizes — see
// https://languagetool.org/http-api/. Self-host LanguageTool (Docker) and
// point LANGUAGETOOL_API_URL at it to remove those limits.
const LT_API_URL = process.env.LANGUAGETOOL_API_URL || "https://api.languagetool.org/v2/check";
const LT_LANGUAGE = process.env.LANGUAGETOOL_LANGUAGE || "en-US";
const MAX_TEXT_LENGTH = 5000;

// Optional second pass: LanguageTool is rule-based and doesn't catch awkward
// or confusing sentence structure. If ANTHROPIC_API_KEY is set, Claude adds
// structure/clarity suggestions on top of LanguageTool's grammar/spelling
// results. Left unset, this pass is skipped entirely — no key, no cost.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5";

const STRUCTURE_SYSTEM_PROMPT = `You review writing for sentence-structure and clarity problems only —
NOT spelling, grammar rules, or punctuation (a separate rule-based checker already handles those).
Look for: run-on or fragmented sentences, confusing word order, unclear pronoun references,
and sentences that are needlessly hard to follow.

Return ONLY a JSON array (no prose, no markdown fences) of objects shaped like:
{"original": string, "replacement": string, "message": string}

Rules:
- "original" MUST be an exact, verbatim substring of the input text (copy it character-for-character).
- "replacement" is a clearer rewrite of that exact span.
- "message" is a short (under 15 words) explanation of what was unclear.
- Do not flag spelling, grammar, or punctuation issues — assume those are already handled elsewhere.
- If the structure is already clear, return [].
- Return at most 10 issues.`;

type Issue = {
  original: string;
  replacement: string;
  type: string;
  message: string;
};

type LanguageToolMatch = {
  message: string;
  shortMessage?: string;
  offset: number;
  length: number;
  replacements: { value: string }[];
  rule?: {
    issueType?: string;
    category?: { id?: string };
  };
};

function mapIssueType(match: LanguageToolMatch): string {
  const issueType = match.rule?.issueType?.toLowerCase();
  const categoryId = match.rule?.category?.id?.toUpperCase();

  if (issueType === "misspelling" || categoryId === "TYPOS") return "spelling";
  if (issueType === "grammar" || categoryId === "GRAMMAR" || categoryId === "CONFUSED_WORDS") return "grammar";
  if (issueType === "typographical" || categoryId === "PUNCTUATION" || categoryId === "CASING") return "punctuation";
  return "style";
}

function fetchLanguageTool(text: string) {
  return fetch(LT_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text, language: LT_LANGUAGE }),
  });
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchToIssue(text: string, match: LanguageToolMatch): Issue | null {
  const replacement = match.replacements?.[0]?.value;
  if (!replacement) return null; // nothing to apply, so not actionable in the panel

  const original = text.slice(match.offset, match.offset + match.length);
  if (!original) return null;

  return {
    original,
    replacement,
    type: mapIssueType(match),
    message: match.shortMessage || match.message,
  };
}

function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Model response did not contain a JSON array");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function isStructureIssueShape(value: unknown): value is { original: string; replacement: string; message: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.original === "string" && v.original.length > 0 && typeof v.replacement === "string" && typeof v.message === "string";
}

// Best-effort: any failure here (missing/bad key, network, rate limit) just
// means no structure suggestions this round — LanguageTool's results still
// come back normally either way.
async function checkStructure(text: string): Promise<Issue[]> {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  try {
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      system: STRUCTURE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });

    const block = response.content.find((b) => b.type === "text");
    const raw = block?.type === "text" ? block.text : "[]";
    const parsed = extractJsonArray(raw);

    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isStructureIssueShape)
      .filter((issue) => text.includes(issue.original))
      .map((issue) => ({ ...issue, type: "structure" }));
  } catch (err) {
    console.error("Structure check skipped:", err);
    return [];
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    return NextResponse.json({ error: "'text' must be a non-empty string" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: `'text' must be under ${MAX_TEXT_LENGTH} characters` }, { status: 400 });
  }

  let matches: LanguageToolMatch[];
  try {
    let res = await fetchLanguageTool(text);

    // The free public API is rate-limited (~20 req/min/IP). One retry after
    // the server's own Retry-After hint covers the common case — a burst of
    // checks during active typing — without hammering it further.
    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
      await sleep(Math.min(retryAfter ?? 5, 8) * 1000);
      res = await fetchLanguageTool(text);
    }

    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("Retry-After"));
      return NextResponse.json(
        {
          error: "rate_limited",
          message: "LanguageTool's free tier is rate-limited — try again in a few seconds.",
          retryAfter: retryAfter ?? 15,
        },
        { status: 429 }
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `LanguageTool returned ${res.status}: ${body.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const data = await res.json();
    matches = Array.isArray(data.matches) ? data.matches : [];
  } catch (err) {
    return NextResponse.json(
      { error: `LanguageTool request failed: ${String((err as Error).message || err)}` },
      { status: 502 }
    );
  }

  const languageToolIssues = matches
    .map((match) => matchToIssue(text, match))
    .filter((issue): issue is Issue => issue !== null);

  const structureIssues = await checkStructure(text);

  const issues = [...languageToolIssues, ...structureIssues].slice(0, 20);

  return NextResponse.json({ issues });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
