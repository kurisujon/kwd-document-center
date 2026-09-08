# Design System

## 1. Design Philosophy
The KWD Document Center must be designed like a real, modern software product by a human product designer. It must prioritize typography, spacing, hierarchy, alignment, content, and usability over decoration, effects, and animations. The application must remain simple, fast, professional, and accessible to non-technical office staff.

**Very Important Design Rule:**
Whenever making a design recommendation, ask: *"Would this look like a thoughtful product designer intentionally designed this interface?"* If the answer is no, simplify it. The final design must **NOT** look like an AI-generated template.

## 2. Visual Reference
**Reference:** [Veldra Design System](https://veldra-sand.vercel.app/)
**Implementation Rule:** Do NOT copy Veldra's branding, logo, exact content, proprietary assets, or exact page layouts. Instead, adopt its general **design language**: visual polish, spacing, typography hierarchy, restraint, and professionalism.

## 3. KWD Visual Identity
The interface should remain mostly neutral/light, with brand colors providing controlled visual emphasis.

## 4. Color Palette
- **Azure:** `#007FFF` (Primary actions, links, active controls, focused states)
- **Cobalt:** `#0047AB` (Branding, important headings, navigation identity)
- **Slate Blue:** `#557C99` (Secondary text, supporting information, secondary actions)
- **Milky White:** `HEX TBD` (Primary light background direction. Do NOT invent a final HEX value until explicitly approved)

## 5. Semantic Color Tokens
Do not scatter raw HEX values. Use semantic tokens to allow centralized changes.
```css
--color-primary: #007FFF; /* Azure */
--color-primary-hover: #0066CC;
--color-primary-foreground: #FFFFFF;

--color-background: /* Milky White TBD */;
--color-surface: #FFFFFF;
--color-surface-muted: #F3F4F6;

--color-border: #E5E7EB;

--color-text-primary: #111827; /* Dark Gray for readability */
--color-text-secondary: #557C99; /* Slate Blue */
--color-text-muted: #6B7280;

--color-brand: #0047AB; /* Cobalt */
```

**Phase 1 temporary treatment [ASSUMPTION]:** Until the Milky White HEX is approved, `--color-background` references the existing `--color-surface-muted` neutral token. This centralized fallback can be replaced when approval is recorded; it is not an official KWD Milky White value.

## 6. Typography
- **Typeface:** Clean modern sans-serif (e.g., Inter, Roboto, or standard system fonts). Prioritize readability. Avoid overly stylized display fonts.
- **Hierarchy:**
  - Page Title: Large, bold (e.g., 24px/32px)
  - Section Heading: Medium, bold (e.g., 18px/24px)
  - Body: Readable (e.g., 14px/16px)
  - Metadata / Small text: (e.g., 12px/14px)

## 7. Spacing
Use generous whitespace to separate sections, navigation, tables, and forms. Do not compress information.
- Use a consistent spacing scale (e.g., 4px, 8px, 16px, 24px, 32px, 48px).

## 8. Border Radius
Use restrained corner rounding (e.g., `4px` or `6px`). Do not make every element heavily rounded. The visual result should remain professional, not playful.

## 9. Shadows
Use shadows sparingly. Most UI should rely on whitespace, typography, and subtle borders. If shadows are used, they should be soft, large, and diffuse, strictly for elevated elements like modals or dropdowns.

## 10. Buttons
- **Primary:** Solid Azure background, white text.
- **Secondary:** Outline or subtle Slate Blue background.
- **Text/Ghost:** For less important actions.

## 11. Inputs & 12. Selects
- Clear visible borders (e.g., `--color-border`).
- Focused state must clearly highlight (e.g., Azure ring).
- Clear labels above the input. Do not rely only on placeholders.

## 13. Search
- Prominent search input, clean styling.
- Should feel like the most important control on the Documents page.

## 14. Tables
- Readable column hierarchy.
- Appropriate column widths.
- Sortable headers where applicable.
- Subtle row hover state.
- Clear action area (e.g., a simple "View" button or icon).
- Avoid making every row visually heavy; it should feel clean and lightweight.

## 15. Navigation
- Minimal structure.
- Cobalt branding element.
- Clear active state indicator (e.g., Azure accent line or text color).

## 16. Upload Interface
- Simple vertical form. Avoid complicated multi-step wizards unless justified later.
- Clear file drop/select zone.
- Obvious submit action.

## 17. Document Detail Interface
- Clean page separating metadata from the actual file action.
- Clear "Open in Drive" / "Download" primary action buttons.

## 18. Alerts & 19. Status Indicators
Status colors are semantic and separate from the KWD brand palette. Accessibility takes priority.
- **Success:** Green (e.g., `#10B981`)
- **Warning:** Yellow/Orange (e.g., `#F59E0B`)
- **Error:** Red (e.g., `#EF4444`)
- **Info:** Blue (can use Azure or standard info blue)

## 20. Empty States, 21. Loading States, 22. Error States
- **Empty:** Simple message, perhaps a subtle icon, clear call to action if applicable.
- **Loading:** Subtle spinners or skeleton screens. Avoid excessive animation.
- **Error:** User-friendly messages. Explain what went wrong and how to fix it/retry. No raw stack traces.

## 23. Responsive Behavior
- **Desktop:** Primary environment. Strongest design attention.
- **Mobile/Tablet:** Usable. Navigation collapses to a hamburger. Tables may require horizontal scrolling or card-based reflow depending on complexity. Forms remain single column.

## 24. Accessibility
- Sufficient color contrast (brand colors must not override accessibility).
- Full keyboard navigation and logical tab order.
- Visible focus states.
- Semantic HTML and ARIA only where needed.
- Readable font sizes.

## 25. Do/Don't Examples
- **DO:** Use whitespace to separate the search bar from the table.
- **DON'T:** Cram the search bar, filters, and table header into a single tight row.
- **DO:** Use Slate Blue for secondary metadata text (like dates).
- **DON'T:** Make everything Azure, losing the emphasis.

## 26. AI-Design Anti-Patterns
Explicitly **AVOID**:
- Purple AI gradients or excessive blue gradients
- Glassmorphism or glowing effects
- Neon colors or animated backgrounds
- Giant hero sections on internal pages
- Excessive rounded cards, pill-shaped UI, shadows, or borders
- Decorative dashboards, fake analytics, KPIs, or unnecessary charts
- Generic SaaS/Tailwind dashboard appearance
- Oversized illustrations or excessive icon usage
- Visual clutter
