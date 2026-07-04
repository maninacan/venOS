export type ToastType = 'info' | 'success' | 'warning' | 'error';

// FontAwesome icon per toast type — rendered automatically so callers no longer
// embed ✅/⚠️/❌ emojis in their message strings.
const TOAST_ICONS: Record<ToastType, string> = {
  info: 'fa-circle-info',
  success: 'fa-circle-check',
  warning: 'fa-triangle-exclamation',
  error: 'fa-circle-xmark',
};

let _container: HTMLDivElement | null = null;

function getContainer(): HTMLDivElement {
  if (_container) return _container;
  _container = document.createElement('div');
  _container.id = 'toast-container';
  document.body.appendChild(_container);
  return _container;
}

export function showToast(
  message: string,
  type: ToastType = 'info',
  duration = 3500,
  onRetry?: () => void,
  retryLabel = 'Retry'
) {
  const container = getContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = document.createElement('i');
  icon.className = `fa-solid ${TOAST_ICONS[type]} toast-icon`;
  icon.setAttribute('aria-hidden', 'true');
  toast.appendChild(icon);

  const msg = document.createElement('span');
  msg.textContent = message;
  toast.appendChild(msg);

  if (onRetry) {
    const btn = document.createElement('button');
    btn.className = 'toast-retry';
    btn.textContent = retryLabel;
    btn.addEventListener('click', () => { toast.remove(); onRetry(); });
    toast.appendChild(btn);
    duration = Math.max(duration, 6000);
  }

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}
