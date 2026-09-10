const DIRECTORY_DB_NAME = 're-session-extension';
const DIRECTORY_STORE_NAME = 'handles';
const DIRECTORY_HANDLE_KEY = 'directory';
const CODE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.vue', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.html', '.css', '.json', '.md']);
let watchTimer = null;
let lastCheckpoint = '';

function openDirectoryDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DIRECTORY_DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open folder storage.'));
  });
}

async function loadDirectoryHandle() {
  const database = await openDirectoryDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DIRECTORY_STORE_NAME, 'readonly').objectStore(DIRECTORY_STORE_NAME).get(DIRECTORY_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('Unable to read folder storage.'));
  });
}

async function collectFiles(directory, prefix = '') {
  const files = [];
  for await (const [name, entry] of directory.entries()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    if (entry.kind === 'file') {
      const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
      if (CODE_EXTENSIONS.has(extension)) files.push({ entry, path: `${prefix}${name}` });
    } else if (entry.kind === 'directory') {
      files.push(...await collectFiles(entry, `${prefix}${name}/`));
    }
  }
  return files;
}

async function readLatestCodeCheckpoint() {
  const directory = await loadDirectoryHandle();
  if (!directory) return null;
  const permission = await directory.queryPermission({ mode: 'read' });
  if (permission !== 'granted') throw new Error('Selected folder permission is no longer granted. Choose the folder again.');
  const files = await collectFiles(directory);
  let latest = null;
  for (const file of files) {
    const value = await file.entry.getFile();
    if (!latest || value.lastModified > latest.modified) {
      latest = { path: file.path, content: await value.text(), modified: value.lastModified };
    }
  }
  return latest;
}

async function pollFolder() {
  try {
    const latest = await readLatestCodeCheckpoint();
    if (!latest) return;
    const fingerprint = `${latest.path}:${latest.modified}:${latest.content.length}`;
    if (fingerprint === lastCheckpoint) return;
    lastCheckpoint = fingerprint;
    console.info('RE-session code checkpoint detected', { path: latest.path, modified: latest.modified });
    chrome.runtime.sendMessage({
      type: 'FILE_CHECKPOINT',
      payload: { category: 'code', source: 'VS Code', summary: `Latest file: ${latest.path}`, draft: latest.content, file_path: latest.path, modified_at: new Date(latest.modified).toISOString() },
    }).catch((error) => console.error('RE-session code checkpoint send failed', error));
  } catch (error) {
    console.error('RE-session folder checkpoint poll failed', error);
  }
}

function startWatching() {
  if (watchTimer) return;
  void pollFolder();
  watchTimer = setInterval(() => void pollFolder(), 3000);
}

function stopWatching() {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
  lastCheckpoint = '';
}

async function writeFileCommand(payload) {
  try {
    const directory = await loadDirectoryHandle();
    if (!directory) return { success: false, error: 'no_folder_selected' };

    const permission = await directory.queryPermission({ mode: 'readwrite' });
    if (permission !== 'granted') return { success: false, error: 'permission_not_granted' };

    const files = await collectFiles(directory);
    const matchingFile = files.find((file) => file.path === payload?.file_path);
    const fileHandle = matchingFile?.entry || await directory.getFileHandle(payload.file_path, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(payload.content);
    await writable.close();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'FOLDER_WATCH_COMMAND' && message.command === 'START_FOLDER_WATCH') startWatching();
  if (message?.type === 'FOLDER_WATCH_COMMAND' && message.command === 'STOP_FOLDER_WATCH') stopWatching();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'WRITE_FILE_COMMAND') return false;
  writeFileCommand(message.payload).then(sendResponse);
  return true;
});