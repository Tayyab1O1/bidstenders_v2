'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { marked } from 'marked';
import TurndownService from 'turndown';

const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced' });

function Divider() {
  return <span className="w-px h-5 bg-slate-200 mx-1 shrink-0" />;
}

function Btn({
  onClick, active, title, children, disabled,
}: {
  onClick: () => void; active?: boolean; title: string; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onMouseDown={e => { e.preventDefault(); onClick(); }}
      title={title}
      disabled={disabled}
      className={`inline-flex items-center justify-center px-2 py-1 rounded text-xs font-medium transition-colors min-w-[28px] ${
        active
          ? 'bg-indigo-600 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      } disabled:opacity-30`}
    >
      {children}
    </button>
  );
}

interface Props {
  content: string;
  onChange: (markdown: string) => void;
}

export default function RichEditor({ content, onChange }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: String(marked.parse(content)),
    onUpdate: ({ editor }) => {
      onChange(td.turndown(editor.getHTML()));
    },
    editorProps: {
      attributes: {
        class: 'rich-editor-content focus:outline-none',
      },
    },
  });

  if (!editor) return null;

  const can = editor.can();

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-100" style={{ minHeight: 0 }}>

      {/* Word-style toolbar */}
      <div className="flex items-center gap-0.5 px-3 py-2 bg-white border-b border-slate-200 flex-wrap shrink-0 shadow-sm">

        {/* Heading / paragraph style */}
        <select
          value={
            editor.isActive('heading', { level: 1 }) ? 'h1'
            : editor.isActive('heading', { level: 2 }) ? 'h2'
            : editor.isActive('heading', { level: 3 }) ? 'h3'
            : 'p'
          }
          onChange={e => {
            const v = e.target.value;
            if (v === 'p') editor.chain().focus().setParagraph().run();
            else editor.chain().focus().toggleHeading({ level: Number(v[1]) as 1|2|3 }).run();
          }}
          className="text-xs border border-slate-200 rounded px-1.5 py-1 text-slate-700 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400 mr-1"
        >
          <option value="p">Paragraph</option>
          <option value="h1">Heading 1</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
        </select>

        <Divider />

        {/* Inline formatting */}
        <Btn active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)">
          <strong>B</strong>
        </Btn>
        <Btn active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)">
          <em>I</em>
        </Btn>
        <Btn active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (Ctrl+U)">
          <span style={{ textDecoration: 'underline' }}>U</span>
        </Btn>
        <Btn active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough">
          <span style={{ textDecoration: 'line-through' }}>S</span>
        </Btn>
        <Btn active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="Inline code">
          <code className="font-mono">{`</>`}</code>
        </Btn>

        <Divider />

        {/* Text alignment */}
        <Btn active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Align left">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h12" /></svg>
        </Btn>
        <Btn active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Center">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M6 18h12" /></svg>
        </Btn>
        <Btn active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Align right">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M10 12h10M8 18h12" /></svg>
        </Btn>

        <Divider />

        {/* Lists */}
        <Btn active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /><circle cx="1.5" cy="6" r="1" fill="currentColor" /><circle cx="1.5" cy="12" r="1" fill="currentColor" /><circle cx="1.5" cy="18" r="1" fill="currentColor" /></svg>
        </Btn>
        <Btn active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6h11M10 12h11M10 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>
        </Btn>
        <Btn active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Blockquote">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
        </Btn>
        <Btn active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>
        </Btn>

        <Divider />

        {/* Undo / Redo */}
        <Btn disabled={!can.undo()} onClick={() => editor.chain().focus().undo().run()} title="Undo (Ctrl+Z)">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
        </Btn>
        <Btn disabled={!can.redo()} onClick={() => editor.chain().focus().redo().run()} title="Redo (Ctrl+Y)">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2m18-10l-6 6m6-6l-6-6" /></svg>
        </Btn>

      </div>

      {/* Paper document area */}
      <div className="flex-1 overflow-y-auto px-6 py-6" style={{ minHeight: 0 }}>
        <div className="max-w-3xl mx-auto bg-white shadow-md rounded-lg px-12 py-10 min-h-full">
          <style>{`
            .rich-editor-content { min-height: 500px; }
            .rich-editor-content h1 { font-size: 1.6rem; font-weight: 700; color: #0f172a; margin-top: 1.5rem; margin-bottom: 0.75rem; padding-bottom: 0.5rem; border-bottom: 2px solid #e2e8f0; line-height: 1.3; }
            .rich-editor-content h2 { font-size: 1.25rem; font-weight: 700; color: #1e293b; margin-top: 1.4rem; margin-bottom: 0.5rem; line-height: 1.35; }
            .rich-editor-content h3 { font-size: 1.05rem; font-weight: 600; color: #1e293b; margin-top: 1.1rem; margin-bottom: 0.4rem; }
            .rich-editor-content p { font-size: 0.925rem; color: #374151; margin-bottom: 0.85rem; line-height: 1.75; }
            .rich-editor-content strong { font-weight: 600; color: #111827; }
            .rich-editor-content em { font-style: italic; color: #374151; }
            .rich-editor-content u { text-decoration: underline; }
            .rich-editor-content s { text-decoration: line-through; }
            .rich-editor-content ul { list-style-type: disc; padding-left: 1.5rem; margin-bottom: 0.85rem; }
            .rich-editor-content ol { list-style-type: decimal; padding-left: 1.5rem; margin-bottom: 0.85rem; }
            .rich-editor-content li { font-size: 0.925rem; color: #374151; line-height: 1.7; margin-bottom: 0.2rem; }
            .rich-editor-content blockquote { border-left: 4px solid #818cf8; padding: 0.25rem 0 0.25rem 1rem; margin: 1rem 0; background: #f5f3ff; border-radius: 0 6px 6px 0; font-style: italic; color: #4b5563; }
            .rich-editor-content blockquote p { margin-bottom: 0; }
            .rich-editor-content code { background: #f1f5f9; padding: 0.15rem 0.35rem; border-radius: 4px; font-size: 0.8rem; font-family: monospace; color: #4f46e5; }
            .rich-editor-content pre { background: #1e293b; color: #e2e8f0; padding: 1rem; border-radius: 8px; font-size: 0.8rem; overflow-x: auto; margin-bottom: 1rem; line-height: 1.6; }
            .rich-editor-content pre code { background: none; padding: 0; color: inherit; }
            .rich-editor-content hr { border: none; border-top: 1px solid #e2e8f0; margin: 1.5rem 0; }
            .rich-editor-content a { color: #4f46e5; text-decoration: underline; }
            .rich-editor-content .ProseMirror-selectednode { outline: 2px solid #818cf8; }
            .rich-editor-content p.is-editor-empty:first-child::before { content: attr(data-placeholder); float: left; color: #94a3b8; pointer-events: none; height: 0; font-style: italic; }
          `}</style>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
