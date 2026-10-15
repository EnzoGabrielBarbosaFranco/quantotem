// Projetar uma recorrência não grava dados. Pagamentos e edições materializam
// parcelas com IDs estáveis, inclusive quando criadas em dispositivos diferentes.
export function recurringForMonth(transactions, month, tombstones = []) {
  const removed = new Set(tombstones.filter(item => item.collection === "transactions").map(item => item.id));
  const byId = new Map(transactions.map(item => [item.id, item]));
  const result = new Map();
  for (const item of transactions) {
    if (!item.recurring || item.type !== "expense" || item.recurrenceParent) continue;
    const start = item.date.slice(0, 7);
    if (month < start || (item.recurrenceEnd && month > item.recurrenceEnd)) continue;
    if (month === start) { result.set(item.id, item); continue; }
    const id = `recurring:${item.id}:${month}`;
    if (removed.has(id)) continue;
    const saved = byId.get(id);
    if (saved && (!saved.recurring || saved.type !== "expense")) continue;
    const [year, number] = month.split("-").map(Number);
    const day = Math.min(Number(item.date.slice(8)), new Date(year, number, 0).getDate());
    result.set(id, saved || {
      ...item, id, date: `${month}-${String(day).padStart(2, "0")}`,
      recurrenceParent: item.id, scheduledMonth: month, paid: false, paidDate: null, virtual: true
    });
  }
  for (const item of transactions) {
    if (item.recurring && item.recurrenceParent && (item.scheduledMonth || item.date.slice(0, 7)) === month) result.set(item.id, item);
  }
  return [...result.values()].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, "pt-BR"));
}

export function monthlyPlan(transactions, month, tombstones = []) {
  const monthItems = transactions.filter(item => (!item.recurring || item.paid) && (item.recurring && item.paidDate ? item.paidDate : item.date).startsWith(month));
  const cents = items => items.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0);
  const income = cents(monthItems.filter(item => item.type === "income")) / 100;
  const expenses = cents(monthItems.filter(item => item.type === "expense")) / 100;
  const recurring = recurringForMonth(transactions, month, tombstones);
  const pending = cents(recurring.filter(item => !item.paid)) / 100;
  return { income, expenses, pending, balance: (Math.round(income * 100) - Math.round(expenses * 100)) / 100, projected: (Math.round(income * 100) - Math.round(expenses * 100) - Math.round(pending * 100)) / 100, recurring };
}

export function goalMonthlyContribution(goal, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(goal.deadline || "")) return null;
  const [year, month] = goal.deadline.split("-").map(Number);
  const remaining = Math.max(0, Number(goal.target) - Number(goal.saved));
  const months = Math.max(1, (year - today.getFullYear()) * 12 + month - today.getMonth());
  return Math.ceil(remaining * 100 / months) / 100;
}
