import { NextResponse } from "next/server";
import { spawn } from "child_process";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source, skill, global: isGlobal } = body as {
      source: string;
      skill?: string;
      global?: boolean;
    };

    if (!source || typeof source !== "string") {
      return NextResponse.json(
        { error: "source is required" },
        { status: 400 }
      );
    }

    // Install ONLY the selected skill — not the whole repo. Run
    // non-interactively with `-y`, the `skills` CLI installs every skill in the
    // source when no `-s` is given (a monorepo like anthropics/skills ships ~18
    // skills), which is not what the user expects after clicking Install on a
    // single card. The skill id is the repo folder name (e.g. "xlsx") — the
    // same value `skills add <repo> --list` prints and the lock file is keyed
    // by. Sources without a specific skill fall back to the previous behavior.
    const args = ["skills", "add", source];
    if (isGlobal !== false) {
      args.push("-g");
    }
    if (skill && typeof skill === "string") {
      args.push("-s", skill);
    }
    args.push("-y", "--agent", "claude-code");

    const child = spawn("npx", args, {
      // NO_COLOR / FORCE_COLOR=0 ask the CLI not to emit ANSI color codes, so
      // the streamed output renders cleanly in the HTML dialog (stripAnsi on the
      // client is the belt-and-suspenders fallback).
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      shell: true,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: string) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        child.stdout?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.on("close", async (code) => {
          if (code === 0) {
            // The `skills` CLI may land the skill in the agent-neutral
            // ~/.agents/skills/ location, which the bundled Claude Code binary
            // can't load. Mirror it into ~/.claude/skills/ now so the freshly
            // installed skill is usable in the agent without an app restart.
            try {
              const { invalidateSkillReconcileCache, reconcileAgentsSkillsToClaudeSkills } =
                await import("@/lib/skill-reconcile");
              invalidateSkillReconcileCache();
              reconcileAgentsSkillsToClaudeSkills();
            } catch {
              // non-fatal — startup / next /api/skills call will reconcile
            }
            send("done", "Install completed successfully");
          } else {
            send("error", `Process exited with code ${code}`);
          }
          controller.close();
        });

        child.on("error", (err) => {
          send("error", err.message);
          controller.close();
        });
      },
      cancel() {
        child.kill();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[marketplace/install] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Install failed" },
      { status: 500 }
    );
  }
}
