export interface Entity {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface CursorPaginationOptions<T> {
  filter?: (item: T) => boolean;
  sort?: (a: T, b: T) => number;
  limit?: number;
  order?: 'asc' | 'desc';
  before?: string;
  after?: string;
}

export interface CursorPaginatedResult<T> {
  data: T[];
  list_metadata: {
    before: string | null;
    after: string | null;
  };
}

export function cursorPaginate<T extends Entity>(
  items: T[],
  options: CursorPaginationOptions<T> = {},
): CursorPaginatedResult<T> {
  let filtered = options.filter ? items.filter(options.filter) : [...items];

  const order = options.order ?? 'desc';
  const defaultSort = (a: T, b: T) =>
    order === 'desc'
      ? b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)
      : a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

  filtered.sort(options.sort ?? defaultSort);

  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));

  let startIndex = 0;
  let endIndex = filtered.length;

  if (options.after) {
    const afterIndex = filtered.findIndex((item) => item.id === options.after);
    if (afterIndex !== -1) {
      startIndex = afterIndex + 1;
    }
  }

  if (options.before) {
    const beforeIndex = filtered.findIndex((item) => item.id === options.before);
    if (beforeIndex !== -1) {
      endIndex = beforeIndex;
    }
  }

  const window = filtered.slice(startIndex, endIndex);
  const page = window.slice(0, limit);

  const hasMore = window.length > limit;
  const hasPrev = startIndex > 0;

  return {
    data: page,
    list_metadata: {
      before: page.length > 0 && hasPrev ? page[0].id : null,
      after: page.length > 0 && hasMore ? page[page.length - 1].id : null,
    },
  };
}
