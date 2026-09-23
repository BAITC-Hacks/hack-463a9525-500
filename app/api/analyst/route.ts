export async function POST(request: Request) {
  let question: unknown;
  try {
    ({ question } = await request.json());
  } catch {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  if (typeof question !== "string" || question.trim().length < 2 || question.length > 500) {
    return Response.json({ error: "Введите вопрос длиной от 2 до 500 символов" }, { status: 400 });
  }
  try {
    const response = await fetch(`${process.env.BACKEND_URL ?? "http://127.0.0.1:8000"}/api/analyst`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }), cache: "no-store"
    });
    return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json; charset=utf-8" } });
  } catch {
    return Response.json({ error: "API аналитика недоступен. Запустите ./run.sh." }, { status: 503 });
  }
}
