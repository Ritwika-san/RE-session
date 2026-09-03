const EXCLUDED_KEYS = ['otp', 'cvv', 'card number', 'cardnumber', 'password'];

function isSensitiveField(field) {
  const name = (field.name || field.id || field.placeholder || '').toLowerCase();
  const value = (field.value || '').toLowerCase();
  if (field.type === 'password') return true;
  if (name.includes('otp') || name.includes('cvv') || name.includes('card number') || name.includes('cardnumber')) return true;
  if (value.includes('otp') || value.includes('cvv') || value.includes('card number') || value.includes('cardnumber')) return true;
  return false;
}

function getFormSnapshot() {
  const form = document.querySelector('form');
  if (!form) return null;

  const entries = Array.from(form.elements).reduce((acc, field) => {
    if (!(field instanceof HTMLElement)) return acc;
    if (field.tagName === 'BUTTON') return acc;
    if (isSensitiveField(field)) return acc;

    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
      acc.push({
        name: field.name || field.id || field.placeholder || 'field',
        type: field.type || field.tagName.toLowerCase(),
        value: field.value,
      });
    }
    return acc;
  }, []);

  return { src: location.href, fields: entries, time: new Date().toISOString() };
}

function sendCapture(data) {
  chrome.runtime.sendMessage({ type: 'CAPTURE', payload: data });
}

function captureSnapshot() {
  const payload = getFormSnapshot();
  if (payload) sendCapture(payload);
}

if (chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'CAPTURE_NOW') captureSnapshot();
  });
}

setInterval(captureSnapshot, 4500);
