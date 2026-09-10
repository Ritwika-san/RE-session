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
  if (!form) {
    return {
      src: location.href,
      source: location.hostname,
      title: document.title,
      time: new Date().toISOString(),
    };
  }

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

  return { src: location.href, source: location.hostname, fields: entries, time: new Date().toISOString() };
}

function sendCapture(data) {
  chrome.runtime.sendMessage({ type: 'CAPTURE', payload: data }, () => {
    if (chrome.runtime.lastError) {
      console.warn('RE-session capture message failed:', chrome.runtime.lastError.message);
    }
  });
}

function captureSnapshot() {
  const payload = getFormSnapshot();
  if (payload) sendCapture(payload);
}

if (chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'CAPTURE_NOW') captureSnapshot();
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'REFILL_FORM') return false;

    const form = document.querySelector('form');
    const fields = Array.isArray(message.payload?.fields) ? message.payload.fields : [];
    if (!form) {
      sendResponse({ success: false, error: 'no_form_found' });
      return false;
    }

    const controls = Array.from(form.elements).filter((field) =>
      field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement,
    );
    let filledCount = 0;
    for (const field of fields) {
      const fieldName = String(field?.name || '');
      const control = controls.find((candidate) => candidate.name === fieldName)
        || controls.find((candidate) => candidate.id === fieldName)
        || controls.find((candidate) => candidate.getAttribute('placeholder') === fieldName);
      if (!control || isSensitiveField(control)) continue;
      control.value = field.value == null ? '' : String(field.value);
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      filledCount += 1;
    }
    sendResponse({ success: filledCount > 0 });
    return false;
  });
}

captureSnapshot();
setInterval(captureSnapshot, 4500);
