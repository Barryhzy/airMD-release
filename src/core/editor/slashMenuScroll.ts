/**
 * 斜杠菜单的滚动跟随。
 *
 * Crepe 的 BlockEdit 在每次方向键之后都会执行
 * `scrollRoot.scrollTop = target.offsetTop - scrollRoot.offsetTop`，
 * 也就是把选中项直接钉在滚动容器的顶部。结果是：高亮行始终停在第一行的位置，
 * 内容在它下面滑动，看起来像「选区没动」。
 *
 * 这里改成「中线跟随」：选中项在容器中线附近时列表不动，让高亮自己往下走；
 * 一旦越过中线，列表才跟着滚动，把选中项拉回中线。
 */

export interface FollowScrollInput {
  /** 选中项上边界相对滚动容器可视区顶部的距离 */
  itemTop: number;
  itemHeight: number;
  /** 滚动容器可视高度（clientHeight） */
  viewportHeight: number;
  scrollTop: number;
  scrollHeight: number;
}

/**
 * 计算跟随滚动后的 scrollTop。纯函数，方便单测。
 *
 * 返回当前值表示「不需要动」；返回值被 clamp 在 [0, scrollHeight - viewportHeight]。
 */
export function computeFollowScrollTop(input: FollowScrollInput): number {
  const { itemTop, itemHeight, viewportHeight, scrollTop, scrollHeight } = input;

  if (itemHeight <= 0 || viewportHeight <= 0) return scrollTop;

  const itemCenter = itemTop + itemHeight / 2;
  const delta = itemCenter - viewportHeight / 2;

  // 中线附近留半行容差：避免亚像素抖动导致每按一次方向键都微调
  if (Math.abs(delta) <= itemHeight / 2) return scrollTop;

  const max = Math.max(0, scrollHeight - viewportHeight);
  return Math.min(Math.max(scrollTop + delta, 0), max);
}

const MENU_SELECTOR = '.milkdown-slash-menu';
const SCROLLER_SELECTOR = '.menu-groups';
const HOVERED_SELECTOR = '.menu-group li.hover';

/**
 * 接管斜杠菜单的滚动：选中项越过中线后才让列表跟随。
 *
 * 返回销毁函数。Crepe 的滚动发生在 Vue 更新 DOM 之前，
 * 因此这里用 MutationObserver 在 DOM 落地后（同一帧、绘制前）纠正一次。
 */
export function installSlashMenuScroll(root: HTMLElement): () => void {
  let disposed = false;

  const align = (): void => {
    if (disposed) return;

    const menu = root.querySelector<HTMLElement>(MENU_SELECTOR);
    if (!menu || menu.dataset.show !== 'true') return;

    const scroller = menu.querySelector<HTMLElement>(SCROLLER_SELECTOR);
    const hovered = menu.querySelector<HTMLElement>(HOVERED_SELECTOR);
    if (!scroller || !hovered) return;

    const itemRect = hovered.getBoundingClientRect();
    const scrollRect = scroller.getBoundingClientRect();
    if (itemRect.height === 0 || scrollRect.height === 0) return;

    const next = computeFollowScrollTop({
      itemTop: itemRect.top - scrollRect.top,
      itemHeight: itemRect.height,
      viewportHeight: scroller.clientHeight,
      scrollTop: scroller.scrollTop,
      scrollHeight: scroller.scrollHeight,
    });

    if (Math.abs(next - scroller.scrollTop) >= 1) scroller.scrollTop = next;

    // 供 CSS 决定哪一侧需要渐隐遮罩，避免滚动后顶端/底部露出半行字
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const edge =
      max <= 1 ? 'none' : scroller.scrollTop <= 1 ? 'start' : scroller.scrollTop >= max - 1 ? 'end' : 'middle';
    if (edge !== scroller.dataset.scroll) scroller.dataset.scroll = edge;
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target as Element | null;
      if (target && typeof target.closest === 'function' && target.closest(MENU_SELECTOR)) {
        align();
        return;
      }
    }
  });

  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'data-show'],
  });

  return () => {
    disposed = true;
    observer.disconnect();
  };
}
