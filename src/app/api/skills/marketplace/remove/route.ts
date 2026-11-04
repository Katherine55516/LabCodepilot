import { NextResponse } from "next/server";
import { spawn } from "child_process";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { skill, global: isGlobal } = body as { skill: string; global?: boolean };

    if (!skill || typeof skill !== "string") {
      return NextResponse.json(
        { error: "skill name is required" },
        { status: 400 }
      );
    }

    const args = ["skills", "remove", skill, "-y", "--agent", "claude-code"];
    if (isGlobal !== false) {
      args.splice(3, 0, "-g");
    }

    const child = spawn("npx", args, {
      // NO_COLOR / FORCE_COLOR=0 keep the CLI output free of ANSI color codes
      // (stripAnsi on the client is the fallback).
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
            // Drop our mirror in ~/.claude/skills/ if the `skills` CLI removed
            // the source from ~/.agents/skills/ — keeps the agent's view in
            // sync with the uninstall. See src/lib/skill-reconcile.ts.
            try {
              const { invalidateSkillReconcileCache, reconcileAgentsSkillsToClaudeSkills } =
                await import("@/lib/skill-reconcile");
              invalidateSkillReconcileCache();
              reconcileAgentsSkillsToClaudeSkills();
            } catch {
              // non-fatal — startup / next /api/skills call will reconcile
            }
            send("done", "Uninstall completed successfully");
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
    console.error("[marketplace/remove] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remove failed" },
      { status: 500 }
    );
  }
}
