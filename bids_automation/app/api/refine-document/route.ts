import { chat } from '@/lib/openrouter';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const { content, instructions, bid, settings, refFiles } = await request.json();

  const companyName = settings?.companyName || '';
  const companyContext = (settings?.companyName || settings?.companyDescription || settings?.services)
    ? `Company context (use "${companyName || 'our company'}" as the company name — never use placeholders):\n${companyName ? `- Company name: ${companyName}` : ''}\n${settings?.companyDescription ? `- About us: ${settings.companyDescription}` : ''}\n${settings?.services ? `- Services: ${settings.services}` : ''}\n`
    : '';

  const refFilesSection = refFiles?.length > 0
    ? `\nReference files available for this bid:\n${
        (refFiles as Array<{ name: string; tags: string[] }>)
          .map(f => `- ${f.name}${f.tags?.length ? ` [${f.tags.join(', ')}]` : ''}`)
          .join('\n')
      }\n`
    : '';

  const prompt = `Refine the following proposal based on the instructions provided.

${companyContext}${refFilesSection}
Current proposal:
---
${content}
---

Bid context:
- Title: ${bid?.bidName || bid?.bidNameList || bid?.title || 'N/A'}
- Description: ${(bid?.description || '').substring(0, 600) || 'N/A'}

Refinement instructions: ${instructions}

Return the complete refined proposal in Markdown format. Apply the requested changes while keeping the overall professional structure intact. Do not add commentary about what you changed.`;

  try {
    const refined = await chat(prompt, 8000);
    return Response.json({ content: refined });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
