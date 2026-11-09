"use client";

import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

// AG Grid Community setup (Section K.2). Registered once on import. Never ag-grid-enterprise.
ModuleRegistry.registerModules([AllCommunityModule]);

// The theme reads our design tokens as CSS variables, so the light/dark switch of the theme
// provider re-themes the grid with no second theme object (docs/decisions.md 4.x).
export const gridTheme = themeQuartz.withParams({
  fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
  fontSize: 14,
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--foreground)",
  headerBackgroundColor: "var(--surface-2)",
  headerTextColor: "var(--muted-foreground)",
  headerFontWeight: 500,
  borderColor: "var(--border)",
  rowHoverColor: "var(--primary-soft)",
  selectedRowBackgroundColor: "var(--primary-soft)",
  accentColor: "var(--primary)",
  chromeBackgroundColor: "var(--surface-2)",
  oddRowBackgroundColor: "var(--surface)",
  inputBorder: { color: "var(--border)" },
  rowHeight: 48,
  headerHeight: 44,
  borderRadius: 8,
  wrapperBorderRadius: 10,
  spacing: 6,
});
