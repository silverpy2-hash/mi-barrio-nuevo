// Public, non-secret settings for Mi Barrio IA.
// The endpoint lives on the same Vercel deployment by default. Change it only
// if the mobile TPV is served from a different origin than /api.
window.MBIA_CONFIG = Object.freeze({
    endpoint: '/api/mi-barrio-ia',
    enabled: true,
});
