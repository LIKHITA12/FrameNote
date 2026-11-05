---
name: FrameNote Core
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#464555'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#46494b'
  on-tertiary: '#ffffff'
  tertiary-container: '#5e6163'
  on-tertiary-container: '#dadcde'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#e0e3e5'
  tertiary-fixed-dim: '#c4c7c9'
  on-tertiary-fixed: '#191c1e'
  on-tertiary-fixed-variant: '#444749'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Manrope
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 56px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  button:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 16px
  md: 24px
  lg: 40px
  xl: 64px
  container-max: 1280px
  gutter: 24px
---

## Brand & Style
The design system is engineered for high-efficiency cognitive tasks, specifically the synthesis of video content into actionable intelligence. The brand personality is **intelligent, orderly, and frictionless**. 

The aesthetic follows a **Modern SaaS Minimalism** approach. It prioritizes content clarity through generous whitespace and a strict "function over form" hierarchy. By stripping away unnecessary ornamentation, the UI reduces cognitive load, allowing the AI-generated insights to remain the focal point. Visual interest is achieved through precise geometry, high-contrast typography, and purposeful motion rather than decorative elements.

## Colors
The palette is anchored by high-contrast neutrals to ensure maximum legibility during long reading sessions.

- **Energetic Indigo (#4F46E5):** Used exclusively for primary actions, progress indicators, and active states. It signals intelligence and momentum.
- **Deep Slate (#0F172A):** The foundation for typography and navigation backgrounds. It provides a grounded, professional weight to the interface.
- **Pure White (#FFFFFF):** The primary canvas color. Surfaces where notes are displayed must remain pure white to minimize eye strain.
- **Slate Gray (#64748B):** Reserved for secondary metadata, icons, and placeholder text.
- **Subtle Border (#E2E8F0):** A light, cool-toned grey used for structural separation without breaking the flow of the layout.

## Typography
This design system employs a dual-font strategy to balance character with utility.

**Manrope** is used for headlines to provide a modern, geometric feel that appears professional yet approachable. **Inter** is the workhorse for all body copy and note content, selected for its exceptional legibility in dense text blocks. **JetBrains Mono** is utilized sparingly for timestamps, AI confidence scores, and technical metadata to evoke the "machine processing" aspect of the product.

Vertical rhythm is strictly maintained using a 4px baseline grid. Body text should always use the "Slate" color for optimal contrast against white backgrounds.

## Layout & Spacing
The layout follows a **structured fluid grid** philosophy. Content is contained within a 1280px max-width wrapper on desktop to prevent line lengths from becoming unreadable.

- **Desktop (1024px+):** 12-column grid, 24px gutters, 40px side margins.
- **Tablet (768px - 1023px):** 8-column grid, 16px gutters, 24px side margins.
- **Mobile (Under 768px):** 4-column grid, 16px gutters, 16px side margins.

Spacing follows a linear scale based on 4px increments. Large "xl" spacing (64px) should be used to separate major sections of a note, while "sm" (16px) is the default for internal component padding.

## Elevation & Depth
Depth is communicated through **Tonal Layering** and **Soft Shadows**. 

1. **Level 0 (Base):** Pure White (#FFFFFF). The primary surface for reading and writing notes.
2. **Level 1 (Subtle Inset):** Light Gray (#F8FAFC). Used for sidebars, navigation rails, and "empty state" containers.
3. **Level 2 (Raised):** Soft Shadow (0px 4px 12px rgba(15, 23, 42, 0.05)). Used for cards and input fields.
4. **Level 3 (Overlay):** Diffused Shadow (0px 12px 32px rgba(15, 23, 42, 0.1)). Reserved for modals, dropdowns, and AI suggestion popovers.

Borders are preferred over shadows for structural definition. Use a 1px border (#E2E8F0) for all Level 1 and Level 2 elements.

## Shapes
The shape language is **Soft-Geometric**. A consistent 8px (0.5rem) corner radius is applied to standard components like buttons, input fields, and cards to maintain an approachable SaaS aesthetic. 

- **Standard (8px):** Buttons, Inputs, Cards.
- **Large (16px):** Modals, Video player containers.
- **Pill:** Status chips, tags, and "AI Thinking" indicators.

## Components

### Buttons
- **Primary:** Energetic Indigo background, White text. No border. 
- **Secondary:** Transparent background, Deep Slate text, 1px border (#E2E8F0).
- **Size:** 40px height for standard, 48px for hero actions.

### Input Fields
- White background with 1px border (#E2E8F0). 
- On focus, the border changes to Energetic Indigo with a 3px soft outer glow (Indigo at 10% opacity).

### Cards
- White background, 1px border (#E2E8F0), and Level 2 soft shadow.
- Used for video previews and summary modules.

### Note List Items
- Clean, border-bottom separation only. No shadows.
- Active state indicated by a 4px vertical bar of Energetic Indigo on the left edge.

### Chips & Tags
- Used for "Keywords" or "Timestamps".
- Background: #F1F5F9 (Light Slate), Text: #475569.
- Timestamps should use JetBrains Mono for a technical, precise look.

### Video Player
- Integrated directly above or alongside notes with a 16px radius.
- Controls should be minimal, utilizing Deep Slate and White icons.
