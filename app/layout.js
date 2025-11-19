
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/theme-provider";
import Header from "@/components/header"; // default import
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";


const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "SENSAI - AI Career Coach",
  description: "",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }) {
  return (
    <ClerkProvider
      appearance={{
        theme: 'Dark',
      }}
    >
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${inter.className}`}
        >
          <script dangerouslySetInnerHTML={{__html: `
            const originalWarn = console.warn;
            console.warn = function(...args) {
              const message = String(args[0] || '');
              if (message.includes('Attempting to parse an unsupported color function')) {
                return;
              }
              originalWarn.apply(console, args);
            };
          `}} />
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            {/* header */}
            <Header />
            <main className="min-h-screen">{children}</main>
            <Toaster richColors />
            {/* footer */}
            <footer className="bg-muted/50 py-12">
              <div className="container mx-auto px-4 text-center text-gray-200">
                <p>Made With Love By Sudarshan Ahire</p>
              </div>
            </footer>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
