/**
 * Theme palette helpers — mirrored from Convocore dashboard behaviour.
 * Builds `nineColorPallet` for `customThemeJSONString`.
 */

/** Converts hex to `[H (0–360), S (0–100), L (0–100)]` (same semantics as dashboard). */
export function hexToHsl(hex: string): number[] | undefined {
  let hHex = hex.replace('#', '').trim();

  if (hHex.length === 3) {
    hHex = hHex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  if (hHex.length < 6) return undefined;

  const r = parseInt(hHex.substring(0, 2), 16) / 255;
  const g = parseInt(hHex.substring(2, 4), 16) / 255;
  const b = parseInt(hHex.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function handleAutoGenPallet(
  rootColor: string,
  themeType: 'light' | 'dark'
): number[][] | undefined {
  const baseColorHSL = hexToHsl(rootColor);

  if (!baseColorHSL?.length) return undefined;

  const newHSLColorsArray: number[][] = [];

  for (let i = 10; i > 0; i--) {
    const changePerIndex = 10;
    const newHslColor = baseColorHSL.slice(0, 2);
    const finalLuinousValue =
      i * changePerIndex === 100 ? 95 : (i * changePerIndex) || 5;
    newHslColor[2] = finalLuinousValue;
    newHSLColorsArray.push(newHslColor);
  }

  const nineColorPalletFinale =
    themeType === 'dark' ? [...newHSLColorsArray].reverse() : newHSLColorsArray;
  return nineColorPalletFinale;
}
