import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase env' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data: expiredSessions, error: sessionError } = await supabase
    .from('critical_sessions')
    .select('id')
    .eq('status', 'ended')
    .lt('ended_at', cutoff);

  if (sessionError) {
    return new Response(JSON.stringify({ error: sessionError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  for (const session of expiredSessions || []) {
    const { error: checkpointError } = await supabase.from('checkpoints').delete().eq('session_id', session.id);
    if (checkpointError) {
      console.error('checkpoint cleanup failed', checkpointError.message);
    }

    const { data: screenshotRows } = await supabase.from('screenshots').select('storage_path').eq('session_id', session.id);
    for (const row of screenshotRows || []) {
      if (row.storage_path) {
        await supabase.storage.from('re-session-storage').remove([row.storage_path]);
      }
    }

    await supabase.from('screenshots').delete().eq('session_id', session.id);
    await supabase.from('critical_sessions').delete().eq('id', session.id);
  }

  return new Response(JSON.stringify({ deleted_sessions: expiredSessions?.length || 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
