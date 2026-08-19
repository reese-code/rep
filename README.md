# Startify Horizon Theme

A customized Shopify Horizon theme with Tailwind CSS and GSAP for the Startify Agency.

## Features

- **Horizon Theme**: Shopify's latest modular, block-based theme
- **Tailwind CSS**: Utility-first CSS framework with `tw-` prefix to avoid conflicts
- **GSAP**: Professional-grade animation library with ScrollTrigger
- **Custom Typography**: Neue Montreal font family integrated
- **Development Workflow**: Automated build process with hot reloading

## Prerequisites

- Node.js (v16 or higher)
- npm or yarn
- Shopify CLI

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the development server:
```bash
npm run dev
```

This will:
- Start the Shopify theme development server
- Watch and compile Tailwind CSS
- Bundle JavaScript with GSAP
- Enable hot reloading

## Available Scripts

- `npm run dev` - Start development server with all watchers
- `npm run build` - Build production-ready assets
- `npm run push` - Push theme to Shopify store
- `npm run pull` - Pull latest theme from Shopify store

## Project Structure

```
startify-horizon/
├── src/                    # Source files
│   ├── styles/            # Tailwind CSS source
│   │   └── main.css       # Main CSS file
│   ├── scripts/           # JavaScript source
│   │   └── main.js        # Main JS with GSAP
│   └── components/        # Reusable components
├── assets/                # Compiled assets (git ignored)
│   ├── tailwind.css       # Compiled Tailwind
│   ├── bundle.js          # Compiled JavaScript
│   └── custom.css         # Custom typography styles
├── sections/              # Shopify sections
├── blocks/               # Shopify blocks
├── snippets/             # Shopify snippets
├── templates/            # Shopify templates
└── layout/               # Shopify layouts
```

## Using Tailwind CSS

All Tailwind classes are prefixed with `tw-` to avoid conflicts with Shopify's styles.

```liquid
<!-- Example usage in Liquid templates -->
<div class="tw-container-wide tw-section">
  <h2 class="tw-text-3xl tw-font-medium tw-mb-8">{{ section.settings.title }}</h2>
  <div class="tw-product-grid">
    <!-- Product cards -->
  </div>
</div>
```

## Using GSAP Animations

GSAP is available globally. Use data attributes or classes for animations:

```liquid
<!-- Fade in animation -->
<div class="tw-gsap-fade">Content fades in on scroll</div>

<!-- Slide up animation -->
<div class="tw-gsap-slide-up">Content slides up on scroll</div>

<!-- Stagger children animations -->
<div data-gsap-stagger>
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>

<!-- Hero animations -->
<section data-hero>
  <h1 data-hero-title>Hero Title</h1>
  <p data-hero-subtitle>Hero Subtitle</p>
  <a data-hero-cta href="#">Call to Action</a>
</section>
```

## Custom Styles

The theme includes:
- Neue Montreal font (Regular & Medium weights)
- Custom CSS variables mapped to Shopify's theme settings
- Utility classes for common patterns
- Responsive breakpoints matching Shopify's defaults

## Development Tips

1. **Hot Reloading**: Changes to CSS and JS are automatically compiled and reloaded
2. **Theme Editor**: The setup works seamlessly with Shopify's theme editor
3. **Performance**: Assets are minified in production builds
4. **Prefixing**: Always use `tw-` prefix for Tailwind classes

## Store Information

- Store: 0b9748-bf.myshopify.com
- Theme: Horizon v1.0.1

## Support

For questions or issues, contact the Startify Agency development team.
# startify-horizon
