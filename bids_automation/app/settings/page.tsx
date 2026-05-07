'use client';

import { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ScorerSettings } from '@/lib/types';

const DEFAULTS: ScorerSettings = {
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

function Field({
  label, hint, children,
}: {
  label: string; hint?: string; children: React.ReactNode;
}) {
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

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'settings', 'scorer'));
        if (snap.exists()) setSettings({ ...DEFAULTS, ...(snap.data() as ScorerSettings) });
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
        ...settings,
        updatedAt: new Date().toISOString(),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    'w-full px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white transition-shadow';

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
        <p className="text-sm text-slate-500 mt-1.5">
          Tell the AI about your company so it scores bids accurately.
        </p>
      </div>

      <div className="space-y-4">
        {/* Company profile */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
            <div className="w-6 h-6 rounded-md bg-indigo-100 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
            </div>
            <h2 className="text-sm font-bold text-slate-700">Company Profile</h2>
          </div>

          <Field label="Company Description" hint="Describe what your company does. The more specific, the better the scoring.">
            <textarea
              value={settings.companyDescription}
              onChange={e => set('companyDescription', e.target.value)}
              rows={4}
              className={`${inputCls} resize-none`}
            />
          </Field>

          <Field label="Services We Offer" hint="Comma-separated list of your services.">
            <input
              type="text"
              value={settings.services}
              onChange={e => set('services', e.target.value)}
              className={inputCls}
              placeholder="e.g. Web Development, Mobile Apps, IT Consulting"
            />
          </Field>
        </section>

        {/* Scoring criteria */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
            <div className="w-6 h-6 rounded-md bg-amber-100 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
            </div>
            <h2 className="text-sm font-bold text-slate-700">Scoring Criteria</h2>
          </div>

          <Field label="Preferred Bid Categories" hint="Bids in these categories will score higher.">
            <input
              type="text"
              value={settings.preferredCategories}
              onChange={e => set('preferredCategories', e.target.value)}
              className={inputCls}
              placeholder="e.g. Technology, IT Services, Consulting"
            />
          </Field>

          <Field label="Keywords to Avoid" hint="Bids containing these keywords will score lower.">
            <input
              type="text"
              value={settings.avoidKeywords}
              onChange={e => set('avoidKeywords', e.target.value)}
              className={inputCls}
              placeholder="e.g. construction, hardware, manufacturing"
            />
          </Field>

          <Field label={`Minimum Score Threshold — ${settings.minScore}`}>
            <div className="space-y-2">
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={settings.minScore}
                onChange={e => set('minScore', Number(e.target.value))}
                className="w-full accent-indigo-600 h-1.5"
              />
              <div className="flex justify-between text-xs text-slate-400">
                <span>0 — Score everything</span>
                <span>100 — Perfect match only</span>
              </div>
            </div>
          </Field>
        </section>

        {/* Custom instructions */}
        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-2 pb-1 border-b border-slate-100">
            <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </div>
            <h2 className="text-sm font-bold text-slate-700">Custom Instructions</h2>
          </div>

          <Field label="Additional AI Instructions" hint="Specific preferences that don't fit elsewhere.">
            <textarea
              value={settings.customInstructions}
              onChange={e => set('customInstructions', e.target.value)}
              rows={4}
              className={`${inputCls} resize-none`}
              placeholder="e.g. Prioritize Canadian government contracts, score higher for multi-year engagements…"
            />
          </Field>
        </section>

        <div className="flex items-center justify-end gap-3 pt-1">
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600 font-semibold">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
              Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-6 py-2.5 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
          >
            {saving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Saving…
              </>
            ) : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
