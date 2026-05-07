import { chat } from '@/lib/openrouter';
import { NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  const { bids, settings } = await request.json();

  if (!bids?.length) {
    return Response.json({ error: 'No bids provided' }, { status: 400 });
  }

  try {
    const results = await Promise.all(
      bids.map(async (bid: any) => {
        const prompt = `You are a bid scoring assistant for a company. Score this bid from 0-100 based on fit.

Company profile:
- Description: ${settings?.companyDescription || 'A technology consulting company'}
- Services offered: ${settings?.services || 'software development, IT consulting'}
- Preferred categories: ${settings?.preferredCategories || 'technology, IT services'}
- Keywords to avoid: ${settings?.avoidKeywords || 'none'}
${settings?.customInstructions ? `\nAdditional instructions: ${settings.customInstructions}` : ''}

Bid details:
- Name: ${bid.bidName || bid.bidNameList || bid.title}
- Number: ${bid.bidNumber || bid.bidNumberList}
- Type: ${bid.bidType || 'N/A'}
- Classification: ${bid.bidClassification || 'N/A'}
- Closing Date: ${bid.closingDateList || bid.bidClosingDate || 'N/A'}
- Categories: ${bid.categories || 'N/A'}
- Description: ${(bid.description || '').substring(0, 800) || 'N/A'}

Respond with JSON only, no markdown:
{
  "score": <integer 0-100>,
  "reason": "<2-3 sentence explanation of the score>",
  "highlights": ["<strength 1>", "<strength 2>"],
  "concerns": ["<concern 1>", "<concern 2>"]
}`;

        const text = await chat(prompt, 512);

        try {
          const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          return {
            id: bid.id,
            score: Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0))),
            reason: String(parsed.reason || ''),
            highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
            concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
          };
        } catch {
          return { id: bid.id, score: 0, reason: 'Could not parse AI response', highlights: [], concerns: [] };
        }
      })
    );

    return Response.json({ results });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
