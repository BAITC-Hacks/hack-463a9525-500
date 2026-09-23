"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowUp, ExternalLink, MessageSquareText, Plus, ShieldCheck } from "lucide-react";
import { BorderBeam } from "@/components/ui/border-beam";

type Answer = { answer: string; referenced_gids: string[]; sources: { type: string; id: string | number }[]; disclaimer: string; mode: "openai" };
type Exchange = { question: string; result?: Answer; error?: string };

const suggestions = [
  "Кто в начале очереди проверки и почему?",
  "Покажи возможные транзитные счета",
  "Каких данных не хватает для проверки?",
];

export default function AnalystWorkspace() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"loading" | "openai" | "unconfigured" | "unavailable">("loading");
  const [focused, setFocused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    fetch("/api/analyst", { cache: "no-store" })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(payload => setStatus(payload.mode === "openai" ? "openai" : "unconfigured"))
      .catch(() => setStatus("unavailable"));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "end" });
  }, [messages, busy, reducedMotion]);

  async function ask(value: string) {
    const prompt = value.trim();
    if (prompt.length < 2 || busy || status !== "openai") return;
    const history = messages.flatMap(message => [
      { role: "user", content: message.question },
      ...(message.result ? [{ role: "assistant", content: message.result.answer.slice(0, 2000) }] : []),
    ]).slice(-8);
    setMessages(current => [...current, { question: prompt }]);
    setQuestion("");
    setBusy(true);
    try {
      const response = await fetch("/api/analyst", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: prompt, history }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || payload.detail || "Не удалось получить ответ");
      setMessages(current => current.map((message, index) => index === current.length - 1 ? { ...message, result: payload } : message));
    } catch (error) {
      setMessages(current => current.map((message, index) => index === current.length - 1 ? { ...message, error: error instanceof Error ? error.message : "Сервис недоступен" } : message));
    } finally {
      setBusy(false);
      textareaRef.current?.focus();
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void ask(question);
    }
  }

  return <main className="analyst-page">
    <div className="analyst-chat-header"><div><h1>AI Analyst</h1><p>Вопросы по рассчитанной сети переводов</p></div><div className="analyst-header-actions"><span className="analyst-mode"><i aria-hidden="true" />{status === "openai" ? "OpenAI подключён" : status === "unconfigured" ? "OpenAI не подключён" : status === "unavailable" ? "Сервис недоступен" : "Проверка соединения"}</span><button type="button" onClick={() => { setMessages([]); setQuestion(""); textareaRef.current?.focus(); }} disabled={messages.length === 0} aria-label="Новый диалог"><Plus size={17}/><span>Новый диалог</span></button></div></div>

    <section className="analyst-chat" aria-label="Диалог с аналитиком">
      <div className="analyst-chat-scroll" aria-live="polite">
        {messages.length === 0 && <div className="analyst-empty"><span className="analyst-empty-icon"><MessageSquareText size={25} /></span><h2>Что проверить в сети?</h2><p>Спросите о конкретном GID, роли, группе счетов или ограничениях данных. В ответе будут ссылки на узлы, которые можно открыть в графе.</p>{status === "unconfigured" && <div className="analyst-setup" role="status"><strong>Подключите OpenAI для ответов</strong><span>Добавьте ключ в <code>.env.local</code> как <code>MONEYGRAPH_OPENAI_API_KEY</code> и перезапустите <code>./run.sh</code>.</span></div>}{status === "unavailable" && <div className="analyst-setup" role="alert"><strong>Сервис аналитика недоступен</strong><span>Запустите сервер командой <code>./run.sh</code>.</span></div>}{status === "openai" && <div className="analyst-starters">{suggestions.map(prompt => <button type="button" key={prompt} onClick={() => void ask(prompt)}>{prompt}<ArrowUp size={15} aria-hidden="true" /></button>)}</div>}</div>}
        {messages.map((message, index) => <div className="analyst-exchange" key={index}>
          <div className="analyst-user-row"><span className="analyst-user-message">{message.question}</span></div>
          {message.result && <article className="analyst-assistant-message"><div className="analyst-answer-heading"><span className="analyst-answer-icon"><ShieldCheck size={17} /></span><strong>Аналитик</strong><small>OpenAI · данные MoneyGraph</small></div><p>{message.result.answer}</p>{message.result.referenced_gids.length > 0 && <div className="analyst-references"><span>Узлы в ответе</span><div>{message.result.referenced_gids.slice(0, 12).map(gid => <Link href={`/network?gid=${gid}`} key={gid}>{gid}<ExternalLink size={12} aria-hidden="true" /></Link>)}</div></div>}<small className="analyst-disclaimer">{message.result.disclaimer}</small></article>}
          {message.error && <div className="analyst-reply-error" role="alert"><p>{message.error}</p><button type="button" onClick={() => void ask(message.question)}>Повторить</button></div>}
          {busy && index === messages.length - 1 && !message.result && !message.error && <div className="analyst-thinking" role="status"><span className="analyst-thinking-dots" aria-hidden="true">···</span>Сверяю ответ с данными</div>}
        </div>)}
        <div ref={bottomRef} />
      </div>
      <div className="analyst-input-area"><form onSubmit={event => { event.preventDefault(); void ask(question); }} onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}><BorderBeam size="line" colorVariant="sunset" theme="dark" strength={0.28} active={focused && !reducedMotion}><div className="analyst-input-box"><label className="sr-only" htmlFor="analyst-question">Вопрос по сети</label><textarea ref={textareaRef} id="analyst-question" value={question} onChange={event => setQuestion(event.target.value)} onKeyDown={onComposerKeyDown} placeholder={status === "openai" ? "Спросите о GID, роли или переводах…" : "Сначала подключите OpenAI"} maxLength={500} rows={2} disabled={busy || status !== "openai"}/><div className="analyst-input-bottom"><span>Enter — отправить · Shift+Enter — новая строка</span><button type="submit" disabled={busy || status !== "openai" || question.trim().length < 2} aria-label="Отправить вопрос"><ArrowUp size={18}/></button></div></div></BorderBeam></form><div className="analyst-input-foot"><span>Выводы требуют проверки по операциям.</span><Link href="/methodology">Как устроен расчёт <ExternalLink size={12}/></Link></div></div>
    </section>
  </main>;
}
