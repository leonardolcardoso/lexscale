import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useBackNavigation } from "@/hooks/use-back-navigation";
import { fetchProfile, isUnauthorizedError, logout, updateProfile } from "@/lib/auth";

export default function ProfilePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const goBack = useBackNavigation("/dashboard");
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    company: "",
    role: "",
    phone: "",
    bio: "",
  });

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: fetchProfile,
    retry: false,
  });

  const updateMutation = useMutation({
    mutationFn: () => updateProfile(form),
    onSuccess: (user) => {
      setForm({
        first_name: user.first_name || "",
        last_name: user.last_name || "",
        company: user.company || "",
        role: user.role || "",
        phone: user.phone || "",
        bio: user.bio || "",
      });
      toast({ title: "Perfil atualizado", description: "Informações salvas com sucesso." });
    },
    onError: (error) => {
      toast({
        title: "Falha ao atualizar perfil",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      setLocation("/auth?tab=login", { replace: true });
    },
    onError: (error) => {
      toast({
        title: "Falha ao sair",
        description: error instanceof Error ? error.message : "Erro desconhecido",
      });
    },
  });

  useEffect(() => {
    if (!profileQuery.data) {
      return;
    }
    setForm({
      first_name: profileQuery.data.first_name || "",
      last_name: profileQuery.data.last_name || "",
      company: profileQuery.data.company || "",
      role: profileQuery.data.role || "",
      phone: profileQuery.data.phone || "",
      bio: profileQuery.data.bio || "",
    });
  }, [profileQuery.data]);

  useEffect(() => {
    if (!profileQuery.error) {
      return;
    }
    if (isUnauthorizedError(profileQuery.error)) {
      setLocation("/auth?tab=login", { replace: true });
      return;
    }
    toast({
      title: "Falha ao carregar perfil",
      description: profileQuery.error instanceof Error ? profileQuery.error.message : "Erro desconhecido",
    });
  }, [profileQuery.error, setLocation, toast]);

  if (profileQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-300">
        Carregando perfil...
      </div>
    );
  }

  const user = profileQuery.data;

  return (
    <div className="profile-shell min-h-screen bg-[radial-gradient(circle_at_15%_10%,rgba(59,130,246,0.28),transparent_40%),radial-gradient(circle_at_85%_0%,rgba(20,184,166,0.2),transparent_35%),linear-gradient(180deg,#050b1d_0%,#040916_100%)] p-6 md:p-10">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-6 flex items-center justify-between">
          <Link href="/" className="inline-flex items-center gap-2 text-slate-900 dark:text-white">
            <Scale className="h-5 w-5 text-cyan-300" />
            <span className="font-bold">LexScale</span>
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" className="border-slate-700 bg-slate-900/50 text-slate-100 hover:bg-slate-800" onClick={goBack}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Voltar
            </Button>
            <Button variant="outline" className="border-slate-700 bg-slate-900/50 text-slate-100 hover:bg-slate-800" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
              {logoutMutation.isPending ? "Saindo..." : "Sair"}
            </Button>
          </div>
        </header>

        <Card className="border border-slate-700/80 bg-slate-900/85 text-slate-100 shadow-[0_24px_60px_rgba(2,6,23,0.55)] backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Meu Perfil</CardTitle>
            <CardDescription className="text-slate-300">Gerencie os dados da sua conta e da sua equipe.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="first_name">Nome</Label>
                <Input id="first_name" value={form.first_name} onChange={(event) => setForm((prev) => ({ ...prev, first_name: event.target.value }))} className="border-slate-700 bg-slate-950/60" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="last_name">Sobrenome</Label>
                <Input id="last_name" value={form.last_name} onChange={(event) => setForm((prev) => ({ ...prev, last_name: event.target.value }))} className="border-slate-700 bg-slate-950/60" />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" value={user?.email || ""} disabled className="border-slate-700 bg-slate-950/50 text-slate-400" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input id="phone" value={form.phone} onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))} className="border-slate-700 bg-slate-950/60" />
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="company">Empresa</Label>
                <Input id="company" value={form.company} onChange={(event) => setForm((prev) => ({ ...prev, company: event.target.value }))} className="border-slate-700 bg-slate-950/60" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Cargo</Label>
                <Input id="role" value={form.role} onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))} className="border-slate-700 bg-slate-950/60" />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio">Bio</Label>
              <Textarea
                id="bio"
                value={form.bio}
                onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))}
                className="min-h-[120px] border-slate-700 bg-slate-950/60"
                placeholder="Descreva sua área de atuação, especialidades e objetivos."
              />
            </div>

            <div className="flex justify-end">
              <Button className="bg-blue-600 hover:bg-blue-500 text-white" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Salvando..." : "Salvar Alterações"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
