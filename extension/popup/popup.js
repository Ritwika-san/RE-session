const STORAGE_KEYS = {
  session: 're_session_session',
  supabase: 're_session_supabase',
  captureStatus: 're_session_capture_status',
};
const DIRECTORY_DB_NAME = 're-session-extension';
const DIRECTORY_STORE_NAME = 'handles';
const DIRECTORY_HANDLE_KEY = 'directory';

const elements = {
  taskName: document.getElementById('taskName'),
  category: document.getElementById('category'),
  toggleSession: document.getElementById('toggleSession'),
  setupControls: document.getElementById('setupControls'),
  deleteSession: document.getElementById('deleteSession'),
  sessionState: document.getElementById('sessionState'),
  lastCheckpoint: document.getElementById('lastCheckpoint'),
  captureInfo: document.getElementById('captureInfo'),
  errorPanel: document.getElementById('errorPanel'),
  errorText: document.getElementById('errorText'),
  openSettings: document.getElementById('openSettings'),
  authView: document.getElementById('authView'),
  mainView: document.getElementById('mainView'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  signIn: document.getElementById('signIn'),
  signOut: document.getElementById('signOut'),
  openSettingsFromAuth: document.getElementById('openSettingsFromAuth'),
  authErrorPanel: document.getElementById('authErrorPanel'),
  authErrorText: document.getElementById('authErrorText'),
  folderControls: document.getElementById('folderControls'),
  chooseFolder: document.getElementById('chooseFolder'),
  folderStatus: document.getElementById('folderStatus'),
  activeSession: document.getElementById('activeSession'),
  activeTask: document.getElementById('activeTask'),
  activeMeta: document.getElementById('activeMeta'),
  activeCheckpoint: document.getElementById('activeCheckpoint'),
  activeCapture: document.getElementById('activeCapture'),
  endActiveSession: document.getElementById('endActiveSession'),
};

let directoryHandle = null;
let authSession = null;
let displayRefreshTimer = null;

function openDirectoryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DIRECTORY_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open folder storage.'));
  });
}

async function loadDirectoryHandle() {
  const database = await openDirectoryDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DIRECTORY_STORE_NAME, 'readonly')
      .objectStore(DIRECTORY_STORE_NAME)
      .get(DIRECTORY_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Unable to read folder storage.'));
  });
}

async function saveDirectoryHandle(handle) {
  const database = await openDirectoryDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DIRECTORY_STORE_NAME, 'readwrite')
      .objectStore(DIRECTORY_STORE_NAME)
      .put(handle, DIRECTORY_HANDLE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error('Unable to save the selected folder.'));
  });
}

function isFolderCategory() {
  return ['code', 'autosave'].includes(elements.category.value);
}

async function refreshFolderPermission({ requestPermission = false } = {}) {
  if (!directoryHandle) {
    elements.folderStatus.textContent = 'No folder selected.';
    elements.folderStatus.className = 'mini folder-status';
    return false;
  }

  let permission = await directoryHandle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted' && requestPermission) {
    try {
      permission = await directoryHandle.requestPermission({ mode: 'readwrite' });
    } catch {
      permission = 'denied';
    }
  }

  if (permission === 'granted') {
    elements.folderStatus.textContent = `Folder ready: ${directoryHandle.name}`;
    elements.folderStatus.className = 'mini folder-status ok';
    return true;
  }

  elements.folderStatus.textContent = 'Folder permission needed. Choose the folder again.';
  elements.folderStatus.className = 'mini folder-status danger';
  return false;
}

async function restoreDirectoryHandle() {
  if (!window.indexedDB || !window.showDirectoryPicker) {
    elements.folderStatus.textContent = 'Folder access is unavailable in this browser.';
    elements.folderStatus.className = 'mini folder-status danger';
    return;
  }

  try {
    directoryHandle = await loadDirectoryHandle();
    await refreshFolderPermission({ requestPermission: true });
  } catch (error) {
    directoryHandle = null;
    elements.folderStatus.textContent = error instanceof Error ? error.message : 'Unable to restore folder access.';
    elements.folderStatus.className = 'mini folder-status danger';
  }
}

async function syncFolderUi() {
  const shouldShow = isFolderCategory();
  elements.folderControls.style.display = shouldShow ? 'grid' : 'none';
  if (shouldShow) await refreshFolderPermission();
}

async function chooseFolder() {
  if (!window.showDirectoryPicker) {
    elements.folderStatus.textContent = 'Folder access is unavailable in this browser.';
    elements.folderStatus.className = 'mini folder-status danger';
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await saveDirectoryHandle(handle);
    directoryHandle = handle;
    await refreshFolderPermission({ requestPermission: true });
  } catch (error) {
    if (error.name !== 'AbortError') {
      elements.folderStatus.textContent = error instanceof Error ? error.message : 'Unable to choose a folder.';
      elements.folderStatus.className = 'mini folder-status danger';
    }
  }
}

function setError(message) {
  elements.errorPanel.style.display = 'block';
  elements.errorText.textContent = message;
}

function clearError() {
  elements.errorPanel.style.display = 'none';
  elements.errorText.textContent = '';
}

async function loadSupabaseConfig() {
  const config = await chrome.storage.local.get(STORAGE_KEYS.supabase);
  return config[STORAGE_KEYS.supabase] || { url: '', anonKey: '', userId: '' };
}

async function loadAuthSession() {
  const config = await loadSupabaseConfig();
  if (!config.url || !config.anonKey) return null;
  const supabase = createSupabaseClient(config);
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

function setAuthError(message) {
  elements.authErrorPanel.style.display = 'block';
  elements.authErrorText.textContent = message;
}

function clearAuthError() {
  elements.authErrorPanel.style.display = 'none';
  elements.authErrorText.textContent = '';
}

async function signInWithPassword(email, password) {
  const config = await loadSupabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new Error('Add the Supabase URL and anon key in Settings first.');
  }

  const supabase = createSupabaseClient(config);
  const { data } = await supabase.auth.signInWithPassword({ email, password });
  await chrome.storage.local.set({
    [STORAGE_KEYS.supabase]: { ...config, userId: data.session.user.id },
  });
}

async function syncAuthUi() {
  authSession = await loadAuthSession();
  const isSignedIn = Boolean(authSession?.access_token && authSession?.user?.id);
  elements.authView.style.display = isSignedIn ? 'none' : 'grid';
  elements.mainView.style.display = isSignedIn ? 'block' : 'none';
  elements.sessionState.textContent = isSignedIn ? 'Signed in' : 'Signed out';
  elements.sessionState.classList.toggle('ok', isSignedIn);
  elements.toggleSession.disabled = !isSignedIn;
  return isSignedIn;
}

async function checkSessionState() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.session, STORAGE_KEYS.captureStatus]);
  const session = stored[STORAGE_KEYS.session] || null;
  const captureStatus = stored[STORAGE_KEYS.captureStatus] || {};
  const sessionState = session || null;
  const isActive = Boolean(sessionState);
  elements.sessionState.textContent = isActive ? 'Active session' : 'Signed in';
  elements.sessionState.classList.toggle('ok', isActive);
  elements.toggleSession.textContent = isActive ? 'End session' : 'Start session';
  elements.setupControls.style.display = isActive ? 'none' : 'block';
  elements.activeSession.style.display = isActive ? 'block' : 'none';
  elements.captureInfo.textContent = isActive ? 'Capturing code, form, email, and screenshot updates' : 'No active capture';
  if (isActive) {
    elements.activeTask.textContent = sessionState.taskName;
    elements.activeMeta.textContent = `${formatCategory(sessionState.category)} · Started ${formatTime(sessionState.startedAt)}`;
    elements.activeCheckpoint.textContent = formatCheckpoint(captureStatus.lastCheckpoint);
    elements.activeCapture.textContent = captureStatus.lastError
      ? `Error: ${captureStatus.lastError}`
      : captureStatus.lastScreenshot ? `Capturing · Screenshot ${formatCheckpoint(captureStatus.lastScreenshot)}`
        : captureStatus.active ? 'Capturing' : 'Waiting';
  }
}

function formatCategory(category) {
  return { doc_notion: 'Doc / Notion', autosave: 'Autosave' }[category] || `${category.charAt(0).toUpperCase()}${category.slice(1)}`;
}

function formatTime(value) {
  if (!value) return 'unknown time';
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatCheckpoint(value) {
  if (!value) return 'Waiting...';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

async function syncUi() {
  if (!await syncAuthUi()) return;
  await checkSessionState();
  const config = await loadSupabaseConfig();
  if (!config.url || !config.anonKey) {
    setError('Add the Supabase URL and anon key in Settings before starting a session.');
    return;
  }
  clearError();
}

async function startSession() {
  if (!await syncAuthUi()) {
    setError('Sign in before starting a Critical Session.');
    return;
  }

  const taskName = elements.taskName.value.trim();
  const category = elements.category.value;
  if (!taskName) {
    setError('Enter a task name before starting a Critical Session.');
    return;
  }

  const config = await loadSupabaseConfig();
  if (!config.url || !config.anonKey || !authSession?.user?.id) {
    setError('Sign in before starting a Critical Session.');
    return;
  }

  const session = {
    id: crypto.randomUUID(),
    taskName,
    category,
    startedAt: new Date().toISOString(),
    status: 'active',
    userId: authSession.user.id,
  };

  const supabase = createSupabaseClient(config);
  await supabase.from('critical_sessions').insert({
    id: session.id,
    task_name: session.taskName,
    category: session.category,
    status: session.status,
    started_at: session.startedAt,
    user_id: session.userId,
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: session });
  await chrome.storage.local.set({ [STORAGE_KEYS.captureStatus]: { active: true, lastCheckpoint: null } });
  elements.lastCheckpoint.textContent = 'Waiting for first checkpoint';
  await checkSessionState();
  clearError();
}

async function endSession() {
  const session = (await chrome.storage.local.get(STORAGE_KEYS.session))[STORAGE_KEYS.session];
  if (!session) {
    setError('No active session to end.');
    return;
  }

  const endedSession = { ...session, status: 'ended', endedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STORAGE_KEYS.session]: null });
  await chrome.storage.local.set({ [STORAGE_KEYS.captureStatus]: { active: false, lastCheckpoint: null } });
  elements.lastCheckpoint.textContent = 'No checkpoint yet';
  clearError();

  try {
    const config = await loadSupabaseConfig();
    const supabase = createSupabaseClient(config);
    await supabase.from('critical_sessions').update(
      { status: 'ended', ended_at: endedSession.endedAt },
      `id=eq.${endedSession.id}`,
    );
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Connection failed');
  }
}

async function registerEvents() {
  elements.category.addEventListener('change', syncFolderUi);
  elements.chooseFolder.addEventListener('click', chooseFolder);
  elements.openSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
  elements.openSettingsFromAuth.addEventListener('click', () => chrome.runtime.openOptionsPage());
  elements.signIn.addEventListener('click', async () => {
    const email = elements.authEmail.value.trim();
    const password = elements.authPassword.value;
    if (!email || !password) {
      setAuthError('Enter your email and password.');
      return;
    }
    elements.signIn.disabled = true;
    clearAuthError();
    try {
      await signInWithPassword(email, password);
      elements.authPassword.value = '';
      await syncUi();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Unable to sign in');
    } finally {
      elements.signIn.disabled = false;
    }
  });
  elements.signOut.addEventListener('click', async () => {
    const config = await loadSupabaseConfig();
    if (config.url && config.anonKey) {
      await createSupabaseClient(config).auth.signOut();
    }
    await syncUi();
  });
  elements.toggleSession.addEventListener('click', async () => {
    const sessionData = (await chrome.storage.local.get(STORAGE_KEYS.session))[STORAGE_KEYS.session];
    if (sessionData) {
      await endSession();
    } else {
      await startSession();
    }
  });
  elements.endActiveSession.addEventListener('click', endSession);
}

window.addEventListener('DOMContentLoaded', async () => {
  await registerEvents();
  await restoreDirectoryHandle();
  await syncFolderUi();
  await syncUi();
  displayRefreshTimer = setInterval(() => {
    void checkSessionState();
  }, 1000);
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && (changes[STORAGE_KEYS.session] || changes[STORAGE_KEYS.captureStatus])) {
      void checkSessionState();
    }
  });
});
