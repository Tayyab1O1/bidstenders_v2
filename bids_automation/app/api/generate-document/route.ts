import { chat } from '@/lib/openrouter';
import { NextRequest } from 'next/server';

const TYPE_LABELS: Record<string, string> = {
  proposal: 'a comprehensive proposal',
  cover_letter: 'a professional cover letter',
  technical: 'a technical approach document',
  custom: 'a supporting document',
};

export async function POST(request: NextRequest) {
  const { bid, documentType, settings } = await request.json();

  const typeLabel = TYPE_LABELS[documentType] || 'a document';

  const prompt = `Write ${typeLabel} responding to this government bid/RFP opportunity.

Company profile:
${settings?.companyDescription || 'We are a technology consulting company.'}
Services: ${settings?.services || 'software development, IT consulting'}
${settings?.customInstructions ? `Additional context: ${settings.customInstructions}` : ''}

Bid opportunity:
- Title: ${bid.bidName || bid.bidNameList || bid.title}
- Number: ${bid.bidNumber || bid.bidNumberList}
- Type: ${bid.bidType || 'N/A'}
- Closing Date: ${bid.bidClosingDate || bid.closingDateList || 'N/A'}
- Submission Type: ${bid.submissionType || 'N/A'}
- Submission Address: ${bid.submissionAddress || 'N/A'}
- Description: ${(bid.description || '').substring(0, 1200) || 'N/A'}
- Categories: ${bid.categories || 'N/A'}

Write a complete, professional, and compelling document in Markdown format. Be specific and tailored to the requirements. Do not use placeholder text.`;

  try {
    const content = await chat(prompt, 2048);
    return Response.json({ content });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
