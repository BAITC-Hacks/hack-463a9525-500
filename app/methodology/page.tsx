import Link from "next/link";
import Shell from "@/components/Shell";
import { getGraphData } from "@/lib/data";
import type { Role } from "@/lib/data";

const roleNames: Record<Role, string> = { coordinator: "Координация", consolidator: "Консолидация", distributor: "Распределение", transit: "Транзит", terminal: "Конечный получатель", peripheral: "Периферия" };

const roles = [
  { name: "Консолидация", signal: "Несколько отправителей и преобладание входящего потока", check: "Плательщики, даты и дальнейшее движение средств" },
  { name: "Распределение", signal: "Несколько получателей и преобладание исходящего потока", check: "Получатели, интервалы и назначение операций" },
  { name: "Транзит", signal: "Похожие суммы на входе и выходе в пределах двух дней", check: "Последовательность операций и фактический остаток" },
  { name: "Координация", signal: "Счёт соединяет несколько частей наблюдаемой сети", check: "Направление связей и роль соседних счетов" },
  { name: "Конечный получатель", signal: "Входящие видны, исходящих нет до границы четвёртого колена", check: "Операции за пределами выгрузки" },
  { name: "Периферия", signal: "Признаков для другой роли недостаточно", check: "Контекст операций без вывода о роли" },
];

const weights = [
  ["Роль и сила совпадения", 18], ["Посредничество в сети", 16],
  ["PageRank с учётом суммы", 14], ["Объём относительно своей глубины", 14],
  ["Достижимость исходных счетов", 10], ["Мост между группами", 10],
  ["Статистическая необычность", 10], ["Быстрые похожие суммы", 8],
] as const;

export default async function MethodologyPage() {
  const data = await getGraphData();
  const example = [...data.nodes].sort((a, b) => b.priority_score - a.priority_score)[0];

  return <Shell><main className="method-page">
    <header className="method-header">
      <div><h1>Как читать результаты</h1><p>Что означает роль счёта, из чего складывается очередь проверки и где заканчиваются наблюдаемые данные.</p></div>
      <Link href="/priorities">Открыть очередь <span aria-hidden="true">↗</span></Link>
    </header>

    <section className="method-summary" aria-labelledby="method-summary-title">
      <div><h2 id="method-summary-title">От перевода к проверке</h2><p>Перевод задаёт направление связи между счетами. По этим связям система оценивает структурные признаки, предлагает роль и сортирует счета по приоритету. Аналитик проверяет операции и контекст каждого вывода.</p></div>
      <div className="method-summary-facts"><span>{data.summary.nodes.toLocaleString("ru-RU")} счётов</span><span>{data.summary.edges.toLocaleString("ru-RU")} связей</span><span>Исходные счета: {data.summary.seeds}</span></div>
    </section>

    <section className="method-section" aria-labelledby="role-title">
      <div className="method-section-heading"><h2 id="role-title">Роли счетов</h2><p>Оценка роли показывает, насколько наблюдаемый рисунок переводов совпадает с профилем. Порог назначения — 0,55.</p></div>
      <div className="method-table-scroll"><table className="method-table"><thead><tr><th scope="col">Роль</th><th scope="col">Что видно в данных</th><th scope="col">Что проверить</th></tr></thead><tbody>{roles.map(role => <tr key={role.name}><th scope="row">{role.name}</th><td>{role.signal}</td><td>{role.check}</td></tr>)}</tbody></table></div>
      <p className="method-note">На глубине 4 отсутствие исходящих переводов не даёт оснований назначить роль «Конечный получатель».</p>
      <details className="method-technical"><summary>Технические правила расчёта ролей</summary><div><p>Суммы и число связей переводятся в ранги от 0 до 1. Сообщества выделяются алгоритмом Louvain на взвешенной проекции; роли используют исходное направление переводов. Из допустимых ролей выбирается наибольшая оценка от 0,55.</p><ul><li>Консолидация: 35% входящих связей, 30% входящего объёма, 20% разнообразия плательщиков, 15% доли входящих.</li><li>Распределение: те же веса для исходящих связей, объёма и получателей.</li><li>Транзит: 32% баланса входа и выхода, 28% похожих сумм за два дня, 20% быстрого выхода, 20% объёма в обоих направлениях.</li><li>Координация: 25% посредничества, 23% взвешенного PageRank, 20% связей между группами, 18% достижимости исходных счетов, 14% относительного объёма.</li><li>Конечный получатель: 40% входящего объёма, 25% входящих связей, 35% отсутствия исходящих до границы наблюдения.</li></ul></div></details>
    </section>

    <section className="method-section method-priority" aria-labelledby="priority-title">
      <div className="method-section-heading"><h2 id="priority-title">Приоритет проверки</h2><p>Единая оценка помогает упорядочить ручную работу. 90% в очереди обозначает высокий приоритет проверки.</p></div>
      <div className="method-priority-content"><div className="method-weights" aria-label="Веса факторов приоритета">{weights.map(([label, value]) => <div className="method-weight" key={label}><span>{label}</span><div className="method-weight-track" aria-hidden="true"><i style={{ width: `${value / 18 * 100}%` }} /></div><strong>{value}%</strong></div>)}</div>
        <div className="method-example"><span>Пример из текущих данных</span><Link href={`/network?gid=${example.gid}`}>GID {example.gid} ↗</Link><p>Видны {example.in_deg} входящих и {example.out_deg} исходящих связей. Счёт встречается в путях от {example.seed_reach} исходных счетов.</p><dl><div><dt>Роль</dt><dd>{roleNames[example.role]}</dd></div><div><dt>Приоритет</dt><dd>{Math.round(example.priority_score * 100)}%</dd></div></dl><small>Откройте счёт, чтобы увидеть соседей и переводы.</small></div>
      </div>
    </section>

    <section className="method-section method-boundaries" id="data-limitations" aria-labelledby="limitations-title"><div className="method-section-heading"><h2 id="limitations-title">Границы данных</h2><p>Эти ограничения нужно учитывать при чтении графа и ответов аналитика.</p></div><ul><li>В выборку вошли исходящие пути от {data.summary.seeds} исходных счетов до четвёртого колена.</li><li>Переводы менее 5 000 ₸ и внешние входящие операции отсутствуют в выгрузке.</li><li>На четвёртом колене путь может продолжаться; входящий поток исходных счетов может быть неполным.</li><li>Имена владельцев и размеченные случаи отсутствуют. Сходство суммы и времени само по себе не подтверждает движение конкретных денег.</li></ul></section>
    <div className="method-footer"><Link href="/network">Исследовать граф ↗</Link><Link href="/analyst">Задать вопрос аналитику ↗</Link></div>
  </main></Shell>;
}
