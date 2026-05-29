import { NextResponse } from "next/server";
import { spawn } from "child_process";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { source, global: isGlobal } = body as { source: string; global?: boolean };

    if (!source || typeof source !== "string") {
      return NextResponse.json(
        { error: "source is required" },
        { status: 400 }
      );
    }

    const args = ["skills", "add", source, "-y", "--agent", "claude-code"];
    if (isGlobal !== false) {
      args.splice(3, 0, "-g");
    }

    const child = spawn("npx", args, {
      env: { ...process.env },
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
