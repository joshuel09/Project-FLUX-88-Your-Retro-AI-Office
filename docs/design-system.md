# Web design system

The current interface uses Tailwind CSS v4, project color and font tokens, and small
hand-built React components. It uses semantic HTML and native browser controls; the web
package does not include shadcn/ui or Radix packages. Shared components live under
`apps/web/components/`, while route-specific layouts and content live under
`apps/web/app/`.

## Theme

Tokens are defined in `apps/web/app/globals.css`:

| Role | Token | Value |
|---|---|---|
| Main surface | `navy-900` | `#0b1026` |
| Deep surface | `navy-950` | `#070a1c` |
| Raised surface | `navy-800` | `#141a3a` |
| Default boundary | `navy-700` | `#586b99` |
| Primary accent | `cyan-neon` | `#5df3ff` |
| Secondary cyan | `cyan-soft` | `#9ff0ff` |
| Status/action accent | `magenta-neon` | `#ff3df0` |
| Status/action accent | `magenta-soft` | `#ff9df5` |
| Warm accent | `amber-warm` | `#ffd37a` |
| Warm boundary | `amber-deep` | `#e8a33d` |

Text pairs in the stylesheet pass the 4.5:1 contrast threshold across the documented dark
surfaces. Meaningful UI boundaries pass 3:1. Decorative glow, scanlines, and disabled
controls are excluded from those measurements.

## Component conventions

- Use headings, landmarks, lists, forms, labels, buttons, and native input/select elements
  for their built-in keyboard and accessibility behavior.
- Give controls visible names. Use a real `<label>` where practical; use a visually hidden
  label when the visual design needs a placeholder or icon-only control.
- Keep keyboard focus visible. Components may replace the browser outline only when they
  provide a clear focus state, such as the cyan border used by current controls.
- Use ARIA only to add information native HTML cannot express, such as a named status,
  disclosure, list region, or meter. Do not add roles without the matching keyboard
  behavior.
- Keep component styling local with Tailwind utilities and use shared CSS tokens for
  colors, typography, and retro effects.

## Motion and effects

The CRT overlay, scanline animation, and glow are decorative. The system
`prefers-reduced-motion` setting and the manual reduced-motion toggle both disable motion
effects and reduce animation/transition durations. See `apps/web/app/globals.css` and
`apps/web/components/reduced-motion-toggle.tsx`.

## Accessibility verification

The CI job's **Dashboard and axe release gate** runs Playwright with axe on the login page,
all nine office areas, and eight operational dashboard routes. The existing dashboard,
memory, and approval UI suites add coverage. Keep this gate in CI when changing the theme
or shared components; inspect `docs/release-gate.md` and `e2e/tests/release-gate.spec.ts`
for its current scope.

## Library choice

T002 established Tailwind CSS and the retro tokens. The delivered UI uses the custom
semantic React components described above; shadcn/ui and Radix primitives were not added.
T062 records this implementation as the Phase 1 design system. A future library change
should preserve the same token contrast, keyboard, focus, reduced-motion, and axe gates.
