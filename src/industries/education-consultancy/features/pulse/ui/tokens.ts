/**
 * Design tokens lifted from docs/pulse-mockup/pulse-v2.html (the spec for spacing and colour). Kept in one place so
 * the page, the cards and the drawers cannot drift apart again.
 *   --fg #333  --ink #171717  --mfg #6b7280  --border #e5e7eb  --muted #f5f5f5  --r 1rem  base 13px / 1.45, tnum
 */
export const CARD = "rounded-[16px] border border-[#e5e7eb] bg-white p-[18px] shadow-[0_1px_2px_rgba(16,24,40,0.04)]";
export const BTN = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[10px] border border-[#e5e7eb] bg-white px-3 py-[7px] font-medium text-[#171717] hover:bg-[#fafafa]";
export const BTN_SM = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-[#e5e7eb] bg-white px-2.5 py-[5px] text-[12px] font-medium text-[#171717] hover:bg-[#fafafa]";
export const BTN_LINK = "inline-flex items-center gap-1 whitespace-nowrap px-1 py-[5px] text-[12px] font-medium text-[#6b7280] hover:text-[#171717]";
export const SEC_TITLE = "text-[14px] font-semibold text-[#171717]";
export const SEC_SUB = "text-[12px] text-[#6b7280]";
export const ROOT = "text-[13px] leading-[1.45] text-[#333] [font-feature-settings:'tnum'_1]";
