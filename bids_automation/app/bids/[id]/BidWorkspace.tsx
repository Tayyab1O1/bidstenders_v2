'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import RichEditor from './RichEditor';
import {
  doc, getDoc, setDoc, collection, getDocs, addDoc, updateDoc, deleteDoc,
  orderBy, query,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import type { Bid, BidDocument, ScorerSettings, ReferenceFile, ReferenceProposal } from '@/lib/types';

type ChatMessage = { role: 'user' | 'assistant'; text: string };

// ── Markdown → Word-like rendering ──────────────────────────────────────────
const md: React.ComponentProps<typeof ReactMarkdown>['components'] = {
  h1: ({ children }) => <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#0f172a', marginTop: '1.5rem', marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '2px solid #e2e8f0', lineHeight: 1.3 }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b', marginTop: '1.4rem', marginBottom: '0.5rem', lineHeight: 1.35 }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: '#1e293b', marginTop: '1.1rem', marginBottom: '0.4rem' }}>{children}</h3>,
  h4: ({ children }) => <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: '#334155', marginTop: '0.9rem', marginBottom: '0.3rem' }}>{children}</h4>,
  p: ({ children }) => <p style={{ fontSize: '0.925rem', color: '#374151', marginBottom: '0.85rem', lineHeight: 1.75 }}>{children}</p>,
  strong: ({ children }) => <strong style={{ fontWeight: 600, color: '#111827' }}>{children}</strong>,
  em: ({ children }) => <em style={{ fontStyle: 'italic', color: '#374151' }}>{children}</em>,
  ul: ({ children }) => <ul style={{ listStyleType: 'disc', paddingLeft: '1.5rem', marginBottom: '0.85rem' }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ listStyleType: 'decimal', paddingLeft: '1.5rem', marginBottom: '0.85rem' }}>{children}</ol>,
  li: ({ children }) => <li style={{ fontSize: '0.925rem', color: '#374151', lineHeight: 1.7, marginBottom: '0.2rem' }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote style={{ borderLeft: '4px solid #818cf8', paddingLeft: '1rem', paddingTop: '0.25rem', paddingBottom: '0.25rem', margin: '1rem 0', background: '#f5f3ff', borderRadius: '0 6px 6px 0', fontStyle: 'italic', color: '#4b5563' }}>
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e2e8f0', margin: '1.5rem 0' }} />,
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', marginBottom: '1rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th style={{ border: '1px solid #cbd5e1', background: '#f1f5f9', padding: '0.5rem 0.75rem', textAlign: 'left', fontWeight: 600, fontSize: '0.8rem', color: '#475569' }}>{children}</th>,
  td: ({ children }) => <td style={{ border: '1px solid #cbd5e1', padding: '0.5rem 0.75rem', fontSize: '0.875rem', color: '#374151' }}>{children}</td>,
  pre: ({ children }) => <pre style={{ background: '#1e293b', color: '#e2e8f0', padding: '1rem', borderRadius: '8px', fontSize: '0.8rem', overflowX: 'auto', marginBottom: '1rem', lineHeight: 1.6 }}>{children}</pre>,
  code: ({ children, className }) => {
    const isBlock = className?.startsWith('language-');
    return isBlock
      ? <code style={{ fontFamily: 'monospace' }}>{children}</code>
      : <code style={{ background: '#f1f5f9', padding: '0.15rem 0.35rem', borderRadius: '4px', fontSize: '0.8rem', fontFamily: 'monospace', color: '#4f46e5' }}>{children}</code>;
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{label}</dt>
      <dd className="text-sm text-slate-700">{value}</dd>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const [color, text] =
    score >= 80 ? ['bg-emerald-500', 'text-emerald-700']
    : score >= 60 ? ['bg-amber-400', 'text-amber-700']
    : score >= 40 ? ['bg-orange-400', 'text-orange-700']
    : ['bg-red-400', 'text-red-700'];
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-slate-500">AI Match Score</span>
        <span className={`text-sm font-bold ${text}`}>{score}/100</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}



// ── Collapse / reopen button ──────────────────────────────────────────────────
function CollapseBtn({ onToggle, direction }: { onToggle: () => void; direction: 'left' | 'right' }) {
  return (
    <button
      onClick={onToggle}
      title="Collapse"
      className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition-colors shrink-0"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        {direction === 'left'
          ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />}
      </svg>
    </button>
  );
}

function ReopenTab({ onToggle, side, label }: { onToggle: () => void; side: 'left' | 'right'; label: string }) {
  return (
    <div className={`shrink-0 flex flex-col items-center justify-center bg-white border-slate-200 hover:bg-indigo-50 transition-colors cursor-pointer select-none group
      ${side === 'left' ? 'border-r' : 'border-l'}`}
      style={{ width: '20px' }}
      onClick={onToggle}
      title={`Open ${label}`}
    >
      <span className="text-slate-400 group-hover:text-indigo-600 transition-colors"
        style={{ writingMode: 'vertical-rl', fontSize: '10px', fontWeight: 600, letterSpacing: '0.05em', transform: side === 'left' ? 'rotate(180deg)' : undefined }}>
        {label}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function BidWorkspace({ bidId }: { bidId: string }) {
  const [bid, setBid] = useState<Bid | null>(null);
  const [documents, setDocuments] = useState<BidDocument[]>([]);
  const [refFiles, setRefFiles] = useState<ReferenceFile[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<BidDocument | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editMode, setEditMode] = useState<'preview' | 'edit'>('preview');
  const [midTab, setMidTab] = useState<'documents' | 'files'>('documents');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Panel visibility
  const [leftOpen, setLeftOpen] = useState(true);
  const [midOpen, setMidOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  // Text selection → chat
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null);
  const [selectionText, setSelectionText] = useState('');
  const [pendingSelection, setPendingSelection] = useState(''); // held until chat send
  const [downloading, setDownloading] = useState(false);

  // Upload
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTags, setUploadTags] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const chatRef = doc(db, 'bids', bidId, 'chat', 'history');

  async function saveChatHistory(messages: ChatMessage[]) {
    await setDoc(chatRef, { messages }).catch(() => {});
  }

  const loadRefFiles = useCallback(async () => {
    const q = query(collection(db, 'bids', bidId, 'referenceFiles'), orderBy('uploadedAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as ReferenceFile));
  }, [bidId]);

  const loadDocuments = useCallback(async () => {
    const q = query(collection(db, 'bids', bidId, 'documents'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as BidDocument));
  }, [bidId]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [bidSnap, docs, files, chatSnap] = await Promise.all([
          getDoc(doc(db, 'bids', bidId)),
          loadDocuments(),
          loadRefFiles(),
          getDoc(doc(db, 'bids', bidId, 'chat', 'history')),
        ]);
        if (bidSnap.exists()) setBid({ id: bidSnap.id, ...bidSnap.data() } as Bid);
        setDocuments(docs);
        setRefFiles(files);
        if (chatSnap.exists()) setChatMessages((chatSnap.data().messages || []) as ChatMessage[]);
        if (docs.length > 0) {
          setSelectedDoc(docs[0]);
          setEditContent(docs[0].content);
          setEditTitle(docs[0].title);
          setEditMode('preview');
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [bidId, loadDocuments, loadRefFiles]);

  function selectDoc(d: BidDocument) {
    setSelectedDoc(d);
    setEditContent(d.content);
    setEditTitle(d.title);
    setEditMode('preview');
    setError(null);
  }

  function startNewDoc() {
    setSelectedDoc(null);
    setEditContent('');
    setEditTitle('');
    setEditMode('preview');
    setError(null);
    if (!chatOpen) setChatOpen(true);
    setTimeout(() => chatInputRef.current?.focus(), 50);
  }

  // ── File upload ───────────────────────────────────────────────────────────
  async function handleUploadFile() {
    if (!uploadFile) return;
    setUploading(true);
    setError(null);
    try {
      const path = `bids/${bidId}/references/${Date.now()}_${uploadFile.name}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, uploadFile);
      const url = await getDownloadURL(fileRef);
      const tags = uploadTags.split(',').map(t => t.trim()).filter(Boolean);
      const now = new Date().toISOString();
      const docRef = await addDoc(collection(db, 'bids', bidId, 'referenceFiles'), {
        name: uploadFile.name, url, storagePath: path, tags,
        size: uploadFile.size, mimeType: uploadFile.type || 'application/octet-stream', uploadedAt: now,
      });
      setRefFiles(prev => [{
        id: docRef.id, name: uploadFile.name, url, storagePath: path,
        tags, size: uploadFile.size, mimeType: uploadFile.type, uploadedAt: now,
      }, ...prev]);
      setUploadFile(null); setUploadTags(''); setShowUploadForm(false);
    } catch (e: any) { setError(e.message); }
    finally { setUploading(false); }
  }

  async function handleDeleteRefFile(file: ReferenceFile) {
    if (!confirm(`Delete "${file.name}"?`)) return;
    try {
      await deleteObject(storageRef(storage, file.storagePath));
      await deleteDoc(doc(db, 'bids', bidId, 'referenceFiles', file.id));
      setRefFiles(prev => prev.filter(f => f.id !== file.id));
    } catch (e: any) { setError(e.message); }
  }

  // ── Text selection → chat ─────────────────────────────────────────────────
  function handleDocMouseUp(e: React.MouseEvent) {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (text.length > 5) {
      setSelectionText(text);
      setSelectionPos({ x: e.clientX, y: e.clientY });
    } else {
      setSelectionText('');
      setSelectionPos(null);
    }
  }

  function sendSelectionToChat() {
    const text = selectionText;
    setPendingSelection(text); // save for chat handler to use when sent
    setChatInput(`Edit this section: `);
    setSelectionText('');
    setSelectionPos(null);
    if (!chatOpen) setChatOpen(true);
    setTimeout(() => {
      chatInputRef.current?.focus();
      const len = chatInputRef.current?.value.length ?? 0;
      chatInputRef.current?.setSelectionRange(len, len);
    }, 100);
  }

  async function handleDownload() {
    if (!selectedDoc || !editContent) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/download-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent, title: editTitle }),
      });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${editTitle || 'proposal'}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDownloading(false);
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────
  async function handleSendChat() {
    if (!chatInput.trim() || chatLoading || !bid) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    const withUser: ChatMessage[] = [...chatMessages, { role: 'user', text: userMsg }];
    setChatMessages(withUser);
    setChatLoading(true);
    setError(null);
    let finalMessages = withUser;
    try {
      if (selectedDoc && pendingSelection) {
        // ── Section-only edit ─────────────────────────────────────────────
        const sectionText = pendingSelection;
        setPendingSelection('');
        const settingsSnap = await getDoc(doc(db, 'settings', 'scorer'));
        const settings = settingsSnap.exists() ? settingsSnap.data() : {};
        const res = await fetch('/api/refine-section', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selectedText: sectionText, instructions: userMsg, bid, settings }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Section refinement failed');
        const { refinedText } = await res.json();
        setEditContent(prev => {
          const idx = prev.indexOf(sectionText);
          if (idx !== -1) {
            return prev.substring(0, idx) + refinedText + prev.substring(idx + sectionText.length);
          }
          // Fallback: couldn't locate exact text in markdown, prepend the refined section
          return refinedText + '\n\n' + prev;
        });
        setEditMode('preview');
        const assistantMsg: ChatMessage = { role: 'assistant', text: 'Section updated. Review the change in the document, then save when ready.' };
        finalMessages = [...withUser, assistantMsg];
        setChatMessages(finalMessages);
      } else if (selectedDoc) {
        // ── Full document refine ──────────────────────────────────────────
        const settingsSnap = await getDoc(doc(db, 'settings', 'scorer'));
        const settings = settingsSnap.exists() ? settingsSnap.data() : {};
        const res = await fetch('/api/refine-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editContent, instructions: userMsg, bid, settings, refFiles }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Refinement failed');
        const { content } = await res.json();
        setEditContent(content);
        setEditMode('preview');
        const assistantMsg: ChatMessage = { role: 'assistant', text: 'Done — proposal updated. Review it, then save when ready.' };
        finalMessages = [...withUser, assistantMsg];
        setChatMessages(finalMessages);
      } else {
        const [settingsSnap, refProposalsSnap] = await Promise.all([
          getDoc(doc(db, 'settings', 'scorer')),
          getDocs(collection(db, 'referenceProposals')),
        ]);
        const settings: Partial<ScorerSettings> = settingsSnap.exists()
          ? (settingsSnap.data() as ScorerSettings) : {};
        const referenceProposals = refProposalsSnap.docs.map(d => d.data() as ReferenceProposal);
        const mergedSettings = {
          ...settings,
          customInstructions: [settings.customInstructions, userMsg].filter(Boolean).join('\n\n'),
        };
        const res = await fetch('/api/generate-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            bid,
            documentType: 'proposal',
            settings: mergedSettings,
            referenceProposals,
            refFiles,
          }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Generation failed');
        const { content } = await res.json();
        const now = new Date().toISOString();
        const ref = await addDoc(collection(db, 'bids', bidId, 'documents'), {
          title: `Proposal — ${bid.bidName || bid.bidNameList}`,
          content, type: 'proposal', createdAt: now, updatedAt: now,
        });
        const newDoc: BidDocument = {
          id: ref.id,
          title: `Proposal — ${bid.bidName || bid.bidNameList}`,
          content, type: 'proposal', createdAt: now, updatedAt: now,
        };
        setDocuments(prev => [newDoc, ...prev]);
        selectDoc(newDoc);
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          text: 'Proposal created. Send follow-up instructions to refine it, or select text in the document to edit a specific section.',
        };
        finalMessages = [...withUser, assistantMsg];
        setChatMessages(finalMessages);
      }
    } catch (e: any) {
      const errMsg: ChatMessage = { role: 'assistant', text: `Something went wrong: ${(e as Error).message}` };
      finalMessages = [...withUser, errMsg];
      setChatMessages(finalMessages);
      setError((e as Error).message);
    } finally {
      setChatLoading(false);
      saveChatHistory(finalMessages);
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!selectedDoc) return;
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'bids', bidId, 'documents', selectedDoc.id), {
        title: editTitle, content: editContent, updatedAt: now,
      });
      const updated = { ...selectedDoc, title: editTitle, content: editContent, updatedAt: now };
      setSelectedDoc(updated);
      setDocuments(prev => prev.map(d => d.id === selectedDoc.id ? updated : d));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  }

  async function handleDeleteDoc(docId: string) {
    if (!confirm('Delete this document?')) return;
    await deleteDoc(doc(db, 'bids', bidId, 'documents', docId));
    const remaining = documents.filter(d => d.id !== docId);
    setDocuments(remaining);
    if (selectedDoc?.id === docId) {
      const next = remaining[0] || null;
      setSelectedDoc(next);
      setEditContent(next?.content || '');
      setEditTitle(next?.title || '');
    }
  }

  async function handleStatusChange(status: 'approved' | 'rejected' | 'pending') {
    if (!bid) return;
    await updateDoc(doc(db, 'bids', bidId), { reviewStatus: status, updatedAt: new Date().toISOString() });
    setBid(prev => prev ? { ...prev, reviewStatus: status } : null);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-400">
        <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }
  if (!bid) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
        <p className="text-sm text-slate-500">Bid not found</p>
        <Link href="/" className="text-sm text-indigo-600 hover:underline">← Back to Dashboard</Link>
      </div>
    );
  }

  const statusStyles: Record<string, string> = {
    approved: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    rejected: 'text-red-600 bg-red-50 border-red-200',
    pending: 'text-slate-600 bg-slate-100 border-slate-200',
  };

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 56px)' }}>
      {/* Breadcrumb */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3 shrink-0">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Dashboard
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm text-slate-700 font-medium truncate max-w-sm">{bid.bidNumber || bid.bidNumberList}</span>
        <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${statusStyles[bid.reviewStatus] || statusStyles.pending}`}>
          {bid.reviewStatus}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden relative">

        {/* ── Left: Bid Details ─────────────────────────────────────────── */}
        {leftOpen ? (
          <aside className="w-72 shrink-0 bg-white border-r border-slate-200 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 shrink-0">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Bid Details</span>
              <CollapseBtn onToggle={() => setLeftOpen(false)} direction="left" />
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              <div>
                <h1 className="text-sm font-bold text-slate-900 leading-snug">{bid.bidName || bid.bidNameList || bid.title}</h1>
                <p className="text-xs text-slate-400 font-mono mt-1">{bid.bidNumber || bid.bidNumberList}</p>
              </div>
              {bid.aiScore !== null && bid.aiScore !== undefined && (
                <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                  <ScoreBar score={bid.aiScore} />
                  {bid.aiScoreReason && <p className="text-xs text-slate-600 leading-relaxed">{bid.aiScoreReason}</p>}
                  {bid.aiScoreHighlights && bid.aiScoreHighlights.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-emerald-700 mb-1.5">Strengths</p>
                      <ul className="space-y-1">
                        {bid.aiScoreHighlights.map((h, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                            <svg className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                            {h}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {bid.aiScoreConcerns && bid.aiScoreConcerns.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-red-600 mb-1.5">Concerns</p>
                      <ul className="space-y-1">
                        {bid.aiScoreConcerns.map((c, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-xs text-slate-600">
                            <svg className="w-3 h-3 text-red-400 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <dl className="space-y-3.5">
                <DetailRow label="Type" value={bid.bidType} />
                <DetailRow label="Classification" value={bid.bidClassification} />
                <DetailRow label="Bid Status" value={bid.bidStatus} />
                <DetailRow label="Posted" value={bid.postedDate} />
                <DetailRow label="Closes" value={bid.bidClosingDate || bid.closingDateList} />
                <DetailRow label="Submission" value={bid.submissionType} />
                <DetailRow label="Address" value={bid.submissionAddress} />
                <DetailRow label="Public Opening" value={bid.publicOpening} />
              </dl>
              {bid.categories && (
                <div>
                  <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Categories</dt>
                  <dd className="text-xs text-slate-600 leading-relaxed">{bid.categories}</dd>
                </div>
              )}
              {bid.description && (
                <div>
                  <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Description</dt>
                  <dd className="text-xs text-slate-600 leading-relaxed">{bid.description}</dd>
                </div>
              )}
            </div>
            <div className="p-5 border-t border-slate-100 space-y-2 shrink-0">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Change Status</p>
              <div className="flex gap-2">
                <button onClick={() => handleStatusChange('approved')} disabled={bid.reviewStatus === 'approved'}
                  className="flex-1 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors">
                  Approve
                </button>
                <button onClick={() => handleStatusChange('rejected')} disabled={bid.reviewStatus === 'rejected'}
                  className="flex-1 py-2 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40 transition-colors">
                  Reject
                </button>
              </div>
              {bid.reviewStatus !== 'pending' && (
                <button onClick={() => handleStatusChange('pending')}
                  className="w-full py-2 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
                  Reset to Pending
                </button>
              )}
            </div>
          </aside>
        ) : (
          <ReopenTab onToggle={() => setLeftOpen(true)} side="left" label="Bid Details" />
        )}

        {/* ── Middle: Documents / Files ──────────────────────────────────── */}
        {midOpen ? (
          <div className="w-60 shrink-0 bg-slate-50 border-r border-slate-200 flex flex-col overflow-hidden">
            <div className="flex border-b border-slate-200 bg-white shrink-0 items-center">
              <button onClick={() => setMidTab('documents')}
                className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${midTab === 'documents' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' : 'text-slate-500 hover:text-slate-700'}`}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Docs
                {documents.length > 0 && <span className="bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5 text-xs">{documents.length}</span>}
              </button>
              <button onClick={() => setMidTab('files')}
                className={`flex-1 py-2.5 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${midTab === 'files' ? 'text-indigo-600 border-b-2 border-indigo-600 bg-white' : 'text-slate-500 hover:text-slate-700'}`}>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                Files
                {refFiles.length > 0 && <span className="bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5 text-xs">{refFiles.length}</span>}
              </button>
              <div className="px-1.5 border-l border-slate-200 self-stretch flex items-center">
                <CollapseBtn onToggle={() => setMidOpen(false)} direction="left" />
              </div>
            </div>

            {midTab === 'documents' && (
              <>
                <div className="px-3 py-2.5 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
                  <span className="text-xs text-slate-400 font-medium">{documents.length} proposal{documents.length !== 1 ? 's' : ''}</span>
                  <button onClick={startNewDoc} className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                    New
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {documents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-center px-3">
                      <p className="text-xs">No proposals yet. Use the chat to generate one.</p>
                    </div>
                  ) : documents.map(d => (
                    <div key={d.id} onClick={() => selectDoc(d)}
                      className={`group relative p-2.5 rounded-lg cursor-pointer transition-all ${selectedDoc?.id === d.id ? 'bg-indigo-600 shadow-sm' : 'bg-white border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50'}`}>
                      <p className={`text-xs font-semibold line-clamp-2 pr-4 ${selectedDoc?.id === d.id ? 'text-white' : 'text-slate-800'}`}>{d.title}</p>
                      <p className={`text-xs mt-0.5 capitalize ${selectedDoc?.id === d.id ? 'text-indigo-200' : 'text-slate-400'}`}>Proposal</p>
                      <button onClick={e => { e.stopPropagation(); handleDeleteDoc(d.id); }}
                        className={`absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs ${selectedDoc?.id === d.id ? 'text-indigo-200 hover:text-white' : 'text-slate-300 hover:text-red-500'}`}>✕</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {midTab === 'files' && (
              <>
                <div className="p-3 border-b border-slate-200">
                  <input ref={fileInputRef} type="file" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) { setUploadFile(f); setShowUploadForm(true); } e.target.value = ''; }} />
                  {!showUploadForm ? (
                    <button onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold text-indigo-600 border border-dashed border-indigo-300 rounded-lg hover:bg-indigo-50 transition-colors">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                      Upload Reference File
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-2 bg-white border border-slate-200 rounded-lg">
                        <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <span className="text-xs text-slate-700 font-medium truncate flex-1">{uploadFile?.name}</span>
                        <span className="text-xs text-slate-400 shrink-0">{uploadFile ? formatSize(uploadFile.size) : ''}</span>
                      </div>
                      <input type="text" value={uploadTags} onChange={e => setUploadTags(e.target.value)}
                        placeholder="Tags: rfp, requirements…"
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white text-slate-700 placeholder-slate-400" />
                      <div className="flex gap-1.5">
                        <button onClick={handleUploadFile} disabled={uploading}
                          className="flex-1 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1">
                          {uploading ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : null}
                          {uploading ? 'Uploading…' : 'Upload'}
                        </button>
                        <button onClick={() => { setShowUploadForm(false); setUploadFile(null); setUploadTags(''); }}
                          className="px-3 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50">
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                  {refFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-center px-3">
                      <svg className="w-8 h-8 text-slate-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>
                      <p className="text-xs">No files uploaded yet</p>
                    </div>
                  ) : refFiles.map(f => (
                    <div key={f.id} className="bg-white border border-slate-200 rounded-lg p-2.5 group">
                      <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{f.name}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{formatSize(f.size)}</p>
                          {f.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {f.tags.map(tag => (
                                <span key={tag} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded-md font-medium">#{tag}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-2 pt-2 border-t border-slate-100">
                        <a href={f.url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                          Download
                        </a>
                        <button onClick={() => handleDeleteRefFile(f)} className="ml-auto text-xs text-slate-300 hover:text-red-500 transition-colors">Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <ReopenTab onToggle={() => setMidOpen(true)} side="left" label="Proposals" />
        )}

        {/* ── Main: Document ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white min-w-0">

          {selectedDoc ? (
            <>
              {/* Doc header */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 shrink-0">
                <input type="text" value={editTitle} onChange={e => setEditTitle(e.target.value)}
                  className="flex-1 text-sm font-semibold text-slate-900 border-0 focus:outline-none bg-transparent placeholder-slate-400 min-w-0"
                  placeholder="Document title" />
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex rounded-md border border-slate-200 overflow-hidden text-xs">
                    <button onClick={() => setEditMode('preview')}
                      className={`px-2.5 py-1 font-medium transition-colors ${editMode === 'preview' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                      Preview
                    </button>
                    <button onClick={() => setEditMode('edit')}
                      className={`px-2.5 py-1 font-medium transition-colors ${editMode === 'edit' ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                      Edit
                    </button>
                  </div>
                  {saved && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      Saved
                    </span>
                  )}
                  <button onClick={handleDownload} disabled={downloading}
                    title="Download as Word document"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors">
                    {downloading
                      ? <div className="w-3 h-3 border border-slate-400 border-t-transparent rounded-full animate-spin" />
                      : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
                    .docx
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                    {saving ? <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" /> : null}
                    Save
                  </button>
                </div>
              </div>

              {error && (
                <div className="mx-5 mt-3 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 shrink-0">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  {error}
                </div>
              )}

              {editMode === 'preview' ? (
                /* ── Doc preview with text-selection support ── */
                <div
                  className="flex-1 overflow-y-auto bg-slate-100 px-6 py-6"
                  style={{ minHeight: 0 }}
                  onMouseUp={handleDocMouseUp}
                >
                  <div className="max-w-3xl mx-auto bg-white shadow-md rounded-lg px-12 py-10 min-h-full">
                    {editContent ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>
                        {editContent}
                      </ReactMarkdown>
                    ) : (
                      <p className="text-slate-300 text-sm italic">No content yet — use the chat to generate a draft.</p>
                    )}
                  </div>
                  {/* Selection hint */}
                  {editContent && (
                    <p className="text-center text-xs text-slate-400 mt-4">
                      Select any text to send it directly to the AI chat for editing
                    </p>
                  )}
                </div>
              ) : (
                /* ── WYSIWYG doc editor ── */
                <RichEditor
                  key={selectedDoc.id}
                  content={editContent}
                  onChange={setEditContent}
                />
              )}
            </>
          ) : (
            /* No document */
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
              <svg className="w-14 h-14 text-slate-200 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              <p className="text-sm font-semibold text-slate-500">No proposal selected</p>
              <p className="text-xs text-slate-400 mt-1 text-center max-w-xs">
                Describe what you need in the chat and AI will generate a proposal.
              </p>
              {!chatOpen && (
                <button onClick={() => setChatOpen(true)}
                  className="mt-4 px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
                  Open Chat
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Chat panel ──────────────────────────────────────────── */}
        {!chatOpen && (
          <ReopenTab onToggle={() => setChatOpen(true)} side="right" label="AI Chat" />
        )}
        {chatOpen && (
          <div className="w-80 shrink-0 bg-slate-50 flex flex-col overflow-hidden border-l border-slate-200">
            {/* Chat header */}
            <div className="px-4 py-3 border-b border-slate-200 bg-white shrink-0 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center">
                  <svg className="w-3 h-3 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <span className="text-xs font-semibold text-slate-700">
                  {selectedDoc ? 'Refine Proposal' : 'Generate Proposal'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {refFiles.length > 0 && (
                  <span className="text-xs text-slate-400">{refFiles.length} ref file{refFiles.length !== 1 ? 's' : ''}</span>
                )}
                <CollapseBtn onToggle={() => setChatOpen(false)} direction="right" />
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5 min-h-0">
              {chatMessages.length === 0 && (
                <div className="text-center pt-4 px-2">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {selectedDoc
                      ? 'Describe how to improve this proposal. You can also select text in the document to target a specific section.'
                      : 'Describe the proposal you need and AI will generate it using the bid details, your company profile, and any reference files.'}
                  </p>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                      <svg className="w-3 h-3 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                  )}
                  <div className={`max-w-55 px-3 py-1.5 rounded-2xl text-xs leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-sm'
                      : 'bg-white border border-slate-200 text-slate-700 rounded-bl-sm'
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex gap-2 justify-start">
                  <div className="w-5 h-5 rounded-full bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  </div>
                  <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3 py-2 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div className="border-t border-slate-200 bg-white px-3 py-3 shrink-0">
              {pendingSelection && (
                <div className="flex items-start gap-2 mb-2 px-2.5 py-2 bg-indigo-50 border border-indigo-200 rounded-lg">
                  <svg className="w-3 h-3 text-indigo-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-indigo-700 mb-0.5">Editing section</p>
                    <p className="text-xs text-indigo-600 truncate opacity-80">"{pendingSelection.substring(0, 60)}{pendingSelection.length > 60 ? '…' : ''}"</p>
                  </div>
                  <button onClick={() => setPendingSelection('')} className="text-indigo-400 hover:text-indigo-700 shrink-0">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              )}
              <textarea
                ref={chatInputRef}
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                placeholder={
                  pendingSelection ? 'Describe how to change this section…'
                  : selectedDoc ? 'Refine instructions… (Enter to send)'
                  : 'Describe the proposal… (Enter to send)'
                }
                rows={3}
                className="w-full px-3 py-2 text-xs text-slate-800 placeholder-slate-400 border border-slate-200 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-slate-50 mb-2"
              />
              <button onClick={handleSendChat} disabled={chatLoading || !chatInput.trim()}
                className="w-full py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
                {pendingSelection ? 'Edit Section' : selectedDoc ? 'Refine Proposal' : 'Generate Proposal'}
              </button>
            </div>
          </div>
        )}

      </div>

      {/* ── Floating text-selection button ────────────────────────────────── */}
      {selectionPos && selectionText && (
        <div
          className="fixed z-50 flex items-center gap-1.5 bg-indigo-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow-xl cursor-pointer hover:bg-indigo-700 transition-colors select-none"
          style={{ left: selectionPos.x - 70, top: selectionPos.y + 12 }}
          onMouseDown={e => { e.preventDefault(); sendSelectionToChat(); }}
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
          Edit with AI
        </div>
      )}

    </div>
  );
}
