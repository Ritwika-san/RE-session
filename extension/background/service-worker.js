importScripts('../lib/supabase-client.js');

const STORAGE_KEYS = {
  session: 're_session_session',
  supabase: 're_session_supabase',
  auth: 're_session_auth',
  captureStatus: 're_session_capture_status',
};

async function readSession() {
  const { [STORAGE_KEYS.session]: session } = await chrome.storage.local.get(STORAGE_KEYS.session);
  return session || null;
}

async function safeStoreUploadedCheckpoint(session, payload) {
  const config = (await chrome.storage.local.get(STORAGE_KEYS.supabase))[STORAGE_KEYS.supabase] || {};
  const supabase = createSupabaseClient(config);
  const { data: { session: authSession } } = await supabase.auth.getSession();
  if (!config.url || !config.anonKey || !config.userId || !authSession?.access_token) {
    console.warn('RE-session: missing auth, checkpoint skipped');
    return;
  }

  try {
    await supabase.from('checkpoints').insert({
        session_id: session.id,
        user_id: config.userId,
        payload,
        captured_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('RE-session checkpoint upload failed', error);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CAPTURE') {
    readSession().then((session) => {
      if (!session) return;
      safeStoreUploadedCheckpoint(session, { summary: 'Form/email snapshot', ...message.payload });
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type === 'CAPTURE_STATUS') {
    chrome.storage.local.set({ [STORAGE_KEYS.captureStatus]: message.payload });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ [STORAGE_KEYS.captureStatus]: { active: false, lastCheckpoint: null } });
});
