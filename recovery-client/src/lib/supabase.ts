import { createClient, type Session, type User } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://example.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-anon-key';

function ensureSupabaseConfig(): void {
  if (supabaseUrl.includes('example') || supabaseAnonKey.includes('demo')) {
    throw new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in the deployment environment.');
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export type RecoveryCategory =
  | 'code'
  | 'email'
  | 'form'
  | 'doc_notion'
  | 'terminal'
  | 'autosave';

export type RecoverySession = {
  id: string;
  task_name: string;
  category: RecoveryCategory;
  status: 'active' | 'ended';
  started_at: string;
  ended_at?: string | null;
  user_id: string;
};

export type RecoveryPayload = {
  category: RecoveryCategory;
  readiness_score: number;
  checkpoint_count?: number;
  briefing_text: string;
  checkpoint_data?: Record<string, any>;
  latest_screenshot_url?: string | null;
  last_checkpoint_ago?: string;
  last_checkpoint_at?: string | null;
  attachments?: Array<{ name: string; url: string }>; 
};

export async function getSupabaseSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getActiveRecoverySession(): Promise<RecoverySession | null> {
  const { data, error } = await supabase
    .from('critical_sessions')
    .select('id, user_id, category, status, task_name, started_at, ended_at')
    .eq('status', 'active')
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as RecoverySession | null;
}

export async function signInWithEmail(email: string, password: string): Promise<User | null> {
  ensureSupabaseConfig();

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.user;
}

export async function signOutUser(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function fetchRecoveryForSession(sessionId: string): Promise<RecoveryPayload> {
  const { data, error } = await supabase.functions.invoke('recover-session', {
    body: { session_id: sessionId },
  });

  if (error) {
    let message = error.message || 'Recovery request failed';
    const context = 'context' in error ? error.context : undefined;
    if (context instanceof Response) {
      try {
        const body = await context.clone().json();
        if (typeof body?.error === 'string') message = body.error;
      } catch {
        // Keep the SDK error when the function response is not JSON.
      }
    }
    throw new Error(message);
  }

  const result = data as RecoveryPayload;
  const hasCheckpointPayload = Boolean(result.checkpoint_data && Object.keys(result.checkpoint_data).length > 0);
  if (result.checkpoint_count === 0 || (!result.last_checkpoint_at && !hasCheckpointPayload)) {
    result.readiness_score = 0;
  }
  return result;
}

export async function runPistonCode(language: string, source: string) {
  const response = await fetch(import.meta.env.VITE_PISTON_API_URL || 'https://emkc.org/api/v2/piston/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language,
      version: '*',
      files: [{ content: source }],
    }),
  });

  if (!response.ok) {
    throw new Error('Execution request failed');
  }

  return response.json();
}

export function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return 'No checkpoint yet';
  const now = Date.now();
  const ts = new Date(value).getTime();
  const sec = Math.max(0, Math.round((now - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}
