// Import GSAP and plugins
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { TextPlugin } from 'gsap/TextPlugin';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';

// Register GSAP plugins
gsap.registerPlugin(ScrollTrigger, TextPlugin, ScrollToPlugin);

// Global GSAP settings
gsap.config({
  nullTargetWarn: false,
  force3D: true
});

// Make GSAP available globally for inline scripts
window.gsap = gsap;
window.ScrollTrigger = ScrollTrigger;

/**
 * Initialize animations
 */
function initAnimations() {
  // Fade in animations
  gsap.utils.toArray('.tw-gsap-fade').forEach(element => {
    gsap.fromTo(element, 
      { 
        opacity: 0 
      },
      {
        opacity: 1,
        duration: 1,
        scrollTrigger: {
          trigger: element,
          start: 'top 80%',
          once: true
        }
      }
    );
  });

  // Slide up animations
  gsap.utils.toArray('.tw-gsap-slide-up').forEach(element => {
    gsap.fromTo(element,
      {
        opacity: 0,
        y: 30
      },
      {
        opacity: 1,
        y: 0,
        duration: 0.8,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: element,
          start: 'top 80%',
          once: true
        }
      }
    );
  });

  // Slide left animations
  gsap.utils.toArray('.tw-gsap-slide-left').forEach(element => {
    gsap.fromTo(element,
      {
        opacity: 0,
        x: 30
      },
      {
        opacity: 1,
        x: 0,
        duration: 0.8,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: element,
          start: 'top 80%',
          once: true
        }
      }
    );
  });

  // Scale animations
  gsap.utils.toArray('.tw-gsap-scale').forEach(element => {
    gsap.fromTo(element,
      {
        opacity: 0,
        scale: 0.95
      },
      {
        opacity: 1,
        scale: 1,
        duration: 0.6,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: element,
          start: 'top 80%',
          once: true
        }
      }
    );
  });

  // Stagger animations for children
  gsap.utils.toArray('[data-gsap-stagger]').forEach(container => {
    const children = container.children;
    gsap.fromTo(children,
      {
        opacity: 0,
        y: 20
      },
      {
        opacity: 1,
        y: 0,
        duration: 0.6,
        stagger: 0.1,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: container,
          start: 'top 80%',
          once: true
        }
      }
    );
  });
}

/**
 * Hero animations
 */
function initHeroAnimations() {
  const hero = document.querySelector('[data-hero]');
  if (!hero) return;

  const timeline = gsap.timeline();
  
  timeline
    .from('[data-hero-title]', {
      opacity: 0,
      y: 50,
      duration: 1,
      ease: 'power3.out'
    })
    .from('[data-hero-subtitle]', {
      opacity: 0,
      y: 30,
      duration: 0.8,
      ease: 'power3.out'
    }, '-=0.5')
    .from('[data-hero-cta]', {
      opacity: 0,
      scale: 0.9,
      duration: 0.6,
      ease: 'back.out(1.7)'
    }, '-=0.3');
}

/**
 * Product card hover effects
 */
function initProductCardEffects() {
  const productCards = document.querySelectorAll('[data-product-card]');
  
  productCards.forEach(card => {
    const image = card.querySelector('img');
    const content = card.querySelector('[data-product-content]');
    
    if (!image || !content) return;
    
    const tl = gsap.timeline({ paused: true });
    
    tl.to(image, {
      scale: 1.05,
      duration: 0.4,
      ease: 'power2.out'
    })
    .to(content, {
      y: -5,
      duration: 0.3,
      ease: 'power2.out'
    }, 0);
    
    card.addEventListener('mouseenter', () => tl.play());
    card.addEventListener('mouseleave', () => tl.reverse());
  });
}

/**
 * Smooth scroll to anchor links
 */
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      
      if (target) {
        gsap.to(window, {
          duration: 1,
          scrollTo: {
            y: target,
            offsetY: 100
          },
          ease: 'power2.inOut'
        });
      }
    });
  });
}

/**
 * Parallax effects
 */
function initParallax() {
  gsap.utils.toArray('[data-parallax]').forEach(element => {
    const speed = element.dataset.parallaxSpeed || 0.5;
    
    gsap.to(element, {
      yPercent: -100 * speed,
      ease: 'none',
      scrollTrigger: {
        trigger: element,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true
      }
    });
  });
}

/**
 * Initialize everything when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
  // Initialize all animations
  initAnimations();
  initHeroAnimations();
  initProductCardEffects();
  initSmoothScroll();
  initParallax();
  
  // Refresh ScrollTrigger after all content is loaded
  window.addEventListener('load', () => {
    ScrollTrigger.refresh();
  });
  
  // Handle Shopify theme editor events
  document.addEventListener('shopify:section:load', () => {
    ScrollTrigger.refresh();
    initAnimations();
  });
});

// Export for use in other modules
export { gsap, ScrollTrigger };
