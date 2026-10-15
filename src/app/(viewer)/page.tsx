import { Suspense, use } from "react";

import { PageContainer } from "@/components/layout/page-header";
import type { BookCardData } from "@/components/library/book-card";
import { LibraryHome } from "@/components/library/library-home";
import { SkeletonCard } from "@/components/ui/states";
import { listBooks, type BookListItem } from "@/server/modules/books/list-books";

/**
 * 书库首页。
 *
 * RSC 边界：本页保持 Server Component，通过 `use()` + Suspense 消费作品列表；
 * 列表数据在服务端取好后注入 `LibraryHome`（Client Component，负责悬浮等交互）。
 *
 * 版式：与 v1 `wen-yuan` 首页 1:1（Hero 统计 + 书卡网格 + 页脚）。
 */

/**
 * 把服务端 DTO 映射为书卡展示数据。
 *
 * 显式字段映射而非 `...book`：锁定前后端契约，避免后端新增字段无意透传到前端。
 */
function toBookCardData(book: BookListItem): BookCardData {
  return {
    id           : book.id,
    title        : book.title,
    author       : book.author,
    status       : book.status,
    chapterCount : book.chapterCount,
    entityCount  : book.entityCount,
    relationCount: book.relationCount
  };
}

export default function LibraryPage() {
  const booksPromise = listBooks();

  return (
    <PageContainer fullWidth>
      <Suspense fallback={<LibrarySkeleton />}>
        <BookList booksPromise={booksPromise} />
      </Suspense>
    </PageContainer>
  );
}

interface BookListProps {
  booksPromise: ReturnType<typeof listBooks>;
}

/**
 * 作品列表（服务端）。
 *
 * @param props 由页面创建的取数 Promise
 * @returns 书库首页；无数据时由 `LibraryHome` 内部渲染空态
 */
function BookList({ booksPromise }: BookListProps) {
  const items = use(booksPromise);
  return <LibraryHome books={items.map(toBookCardData)} />;
}

/** 列表骨架屏。 */
function LibrarySkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8">
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 md:gap-6 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
        {Array.from({ length: 6 }, (_, index) => (
          <SkeletonCard key={index} />
        ))}
      </div>
    </div>
  );
}
