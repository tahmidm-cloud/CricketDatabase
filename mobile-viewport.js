(function () {
  function setAppViewport() {
    var vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--app-vh', vh + 'px');
    document.documentElement.style.setProperty('--app-width', window.innerWidth + 'px');
    document.documentElement.style.setProperty('--app-height', window.innerHeight + 'px');
  }

  setAppViewport();
  window.addEventListener('resize', setAppViewport, { passive: true });
  window.addEventListener('orientationchange', function () {
    setTimeout(setAppViewport, 120);
  }, { passive: true });
})();
