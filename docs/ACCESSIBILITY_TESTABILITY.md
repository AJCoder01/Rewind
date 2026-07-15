# S017 accessibility and testability validation

The current fixture-backed screens keep the S014 selector contract and expose stable `data-testid` hooks for the composer, login, and review surfaces. The selectors are implementation hooks only; visible copy and semantic roles remain the user-facing contract.

The validation covers:

- semantic `main`/heading/label structure, `role="alert"` errors, polite loading text, and a text-bearing fixture status;
- keyboard order from the request textarea to the primary action and a non-color `:focus-visible` outline;
- `prefers-reduced-motion: reduce` CSS behavior with no required animation;
- the 1440×900 primary viewport and 390×844 responsive viewport with a horizontal-overflow check;
- selectors from `CONTROLLED_CONTENT_UI_INVENTORY.md` for the current three screens only.

Recovery, rule, reset, and execution components are not claimed here; they remain future numbered tasks.
