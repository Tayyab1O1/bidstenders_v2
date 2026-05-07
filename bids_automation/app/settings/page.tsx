'use client';

import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, setDoc, collection, getDocs, addDoc, deleteDoc, orderBy, query } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '@/lib/firebase';
import type { ScorerSettings, ReferenceProposal } from '@/lib/types';

const DEFAULTS: ScorerSettings = {
  companyName: 'Sympl Solutions',
  companyDescription:
    'Sympl Solutions is a technology company specializing in software development, digital transformation, and IT consulting. We build custom web applications, mobile apps, and enterprise software solutions for clients across Canada.',
  services:
    'Web Development, Mobile App Development, Software Consulting, IT Services, Digital Transformation, Custom Software, API Development, UI/UX Design',
  preferredCategories:
    'Technology, IT Services, Software, Digital Services, Consulting, Development, Information Management',
  avoidKeywords:
    'construction, hardware supply, physical goods, manufacturing, food services, janitorial, landscaping, heavy equipment',
  minScore: 60,
  customInstructions:
    'Prioritize bids that require software development or IT consulting expertise. Score higher for Canadian government contracts and longer engagement periods.',
};

const TEXT_MIME = ['text/plain', 'text/markdown', 'text/csv', 'application/json'];

function readTextPreview(file: File): Promise<string> {
  const isText = TEXT_MIME.includes(file.type) || /\.(txt|md|csv|json)$/i.test(file.name);
  if (!isText) return Promise.resolve('');
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => resolve(((e.target?.result as string) || '').substring(0, 3000));
    reader.onerror = () => resolve('');
    reader.readAsText(file);
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-semibold text-slate-700">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<ScorerSettings>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [proposals, setProposals] = useState<ReferenceProposal[]>([]);
  const [uploading, setUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const [snap, propSnap] = await Promise.all([
          getDoc(doc(db, 'settings', 'scorer')),
          getDocs(query(collection(db, 'referenceProposals'), orderBy('uploadedAt', 'desc'))),
        ]);
        if (snap.exists()) setSettings({ ...DEFAULTS, ...(snap.data() as ScorerSettings) });
        setProposals(propSnap.docs.map(d => ({ id: d.id, ...d.data() } as ReferenceProposal)));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function set(key: keyof ScorerSettings, value: string | number) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await setDoc(doc(db, 'settings', 'scorer'), {
        ...settings, updatedAt: new Date().toISOString(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadProposal() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      const contentPreview = await readTextPreview(uploadFile);
      const path = `referenceProposals/${Date.now()}_${uploadFile.name}`;
      const fileRef = storageRef(storage, path);
      await uploadBytes(fileRef, uploadFile);
      const url = await getDownloadURL(fileRef);
      const now = new Date().toISOString();
      const ref = await addDoc(collection(db, 'referenceProposals'), {
        name: uploadFile.name,
        url,
        storagePath: path,
        description: uploadDesc,
        contentPreview,
        uploadedAt: now,
      });
      setProposals(prev => [{
        id: ref.id, name: uploadFile.name, url, storagePath: path,
        description: uploadDesc, contentPreview, uploadedAt: now,
      }, ...prev]);
      setUploadFile(null);
      setUploadDesc('');
      setShowUploadForm(false);
    } catch (e: any) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteProposal(p: ReferenceProposal) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    try {
      await deleteObject(storageRef(storage, p.storagePath));
      await deleteDoc(doc(db, 'referenceProposals', p.id));
      setProposals(prev => prev.filter(x => x.id !== p.id));
    } catch (e: any) {
      setUploadError(e.message);
    }
  }

  const inputCls = 'w-full px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white transition-shadow';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 gap-3 text-slate-400">
        <div className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <span className="text-sm">Loading settings…</span>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Scorer Settings</h1>
        <p className="text-sm text-slate-500 mt-1.5">Configure AI scoring and document generation behaviour.</p>
      </div>

      <div className="space-y-4">
        {/* Company profile */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
          <SectionHeader icon="building" color="indigo" label="Company Profile" />
          <Field label="Company Name" hint="Used verbatim in all AI-generated documents.">
            <input type="text" value={settings.companyName} onChange={e => set('companyName', e.target.value)}
              className={inputCls} placeholder="e.g. Sympl Solutions Inc." />
          </Field>
          <Field label="Company Description" hint="Be specific — this is used for scoring and document generation.">
            <textarea value={settings.companyDescription} onChange={e => set('companyDescription', e.target.value)}
              rows={4} className={`${inputCls} resize-none`} />
          </Field>
          <Field label="Services We Offer" hint="Comma-separated list.">
            <input type="text" value={settings.services} onChange={e => set('services', e.target.value)}
              className={inputCls} placeholder="e.g. Web Development, Mobile Apps, IT Consulting" />
          </Field>
        </section>

        {/* Scoring criteria */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
          <SectionHeader icon="star" color="amber" label="Scoring Criteria" />
          <Field label="Preferred Bid Categories" hint="Bids in these categories will score higher.">
            <input type="text" value={settings.preferredCategories} onChange={e => set('preferredCategories', e.target.value)}
              className={inputCls} placeholder="e.g. Technology, IT Services, Consulting" />
          </Field>
          <Field label="Keywords to Avoid" hint="Bids containing these keywords will score lower.">
            <input type="text" value={settings.avoidKeywords} onChange={e => set('avoidKeywords', e.target.value)}
              className={inputCls} placeholder="e.g. construction, hardware, manufacturing" />
          </Field>
          <Field label={`Minimum Score Threshold — ${settings.minScore}`}>
            <div className="space-y-2">
              <input type="range" min={0} max={100} step={5} value={settings.minScore}
                onChange={e => set('minScore', Number(e.target.value))}
                className="w-full accent-indigo-600 h-1.5" />
              <div className="flex justify-between text-xs text-slate-400">
                <span>0 — Score everything</span><span>100 — Perfect match only</span>
              </div>
            </div>
          </Field>
        </section>

        {/* Custom instructions */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
          <SectionHeader icon="note" color="slate" label="Custom Instructions" />
          <Field label="Additional AI Instructions" hint="Specific preferences that don't fit elsewhere.">
            <textarea value={settings.customInstructions} onChange={e => set('customInstructions', e.target.value)}
              rows={3} className={`${inputCls} resize-none`}
              placeholder="e.g. Prioritize Canadian government contracts…" />
          </Field>
        </section>

        {/* Save */}
        <div className="flex items-center justify-end gap-3 pt-1">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-semibold">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              Saved
            </span>
          )}
          <button onClick={handleSave} disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm">
            {saving ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>

        {/* Reference Proposals */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-purple-100 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-700">Reference Proposals</h2>
                <p className="text-xs text-slate-400">The AI studies these when generating new proposals.</p>
              </div>
            </div>
            <input ref={fileInputRef} type="file" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { setUploadFile(f); setShowUploadForm(true); } e.target.value = ''; }} />
            {!showUploadForm && (
              <button onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                Upload Proposal
              </button>
            )}
          </div>

          {/* Upload form */}
          {showUploadForm && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-slate-50">
              <div className="flex items-center gap-2 p-2.5 bg-white border border-slate-200 rounded-lg">
                <svg className="w-4 h-4 text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                <span className="text-sm text-slate-700 font-medium truncate flex-1">{uploadFile?.name}</span>
                <span className="text-xs text-slate-400 shrink-0">{uploadFile ? formatSize(uploadFile.size) : ''}</span>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Description <span className="font-normal text-slate-400">(helps AI understand when to use this)</span></label>
                <textarea value={uploadDesc} onChange={e => setUploadDesc(e.target.value)} rows={2}
                  className="w-full px-3 py-2 text-sm text-slate-800 placeholder-slate-400 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white resize-none"
                  placeholder="e.g. IT consulting proposal for a municipal government, won 2024…" />
              </div>
              {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
              <div className="flex gap-2">
                <button onClick={handleUploadProposal} disabled={uploading}
                  className="flex-1 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2">
                  {uploading ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
                <button onClick={() => { setShowUploadForm(false); setUploadFile(null); setUploadDesc(''); setUploadError(null); }}
                  className="px-4 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-white">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Proposals list */}
          {proposals.length === 0 && !showUploadForm ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-xl">
              <svg className="w-10 h-10 text-slate-200 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <p className="text-sm font-medium text-slate-400">No reference proposals yet</p>
              <p className="text-xs text-slate-400 mt-1">Upload past winning proposals so the AI can match their style.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {proposals.map(p => (
                <div key={p.id} className="flex items-start gap-3 p-3 border border-slate-200 rounded-xl bg-slate-50">
                  <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                    {p.description && <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{p.description}</p>}
                    {p.contentPreview && (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                        Text content extracted — AI can read this
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <a href={p.url} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">↓</a>
                    <button onClick={() => handleDeleteProposal(p)}
                      className="text-xs text-slate-300 hover:text-red-500 transition-colors">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeader({ icon, color, label }: { icon: string; color: string; label: string }) {
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-100 text-indigo-600',
    amber: 'bg-amber-100 text-amber-600',
    slate: 'bg-slate-100 text-slate-600',
  };
  const icons: Record<string, React.ReactNode> = {
    building: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>,
    star: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>,
    note: <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>,
  };
  return (
    <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
      <div className={`w-6 h-6 rounded-md flex items-center justify-center ${colors[color]}`}>
        {icons[icon]}
      </div>
      <h2 className="text-sm font-bold text-slate-700">{label}</h2>
    </div>
  );
}
