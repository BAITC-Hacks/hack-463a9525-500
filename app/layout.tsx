import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoneyGraph · Граф денег",
  description: "Объяснимые гипотезы по направленной сети переводов для AML-аналитика."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body>{children}</body></html>;
}
