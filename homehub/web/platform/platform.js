// Platform abstraction: every device-specific capability goes through here.
// UI code never touches Notification / window.open / Capacitor directly, so the
// native app (Capacitor) only needs to change THIS file, not the screens.
import { settings } from '../core/settings.js';

export const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

export function openExternal(url) {
  // custom schemes (upi://) must navigate the current context on mobile
  if (/^(upi|tel|mailto):/i.test(url)) location.href = url;
  else window.open(url, '_blank', 'noopener');
}

/** Build a payment link for a record: provider portal first, UPI deep link otherwise. */
export function paymentLink(rec) {
  if (rec.payUrl) return rec.payUrl;
  if (rec.upiId && settings.get().currency === 'INR') {
    const q = new URLSearchParams({
      pa: rec.upiId,
      pn: rec.provider || rec.name || 'Payee',
      am: String(rec.amount ?? ''),
      cu: 'INR',
      tn: rec.name || 'Home bill',
    });
    return 'upi://pay?' + q.toString();
  }
  return null;
}

export async function downloadFile(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---- reminders ----
export const notificationsSupported = () => isNative() || 'Notification' in window;

export async function requestNotifyPermission() {
  try {
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (isNative() && LN) return (await LN.requestPermissions()).display === 'granted';
    if ('Notification' in window) return (await Notification.requestPermission()) === 'granted';
  } catch {
    /* fallthrough */
  }
  return false;
}

export async function notify(title, body, id = Date.now() % 2147483647) {
  try {
    const LN = window.Capacitor?.Plugins?.LocalNotifications;
    if (isNative() && LN) {
      await LN.schedule({ notifications: [{ id, title, body, schedule: { at: new Date(Date.now() + 1000) } }] });
      return;
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: String(id) });
      else new Notification(title, { body });
    }
  } catch {
    /* notifications are best-effort */
  }
}
