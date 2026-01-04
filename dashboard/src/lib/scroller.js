import Lenis from 'lenis';

let lenis = null;
let rafId = 0;

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
  if (!lenis) return;

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
}
