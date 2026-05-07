'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { collection, getDocs, doc, updateDoc, getDoc, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Bid, ReviewStatus } from '@/lib/types';

type FilterTab = 'all' | ReviewStatus;

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null)
    return <span className="text-xs text-slate-400 font-medium">—</span>;
  const [bg, text] =
    score >= 80 ? ['bg-emerald-50 border-emerald-200', 'text-emerald-700']
    : score >= 60 ? ['bg-amber-50 border-amber-200', 'text-amber-700']
    : score >= 40 ? ['bg-orange-50 border-orange-200', 'text-orange-700']
    : ['bg-red-50 border-red-200', 'text-red-700'];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-bold border ${bg} ${text}`}>
      {score}
      <span className="font-normal opacity-60">/ 100</span>
    </span>
  );
}

function StatusPill({ status }: { status: ReviewStatus }) {
  const styles: Record<ReviewStatus, string> = {
    pending: 'bg-slate-100 text-slate-600 border-slate-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-red-50 text-red-600 border-red-200',
  };
  const dots: Record<ReviewStatus, string> = {
    pending: 'bg-slate-400',
    approved: 'bg-emerald-500',
    rejected: 'bg-red-500',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border capitalize ${styles[status]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dots[status]}`} />
      {status}
    </span>
  );
}

export default function Dashboard() {
  const [bids, setBids] = useState<Bid[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterTab>('all');
  const [search, setSearch] = useState('');
  const [scoring, setScoring] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBids = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(collection(db, 'bids'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setBids(snap.docs.map(d => ({ id: d.id, ...d.data() } as Bid)));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBids(); }, [loadBids]);

  const filtered = bids.filter(b => {
    const matchesTab = filter === 'all' || b.reviewStatus === filter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      (b.bidName || b.bidNameList || '').toLowerCase().includes(q) ||
      (b.bidNumber || b.bidNumberList || '').toLowerCase().includes(q) ||
      (b.description || '').toLowerCase().includes(q);
    return matchesTab && matchesSearch;
  });

  const toggleSelect = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelected(
      selected.size === filtered.length && filtered.length > 0
        ? new Set()
        : new Set(filtered.map(b => b.id))
    );

  async function handleScore() {
    setScoring(true);
    setError(null);
    try {
      const selectedBids = bids.filter(b => selected.has(b.id));
      const settingsSnap = await getDoc(doc(db, 'settings', 'scorer'));
      const settings = settingsSnap.exists() ? settingsSnap.data() : {};

      const res = await fetch('/api/score-bids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bids: selectedBids, settings }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Scoring failed');

      const { results } = await res.json();
      const now = new Date().toISOString();
      await Promise.all(
        results.map((r: any) =>
          updateDoc(doc(db, 'bids', r.id), {
            aiScore: r.score,
            aiScoreReason: r.reason,
            aiScoreHighlights: r.highlights,
            aiScoreConcerns: r.concerns,
            aiScoredAt: now,
            updatedAt: now,
          })
        )
      );
      await loadBids();
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setScoring(false);
    }
  }

  async function handleSetStatus(status: 'approved' | 'rejected') {
    setUpdating(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      await Promise.all(
        [...selected].map(id =>
          updateDoc(doc(db, 'bids', id), { reviewStatus: status, updatedAt: now })
        )
      );
      await loadBids();
      setSelected(new Set());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUpdating(false);
    }
  }

  const stats = {
    total: bids.length,
    pending: bids.filter(b => b.reviewStatus === 'pending').length,
    approved: bids.filter(b => b.reviewStatus === 'approved').length,
    rejected: bids.filter(b => b.reviewStatus === 'rejected').length,
  };

  const TABS: { key: FilterTab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: bids.length },
    { key: 'pending', label: 'Pending', count: stats.pending },
    { key: 'approved', label: 'Approved', count: stats.approved },
    { key: 'rejected', label: 'Rejected', count: stats.rejected },
  ];

  return (
    <div className="max-w-7xl mx-auto px-6 py-6">

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Bids', value: stats.total, color: 'text-slate-800', border: 'border-slate-200' },
          { label: 'Pending Review', value: stats.pending, color: 'text-indigo-600', border: 'border-indigo-100' },
          { label: 'Approved', value: stats.approved, color: 'text-emerald-600', border: 'border-emerald-100' },
          { label: 'Rejected', value: stats.rejected, color: 'text-red-500', border: 'border-red-100' },
        ].map(s => (
          <div key={s.label} className={`bg-white rounded-xl border ${s.border} px-5 py-4 shadow-sm`}>
            <div className={`text-3xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-xs text-slate-500 mt-1.5 font-medium">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          <input
            type="text"
            placeholder="Search bids…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-3 py-2 text-sm text-slate-900 placeholder-slate-400 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent w-64 bg-white"
          />
        </div>

        <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white shadow-sm">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-3.5 py-2 text-sm font-medium flex items-center gap-1.5 transition-colors ${
                filter === t.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {t.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                filter === t.key ? 'bg-indigo-500 text-indigo-100' : 'bg-slate-100 text-slate-500'
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>

        <button
          onClick={loadBids}
          className="ml-auto p-2 text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 bg-white shadow-sm transition-colors"
          title="Refresh"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
        </button>
      </div>

      {/* Batch action bar — sticky so it stays visible while scrolling */}
      {selected.size > 0 && (
        <div className="sticky top-14 z-40 flex items-center gap-3 mb-4 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-xl shadow-md">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-indigo-600 flex items-center justify-center">
              <span className="text-white text-xs font-bold">{selected.size}</span>
            </div>
            <span className="text-sm font-semibold text-indigo-800">
              {selected.size} bid{selected.size !== 1 ? 's' : ''} selected
            </span>
          </div>
          <div className="flex gap-2 ml-auto flex-wrap">
            <button
              onClick={handleScore}
              disabled={scoring}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
              {scoring ? 'Scoring…' : 'AI Score'}
            </button>
            <button
              onClick={() => handleSetStatus('approved')}
              disabled={updating}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Approve
            </button>
            <button
              onClick={() => handleSetStatus('rejected')}
              disabled={updating}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              Reject
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-lg hover:bg-white transition-colors bg-white/60"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-3">
            <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-sm">Loading bids…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
            <svg className="w-12 h-12 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            <p className="text-sm font-medium text-slate-500">No bids found</p>
            <p className="text-xs text-slate-400">
              {bids.length === 0 ? 'Run the scraper to populate data.' : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="w-10 px-4 py-3 text-left">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Bid</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Posted</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Closes</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Score</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="sticky right-0 bg-slate-50 border-l border-slate-200 px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide w-20">
                    Open
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(bid => (
                  <tr
                    key={bid.id}
                    className={`group transition-colors ${
                      selected.has(bid.id)
                        ? 'bg-indigo-50/70'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={selected.has(bid.id)}
                        onChange={() => toggleSelect(bid.id)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </td>
                    <td className="px-4 py-3.5 max-w-xs">
                      <p className="font-semibold text-slate-900 truncate">
                        {bid.bidName || bid.bidNameList || bid.title}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">
                        {bid.bidNumber || bid.bidNumberList}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="text-slate-600 text-xs">{bid.bidType || '—'}</span>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap">{bid.postedDate || '—'}</td>
                    <td className="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap">{bid.closingDateList || bid.bidClosingDate || '—'}</td>
                    <td className="px-4 py-3.5">
                      <ScoreBadge score={bid.aiScore ?? null} />
                    </td>
                    <td className="px-4 py-3.5">
                      <StatusPill status={bid.reviewStatus || 'pending'} />
                    </td>
                    <td className={`sticky right-0 border-l border-slate-200 px-4 py-3.5 text-right transition-colors ${selected.has(bid.id) ? 'bg-indigo-50/70' : 'bg-white group-hover:bg-slate-50'}`}>
                      <Link
                        href={`/bids/${bid.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors whitespace-nowrap"
                      >
                        Open
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {!loading && filtered.length > 0 && (
        <p className="mt-3 text-xs text-slate-400 text-right">
          Showing {filtered.length} of {bids.length} bid{bids.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
