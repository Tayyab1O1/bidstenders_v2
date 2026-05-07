import { chat } from '@/lib/openrouter';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const { content, instructions, bid } = await request.json();

  const prompt = `Refine the following bid document based on the instructions provided.

Current document:
---
${content}
---

Bid context:
- Title: ${bid?.bidName || bid?.bidNameList || bid?.title || 'N/A'}
- Description: ${(bid?.description || '').substring(0, 400) || 'N/A'}

Refinement instructions: ${instructions}

Return the complete refined document in Markdown format. Keep the overall structure intact while applying the requested changes. Do not add commentary about what you changed.`;

  try {
    const refined = await chat(prompt, 2048);
    return Response.json({ content: refined });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
