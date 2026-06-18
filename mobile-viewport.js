(function () {
  function setAppViewport() {
    var vv = window.visualViewport;
    var w = Math.round((vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 0);
    var h = Math.round((vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 0);
    var vh = h * 0.01;

    document.documentElement.style.setProperty('--app-vh', vh + 'px');
    document.documentElement.style.setProperty('--app-width', w + 'px');
    document.documentElement.style.setProperty('--app-height', h + 'px');

    var isPhone = w <= 480;
    document.documentElement.classList.toggle('phone-viewport', isPhone);
    document.body && document.body.classList.toggle('phone-viewport', isPhone);
  }

  setAppViewport();
  window.addEventListener('resize', setAppViewport, { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', setAppViewport, { passive: true });
    window.visualViewport.addEventListener('scroll', setAppViewport, { passive: true });
  }
  window.addEventListener('orientationchange', function () {
    setTimeout(setAppViewport, 80);
    setTimeout(setAppViewport, 250);
  }, { passive: true });
})();
