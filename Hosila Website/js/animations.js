/**
 * Scoped GSAP ScrollTrigger reveals + lively animated icon draw triggers.
 * Runs by default across desktop/server profiles; respects explicit [data-motion="paused"].
 */
export async function initSiteAnimations() {
  const paused = document.documentElement.dataset.motion === 'paused';
  const animatedBlocks = document.querySelectorAll('[data-animate-in]');

  if (paused) {
    animatedBlocks.forEach((el) => el.classList.add('is-in-view'));
    return;
  }

  // Trigger lively SVG stroke draw-in via IntersectionObserver
  const drawObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in-view');
          drawObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -30px 0px' }
  );

  animatedBlocks.forEach((el) => drawObserver.observe(el));

  // Lazy-load GSAP native ES module for scroll choreography
  try {
    const [{ gsap }, { ScrollTrigger }] = await Promise.all([
      import('/vendor/gsap/index.js'),
      import('/vendor/gsap/ScrollTrigger.js'),
    ]);
    gsap.registerPlugin(ScrollTrigger);

    document.querySelectorAll('[data-stagger-group]').forEach((group) => {
      const items = group.querySelectorAll('[data-stagger-item]');
      if (!items.length) return;

      gsap.from(items, {
        y: 18,
        opacity: 0,
        duration: 0.55,
        stagger: 0.08,
        ease: 'power3.out',
        clearProps: 'transform,opacity',
        scrollTrigger: {
          trigger: group,
          start: 'top 88%',
          once: true,
        },
      });
    });

    const eco = document.querySelector('[data-ecosystem-diagram]');
    if (eco) {
      const nodes = eco.querySelectorAll('[data-eco-node]');
      if (nodes.length) {
        gsap.from(nodes, {
          y: 14,
          opacity: 0,
          duration: 0.6,
          stagger: 0.11,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: eco,
            start: 'top 84%',
            once: true,
          },
        });
      }
    }
  } catch {
    // Graceful degradation: IntersectionObserver still keeps everything crisp and visible
  }
}

