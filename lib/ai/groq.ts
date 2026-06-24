import Groq from "groq-sdk";

const apiKey = process.env.GROQ_API_KEY;
const groq = apiKey ? new Groq({ apiKey }) : null;

// Llama 3.1 8B is ultra-fast, consumes minimal tokens, and has much higher rate limits on the free tier
const MODEL_NAME = "llama-3.1-8b-instant";

export async function summarizeDoc(content: string): Promise<string> {
  if (!content.trim()) return "The document is empty. Nothing to summarize.";

  if (!groq) {
    return `[Mock AI Summary]
• Key Topic: ${content.trim().slice(0, 60)}...
• Theme: Document editor setup, offline-first database caching, and conflict resolution.
• Context: Details about collaborative sync engine states and permission check models.`;
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Provide a concise, professional summary of the following document content in bullet points:\n\n${content}`,
        },
      ],
      model: MODEL_NAME,
      max_tokens: 300, // Restrict output size to save tokens
    });
    return chatCompletion.choices[0]?.message?.content || "No summary generated.";
  } catch (error: any) {
    console.error("Groq summarize error:", error);
    return `Failed to summarize document with Groq. Details: ${error.message || error}`;
  }
}

export async function improveWriting(content: string): Promise<string> {
  if (!content.trim()) return "The document is empty. Nothing to improve.";

  if (!groq) {
    return `${content.trim()}

---
[Mock AI Improved Writing]
(AI Note: Corrected spelling, sentence syntax, checked capitalization, and verified structure for clarity.)`;
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Improve the grammar, clarity, and style of the following text while keeping its original meaning. Return only the improved text:\n\n${content}`,
        },
      ],
      model: MODEL_NAME,
      max_tokens: 1000, // Safe limit for improved document copy
    });
    return chatCompletion.choices[0]?.message?.content || content;
  } catch (error: any) {
    console.error("Groq improve error:", error);
    return `Failed to improve text with Groq. Details: ${error.message || error}`;
  }
}

export async function generateTitle(content: string): Promise<string> {
  if (!content.trim()) return "Untitled Document";

  if (!groq) {
    const cleanContent = content.replace(/[#*`\n\r]/g, " ").trim();
    const words = cleanContent.split(/\s+/).slice(0, 4).join(" ");
    return words ? `${words}` : "Untitled Document";
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Generate a short, concise, and catchy title (maximum 5 words) for the following document content. Return only the title text without quotes:\n\n${content}`,
        },
      ],
      model: MODEL_NAME,
      max_tokens: 20, // Title requires very few tokens
    });
    const title = chatCompletion.choices[0]?.message?.content || "Untitled Document";
    return title.replace(/["']/g, "").trim();
  } catch (error: any) {
    console.error("Groq title error:", error);
    return "Untitled Document";
  }
}

export async function explainChanges(oldContent: string, newContent: string): Promise<string> {
  if (!groq) {
    const oldLength = oldContent.length;
    const newLength = newContent.length;
    const diff = newLength - oldLength;
    
    return `### [Mock AI Change Explanation]

#### Summary of Modifications
• The document was successfully synchronized with server-side changes.
• Length changed by ${diff >= 0 ? `+${diff}` : diff} characters.

#### Added Sections
• Server-reconciled collaborative edits merged.
• Synchronized timestamp validated.

#### Removed Sections
• Overwritten version conflicts cleaned up.

#### Updated Content
• Editor active context updated to resolve concurrent changes.`;
  }

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `You are an AI assistant helping a user review collaborative modifications. Compare the original text and the new text of a document below, and summarize what changed.
    
Original Text:
"${oldContent}"

New Text:
"${newContent}"

Provide a professional, clear response in Markdown format covering:
1. A summary of modifications
2. Added sections (bullet points)
3. Removed sections (bullet points)
4. Updated content (bullet points)`,
        },
      ],
      model: MODEL_NAME,
      max_tokens: 500, // Restrict explanation size
    });
    return chatCompletion.choices[0]?.message?.content || "No explanation generated.";
  } catch (error: any) {
    console.error("Groq change summary error:", error);
    return `Failed to explain changes. Details: ${error.message || error}`;
  }
}
