// Mi Barrio - TPV Celular: public push settings ONLY. No private keys, no secrets.
// Push is DISABLED by default. To enable it later (after the backend functions are
// deployed and you accept the cost, see README.md), fill vapidKey with the PUBLIC
// Web Push certificate from Firebase Console > Cloud Messaging > Web configuration
// and set enabled: true. Never put private keys or service account credentials here.
window.TPV_PUSH_CONFIG = {
    enabled: false,
    // Public VAPID/Web Push certificate key (starts with "B"). Public by design.
    vapidKey: '',
};
