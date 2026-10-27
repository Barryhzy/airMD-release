/**
 * E2E 公共定位器。
 *
 * 多标签之后，后台标签的编辑器仍留在 DOM 里（为了保住撤销历史、折叠状态、滚动位置），
 * 所以 `.ProseMirror`、`[data-testid="editor-scroll"]` 这类选择器会同时命中多个元素，
 * Playwright 的 strict mode 会直接报 "resolved to 2 elements"。
 *
 * 约定：所有「正文相关」的定位一律走下面三个助手，限定在当前可见的 tabpanel 内。
 * 见 docs/TABS.md「原 E2E 的适配」。
 */

import type { Page } from '@playwright/test';

/** 当前活动的文档面板（后台标签带 hidden / inert） */
export const activePane = (page: Page) => page.locator('[role="tabpanel"]:not([hidden])');

/** 当前活动标签里的正文编辑器 */
export const activeProse = (page: Page) => activePane(page).locator('.ProseMirror');

/** 当前活动标签里的某个 data-testid（编辑区内部的控件都是每标签一份） */
export const paneTestId = (page: Page, id: string) => activePane(page).getByTestId(id);
