import { AuthGuard, RoleGate } from "@/components/auth-guard";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        <Sidebar />
        <main className="min-w-0 flex-1">
          <Topbar />
          <div className="px-8 pb-10 pt-1">
            <RoleGate>{children}</RoleGate>
          </div>
        </main>
      </div>
    </AuthGuard>
  );
}
