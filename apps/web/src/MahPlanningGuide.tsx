import { useEffect, useRef, useState } from 'react';
import { checkMahPlanningReadiness, MAH_SETUP_URL, planningSessionCheckMessage, type PlanningReturnBaseline } from './mah-planning-readiness.js';
import './mah-planning-guide.css';

type Readiness = Awaited<ReturnType<typeof checkMahPlanningReadiness>>;
/** 配置与返回仅核对事实，不提交、恢复或批准任何工作。 */
export function MahPlanningGuide({ baseline, onRecheck, generationAdmission, generationInProgress = false, generationResumable = false }: {
  baseline: PlanningReturnBaseline;
  onRecheck?: () => void;
  generationAdmission?: { sessionId: string; revision: number; proposalVersion: number; validUntil: number } | undefined;
  generationInProgress?: boolean;
  generationResumable?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Readiness | null>(null);
  const checkEpoch = useRef(0);
  const resultScope = useRef('');
  const scopeKey = JSON.stringify([baseline.sessionId ?? null, baseline.revision ?? null, baseline.proposalVersion ?? null]);
  const currentScope = useRef(scopeKey);
  currentScope.current = scopeKey;
  const recheck = useRef(onRecheck); recheck.current = onRecheck;
  const check = useRef<() => Promise<void>>(async () => {});
  check.current = async () => {
    const epoch = ++checkEpoch.current;
    setChecking(true); setResult(null);
    recheck.current?.();
    try {
      const next = await checkMahPlanningReadiness(baseline);
      if (epoch === checkEpoch.current && scopeKey === currentScope.current) { resultScope.current = scopeKey; setResult(next); }
    } finally {
      if (epoch === checkEpoch.current && scopeKey === currentScope.current) setChecking(false);
    }
  };
  useEffect(() => {
    setResult(null);
    void check.current();
    const returned = () => { if (document.visibilityState === 'visible') void check.current(); };
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void check.current(); }, 60_000);
    window.addEventListener('focus', returned);
    document.addEventListener('visibilitychange', returned);
    return () => { window.clearInterval(interval); checkEpoch.current++; window.removeEventListener('focus', returned); document.removeEventListener('visibilitychange', returned); };
  }, [scopeKey]);
  useEffect(() => {
    if (!result || resultScope.current !== scopeKey) return;
    const expiry = window.setTimeout(() => { setResult(null); void check.current(); }, Math.max(0, result.validUntil - Date.now()));
    return () => window.clearTimeout(expiry);
  }, [result, scopeKey]);
  const current = resultScope.current === scopeKey ? result : null;
  const canGenerate = generationAdmission?.sessionId === baseline.sessionId
    && generationAdmission?.revision === baseline.revision
    && generationAdmission?.proposalVersion === baseline.proposalVersion
    && generationAdmission !== undefined && generationAdmission.validUntil > Date.now()
    && generationAdmission.validUntil <= Date.now() + 30000;
  const executionMessage = generationInProgress
    ? 'Your plan is being prepared. The workspace will open it when generation finishes.'
    : generationResumable
      ? 'Your previous plan generation stopped. Its saved progress is available. Select Continue plan generation to continue after the current checks pass.'
      : canGenerate
      ? 'This saved trip is ready to submit for plan generation. Review the details and select Generate plan.'
      : current?.submissionConfigured
        ? 'You can send travel requirements. Landi checks MAH before submitting each request. Plan generation is awaiting verification for this saved trip.'
        : 'Public execution is unverified. Plan generation remains unavailable.';
  return <section className="mah-planning-guide" aria-label="MAH planning connection">
    <h2>Continue planning with MAH</h2>
    <dl aria-live="polite">
      <div><dt>MAH configuration</dt><dd>{current?.configuration === 'verified' ? 'Configuration verified.' : current?.configuration === 'needs_setup' ? 'Complete your MAH setup, then check again.' : 'Configuration is unverified. Open MAH to review your settings.'}</dd></div>
      <div><dt>Planning execution</dt><dd>{executionMessage}</dd></div>
      <div><dt>Saved session</dt><dd>{baseline.sessionId ? planningSessionCheckMessage(current?.session ?? { comparison: 'unverified' }) : 'No saved session is selected. Your unsent input is kept.'}</dd></div>
    </dl>
    <p>{current?.submissionConfigured ? 'Send your requirements below to check whether MAH can accept them.' : 'Return to MAH to review your settings, then check again here.'}</p><div className="mah-planning-guide-actions"><a href={MAH_SETUP_URL} target="_blank" rel="noopener noreferrer">MAH settings help ↗</a><button type="button" disabled={checking} onClick={() => void check.current()}>{checking ? 'Checking…' : 'Check again'}</button></div>
  </section>;
}
