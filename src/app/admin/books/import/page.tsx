import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { ImportForm } from "./import-form";

/**
 * 导入页（服务端壳）。
 *
 * 只负责标题与返回入口；表单逻辑在客户端组件里（文件选择与提交都需要浏览器 API）。
 */
export const metadata: Metadata = { title: "导入书籍" };

export default function AdminImportPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <Button asChild variant="ghost" size="sm" className="mb-4 gap-2">
        <Link href="/admin/books">
          <ArrowLeft className="h-4 w-4" />
          返回书籍列表
        </Link>
      </Button>

      <div className="mb-6">
        <h1 className="font-serif text-2xl font-semibold">导入书籍</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          上传小说全文，系统会清洗编码、切分章节并写入段落坐标；解析随后在终端执行。
        </p>
      </div>

      <ImportForm />
    </div>
  );
}
