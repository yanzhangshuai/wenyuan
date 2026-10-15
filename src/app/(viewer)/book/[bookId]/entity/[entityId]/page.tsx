import { notFound } from "next/navigation";
import { Suspense, use } from "react";

import { EntityProfileView } from "@/components/graph/EntityProfileView";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { GraphSkeleton } from "@/components/ui/states";
import { loadEntityProfileWithRelations } from "@/server/modules/graph/read-profile";

/**
 * 人物档案页（RSC）。
 *
 * 与图谱页同构：本文件是 Server Component，创建取数 Promise；
 * `ProfileSection` 在服务端用 `use()` 解包并交给 Suspense，
 * 只有需要交互的组件才带 `"use client"`。
 *
 * ## 本页回答什么
 *
 * 图谱回答「和谁有关系」，档案回答「**做过什么**」—— 后者是 `entity_mentions`
 * 按回次重排的结果，**零模型调用**（见 `docs/人物百科-数据来源与实现方案.md` §三 第 1 层）。
 *
 * ## 首版范围（第一期）
 *
 * 含：事迹时间线（第 1 层）+ 关系时间轴（第 2 层）。
 * **不含**：LLM 小传（付费）、原文渲染页、防剧透 —— 均为架构文档明写首版不做或需单独授权。
 */

interface EntityProfilePageProps {
  params: Promise<{ bookId: string; entityId: string }>;
}

export default async function EntityProfilePage({ params }: EntityProfilePageProps) {
  const { bookId, entityId } = await params;

  const dataPromise = loadEntityProfileWithRelations(entityId);

  return (
    <PageContainer>
      <PageHeader
        title="人物档案"
        description="按回次整理该人物的原文落点与关系时间轴。全部内容取自本书已解析数据，不含推测性小传。"
        breadcrumbs={[
          { label: "书库", href: "/" },
          { label: "关系图谱", href: `/book/${bookId}` },
          { label: "人物档案" }
        ]}
      />
      <Suspense fallback={<GraphSkeleton />}>
        <ProfileSection dataPromise={dataPromise} bookId={bookId} />
      </Suspense>
    </PageContainer>
  );
}

interface ProfileSectionProps {
  dataPromise: ReturnType<typeof loadEntityProfileWithRelations>;
  bookId     : string;
}

/**
 * 档案数据分区（服务端）。
 *
 * @param props 由页面创建的取数 Promise 与作品 ID
 * @returns 档案视图；实体不存在时抛 `notFound()`
 */
function ProfileSection({ dataPromise, bookId }: ProfileSectionProps) {
  const data = use(dataPromise);

  if (data === null) {
    notFound();
  }

  return (
    <EntityProfileView
      profile={data.profile}
      relations={data.relations}
      bookId={bookId}
    />
  );
}
