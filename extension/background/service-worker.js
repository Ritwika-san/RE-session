importScripts('../lib/supabase-client.js');

const STORAGE_KEYS = {
  session: 're_session_session',
  supabase: 're_session_supabase',
  auth: 're_session_auth',
  captureStatus: 're_session_capture_status',
};
const OFFSCREEN_URL = 'offscreen/offscreen.html';

async function ensureFolderWatcher() {
  if (!chrome.offscreen) return;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)] });
  if (contexts.length === 0) {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['DOM_PARSER'],
      justification: 'Poll the user-selected folder for code checkpoints while the popup is closed.',
    });
  }
}

async function sendFolderWatcherMessage(type) {
  try {
    await ensureFolderWatcher();
    await chrome.runtime.sendMessage({ type });
  } catch (error) {
    console.warn(`RE-session folder watcher ${type} failed`, error);
  }
}

async function readSession() {
  const { [STORAGE_KEYS.session]: session } = await chrome.storage.local.get(STORAGE_KEYS.session);
  return session || null;
}

async function safeStoreUploadedCheckpoint(session, payload) {
  const config = (await chrome.storage.local.get(STORAGE_KEYS.supabase))[STORAGE_KEYS.supabase] || {};
  const supabase = createSupabaseClient(config);
  const { data: { session: authSession } } = await supabase.auth.getSession();
  if (!config.url || !config.anonKey || !config.userId || !authSession?.access_token) {
    await setCaptureError('Extension authentication or Supabase settings are missing');
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
      await setCaptureError(error.message || 'Checkpoint upload failed');
      console.error('RE-session checkpoint upload failed', error);
      return false;
    }
    return true;
  } catch (error) {
    await setCaptureError(error instanceof Error ? error.message : 'Checkpoint upload failed');
    console.error('RE-session checkpoint upload failed', error);
    return false;
  }
}

async function setCaptureError(message) {
  await chrome.storage.local.set({
    [STORAGE_KEYS.captureStatus]: { active: false, lastCheckpoint: null, lastError: message },
  });
}

async function markCheckpointCaptured() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.captureStatus);
  const status = stored[STORAGE_KEYS.captureStatus] || {};
  await chrome.storage.local.set({
    [STORAGE_KEYS.captureStatus]: { ...status, active: true, lastCheckpoint: new Date().toISOString() },
  });
}

async function setScreenshotStatus({ lastScreenshot, lastError = null }) {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.captureStatus);
  const status = stored[STORAGE_KEYS.captureStatus] || {};
  await chrome.storage.local.set({
    [STORAGE_KEYS.captureStatus]: { ...status, active: true, lastScreenshot, lastError },
  });
}

async function captureAndUploadScreenshot(session, tab, supabase) {
  if (tab?.windowId === undefined) {
    await setScreenshotStatus({ lastScreenshot: null, lastError: 'No browser tab was available for screenshot capture' });
    return false;
  }

  try {
    if (!tab.url || /^(chrome|edge|about|devtools):\/\//i.test(tab.url)) {
      throw new Error(`The active page cannot be captured: ${tab.url || 'unknown URL'}`);
    }
    const window = await chrome.windows.get(tab.windowId);
    if (!window.focused) {
      throw new Error(`The target window is not focused (window ${tab.windowId})`);
    }
    const currentTab = tab.id === undefined ? tab : await chrome.tabs.get(tab.id);
    if (!currentTab.active) {
      throw new Error(`The target tab is not active in window ${tab.windowId}`);
    }
    console.info('RE-session capturing visible tab', { tabId: currentTab.id, windowId: tab.windowId, url: tab.url });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const imageResponse = await fetch(dataUrl);
    const image = await imageResponse.arrayBuffer();
    const path = `${session.userId}/${session.id}/${Date.now()}.png`;
    const upload = await supabase.storage.from('re-session-storage').upload(path, image, 'image/png');
    if (upload.error) throw new Error(upload.error.message || 'Screenshot upload failed');

    const config = (await chrome.storage.local.get(STORAGE_KEYS.supabase))[STORAGE_KEYS.supabase] || {};
    const { error } = await supabase.from('screenshots').insert({
      session_id: session.id,
      user_id: config.userId,
      storage_path: path,
      captured_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message || 'Screenshot metadata insert failed');
    await setScreenshotStatus({ lastScreenshot: new Date().toISOString() });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Screenshot capture or upload failed';
    await setScreenshotStatus({ lastScreenshot: null, lastError: message });
    console.error('RE-session screenshot capture failed', { tabId: tab?.id, windowId: tab?.windowId, url: tab?.url, error });
    return false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CAPTURE') {
    (async () => {
      try {
        const session = await readSession();
        if (!session) {
          await setCaptureError('No active extension session found');
          sendResponse({ ok: false, error: 'No active extension session found' });
          return;
        }
        const stored = await chrome.storage.local.get(STORAGE_KEYS.supabase);
        const supabase = createSupabaseClient(stored[STORAGE_KEYS.supabase] || {});
        const [checkpointUploaded, screenshotUploaded] = await Promise.all([
          safeStoreUploadedCheckpoint(session, { summary: 'Form/email snapshot', ...message.payload }),
          captureAndUploadScreenshot(session, sender?.tab, supabase),
        ]);
        if (checkpointUploaded) await markCheckpointCaptured();
        sendResponse({ ok: checkpointUploaded || screenshotUploaded, checkpointUploaded, screenshotUploaded });
      } catch (error) {
        console.error('RE-session capture handler failed', error);
        await setCaptureError(error instanceof Error ? error.message : 'Capture failed');
        sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Capture failed' });
      }
    })();
    return true;
  }

  if (message?.type === 'FILE_CHECKPOINT') {
    (async () => {
      const session = await readSession();
      if (!session) return sendResponse({ ok: false, error: 'No active extension session found' });
      const uploaded = await safeStoreUploadedCheckpoint(session, message.payload);
      if (uploaded) await markCheckpointCaptured();
      sendResponse({ ok: uploaded });
    })().catch((error) => {
      console.error('RE-session file checkpoint handler failed', error);
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'File checkpoint failed' });
    });
    return true;
  }

  if (message?.type === 'START_FOLDER_WATCH') {
    void sendFolderWatcherMessage('START_FOLDER_WATCH');
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'STOP_FOLDER_WATCH') {
    void sendFolderWatcherMessage('STOP_FOLDER_WATCH');
    sendResponse({ ok: true });
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

chrome.runtime.onStartup.addListener(async () => {
  const session = await readSession();
  if (session && ['code', 'autosave'].includes(session.category)) {
    await sendFolderWatcherMessage('START_FOLDER_WATCH');
  }
});
