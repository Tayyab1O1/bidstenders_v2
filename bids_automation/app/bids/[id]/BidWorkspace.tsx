'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  doc, getDoc, collection, getDocs, addDoc, updateDoc, deleteDoc,
  orderBy, query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Bid, BidDocument, DocumentType, ScorerSettings } from '@/lib/types';

const DOC_TYPES: { value: DocumentType; label: string }[] = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'cover_letter', label: 'Cover Letter' },
  { value: 'technical', label: 'Technical Approach' },
  { value: 'custom', label: 'Custom' },
];

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
  const color = score >= 80 ? 'bg-emerald-500' : score >= 60 ? 'bg-amber-400' : score >= 40 ? 'bg-orange-400' : 'bg-red-400';
  const textColor = score >= 80 ? 'text-emerald-700' : score >= 60 ? 'text-amber-700' : score >= 40 ? 'text-orange-700' : 'text-red-700';
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-slate-500">AI Match Score</span>
        <span className={`text-sm font-bold ${textColor}`}>{score}/100</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export default function BidWorkspace({ bidId }: { bidId: string }) {
  const [bid, setBid] = useState<Bid | null>(null);
  const [documents, setDocuments] = useState<BidDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<BidDocument | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState('');
  const [newDocType, setNewDocType] = useState<DocumentType>('proposal');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const loadDocuments = useCallback(async () => {
    const q = query(collection(db, 'bids', bidId, 'documents'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as BidDocument));
  }, [bidId]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [bidSnap, docs] = await Promise.all([
          getDoc(doc(db, 'bids', bidId)),
          loadDocuments(),
        ]);
        if (bidSnap.exists()) setBid({ id: bidSnap.id, ...bidSnap.data() } as Bid);
        setDocuments(docs);
        if (docs.length > 0) {
          setSelectedDoc(docs[0]);
          setEditContent(docs[0].content);
          setEditTitle(docs[0].title);
        }
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [bidId, loadDocuments]);

  function selectDoc(d: BidDocument) {
    setSelectedDoc(d);
    setEditContent(d.content);
    setEditTitle(d.title);
    setRefineInstruction('');
    setError(null);
  }

  async function handleGenerate() {
    if (!bid) return;
    setGenerating(true);
    setError(null);
    try {
      const settingsSnap = await getDoc(doc(db, 'settings', 'scorer'));
      const settings: Partial<ScorerSettings> = settingsSnap.exists()
        ? (settingsSnap.data() as ScorerSettings)
        : {};

      const res = await fetch('/api/generate-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bid, documentType: newDocType, settings }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Generation failed');

      const { content } = await res.json();
      const typeLabel = DOC_TYPES.find(t => t.value === newDocType)?.label || 'Document';
      const now = new Date().toISOString();

      const ref = await addDoc(collection(db, 'bids', bidId, 'documents'), {
        title: `${typeLabel} — ${bid.bidName || bid.bidNameList}`,
        content,
        type: newDocType,
        createdAt: now,
        updatedAt: now,
      });

      const newDoc: BidDocument = {
        id: ref.id,
        title: `${typeLabel} — ${bid.bidName || bid.bidNameList}`,
        content,
        type: newDocType,
        createdAt: now,
        updatedAt: now,
      };
      setDocuments(prev => [newDoc, ...prev]);
      selectDoc(newDoc);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!selectedDoc) return;
    setSaving(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'bids', bidId, 'documents', selectedDoc.id), {
        title: editTitle,
        content: editContent,
        updatedAt: now,
      });
      const updated = { ...selectedDoc, title: editTitle, content: editContent, updatedAt: now };
      setSelectedDoc(updated);
      setDocuments(prev => prev.map(d => d.id === selectedDoc.id ? updated : d));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleRefine() {
    if (!selectedDoc || !refineInstruction.trim()) return;
    setRefining(true);
    setError(null);
    try {
      const res = await fetch('/api/refine-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent, instructions: refineInstruction, bid }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Refinement failed');
      const { content } = await res.json();
      setEditContent(content);
      setRefineInstruction('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRefining(false);
    }
  }

  async function handleDelete(docId: string) {
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
    await updateDoc(doc(db, 'bids', bidId), {
      reviewStatus: status,
      updatedAt: new Date().toISOString(),
    });
    setBid(prev => prev ? { ...prev, reviewStatus: status } : null);
  }

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
        <svg className="w-12 h-12 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
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
      {/* Breadcrumb bar */}
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-3 shrink-0">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Dashboard
        </Link>
        <span className="text-slate-300">/</span>
        <span className="text-sm text-slate-700 font-medium truncate max-w-sm">
          {bid.bidNumber || bid.bidNumberList}
        </span>
        <span className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${statusStyles[bid.reviewStatus] || statusStyles.pending}`}>
          {bid.reviewStatus}
        </span>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Left panel — Bid Details */}
        <aside className="w-72 shrink-0 bg-white border-r border-slate-200 overflow-y-auto flex flex-col">
          <div className="p-5 space-y-5">
            {/* Title */}
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-snug">
                {bid.bidName || bid.bidNameList || bid.title}
              </h1>
              <p className="text-xs text-slate-400 font-mono mt-1">{bid.bidNumber || bid.bidNumberList}</p>
            </div>

            {/* Score */}
            {bid.aiScore !== null && bid.aiScore !== undefined && (
              <div className="bg-slate-50 rounded-xl p-4 space-y-3">
                <ScoreBar score={bid.aiScore} />
                {bid.aiScoreReason && (
                  <p className="text-xs text-slate-600 leading-relaxed">{bid.aiScoreReason}</p>
                )}
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

            {/* Details */}
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
                <dd className="text-xs text-slate-600 leading-relaxed line-clamp-6">{bid.description}</dd>
              </div>
            )}
          </div>

          {/* Status actions */}
          <div className="mt-auto p-5 border-t border-slate-100 space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Change Status</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleStatusChange('approved')}
                disabled={bid.reviewStatus === 'approved'}
                className="flex-1 py-2 text-xs font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 transition-colors"
              >
                Approve
              </button>
              <button
                onClick={() => handleStatusChange('rejected')}
                disabled={bid.reviewStatus === 'rejected'}
                className="flex-1 py-2 text-xs font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40 transition-colors"
              >
                Reject
              </button>
            </div>
            {bid.reviewStatus !== 'pending' && (
              <button
                onClick={() => handleStatusChange('pending')}
                className="w-full py-2 text-xs font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Reset to Pending
              </button>
            )}
          </div>
        </aside>

        {/* Document list */}
        <div className="w-56 shrink-0 bg-slate-50 border-r border-slate-200 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-200 space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Documents</p>
            <div className="flex gap-1.5">
              <select
                value={newDocType}
                onChange={e => setNewDocType(e.target.value as DocumentType)}
                className="flex-1 text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {DOC_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <button
                onClick={handleGenerate}
                disabled={generating}
                title="Generate with AI"
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                {generating ? (
                  <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg>
                )}
                AI
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {documents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-center px-3">
                <svg className="w-8 h-8 text-slate-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <p className="text-xs text-slate-400">No documents yet</p>
              </div>
            ) : (
              documents.map(d => (
                <div
                  key={d.id}
                  onClick={() => selectDoc(d)}
                  className={`group relative p-2.5 rounded-lg cursor-pointer transition-all ${
                    selectedDoc?.id === d.id
                      ? 'bg-indigo-600 shadow-sm'
                      : 'bg-white border border-slate-200 hover:border-indigo-200 hover:bg-indigo-50'
                  }`}
                >
                  <p className={`text-xs font-semibold line-clamp-2 pr-4 ${selectedDoc?.id === d.id ? 'text-white' : 'text-slate-800'}`}>
                    {d.title}
                  </p>
                  <p className={`text-xs mt-0.5 capitalize ${selectedDoc?.id === d.id ? 'text-indigo-200' : 'text-slate-400'}`}>
                    {d.type.replace('_', ' ')}
                  </p>
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(d.id); }}
                    className={`absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none ${selectedDoc?.id === d.id ? 'text-indigo-200 hover:text-white' : 'text-slate-300 hover:text-red-500'}`}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white">
          {selectedDoc ? (
            <>
              {/* Editor header */}
              <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 bg-white shrink-0">
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="flex-1 text-sm font-semibold text-slate-900 border-0 focus:outline-none bg-transparent placeholder-slate-400"
                  placeholder="Document title"
                />
                <div className="flex items-center gap-2 shrink-0">
                  {saved && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                      Saved
                    </span>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {saving ? (
                      <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>
                    )}
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

              {/* Textarea */}
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                className="flex-1 px-6 py-4 text-sm text-slate-800 font-mono resize-none focus:outline-none leading-relaxed placeholder-slate-300"
                placeholder="Start writing, or use AI Generate to create a first draft…"
                style={{ minHeight: 0 }}
              />

              {/* AI Refine bar */}
              <div className="border-t border-slate-200 px-5 py-4 bg-slate-50 shrink-0">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-3.5 h-3.5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                  <span className="text-xs font-semibold text-slate-600">AI Refine</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={refineInstruction}
                    onChange={e => setRefineInstruction(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleRefine()}
                    placeholder="e.g. Make it more concise, add a pricing section, strengthen the executive summary…"
                    className="flex-1 px-3 py-2 text-xs text-slate-800 placeholder-slate-400 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  />
                  <button
                    onClick={handleRefine}
                    disabled={refining || !refineInstruction.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                  >
                    {refining ? (
                      <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                    ) : null}
                    {refining ? 'Refining…' : 'Refine'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8">
              <svg className="w-12 h-12 text-slate-200 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
              <p className="text-sm font-medium text-slate-500">No document selected</p>
              <p className="text-xs text-slate-400 mt-1 text-center max-w-xs">
                Choose a document type and click <strong className="text-slate-500">+ AI</strong> to generate a first draft, or select an existing document.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
