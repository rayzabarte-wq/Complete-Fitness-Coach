import Anthropic from "@anthropic-ai/sdk";

// One shared Claude client and request helper for every AI feature
// (workout plans, golf sessions, the 3-month plan).

// Tolerate the key being pasted with surrounding spaces or quote marks
// (easy to do in a hosting dashboard's variable editor), which would
// otherwise be sent as part of the key and rejected as invalid.
function cleanApiKey(raw: string | undefined): string | undefined {
  const key = raw?.trim().replace(/^["']+|["']+$/g, "").trim();
  return key || undefined;
}

const anthropic = new Anthropic({ apiKey: cleanApiKey(process.env.ANTHROPIC_API_KEY) });

const MODEL = "claude-sonnet-5";

// Claude Sonnet 5 thinks before answering by default, and that thinking
// counts toward max_tokens. The old per-call limits (500-2000) were often
// used up before the answer finished — bigger sessions like Upper/Lower
// were cut off mid-JSON. 16000 leaves ample room and still fits
// comfortably inside the SDK's non-streaming request timeout.
const MAX_TOKENS = 16000;

/** Sends a single-turn prompt and returns Claude's text answer, with clear
 * errors when the answer was cut off or declined. */
export async function askClaude(prompt: string): Promise<string> {
  let message: Anthropic.Message;
  try {
    message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error(
        "The Anthropic API key isn't valid. Check ANTHROPIC_API_KEY in the backend's settings (on Railway: backend → Variables) — it should be a key from console.anthropic.com starting with sk-ant-."
      );
    }
    throw err;
  }

  // stop_reason is compared as a string: this SDK version's types predate
  // the "refusal" value.
  const stopReason = message.stop_reason as string | null;
  if (stopReason === "max_tokens") {
    throw new Error("Claude's answer was cut off before it finished. Please try again.");
  }
  if (stopReason === "refusal") {
    throw new Error("Claude declined to answer this request. Please try again or rephrase it.");
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (!text) {
    throw new Error("No text response from Claude");
  }
  return text;
}
