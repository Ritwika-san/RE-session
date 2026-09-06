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
    return false;
  }

  try {
    const { error } = await supabase.from('checkpoints').insert({
      session_id: session.id,
      user_id: config.userId,
      payload,
      captured_at: new Date().toISOString(),
    });
    if (error) {
      console.error('RE-session checkpoint upload failed', error);
      return false;
    }
    return true;
  } catch (error) {
    console.error('RE-session checkpoint upload failed', error);
    return false;
  }
}

async function markCheckpointCaptured() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.captureStatus]: { active: true, lastCheckpoint: new Date().toISOString() },
  });
}

async function captureAndUploadScreenshot(session, tab, supabase) {
  if (!tab?.windowId) return;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const imageResponse = await fetch(dataUrl);
    const image = await imageResponse.arrayBuffer();
    const path = `${session.userId}/${session.id}/${Date.now()}.png`;
    const upload = await supabase.storage.from('re-session-storage').upload(path, image, 'image/png');
    if (upload.error) throw new Error(upload.error.message || 'Screenshot upload failed');

    const config = (await chrome.storage.local.get(STORAGE_KEYS.supabase))[STORAGE_KEYS.supabase] || {};
    await supabase.from('screenshots').insert({
      session_id: session.id,
      user_id: config.userId,
      storage_path: path,
      captured_at: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('RE-session screenshot capture failed', error);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CAPTURE') {
    readSession().then((session) => {
      if (!session) return;
      const config = chrome.storage.local.get(STORAGE_KEYS.supabase);
      config.then((stored) => {
        const supabase = createSupabaseClient(stored[STORAGE_KEYS.supabase] || {});
        void safeStoreUploadedCheckpoint(session, { summary: 'Form/email snapshot', ...message.payload })
          .then((uploaded) => uploaded && markCheckpointCaptured());
        void captureAndUploadScreenshot(session, sender?.tab, supabase);
      });
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
