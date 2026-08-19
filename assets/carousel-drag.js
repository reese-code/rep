class CarouselDrag {
  constructor(element) {
    this.track = element;
    this.startX = 0;
    this.currentX = 0;
    this.isDragging = false;
    this.animationSpeed = 2;
    this.lastTime = 0;
    this.dragVelocity = 0;
    this.lastDragX = 0;
    this.trackWidth = 0;
    this.isResetting = false;
    this.isHovered = false;
    
    // Add transition class for smooth reset
    this.track.classList.add('carousel-track');
    const style = document.createElement('style');
    style.textContent = `
      .carousel-track { transition: transform 0.3s ease-out; }
      .carousel-track.no-transition { transition: none; }
    `;
    document.head.appendChild(style);
    
    // Bind event handlers
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseLeave = this.onMouseLeave.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);
    this.onTouchMove = this.onTouchMove.bind(this);
    this.animate = this.animate.bind(this);
    
    // Bind hover handlers
    this.onMouseEnter = this.onMouseEnter.bind(this);
    this.onMouseLeave = this.onMouseLeave.bind(this);
    
    // Add event listeners
    this.addEventListeners();
    
    // Calculate track width
    this.calculateTrackWidth();
    
    // Start animation
    requestAnimationFrame(this.animate);
  }

  calculateTrackWidth() {
    const firstSet = Array.from(this.track.children).slice(0, this.track.children.length / 2);
    const gap = parseFloat(window.getComputedStyle(this.track).gap) || 0;
    this.trackWidth = firstSet.reduce((width, child, index) => {
      return width + child.offsetWidth + (index < firstSet.length - 1 ? gap : 0);
    }, 0);
  }

  addEventListeners() {
    // Mouse events
    this.track.addEventListener('mousedown', this.onMouseDown);
    this.track.addEventListener('mouseenter', this.onMouseEnter);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    this.track.addEventListener('mouseleave', this.onMouseLeave);

    // Touch events
    this.track.addEventListener('touchstart', this.onTouchStart, { passive: true });
    window.addEventListener('touchmove', this.onTouchMove, { passive: false });
    window.addEventListener('touchend', this.onTouchEnd);

    // Recalculate track width on window resize
    window.addEventListener('resize', () => this.calculateTrackWidth());
  }

  onMouseDown(e) {
    this.isDragging = true;
    this.startX = e.pageX - this.currentX;
    this.track.style.cursor = 'grabbing';
    this.lastDragX = e.pageX;
    this.dragVelocity = 0;
  }

  onMouseUp() {
    if (this.isDragging) {
      this.isDragging = false;
      this.track.style.cursor = 'grab';
    }
  }

  onMouseEnter() {
    this.isHovered = true;
  }

  onMouseLeave() {
    this.isHovered = false;
    if (this.isDragging) {
      this.isDragging = false;
      this.track.style.cursor = 'grab';
    }
  }

  onMouseMove(e) {
    if (!this.isDragging) return;
    e.preventDefault();
    
    const x = e.pageX;
    this.dragVelocity = (x - this.lastDragX) * 2.5;
    this.lastDragX = x;
    this.currentX = e.pageX - this.startX;
    this.updateTransform();
  }

  onTouchStart(e) {
    this.isDragging = true;
    this.startX = e.touches[0].pageX - this.currentX;
    this.lastDragX = e.touches[0].pageX;
    this.dragVelocity = 0;
  }

  onTouchEnd() {
    this.isDragging = false;
  }

  onTouchMove(e) {
    if (!this.isDragging) return;
    e.preventDefault();
    
    const x = e.touches[0].pageX;
    this.dragVelocity = (x - this.lastDragX) * 2.5;
    this.lastDragX = x;
    this.currentX = x - this.startX;
    this.updateTransform(true);
  }

  updateTransform(isDragging = false) {
    if (isDragging) {
      this.track.classList.add('no-transition');
    } else {
      this.track.classList.remove('no-transition');
    }
    this.track.style.transform = `translateX(${this.currentX}px)`;
  }

  animate(currentTime) {
    if (!this.lastTime) this.lastTime = currentTime;
    const deltaTime = currentTime - this.lastTime;
    
    if (!this.isDragging && !this.isHovered) {
      // Apply drag momentum
      if (Math.abs(this.dragVelocity) > 0.1) {
        this.currentX += this.dragVelocity;
        this.dragVelocity *= 0.92; // Increased friction
      } else {
        // Regular animation
        this.currentX -= this.animationSpeed * deltaTime / 16;
      }
      
      // Reset position when scrolled one set width
      if (Math.abs(this.currentX) >= this.trackWidth) {
        this.isResetting = true;
        requestAnimationFrame(() => {
          this.track.classList.add('no-transition');
          this.currentX = 0;
          this.updateTransform();
          this.isResetting = false;
        });
      }
      
      this.updateTransform();
    }
    
    this.lastTime = currentTime;
    requestAnimationFrame(this.animate);
  }
}

// Initialize carousels
document.addEventListener('DOMContentLoaded', () => {
  const testimonialsTracks = document.querySelectorAll('.v2-testimonials__track');
  const outfitTracks = document.querySelectorAll('.v2-outfit-carousel__track');
  const howItWorksTracks = document.querySelectorAll('.js-carousel');
  
  testimonialsTracks.forEach(track => {
    track.style.animation = 'none';
    new CarouselDrag(track);
  });
  
  outfitTracks.forEach(track => {
    track.style.animation = 'none';
    new CarouselDrag(track);
  });

  // Only initialize how-it-works carousel on desktop
  if (window.innerWidth >= 768) {
    howItWorksTracks.forEach(track => {
      track.style.animation = 'none';
      track.carouselInstance = new CarouselDrag(track);
    });
  }
});

// Handle resize for how-it-works carousel
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const howItWorksTracks = document.querySelectorAll('.js-carousel');
    
    if (window.innerWidth >= 768) {
      howItWorksTracks.forEach(track => {
        if (!track.carouselInstance) {
          track.style.animation = 'none';
          track.carouselInstance = new CarouselDrag(track);
        }
      });
    } else {
      howItWorksTracks.forEach(track => {
        if (track.carouselInstance) {
          // Clean up event listeners
          track.removeEventListener('mousedown', track.carouselInstance.onMouseDown);
          track.removeEventListener('mouseenter', track.carouselInstance.onMouseEnter);
          track.removeEventListener('mouseleave', track.carouselInstance.onMouseLeave);
          track.removeEventListener('touchstart', track.carouselInstance.onTouchStart);
          
          // Reset styles
          track.style.transform = '';
          track.style.cursor = '';
          track.classList.remove('carousel-track', 'no-transition');
          
          // Remove instance
          delete track.carouselInstance;
        }
      });
    }
  }, 250);
});
