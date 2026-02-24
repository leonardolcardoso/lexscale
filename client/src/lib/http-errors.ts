export class ApiError extends Error {
  status: number;
  rawDetail: string;

  constructor(status: number, message: string, rawDetail: string) {
    super(message);
    this.status = status;
    this.rawDetail = rawDetail;
  }
}

function extractApiDetail(rawText: string): string {
  const text = rawText.trim();
  if (!text) {
    return "";
  }

  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed?.detail === "string") {
      return parsed.detail;
    }
  } catch {
    // resposta nao era JSON.
  }

  return text;
}

function mapFriendlyMessage(status: number, detail: string): string {
  const normalized = detail.toLowerCase();

  if (status === 400 && normalized.includes("e-mail")) {
    return "Informe um e-mail válido para continuar.";
  }

  if (status === 401) {
    if (normalized.includes("credenciais") || normalized.includes("senha")) {
      return "E-mail ou senha incorretos. Confira os dados e tente novamente.";
    }
    if (normalized.includes("sessao") || normalized.includes("autenticado")) {
      return "Sua sessão expirou. Faça login novamente para continuar.";
    }
    return "Você precisa estar autenticado para continuar.";
  }

  if (status === 403) {
    return "Você não tem permissão para executar esta ação.";
  }

  if (status === 404) {
    return detail || "Não encontramos o recurso solicitado.";
  }

  if (status === 409) {
    if (normalized.includes("conta") || normalized.includes("e-mail")) {
      return "Já existe uma conta com este e-mail. Faça login ou recupere sua senha.";
    }
    return "Já existe um registro com esses dados.";
  }

  if (status === 413) {
    return "O arquivo enviado é muito grande. Envie um arquivo menor e tente novamente.";
  }

  if (status === 422) {
    return "Alguns dados enviados são inválidos. Revise os campos e tente novamente.";
  }

  if (status >= 500) {
    if (normalized.includes("openai") || normalized.includes("embedding") || normalized.includes("ia")) {
      return "Não foi possível processar a solicitação com IA neste momento. Tente novamente em instantes.";
    }
    return "O servidor está indisponível no momento. Tente novamente em instantes.";
  }

  if (detail) {
    return detail;
  }

  return "Não foi possível concluir a operação. Tente novamente.";
}

export function mapNetworkError(error: unknown, fallbackMessage?: string): Error {
  if (error instanceof ApiError) {
    return error;
  }
  if (error instanceof Error && error.message === "Failed to fetch") {
    return new Error("Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.");
  }
  if (error instanceof Error) {
    return new Error(fallbackMessage || "Ocorreu um erro inesperado. Tente novamente.");
  }
  return new Error(fallbackMessage || "Ocorreu um erro inesperado. Tente novamente.");
}

export async function parseApiErrorResponse(res: Response): Promise<ApiError> {
  const rawText = (await res.text()) || res.statusText;
  const detail = extractApiDetail(rawText);
  const message = mapFriendlyMessage(res.status, detail);
  return new ApiError(res.status, message, detail || rawText);
}

export function isUnauthorizedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
