import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";

const MAX_TEXT_LENGTH = 8000;
const MODEL = process.env.GRAMMAR_MODEL || "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You are a grammar, spelling, punctuation, and style checker.
Given a piece of writing, find issues and return ONLY a JSON array (no prose, no markdown fences) of objects shaped like:

{"original": string, "replacement": string, "type": "grammar" | "spelling" | "punctuation" | "clarity" | "style", "message": string}

Rules:
- "original" MUST be an exact, verbatim substring of the input text (copy it character-for-character), long enough to be unambiguous but as short as possible — usually a few words, not a whole sentence.
- "replacement" is the corrected text that should replace "original".
- "message" is a short (under 15 words) explanation of the issue.
- Do not flag stylistic choices that are already correct. Do not invent issues.
- If the text has no issues, return [].
- Return at most 20 issues, ordered by how much they matter.`;

type Issue = {
  original: string;
  replacement: string;
  type: string;
  message: string;
};

function extractJsonArray(raw: string): unknown {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Model response did not contain a JSON array");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

function isValidIssue(value: unknown): value is Issue {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.original === "string" &&
    v.original.length > 0 &&
    typeof v.replacement === "string" &&
    typeof v.type === "string" &&
    typeof v.message === "string"
  );
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Server is missing ANTHROPIC_API_KEY" }, { status: 500 });
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let raw: string;
  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: text }],
    });
    const block = message.content[0];
    raw = block?.type === "text" ? block.text : "[]";
  } catch (err) {
    return NextResponse.json({ error: `Model request failed: ${String((err as Error).message || err)}` }, { status: 502 });
  }

  let parsed: unknown;
  try {
    parsed = extractJsonArray(raw);
  } catch {
    return NextResponse.json({ error: "Model returned unparseable output" }, { status: 502 });
  }

  const issues = Array.isArray(parsed)
    ? parsed.filter(isValidIssue).filter((issue) => text.includes(issue.original))
    : [];

  return NextResponse.json({ issues });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204 });
}
