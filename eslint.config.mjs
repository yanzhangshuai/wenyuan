import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import stylistic from "@stylistic/eslint-plugin";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import importX from "eslint-plugin-import-x";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * ESLint flat config。
 *
 * 说明：`eslint-config-next@16` 已原生导出 flat config 数组，
 * 因此**不能**再用 `FlatCompat` 包装（会触发 circular structure 序列化错误）。
 */
const config = [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "drizzle/**",
      "src/generated/**",
      "next-env.d.ts",
      // 工具配置不在 tsconfig 的 projectService 覆盖范围内，排除以避免「文件未纳入项目」报错。
      "eslint.config.mjs",
      "postcss.config.mjs"
    ]
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname
      }
    },
    plugins: {
      "@stylistic": stylistic,
      "import-x": importX,
      "unused-imports": unusedImports
    },
    rules: {
      // 类型安全：禁止逃生舱
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" }
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],

      // 导入分组：Node → 外部 → @/ → 相对，组间空行
      "import-x/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          pathGroups: [{ pattern: "@/**", group: "internal", position: "before" }],
          pathGroupsExcludedImportTypes: ["builtin"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true }
        }
      ],

      // 格式交给工具，不手写
      "@stylistic/semi": ["error", "always"],
      "@stylistic/quotes": ["error", "double", { avoidEscape: true }],
      "@stylistic/comma-dangle": ["error", "never"],
      "@stylistic/key-spacing": ["error", { align: "colon" }],

      // 中文注释场景下的宽松项
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }]
    }
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "vitest.setup.ts", "scripts/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "import-x/no-default-export": "off"
    }
  }
];

export default config;
