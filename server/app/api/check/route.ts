import { NextRequest, NextResponse } from "next/server";

// LanguageTool's public API: free, no key required. Rate-limited to ~20
// requests/minute per IP and prefers modest text sizes — see
// https://languagetool.org/http-api/. Self-host LanguageTool (Docker) and
// point LANGUAGETOOL_API_URL at it to remove those limits.
const LT_API_URL = process.env.LANGUAGETOOL_API_URL || "https://api.languagetool.org/v2/check";
const LT_LANGUAGE = process.env.LANGUAGETOOL_LANGUAGE || "en-US";
const MAX_TEXT_LENGTH = 5000;

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
    const res = await fetch(LT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ text, language: LT_LANGUAGE }),
    });

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

  const issues = matches
    .map((match) => matchToIssue(text, match))
    .filter((issue): issue is Issue => issue !== null)
    .slice(0, 20);

  return NextResponse.json({ issues });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
