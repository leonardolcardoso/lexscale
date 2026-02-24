import { isUnauthorizedError, mapNetworkError, parseApiErrorResponse } from "@/lib/http-errors";

export type AuthUser = {
  user_id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  full_name: string;
  company?: string | null;
  role?: string | null;
  phone?: string | null;
  bio?: string | null;
  created_at: string;
};

export type AuthResponse = {
  user: AuthUser;
};

export type RegisterPayload = {
  email: string;
  password: string;
  first_name?: string;
  last_name?: string;
};

export type LoginPayload = {
  email: string;
  password: string;
};

export type ProfileUpdatePayload = {
  first_name?: string;
  last_name?: string;
  company?: string;
  role?: string;
  phone?: string;
  bio?: string;
};

export async function fetchMe(): Promise<AuthUser> {
  try {
    const res = await fetch("/api/auth/me", { credentials: "include" });
    if (!res.ok) {
      throw await parseApiErrorResponse(res);
    }
    const payload = (await res.json()) as AuthResponse;
    return payload.user;
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível validar sua sessão. Tente novamente.");
  }
}

export async function login(payload: LoginPayload): Promise<AuthUser> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res);
    }
    const body = (await res.json()) as AuthResponse;
    return body.user;
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível fazer login. Tente novamente.");
  }
}

export async function register(payload: RegisterPayload): Promise<AuthUser> {
  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res);
    }
    const body = (await res.json()) as AuthResponse;
    return body.user;
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível criar sua conta. Tente novamente.");
  }
}

export async function logout(): Promise<void> {
  try {
    const res = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res);
    }
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível encerrar sua sessão. Tente novamente.");
  }
}

export async function fetchProfile(): Promise<AuthUser> {
  try {
    const res = await fetch("/api/profile", { credentials: "include" });
    if (!res.ok) {
      throw await parseApiErrorResponse(res);
    }
    return (await res.json()) as AuthUser;
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível carregar seu perfil. Tente novamente.");
  }
}

export async function updateProfile(payload: ProfileUpdatePayload): Promise<AuthUser> {
  try {
    const res = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw await parseApiErrorResponse(res);
    }
    return (await res.json()) as AuthUser;
  } catch (error) {
    throw mapNetworkError(error, "Não foi possível salvar seu perfil. Tente novamente.");
  }
}

export function buildInitials(fullName: string): string {
  const tokens = fullName
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
  if (tokens.length === 0) return "US";
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0][0]}${tokens[tokens.length - 1][0]}`.toUpperCase();
}

export { isUnauthorizedError };
