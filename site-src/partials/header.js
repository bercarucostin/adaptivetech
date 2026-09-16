/* THE header's behaviour. Injected at the <!--@script--> marker on every
   page that carries the shared header, so the header cannot be present
   without the code that makes it work.

   This is not a theoretical tidy-up: the privacy page previously had its
   own cut-down script that called getElementById('navLinks') -- an element
   its markup no longer has -- and had no mobile-menu wiring at all. The
   header worked on one page and not the other because the markup was
   shared by copy and the behaviour was not shared at all. */

/* The year in the footer. */
document.getElementById('year').textContent = new Date().getFullYear();

/* The header gains a surface once the page scrolls off the top. */
const nav = document.getElementById('nav');
const onScrollNav = () => nav.classList.toggle('solid', window.scrollY > 24);
onScrollNav();
window.addEventListener('scroll', onScrollNav, { passive: true });

/* Mobile menu. Locks body scroll while open, and closes on any link -- the
   links are anchors, so without that the menu would stay over the section
   it just scrolled to. */
const menuBtn = document.getElementById('menuBtn');
const mMenu = document.getElementById('mMenu');
const closeMenu = () => {
  mMenu.classList.remove('open');
  nav.classList.remove('menu-open');
  menuBtn.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = '';
};
menuBtn.addEventListener('click', () => {
  const open = mMenu.classList.toggle('open');
  nav.classList.toggle('menu-open', open);
  menuBtn.setAttribute('aria-expanded', open);
  document.body.style.overflow = open ? 'hidden' : '';
});
mMenu.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMenu));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mMenu.classList.contains('open')) closeMenu();
});

/* The case-study dropdown. CSS opens it on hover and on keyboard focus
   within; this covers the two cases CSS cannot: a touch tap on the
   trigger (which has no hover, and would otherwise navigate away before
   anyone sees the list), and closing on Escape or an outside click. On
   a device with hover, a click on the trigger is a real navigation to
   the index page, as its href says. */
const navSub = document.getElementById('navCases');
const navSubTrigger = document.getElementById('navCasesTrigger');
if (navSub && navSubTrigger) {
  const hoverable = window.matchMedia('(hover: hover)').matches;
  const setSub = (open) => {
    navSub.classList.toggle('open', open);
    navSubTrigger.setAttribute('aria-expanded', open);
  };
  navSubTrigger.addEventListener('click', (e) => {
    if (hoverable) return;
    if (!navSub.classList.contains('open')) { e.preventDefault(); setSub(true); }
  });
  navSubTrigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSub(true); navSub.querySelector('.nav-sub-menu a').focus(); }
  });
  document.addEventListener('click', (e) => { if (!navSub.contains(e.target)) setSub(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && navSub.classList.contains('open')) { setSub(false); navSubTrigger.focus(); }
  });
  navSub.addEventListener('focusout', (e) => { if (!navSub.contains(e.relatedTarget)) setSub(false); });
}
