import { chat } from '@/lib/openrouter';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const { selectedText, instructions, bid, settings } = await request.json();

  const companyName = settings?.companyName || '';

  const prompt = `You are editing a specific section of a professional proposal document.

${companyName ? `Company name: "${companyName}" — use this verbatim, never use placeholders.\n` : ''}
Bid context:
- Title: ${bid?.bidName || bid?.bidNameList || bid?.title || 'N/A'}

Section to refine:
---
${selectedText}
---

Instruction: ${instructions}

Return ONLY the refined replacement text for this section. Do not include any explanation, introduction, or surrounding context — just the improved version of the section above, ready to be inserted directly back into the document. Match the original formatting style (markdown).`;

  try {
    const refined = await chat(prompt, 800);
    return Response.json({ refinedText: refined });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
