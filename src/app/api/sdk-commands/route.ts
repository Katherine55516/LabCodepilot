import { NextResponse } from "next/server";
import { enumerateSdkSlashCommands } from "@/lib/claude-client";

interface SdkCommandEntry {
  name: string;
  description: string;
  argumentHint?: string;
}

/**
 * GET /api/sdk-commands — enumerate the CLI's slash commands via a control
 * request (no model call, no tokens; see enumerateSdkSlashCommands).
 *
 * The command set only changes when the bundled CLI updates or the user
 * edits ~/.claude, so results are cached in-process. Concurrent requests
 * share one subprocess via the in-flight promise.
 */
const TTL_MS = 10 * 60_000;
let cached: { at: number; commands: SdkCommandEntry[] } | null = null;
let inflight: Promise<SdkCommandEntry[]> | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json({ commands: cached.commands });
  }

  if (!inflight) {
    inflight = enumerateSdkSlashCommands().finally(() => {
      inflight = null;
    });
  }

  try {
    const commands = await inflight;
    cached = { at: Date.now(), commands };
    return NextResponse.json({ commands });
  } catch (err) {
    // No provider configured / spawn failure — the popover falls back to the
    // filesystem scan + localStorage cache; don't cache the failure.
    return NextResponse.json(
      { commands: [], error: err instanceof Error ? err.message : String(err) },
      { status: 503 }
    );
  }
}
