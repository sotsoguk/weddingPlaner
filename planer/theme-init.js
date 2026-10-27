// Design so früh wie möglich setzen, damit beim Laden kein heller Blitz entsteht.
(function () {
  var theme = null;
  var scheme = null;
  try {
    var raw = localStorage.getItem('wedding-tischplaner-admin-v1');
    if (raw) {
      var saved = JSON.parse(raw);
      theme = saved && saved.settings && saved.settings.theme;
      scheme = saved && saved.settings && saved.settings.scheme;
    }
  } catch (err) { /* localStorage nicht verfügbar */ }
  if (theme !== 'dark' && theme !== 'light') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  var schemes = ['sage', 'ozean', 'rose', 'lavendel', 'graphit', 'terrakotta'];
  if (schemes.indexOf(scheme) === -1) scheme = 'sage';
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.scheme = scheme;
  document.documentElement.style.colorScheme = theme;
})();
