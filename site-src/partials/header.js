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
