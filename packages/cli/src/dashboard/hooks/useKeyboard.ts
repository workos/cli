import { useInput } from 'ink';

interface UseScrollOptions {
  totalItems: number;
  visibleItems: number;
  scrollOffset: number;
  setScrollOffset: (offset: number) => void;
}

export function useScrollNavigation({
  totalItems,
  visibleItems,
  scrollOffset,
  setScrollOffset,
}: UseScrollOptions): void {
  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset(Math.max(0, scrollOffset - 1));
    } else if (key.downArrow) {
      setScrollOffset(Math.min(totalItems - visibleItems, scrollOffset + 1));
    } else if (key.pageUp) {
      setScrollOffset(Math.max(0, scrollOffset - visibleItems));
    } else if (key.pageDown) {
      setScrollOffset(Math.min(totalItems - visibleItems, scrollOffset + visibleItems));
    }
  });
}
