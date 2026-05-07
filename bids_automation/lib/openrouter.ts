const MODEL = 'anthropic/claude-sonnet-4-6';

export async function chat(prompt: string, maxTokens = 1024): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'BidOS',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error?.message || `OpenRouter error ${res.status}`);
  }

  const data = await res.json();
  return (data.choices?.[0]?.message?.content as string) || '';
}
