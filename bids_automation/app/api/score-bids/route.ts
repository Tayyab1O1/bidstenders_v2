import { chat } from '@/lib/openrouter';
import { NextRequest } from 'next/server';

function parseClosingDate(str: string): Date | null {
  if (!str || str === 'N/A') return null;

  // Strip parenthetical timezone abbreviations: (ADT), (EST), (UTC), etc.
  const cleaned = str.replace(/\([^)]*\)/g, '').trim();

  // "Fri May 8, 2026 ..." or "May 8, 2026" — extract Month Day, Year
  const mdy = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (mdy) {
    const d = new Date(`${mdy[1]} ${mdy[2]}, ${mdy[3]}`);
    if (!isNaN(d.getTime())) return d;
  }

  // ISO: 2026-05-08
  const iso = cleaned.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) {
    const d = new Date(iso[1]);
    if (!isNaN(d.getTime())) return d;
  }

  // DD/MM/YYYY or MM/DD/YYYY — try both
  const slash = cleaned.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const d = new Date(`${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`);
    if (!isNaN(d.getTime())) return d;
  }

  return null;
}

function isClosingImminent(closingDateStr: string): boolean {
  const parsed = parseClosingDate(closingDateStr);
  if (!parsed) return false;

  // Normalise both to midnight for day-level comparison
  const closingDay = new Date(parsed);
  closingDay.setHours(0, 0, 0, 0);

  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  return closingDay <= tomorrow; // today, tomorrow, or already past → imminent
}

export async function POST(request: NextRequest) {
  const { bids, settings } = await request.json();

  if (!bids?.length) {
    return Response.json({ error: 'No bids provided' }, { status: 400 });
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD for prompt context

  try {
    const results = await Promise.all(
      bids.map(async (bid: any) => {
        const closingDate = bid.closingDateList || bid.bidClosingDate || '';

        // Hard rule: expired or closing within 1 day → score 0, skip AI
        if (isClosingImminent(closingDate)) {
          return {
            id: bid.id,
            score: 0,
            reason: `Bid closes on ${closingDate || 'an imminent date'}, which is today or within 1 day. Not worth pursuing.`,
            highlights: [],
            concerns: ['Closing date has passed or is within 24 hours'],
          };
        }

        const prompt = `You are a bid scoring assistant. Today's date is ${today}. Score this bid from 0–100 based on fit for the company.

Company profile:
- Name: ${settings?.companyName || 'Our company'}
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
- Closing Date: ${closingDate || 'N/A'}
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
