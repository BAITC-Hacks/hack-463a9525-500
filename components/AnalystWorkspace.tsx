"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Bot, Send, ShieldCheck } from "lucide-react";

type Answer = { answer: string; referenced_gids: string[]; sources: { type: string; id: string | number }[]; disclaimer: string };
type Message = { question: string; result?: Answer; error?: string };
const suggestions = [
  ["Приоритет", "Кто в топе для проверки и почему?"],
  ["Роли", "Кто основные консолидаторы?"],
  ["Транзит", "Покажи возможные транзитные счета"],
  ["Методика", "Каких данных не хватает для проверки гипотезы?"],
];

export default function AnalystWorkspace() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  async function ask(value: string) {
    const prompt = value.trim();
    if (prompt.length < 2 || busy) return;
    setBusy(true); setQuestion("");
    try {
      const response = await fetch("/api/analyst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: prompt }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.detail || "Запрос не выполнен");
      setMessages(current => [...current, { question: prompt, result: payload }]);
    } catch (error) {
      setMessages(current => [...current, { question: prompt, error: error instanceof Error ? error.message : "Сервис недоступен" }]);
    } finally { setBusy(false); }
  }
  return <main className="analyst-page"><div className="network-heading"><div><h1>AI Analyst</h1><p>Исследуйте сеть вопросами на обычном языке</p></div><Link href="/network">Вернуться к графу <ArrowUpRight size={15}/></Link></div>
    <div className="analyst-workspace"><section className="dash-panel analyst-main"><div className="analyst-intro"><span className="analyst-mark"><Bot size={24}/></span><div><h2>Что вы хотите проверить?</h2><p>Помощник отвечает по измеренным связям и признакам. Упомянутые счета можно открыть в графе.</p></div></div>
      {messages.length === 0 && <div className="analyst-prompts">{suggestions.map(([label, prompt]) => <button key={prompt} type="button" onClick={() => ask(prompt)}><span>{label}</span><strong>{prompt}</strong><ArrowUpRight size={15}/></button>)}</div>}
      <div className="analyst-conversation" aria-live="polite">{messages.map((message, index) => <article key={index} className="analyst-message"><div className="analyst-question">{message.question}</div>{message.error ? <p className="analyst-error" role="alert">{message.error}</p> : <div className="analyst-response"><div className="analyst-response-label"><ShieldCheck size={15}/> Ответ по рассчитанным данным</div><p>{message.result?.answer}</p>{message.result && message.result.referenced_gids.length > 0 && <div className="analyst-source-list"><small>Открыть узлы в графе</small><div>{message.result.referenced_gids.slice(0, 12).map(gid => <Link key={gid} href={`/network?gid=${gid}`}>{gid} <ArrowUpRight size={12}/></Link>)}</div></div>}<small className="analyst-disclaimer">{message.result?.disclaimer}</small></div>}</article>)}{busy && <p className="analyst-status" role="status">Проверяю расчёты…</p>}</div>
      <form className="analyst-composer" onSubmit={event => { event.preventDefault(); ask(question); }}><label htmlFor="analyst-question">Вопрос по сети</label><div><input id="analyst-question" value={question} onChange={event => setQuestion(event.target.value)} placeholder="Например: почему GID 100000003684369100 в топе?" maxLength={500}/><button type="submit" disabled={busy || question.trim().length < 2}><Send size={16}/> Спросить</button></div><small>Вопросы о GID, ролях, кластерах, путях и ограничениях данных</small></form></section>
      <aside className="dash-panel analyst-guide"><h2>Как читать ответ</h2><ol><li><strong>Проверьте GID.</strong><span>Откройте узел и сравните входящих и исходящих контрагентов.</span></li><li><strong>Смотрите на признаки.</strong><span>Роль и приоритет опираются на суммы, связи и временные паттерны.</span></li><li><strong>Учитывайте границы.</strong><span>Глубина 4 и исходящий обход ограничивают видимость переводов.</span></li></ol><Link href="/methodology">Методика расчёта →</Link></aside>
    </div>
  </main>;
}
