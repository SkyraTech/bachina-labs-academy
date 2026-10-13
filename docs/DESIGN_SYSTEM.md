# Bachina Labs Academy — Design System

**State:** Brand palette and design direction confirmed; component details/mockups require approval. **Updated:** 2026-10-13

## 1. Identity and direction
**Orange is the primary, dominant and most recognizable brand color.** Theme is **Branded Premium Minimal SaaS UI — Orange Edition**: Linear-inspired structure with a richer Academy identity and polished editorial content experience. Blue is **not** a necessary brand color. Teal is **not** a brand color; use only for occasional functional graphics where justified.

## 2. Brand palette (confirmed)
| Token | Value | Intent |
|---|---|---|
| `brand.orange` | `#F97316` | Primary actions, active navigation, brand emphasis |
| `brand.orangeDeep` | `#C2410C` | Strong emphasis and dark-on-light variations |
| `brand.charcoal` | `#20242B` | Main text, nav and dark neutrals |
| `brand.cream` | `#FFF7ED` | Warm light accents |
| `neutral.white` | `#FFFFFF` | Light surface |
| `neutral.slate` | `#64748B` | Supporting text/secondary UI |

**Illustrative/proposed additional tokens** (test contrast before adoption): light app background `#F8FAFC`; dark app background `#101418`; dark panel `#1C2228`. Status semantics: success green, warning amber, error red; never substitute these as branding colors.

## 3. Semantic CSS token design
Prefer semantic variables per surface and state rather than raw hex in components, e.g. `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-border`, `--color-brand`, `--color-brand-hover`, `--color-focus`, `--color-danger`, `--color-success`. Use `data-theme=light|dark` / theme service; `system` follows `prefers-color-scheme` and updates dynamically, with persisted explicit user choice.

Contrast: evaluate WCAG AA for content/controls. White-on-primary-orange may not have sufficient contrast for normal-sized text; use a deeper orange or dark text as appropriate, confirmed by calculation/testing.

## 4. Proposed visual rules
- Primary font: Inter or Manrope; finalize one after preview.
- 4px/8px spacing rhythm; 8–12px standard corner radii.
- Lucide-style icons with consistent size and stroke.
- Subtle shadows and boundaries, restrained motion and robust focus indication.
- Avoid extensive gradients, blue-dominant sections, random teal decoration and template-looking colorful dashboards.

## 5. One application, coordinated layouts
- **Public:** content-first landing, editorial article listing/detail, reading widths and SEO-friendly pages.
- **Author:** efficient sidebar, article-management list, distraction-free writing editor, visible draft and publish actions.
- **Admin:** professional navigation, compact high-legibility tables, plan/feature matrix, actionable summaries.
- **Auth:** coherent branded registration/login/reset experience.

Use shared buttons, inputs, badges, table patterns, dialogs, toasts, navigation, loading/error/empty states and theme toggle across all areas. Feature-entitlement gating should have clear locked/upgrade presentation without replacing backend checks.

## 6. Author editor
Uncluttered title, metadata/category/tag fields, optional cover/media, save draft, preview and **explicit** publish. No editorial review queue. Ensure proper content preview parity with public article rendering.

## 7. Subscription management visuals
Admin matrix rows = registered implemented features, columns = plan codes; accessible toggles/switches, grouped categories, contextual descriptions, confirmation for wide-impact changes and clear save-feedback. Names, pricing and plan mapping deliberately **TBD**.

## 8. Design approval still required
Light/dark dashboard visual mocks, production logo/asset, final typeface, all semantic token values, responsive dimensions, components and animated behavior. No automatic UI generation from this file alone should be considered sign-off.
