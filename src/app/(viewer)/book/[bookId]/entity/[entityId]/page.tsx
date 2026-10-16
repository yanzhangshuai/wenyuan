import { notFound } from "next/navigation";
import { Suspense, use } from "react";

import { EntityProfileView } from "@/components/graph/EntityProfileView";
import { ExternalKnowledgeSection } from "@/components/graph/ExternalKnowledgeSection";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { GraphSkeleton } from "@/components/ui/states";
import { loadExternalKnowledgeForBook } from "@/server/modules/graph/read-knowledge";
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
 * 含：事迹时间线（第 1 层）+ 关系时间轴（第 2 层）+ **外部资料分区**（三期判定层，
 * 独立表读时叠加，带来源 URL，与「本书信息」视觉分开）。
 * **不含**：LLM 小传（付费）、原文渲染页、防剧透 —— 均为架构文档明写首版不做或需单独授权。
 */

interface EntityProfilePageProps {
  params: Promise<{ bookId: string; entityId: string }>;
}

export default async function EntityProfilePage({ params }: EntityProfilePageProps) {
  const { bookId, entityId } = await params;

  const dataPromise = loadEntityProfileWithRelations(entityId);
  // 外部资料（三期）：独立表读时叠加，**不合并进图谱数据**（UI 分区）。
  const knowledgePromise = loadExternalKnowledgeForBook(bookId);

  return (
    <PageContainer>
      <PageHeader
        title="人物档案"
        description="按回次整理该人物的原文落点与关系时间轴；外部资料为独立分区，带来源可复核。"
        breadcrumbs={[
          { label: "书库", href: "/" },
          { label: "关系图谱", href: `/book/${bookId}` },
          { label: "人物档案" }
        ]}
      />
      <Suspense fallback={<GraphSkeleton />}>
        <ProfileSection dataPromise={dataPromise} knowledgePromise={knowledgePromise} bookId={bookId} />
      </Suspense>
    </PageContainer>
  );
}

interface ProfileSectionProps {
  dataPromise     : ReturnType<typeof loadEntityProfileWithRelations>;
  knowledgePromise: ReturnType<typeof loadExternalKnowledgeForBook>;
  bookId          : string;
}

/**
 * 档案数据分区（服务端）。
 *
 * @param props 由页面创建的取数 Promise 与作品 ID
 * @returns 档案视图；实体不存在时抛 `notFound()`
 */
function ProfileSection({ dataPromise, knowledgePromise, bookId }: ProfileSectionProps) {
  const data = use(dataPromise);
  const knowledgeBySubject = use(knowledgePromise);

  if (data === null) {
    notFound();
  }

  // 外部资料按**规范名**索引（判定层的 subjectKey 就是规范名）。
  const externalItems = knowledgeBySubject[data.profile.name] ?? [];

  return (
    <>
      {/* 外部资料分区（三期）：带来源、可复核；与下方「本书信息」视觉分开。
          showWhenEmpty：即使暂无资料也展示分区与补跑提示 —— 用户至少知道「为什么没有简介」。 */}
      <ExternalKnowledgeSection items={externalItems} showWhenEmpty />
      <EntityProfileView
        profile={data.profile}
        relations={data.relations}
        bookId={bookId}
      />
    </>
  );
}
