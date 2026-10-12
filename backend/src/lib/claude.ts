import Anthropic from "@anthropic-ai/sdk";

// One shared Claude client and request helper for every AI feature
// (workout plans, golf sessions, the 3-month plan).

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
  });

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
