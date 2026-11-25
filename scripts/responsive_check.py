#!/usr/bin/env python3
"""
9Router Web — V4 Responsive Verification Harness (Part A & Part F)
Runs headless Chromium via Playwright across 7 viewports × 9 states,
asserts `document.documentElement.scrollWidth <= window.innerWidth + 1`,
saves screenshots to docs/responsive/<viewport>-<state>.png,
and writes baseline/final JSON + docs/responsive/REPORT.md.

Usage:
  python scripts/responsive_check.py --mode baseline
  python scripts/responsive_check.py --mode final
"""

import argparse
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "docs" / "responsive"

VIEWPORTS = [
    ("360x800", 360, 800, "small Android"),
    ("390x844", 390, 844, "iPhone"),
    ("844x390", 844, 390, "landscape phone"),
    ("768x1024", 768, 1024, "tablet portrait"),
    ("1024x768", 1024, 768, "tablet landscape"),
    ("1280x800", 1280, 800, "desktop"),
    ("1920x1080", 1920, 1080, "large desktop"),
]

STATES = [
    "chat",
    "providers",
    "combos",
    "team",
    "arena",
    "analytics",
    "settings-modal",
    "prompts-modal",
    "model-popover",
]


def build_seed_state():
    now = int(time.time() * 1000)
    hour = 3600 * 1000
    return {
        "providers": [
            {
                "id": "prov_openrouter",
                "slug": "openrouter",
                "name": "OpenRouter",
                "baseUrl": "https://openrouter.ai/api/v1",
                "defaultModel": "google/gemini-2.5-flash",
                "models": [
                    "google/gemini-2.5-flash",
                    "deepseek/deepseek-r1",
                    "anthropic/claude-sonnet-4",
                    "openai/gpt-4o-mini",
                ],
                "color": "#6366f1",
                "pinned": True,
                "isBuiltin": True,
                "supportsImages": False,
                "noKey": False,
                "keys": [
                    {
                        "id": "k_fake_or_1",
                        "label": "Fake Primary",
                        "key": "sk-fake-openrouter-0000000000000001",
                        "enabled": True,
                        "tokens": 12450,
                        "errors": 0,
                    }
                ],
            },
            {
                "id": "prov_openai",
                "slug": "openai",
                "name": "OpenAI",
                "baseUrl": "https://api.openai.com/v1",
                "defaultModel": "gpt-4o-mini",
                "models": ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-image-1"],
                "color": "#10a37f",
                "pinned": True,
                "isBuiltin": True,
                "supportsImages": True,
                "noKey": False,
                "keys": [
                    {
                        "id": "k_fake_oai_1",
                        "label": "Fake Work Key",
                        "key": "sk-fake-openai-0000000000000002",
                        "enabled": True,
                        "tokens": 8320,
                        "errors": 0,
                    }
                ],
            },
            {
                "id": "prov_gemini",
                "slug": "gemini",
                "name": "Google Gemini",
                "baseUrl": "https://generativelanguage.googleapis.com/v1beta/openai",
                "defaultModel": "gemini-2.5-flash",
                "models": ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
                "color": "#3b82f6",
                "pinned": True,
                "isBuiltin": True,
                "supportsImages": False,
                "noKey": False,
                "keys": [
                    {
                        "id": "k_fake_gem_1",
                        "label": "Fake Gemini",
                        "key": "sk-fake-gemini-0000000000000003",
                        "enabled": True,
                        "tokens": 5100,
                        "errors": 0,
                    }
                ],
            },
        ],
        "activeTarget": {"type": "combo", "id": "combo_default"},
        "activeSessionId": "ses_resp_1",
        "sessions": [
            {
                "id": "ses_resp_1",
                "title": "تست واکنش‌گرایی و جدول مارک‌داون",
                "folder": "پروژه‌ها",
                "createdAt": now - 2 * hour,
                "updatedAt": now - 10 * 60 * 1000,
                "messages": [
                    {
                        "role": "user",
                        "content": "یک مثال کد، جدول مقایسه مدل‌ها و لینک مستندات بده.",
                        "ts": now - 20 * 60 * 1000,
                    },
                    {
                        "role": "assistant",
                        "content": (
                            "در ادامه یک نمونه کد، جدول مقایسه و لینک طولانی برای بررسی نمایش در موبایل آمده است:\n\n"
                            "```javascript\n"
                            "export async function routeChatCompletion({ providerBaseUrl, modelName, payload, abortSignal }) {\n"
                            "  const endpoint = `${providerBaseUrl}/chat/completions?trace=responsive_verification_long_identifier_1234567890`;\n"
                            "  return fetch(endpoint, { method: 'POST', body: JSON.stringify({ model: modelName, ...payload }), signal: abortSignal });\n"
                            "}\n"
                            "```\n\n"
                            "| مدل | ارائه‌دهنده | هزینه ورودی (1M) | هزینه خروجی (1M) | وضعیت |\n"
                            "| --- | --- | --- | --- | --- |\n"
                            "| google/gemini-2.5-flash | OpenRouter | $0.15 | $0.60 | فعال |\n"
                            "| gpt-4o-mini | OpenAI | $0.15 | $0.60 | فعال |\n"
                            "| deepseek/deepseek-r1 | OpenRouter | $0.55 | $2.19 | آماده |\n\n"
                            "مستندات مرجع: https://example.com/docs/v4/responsive/overflow-check/very-long-unbroken-url-segment-abcdefghijklmnopqrstuvwxyz0123456789?mode=mobile&viewport=360x800"
                        ),
                        "ts": now - 19 * 60 * 1000,
                        "meta": {"provider": "OpenRouter", "model": "google/gemini-2.5-flash"},
                    },
                ],
            }
        ],
        "usageEvents": [
            {
                "id": "ev_1",
                "ts": now - 48 * hour,
                "providerId": "prov_openrouter",
                "model": "google/gemini-2.5-flash",
                "promptTokens": 1200,
                "completionTokens": 450,
                "totalTokens": 1650,
                "costUsd": 0.00045,
                "source": "chat",
            },
            {
                "id": "ev_2",
                "ts": now - 24 * hour,
                "providerId": "prov_openai",
                "model": "gpt-4o-mini",
                "promptTokens": 2400,
                "completionTokens": 900,
                "totalTokens": 3300,
                "costUsd": 0.0009,
                "source": "arena",
            },
            {
                "id": "ev_3",
                "ts": now - 6 * hour,
                "providerId": "prov_gemini",
                "model": "gemini-2.5-flash",
                "promptTokens": 1800,
                "completionTokens": 700,
                "totalTokens": 2500,
                "costUsd": 0.00069,
                "source": "team",
            },
            {
                "id": "ev_4",
                "ts": now - 2 * hour,
                "providerId": "prov_openrouter",
                "model": "deepseek/deepseek-r1",
                "promptTokens": 1500,
                "completionTokens": 1100,
                "totalTokens": 2600,
                "costUsd": 0.00323,
                "source": "chat",
            },
        ],
    }


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass


def start_static_server(directory: Path):
    handler = functools.partial(QuietHandler, directory=str(directory))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, port


def ensure_sidebar_open(page):
    menu_btn = page.locator("#btn-menu")
    if menu_btn.is_visible():
        sidebar_open = page.evaluate(
            "() => document.getElementById('sidebar')?.classList.contains('open') || false"
        )
        if not sidebar_open:
            menu_btn.click()
            page.wait_for_timeout(150)


def close_modals_and_popovers(page):
    page.evaluate(
        """() => {
        document.querySelectorAll('.modal-bg.open').forEach(m => m.classList.remove('open'));
        document.querySelectorAll('.popover-panel.open').forEach(p => p.classList.remove('open'));
        const sb = document.getElementById('sidebar');
        const bd = document.getElementById('backdrop');
        if (sb) sb.classList.remove('open');
        if (bd) bd.classList.remove('open');
    }"""
    )
    page.wait_for_timeout(100)


def switch_tab(page, tab_name: str):
    close_modals_and_popovers(page)
    page.locator(f'.nav-item[data-tab="{tab_name}"]').evaluate("el => el.click()")
    page.wait_for_timeout(250)


def open_state(page, state: str):
    if state in ("chat", "providers", "combos", "team", "arena", "analytics"):
        switch_tab(page, state)
    elif state == "settings-modal":
        switch_tab(page, "chat")
        page.locator("#btn-settings").evaluate("el => el.click()")
        page.wait_for_timeout(250)
    elif state == "prompts-modal":
        switch_tab(page, "chat")
        page.locator("#btn-prompt-lib").evaluate("el => el.click()")
        page.wait_for_timeout(250)
    elif state == "model-popover":
        switch_tab(page, "chat")
        page.locator("#btn-quick-model").evaluate("el => el.click()")
        page.wait_for_timeout(250)
    else:
        raise ValueError(f"Unknown state: {state}")


def measure_overflow(page):
    return page.evaluate(
        """() => {
        const innerWidth = window.innerWidth;
        const scrollWidth = document.documentElement.scrollWidth;
        const bodyScrollWidth = document.body.scrollWidth;
        const docPassed = scrollWidth <= innerWidth + 1;
        const offenders = [];
        const selectors = [
            '.topbar',
            '.composer',
            '.popover-panel.open',
            '.modal-bg.open .modal',
            '.page-scroll',
            '.chat-scroll',
            '.analytics-tables-grid',
        ];
        for (const el of document.querySelectorAll(selectors.join(','))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') continue;
            const outRight = r.right > innerWidth + 1;
            const outLeft = r.left < -1;
            const innerOverflow = (el.classList.contains('page-scroll') || el.classList.contains('chat-scroll') || el.classList.contains('topbar') || el.classList.contains('composer')) && (el.scrollWidth > el.clientWidth + 1);
            if (outRight || outLeft || innerOverflow) {
                offenders.push({
                    el: el.id ? '#' + el.id : '.' + String(el.className).trim().split(/\\s+/)[0],
                    left: Math.round(r.left),
                    right: Math.round(r.right),
                    scrollWidth: el.scrollWidth,
                    clientWidth: el.clientWidth,
                });
            }
        }
        const passed = docPassed && offenders.length === 0;
        const maxSw = Math.max(scrollWidth, ...offenders.map(o => Math.max(o.right, o.scrollWidth)));
        return {
            innerWidth,
            scrollWidth,
            effectiveScrollWidth: maxSw,
            bodyScrollWidth,
            overflowPx: Math.max(0, maxSw - innerWidth),
            offenders,
            docPassed,
            passed,
        };
    }"""
    )


def run_check(mode: str, save_screenshots: bool):
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    httpd, port = start_static_server(ROOT)
    url = f"http://127.0.0.1:{port}/index.html"
    seed_json = json.dumps(build_seed_state(), ensure_ascii=False)
    results = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            for vp_name, width, height, label in VIEWPORTS:
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    device_scale_factor=1,
                    service_workers="block",
                )
                context.add_init_script(
                    f"window.localStorage.setItem('ninerouter_web_v1', {json.dumps(seed_json)});"
                )
                page = context.new_page()
                page.goto(url, wait_until="domcontentloaded")
                page.wait_for_selector(".nav-item[data-tab='chat']")
                page.wait_for_timeout(300)

                for state in STATES:
                    open_state(page, state)
                    metrics = measure_overflow(page)
                    shot_name = f"{vp_name}-{state}.png"
                    if save_screenshots:
                        page.screenshot(path=str(OUT_DIR / shot_name), full_page=False)
                    results.append(
                        {
                            "viewport": vp_name,
                            "label": label,
                            "state": state,
                            "innerWidth": metrics["innerWidth"],
                            "scrollWidth": metrics["scrollWidth"],
                            "effectiveScrollWidth": metrics["effectiveScrollWidth"],
                            "overflowPx": metrics["overflowPx"],
                            "offenders": metrics["offenders"],
                            "docPassed": metrics["docPassed"],
                            "passed": metrics["passed"],
                            "screenshot": shot_name,
                        }
                    )
                context.close()
            browser.close()
    finally:
        httpd.shutdown()

    out_json = OUT_DIR / f"{mode}.json"
    out_json.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")

    failures = [r for r in results if not r["passed"]]
    print(f"=== Responsive Check ({mode}) ===")
    print(f"Total checks: {len(results)} | Passed: {len(results) - len(failures)} | Failed: {len(failures)}")
    if failures:
        print("\nFailing viewport+state pairs:")
        for f in failures:
            off_str = ", ".join(
                f"{o['el']}(L={o['left']},R={o['right']},sw={o['scrollWidth']}/{o['clientWidth']})"
                for o in f.get("offenders", [])
            )
            print(
                f"  - {f['viewport']} | {f['state']}: docScrollWidth={f['scrollWidth']}/{f['innerWidth']}, eff={f['effectiveScrollWidth']} (+{f['overflowPx']}px) {off_str}"
            )
    else:
        print("All viewport+state checks PASSED!")

    if mode == "final":
        write_report(results)

    return 0 if not failures or mode == "baseline" else 1


def write_report(final_results):
    baseline_path = OUT_DIR / "baseline.json"
    baseline_map = {}
    if baseline_path.exists():
        for r in json.loads(baseline_path.read_text(encoding="utf-8")):
            baseline_map[(r["viewport"], r["state"])] = r

    lines = [
        "# 9Router Web — V4 Responsive Verification Report",
        "",
        "Automated Playwright headless Chromium check across 7 viewports × 9 states (63 checks).",
        "Assertion: `document.documentElement.scrollWidth <= window.innerWidth + 1`.",
        "",
        "## Summary",
        "",
    ]
    base_fail = [r for r in baseline_map.values() if not r["passed"]]
    final_fail = [r for r in final_results if not r["passed"]]
    lines.append(f"- **Baseline (before fixes):** {len(baseline_map) - len(base_fail)}/{len(baseline_map)} passed, **{len(base_fail)} failed**")
    lines.append(f"- **Final (after fixes):** {len(final_results) - len(final_fail)}/{len(final_results)} passed, **{len(final_fail)} failed**")
    lines.append("")
    lines.append("## Matrix (Baseline → Final)")
    lines.append("")
    lines.append("| Viewport | State | Baseline (`scrollWidth/innerWidth`) | Final (`scrollWidth/innerWidth`) | Status |")
    lines.append("| --- | --- | --- | --- | --- |")
    for r in final_results:
        b = baseline_map.get((r["viewport"], r["state"]))
        b_str = f"{b['scrollWidth']}/{b['innerWidth']} ({'PASS' if b['passed'] else 'FAIL'})" if b else "—"
        f_str = f"{r['scrollWidth']}/{r['innerWidth']}"
        status = "PASS" if r["passed"] else "FAIL"
        lines.append(f"| `{r['viewport']}` | `{r['state']}` | {b_str} | {f_str} | **{status}** |")

    (OUT_DIR / "REPORT.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["baseline", "final"], default="baseline")
    parser.add_argument("--no-screenshots", action="store_true")
    args = parser.parse_args()
    sys.exit(run_check(args.mode, save_screenshots=not args.no_screenshots))


if __name__ == "__main__":
    main()
