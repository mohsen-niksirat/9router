# 9Router Web — V4 Responsive Verification Report

Automated Playwright headless Chromium check across 7 viewports × 9 states (63 checks).
Assertion: `document.documentElement.scrollWidth <= window.innerWidth + 1`.

## Summary

- **Baseline (before fixes):** 46/63 passed, **17 failed**
- **Final (after fixes):** 63/63 passed, **0 failed**

## Matrix (Baseline → Final)

| Viewport | State | Baseline (`scrollWidth/innerWidth`) | Final (`scrollWidth/innerWidth`) | Status |
| --- | --- | --- | --- | --- |
| `360x800` | `chat` | 360/360 (FAIL) | 360/360 | **PASS** |
| `360x800` | `providers` | 360/360 (FAIL) | 360/360 | **PASS** |
| `360x800` | `combos` | 360/360 (FAIL) | 360/360 | **PASS** |
| `360x800` | `team` | 360/360 (FAIL) | 360/360 | **PASS** |
| `360x800` | `arena` | 360/360 (FAIL) | 360/360 | **PASS** |
| `360x800` | `analytics` | 360/360 (FAIL) | 360/360 | **PASS** |
| `360x800` | `settings-modal` | 360/360 (FAIL) | 360/360 | **PASS** |
| `360x800` | `prompts-modal` | 360/360 (FAIL) | 360/360 | **PASS** |
| `360x800` | `model-popover` | 360/360 (FAIL) | 360/360 | **PASS** |
| `390x844` | `chat` | 390/390 (PASS) | 390/390 | **PASS** |
| `390x844` | `providers` | 390/390 (PASS) | 390/390 | **PASS** |
| `390x844` | `combos` | 390/390 (PASS) | 390/390 | **PASS** |
| `390x844` | `team` | 390/390 (PASS) | 390/390 | **PASS** |
| `390x844` | `arena` | 390/390 (PASS) | 390/390 | **PASS** |
| `390x844` | `analytics` | 390/390 (FAIL) | 390/390 | **PASS** |
| `390x844` | `settings-modal` | 390/390 (PASS) | 390/390 | **PASS** |
| `390x844` | `prompts-modal` | 390/390 (PASS) | 390/390 | **PASS** |
| `390x844` | `model-popover` | 390/390 (FAIL) | 390/390 | **PASS** |
| `844x390` | `chat` | 844/844 (PASS) | 844/844 | **PASS** |
| `844x390` | `providers` | 844/844 (PASS) | 844/844 | **PASS** |
| `844x390` | `combos` | 844/844 (PASS) | 844/844 | **PASS** |
| `844x390` | `team` | 844/844 (PASS) | 844/844 | **PASS** |
| `844x390` | `arena` | 844/844 (PASS) | 844/844 | **PASS** |
| `844x390` | `analytics` | 844/844 (FAIL) | 844/844 | **PASS** |
| `844x390` | `settings-modal` | 844/844 (PASS) | 844/844 | **PASS** |
| `844x390` | `prompts-modal` | 844/844 (PASS) | 844/844 | **PASS** |
| `844x390` | `model-popover` | 844/844 (FAIL) | 844/844 | **PASS** |
| `768x1024` | `chat` | 768/768 (PASS) | 768/768 | **PASS** |
| `768x1024` | `providers` | 768/768 (PASS) | 768/768 | **PASS** |
| `768x1024` | `combos` | 768/768 (PASS) | 768/768 | **PASS** |
| `768x1024` | `team` | 768/768 (PASS) | 768/768 | **PASS** |
| `768x1024` | `arena` | 768/768 (PASS) | 768/768 | **PASS** |
| `768x1024` | `analytics` | 768/768 (FAIL) | 768/768 | **PASS** |
| `768x1024` | `settings-modal` | 768/768 (PASS) | 768/768 | **PASS** |
| `768x1024` | `prompts-modal` | 768/768 (PASS) | 768/768 | **PASS** |
| `768x1024` | `model-popover` | 768/768 (FAIL) | 768/768 | **PASS** |
| `1024x768` | `chat` | 1024/1024 (PASS) | 1024/1024 | **PASS** |
| `1024x768` | `providers` | 1024/1024 (PASS) | 1024/1024 | **PASS** |
| `1024x768` | `combos` | 1024/1024 (PASS) | 1024/1024 | **PASS** |
| `1024x768` | `team` | 1024/1024 (PASS) | 1024/1024 | **PASS** |
| `1024x768` | `arena` | 1024/1024 (PASS) | 1024/1024 | **PASS** |
| `1024x768` | `analytics` | 1024/1024 (FAIL) | 1024/1024 | **PASS** |
| `1024x768` | `settings-modal` | 1024/1024 (PASS) | 1024/1024 | **PASS** |
| `1024x768` | `prompts-modal` | 1024/1024 (PASS) | 1024/1024 | **PASS** |
| `1024x768` | `model-popover` | 1024/1024 (PASS) | 1024/1024 | **PASS** |
| `1280x800` | `chat` | 1280/1280 (PASS) | 1280/1280 | **PASS** |
| `1280x800` | `providers` | 1280/1280 (PASS) | 1280/1280 | **PASS** |
| `1280x800` | `combos` | 1280/1280 (PASS) | 1280/1280 | **PASS** |
| `1280x800` | `team` | 1280/1280 (PASS) | 1280/1280 | **PASS** |
| `1280x800` | `arena` | 1280/1280 (PASS) | 1280/1280 | **PASS** |
| `1280x800` | `analytics` | 1280/1280 (FAIL) | 1280/1280 | **PASS** |
| `1280x800` | `settings-modal` | 1280/1280 (PASS) | 1280/1280 | **PASS** |
| `1280x800` | `prompts-modal` | 1280/1280 (PASS) | 1280/1280 | **PASS** |
| `1280x800` | `model-popover` | 1280/1280 (PASS) | 1280/1280 | **PASS** |
| `1920x1080` | `chat` | 1920/1920 (PASS) | 1920/1920 | **PASS** |
| `1920x1080` | `providers` | 1920/1920 (PASS) | 1920/1920 | **PASS** |
| `1920x1080` | `combos` | 1920/1920 (PASS) | 1920/1920 | **PASS** |
| `1920x1080` | `team` | 1920/1920 (PASS) | 1920/1920 | **PASS** |
| `1920x1080` | `arena` | 1920/1920 (PASS) | 1920/1920 | **PASS** |
| `1920x1080` | `analytics` | 1920/1920 (PASS) | 1920/1920 | **PASS** |
| `1920x1080` | `settings-modal` | 1920/1920 (PASS) | 1920/1920 | **PASS** |
| `1920x1080` | `prompts-modal` | 1920/1920 (PASS) | 1920/1920 | **PASS** |
| `1920x1080` | `model-popover` | 1920/1920 (PASS) | 1920/1920 | **PASS** |
