"use client";

import { ArrowRight, Loader2, Lock, Mail, User } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type SyntheticEvent } from "react";

import { ThemeToggle } from "@/components/theme";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sanitizeRedirectPath } from "@/lib/auth";
import { AuthRequestError, login, register } from "@/lib/services/auth";

/**
 * 登录 / 注册视图（1:1 还原 v1 `app/login/page.tsx`）。
 *
 * 与 v1 的四处必要偏离（其余像素级一致）：
 * 1. 左栏统计改为**服务端传入的真实数据**（v1 是硬编码 47 / 8640 / 43200）；
 * 2. 注册 Tab **接真实接口**（v1 只是 UI 占位）；
 * 3. GitHub 按钮保留外观但 `disabled`（v1 同样未实现，点击无反应）；
 * 4. 「忘记密码」不复制 v1 的 `/forgot-password` 死链，改为提示联系管理员。
 */

/**
 * GitHub 图标（内联 SVG）。
 *
 * 为什么不用 lucide 的 `Github`：该品牌图标已被标记弃用（v1 里用了，但 v3 的
 * lint 规则禁止 deprecated API）。内联 path 既保持 1:1 视觉，又不引入依赖。
 */
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.55v-2.1c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .96-.31 3.15 1.18a10.9 10.9 0 0 1 5.74 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .3.21.66.8.55A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

/** 统计数字格式（千分位，与服务端数据同源）。 */
const countFormatter = new Intl.NumberFormat("en-US");

/** 左栏统计。 */
export interface LoginStats {
  books        : number;
  entities     : number;
  relationships: number;
}

export function LoginSkeleton() {
  return (
    <main className="login-page flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="bg-muted/20 h-96 w-full max-w-md animate-pulse rounded-lg" />
    </main>
  );
}

/** 带 Suspense 的入口（`useSearchParams` 需要异步边界）。 */
export function LoginView({ stats }: { stats: LoginStats }) {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm stats={stats} />
    </Suspense>
  );
}

function LoginForm({ stats }: { stats: LoginStats }) {
  const searchParams = useSearchParams();
  const redirect = sanitizeRedirectPath(searchParams.get("redirect"));

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const [regName, setRegName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState("");

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    try {
      const next = await login({ identifier, password, redirect });
      // replace：登录页不应留在历史记录里，避免后退回到登录页。
      window.location.replace(sanitizeRedirectPath(next.redirect));
    } catch (error) {
      setErrorMessage(error instanceof AuthRequestError ? error.message : "登录失败，请稍后再试");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRegister(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRegistering(true);
    setRegisterError("");

    try {
      const next = await register({
        email   : regEmail,
        username: regName.length > 0 ? regName : regEmail.split("@")[0] ?? "",
        name    : regName,
        password: regPassword
      });
      window.location.replace(sanitizeRedirectPath(next.redirect));
    } catch (error) {
      setRegisterError(error instanceof AuthRequestError ? error.message : "注册失败，请稍后再试");
    } finally {
      setIsRegistering(false);
    }
  }

  return (
    <div className="login-layout flex min-h-dvh">
      <div className="login-left bg-primary/5 relative hidden overflow-hidden lg:flex lg:w-1/2">
        <div className="from-primary/10 to-accent/10 absolute inset-0 bg-gradient-to-br via-transparent" />

        <div className="absolute inset-0 opacity-[0.03]">
          <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </pattern>
            <rect width="100" height="100" fill="url(#grid)" />
          </svg>
        </div>

        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-20">
          <div className="mb-8">
            <Link href="/" className="group flex items-center gap-3">
              <div className="bg-primary/10 group-hover:bg-primary/20 flex h-12 w-12 items-center justify-center rounded-xl transition-colors">
                <span className="text-primary font-serif text-3xl font-bold">淵</span>
              </div>
              <span className="text-foreground font-serif text-3xl font-bold">文淵</span>
            </Link>
          </div>

          <h1 className="text-foreground mb-6 font-serif text-4xl leading-tight font-bold xl:text-5xl">
            探索古典文学的
            <br />
            <span className="text-primary">人物关系网络</span>
          </h1>

          <p className="text-muted-foreground max-w-md text-lg leading-relaxed">
            基于AI技术，自动解析古典文献中的人物关系，构建可视化知识图谱，让千年典籍焕发新生。
          </p>

          <div className="mt-12 space-y-4">
            <div className="flex items-center gap-4">
              <div className="bg-background/80 flex h-10 w-10 items-center justify-center rounded-lg">
                <span className="text-primary text-lg font-semibold">
                  {countFormatter.format(stats.books)}
                </span>
              </div>
              <span className="text-muted-foreground">部经典典籍</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="bg-background/80 flex h-10 w-10 items-center justify-center rounded-lg">
                <span className="text-primary text-lg font-semibold">
                  {countFormatter.format(stats.entities)}
                </span>
              </div>
              <span className="text-muted-foreground">历史人物</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="bg-background/80 flex h-10 w-10 items-center justify-center rounded-lg">
                <span className="text-primary text-lg font-semibold">
                  {countFormatter.format(stats.relationships)}
                </span>
              </div>
              <span className="text-muted-foreground">人物关系</span>
            </div>
          </div>
        </div>

        <div className="bg-primary/5 absolute right-20 bottom-20 h-32 w-32 rounded-full blur-3xl" />
        <div className="bg-accent/5 absolute top-40 right-40 h-24 w-24 rounded-full blur-2xl" />
      </div>

      <div className="login-right flex flex-1 flex-col">
        <div className="flex items-center justify-between p-6">
          <Link href="/" className="flex items-center gap-2 lg:hidden">
            <span className="text-primary font-serif text-2xl font-bold">淵</span>
            <span className="font-serif text-xl font-bold">文淵</span>
          </Link>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center p-6">
          <div className="w-full max-w-md">
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="mb-8 grid w-full grid-cols-2">
                <TabsTrigger value="login">登录</TabsTrigger>
                <TabsTrigger value="register">注册</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <Card className="login-auth-shell border-0 shadow-none sm:border sm:shadow-sm">
                  <CardHeader className="space-y-1 px-0 sm:px-6">
                    <CardTitle className="font-serif text-2xl">欢迎回来</CardTitle>
                    <CardDescription>登录您的账户以继续探索</CardDescription>
                  </CardHeader>
                  <CardContent className="px-0 sm:px-6">
                    {errorMessage ? (
                      <Alert aria-live="polite" variant="destructive" className="mb-4">
                        <AlertTitle>登录失败</AlertTitle>
                        <AlertDescription>{errorMessage}</AlertDescription>
                      </Alert>
                    ) : null}

                    <form
                      className="space-y-4"
                      // 兜底：若脚本尚未接管（hydration 未完成）用户就按了回车，
                      // 浏览器会走原生提交。没有 method 时默认 GET，密码会被拼进 URL
                      // （历史记录、日志、Referer 全部泄漏）。POST 至少把字段放进 body。
                      method="post"
                      onSubmit={(event) => {
                        void handleSubmit(event);
                      }}
                    >
                      <input type="hidden" name="redirect" value={redirect} />

                      <div className="space-y-2">
                        <Label htmlFor="identifier">邮箱</Label>
                        <div className="relative">
                          <Mail className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                          <Input
                            id="identifier"
                            name="identifier"
                            autoComplete="username"
                            placeholder="your@email.com"
                            className="pl-9"
                            value={identifier}
                            onChange={(event) => {
                              setIdentifier(event.target.value);
                            }}
                            disabled={isSubmitting}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label htmlFor="password">密码</Label>
                          <span
                            className="text-muted-foreground cursor-help text-sm"
                            title="请联系管理员重置密码"
                          >
                            忘记密码？
                          </span>
                        </div>
                        <div className="relative">
                          <Lock className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                          <Input
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            placeholder="••••••••"
                            className="pl-9"
                            value={password}
                            onChange={(event) => {
                              setPassword(event.target.value);
                            }}
                            disabled={isSubmitting}
                            required
                          />
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox id="remember" />
                        <Label htmlFor="remember" className="text-sm font-normal">
                          记住我
                        </Label>
                      </div>

                      <Button
                        className="w-full"
                        type="submit"
                        disabled={isSubmitting}
                        aria-busy={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            登录中...
                          </>
                        ) : (
                          <>
                            登录
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </form>
                  </CardContent>
                  <CardFooter className="flex flex-col gap-4 px-0 sm:px-6">
                    <div className="relative w-full">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="login-divider-pill bg-background text-muted-foreground px-2">
                          或者
                        </span>
                      </div>
                    </div>
                    <Button variant="outline" className="w-full" disabled title="暂未开放">
                      <GithubIcon className="mr-2 h-4 w-4" />
                      使用 GitHub 登录
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>

              <TabsContent value="register">
                <Card className="login-auth-shell border-0 shadow-none sm:border sm:shadow-sm">
                  <CardHeader className="space-y-1 px-0 sm:px-6">
                    <CardTitle className="font-serif text-2xl">创建账户</CardTitle>
                    <CardDescription>注册以开始使用文淵</CardDescription>
                  </CardHeader>
                  <CardContent className="px-0 sm:px-6">
                    {registerError ? (
                      <Alert aria-live="polite" variant="destructive" className="mb-4">
                        <AlertTitle>注册失败</AlertTitle>
                        <AlertDescription>{registerError}</AlertDescription>
                      </Alert>
                    ) : null}

                    <form
                      className="space-y-4"
                      // 同登录表单：防止脚本未接管时的原生 GET 提交把密码写进 URL。
                      method="post"
                      onSubmit={(event) => {
                        void handleRegister(event);
                      }}
                    >
                      <div className="space-y-2">
                        <Label htmlFor="reg-name">用户名</Label>
                        <div className="relative">
                          <User className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                          <Input
                            id="reg-name"
                            type="text"
                            placeholder="您的用户名"
                            className="pl-9"
                            value={regName}
                            onChange={(event) => {
                              setRegName(event.target.value);
                            }}
                            disabled={isRegistering}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="reg-email">邮箱</Label>
                        <div className="relative">
                          <Mail className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                          <Input
                            id="reg-email"
                            type="email"
                            placeholder="your@email.com"
                            className="pl-9"
                            value={regEmail}
                            onChange={(event) => {
                              setRegEmail(event.target.value);
                            }}
                            disabled={isRegistering}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="reg-password">密码</Label>
                        <div className="relative">
                          <Lock className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                          <Input
                            id="reg-password"
                            type="password"
                            placeholder="至少 8 位"
                            className="pl-9"
                            value={regPassword}
                            onChange={(event) => {
                              setRegPassword(event.target.value);
                            }}
                            disabled={isRegistering}
                            required
                          />
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <Checkbox id="terms" />
                        <Label htmlFor="terms" className="text-sm font-normal">
                          我同意{" "}
                          <Link href="/terms" className="interactive-text-link text-primary hover:underline">
                            服务条款
                          </Link>{" "}
                          和{" "}
                          <Link href="/privacy" className="interactive-text-link text-primary hover:underline">
                            隐私政策
                          </Link>
                        </Label>
                      </div>

                      <Button
                        className="w-full"
                        type="submit"
                        disabled={isRegistering}
                        aria-busy={isRegistering}
                      >
                        {isRegistering ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            创建中...
                          </>
                        ) : (
                          <>
                            创建账户
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </>
                        )}
                      </Button>
                    </form>
                  </CardContent>
                  <CardFooter className="flex flex-col gap-4 px-0 sm:px-6">
                    <div className="relative w-full">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="login-divider-pill bg-background text-muted-foreground px-2">
                          或者
                        </span>
                      </div>
                    </div>
                    <Button variant="outline" className="w-full" disabled title="暂未开放">
                      <GithubIcon className="mr-2 h-4 w-4" />
                      使用 GitHub 注册
                    </Button>
                  </CardFooter>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <div className="text-muted-foreground p-6 text-center text-sm">
          <p>
            继续即表示您同意我们的{" "}
            <Link href="/terms" className="interactive-text-link text-primary hover:underline">
              服务条款
            </Link>{" "}
            和{" "}
            <Link href="/privacy" className="interactive-text-link text-primary hover:underline">
              隐私政策
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
