import { NextRequest } from 'next/server';
// @ts-ignore — html-to-docx has no official types
import HTMLtoDOCX from 'html-to-docx';
import { marked } from 'marked';

export async function POST(request: NextRequest) {
  const { content, title } = await request.json();

  const bodyHtml = String(marked.parse(content || ''));
  const fullHtml = `<!DOCTYPE html><html><body>${bodyHtml}</body></html>`;

  const filename = (title || 'proposal')
    .replace(/[^a-z0-9\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '_') || 'proposal';

  try {
    const buffer = await HTMLtoDOCX(fullHtml, null, {
      table: { row: { cantSplit: true } },
      footer: false,
      pageNumber: false,
    });

    return new Response(Buffer.from(buffer as ArrayBuffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${filename}.docx"`,
      },
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
