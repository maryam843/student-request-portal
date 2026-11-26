// Small scripts for the logged-in pages. They are in this file, not in onclick="..."
// attributes, because the Content Security Policy only allows scripts from the app's own files.

// Menu button on small screens: open or close the left menu
var menuButton = document.querySelector('.header-toggler');
if (menuButton) {
  menuButton.addEventListener('click', function () {
    coreui.Sidebar.getOrCreateInstance(document.querySelector('#sidebar')).toggle();
  });
}

// Show the default avatar when a profile photo cannot be loaded (e.g. the file was deleted)
document.querySelectorAll('img[data-fallback]').forEach(function (img) {
  function useFallback() {
    img.src = img.getAttribute('data-fallback');
    img.removeAttribute('data-fallback');
  }
  if (img.complete && img.naturalWidth === 0) {
    useFallback();
  } else {
    img.addEventListener('error', useFallback, { once: true });
  }
});
