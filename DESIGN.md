# Nox Design System

## Register

Product UI. Restrained, native, fast.

## Palette

- Background: tinted neutral, almost flat.
- Accent: Telegram blue for active states and primary actions only.
- Surfaces: translucent only for dock, composer, sheets, and sticky chrome.
- Rows: flat, separated by hairlines and spacing, not shadows.

## Material

Glass uses five properties only: translucent fill, blur, saturation, 1px border, soft depth. No decorative noise, glow blobs, shimmer sweeps, or gradient wallpaper.

## Motion

Use 150-220ms ease-out transitions. Animate transform and opacity only. Press feedback uses small scale. No page-load choreography.

## Typography

Inter/system sans, normal case, compact hierarchy. No display font treatment in controls.

## Components

- Dock: compact floating native control.
- Composer: single clear input line with circular action buttons.
- Sheets: bottom sheets with same material and direct actions.
- Search: separate page, clear input, recent people, recent queries.

## Product Redesign Baseline

Full journey, IA, navigation, feature, screen, and component maps live in
`docs/product-redesign-system.md`. Use that file before implementing broad UI
changes so individual screens stay coherent with the whole messenger.
