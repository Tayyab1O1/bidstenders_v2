import { chat } from '@/lib/openrouter';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const { bid, settings, referenceProposals, refFiles } = await request.json();

  const companyName = settings?.companyName || 'Our Company';

  const refProposalSection = referenceProposals?.length > 0
    ? `\nReference proposals (mirror their format, structure, and tone — do not copy content verbatim):\n${
        (referenceProposals as Array<{ name: string; description?: string; contentPreview?: string }>)
          .map(p => {
            let entry = `- ${p.name}`;
            if (p.description) entry += `: ${p.description}`;
            if (p.contentPreview) entry += `\n  Sample:\n${p.contentPreview.substring(0, 800)}`;
            return entry;
          })
          .join('\n\n')
      }\n`
    : '';

  const refFilesSection = refFiles?.length > 0
    ? `\nReference files attached to this bid (incorporate relevant details from these into the proposal):\n${
        (refFiles as Array<{ name: string; tags: string[]; mimeType: string }>)
          .map(f => `- ${f.name}${f.tags?.length ? ` [tags: ${f.tags.join(', ')}]` : ''}`)
          .join('\n')
      }\n`
    : '';

  const prompt = `Write a comprehensive, winning proposal responding to the following government bid/RFP opportunity.

Our company information (use verbatim — never use placeholders):
- Company name: ${companyName}
- About us: ${settings?.companyDescription || 'We are a technology consulting company.'}
- Services offered: ${settings?.services || 'software development, IT consulting'}
${settings?.preferredCategories ? `- Specializations: ${settings.preferredCategories}` : ''}
${settings?.customInstructions ? `\nSpecific instructions:\n${settings.customInstructions}` : ''}
${refProposalSection}${refFilesSection}
Bid opportunity:
- Title: ${bid.bidName || bid.bidNameList || bid.title}
- Number: ${bid.bidNumber || bid.bidNumberList}
- Type: ${bid.bidType || 'N/A'}
- Closing Date: ${bid.bidClosingDate || bid.closingDateList || 'N/A'}
- Submission Type: ${bid.submissionType || 'N/A'}
- Submission Address: ${bid.submissionAddress || 'N/A'}
- Description: ${(bid.description || '').substring(0, 1500) || 'N/A'}
- Categories: ${bid.categories || 'N/A'}

Write a complete, professional, and compelling proposal in Markdown format. Structure it like a winning government bid response with an executive summary, understanding of requirements, proposed approach, team qualifications, relevant experience, and timeline/deliverables sections. Tailor every section directly to the bid requirements above.

CRITICAL: Use "${companyName}" throughout. Never write [Company Name], [Your Company], or any placeholder. All details are provided — use them directly.`;

  try {
    const content = await chat(prompt, 8000);
    return Response.json({ content });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
