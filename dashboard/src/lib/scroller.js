import Lenis from 'lenis';

let lenis = null;
let rafId = 0;
let lastWrapper = null;
let lastContent = null;

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;
  } catch {
    return false;
  }
}

export function enableSmoothScroll(options = {}) {
  if (typeof window === 'undefined') return;
  if (prefersReducedMotion()) return;
  if (lenis) return;

  const wrapper =
    typeof options.wrapper === 'string'
      ? document.querySelector(options.wrapper)
      : options.wrapper;

  const content =
    typeof options.content === 'string'
      ? document.querySelector(options.content)
      : options.content;

  const { wrapper: _wrapperOpt, content: _contentOpt, ...rest } = options;

  lastWrapper = wrapper || null;
  lastContent = content || null;

  lenis = new Lenis({
    duration: 0.95,
    smoothWheel: true,
    smoothTouch: false,
    wheelMultiplier: 0.9,
    touchMultiplier: 1.0,
    ...(wrapper ? { wrapper } : null),
    ...(content ? { content } : null),
    ...rest,
  });

  const raf = (time) => {
    lenis?.raf(time);
    rafId = window.requestAnimationFrame(raf);
  };

  rafId = window.requestAnimationFrame(raf);
}

export function disableSmoothScroll() {
  if (typeof window === 'undefined') return;
  // Even if Lenis was never created, make sure we don't leave the page in a
  // scroll-locked state (some browsers keep stale styles after navigations).
  const resetScrollLocks = () => {
    try {
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
      document.documentElement.style.position = '';
      document.body.style.overflow = '';
      document.body.style.height = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.touchAction = '';
    } catch {
      // ignore
    }

    try {
      if (lastWrapper) {
        lastWrapper.style.overflow = '';
        lastWrapper.style.height = '';
        lastWrapper.style.position = '';
        lastWrapper.style.touchAction = '';
      }
      if (lastContent) {
        lastContent.style.transform = '';
        lastContent.style.willChange = '';
      }
    } catch {
      // ignore
    }
  };

  if (!lenis) {
    resetScrollLocks();
    return;
  }

  if (rafId) {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  try {
    lenis.destroy();
  } catch {
    // ignore
  }

  lenis = null;

  resetScrollLocks();
}
