import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

Deno.serve(async (req: Request) => {
  try {
    const { session_id } = await req.json();

    if (!session_id) {
      return new Response(JSON.stringify({ error: 'Missing session_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase config' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') || '' } },
    });

    const { data: sessionData, error: sessionError } = await supabase
      .from('critical_sessions')
      .select('id, user_id, category, status, task_name, started_at, ended_at')
      .eq('id', session_id)
      .single();

    if (sessionError || !sessionData) {
      return new Response(JSON.stringify({ error: 'Session not found or not accessible' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (sessionData.status === 'ended') {
      return new Response(JSON.stringify({ error: 'This session has already ended and cannot be recovered.' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: checkpointRows, error: checkpointError } = await supabase
      .from('checkpoints')
      .select('*')
      .eq('session_id', session_id)
      .order('captured_at', { ascending: false })
      .limit(10);

    if (checkpointError) {
      return new Response(JSON.stringify({ error: 'Failed to load checkpoints' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const latestCheckpoint = checkpointRows?.[0]?.payload || {};
    const lastCheckpointTime = checkpointRows?.[0]?.captured_at || null;
    const latestScreenshot = await supabase
      .from('screenshots')
      .select('storage_path')
      .eq('session_id', session_id)
      .order('captured_at', { ascending: false })
      .limit(1)
      .single();

    const screenshotPath = latestScreenshot.data?.storage_path || null;
    const screenshotUrl = screenshotPath
      ? await getSignedUrl(supabase, screenshotPath)
      : null;

    const hasCheckpoint = Boolean(checkpointRows?.length);
    const freshness = hasCheckpoint ? clamp(100 - getAgeInMinutes(lastCheckpointTime), 0, 100) : 0;
    const completeness = hasCheckpoint ? 88 : 0;
    const readinessScore = hasCheckpoint
      ? Math.round((freshness * 0.6) + (completeness * 0.4))
      : 0;

    const briefing = await generateBriefing(latestCheckpoint, sessionData.task_name, sessionData.category);

    return new Response(JSON.stringify({
      category: sessionData.category,
      readiness_score: readinessScore,
      briefing_text: briefing,
      checkpoint_data: latestCheckpoint,
      latest_screenshot_url: screenshotUrl,
      last_checkpoint_ago: lastCheckpointTime ? formatRelative(lastCheckpointTime) : null,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

async function getSignedUrl(supabase: any, storagePath: string) {
  const { data, error } = await supabase.storage.from('re-session-storage').createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getAgeInMinutes(timestamp: string | null) {
  if (!timestamp) return 1000;
  const diffMs = Date.now() - new Date(timestamp).getTime();
  return diffMs / 60000;
}

function formatRelative(timestamp: string) {
  const diffSeconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  if (diffSeconds < 3600) return `${Math.round(diffSeconds / 60)}m ago`;
  return `${Math.round(diffSeconds / 3600)}h ago`;
}

async function generateBriefing(checkpoint: any, taskName: string, category: string) {
  if (!checkpoint || Object.keys(checkpoint).length === 0) {
    return `No checkpoint has been captured yet for ${taskName} in the ${category} lane.`;
  }

  const summary = checkpoint?.summary || checkpoint?.draft || 'No detailed checkpoint summary was captured.';
  const prompt = `You are helping a user recover a task. Explain in plain language what they were doing, with 2-3 sentences. Task: ${taskName}. Category: ${category}. Latest checkpoint summary: ${summary}`;

  const apiKey = Deno.env.get('OPENAI_API_KEY') || Deno.env.get('LLM_API_KEY');
  if (!apiKey) {
    return `You were working on ${taskName} in the ${category} lane. The last saved checkpoint suggests the task was in progress and the next step is to continue from the latest saved state.`;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 120,
    }),
  });

  if (!response.ok) {
    return `You were working on ${taskName} in the ${category} lane. The last saved checkpoint suggests the task was in progress and the next step is to continue from the latest saved state.`;
  }

  const json = await response.json();
  return json.choices?.[0]?.message?.content?.trim() || `You were working on ${taskName} in the ${category} lane.`;
}
