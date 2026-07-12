import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth-provider";
import { DataProvider } from "@/components/data-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "고마워할매 예약 운영 대시보드",
  description: "고마워할매 예약 운영 내부 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="font-sans">
        <AuthProvider>
          <DataProvider>{children}</DataProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
