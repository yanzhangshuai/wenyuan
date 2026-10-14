import Link from "next/link";
import { Suspense, use } from "react";


import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { EmptyBooks, SkeletonCard } from "@/components/ui/states";
import { listBooks, type BookListItem } from "@/server/modules/books/list-books";

/**
 * 书库首页。
 *
 * RSC 边界：本页保持 Server Component，通过 `use()` + Suspense 消费作品列表；
 * 列表项只是链接与文本，不需要任何客户端状态，因此不引入 `"use client"`。
 */

/** 作品状态的中文标签。 */
const STATUS_LABELS: Readonly<Record<BookListItem["status"], string>> = {
  pending: "待解析",
  parsing: "解析中",
  ready  : "已就绪",
  failed : "解析失败"
};

export default function LibraryPage() {
  const booksPromise = listBooks();

  return (
    <PageContainer>
      <PageHeader
        title="书库"
        description="导入一部小说，自动解析人物与关系，生成可交互的人物关系图谱。"
      />
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
 * @returns 作品卡片列表；无数据时展示空态
 */
function BookList({ booksPromise }: BookListProps) {
  const items = use(booksPromise);

  if (items.length === 0) {
    return <EmptyBooks />;
  }

  return (
    <ul className="book-list">
      {items.map((book) => (
        <li key={book.id} className="book-list-item">
          <Link href={`/book/${book.id}`} className="book-list-link">
            <h2 className="book-list-title">{book.title}</h2>
            <p className="book-list-meta">
              {book.author ?? "佚名"} · {book.chapterCount} 章
            </p>
            <p className="book-list-stats">
              <span>{book.entityCount} 个实体</span>
              <span>{book.relationCount} 条关系</span>
              <span data-status={book.status}>{STATUS_LABELS[book.status]}</span>
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** 列表骨架屏。 */
function LibrarySkeleton() {
  return (
    <div className="book-list">
      {Array.from({ length: 3 }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}
