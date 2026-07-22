import { AuthGuard, RoleGate } from "@/components/auth-guard";
import { AppShell } from "@/components/layout/app-shell";

export default function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthGuard>
      <AppShell>
        <RoleGate>{children}</RoleGate>
      </AppShell>
    </AuthGuard>
  );
}
