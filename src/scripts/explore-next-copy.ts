const TOAST_ID = 'next-research-copy-toast';
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function decodeCopyText(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function getToast(): HTMLElement {
  let toast = document.getElementById(TOAST_ID);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = TOAST_ID;
    toast.className = 'copy-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.hidden = true;
    document.body.appendChild(toast);
  }
  return toast;
}

function showToast(message: string) {
  const toast = getToast();
  toast.textContent = message;
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('copy-toast--visible'));

  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    toast.classList.remove('copy-toast--visible');
    setTimeout(() => {
      toast.hidden = true;
    }, 300);
  }, 2600);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  }
}

let initialized = false;

function initExploreNextCopy() {
  if (initialized) return;
  initialized = true;

  document.addEventListener('click', async (e) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('.explore-next-copy-btn');
    if (!btn) return;

    const b64 = btn.dataset.copyTextB64;
    const toastMsg = btn.dataset.copyToast;
    if (!b64 || !toastMsg) return;

    const text = decodeCopyText(b64);
    const ok = await copyText(text);
    if (ok) showToast(toastMsg);
  });
}

initExploreNextCopy();
