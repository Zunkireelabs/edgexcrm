# `_shared/` — cross-industry feature implementations

Features that **multiple industries use** but **not all** belong here. Each industry's `manifest.ts` opts in by importing the feature's `meta` and registering it.

## When to put a feature here

- **Universal** (every tenant uses it regardless of industry) → NOT here. Lives in `src/app/(main)/(dashboard)/` and `src/components/dashboard/`.
- **Industry-scoped** (one industry only) → NOT here. Lives in `src/industries/<id>/features/<feature>/`.
- **Shared across 2+ but not all industries** → **here**. Each consuming industry's manifest opts in.

## Promoting an existing feature to `_shared/`

When a second industry wants a feature that already lives in one industry's folder:

1. `git mv src/industries/<original>/features/<feature>/ src/industries/_shared/features/<feature>/`
2. In the original industry's `manifest.ts`, change the import path from `./features/<feature>` to `../_shared/features/<feature>`.
3. In the new industry's `manifest.ts`, add the same import and register the feature.
4. (Optional) Move any hardcoded labels/limits inside the feature into per-industry `config` on the manifest registration.

That's it. No code rewrite, no duplication.

## Per-industry behaviour via config

Shared features can read per-industry config via `getFeatureConfig(industryId, featureId)` from `../_loader.ts`. The manifest entry carries the config:

```ts
// education-consultancy/manifest.ts
import { documentCollectionMeta } from "../_shared/features/document-collection/meta";

export const manifest = {
  features: [
    {
      meta: documentCollectionMeta,
      config: { label: "Scholarship Documents", maxFiles: 10 },
    },
  ],
  // ...
};
```

## Today's contents

Empty — no shared features exist yet. The first inhabitant arrives when a second industry wants something that already exists in education-consultancy.
