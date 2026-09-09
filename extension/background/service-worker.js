importScripts('../lib/supabase-client.js');

const STORAGE_KEYS = {
  session: 're_session_session',
  supabase: 're_session_supabase',
  auth: 're_session_auth',
  captureStatus: 're_session_capture_status',
};
const OFFSCREEN_URL = 'offscreen/offscreen.html';
const SCREENSHOT_ALARM = 're-session-screenshot';

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
    await chrome.runtime.sendMessage({ type: 'FOLDER_WATCH_COMMAND', command: type });
  } catch (error) {
    console.warn(`RE-session folder watcher ${type} failed`, error);
  }
}

async function captureActiveScreenshot() {
  const session = await readSession();
  if (!session) return;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.supabase);
  const supabase = createSupabaseClient(stored[STORAGE_KEYS.supabase] || {});
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  await captureScreenshotWithRetry(session, activeTabs[0], supabase);
}

async function captureSessionStart() {
  const session = await readSession();
  if (!session) return;
  const stored = await chrome.storage.local.get(STORAGE_KEYS.supabase);
  const supabase = createSupabaseClient(stored[STORAGE_KEYS.supabase] || {});
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = activeTabs[0];
  const checkpointUploaded = await safeStoreUploadedCheckpoint(session, {
    category: session.category,
    application: session.application || 'browser',
    summary: `Session started in ${session.application || 'browser'}`,
    src: tab?.url || null,
    title: tab?.title || null,
    time: new Date().toISOString(),
  });
  if (checkpointUploaded) await markCheckpointCaptured();
  await captureScreenshotWithRetry(session, tab, supabase);
}

async function captureScreenshotWithRetry(session, tab, supabase) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await captureAndUploadScreenshot(session, tab, supabase)) return true;
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function readSession() {
  const { [STORAGE_KEYS.session]: session } = await chrome.storage.local.get(STORAGE_KEYS.session);
  return session || null;
}

async function safeStoreUploadedCheckpoint(session, payload) {
  const config = (await chrome.storage.local.get(STORAGE_KEYS.supabase))[STORAGE_KEYS.supabase] || {};
  const supabase = createSupabaseClient(config);
  const { data: { session: authSession } } = await supabase.auth.getSession();
  if (!config.url || !config.anonKey || !authSession?.access_token || !authSession.user?.id) {
    await setCaptureError('Extension authentication or Supabase settings are missing');
    console.warn('RE-session: missing auth, checkpoint skipped');
    return false;
  }

  try {
    const { error } = await supabase.from('checkpoints').insert({
      session_id: session.id,
      user_id: authSession.user.id,
      payload,
      captured_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message || 'Checkpoint insert failed');
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
    [STORAGE_KEYS.captureStatus]: { ...status, active: true, lastScreenshot: lastScreenshot || status.lastScreenshot || null, lastError },
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
    if (window.state === 'minimized') {
      throw new Error(`The target window is minimized (window ${tab.windowId})`);
    }
    // Deliberately NOT requiring the browser window/tab to be focused or
    // active - the whole point is capturing state while the user has switched
    // to VS Code or another app. captureVisibleTab works on a background
    // window as long as it's visible on screen, and the <all_urls> host
    // permission already covers the gesture requirement.
    const currentTab = tab.id === undefined ? tab : await chrome.tabs.get(tab.id);
    console.info('RE-session capturing visible tab', { tabId: currentTab.id, windowId: tab.windowId, url: tab.url });
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const imageResponse = await fetch(dataUrl);
    const image = await imageResponse.arrayBuffer();
    const path = `${session.userId}/${session.id}/${Date.now()}.png`;
    const upload = await supabase.storage.from('re-session-storage').upload(path, image, 'image/png');
    if (upload.error) throw new Error(upload.error.message || 'Screenshot upload failed');

    const config = (await chrome.storage.local.get(STORAGE_KEYS.supabase))[STORAGE_KEYS.supabase] || {};
    const { data: { session: authSession } } = await supabase.auth.getSession();
    const { error } = await supabase.from('screenshots').insert({
      session_id: session.id,
      user_id: authSession?.user?.id || config.userId,
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
        const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        const captureTab = activeTabs[0] || sender?.tab;
        const [checkpointUploaded, screenshotUploaded] = await Promise.all([
          safeStoreUploadedCheckpoint(session, { summary: 'Form/email snapshot', ...message.payload }),
          captureScreenshotWithRetry(session, captureTab, supabase),
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
    chrome.alarms.create(SCREENSHOT_ALARM, { periodInMinutes: 0.25 });
    void sendFolderWatcherMessage('START_FOLDER_WATCH');
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'START_CAPTURE') {
    chrome.alarms.create(SCREENSHOT_ALARM, { periodInMinutes: 0.5 });
    void captureSessionStart();
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'STOP_FOLDER_WATCH') {
    chrome.alarms.clear(SCREENSHOT_ALARM);
    void sendFolderWatcherMessage('STOP_FOLDER_WATCH');
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === 'STOP_CAPTURE') {
    chrome.alarms.clear(SCREENSHOT_ALARM);
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
  if (session) {
    chrome.alarms.create(SCREENSHOT_ALARM, { periodInMinutes: 0.5 });
    void captureSessionStart();
  }
  if (session && ['code', 'autosave'].includes(session.category)) {
    await sendFolderWatcherMessage('START_FOLDER_WATCH');
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCREENSHOT_ALARM) void captureActiveScreenshot();
});
