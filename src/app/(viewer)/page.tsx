import Link from "next/link";
import { Suspense, use } from "react";


import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { EmptyBooks, SkeletonCard } from "@/components/ui/states";
import { listWorks, type WorkListItem } from "@/server/modules/works/list-works";

/**
 * 书库首页。
 *
 * RSC 边界：本页保持 Server Component，通过 `use()` + Suspense 消费作品列表；
 * 列表项只是链接与文本，不需要任何客户端状态，因此不引入 `"use client"`。
 */

/** 作品状态的中文标签。 */
const STATUS_LABELS: Readonly<Record<WorkListItem["status"], string>> = {
  pending: "待解析",
  parsing: "解析中",
  ready  : "已就绪",
  failed : "解析失败"
};

export default function LibraryPage() {
  const worksPromise = listWorks();

  return (
    <PageContainer>
      <PageHeader
        title="书库"
        description="导入一部小说，自动解析人物与关系，生成可交互的人物关系图谱。"
      />
      <Suspense fallback={<LibrarySkeleton />}>
        <WorkList worksPromise={worksPromise} />
      </Suspense>
    </PageContainer>
  );
}

interface WorkListProps {
  worksPromise: ReturnType<typeof listWorks>;
}

/**
 * 作品列表（服务端）。
 *
 * @param props 由页面创建的取数 Promise
 * @returns 作品卡片列表；无数据时展示空态
 */
function WorkList({ worksPromise }: WorkListProps) {
  const items = use(worksPromise);

  if (items.length === 0) {
    return <EmptyBooks />;
  }

  return (
    <ul className="work-list">
      {items.map((work) => (
        <li key={work.id} className="work-list-item">
          <Link href={`/works/${work.id}`} className="work-list-link">
            <h2 className="work-list-title">{work.title}</h2>
            <p className="work-list-meta">
              {work.author ?? "佚名"} · {work.chapterCount} 章
            </p>
            <p className="work-list-stats">
              <span>{work.entityCount} 个实体</span>
              <span>{work.relationCount} 条关系</span>
              <span data-status={work.status}>{STATUS_LABELS[work.status]}</span>
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
    <div className="work-list">
      {Array.from({ length: 3 }, (_, index) => (
        <SkeletonCard key={index} />
      ))}
    </div>
  );
}
