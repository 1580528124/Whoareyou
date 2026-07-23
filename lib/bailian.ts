export type BailianMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type BailianUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

type BailianChatOptions = {
  model?: string;
};

type ChatCompletionChoice = {
  message?: {
    content?: string;
  };
};

type ChatCompletionResponse = {
  choices?: ChatCompletionChoice[];
  usage?: BailianUsage;
  error?: {
    message?: string;
  };
};

const RATE_LIMIT_RETRY_DELAYS = [4000, 8000];

export async function callBailianChat(
  messages: BailianMessage[],
  options: BailianChatOptions = {},
) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const baseUrl =
    process.env.BAILIAN_BASE_URL ??
    "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const model = options.model ?? process.env.BAILIAN_MODEL ?? "qwen-plus";
  const enableThinking = process.env.BAILIAN_ENABLE_THINKING === "true";

  if (!apiKey) {
    throw new Error("Missing DASHSCOPE_API_KEY in environment.");
  }

  for (let attempt = 0; attempt <= RATE_LIMIT_RETRY_DELAYS.length; attempt += 1) {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 180,
        enable_thinking: enableThinking,
      }),
    });

    const data = (await response.json()) as ChatCompletionResponse;

    if (response.ok) {
      return {
        content: data.choices?.[0]?.message?.content?.trim() ?? "",
        usage: data.usage,
        model,
      };
    }

    const message = data.error?.message ?? `Bailian request failed: ${response.status}`;
    const shouldRetry = isRateLimitError(message) && attempt < RATE_LIMIT_RETRY_DELAYS.length;

    if (!shouldRetry) {
      throw new Error(message);
    }

    await sleep(RATE_LIMIT_RETRY_DELAYS[attempt]);
  }

  throw new Error("Bailian request failed.");
}

function isRateLimitError(message: string) {
  return /rate limit|slow down|retry/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
