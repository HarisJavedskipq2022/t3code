import type { ThemeAppearance, ThemeColors, ThemeDefinition } from "./themePalettes.ts";

/**
 * Fork-only built-in themes, adapted from each project's published palette.
 * A theme is written as thirteen seed colors per appearance; `forkThemeColors`
 * expands them into every app color role, so a palette stays recognizable
 * and every foreground is still solved to a readable contrast.
 */
export const FORK_THEME_IDS = [
  "fork-catppuccin",
  "fork-rose-pine",
  "fork-tokyo-night",
  "fork-gruvbox",
  "fork-solarized",
  "fork-everforest",
  "fork-kanagawa",
  "fork-github",
  "fork-one",
  "fork-nord",
  "fork-dracula",
  "fork-ayu",
  "fork-monokai-pro",
  "fork-night-owl",
  "fork-vitesse",
  "fork-flexoki",
  "fork-horizon",
  "fork-synthwave",
  "fork-neon-rain",
  "fork-meadow-wind",
  "fork-mecha-violet",
  "fork-sakura-drift",
  "fork-sunset-rush",
  "fork-matcha",
  "fork-citrus-pop",
  "fork-espresso",
] as const;

type ForkThemeId = (typeof FORK_THEME_IDS)[number];

/** Hex seeds for one appearance, named after the layer each fills. */
export type ForkThemeSeed = Readonly<{
  /** Editor background: chat canvas, toolbar, terminal. */
  canvas: string;
  sidebar: string;
  /** Cards, secondary buttons, code blocks. */
  raised: string;
  /** Popovers, hover states, sidebar controls. */
  overlay: string;
  border: string;
  /** Terminal text selection. */
  selection: string;
  text: string;
  /** Secondary text; lifted toward `text` when it reads too faintly. */
  muted: string;
  /** Placeholders and comments; lifted the same way, to a lower bar. */
  subtle: string;
  accent: string;
  /** Message actions, the theme's second signature color. */
  accent2: string;
  red: string;
  yellow: string;
}>;

type Oklab = Readonly<{ L: number; a: number; b: number }>;

const WHITE = "#ffffff";
const BLACK = "#000000";

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function hexToOklab(hex: string): Oklab {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = srgbToLinear(value >> 16);
  const g = srgbToLinear((value >> 8) & 255);
  const b = srgbToLinear(value & 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function relativeLuminance({ L, a, b }: Oklab): number {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (channel: number) => Math.min(1, Math.max(0, channel));
  return (
    0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) +
    0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) +
    0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  );
}

function contrastRatio(first: Oklab, second: Oklab): number {
  const [x, y] = [relativeLuminance(first), relativeLuminance(second)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function mix(from: Oklab, to: Oklab, amount: number): Oklab {
  return {
    L: from.L + (to.L - from.L) * amount,
    a: from.a + (to.a - from.a) * amount,
    b: from.b + (to.b - from.b) * amount,
  };
}

/**
 * Walks `color` through `path` (the theme's text, then black or white) and
 * stops at the first stop that reaches `ratio` against `background`.
 */
function withContrast(
  color: Oklab,
  background: Oklab,
  ratio: number,
  path: ReadonlyArray<Oklab>,
): Oklab {
  let from = color;
  for (const toward of path) {
    for (let step = 0; step <= 10; step += 1) {
      const candidate = mix(from, toward, step / 10);
      if (contrastRatio(candidate, background) >= ratio) return candidate;
    }
    from = toward;
  }
  return from;
}

function oklabDistance(first: Oklab, second: Oklab): number {
  return Math.hypot(first.L - second.L, first.a - second.a, first.b - second.b);
}

function fromOklch(L: number, C: number, h: number): Oklab {
  const radians = (h * Math.PI) / 180;
  return { L, a: C * Math.cos(radians), b: C * Math.sin(radians) };
}

/** The theme's own canvas or text when either reads on `fill`, else black or white. */
function readableOn(fill: Oklab, canvas: Oklab, text: Oklab): Oklab {
  const own = [canvas, text].find((candidate) => contrastRatio(candidate, fill) >= 4.5);
  if (own) return own;
  const [white, black] = [hexToOklab(WHITE), hexToOklab(BLACK)];
  return contrastRatio(white, fill) >= contrastRatio(black, fill) ? white : black;
}

// Matches the web runtime's canonical OKLCH string, so stored values round-trip unchanged.
function formatNumber(value: number, precision: number): string {
  const rounded = Math.abs(value) < 10 ** -precision / 2 ? 0 : value;
  return rounded.toFixed(precision).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, "$1");
}

function toThemeColor({ L, a, b }: Oklab): string {
  const chroma = Math.hypot(a, b);
  const hue = chroma < 0.0000005 ? 0 : ((((Math.atan2(b, a) * 180) / Math.PI) % 360) + 360) % 360;
  return `oklch(${formatNumber(Math.min(1, Math.max(0, L)), 6)} ${formatNumber(chroma, 6)} ${formatNumber(hue, 3)})`;
}

// Search keeps the amber every built-in uses, so matches never read as accent-tinted code.
const SEARCH_COLORS = {
  light: {
    searchMatchBackground: "oklch(0.915 0.11 85)",
    searchMatchForeground: "oklch(0.216164 0.028283 77.423)",
    searchMatchActiveBackground: "oklch(0.774202 0.151946 74.331)",
    searchMatchActiveForeground: "oklch(0.216164 0.028283 77.423)",
  },
  dark: {
    searchMatchBackground: "oklch(0.55 0.1 85)",
    searchMatchForeground: "oklch(0.970151 0 0)",
    searchMatchActiveBackground: "oklch(0.774202 0.151946 74.331)",
    searchMatchActiveForeground: "oklch(0.216164 0.028283 77.423)",
  },
} as const;

// Cream canvases (Gruvbox, Kanagawa, Everforest) swallow pale amber, so their
// matches take the first of amber, teal and rose that stands apart from every
// surface; the current match keeps the shared gold.
const LIGHT_SEARCH_MATCH_CANDIDATES = (
  [
    [0.915, 0.11, 85],
    [0.87, 0.07, 195],
    [0.88, 0.08, 350],
  ] as const
).map(([L, C, h]) => ({ color: `oklch(${L} ${C} ${h})`, lab: fromOklch(L, C, h) }));

/** Expands one appearance's seeds into every app color role. */
export function forkThemeColors(seed: ForkThemeSeed, appearance: ThemeAppearance): ThemeColors {
  const s = Object.fromEntries(
    Object.entries(seed).map(([name, hex]) => [name, hexToOklab(hex)]),
  ) as Record<keyof ForkThemeSeed, Oklab>;
  const dark = appearance === "dark";
  const tint = (base: Oklab, color: Oklab, light: number, darkAmount: number) =>
    mix(base, color, dark ? darkAmount : light);

  const extreme = hexToOklab(dark ? WHITE : BLACK);
  // Body text is held to AAA on the canvas, like the guided editor's palettes,
  // so every foreground derived from it starts with room to spare.
  const text = withContrast(s.text, s.canvas, 7, [extreme]);
  const towardText = [text, extreme];
  const readable = (color: Oklab, background: Oklab, ratio = 4.5) =>
    withContrast(color, background, ratio, towardText);

  const muted = readable(s.muted, s.canvas);
  const subtle = readable(s.subtle, s.canvas, 3);
  const errorSurface = tint(s.canvas, s.red, 0.1, 0.18);
  const warningSurface = tint(s.canvas, s.yellow, 0.14, 0.18);
  const updateSurface = tint(s.canvas, s.accent, 0.14, 0.22);
  const messageSurface = tint(s.canvas, s.accent, 0.16, 0.26);
  const raisedSoft = mix(s.canvas, s.raised, 0.5);
  const sidebarRowSelected = tint(s.sidebar, s.accent, 0.17, 0.22);

  const colors = {
    canvas: s.canvas,
    chrome: s.canvas,
    toolbar: s.canvas,
    toolbarForeground: text,
    toolbarBorder: s.border,
    toolbarControl: s.raised,
    toolbarControlForeground: text,
    toolbarControlHover: s.overlay,
    surface: s.canvas,
    surfaceRaised: s.raised,
    surfaceOverlay: s.overlay,
    text,
    textMuted: muted,
    border: s.border,
    input: mix(s.border, text, 0.12),
    focus: s.accent,
    accent: s.accent,
    accentForeground: readableOn(s.accent, s.canvas, text),
    secondary: s.raised,
    secondaryForeground: text,
    muted: raisedSoft,
    mutedForeground: muted,
    placeholder: subtle,
    secondaryLabel: muted,
    iconMuted: muted,
    error: s.red,
    errorForeground: readable(s.red, errorSurface),
    errorSurface,
    warning: s.yellow,
    warningForeground: readable(s.yellow, warningSurface),
    warningSurface,
    update: s.accent,
    updateForeground: readable(s.accent, updateSurface),
    updateSurface,
    accentSurface: tint(s.canvas, s.accent, 0.12, 0.2),
    accentSurfaceForeground: text,
    messageSurface,
    // AAA too: mobile darkens the bubble behind code fences.
    messageForeground: readable(text, messageSurface, 7),
    messageAction: s.accent2,
    messageActionForeground: readableOn(s.accent2, s.canvas, text),
    messageActionHover: mix(s.accent2, text, 0.12),
    codeBackground: raisedSoft,
    codeForeground: text,
    sidebar: s.sidebar,
    // Solved against the selected row, the strongest tint it sits on.
    sidebarForeground: readable(text, sidebarRowSelected),
    sidebarMutedForeground: readable(s.muted, s.sidebar),
    sidebarControlSurface: s.overlay,
    // Rows take the accent's hue, which is most of what makes a palette recognizable.
    sidebarRowHover: tint(s.sidebar, s.accent, 0.08, 0.1),
    sidebarRowActive: tint(s.sidebar, s.accent, 0.13, 0.16),
    sidebarRowSelected,
    sidebarBorder: s.border,
    terminalBackground: s.canvas,
    terminalForeground: text,
    terminalCursor: s.accent,
    terminalSelection: s.selection,
    terminalScrollbar: mix(s.border, subtle, 0.3),
    terminalScrollbarHover: subtle,
  } satisfies Record<Exclude<keyof ThemeColors, keyof typeof SEARCH_COLORS.light>, Oklab>;

  return {
    ...(Object.fromEntries(
      Object.entries(colors).map(([role, color]) => [role, toThemeColor(color)]),
    ) as Omit<ThemeColors, keyof typeof SEARCH_COLORS.light>),
    ...SEARCH_COLORS[appearance],
    ...(dark
      ? {}
      : {
          searchMatchBackground: (
            LIGHT_SEARCH_MATCH_CANDIDATES.find((candidate) =>
              [raisedSoft, messageSurface].every(
                (surface) => oklabDistance(surface, candidate.lab) > 0.1,
              ),
            ) ?? LIGHT_SEARCH_MATCH_CANDIDATES[0]!
          ).color,
        }),
  };
}

function forkTheme(
  id: ForkThemeId,
  label: string,
  seeds: Readonly<{ light: ForkThemeSeed; dark: ForkThemeSeed }>,
): ThemeDefinition {
  return {
    id,
    label,
    appearance: "light",
    colors: forkThemeColors(seeds.light, "light"),
    variants: { dark: forkThemeColors(seeds.dark, "dark") },
    // Each fork theme paints the stage artwork too; see forkThemes.css in the web app.
    sidebarArtwork: true,
  };
}

export const FORK_THEMES: ReadonlyArray<ThemeDefinition> = [
  forkTheme("fork-catppuccin", "Catppuccin", {
    light: {
      canvas: "#eff1f5",
      sidebar: "#e6e9ef",
      raised: "#dce0e8",
      overlay: "#ccd0da",
      border: "#bcc0cc",
      selection: "#acb0be",
      text: "#4c4f69",
      muted: "#5c5f77",
      subtle: "#7c7f93",
      accent: "#8839ef",
      accent2: "#ea76cb",
      red: "#d20f39",
      yellow: "#df8e1d",
    },
    dark: {
      canvas: "#1e1e2e",
      sidebar: "#181825",
      raised: "#313244",
      overlay: "#45475a",
      border: "#585b70",
      selection: "#585b70",
      text: "#cdd6f4",
      muted: "#a6adc8",
      subtle: "#7f849c",
      accent: "#cba6f7",
      accent2: "#f5c2e7",
      red: "#f38ba8",
      yellow: "#f9e2af",
    },
  }),
  forkTheme("fork-rose-pine", "Rosé Pine", {
    light: {
      canvas: "#faf4ed",
      sidebar: "#f4ede8",
      raised: "#f2e9e1",
      overlay: "#dfdad9",
      border: "#cecacd",
      selection: "#dfdad9",
      text: "#575279",
      muted: "#797593",
      subtle: "#9893a5",
      accent: "#286983",
      accent2: "#b4637a",
      red: "#b4637a",
      yellow: "#ea9d34",
    },
    dark: {
      canvas: "#191724",
      sidebar: "#1f1d2e",
      raised: "#26233a",
      overlay: "#403d52",
      border: "#524f67",
      selection: "#403d52",
      text: "#e0def4",
      muted: "#908caa",
      subtle: "#6e6a86",
      accent: "#c4a7e7",
      accent2: "#ebbcba",
      red: "#eb6f92",
      yellow: "#f6c177",
    },
  }),
  forkTheme("fork-tokyo-night", "Tokyo Night", {
    light: {
      canvas: "#e1e2e7",
      sidebar: "#d0d5e3",
      raised: "#d6d9e3",
      overlay: "#c4c8da",
      border: "#a8aecb",
      selection: "#b7c1e3",
      text: "#3760bf",
      muted: "#6172b0",
      subtle: "#848cb5",
      accent: "#2e7de9",
      accent2: "#9854f1",
      red: "#f52a65",
      yellow: "#8c6c3e",
    },
    dark: {
      canvas: "#1a1b26",
      sidebar: "#16161e",
      raised: "#24283b",
      overlay: "#292e42",
      border: "#3b4261",
      selection: "#283457",
      text: "#c0caf5",
      muted: "#a9b1d6",
      subtle: "#565f89",
      accent: "#7aa2f7",
      accent2: "#bb9af7",
      red: "#f7768e",
      yellow: "#e0af68",
    },
  }),
  forkTheme("fork-gruvbox", "Gruvbox", {
    light: {
      canvas: "#fbf1c7",
      sidebar: "#f2e5bc",
      raised: "#ebdbb2",
      overlay: "#d5c4a1",
      border: "#bdae93",
      selection: "#d5c4a1",
      text: "#3c3836",
      muted: "#665c54",
      subtle: "#7c6f64",
      accent: "#af3a03",
      accent2: "#427b58",
      red: "#9d0006",
      yellow: "#b57614",
    },
    dark: {
      canvas: "#282828",
      sidebar: "#1d2021",
      raised: "#3c3836",
      overlay: "#504945",
      border: "#665c54",
      selection: "#504945",
      text: "#ebdbb2",
      muted: "#bdae93",
      subtle: "#928374",
      accent: "#fe8019",
      accent2: "#8ec07c",
      red: "#fb4934",
      yellow: "#fabd2f",
    },
  }),
  forkTheme("fork-solarized", "Solarized", {
    light: {
      canvas: "#fdf6e3",
      sidebar: "#eee8d5",
      raised: "#eee8d5",
      overlay: "#e4ddc8",
      border: "#d9d2bd",
      selection: "#e4ddc8",
      text: "#073642",
      muted: "#586e75",
      subtle: "#93a1a1",
      accent: "#268bd2",
      accent2: "#d33682",
      red: "#dc322f",
      yellow: "#b58900",
    },
    dark: {
      canvas: "#002b36",
      sidebar: "#00212b",
      raised: "#073642",
      overlay: "#0d4150",
      border: "#1c5260",
      selection: "#073642",
      text: "#93a1a1",
      muted: "#839496",
      subtle: "#657b83",
      accent: "#268bd2",
      accent2: "#2aa198",
      red: "#dc322f",
      yellow: "#b58900",
    },
  }),
  forkTheme("fork-everforest", "Everforest", {
    light: {
      canvas: "#fdf6e3",
      sidebar: "#f4f0d9",
      raised: "#efebd4",
      overlay: "#e6e2cc",
      border: "#bdc3af",
      selection: "#e0dcc7",
      text: "#5c6a72",
      muted: "#829181",
      subtle: "#a6b0a0",
      accent: "#8da101",
      accent2: "#f57d26",
      red: "#f85552",
      yellow: "#dfa000",
    },
    dark: {
      canvas: "#2d353b",
      sidebar: "#232a2e",
      raised: "#343f44",
      overlay: "#3d484d",
      border: "#4f585e",
      selection: "#475258",
      text: "#d3c6aa",
      muted: "#9da9a0",
      subtle: "#859289",
      accent: "#a7c080",
      accent2: "#e69875",
      red: "#e67e80",
      yellow: "#dbbc7f",
    },
  }),
  forkTheme("fork-kanagawa", "Kanagawa", {
    light: {
      canvas: "#f2ecbc",
      sidebar: "#e5ddb0",
      raised: "#e7dba0",
      overlay: "#dcd5ac",
      border: "#c9cbd1",
      selection: "#c9cbd1",
      text: "#545464",
      muted: "#716e61",
      subtle: "#8a8980",
      accent: "#4d699b",
      accent2: "#b35b79",
      red: "#c84053",
      yellow: "#de9800",
    },
    dark: {
      canvas: "#1f1f28",
      sidebar: "#16161d",
      raised: "#2a2a37",
      overlay: "#363646",
      border: "#54546d",
      selection: "#2d4f67",
      text: "#dcd7ba",
      muted: "#c8c093",
      subtle: "#727169",
      accent: "#7e9cd8",
      accent2: "#d27e99",
      red: "#e46876",
      yellow: "#e6c384",
    },
  }),
  forkTheme("fork-github", "GitHub", {
    light: {
      canvas: "#ffffff",
      sidebar: "#f6f8fa",
      raised: "#f6f8fa",
      overlay: "#eaeef2",
      border: "#d0d7de",
      selection: "#b6e3ff",
      text: "#1f2328",
      muted: "#656d76",
      subtle: "#8c959f",
      accent: "#0969da",
      accent2: "#8250df",
      red: "#cf222e",
      yellow: "#bf8700",
    },
    dark: {
      canvas: "#0d1117",
      sidebar: "#010409",
      raised: "#161b22",
      overlay: "#21262d",
      border: "#30363d",
      selection: "#1f3b61",
      text: "#e6edf3",
      muted: "#8d96a0",
      subtle: "#6e7681",
      accent: "#1f6feb",
      accent2: "#a371f7",
      red: "#f85149",
      yellow: "#d29922",
    },
  }),
  forkTheme("fork-one", "One", {
    light: {
      canvas: "#fafafa",
      sidebar: "#f0f0f1",
      raised: "#eaeaeb",
      overlay: "#e5e5e6",
      border: "#dbdbdc",
      selection: "#d7dae0",
      text: "#383a42",
      muted: "#696c77",
      subtle: "#a0a1a7",
      accent: "#4078f2",
      accent2: "#a626a4",
      red: "#e45649",
      yellow: "#c18401",
    },
    dark: {
      canvas: "#282c34",
      sidebar: "#21252b",
      raised: "#2c313a",
      overlay: "#3a3f4b",
      border: "#3e4451",
      selection: "#3e4451",
      text: "#abb2bf",
      muted: "#828997",
      subtle: "#5c6370",
      accent: "#61afef",
      accent2: "#c678dd",
      red: "#e06c75",
      yellow: "#e5c07b",
    },
  }),
  forkTheme("fork-nord", "Nord", {
    light: {
      canvas: "#eceff4",
      sidebar: "#e5e9f0",
      raised: "#e5e9f0",
      overlay: "#d8dee9",
      border: "#c2cad6",
      selection: "#d8dee9",
      text: "#2e3440",
      muted: "#4c566a",
      subtle: "#616e88",
      accent: "#5e81ac",
      accent2: "#b48ead",
      red: "#bf616a",
      yellow: "#d08770",
    },
    dark: {
      canvas: "#2e3440",
      sidebar: "#272c36",
      raised: "#3b4252",
      overlay: "#434c5e",
      border: "#4c566a",
      selection: "#434c5e",
      text: "#d8dee9",
      muted: "#a3adbf",
      subtle: "#616e88",
      accent: "#88c0d0",
      accent2: "#b48ead",
      red: "#bf616a",
      yellow: "#ebcb8b",
    },
  }),
  forkTheme("fork-dracula", "Dracula", {
    light: {
      canvas: "#fffbeb",
      sidebar: "#f4f0dd",
      raised: "#efebd8",
      overlay: "#e6e2cf",
      border: "#d8d4c3",
      selection: "#cfcfde",
      text: "#1f1f1f",
      muted: "#6c664b",
      subtle: "#908b72",
      accent: "#644ac9",
      accent2: "#a3144d",
      red: "#cb3a2a",
      yellow: "#846e15",
    },
    dark: {
      canvas: "#282a36",
      sidebar: "#21222c",
      raised: "#343746",
      overlay: "#44475a",
      border: "#4d5066",
      selection: "#44475a",
      text: "#f8f8f2",
      muted: "#b6b9c9",
      subtle: "#6272a4",
      accent: "#bd93f9",
      accent2: "#ff79c6",
      red: "#ff5555",
      yellow: "#f1fa8c",
    },
  }),
  forkTheme("fork-ayu", "Ayu", {
    light: {
      canvas: "#fcfcfc",
      sidebar: "#f3f4f5",
      raised: "#eff0f1",
      overlay: "#e6e8ea",
      border: "#d9dbde",
      selection: "#d4e4f5",
      text: "#5c6166",
      muted: "#787b80",
      subtle: "#8a9199",
      accent: "#fa8d3e",
      accent2: "#399ee6",
      red: "#e65050",
      yellow: "#f2ae49",
    },
    dark: {
      canvas: "#0d1017",
      sidebar: "#0b0e14",
      raised: "#131721",
      overlay: "#1c212b",
      border: "#262b36",
      selection: "#1d3550",
      text: "#bfbdb6",
      muted: "#8b8f97",
      subtle: "#565b66",
      accent: "#e6b450",
      accent2: "#59c2ff",
      red: "#d95757",
      yellow: "#ffb454",
    },
  }),
  forkTheme("fork-monokai-pro", "Monokai Pro", {
    light: {
      canvas: "#faf4f2",
      sidebar: "#f2ebe9",
      raised: "#ede7e5",
      overlay: "#e1dbd9",
      border: "#d3cdcc",
      selection: "#e1dbd9",
      text: "#29242a",
      muted: "#706b6e",
      subtle: "#918c8e",
      accent: "#cc7a0a",
      accent2: "#e14775",
      red: "#e14775",
      yellow: "#e16032",
    },
    dark: {
      canvas: "#2d2a2e",
      sidebar: "#221f22",
      raised: "#383539",
      overlay: "#403e41",
      border: "#5b595c",
      selection: "#5b595c",
      text: "#fcfcfa",
      muted: "#c1c0c0",
      subtle: "#939293",
      accent: "#ffd866",
      accent2: "#ff6188",
      red: "#ff6188",
      yellow: "#fc9867",
    },
  }),
  forkTheme("fork-night-owl", "Night Owl", {
    light: {
      canvas: "#fbfbfb",
      sidebar: "#f0f0f0",
      raised: "#f0f0f0",
      overlay: "#e6e6e6",
      border: "#d9d9d9",
      selection: "#e0e0e0",
      text: "#403f53",
      muted: "#697098",
      subtle: "#989fb1",
      accent: "#0c969b",
      accent2: "#994cc3",
      red: "#de3d3b",
      yellow: "#daaa01",
    },
    dark: {
      canvas: "#011627",
      sidebar: "#010e1a",
      raised: "#0b253a",
      overlay: "#112e47",
      border: "#1d3b53",
      selection: "#1d3b53",
      text: "#d6deeb",
      muted: "#89a4bb",
      subtle: "#637777",
      accent: "#7fdbca",
      accent2: "#c792ea",
      red: "#ef5350",
      yellow: "#ecc48d",
    },
  }),
  forkTheme("fork-vitesse", "Vitesse", {
    light: {
      canvas: "#ffffff",
      sidebar: "#f7f7f7",
      raised: "#f4f4f2",
      overlay: "#ebebe8",
      border: "#e3e3df",
      selection: "#dceee4",
      text: "#393a34",
      muted: "#6b6c66",
      subtle: "#a0ada0",
      accent: "#1c6b48",
      accent2: "#b56959",
      red: "#ab5959",
      yellow: "#bda437",
    },
    dark: {
      canvas: "#121212",
      sidebar: "#0e0e0e",
      raised: "#1a1a1a",
      overlay: "#232323",
      border: "#2b2b2b",
      selection: "#24332c",
      text: "#dbd7ca",
      muted: "#a5a294",
      subtle: "#758575",
      accent: "#4d9375",
      accent2: "#c98a7d",
      red: "#cb7676",
      yellow: "#e6cc77",
    },
  }),
  forkTheme("fork-flexoki", "Flexoki", {
    light: {
      canvas: "#fffcf0",
      sidebar: "#f2f0e5",
      raised: "#f2f0e5",
      overlay: "#e6e4d9",
      border: "#dad8ce",
      selection: "#dad8ce",
      text: "#100f0f",
      muted: "#6f6e69",
      subtle: "#878580",
      accent: "#24837b",
      accent2: "#bc5215",
      red: "#af3029",
      yellow: "#ad8301",
    },
    dark: {
      canvas: "#100f0f",
      sidebar: "#1c1b1a",
      raised: "#1c1b1a",
      overlay: "#282726",
      border: "#343331",
      selection: "#403e3c",
      text: "#cecdc3",
      muted: "#878580",
      subtle: "#575653",
      accent: "#3aa99f",
      accent2: "#da702c",
      red: "#d14d41",
      yellow: "#d0a215",
    },
  }),
  forkTheme("fork-horizon", "Horizon", {
    light: {
      canvas: "#fdf0ed",
      sidebar: "#fbe4de",
      raised: "#f9e2db",
      overlay: "#f6d6cc",
      border: "#f1c7bb",
      selection: "#f9cbbe",
      text: "#1c1e26",
      muted: "#6c6f93",
      subtle: "#8f8fa8",
      accent: "#e95378",
      accent2: "#1d8991",
      red: "#da103f",
      yellow: "#f6661e",
    },
    dark: {
      canvas: "#1c1e26",
      sidebar: "#16161c",
      raised: "#232530",
      overlay: "#2e303e",
      border: "#2e303e",
      selection: "#2e303e",
      text: "#d5d8da",
      muted: "#a5a8c2",
      subtle: "#6c6f93",
      accent: "#e95378",
      accent2: "#25b0bc",
      red: "#f43e5c",
      yellow: "#fab795",
    },
  }),
  // Synthwave '84 ships dark only; the light half is a lavender "sunrise" in
  // the same pink, cyan and gold, deepened so it reads on a pale canvas.
  forkTheme("fork-synthwave", "Synthwave '84", {
    light: {
      canvas: "#fbf5ff",
      sidebar: "#f3eafb",
      raised: "#efe5f8",
      overlay: "#e5d8f2",
      border: "#d6c4e8",
      selection: "#f6cdef",
      text: "#2a1f3d",
      muted: "#6b5a84",
      subtle: "#8f84a8",
      accent: "#c2189d",
      accent2: "#0b8a9a",
      red: "#d61f45",
      yellow: "#b07a00",
    },
    dark: {
      canvas: "#262335",
      sidebar: "#1e1a2e",
      raised: "#322b4a",
      overlay: "#3b3157",
      border: "#463465",
      selection: "#463465",
      text: "#f9f6ff",
      muted: "#b6b1d1",
      subtle: "#848bbd",
      accent: "#ff7edb",
      accent2: "#36f9f6",
      red: "#fe4450",
      yellow: "#fede5d",
    },
  }),
  // Anime-inspired originals: each captures a mood, not a franchise.
  // Neon Rain is a rain-slicked city at night: indigo, cyan signage, hot pink.
  forkTheme("fork-neon-rain", "Neon Rain", {
    light: {
      canvas: "#f7f6ff",
      sidebar: "#eeecfb",
      raised: "#ebe8fa",
      overlay: "#dfdaf5",
      border: "#cdc6ec",
      selection: "#ffd0ea",
      text: "#1a1238",
      muted: "#5a5285",
      subtle: "#8a84b0",
      accent: "#d4006f",
      accent2: "#0091a8",
      red: "#d1153a",
      yellow: "#a87a00",
    },
    dark: {
      canvas: "#0d0b1e",
      sidebar: "#08061a",
      raised: "#161334",
      overlay: "#211c4a",
      border: "#2e2860",
      selection: "#3a1f5c",
      text: "#e8e6ff",
      muted: "#a49fd0",
      subtle: "#6c66a3",
      accent: "#ff2e97",
      accent2: "#00e5ff",
      red: "#ff3b5c",
      yellow: "#ffd60a",
    },
  }),
  // A hand-painted pastoral: open sky, cream clouds, summer grass.
  forkTheme("fork-meadow-wind", "Meadow Wind", {
    light: {
      canvas: "#f8f6ec",
      sidebar: "#eef0e0",
      raised: "#ebeedd",
      overlay: "#e0e5cf",
      border: "#ccd4b8",
      selection: "#cfe5f2",
      text: "#2f3a2c",
      muted: "#5b6a55",
      subtle: "#8a9884",
      accent: "#3d8fc4",
      accent2: "#6a9a3c",
      red: "#c2453a",
      yellow: "#b8890f",
    },
    dark: {
      canvas: "#172026",
      sidebar: "#11181d",
      raised: "#1f2a31",
      overlay: "#28353d",
      border: "#34444c",
      selection: "#2a4658",
      text: "#e6ead8",
      muted: "#a9b5a3",
      subtle: "#6f7f74",
      accent: "#7fc3ec",
      accent2: "#a3cf6e",
      red: "#e57d6f",
      yellow: "#f0cf7a",
    },
  }),
  // Giant-robot armor: deep violet plating with lime and warning-orange trim.
  forkTheme("fork-mecha-violet", "Mecha Violet", {
    light: {
      canvas: "#faf7fd",
      sidebar: "#f1ebf8",
      raised: "#ede6f6",
      overlay: "#e2d8f0",
      border: "#d0c2e3",
      selection: "#e1f5c4",
      text: "#24163a",
      muted: "#5e4b7a",
      subtle: "#8e7fa8",
      accent: "#6b2fb3",
      accent2: "#4f8a0b",
      red: "#c9262f",
      yellow: "#a77800",
    },
    dark: {
      canvas: "#1a1225",
      sidebar: "#140d1d",
      raised: "#241933",
      overlay: "#2e2142",
      border: "#3f2d58",
      selection: "#3d2a5a",
      text: "#ece4f7",
      muted: "#b5a5cc",
      subtle: "#7a6894",
      accent: "#9be33f",
      accent2: "#ff8a1f",
      red: "#ff4d4d",
      yellow: "#ffc93c",
    },
  }),
  // Cherry blossoms by day, lantern-lit petals by night.
  forkTheme("fork-sakura-drift", "Sakura Drift", {
    light: {
      canvas: "#fff7f9",
      sidebar: "#fdecf1",
      raised: "#fbe8ee",
      overlay: "#f6d9e3",
      border: "#efc6d4",
      selection: "#ffd1df",
      text: "#3b2530",
      muted: "#7a5a68",
      subtle: "#a88896",
      accent: "#d6457a",
      accent2: "#5c9a5a",
      red: "#c62f3f",
      yellow: "#b7801a",
    },
    dark: {
      canvas: "#1f1a22",
      sidebar: "#19151c",
      raised: "#29222d",
      overlay: "#342b39",
      border: "#45394b",
      selection: "#4a2f40",
      text: "#f5e6ec",
      muted: "#c4a9b6",
      subtle: "#8a7380",
      accent: "#f49ac1",
      accent2: "#9cc98b",
      red: "#ff6b81",
      yellow: "#f2c879",
    },
  }),
  // Battle-shonen energy: blazing orange, crimson, and a hero-blue sky.
  forkTheme("fork-sunset-rush", "Sunset Rush", {
    light: {
      canvas: "#fffaf2",
      sidebar: "#fff0dd",
      raised: "#fdecd6",
      overlay: "#f8dfc0",
      border: "#efcca3",
      selection: "#ffd9b0",
      text: "#2b1a10",
      muted: "#6e5040",
      subtle: "#a08670",
      accent: "#e8590c",
      accent2: "#2f6fde",
      red: "#c92a2a",
      yellow: "#b07800",
    },
    dark: {
      canvas: "#1d1418",
      sidebar: "#170f12",
      raised: "#2a1c20",
      overlay: "#36252a",
      border: "#4a3238",
      selection: "#5a2f24",
      text: "#fbeee0",
      muted: "#d0b3a4",
      subtle: "#8f7268",
      accent: "#ff8c2b",
      accent2: "#5c9dff",
      red: "#ff5252",
      yellow: "#ffd43b",
    },
  }),
  // Whisked green tea on washi paper, with roasted-hojicha brown.
  forkTheme("fork-matcha", "Matcha", {
    light: {
      canvas: "#f7f5ec",
      sidebar: "#eceee0",
      raised: "#e9ebdc",
      overlay: "#dde2cd",
      border: "#c7cfb3",
      selection: "#d6e6c4",
      text: "#263022",
      muted: "#56614d",
      subtle: "#8a937e",
      accent: "#4c7a3a",
      accent2: "#a0704b",
      red: "#b4423a",
      yellow: "#a88416",
    },
    dark: {
      canvas: "#1a1f1a",
      sidebar: "#141814",
      raised: "#232a23",
      overlay: "#2c342c",
      border: "#3a453a",
      selection: "#34482f",
      text: "#e5e9da",
      muted: "#aab3a0",
      subtle: "#727c6c",
      accent: "#8fbf72",
      accent2: "#d9a27a",
      red: "#e0796b",
      yellow: "#e5c76b",
    },
  }),
  // Lemon, lime, and tangerine over a cool teal splash.
  forkTheme("fork-citrus-pop", "Citrus Pop", {
    light: {
      canvas: "#fffef5",
      sidebar: "#fbf9e3",
      raised: "#f8f6dc",
      overlay: "#efedc9",
      border: "#e0dcaa",
      selection: "#f2f5a8",
      text: "#1f2412",
      muted: "#5a6040",
      subtle: "#8d9270",
      accent: "#5b8c00",
      accent2: "#e8640c",
      red: "#d02c2c",
      yellow: "#b88a00",
    },
    dark: {
      canvas: "#16180f",
      sidebar: "#111309",
      raised: "#1f2216",
      overlay: "#292d1d",
      border: "#383d27",
      selection: "#3d4520",
      text: "#f2f4dc",
      muted: "#b8bd98",
      subtle: "#7c8160",
      accent: "#c6e23a",
      accent2: "#ff9a3c",
      red: "#ff5c5c",
      yellow: "#ffd23f",
    },
  }),
  // Dark roast and crema, with a mint-tile counter for contrast.
  forkTheme("fork-espresso", "Espresso", {
    light: {
      canvas: "#fbf7f2",
      sidebar: "#f3ebe1",
      raised: "#efe6da",
      overlay: "#e5d8c8",
      border: "#d4c2ad",
      selection: "#ead6bf",
      text: "#2a1d15",
      muted: "#6b5444",
      subtle: "#9b8573",
      accent: "#8b5a3c",
      accent2: "#3f7c6f",
      red: "#b83a2e",
      yellow: "#a87a12",
    },
    dark: {
      canvas: "#1c1714",
      sidebar: "#16110f",
      raised: "#26201c",
      overlay: "#312924",
      border: "#40362f",
      selection: "#4a3a2c",
      text: "#efe4d6",
      muted: "#bfae9c",
      subtle: "#857565",
      accent: "#d4a373",
      accent2: "#7fbfa9",
      red: "#e57b67",
      yellow: "#e8c06a",
    },
  }),
];
