import { createClient, type Session, type User } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://example.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'demo-anon-key';

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
  briefing_text: string;
  checkpoint_data?: Record<string, any>;
  latest_screenshot_url?: string | null;
  last_checkpoint_ago?: string;
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
  if (!supabaseUrl || supabaseUrl.includes('example') || !supabaseAnonKey || supabaseAnonKey.includes('demo')) {
    return { id: 'demo-user', email } as User;
  }

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
    throw new Error(error.message || 'Recovery request failed');
  }

  return data as RecoveryPayload;
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
