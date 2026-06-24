import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { summarizeDoc, improveWriting, generateTitle, explainChanges } from "@/lib/ai/groq";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { action, content, oldContent, newContent } = body;

    if (!action) {
      return NextResponse.json({ error: "Action is required" }, { status: 400 });
    }

    let responseText = "";

    switch (action) {
      case "summarize":
        if (typeof content !== "string") {
          return NextResponse.json({ error: "Content string is required" }, { status: 400 });
        }
        responseText = await summarizeDoc(content);
        break;

      case "improve":
        if (typeof content !== "string") {
          return NextResponse.json({ error: "Content string is required" }, { status: 400 });
        }
        responseText = await improveWriting(content);
        break;

      case "title":
        if (typeof content !== "string") {
          return NextResponse.json({ error: "Content string is required" }, { status: 400 });
        }
        responseText = await generateTitle(content);
        break;

      case "change-summary":
        if (typeof oldContent !== "string" || typeof newContent !== "string") {
          return NextResponse.json({ error: "oldContent and newContent strings are required" }, { status: 400 });
        }
        responseText = await explainChanges(oldContent, newContent);
        break;

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ result: responseText });
  } catch (error) {
    console.error("AI route error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
