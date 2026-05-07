import { chat } from '@/lib/openrouter';
import { NextRequest } from 'next/server';

const TYPE_LABELS: Record<string, string> = {
  proposal: 'a comprehensive proposal',
  cover_letter: 'a professional cover letter',
  technical: 'a technical approach document',
  custom: 'a supporting document',
};

export async function POST(request: NextRequest) {
  const { bid, documentType, settings, referenceProposals } = await request.json();

  const typeLabel = TYPE_LABELS[documentType] || 'a document';

  const refSection = referenceProposals?.length > 0
    ? `\nReference proposals (use these for style, structure, and tone — do not copy content verbatim):\n${
        (referenceProposals as Array<{ name: string; description?: string; contentPreview?: string }>)
          .map(p => {
            let entry = `- ${p.name}`;
            if (p.description) entry += `: ${p.description}`;
            if (p.contentPreview) entry += `\n  Content sample:\n${p.contentPreview.substring(0, 800)}`;
            return entry;
          })
          .join('\n\n')
      }\n`
    : '';

  const companyName = settings?.companyName || 'Our Company';

  const prompt = `Write ${typeLabel} responding to this government bid/RFP opportunity.

Our company information (use this verbatim — never substitute placeholders):
- Company name: ${companyName}
- About us: ${settings?.companyDescription || 'We are a technology consulting company.'}
- Services offered: ${settings?.services || 'software development, IT consulting'}
${settings?.preferredCategories ? `- Specializations: ${settings.preferredCategories}` : ''}
${settings?.customInstructions ? `- Additional context: ${settings.customInstructions}` : ''}
${refSection}
Bid opportunity:
- Title: ${bid.bidName || bid.bidNameList || bid.title}
- Number: ${bid.bidNumber || bid.bidNumberList}
- Type: ${bid.bidType || 'N/A'}
- Closing Date: ${bid.bidClosingDate || bid.closingDateList || 'N/A'}
- Submission Type: ${bid.submissionType || 'N/A'}
- Submission Address: ${bid.submissionAddress || 'N/A'}
- Description: ${(bid.description || '').substring(0, 1200) || 'N/A'}
- Categories: ${bid.categories || 'N/A'}

Write a complete, professional, and compelling document in Markdown format tailored to the requirements above.
CRITICAL: Use "${companyName}" as the company name throughout. Never write [Company Name], [Your Company], [Insert Name], or any other placeholder. All company details are provided above — use them directly.`;

  try {
    const content = await chat(prompt, 2048);
    return Response.json({ content });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
