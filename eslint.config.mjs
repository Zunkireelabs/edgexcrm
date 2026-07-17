import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // AI code touches tenant data only through scopedClient() — never the raw
  // service-role client, which bypasses RLS and every tenant_id filter.
  // Extended to industry AI packs (src/industries/*/ai/**) so they get the
  // same ban as src/lib/ai/.
  {
    files: ["src/lib/ai/**/*.{ts,tsx}", "src/industries/*/ai/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/server",
              importNames: ["createServiceClient"],
              message: "AI code must use scopedClient(auth) from @/lib/supabase/scoped, never createServiceClient().",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
