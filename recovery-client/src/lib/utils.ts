export function readDemoRecoverySession() {
  return {
    id: 'demo-session',
    task_name: 'Finalize the critical prototype handoff',
    category: 'code',
    status: 'active',
    started_at: new Date(Date.now() - 1000 * 60 * 19).toISOString(),
    last_checkpoint_at: new Date(Date.now() - 1000 * 14).toISOString(),
    briefing: 'You were in the middle of the final code correction and validation pass for the prototype handoff.',
    readiness: 86,
  };
}

export function clampWithBand(score: number) {
  const bounded = Math.min(100, Math.max(0, score));
  if (bounded >= 85) return 'high';
  if (bounded >= 50) return 'partial';
  return 'limited';
}

export function getReadinessColor(score: number) {
  const band = clampWithBand(score);
  if (band === 'high') return 'var(--accent-safe)';
  if (band === 'partial') return 'var(--accent-warning)';
  return '#6C7272';
}

export function safeText(value: string | undefined | null, fallback = 'Not captured') {
  if (!value || !value.trim()) return fallback;
  return value;
}
