import { NextRequest, NextResponse } from "next/server";
import { getProvidersBySource, getModelsForProvider } from "@/lib/db";
import { generateTextViaSdk } from "@/lib/claude-client";
import {
  buildTranslateSystemPrompt,
  buildTranslateUserPrompt,
  pickFirstManagedModel,
  truncateForTranslate,
  truncationNotice,
} from "@/lib/skill-translate";

/**
 * POST /api/skills/marketplace/translate — translate a marketplace skill's
 * README into the app locale using the FIRST account-delivered (managed)
 * provider's primary model.
 *
 * Single-turn generateTextViaSdk call — no session/agent loop/tools. The SDK
 * subprocess path is deliberate: managed model ids can be CLI aliases (e.g.
 * claude-opus-4-7[1m]) that direct @ai-sdk calls 503 on. Credentials stay
 * server-side. Design: docs/exec-plans/active/marketplace-skill-translate.md
 */
export async function POST(req: NextRequest) {
  let body: { content?: unknown; targetLocale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content : "";
  const targetLocale = typeof body.targetLocale === "string" ? body.targetLocale : "";
  const system = buildTranslateSystemPrompt(targetLocale);
  if (!content.trim() || !system) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const pick = pickFirstManagedModel(getProvidersBySource("managed"), (id) => {
    try {
      return getModelsForProvider(id);
    } catch {
      return []; // provider_models table may not exist in old DBs
    }
  });
  if (!pick) {
    return NextResponse.json({ error: "no_managed_provider" }, { status: 409 });
  }

  const { content: clipped, truncated } = truncateForTranslate(content);
  // Sandwich structure — task framing brackets the untrusted document in the
  // user turn (system prompt alone loses to instruction-shaped READMEs).
  const userPrompt = buildTranslateUserPrompt(clipped, targetLocale)!;

  try {
    const translated = await generateTextViaSdk({
      providerId: pick.providerId,
      model: pick.model,
      system,
      prompt: userPrompt,
    });
    const final = truncated
      ? `${translated}\n\n${truncationNotice(targetLocale)}`
      : translated;
    return NextResponse.json({ translated: final });
  } catch (err) {
    console.error("[skill-translate] SDK call failed:", err);
    return NextResponse.json(
      {
        error: "translate_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
