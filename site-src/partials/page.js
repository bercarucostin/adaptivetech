/* Behaviour every content page shares. Injected right after header.js.

   Reveal-on-scroll and the watermark theme used to live in the homepage
   script. The case-study pages need both, and a second copy is how the
   privacy page once ended up running a nav script against elements it
   did not have. */

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* Elements marked .reveal fade in as they enter the viewport. Under reduced
   motion they are simply shown; the <noscript> rule in the stylesheet shows
   them when there is no script at all. */
const revealObs = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); } });
}, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
document.querySelectorAll('.reveal').forEach(el => {
  if (reduceMotion) el.classList.add('in'); else revealObs.observe(el);
});

/* The fixed A-mark watermark inverts over dark bands. Sections declare
   data-theme; whichever one crosses the middle of the viewport decides. */
const watermark = document.getElementById('watermark');
if (watermark) {
  const themeObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) watermark.classList.toggle('on-dark', e.target.dataset.theme === 'dark');
    });
  }, { rootMargin: '-42% 0px -52% 0px' });
  document.querySelectorAll('[data-theme]').forEach(s => themeObs.observe(s));
}
