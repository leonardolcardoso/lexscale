import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="not-found-page relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-950 px-4">
      <div className="not-found-bg absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(59,130,246,0.3),transparent_35%),radial-gradient(circle_at_85%_0%,rgba(20,184,166,0.2),transparent_30%),linear-gradient(180deg,#050b1d_0%,#040916_100%)]" />
      <Card className="relative w-full max-w-md border border-slate-700/80 bg-slate-900/90 shadow-2xl shadow-black/60 backdrop-blur-xl">
        <CardContent className="pt-6">
          <div className="mb-4 flex gap-3">
            <AlertCircle className="h-8 w-8 text-red-500" />
            <h1 className="text-2xl font-bold text-slate-100">404 Page Not Found</h1>
          </div>

          <p className="mt-4 text-sm text-slate-300">Did you forget to add the page to the router?</p>
        </CardContent>
      </Card>
    </div>
  );
}
