type ChatTurn = { role: "user" | "assistant"; content: string };

function normalizeHistory(value: unknown): ChatTurn[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const turns: ChatTurn[] = [];
  for (const item of value.slice(-8)) {
    // Tabs opened before the chat update send an array of question strings.
    if (typeof item === "string") {
      if (!item.trim() || item.length > 500) return null;
      turns.push({ role: "user", content: item });
    } else if (item && typeof item === "object" &&
      (item.role === "user" || item.role === "assistant") &&
      typeof item.content === "string" && item.content.trim() && item.content.length <= 2000) {
      turns.push({ role: item.role, content: item.content });
    } else {
      return null;
    }
  }
  return turns;
}

export async function POST(request: Request) {
  let question: unknown;
  let history: unknown;
  try {
    ({ question, history } = await request.json());
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  if (typeof question !== "string" || question.trim().length < 2 || question.length > 500) {
    return Response.json({ error: "Введите вопрос длиной от 2 до 500 символов" }, { status: 400 });
  }
  const normalizedHistory = normalizeHistory(history);
  if (normalizedHistory === null) {
    return Response.json({ error: "Некорректная история диалога" }, { status: 400 });
  }
  try {
    const response = await fetch(`${process.env.BACKEND_URL ?? "http://127.0.0.1:8000"}/api/analyst`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, history: normalizedHistory }), cache: "no-store"
    });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch {
    return Response.json({ error: "API аналитика недоступен. Запустите ./run.sh." }, { status: 503 });
  }
}

export async function GET() {
  try {
    const response = await fetch(`${process.env.BACKEND_URL ?? "http://127.0.0.1:8000"}/api/analyst/status`, { cache: "no-store" });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch {
    return Response.json({ mode: "unavailable" }, { status: 503 });
  }
}
